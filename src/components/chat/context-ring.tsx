import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { Alert, StyleSheet } from 'react-native';

import { PressableScale } from '@/components/ui/pressable-scale';
import { useTheme } from '@/hooks/use-theme';
import { tapLight } from '@/lib/haptics';

export type ContextUsage = {
  /** Tokens currently in the model's KV cache (system prompt + history + this chat). */
  used: number;
  /** The model's context window, in tokens. */
  max: number;
};

const SIZE = 22;
const STROKE = 2.5;
const WARN_AT = 0.75;
const FULL_AT = 0.9;

/**
 * How full the model's context window is, as a small ring. Tap for numbers.
 * Small on-device models have short contexts, so this fills up fast in long chats.
 */
export function ContextRing({ used, max }: ContextUsage) {
  const theme = useTheme();
  const ratio = max > 0 ? Math.min(1, used / max) : 0;
  const color = ratio >= FULL_AT ? theme.destructive : ratio >= WARN_AT ? '#E8A33D' : theme.text;

  const arc = useMemo(() => {
    const inset = STROKE / 2;
    const path = Skia.Path.Make();
    // Start at 12 o'clock and sweep clockwise. A sliver stays visible once anything is used.
    path.addArc(
      { x: inset, y: inset, width: SIZE - STROKE, height: SIZE - STROKE },
      -90,
      Math.max(ratio * 360, used > 0 ? 6 : 0)
    );
    return path;
  }, [ratio, used]);

  const track = useMemo(() => {
    const path = Skia.Path.Make();
    path.addCircle(SIZE / 2, SIZE / 2, (SIZE - STROKE) / 2);
    return path;
  }, []);

  const percent = Math.round(ratio * 100);
  const explain = () => {
    tapLight();
    Alert.alert(
      `Context ${percent}% full`,
      `${used.toLocaleString()} of ${max.toLocaleString()} tokens used, ` +
        `${(max - used).toLocaleString()} left.\n\n` +
        'This is the model’s working memory for this chat: your settings, the messages so far, and its replies. ' +
        'When it fills up, replies can fail — start a new chat to begin fresh.'
    );
  };

  return (
    <PressableScale
      onPress={explain}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`Context ${percent} percent full`}
      style={styles.button}>
      <Canvas style={styles.canvas} pointerEvents="none">
        <Path path={track} color={theme.backgroundSelected} style="stroke" strokeWidth={STROKE} />
        <Path path={arc} color={color} style="stroke" strokeWidth={STROKE} strokeCap="round" />
      </Canvas>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  canvas: {
    width: SIZE,
    height: SIZE,
  },
});
