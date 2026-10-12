package expo.modules.devicemetrics

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import kotlin.math.abs

/**
 * Samples what an on-device model costs the phone: memory, CPU time, thermal
 * state and battery power. Sampling runs on a native timer into a native
 * buffer, so a busy JS thread doesn't skew or drop samples; JS collects them
 * when a run ends.
 */
class DeviceMetricsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val lock = Any()
  private val samples = ArrayList<Map<String, Any?>>()
  private var executor: ScheduledExecutorService? = null

  // getThermalHeadroom returns NaN when called more than about once a second.
  private var headroom: Double? = null
  private var headroomAt = 0L

  override fun definition() = ModuleDefinition {
    Name("DeviceMetrics")

    OnDestroy {
      synchronized(lock) { stopExecutor() }
    }

    Function("getDeviceInfo") {
      val info = ActivityManager.MemoryInfo()
      context.getSystemService(ActivityManager::class.java)?.getMemoryInfo(info)
      mapOf(
        "platform" to "android",
        "cpuCount" to Runtime.getRuntime().availableProcessors(),
        "physicalMemoryBytes" to info.totalMem.toDouble(),
      )
    }

    Function("getSnapshot") {
      snapshot()
    }

    /** Starts buffering a sample every `intervalMs` (and one right away). Clears earlier samples. */
    Function("startSampling") { intervalMs: Double ->
      synchronized(lock) {
        stopExecutor()
        samples.clear()
        val period = intervalMs.toLong().coerceAtLeast(50)
        executor = Executors.newSingleThreadScheduledExecutor().also {
          it.scheduleAtFixedRate({
            val sample = snapshot()
            synchronized(lock) { if (samples.size < MAX_SAMPLES) samples.add(sample) }
          }, 0, period, TimeUnit.MILLISECONDS)
        }
      }
    }

    /** Stops sampling and returns the buffered samples (with a final one). */
    Function("stopSampling") {
      synchronized(lock) {
        val wasSampling = executor != null
        stopExecutor()
        if (wasSampling) samples.add(snapshot())
        val collected = ArrayList(samples)
        samples.clear()
        collected
      }
    }

    Function("isSampling") {
      synchronized(lock) { executor != null }
    }
  }

  private fun stopExecutor() {
    executor?.shutdownNow()
    executor = null
  }

  private fun snapshot(): Map<String, Any?> {
    val sample = HashMap<String, Any?>()
    sample["t"] = System.currentTimeMillis().toDouble()
    sample["uptimeS"] = SystemClock.elapsedRealtime() / 1000.0
    // User + system CPU time of the whole process. CPU % between two samples is
    // Δ cpuTimeS / Δ uptimeS × 100 (can exceed 100 on multiple cores).
    sample["cpuTimeS"] = Process.getElapsedCpuTime() / 1000.0
    sample["memFootprintBytes"] = residentBytes()

    val activityManager = context.getSystemService(ActivityManager::class.java)
    if (activityManager != null) {
      val info = ActivityManager.MemoryInfo()
      activityManager.getMemoryInfo(info)
      // System-wide memory still available (Android has no per-app limit like iOS).
      sample["memAvailableBytes"] = info.availMem.toDouble()
    }

    val power = context.getSystemService(PowerManager::class.java)
    if (power != null) {
      sample["lowPowerMode"] = power.isPowerSaveMode
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        sample["thermal"] = thermalName(power.currentThermalStatus)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        val now = SystemClock.elapsedRealtime()
        if (now - headroomAt >= 1000) {
          val value = power.getThermalHeadroom(0)
          headroom = if (value.isNaN()) null else value.toDouble()
          headroomAt = now
        }
        sample["thermalHeadroom"] = headroom
      }
    }

    val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    if (battery != null) {
      val level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
      val scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
      if (level >= 0 && scale > 0) sample["batteryLevel"] = level.toDouble() / scale
      sample["batteryState"] = batteryStateName(battery.getIntExtra(BatteryManager.EXTRA_STATUS, -1))
      val voltageMv = battery.getIntExtra(BatteryManager.EXTRA_VOLTAGE, -1)
      if (voltageMv > 0) sample["voltageMv"] = voltageMv.toDouble()
      val tenthsC = battery.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE)
      if (tenthsC != Int.MIN_VALUE) sample["batteryTempC"] = tenthsC / 10.0

      val manager = context.getSystemService(BatteryManager::class.java)
      val currentMicroA = manager?.getLongProperty(BatteryManager.BATTERY_PROPERTY_CURRENT_NOW)
      // Long.MIN_VALUE (or 0 on some devices) means unsupported. The sign depends on the vendor.
      if (currentMicroA != null && currentMicroA != Long.MIN_VALUE && currentMicroA != 0L) {
        sample["currentMicroA"] = currentMicroA.toDouble()
        if (voltageMv > 0) sample["powerW"] = abs(currentMicroA) / 1e6 * (voltageMv / 1e3)
      }
    }
    return sample
  }

  /**
   * Resident memory of the process (VmRSS), including the memory-mapped model
   * weights that are paged in. Read from /proc: Debug.getMemoryInfo walks every
   * mapping and is too slow to call several times a second with a 3 GB model mapped.
   */
  private fun residentBytes(): Double? {
    return try {
      File("/proc/self/status").useLines { lines ->
        lines.firstOrNull { it.startsWith("VmRSS:") }
          ?.split(Regex("\\s+"))
          ?.getOrNull(1)
          ?.toDoubleOrNull()
          ?.times(1024)
      }
    } catch (e: Exception) {
      null
    }
  }

  private fun thermalName(status: Int): String = when (status) {
    PowerManager.THERMAL_STATUS_NONE -> "nominal"
    PowerManager.THERMAL_STATUS_LIGHT -> "light"
    PowerManager.THERMAL_STATUS_MODERATE -> "moderate"
    PowerManager.THERMAL_STATUS_SEVERE -> "severe"
    PowerManager.THERMAL_STATUS_CRITICAL -> "critical"
    PowerManager.THERMAL_STATUS_EMERGENCY -> "emergency"
    PowerManager.THERMAL_STATUS_SHUTDOWN -> "shutdown"
    else -> "unknown"
  }

  private fun batteryStateName(status: Int): String = when (status) {
    BatteryManager.BATTERY_STATUS_CHARGING -> "charging"
    BatteryManager.BATTERY_STATUS_DISCHARGING -> "unplugged"
    BatteryManager.BATTERY_STATUS_NOT_CHARGING -> "not_charging"
    BatteryManager.BATTERY_STATUS_FULL -> "full"
    else -> "unknown"
  }

  companion object {
    private const val MAX_SAMPLES = 20_000
  }
}
