import { NativeModule, requireOptionalNativeModule } from 'expo';

import type { DeviceInfo, MetricSample } from './DeviceMetrics.types';

declare class DeviceMetricsModule extends NativeModule {
  getDeviceInfo(): DeviceInfo;
  getSnapshot(): MetricSample;
  /** Buffers a sample every `intervalMs` on a native timer. Clears earlier samples. */
  startSampling(intervalMs: number): void;
  /** Stops sampling and returns the buffered samples. */
  stopSampling(): MetricSample[];
  isSampling(): boolean;
}

/** Null where the native module isn't built in (web, Expo Go, an older dev build). */
export default requireOptionalNativeModule<DeviceMetricsModule>('DeviceMetrics');
