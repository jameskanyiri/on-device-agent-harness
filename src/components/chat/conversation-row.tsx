import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Conversation } from '@/lib/conversations';
import { tapLight } from '@/lib/haptics';

export type RowAction = 'pin' | 'rename' | 'delete';

type ConversationRowProps = {
  conversation: Conversation;
  active: boolean;
  onPress: (conversation: Conversation) => void;
  onAction: (action: RowAction, conversation: Conversation) => void;
};

const ACTION_WIDTH = 68;

/** A sidebar chat row; swipe left for Pin, Rename and Delete (like Mail). */
export const ConversationRow = memo(function ConversationRow({
  conversation,
  active,
  onPress,
  onAction,
}: ConversationRowProps) {
  const theme = useTheme();

  const renderActions = (_p: unknown, _t: unknown, swipeable: SwipeableMethods) => {
    const run = (action: RowAction) => () => {
      tapLight();
      swipeable.close();
      onAction(action, conversation);
    };
    const button = (action: RowAction, icon: IconName, label: string, color: string) => (
      <Pressable
        key={action}
        onPress={run(action)}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[styles.action, { backgroundColor: color }]}>
        <Icon name={icon} size={22} color="#ffffff" />
      </Pressable>
    );
    return (
      <View style={styles.actions}>
        {button(
          'pin',
          conversation.pinned ? 'unpin' : 'pin',
          conversation.pinned ? 'Unpin' : 'Pin',
          theme.accent
        )}
        {button('rename', 'rename', 'Rename', '#8E8E93')}
        {button('delete', 'trash', 'Delete', theme.destructive)}
      </View>
    );
  };

  return (
    <ReanimatedSwipeable
      renderRightActions={renderActions}
      friction={1.5}
      rightThreshold={40}
      overshootRight={false}
      containerStyle={styles.swipeable}>
      <Pressable
        onPress={() => onPress(conversation)}
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: active ? theme.backgroundElement : theme.background },
          pressed && styles.pressed,
        ]}>
        {conversation.pinned && <Icon name="pinned" size={13} color={theme.textSecondary} />}
        <ThemedText numberOfLines={1} style={styles.title}>
          {conversation.title}
        </ThemedText>
      </Pressable>
    </ReanimatedSwipeable>
  );
});

const styles = StyleSheet.create({
  swipeable: {
    borderRadius: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
    borderRadius: 14,
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: 400,
  },
  actions: {
    flexDirection: 'row',
  },
  action: {
    width: ACTION_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
