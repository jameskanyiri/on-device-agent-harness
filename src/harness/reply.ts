import type { LLMChatTurnResult } from 'react-native-executorch';

import { stripMarkup, visibleReplyText } from '@/harness/gemma-tool-parser';

/**
 * A turn's final text: its last assistant message (tool calls and results are
 * earlier messages). Falls back to the streamed text. If the model said
 * nothing after using tools (small models sometimes just end the turn), the
 * reply reports what the tools did instead of showing an empty message.
 */
export function finalReplyText(turn: Pick<LLMChatTurnResult, 'messages' | 'finishReason'>, streamed: string): string {
  if (turn.finishReason === 'maxToolTurns') {
    return 'I stopped after too many file operations. Try asking in smaller steps.';
  }
  const last = turn.messages.findLast((m) => m.role === 'assistant');
  const content = last?.content;
  const text = (typeof content === 'string' ? visibleReplyText(content) : visibleReplyText(streamed)).trim();
  if (text) return text;
  const results = turn.messages.filter((m) => m.role === 'tool').map((m) => (typeof m.content === 'string' ? m.content.trim() : ''));
  const fromTools = results.filter(Boolean).join('\n');
  if (fromTools) return fromTools;
  // Only a tool call that couldn't be read (nothing ran): show what the model wrote, so
  // it's visible in the chat and the eval instead of an empty reply.
  const raw = stripMarkup(typeof content === 'string' ? content : streamed).trim();
  return raw ? `(A tool call I couldn't run) ${raw}` : text;
}
