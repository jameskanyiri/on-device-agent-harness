import { Pressable, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { GlassSurface } from '@/components/ui/glass';
import { Icon, type IconName } from '@/components/ui/icon';
import { Motion } from '@/constants/motion';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type StatusPillProps = {
  /** Nothing is rendered when null. */
  label: string | null;
  icon?: IconName;
  /** Shows a stop button (e.g. while reading aloud). */
  onStop?: () => void;
};

/** A small glass pill above the composer for voice/speech status. */
export function StatusPill({ label, icon, onStop }: StatusPillProps) {
  const theme = useTheme();
  if (!label) return null;

  return (
    <Animated.View entering={Motion.enter()} exiting={Motion.exit()} style={styles.wrapper}>
      <GlassSurface style={styles.pill}>
        {icon && <Icon name={icon} size={16} color={theme.text} />}
        <ThemedText type="smallBold" numberOfLines={1} style={styles.label}>
          {label}
        </ThemedText>
        {onStop && (
          <Pressable
            onPress={onStop}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Stop"
            style={[styles.stop, { backgroundColor: theme.text }]}>
            <Icon name="stop" size={11} color={theme.background} />
          </Pressable>
        )}
      </GlassSurface>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 36,
    borderRadius: 18,
    paddingHorizontal: Spacing.three,
    maxWidth: '90%',
  },
  label: {
    flexShrink: 1,
  },
  stop: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
