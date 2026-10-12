import { Image } from 'expo-image';
import { memo, useCallback, type ReactNode } from 'react';
import { ActionSheetIOS, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Markdown } from '@/components/chat/markdown';
import { ThinkingIndicator } from '@/components/chat/thinking-indicator';
import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Spacing } from '@/constants/theme';
import type { ToolActivity } from '@/harness/filesystem';
import { useTheme } from '@/hooks/use-theme';
import { tapLight } from '@/lib/haptics';
import { openFile } from '@/lib/open-file';

export type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Generation speed for assistant replies, in tokens/sec. */
  tokensPerSec?: number;
  /** Time from sending to the first generated token (prefill + first step), in ms. */
  firstTokenMs?: number;
  /** Photo sent with a user message (a local file in the app's Documents). */
  imageUri?: string;
  /** File operations the model made while writing this reply. */
  tools?: ToolActivity[];
};

function statsLine(m: Message): string | undefined {
  const parts = [
    m.firstTokenMs !== undefined && `${(m.firstTokenMs / 1000).toFixed(1)} s to first token`,
    m.tokensPerSec !== undefined && `${m.tokensPerSec.toFixed(1)} tokens/sec`,
  ].filter(Boolean);
  return parts.length ? `${parts.join(' · ')} · on-device` : undefined;
}

export type MessageActionKind = 'copy' | 'share' | 'speak' | 'regenerate' | 'edit' | 'ask';

type MessageItemProps = {
  message: Message;
  /** The reply currently being generated (no menu, thinking dot until text arrives). */
  streaming?: boolean;
  /** Action handler; finished messages only. Must be stable to keep rows memoized. */
  onAction?: (kind: MessageActionKind, message: Message, selectedText?: string) => void;
  /** Latest user/assistant message: can be edited or regenerated. */
  isLatest?: boolean;
  /** Width available to a row (user bubbles use up to 85% of it). */
  width: number;
};

type MessageAction = { label: string; onPress: () => void };

function actionsFor(
  message: Message,
  isLatest: boolean,
  onAction: NonNullable<MessageItemProps['onAction']>
): MessageAction[] {
  const run = (kind: MessageActionKind) => () => onAction(kind, message);
  const actions: MessageAction[] = [
    { label: 'Copy', onPress: run('copy') },
    { label: 'Share', onPress: run('share') },
  ];
  if (isLatest) {
    actions.push({ label: 'Edit', onPress: run('edit') });
  }
  return actions;
}

/** Native iOS action sheet with the message's actions. */
function showActions(actions: MessageAction[]) {
  tapLight();
  ActionSheetIOS.showActionSheetWithOptions(
    { options: [...actions.map((a) => a.label), 'Cancel'], cancelButtonIndex: actions.length },
    (index) => actions[index]?.onPress()
  );
}

/**
 * Long-press wrapper: a slight press-in, then the action sheet. Plain React
 * Native views (no SwiftUI hosting), so text height is always measured right.
 */
function LongPressable({
  actions,
  children,
  style,
}: {
  actions?: MessageAction[];
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  if (!actions) return <View style={style}>{children}</View>;
  return (
    <PressableScale
      onLongPress={() => showActions(actions)}
      delayLongPress={350}
      pressedScale={0.985}
      accessibilityHint="Long-press for actions"
      style={style}>
      {children}
    </PressableScale>
  );
}

/** Memoized: finished rows never change, so they skip re-rendering entirely. */
export const MessageItem = memo(function MessageItem({
  message,
  streaming = false,
  onAction,
  isLatest = false,
  width,
}: MessageItemProps) {
  const theme = useTheme();
  const actions =
    !streaming && onAction && message.role === 'user'
      ? actionsFor(message, isLatest, onAction)
      : undefined;
  const hasMenu = !!actions;

  if (message.role === 'user') {
    const bubble = (
      <View style={styles.userColumn}>
        {message.imageUri && (
          <Image source={{ uri: message.imageUri }} style={styles.photo} contentFit="cover" />
        )}
        {!!message.text && (
          <View
            style={[
              styles.userBubble,
              { maxWidth: width * 0.85, backgroundColor: theme.backgroundElement },
            ]}>
            <ThemedText selectable={!hasMenu} style={styles.text}>
              {message.text}
            </ThemedText>
          </View>
        )}
      </View>
    );
    return (
      <LongPressable actions={actions} style={styles.userAlign}>
        {bubble}
      </LongPressable>
    );
  }

  if (streaming && !message.text && !message.tools) return <ThinkingIndicator />;
  if (streaming) {
    return (
      <View style={styles.assistant}>
        {message.tools && <ToolSteps tools={message.tools} />}
        {message.text ? (
          <Markdown text={message.text} streaming selectable={false} />
        ) : (
          <ThinkingIndicator />
        )}
      </View>
    );
  }

  return <AssistantReply message={message} isLatest={isLatest} onAction={onAction} />;
});

/**
 * A finished reply: natively selectable Markdown (with "Ask On-Device" in the
 * selection menu) and a ChatGPT-style row of actions underneath.
 */
function AssistantReply({
  message,
  isLatest,
  onAction,
}: {
  message: Message;
  isLatest: boolean;
  onAction?: MessageItemProps['onAction'];
}) {
  const theme = useTheme();
  const onAsk = useCallback(
    (selected: string) => onAction?.('ask', message, selected),
    [onAction, message]
  );
  const stats = statsLine(message);

  const button = (kind: MessageActionKind, icon: IconName, label: string) => (
    <PressableScale
      key={kind}
      onPress={() => {
        tapLight();
        onAction?.(kind, message);
      }}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.actionButton}>
      <Icon name={icon} size={15} color={theme.textSecondary} />
    </PressableScale>
  );

  return (
    <View style={styles.assistant}>
      {message.tools && <ToolSteps tools={message.tools} />}
      <Markdown text={message.text} streaming={false} onAsk={onAction ? onAsk : undefined} />
      {onAction && (
        <View style={styles.actionRow}>
          {button('copy', 'copy', 'Copy')}
          {button('speak', 'speaker', 'Read aloud')}
          {button('share', 'share', 'Share')}
          {isLatest && button('regenerate', 'regenerate', 'Regenerate')}
          {stats && (
            <ThemedText
              type="small"
              themeColor="textSecondary"
              numberOfLines={1}
              style={styles.stats}>
              {stats}
            </ThemedText>
          )}
        </View>
      )}
    </View>
  );
}

/** The file operations behind a reply, e.g. "Read /notes.md", one per line. */
function ToolSteps({ tools }: { tools: ToolActivity[] }) {
  const theme = useTheme();
  return (
    <View style={styles.toolSteps}>
      {tools.map((t, i) => {
        const path = t.ok ? t.path : undefined;
        const row = (
          <>
            <Icon
              name={t.ok ? 'folder' : 'warning'}
              size={13}
              color={t.ok ? theme.textSecondary : theme.text}
            />
            <ThemedText
              type="small"
              themeColor={path ? 'accent' : 'textSecondary'}
              numberOfLines={1}
              style={styles.toolLabel}>
              {t.ok ? t.label : `${t.label} (failed)`}
            </ThemedText>
          </>
        );
        // A step that touched a file opens it.
        return path ? (
          <PressableScale
            key={i}
            onPress={() => {
              tapLight();
              openFile(path);
            }}
            accessibilityRole="button"
            accessibilityHint={`Opens ${path}`}
            style={styles.toolStep}>
            {row}
          </PressableScale>
        ) : (
          <View key={i} style={styles.toolStep}>
            {row}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  toolSteps: {
    gap: Spacing.one,
  },
  toolStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  toolLabel: {
    flexShrink: 1,
    fontSize: 13,
  },
  userAlign: {
    alignSelf: 'flex-end',
  },
  userColumn: {
    alignItems: 'flex-end',
    gap: Spacing.two,
  },
  photo: {
    width: 200,
    height: 200,
    borderRadius: 22,
  },
  userBubble: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + Spacing.half,
    borderRadius: 22,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
    marginLeft: -Spacing.one - Spacing.half,
  },
  actionButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stats: {
    flex: 1,
    marginLeft: Spacing.one,
    fontSize: 12,
  },
  assistant: {
    alignSelf: 'stretch',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  text: {
    fontSize: 17,
    lineHeight: 25,
    fontWeight: 400,
  },
});
