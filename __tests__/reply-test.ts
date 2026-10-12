import type { llm } from 'react-native-executorch';

import { finalReplyText } from '@/harness/reply';

const turn = (messages: llm.ChatMessage[], finishReason: 'stop' | 'maxToolTurns' = 'stop') => ({ messages, finishReason });

describe('finalReplyText', () => {
  it('uses the last assistant message', () => {
    expect(finalReplyText(turn([{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hello!' }]), '')).toBe('Hello!');
  });

  it('reports what the tools did when the model ends silently after them', () => {
    const messages: llm.ChatMessage[] = [
      { role: 'user', content: 'save a poem' },
      { role: 'assistant', content: undefined, toolCalls: [{ id: 'c1', function: { name: 'write_file', arguments: {} } }] },
      { role: 'tool', toolCallId: 'c1', name: 'write_file', content: 'Created file /kenya_poem.txt' },
      { role: 'assistant', content: '<eos>\n<eos>' },
    ];
    expect(finalReplyText(turn(messages), '')).toBe('Created file /kenya_poem.txt');
  });

  it('explains when the tool budget ran out', () => {
    expect(finalReplyText(turn([], 'maxToolTurns'), '')).toMatch(/too many file operations/);
  });
});
