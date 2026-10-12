import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatView, type PendingPrompt } from '@/components/chat/chat-view';
import { HeaderActions, ModelPill } from '@/components/chat/header-actions';
import { Sidebar } from '@/components/chat/sidebar';
import { SideDrawer } from '@/components/side-drawer';
import { CircleButton } from '@/components/ui/circle-button';
import { Motion } from '@/constants/motion';
import { Spacing } from '@/constants/theme';
import { CHAT_MODELS, type ChatModel } from '@/lib/chat-models';
import { newConversationId, useConversations, type Conversation } from '@/lib/conversations';
import { useSettings } from '@/lib/settings';
import { useBenchMode } from '@/bench/bench-mode';

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const drawerWidth = Math.round(width * 0.8);

  const { conversations, save, remove, rename, togglePin } = useConversations();
  const { settings, loaded, update } = useSettings();
  // The benchmark screen needs the chat's model out of memory.
  const benchMode = useBenchMode();
  // A fresh id up front, so the chat view isn't remounted when the first message is saved.
  const [activeId, setActiveId] = useState(newConversationId);
  const [initialMessages, setInitialMessages] = useState<Conversation['messages']>([]);

  // The model chosen in the picker or Settings. It's adopted together with the
  // current chat's messages, so switching model keeps the conversation.
  // Adjusted during render (not in an effect) so the new model and the replayed
  // messages reach ChatView in the same render: https://react.dev/learn/you-might-not-need-an-effect
  const [loadedModelId, setLoadedModelId] = useState<string>();
  if (loaded && settings.modelId !== loadedModelId) {
    const current = conversations.find((c) => c.id === activeId);
    setInitialMessages(current?.messages ?? []);
    setLoadedModelId(settings.modelId);
  }
  const model: ChatModel = CHAT_MODELS.find((m) => m.id === loadedModelId) ?? CHAT_MODELS[0]!;

  // If the active chat is deleted elsewhere (e.g. "Delete all chats"), start fresh.
  const activeWasSaved = useRef(false);
  useEffect(() => {
    const saved = conversations.some((c) => c.id === activeId);
    if (activeWasSaved.current && !saved) {
      setActiveId(newConversationId());
      setInitialMessages([]);
    }
    activeWasSaved.current = saved;
  }, [conversations, activeId]);

  // Header floats over the messages; the list pads its top by this much.
  const headerHeight = insets.top + Spacing.two + HEADER_ROW + Spacing.two;

  const [drawerOpen, setDrawerOpen] = useState(false);
  const openDrawer = () => {
    Keyboard.dismiss();
    setDrawerOpen(true);
  };
  const closeDrawer = () => setDrawerOpen(false);

  const openConversation = (id: string, messages: Conversation['messages']) => {
    setActiveId(id);
    setInitialMessages(messages);
    closeDrawer();
  };

  const selectModel = (modelId: string) => update({ modelId });

  const deleteConversation = (id: string) => {
    remove(id);
    if (id === activeId) openConversation(newConversationId(), []);
  };

  // Edit / Regenerate restart the chat from an earlier point (the model's history
  // only grows). `rewinds` forces a fresh ChatView even for the same chat + model,
  // and the pending prompt is tied to that exact session so it's used only once.
  const [rewinds, setRewinds] = useState(0);
  const [pending, setPending] = useState<{ key: string; prompt: PendingPrompt } | null>(null);
  const sessionKey = `${activeId}:${model.id}:${rewinds}`;

  const rewind = (before: Conversation['messages'], prompt: PendingPrompt) => {
    let id = activeId;
    if (before.length) {
      save(activeId, before);
    } else {
      // Nothing left to keep: drop the saved chat and continue under a new id.
      remove(activeId);
      id = newConversationId();
      activeWasSaved.current = false;
      setActiveId(id);
    }
    setInitialMessages(before);
    setRewinds((n) => n + 1);
    setPending({ key: `${id}:${model.id}:${rewinds + 1}`, prompt });
  };

  const activeIsSaved = conversations.some((c) => c.id === activeId);
  // New chat / ⋯ only make sense once the current chat has something in it.
  const [hasMessages, setHasMessages] = useState(false);

  return (
    <SideDrawer
      open={drawerOpen}
      onOpenChange={setDrawerOpen}
      drawerWidth={drawerWidth}
      drawer={
        <Sidebar
          width={drawerWidth}
          conversations={conversations}
          activeId={activeId}
          onSelect={(c) => (c.id === activeId ? closeDrawer() : openConversation(c.id, c.messages))}
          onDelete={deleteConversation}
          onRename={rename}
          onTogglePin={togglePin}
          onNewChat={() => openConversation(newConversationId(), [])}
          onOpenSettings={() => router.push('/settings')}
        />
      }>
      <KeyboardAvoidingView behavior="padding" style={styles.root}>
        {loadedModelId && !benchMode && (
          <ChatView
            key={sessionKey}
            model={model}
            conversationId={activeId}
            initialMessages={initialMessages}
            onMessagesChange={(messages) => save(activeId, messages)}
            onRewind={rewind}
            onHasMessagesChange={setHasMessages}
            onRequestModel={selectModel}
            initialPrompt={pending?.key === sessionKey ? pending.prompt : undefined}
            topInset={headerHeight}
          />
        )}

        {/* Floats over the chat, which scrolls (and fades) underneath it. */}
        <View style={[styles.header, { paddingTop: insets.top + Spacing.two }]}>
          <CircleButton icon="menu" onPress={openDrawer} accessibilityLabel="Open sidebar" />
          {hasMessages && (
            <Animated.View entering={Motion.enter()} exiting={Motion.exit()}>
              <HeaderActions
                modelId={model.id}
                onSelectModel={selectModel}
                onNewChat={() => openConversation(newConversationId(), [])}
                onOpenSettings={() => router.push('/settings')}
                onDeleteChat={activeIsSaved ? () => deleteConversation(activeId) : undefined}
              />
            </Animated.View>
          )}
          {!hasMessages && (
            <Animated.View entering={Motion.enter()} exiting={Motion.exit()}>
              <ModelPill modelId={model.id} onSelectModel={selectModel} />
            </Animated.View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SideDrawer>
  );
}

const HEADER_ROW = 44;

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: HEADER_ROW,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
});
