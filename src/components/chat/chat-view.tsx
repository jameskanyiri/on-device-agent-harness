import * as Clipboard from 'expo-clipboard';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  Alert,
  Keyboard,
  TextInput,
  Share,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { FlatList } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useLLMChatSession, type llm } from 'react-native-executorch';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Composer } from '@/components/chat/composer';
import type { ContextUsage } from '@/components/chat/context-ring';
import type { DictationStatus } from '@/components/chat/dictation';
import { MessageItem, type Message, type MessageActionKind } from '@/components/chat/message-item';
import { QuickActions } from '@/components/chat/quick-actions';
import type { SpeakerStatus } from '@/components/chat/speaker';
import { StatusPill } from '@/components/chat/status-pill';
import { ThemedText } from '@/components/themed-text';
import { CircleButton } from '@/components/ui/circle-button';
import { EdgeFade } from '@/components/ui/edge-fade';
import { Motion } from '@/constants/motion';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { createFilesystemTools, FILESYSTEM_SYSTEM_PROMPT, type ToolActivity } from '@/harness/filesystem';
import { openFile } from '@/lib/open-file';
import { GEMMA_TOOL_STOP, parseGemmaToolCalls, visibleReplyText } from '@/harness/gemma-tool-parser';
import { finalReplyText } from '@/harness/reply';
import { traceChatTurn, traceModelLoad } from '@/observe/chat-tracing';
import { VISION_MODEL, type ChatModel } from '@/lib/chat-models';
import { tapLight } from '@/lib/haptics';
import { useVoice } from '@/lib/voice';
import { pickPhoto, type Attachment, type PhotoSource } from '@/lib/photos';
import { systemPromptFrom, useSettings } from '@/lib/settings';

type ChatViewProps = {
  model: ChatModel;
  /** The conversation this chat belongs to (groups its traces into a thread on the dashboard). */
  conversationId: string;
  /** Messages of the conversation being reopened (empty for a new chat). */
  initialMessages: Message[];
  /** Called when a turn finishes, with the full message list to persist. */
  onMessagesChange: (messages: Message[]) => void;
  /**
   * Edit / Regenerate: the model's history only grows, so the parent restarts the
   * chat from `before` and either re-sends `prompt.text` or puts it in the input.
   */
  onRewind: (before: Message[], prompt: PendingPrompt) => void;
  /** Set after a rewind: sent automatically once the model is ready, or prefilled. */
  initialPrompt?: PendingPrompt;
  /** Reports whether this chat has any messages (the header shows chat actions then). */
  onHasMessagesChange?: (hasMessages: boolean) => void;
  /** Asks the parent to switch model, e.g. to the vision model for photos. */
  onRequestModel: (id: string) => void;
  /** Height of the floating header; messages scroll underneath it. */
  topInset: number;
};

export type PendingPrompt = { text: string; send: boolean };

/**
 * Streamed tokens are buffered and committed to React at most this often.
 * Models emit 20–60+ tokens/s; rendering (and re-laying out native Markdown)
 * per token wastes the JS thread, while ~20 updates/s still reads as live.
 */
const FLUSH_INTERVAL_MS = 50;

/**
 * How much past conversation is replayed into the model when a chat is
 * reopened (~4 chars per token → ~1.5k tokens). Older turns stay visible on
 * screen but aren't prefilled: it keeps reopening fast and inside the context window.
 */
const REPLAY_CHAR_BUDGET = 6000;

/** Distance from the bottom (pt) within which new content keeps the list pinned. */
const STICK_TO_BOTTOM_THRESHOLD = 80;

function toChatHistory(messages: Message[], systemPrompt: string): llm.ChatMessage[] {
  const turns: llm.ChatMessage[] = [];
  let budget = REPLAY_CHAR_BUDGET;
  // Walk back from the newest message until the budget is spent.
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (!m.text) continue;
    budget -= m.text.length;
    if (budget < 0) break;
    turns.unshift({ role: m.role, content: m.text });
  }
  // A chat template expects history to start with the user, not a dangling reply.
  while (turns[0]?.role === 'assistant') turns.shift();
  return systemPrompt ? [{ role: 'system', content: systemPrompt }, ...turns] : turns;
}

/**
 * One loaded model session for one conversation. The parent remounts this
 * (via `key`) to switch conversation or model; the model is then reloaded from
 * the phone's storage and recent messages are prefilled into its context.
 */
export function ChatView({
  model,
  conversationId,
  initialMessages,
  onMessagesChange,
  onRewind,
  initialPrompt,
  onHasMessagesChange,
  onRequestModel,
  topInset,
}: ChatViewProps) {
  const theme = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const rowWidth = windowWidth - Spacing.four * 2;
  const insets = useSafeAreaInsets();
  const { settings } = useSettings();
  // Built once: the session is created at mount, so personalization changes
  // (and the File tools setting) apply to the next chat (or reopened chat),
  // like ChatGPT's custom instructions.
  const [toolsOn] = useState(() => !!model.tools && settings.fileTools);
  const [history] = useState(() =>
    toChatHistory(
      initialMessages,
      [systemPromptFrom(settings.personalization), toolsOn && FILESYSTEM_SYSTEM_PROMPT]
        .filter(Boolean)
        .join('\n\n')
    )
  );
  // Tool calls are reported to whichever reply is being generated (see `send`).
  const [fileTools] = useState(() => (toolsOn ? createFilesystemTools() : null));
  const [toolOpts] = useState(() =>
    fileTools
      ? { tools: fileTools.tools, parseToolCalls: parseGemmaToolCalls, maxToolTurns: 6 }
      : undefined
  );
  const session = useLLMChatSession(model.config, {
    // A write_file call carries the whole file, so tool chats get more room.
    generationConfig: { temperature: 0.2, maxNewTokens: toolOpts ? 1024 : 512 },
    initialMessages: history,
    toolOpts,
    stopRegex: toolOpts ? GEMMA_TOOL_STOP : undefined,
  });

  // Finished messages. The reply being streamed lives in `draftStore` (below), so the list's
  // data doesn't change per token and finished rows never re-render.
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [historyIds] = useState(() => new Set(initialMessages.map((m) => m.id)));
  // Id of the reply being generated (null when idle). Its text lives in `draftStore`,
  // outside React state, so streaming re-renders only the reply bubble — not this
  // screen, the list, or finished rows — keeping scrolling smooth mid-stream.
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftStore] = useState(createDraftStore);
  const [input, setInput] = useState(
    initialPrompt && !initialPrompt.send ? initialPrompt.text : ''
  );
  const [keyboardShown, setKeyboardShown] = useState(false);
  const isGenerating = draftId !== null;
  // How full the model's context window is. Read when the model is ready (a
  // reopened chat's history is already prefilled) and after each reply — not per token.
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const getKVCacheState = session.getKVCacheState;
  const refreshContextUsage = useCallback(() => {
    try {
      const state = getKVCacheState?.();
      if (state) setContextUsage({ used: state.pos, max: state.maxSeqLen });
    } catch {
      // Experimental API: if it throws, just don't show the ring.
    }
  }, [getKVCacheState]);
  // First reading once the model is ready, adjusted during render rather than in
  // an effect (https://react.dev/learn/you-might-not-need-an-effect).
  const [sawReady, setSawReady] = useState(false);
  if (session.isReady && !sawReady) {
    setSawReady(true);
    refreshContextUsage();
  }

  // Measured height of the floating footer (composer + quick actions); the list pads by it.
  const [footerHeight, setFooterHeight] = useState(96);

  // Photo attached to the next message (vision models only).
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const attach = async (source: PhotoSource) => {
    if (!model.vision) {
      Alert.alert(
        'Photos need a vision model',
        `${model.name} reads text only. Switch this chat to ${VISION_MODEL.name} (${VISION_MODEL.sizeLabel})?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Switch', onPress: () => onRequestModel(VISION_MODEL.id) },
        ]
      );
      return;
    }
    try {
      const photo = await pickPhoto(source);
      if (photo) setAttachment(photo);
    } catch (e) {
      Alert.alert('Couldn’t add photo', e instanceof Error ? e.message : String(e));
    }
  };

  // Voice models live in VoiceProvider so they stay loaded across chats.
  const voice = useVoice();
  const { listening, startListening, stopListening, speak, stopSpeaking } = voice;
  const textBeforeDictation = useRef('');
  const onTranscript = useCallback((spoken: string) => {
    setInput([textBeforeDictation.current, spoken].filter(Boolean).join(' '));
  }, []);
  const toggleMic = () => {
    if (listening) {
      stopListening();
      return;
    }
    textBeforeDictation.current = input.trim();
    startListening(onTranscript);
  };
  // Leaving this chat (switching chats, model or rewinding) ends its mic and read-aloud.
  useEffect(
    () => () => {
      stopListening();
      stopSpeaking();
    },
    [stopListening, stopSpeaking]
  );

  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', () => setKeyboardShown(true));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboardShown(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Log how long the model took to become ready (download excluded), and trace
  // the load when chat tracing is on.
  const loadStart = useRef(0);
  const loadTrace = useRef<ReturnType<typeof traceModelLoad> | null>(null);
  const traceChats = settings.liveMonitoring;
  useEffect(() => {
    if (session.downloadProgress >= 100 && !loadStart.current) {
      loadStart.current = Date.now();
      if (traceChats) {
        loadTrace.current = traceModelLoad({ modelId: model.id, modelName: model.name, fileTools: toolsOn, threadId: conversationId });
      }
    }
    if (session.isReady && loadStart.current > 0) {
      console.log(`[perf] ${model.name} ready in ${Date.now() - loadStart.current} ms`);
      loadStart.current = -1;
      let initTokens: number | null = null;
      try {
        initTokens = getKVCacheState?.().pos ?? null;
      } catch {
        // experimental API
      }
      loadTrace.current?.finish('ok', { initTokens });
      loadTrace.current = null;
    }
    if (session.error && loadTrace.current) {
      loadTrace.current.finish('error', { error: session.error.message });
      loadTrace.current = null;
    }
  }, [session.downloadProgress, session.isReady, session.error, model.id, model.name, traceChats, toolsOn, getKVCacheState, conversationId]);

  const hasMessages = messages.length > 0;
  useEffect(() => {
    onHasMessagesChange?.(hasMessages);
  }, [hasMessages, onHasMessagesChange]);

  // Persist once each turn has finished (not on every streamed token).
  const lastSaved = useRef(initialMessages);
  useEffect(() => {
    if (isGenerating || messages === lastSaved.current) return;
    lastSaved.current = messages;
    onMessagesChange(messages);
  }, [isGenerating, messages, onMessagesChange]);

  // --- Scrolling: follow new content only while the user is at the bottom. ---
  const listRef = useRef<FlatList<Message>>(null);
  const atBottom = useRef(true);
  // True while the user's finger (or a fling they started) is moving the list.
  // Auto-follow pauses then, so streaming never yanks the list out from under them.
  const userScrolling = useRef(false);
  // Set by ↓ and by sending: stay glued to the bottom until the user scrolls away,
  // even while an animated scroll is still travelling and content keeps growing.
  const pinned = useRef(false);
  const [showJump, setShowJump] = useState(false);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    atBottom.current =
      pinned.current ||
      contentOffset.y + layoutMeasurement.height >= contentSize.height - STICK_TO_BOTTOM_THRESHOLD;
    // Only re-render when the button's visibility actually flips.
    setShowJump((shown) => (shown === !atBottom.current ? shown : !atBottom.current));
  }, []);
  const onScrollBeginDrag = useCallback(() => {
    userScrolling.current = true;
    pinned.current = false;
  }, []);
  const onScrollEnd = useCallback(() => {
    userScrolling.current = false;
  }, []);
  // Scroll to the true end via the native ScrollView: it uses the real content size,
  // whereas FlatList.scrollToEnd uses cached row/footer heights that lag behind the
  // still-growing streaming reply (so it would stop short of the newest text).
  const scrollEnd = useCallback((animated: boolean) => {
    const native = listRef.current?.getNativeScrollRef() as
      { scrollToEnd?: (options: { animated: boolean }) => void } | null | undefined;
    if (native?.scrollToEnd) native.scrollToEnd({ animated });
    else listRef.current?.scrollToEnd({ animated });
  }, []);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(settleTimer.current), []);
  const scrollToBottom = (animated: boolean) => {
    pinned.current = true;
    atBottom.current = true;
    setShowJump(false);
    scrollEnd(animated);
    // Rows measured during the scroll (and streaming text) can move the end further
    // down; snap once more after the animation so it lands exactly at the bottom.
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      if (pinned.current) scrollEnd(false);
    }, 450);
  };
  const jumpToBottom = () => {
    tapLight();
    scrollToBottom(true);
  };
  const onContentSizeChange = useCallback(() => {
    // Non-animated: during streaming this fires ~20×/s and animations would pile up.
    if (atBottom.current && !userScrolling.current) {
      scrollEnd(false);
    }
  }, [scrollEnd]);

  const send = async (text = input) => {
    const photo = attachment;
    const prompt = text.trim() || (photo ? 'Describe this photo.' : '');
    if (!prompt || isGenerating || listening || !session.sendMessage) return;

    const reply: Message = { id: `${Date.now()}-a`, role: 'assistant', text: '' };
    setInput('');
    setAttachment(null);
    scrollToBottom(true); // sending always jumps to the newest message
    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-u`, role: 'user', text: prompt, imageUri: photo?.uri },
    ]);
    draftStore.set(EMPTY_DRAFT);
    setDraftId(reply.id);

    // Tokens accumulate here and are flushed on a timer (see FLUSH_INTERVAL_MS).
    let streamed = '';
    const tools: ToolActivity[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      flushTimer = undefined;
      // Only the StreamingReply bubble re-renders. Tool-call markup is hidden.
      draftStore.set({ text: visibleReplyText(streamed), tools: [...tools] });
    };
    const turnTrace = traceChats
      ? traceChatTurn({ modelId: model.id, modelName: model.name, fileTools: toolsOn, threadId: conversationId }, prompt)
      : null;
    // Each tool call ends one generation; the next one streams the follow-up.
    fileTools?.setActivityListener((activity) => {
      tools.push(activity);
      turnTrace?.tool(activity);
      streamed = '';
      flush();
      if (activity.name === 'open_file' && activity.ok && activity.path) openFile(activity.path);
    });

    let final: Message = reply;
    try {
      const content = photo ? [{ kind: 'image' as const, image: photo.buffer }, prompt] : prompt;
      // Context size before the message, and the real wait for the first word: executorch's
      // own time to first token leaves out reading the user's message (a separate prefill).
      let kvPosBefore: number | undefined;
      try {
        kvPosBefore = getKVCacheState?.().pos;
      } catch {
        // experimental API
      }
      const sentAt = Date.now();
      let firstTokenAt: number | undefined;
      const turn = await session.sendMessage(content, (token) => {
        firstTokenAt ??= Date.now();
        streamed += token;
        flushTimer ??= setTimeout(flush, FLUSH_INTERVAL_MS);
      });
      const stats = turn.stats.at(-1);
      const first = turn.stats[0];
      final = { ...reply, text: finalReplyText(turn, streamed), tools: tools.length ? tools : undefined };
      if (stats && first) {
        const seconds = (stats.inferenceEndMs - stats.firstTokenMs) / 1000;
        final = {
          ...final,
          tokensPerSec: seconds > 0 ? stats.numGeneratedTokens / seconds : undefined,
          firstTokenMs: firstTokenAt !== undefined ? firstTokenAt - sentAt : first.firstTokenMs - first.inferenceStartMs,
        };
      }
      let kvPos: number | undefined;
      try {
        kvPos = getKVCacheState?.().pos;
      } catch {
        // experimental API
      }
      turnTrace?.finish({ stats: turn.stats, finishReason: turn.finishReason, kvPos, kvPosBefore, firstTokenWallMs: firstTokenAt !== undefined ? firstTokenAt - sentAt : undefined, reply: final.text });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      turnTrace?.finish(null, reason);
      final = {
        ...reply,
        text: `${visibleReplyText(streamed)}\n\n⚠️ ${reason}`,
        tools: tools.length ? tools : undefined,
      };
    } finally {
      fileTools?.setActivityListener(null);
      if (flushTimer) clearTimeout(flushTimer);
      // Move the finished reply into the list in one update.
      setMessages((prev) => [...prev, final]);
      setDraftId(null);
      refreshContextUsage();
    }
  };

  // After Regenerate, send the prompt again as soon as the reloaded model is ready.
  const pendingSend = useRef(initialPrompt?.send ? initialPrompt.text : null);
  useEffect(() => {
    if (!session.isReady || pendingSend.current === null) return;
    const text = pendingSend.current;
    pendingSend.current = null;
    send(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.isReady]);

  // Long-press actions. Read the latest messages through a ref so the handler
  // stays stable and memoized rows don't re-render.
  const messagesRef = useRef(messages);
  const generatingRef = useRef(false);
  const inputRef = useRef<TextInput>(null);
  useLayoutEffect(() => {
    generatingRef.current = isGenerating;
  }, [isGenerating]);
  useLayoutEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const onAction = useCallback(
    (kind: MessageActionKind, message: Message, selectedText?: string) => {
      const all = messagesRef.current;
      // Rewinding mid-reply would fight the stream; those wait until it finishes.
      if (generatingRef.current && (kind === 'regenerate' || kind === 'edit')) return;
      switch (kind) {
        case 'copy':
          Clipboard.setStringAsync(message.text).then(tapLight);
          return;
        case 'share':
          Share.share({ message: message.text }).catch(() => {});
          return;
        case 'ask': {
          // Quote the selection into the composer, ChatGPT-style, and focus it.
          const quote = (selectedText ?? '')
            .trim()
            .split('\n')
            .map((line) => `> ${line}`)
            .join('\n');
          if (!quote) return;
          setInput((current) => `${quote}\n\n${current}`.trimEnd() + ' ');
          inputRef.current?.focus();
          return;
        }
        case 'speak':
          speak(message.text);
          return;
        case 'regenerate': {
          // Restart from just before the user turn that produced this reply.
          const userIndex = all.findLastIndex((m) => m.role === 'user');
          if (userIndex < 0) return;
          onRewind(all.slice(0, userIndex), { text: all[userIndex]!.text, send: true });
          return;
        }
        case 'edit': {
          const index = all.findIndex((m) => m.id === message.id);
          onRewind(all.slice(0, index), { text: message.text, send: false });
          return;
        }
      }
    },
    [onRewind, speak]
  );

  const lastId = messages.at(-1)?.id;
  const lastUserId = messages.findLast((m) => m.role === 'user')?.id;
  // Memoized so the list doesn't re-render every row when unrelated state changes.
  const renderItem = useCallback(
    ({ item }: { item: Message }) => {
      const row = (
        <MessageItem
          message={item}
          width={rowWidth}
          onAction={onAction}
          isLatest={item.id === lastId || item.id === lastUserId}
        />
      );
      // New messages fade in; a reopened chat's history appears without animation.
      return historyIds.has(item.id) ? (
        row
      ) : (
        <Animated.View entering={Motion.enter()}>{row}</Animated.View>
      );
    },
    [rowWidth, onAction, lastId, lastUserId, historyIds]
  );

  const downloading = session.downloadProgress < 100;
  const placeholder = session.isReady
    ? `Ask ${model.name}`
    : downloading
      ? `Downloading ${model.name} · ${Math.round(session.downloadProgress)}%`
      : `Loading ${model.name}…`;
  const isEmpty = messages.length === 0;

  const footerPaddingBottom = keyboardShown ? Spacing.two : insets.bottom + Spacing.one;

  return (
    <View style={styles.flex}>
      {isEmpty ? (
        <View style={[styles.emptyState, { paddingTop: topInset, paddingBottom: footerHeight }]}>
          {session.error ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
              Couldn&apos;t load the model{'\n'}
              {session.error.message}
            </ThemedText>
          ) : (
            !session.isReady && (
              <View style={styles.loading}>
                <ProgressBar
                  progress={session.downloadProgress}
                  track={theme.backgroundElement}
                  fill={theme.text}
                />
                <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
                  {downloading
                    ? 'Downloading the model once — keep the app open.'
                    : 'Loading the model into memory…'}
                </ThemedText>
              </View>
            )
          )}
        </View>
      ) : (
        <>
          {/* Fills the screen: messages scroll under the floating header and composer. */}
          <FlatList
            ref={listRef}
            style={StyleSheet.absoluteFill}
            data={messages}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            ListFooterComponent={
              draftId ? (
                <Animated.View entering={Motion.enter()}>
                  <StreamingReply id={draftId} store={draftStore} width={rowWidth} />
                </Animated.View>
              ) : null
            }
            contentContainerStyle={[
              styles.list,
              {
                paddingTop: topInset + Spacing.three,
                paddingBottom: footerHeight + Spacing.three,
              },
            ]}
            scrollIndicatorInsets={{ top: topInset, bottom: footerHeight }}
            onScroll={onScroll}
            scrollEventThrottle={32}
            onContentSizeChange={onContentSizeChange}
            onScrollBeginDrag={onScrollBeginDrag}
            onScrollEndDrag={onScrollEnd}
            onMomentumScrollEnd={onScrollEnd}
            keyboardDismissMode="interactive"
            // Each row is native rich text; keep fewer off-screen rows mounted.
            windowSize={9}
            initialNumToRender={8}
            maxToRenderPerBatch={6}
          />
          {/* ChatGPT-style edges: content blurs and fades as it slides under the bars. */}
          <EdgeFade edge="top" height={topInset + Spacing.five} />
          <EdgeFade edge="bottom" height={footerHeight + Spacing.five} />
        </>
      )}

      <View
        style={[styles.footer, { paddingBottom: footerPaddingBottom }]}
        onLayout={(e) => setFooterHeight(Math.round(e.nativeEvent.layout.height))}>
        {isEmpty && session.isReady && !attachment && <QuickActions onPick={send} />}
        <View style={styles.composer}>
          <Composer
            inputRef={inputRef}
            value={input}
            onChangeText={setInput}
            onSend={() => send()}
            onStop={session.stop}
            isGenerating={isGenerating}
            isReady={session.isReady}
            placeholder={placeholder}
            attachmentUri={attachment?.uri}
            onAttach={attach}
            onRemoveAttachment={() => setAttachment(null)}
            isListening={listening}
            onToggleMic={toggleMic}
            contextUsage={session.isReady ? contextUsage : null}
          />
        </View>
      </View>

      {/* Floats just above the composer, over the messages; takes no layout space.
        A sibling of the footer (not a child) so it's fully visible and tappable. */}
      <View style={[styles.floating, { bottom: footerHeight }]} pointerEvents="box-none">
        {showJump && !isEmpty && (
          <Animated.View entering={Motion.enter()} exiting={Motion.exit()}>
            <CircleButton
              icon="scrollDown"
              onPress={jumpToBottom}
              size={40}
              accessibilityLabel="Scroll to bottom"
            />
          </Animated.View>
        )}
        <StatusPill
          {...pillFor(
            listening ? voice.dictationStatus : null,
            voice.speechText ? voice.speakerStatus : null
          )}
          onStop={voice.speechText ? stopSpeaking : undefined}
        />
      </View>

    </View>
  );
}

const keyExtractor = (m: Message) => m.id;

/** The reply being generated: its visible text and the tool calls made so far. */
type Draft = { text: string; tools: ToolActivity[] };

const EMPTY_DRAFT: Draft = { text: '', tools: [] };

type DraftStore = {
  get: () => Draft;
  set: (draft: Draft) => void;
  subscribe: (l: () => void) => () => void;
};

/** A minimal external store for the streaming reply (see `draftStore`). */
function createDraftStore(): DraftStore {
  let draft = EMPTY_DRAFT;
  const listeners = new Set<() => void>();
  return {
    get: () => draft,
    set: (next) => {
      draft = next;
      listeners.forEach((l) => l());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The reply being generated: the only component that re-renders per streamed chunk. */
function StreamingReply({ id, store, width }: { id: string; store: DraftStore; width: number }) {
  const { text, tools } = useSyncExternalStore(store.subscribe, store.get);
  return (
    <MessageItem
      message={{ id, role: 'assistant', text, tools: tools.length ? tools : undefined }}
      streaming
      width={width}
    />
  );
}

/** Download bar that glides between progress updates instead of jumping. */
function ProgressBar({ progress, track, fill }: { progress: number; track: string; fill: string }) {
  const fillStyle = useAnimatedStyle(() => ({
    transform: [
      { scaleX: withTiming(Math.min(1, Math.max(0, progress / 100)), { duration: 300 }) },
    ],
  }));
  return (
    <View style={[styles.progressTrack, { backgroundColor: track }]}>
      <Animated.View style={[styles.progressFill, { backgroundColor: fill }, fillStyle]} />
    </View>
  );
}

/** What the status pill above the composer says (voice takes priority over read-aloud). */
function pillFor(
  voice: DictationStatus | null,
  speaker: SpeakerStatus | null
): { label: string | null; icon?: 'mic' | 'speaker' | 'warning' } {
  if (voice?.state === 'downloading')
    return { label: `Downloading voice input · ${voice.progress}%`, icon: 'mic' };
  if (voice?.state === 'loading') return { label: 'Loading voice input…', icon: 'mic' };
  if (voice?.state === 'error') return { label: voice.message, icon: 'warning' };
  if (speaker?.state === 'downloading')
    return { label: `Downloading voice · ${speaker.progress}%`, icon: 'speaker' };
  if (speaker?.state === 'loading') return { label: 'Loading voice…', icon: 'speaker' };
  if (speaker?.state === 'speaking') return { label: 'Reading aloud', icon: 'speaker' };
  if (speaker?.state === 'error') return { label: speaker.message, icon: 'warning' };
  return { label: null };
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: {
    width: '70%',
    alignItems: 'center',
    gap: Spacing.three,
  },
  centerText: {
    textAlign: 'center',
  },
  progressTrack: {
    width: '100%',
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    width: '100%',
    height: '100%',
    transformOrigin: 'left',
  },
  list: {
    gap: Spacing.four,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: Spacing.two,
    paddingTop: Spacing.two,
  },
  floating: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: Spacing.two,
    paddingBottom: Spacing.one,
  },
  composer: {
    paddingHorizontal: Spacing.three,
  },
});
