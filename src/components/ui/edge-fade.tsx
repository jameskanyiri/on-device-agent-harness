import MaskedView from '@react-native-masked-view/masked-view';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, useColorScheme, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

type EdgeFadeProps = {
  edge: 'top' | 'bottom';
  /** Height of the faded band, from the screen edge inwards. */
  height: number;
};

/** `#rrggbb` → `rgba(r,g,b,a)`. */
function withAlpha(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * ChatGPT-style scroll edge: content passing under the header or composer
 * blurs progressively (strongest at the edge) and fades into the background.
 * Purely visual: it never intercepts touches.
 */
export function EdgeFade({ edge, height }: EdgeFadeProps) {
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const bg = theme.background;
  // Gradients run from the screen edge (opaque) towards the content (clear).
  const start = edge === 'top' ? { x: 0, y: 0 } : { x: 0, y: 1 };
  const end = edge === 'top' ? { x: 0, y: 1 } : { x: 0, y: 0 };

  return (
    <View pointerEvents="none" style={[styles.band, { height, [edge]: 0 }]}>
      {/* Progressive blur: a full blur masked by a gradient, so it softens towards the content. */}
      <MaskedView
        style={StyleSheet.absoluteFill}
        maskElement={
          <LinearGradient
            colors={['#000', '#000', 'transparent']}
            locations={[0, 0.45, 1]}
            start={start}
            end={end}
            style={StyleSheet.absoluteFill}
          />
        }>
        <BlurView intensity={18} tint={dark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
      </MaskedView>
      {/* Then fade into the background colour on top of the blur. */}
      <LinearGradient
        colors={[withAlpha(bg, 0.9), withAlpha(bg, 0.55), withAlpha(bg, 0)]}
        locations={[0, 0.5, 1]}
        start={start}
        end={end}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
});
