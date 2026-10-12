import { useSyncExternalStore } from 'react';

/*
 * While the benchmark screen is open the chat unloads its model, so a run
 * measures one model in memory, not two.
 */

let active = false;
const listeners = new Set<() => void>();

export function setBenchMode(on: boolean) {
  if (active === on) return;
  active = on;
  listeners.forEach((l) => l());
}

export function useBenchMode(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => active
  );
}
