import { Easing, FadeIn, FadeOut, LinearTransition, ReduceMotion } from 'react-native-reanimated';

/**
 * One place for the app's motion: short, eased, no bounce. Everything honors
 * the system Reduce Motion setting. Tweak durations here to change the feel.
 */
const EASE_OUT = Easing.out(Easing.cubic);

// Factories, not shared instances: Reanimated builders mutate themselves, so a
// `.delay()` on a shared object would leak into every other use of it.
export const Motion = {
  /** Things appearing: messages, photo thumbnail, buttons. Optional delay for staggering. */
  enter: (delayMs = 0) =>
    FadeIn.duration(200).delay(delayMs).easing(EASE_OUT).reduceMotion(ReduceMotion.System),
  /** Things leaving. Faster than entering so the UI never feels sluggish. */
  exit: () => FadeOut.duration(140).easing(EASE_OUT).reduceMotion(ReduceMotion.System),
  /** Icon swaps (send ⇄ stop, mic ⇄ stop). */
  swapIn: () => FadeIn.duration(120).easing(EASE_OUT).reduceMotion(ReduceMotion.System),
  swapOut: () => FadeOut.duration(100).easing(EASE_OUT).reduceMotion(ReduceMotion.System),
  /** Size or position changes (composer growing, sidebar rows reordering). */
  layout: () => LinearTransition.duration(200).easing(EASE_OUT).reduceMotion(ReduceMotion.System),
  /** Stagger between list items appearing together (quick actions). */
  staggerMs: 30,
} as const;

/** Press feedback: a small, critically damped scale — no overshoot. */
export const Press = {
  scale: 0.96,
  in: { duration: 100, dampingRatio: 1, reduceMotion: ReduceMotion.System },
  out: { duration: 180, dampingRatio: 1, reduceMotion: ReduceMotion.System },
} as const;
