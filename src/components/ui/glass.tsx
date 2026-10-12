import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ReactNode } from 'react';
import { View, type ColorValue, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/**
 * Liquid Glass needs iOS 26+ and is off when "Reduce Transparency" is enabled;
 * surfaces fall back to solid theme colors there.
 */
export const LIQUID_GLASS = isLiquidGlassAvailable();

type GlassSurfaceProps = {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  /** Reacts to touch (shimmer and scale), like system glass buttons. */
  interactive?: boolean;
  /** Tints the glass, e.g. for a primary action. */
  tintColor?: ColorValue;
  /** Solid color used when Liquid Glass isn't available. */
  fallbackColor?: ColorValue;
};

/** A native UIGlassEffect background behind regular React Native children. */
export function GlassSurface({
  style,
  children,
  interactive = false,
  tintColor,
  fallbackColor,
}: GlassSurfaceProps) {
  const theme = useTheme();

  if (!LIQUID_GLASS) {
    return (
      <View
        style={[{ backgroundColor: fallbackColor ?? tintColor ?? theme.backgroundElement }, style]}>
        {children}
      </View>
    );
  }

  return (
    <GlassView
      glassEffectStyle="regular"
      isInteractive={interactive}
      tintColor={tintColor}
      style={style}>
      {children}
    </GlassView>
  );
}
