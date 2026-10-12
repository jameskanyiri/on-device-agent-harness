import { useCallback, useMemo, useState } from 'react';
import { Alert, SectionList, StyleSheet, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Wordmark } from '@/components/chat/brand';
import { ConversationRow, type RowAction } from '@/components/chat/conversation-row';
import { ThemedText } from '@/components/themed-text';
import { CircleButton } from '@/components/ui/circle-button';
import { GlassSurface } from '@/components/ui/glass';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Motion } from '@/constants/motion';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { sectionsFor } from '@/lib/conversation-sections';
import type { Conversation } from '@/lib/conversations';

type SidebarProps = {
  width: number;
  conversations: Conversation[];
  activeId: string;
  onSelect: (conversation: Conversation) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
};

export function Sidebar({
  width,
  conversations,
  activeId,
  onSelect,
  onDelete,
  onRename,
  onTogglePin,
  onNewChat,
  onOpenSettings,
}: SidebarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');

  // Lowercased once per change to the chat list, not on every keystroke.
  const searchIndex = useMemo(
    () =>
      conversations.map((c) => ({
        conversation: c,
        text: `${c.title}\n${c.messages.map((m) => m.text).join('\n')}`.toLowerCase(),
      })),
    [conversations]
  );
  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sectionsFor(conversations);
    const matches = searchIndex.filter((e) => e.text.includes(q)).map((e) => e.conversation);
    return matches.length ? [{ title: 'Results', data: matches }] : [];
  }, [conversations, searchIndex, query]);

  const onAction = useCallback(
    (action: RowAction, c: Conversation) => {
      if (action === 'pin') onTogglePin(c.id, !c.pinned);
      else if (action === 'rename')
        Alert.prompt(
          'Rename chat',
          undefined,
          (title) => onRename(c.id, title),
          'plain-text',
          c.title
        );
      else
        Alert.alert('Delete chat?', c.title, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => onDelete(c.id) },
        ]);
    },
    [onDelete, onRename, onTogglePin]
  );

  const toggleSearch = () => {
    setSearching((s) => !s);
    setQuery('');
  };

  return (
    <View
      style={[
        styles.container,
        {
          width,
          paddingTop: insets.top + Spacing.three,
          backgroundColor: theme.background,
        },
      ]}>
      <View style={styles.header}>
        <Wordmark />
        <CircleButton icon={searching ? 'close' : 'search'} onPress={toggleSearch} />
      </View>

      {searching ? (
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search chats"
          placeholderTextColor={theme.textSecondary}
          autoFocus
          style={[styles.search, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
      ) : null}

      <SectionList
        sections={sections}
        keyExtractor={(c) => c.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled
        ListEmptyComponent={
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            {query ? 'No chats match your search.' : 'Your chats will appear here.'}
          </ThemedText>
        }
        renderSectionHeader={({ section }) => (
          <ThemedText
            themeColor="textSecondary"
            style={[styles.sectionLabel, { backgroundColor: theme.background }]}>
            {section.title}
          </ThemedText>
        )}
        renderItem={({ item }) => (
          // Rows glide into place when chats are pinned, deleted or reordered.
          <Animated.View layout={Motion.layout()} exiting={Motion.exit()}>
            <ConversationRow
              conversation={item}
              active={item.id === activeId}
              onPress={onSelect}
              onAction={onAction}
            />
          </Animated.View>
        )}
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.two }]}>
        <PressableScale onPress={onNewChat} accessibilityRole="button">
          <GlassSurface
            interactive
            tintColor={theme.accent}
            style={[styles.newChatGlass, styles.newChat]}>
            <Icon name="newChat" size={20} color="#ffffff" weight="semibold" />
            <ThemedText style={styles.newChatLabel}>New Chat</ThemedText>
          </GlassSurface>
        </PressableScale>
        <CircleButton
          icon="settings"
          onPress={onOpenSettings}
          size={52}
          accessibilityLabel="Settings"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: Spacing.four,
    paddingRight: Spacing.three,
    paddingBottom: Spacing.three,
  },
  search: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    height: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: 22,
    fontSize: 17,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: 600,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.one,
  },
  list: {
    paddingHorizontal: Spacing.two,
    paddingBottom: Spacing.three,
  },
  empty: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  newChatGlass: {
    borderRadius: 26,
  },
  newChat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 52,
    paddingHorizontal: Spacing.four,
    borderRadius: 26,
  },
  newChatLabel: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 600,
  },
});
