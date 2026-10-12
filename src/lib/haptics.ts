import * as Haptics from 'expo-haptics';

// Plain JS functions, so worklets (gestures) can call them via `scheduleOnRN`.
// Haptics are best-effort: a failure (e.g. Low Power Mode) is never an error.

let enabled = true;

/** Set from the Haptics switch in Settings. */
export const setHapticsEnabled = (on: boolean) => {
  enabled = on;
};

/** A light tap: the drawer snapping open or closed, sending a message. */
export const tapLight = () => {
  if (!enabled) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
};

/** The selection tick, for picking an item from a list. */
export const tapSelection = () => {
  if (!enabled) return;
  Haptics.selectionAsync().catch(() => {});
};
