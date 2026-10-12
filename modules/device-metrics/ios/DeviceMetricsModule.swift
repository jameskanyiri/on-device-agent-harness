import ExpoModulesCore
import Foundation
import UIKit
import os

/// Samples what an on-device model costs the phone: memory, CPU time, thermal
/// state and battery. Sampling runs on a native timer into a native buffer, so a
/// busy JS thread doesn't skew or drop samples; JS collects them when a run ends.
public class DeviceMetricsModule: Module {
  private let queue = DispatchQueue(label: "expo.modules.devicemetrics.sampler", qos: .utility)
  private var timer: DispatchSourceTimer?
  private var samples: [[String: Any]] = []
  private static let maxSamples = 20_000

  // UIDevice's battery properties belong to the main thread; they're cached here.
  private let batteryLock = NSLock()
  private var batteryLevel: Float = -1
  private var batteryState: UIDevice.BatteryState = .unknown

  public func definition() -> ModuleDefinition {
    Name("DeviceMetrics")

    OnCreate {
      DispatchQueue.main.async {
        UIDevice.current.isBatteryMonitoringEnabled = true
        self.refreshBattery()
        let center = NotificationCenter.default
        center.addObserver(
          forName: UIDevice.batteryLevelDidChangeNotification, object: nil, queue: .main
        ) { [weak self] _ in self?.refreshBattery() }
        center.addObserver(
          forName: UIDevice.batteryStateDidChangeNotification, object: nil, queue: .main
        ) { [weak self] _ in self?.refreshBattery() }
      }
    }

    OnDestroy {
      self.queue.sync { self.stopTimer() }
    }

    Function("getDeviceInfo") { () -> [String: Any] in
      [
        "platform": "ios",
        "cpuCount": ProcessInfo.processInfo.activeProcessorCount,
        "physicalMemoryBytes": Double(ProcessInfo.processInfo.physicalMemory),
      ]
    }

    Function("getSnapshot") { () -> [String: Any] in
      self.snapshot()
    }

    /// Starts buffering a sample every `intervalMs` (and one right away). Clears earlier samples.
    Function("startSampling") { (intervalMs: Double) in
      self.queue.sync {
        self.stopTimer()
        self.samples.removeAll()
        let timer = DispatchSource.makeTimerSource(queue: self.queue)
        timer.schedule(deadline: .now(), repeating: .milliseconds(max(50, Int(intervalMs))))
        timer.setEventHandler { [weak self] in
          guard let self else { return }
          if self.samples.count < Self.maxSamples { self.samples.append(self.snapshot()) }
        }
        timer.resume()
        self.timer = timer
      }
    }

    /// Stops sampling and returns the buffered samples (with a final one).
    Function("stopSampling") { () -> [[String: Any]] in
      self.queue.sync {
        let wasSampling = self.timer != nil
        self.stopTimer()
        if wasSampling { self.samples.append(self.snapshot()) }
        let collected = self.samples
        self.samples.removeAll()
        return collected
      }
    }

    Function("isSampling") { () -> Bool in
      self.queue.sync { self.timer != nil }
    }
  }

  private func stopTimer() {
    timer?.cancel()
    timer = nil
  }

  private func refreshBattery() {
    let device = UIDevice.current
    batteryLock.lock()
    batteryLevel = device.batteryLevel
    batteryState = device.batteryState
    batteryLock.unlock()
  }

  private func snapshot() -> [String: Any] {
    var sample: [String: Any] = [
      "t": Date().timeIntervalSince1970 * 1000,
      "uptimeS": ProcessInfo.processInfo.systemUptime,
      "cpuTimeS": cpuTimeSeconds(),
      "memFootprintBytes": Double(footprintBytes()),
      // How much more this app may allocate before iOS kills it (jetsam).
      "memAvailableBytes": Double(os_proc_available_memory()),
      "thermal": thermalName(ProcessInfo.processInfo.thermalState),
      "lowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled,
    ]
    batteryLock.lock()
    let level = batteryLevel
    let state = batteryState
    batteryLock.unlock()
    if level >= 0 { sample["batteryLevel"] = Double(level) }
    sample["batteryState"] = batteryStateName(state)
    return sample
  }

  /// Physical memory charged to the app: the number iOS compares to its per-app limit.
  private func footprintBytes() -> UInt64 {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(
      MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
    let result = withUnsafeMutablePointer(to: &info) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
      }
    }
    return result == KERN_SUCCESS ? info.phys_footprint : 0
  }

  /// User + system CPU time of the whole process, all threads. CPU % between two
  /// samples is Δ cpuTimeS / Δ uptimeS × 100 (can exceed 100 on multiple cores).
  private func cpuTimeSeconds() -> Double {
    var usage = rusage()
    guard getrusage(RUSAGE_SELF, &usage) == 0 else { return 0 }
    let user = Double(usage.ru_utime.tv_sec) + Double(usage.ru_utime.tv_usec) / 1_000_000
    let system = Double(usage.ru_stime.tv_sec) + Double(usage.ru_stime.tv_usec) / 1_000_000
    return user + system
  }

  private func thermalName(_ state: ProcessInfo.ThermalState) -> String {
    switch state {
    case .nominal: return "nominal"
    case .fair: return "fair"
    case .serious: return "serious"
    case .critical: return "critical"
    @unknown default: return "unknown"
    }
  }

  private func batteryStateName(_ state: UIDevice.BatteryState) -> String {
    switch state {
    case .unplugged: return "unplugged"
    case .charging: return "charging"
    case .full: return "full"
    case .unknown: return "unknown"
    @unknown default: return "unknown"
    }
  }
}
