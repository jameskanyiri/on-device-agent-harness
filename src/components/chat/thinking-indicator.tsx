import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';

const SIZE = 14;

/**
 * A softly pulsing dot shown while the model reads the prompt (prefill), before
 * the first token arrives. Runs entirely on the UI thread.
 */
export function ThinkingIndicator() {
  const theme = useTheme();
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.set(
      withRepeat(
        withTiming(1, {
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          reduceMotion: ReduceMotion.System,
        }),
        -1,
        true
      )
    );
    return () => cancelAnimation(pulse);
  }, [pulse]);

  const dotStyle = useAnimatedStyle(() => ({
    opacity: 0.5 + pulse.get() * 0.4,
    transform: [{ scale: 0.9 + pulse.get() * 0.12 }],
  }));

  return (
    <View style={styles.row} accessibilityLabel="Thinking" accessibilityRole="progressbar">
      <Animated.View style={[styles.dot, { backgroundColor: theme.text }, dotStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    height: 25,
    justifyContent: 'center',
  },
  dot: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
  },
});
