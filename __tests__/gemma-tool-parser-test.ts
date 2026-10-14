import { GEMMA_TOOL_STOP, parseGemmaToolCalls, visibleReplyText } from '@/harness/gemma-tool-parser';

const Q = '<|"|>';
const call = (body: string) => `<|tool_call>call:${body}<tool_call|>`;

describe('parseGemmaToolCalls', () => {
  it('returns nothing for a plain reply', () => {
    expect(parseGemmaToolCalls('Nairobi is the capital of Kenya.')).toBeUndefined();
  });

  it('parses a call with string and number arguments', () => {
    const result = parseGemmaToolCalls(`${call(`read_file{file_path:${Q}/notes.md${Q},limit:50}`)}<|tool_response>`);
    expect(result?.toolCalls).toHaveLength(1);
    expect(result?.toolCalls[0]!.function).toEqual({ name: 'read_file', arguments: { file_path: '/notes.md', limit: 50 } });
    expect(result?.textContent).toBeUndefined();
  });

  it('keeps text before the calls and parses several calls', () => {
    const result = parseGemmaToolCalls(`Let me check.${call(`ls{path:${Q}/${Q}}`)}${call(`glob{pattern:${Q}**/*.md${Q}}`)}`);
    expect(result?.textContent).toBe('Let me check.');
    expect(result?.toolCalls.map((c) => c.function.name)).toEqual(['ls', 'glob']);
  });

  it('keeps commas, braces and newlines inside string values', () => {
    const content = 'a, b}\n{c: d}';
    const result = parseGemmaToolCalls(call(`write_file{content:${Q}${content}${Q},file_path:${Q}/x.md${Q}}`));
    expect(result?.toolCalls[0]!.function.arguments).toEqual({ content, file_path: '/x.md' });
  });

  it('recovers a string whose opening delimiter was dropped', () => {
    // Seen on the phone, 14 Oct: the delimiter ended up inside the glob pattern.
    const result = parseGemmaToolCalls(call(`glob{pattern:/**/drafts/*.txt${Q}}`));
    expect(result?.toolCalls[0]!.function.arguments).toEqual({ pattern: '/**/drafts/*.txt' });
    const two = parseGemmaToolCalls(call(`read_file{file_path:/todo.md${Q},limit:20}`));
    expect(two?.toolCalls[0]!.function.arguments).toEqual({ file_path: '/todo.md', limit: 20 });
  });

  it('parses booleans, arrays and nested objects', () => {
    const result = parseGemmaToolCalls(call(`edit_file{replace_all:true,tags:[${Q}a${Q},2],opts:{deep:false}}`));
    expect(result?.toolCalls[0]!.function.arguments).toEqual({ replace_all: true, tags: ['a', 2], opts: { deep: false } });
  });

  it('accepts JSON-style quotes when the escape token is decoded away', () => {
    const result = parseGemmaToolCalls('call:grep{pattern:"TODO",output_mode:"content"}');
    expect(result?.toolCalls[0]!.function).toEqual({ name: 'grep', arguments: { pattern: 'TODO', output_mode: 'content' } });
  });

  it('ignores a call cut off mid-way', () => {
    expect(parseGemmaToolCalls(`<|tool_call>call:read_file{file_path:${Q}/x`)).toBeUndefined();
  });

  it('gives every call a unique id', () => {
    const a = parseGemmaToolCalls(call(`ls{path:${Q}/${Q}}`))!.toolCalls[0]!.id;
    const b = parseGemmaToolCalls(call(`ls{path:${Q}/${Q}}`))!.toolCalls[0]!.id;
    expect(a).not.toBe(b);
  });
});

describe('visibleReplyText', () => {
  it('hides tool-call markup while streaming', () => {
    expect(visibleReplyText(`Checking.<|tool_call>call:ls{path:${Q}/`)).toBe('Checking.');
    expect(visibleReplyText('call:ls{path:"/"')).toBe('');
    expect(visibleReplyText('Plain text')).toBe('Plain text');
  });
});

describe('GEMMA_TOOL_STOP', () => {
  it('stops when the model hands over to tool results or ends with <eos>', () => {
    expect(GEMMA_TOOL_STOP.test('…<tool_call|><|tool_response>')).toBe(true);
    expect(GEMMA_TOOL_STOP.test('<eos>')).toBe(true);
    expect(GEMMA_TOOL_STOP.test('a normal reply')).toBe(false);
  });
});

describe('leaked special tokens', () => {
  it('never shows <eos> or turn markers', () => {
    expect(visibleReplyText('<eos>\n<eos>').trim()).toBe('');
    expect(visibleReplyText('Saved it.<turn|>')).toBe('Saved it.');
  });
});

// Step 3b: worked examples in the prompt (`bash(command="ls /")`) bend Gemma's own call format.
describe('calls written like the prompt’s examples', () => {
  const args = (text: string) => parseGemmaToolCalls(text)?.toolCalls.map((c) => [c.function.name, c.function.arguments]);

  it('key="value" inside Gemma’s braces', () => {
    expect(args(`<|tool_call>call:bash{command="grep -ril 'dentist' /"}<tool_call|>`)).toEqual([['bash', { command: "grep -ril 'dentist' /" }]]);
    expect(args(`<|tool_call>call:bash{command: "ls -R /"}<tool_call|>`)).toEqual([['bash', { command: 'ls -R /' }]]);
  });

  it('round brackets after the call token, with or without call:', () => {
    expect(args(`<|tool_call>bash(command="cat /notes/health.md")<tool_call|>`)).toEqual([['bash', { command: 'cat /notes/health.md' }]]);
    expect(args(`<|tool_call>call:read_file(file_path="/todo.md")<tool_call|>`)).toEqual([['read_file', { file_path: '/todo.md' }]]);
    expect(args(`<|tool_call>todo(steps=[{step: "find it", done: false}])<tool_call|>`)).toEqual([['todo', { steps: [{ step: 'find it', done: false }] }]]);
  });

  it('keeps backslashes that aren’t valid JSON escapes (sed)', () => {
    expect(args(`<|tool_call>call:bash{command="sed -i 's/- \\[ \\] Book/- [x] Book/' /todo.md"}<tool_call|>`)).toEqual([
      ['bash', { command: "sed -i 's/- \\[ \\] Book/- [x] Book/' /todo.md" }],
    ]);
  });

  it('prose like name(...) is not a call', () => {
    expect(parseGemmaToolCalls('You can run bash(command="ls") yourself.')).toBeUndefined();
    expect(parseGemmaToolCalls('Use read_file(file_path) to read it.')).toBeUndefined();
  });
});
