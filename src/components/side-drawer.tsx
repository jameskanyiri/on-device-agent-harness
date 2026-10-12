import { useEffect, type ReactNode } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useTheme } from '@/hooks/use-theme';
import { tapLight } from '@/lib/haptics';

type SideDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  drawerWidth: number;
  drawer: ReactNode;
  children: ReactNode;
};

// Physics modelled on UIKit (WWDC18 "Designing Fluid Interfaces"):
// - critically damped spring (no bounce) that inherits the finger's velocity,
// - release target chosen from the *projected* resting point, not the drop point,
// - rubber-banding past the open position.
const SPRING = { dampingRatio: 1, duration: 420 } as const;
const DECELERATION_RATE = 0.998; // UIScrollView.DecelerationRate.normal
const RUBBER_BAND = 0.55;
const PARALLAX = 0.3; // sidebar moves at 70% of the content's speed
const CORNER_RADIUS = 44;
const DIM_OPACITY = 0.35;
const HAIRLINE = StyleSheet.hairlineWidth; // read once on JS; worklets get the number

// Runs on the JS thread. Worklets can't capture the `Keyboard` object itself,
// so gestures schedule this plain function instead.
const dismissKeyboard = () => Keyboard.dismiss();

/** Where a flick would come to rest, the way UIScrollView projects it. */
function project(velocity: number) {
  'worklet';
  return ((velocity / 1000) * DECELERATION_RATE) / (1 - DECELERATION_RATE);
}

/** Apple's rubber-band curve: resistance grows the further you pull. */
function rubberBand(overshoot: number, dimension: number) {
  'worklet';
  return (1 - 1 / ((overshoot * RUBBER_BAND) / dimension + 1)) * dimension;
}

/**
 * A ChatGPT-style drawer: the content slides right to reveal the sidebar beneath.
 * Drag anywhere horizontally to open/close, flick to throw it, tap the content to close.
 */
export function SideDrawer({ open, onOpenChange, drawerWidth, drawer, children }: SideDrawerProps) {
  const theme = useTheme();
  const x = useSharedValue(0); // content offset in px: 0 = closed, drawerWidth = open
  const start = useSharedValue(0);
  const target = useSharedValue(0); // where the drawer is settling to

  const settle = (to: number, velocity = 0) => {
    'worklet';
    target.set(to);
    x.set(withSpring(to, { ...SPRING, velocity }));
  };

  // Programmatic open/close (menu button, selecting a chat). Gesture-driven
  // changes have already set `target`, so they don't restart the spring.
  // Shared values use .get()/.set() (not .value) so React Compiler can reason about them.
  useEffect(() => {
    const to = open ? drawerWidth : 0;
    if (target.get() !== to) {
      tapLight();
      settle(to);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, drawerWidth]);

  const pan = Gesture.Pan()
    // Lock to horizontal drags so vertical scrolling in the chat still wins.
    .activeOffsetX([-12, 12])
    .failOffsetY([-12, 12])
    .onStart(() => {
      // Catch the drawer mid-flight: continue from wherever it is right now.
      cancelAnimation(x);
      start.set(x.get());
      scheduleOnRN(dismissKeyboard);
    })
    .onUpdate((e) => {
      const raw = start.get() + e.translationX;
      x.set(
        raw < 0
          ? 0
          : raw > drawerWidth
            ? drawerWidth + rubberBand(raw - drawerWidth, drawerWidth)
            : raw
      );
    })
    .onEnd((e) => {
      const resting = x.get() + project(e.velocityX);
      const willOpen = resting > drawerWidth / 2;
      // Tick when the drawer snaps to a new state, like a native sidebar.
      if ((willOpen ? drawerWidth : 0) !== target.get()) scheduleOnRN(tapLight);
      settle(willOpen ? drawerWidth : 0, e.velocityX);
      if (willOpen !== open) scheduleOnRN(onOpenChange, willOpen);
    });

  const closeTap = Gesture.Tap().onEnd(() => {
    scheduleOnRN(tapLight);
    settle(0);
    scheduleOnRN(onOpenChange, false);
  });

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() }],
    borderRadius: interpolate(x.get(), [0, drawerWidth], [0, CORNER_RADIUS], Extrapolation.CLAMP),
    borderWidth: x.get() > 0 ? HAIRLINE : 0,
  }));

  const drawerStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          x.get(),
          [0, drawerWidth],
          [-drawerWidth * PARALLAX, 0],
          Extrapolation.CLAMP
        ),
      },
    ],
  }));

  const dimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(x.get(), [0, drawerWidth], [0, DIM_OPACITY], Extrapolation.CLAMP),
  }));

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <Animated.View style={[styles.drawer, { width: drawerWidth }, drawerStyle]}>
        {drawer}
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View
          style={[
            styles.content,
            { backgroundColor: theme.background, borderColor: theme.backgroundSelected },
            contentStyle,
          ]}>
          {children}
          <GestureDetector gesture={closeTap}>
            <Animated.View
              pointerEvents={open ? 'auto' : 'none'}
              style={[StyleSheet.absoluteFill, styles.dim, dimStyle]}
            />
          </GestureDetector>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: 'hidden',
  },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
  },
  content: {
    flex: 1,
    overflow: 'hidden',
    borderCurve: 'continuous',
  },
  dim: {
    backgroundColor: '#000000',
  },
});
