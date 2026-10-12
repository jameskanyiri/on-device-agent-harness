import type { LLMChatTurnResult } from 'react-native-executorch';

import { visibleReplyText } from '@/harness/gemma-tool-parser';

/**
 * A turn's final text: its last assistant message (tool calls and results are
 * earlier messages). Falls back to the streamed text.
 */
export function finalReplyText(turn: Pick<LLMChatTurnResult, 'messages' | 'finishReason'>, streamed: string): string {
  if (turn.finishReason === 'maxToolTurns') {
    return 'I stopped after too many file operations. Try asking in smaller steps.';
  }
  const last = turn.messages.findLast((m) => m.role === 'assistant');
  const content = last?.content;
  return typeof content === 'string' ? visibleReplyText(content).trim() : visibleReplyText(streamed);
}
