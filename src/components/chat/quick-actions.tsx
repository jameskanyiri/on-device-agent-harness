import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Motion } from '@/constants/motion';
import { Spacing } from '@/constants/theme';
import { tapSelection } from '@/lib/haptics';

type QuickAction = { icon: IconName; color: string; label: string; prompt: string };

const QUICK_ACTIONS: QuickAction[] = [
  {
    icon: 'sparkles',
    color: '#5B8DEF',
    label: 'What can you do offline?',
    prompt: 'You run entirely on my phone. What kinds of things can you help me with offline?',
  },
  {
    icon: 'lightBulb',
    color: '#F2C94C',
    label: 'Explain how on-device AI works',
    prompt: 'Explain how a large language model can run on a phone, in simple terms.',
  },
  {
    icon: 'calendar',
    color: '#EB5757',
    label: 'Plan my week',
    prompt: 'Help me plan a productive week. Ask me what I need to get done.',
  },
  {
    icon: 'write',
    color: '#27AE60',
    label: 'Write a short poem',
    prompt: 'Write a short, upbeat poem about building things.',
  },
];

/** Starter prompts listed above the composer in an empty chat. */
export function QuickActions({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <View style={styles.list}>
      {QUICK_ACTIONS.map((action, i) => (
        // Rows fade in one after another, a few frames apart.
        <Animated.View key={action.label} entering={Motion.enter(i * Motion.staggerMs)}>
          <PressableScale
            onPress={() => {
              tapSelection();
              onPick(action.prompt);
            }}
            style={styles.row}>
            <View style={styles.icon}>
              <Icon name={action.icon} size={22} color={action.color} />
            </View>
            <ThemedText themeColor="textSecondary" numberOfLines={1} style={styles.label}>
              {action.label}
            </ThemedText>
          </PressableScale>
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two + Spacing.one,
  },
  icon: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flex: 1,
    fontSize: 17,
    fontWeight: 400,
  },
});
