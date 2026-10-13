/** One reading of what the app is costing the phone. Fields a platform can't measure are absent. */
export type MetricSample = {
  /** Wall clock, ms since epoch. */
  t: number;
  /** Monotonic seconds since boot. */
  uptimeS: number;
  /** Process CPU time (user + system, all threads). CPU % = Δ cpuTimeS / Δ uptimeS × 100. */
  cpuTimeS: number;
  /** iOS: phys_footprint (what jetsam limits). Android: resident set (VmRSS). */
  memFootprintBytes?: number;
  /** iOS: how much more the app may use before it's killed. Android: system-wide available memory. */
  memAvailableBytes?: number;
  /** iOS: nominal | fair | serious | critical. Android: nominal | light | moderate | severe | critical | emergency | shutdown. */
  thermal?: string;
  /** Android 11+: 0–1 forecast of thermal throttling (1 = severe). */
  thermalHeadroom?: number | null;
  /** 0–1. iOS reports it in 1% steps (5% on some models). */
  batteryLevel?: number;
  /** unplugged | charging | full | not_charging | unknown */
  batteryState?: string;
  lowPowerMode?: boolean;
  /** Android: battery current in µA (sign varies by vendor). */
  currentMicroA?: number;
  /** Android: battery voltage in mV. */
  voltageMv?: number;
  /** Android: instantaneous battery power draw in watts (|current| × voltage). */
  powerW?: number;
  /** Android: battery temperature in °C. */
  batteryTempC?: number;
  /** Screen brightness, 0–1 (the display's power is part of every reading). */
  screenBrightness?: number;
  /** Android: mean and highest current CPU core frequency in MHz (where /sys is readable). */
  cpuFreqAvgMHz?: number;
  cpuFreqMaxMHz?: number;
  /** Android: current GPU frequency in MHz, on phones that let apps read it (often blocked). */
  gpuFreqMHz?: number;
};

export type DeviceInfo = {
  platform: 'ios' | 'android';
  cpuCount: number;
  physicalMemoryBytes: number;
};
