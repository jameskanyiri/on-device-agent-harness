import { StyleSheet } from 'react-native';

import { GlassSurface } from '@/components/ui/glass';
import { Icon, type IconName } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { useTheme } from '@/hooks/use-theme';

type CircleButtonProps = {
  icon: IconName;
  onPress: () => void;
  size?: number;
  accessibilityLabel?: string;
};

/** Round icon button on interactive Liquid Glass (☰, search, settings, scroll down). */
export function CircleButton({ icon, onPress, size = 44, accessibilityLabel }: CircleButtonProps) {
  const theme = useTheme();
  const shape = { width: size, height: size, borderRadius: size / 2 };

  return (
    <PressableScale
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}>
      <GlassSurface interactive style={[styles.fill, shape]}>
        <Icon name={icon} size={20} color={theme.text} weight="medium" />
      </GlassSurface>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  fill: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
