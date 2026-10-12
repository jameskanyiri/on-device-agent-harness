import type { llm } from 'react-native-executorch';

/*
 * Gemma 4 doesn't emit JSON tool calls. Its chat template (tokenizer_config.json)
 * renders a call as
 *
 *   <|tool_call>call:read_file{file_path:<|"|>/notes.md<|"|>,limit:50}<tool_call|>
 *
 * Keys are bare, strings are wrapped in the `<|"|>` escape token, and numbers,
 * booleans, objects and arrays are written as-is. After its calls the model
 * opens `<|tool_response>` to wait for the results, so generation is stopped
 * there (see GEMMA_TOOL_STOP). react-native-executorch ships no parser, so this
 * is ours.
 */

const CALL_START = '<|tool_call>';
const CALL_END = '<tool_call|>';
const RESPONSE_START = '<|tool_response>';
const STRING_DELIM = '<|"|>';

/**
 * Stops generation once the model hands over to the tool results, or emits
 * `<eos>`: after a tool result Gemma sometimes ends with `<eos>`, which the
 * tokenizer config doesn't list as a stop token (it lists `<turn|>`).
 */
export const GEMMA_TOOL_STOP = /<\|tool_response>|<eos>/;

/** Special tokens that can leak into the text and should never be shown. */
const LEAKED_TOKENS = /<eos>|<turn\|>|<\|turn>|<bos>/g;

// `call:name{`, either right after the call token or (if special tokens were
// decoded away) at the start of a line.
const CALL_RE = /(<\|tool_call>|^|\n)\s*call:([A-Za-z_][\w.-]*)\s*\{/g;

let nextId = 0;

/** Parses Gemma 4 tool calls out of a generated reply. */
export function parseGemmaToolCalls(text: string): llm.ToolParserResult | undefined {
  const toolCalls: llm.ToolCall[] = [];
  const kept: string[] = [];
  let cursor = 0;

  CALL_RE.lastIndex = 0;
  for (let match = CALL_RE.exec(text); match; match = CALL_RE.exec(text)) {
    const braceAt = match.index + match[0].length - 1;
    let parsed: { value: unknown; end: number };
    try {
      parsed = parseValue(text, braceAt);
    } catch {
      continue; // Not a well-formed call; leave it as text.
    }
    kept.push(text.slice(cursor, match.index + match[1]!.length));
    toolCalls.push({
      id: `call_${nextId++}`,
      type: 'function',
      function: { name: match[2]!, arguments: parsed.value as Record<string, unknown> },
    });
    cursor = parsed.end;
    if (text.startsWith(CALL_END, cursor)) cursor += CALL_END.length;
    CALL_RE.lastIndex = cursor;
  }

  if (toolCalls.length === 0) return undefined;
  kept.push(text.slice(cursor));
  const textContent = stripMarkup(kept.join('')).trim();
  return { toolCalls, textContent: textContent || undefined };
}

/**
 * The part of a streaming reply worth showing: text before any tool call, with
 * Gemma's tool markup removed.
 */
export function visibleReplyText(text: string): string {
  const callAt = text.indexOf(CALL_START);
  const head = callAt >= 0 ? text.slice(0, callAt) : text;
  // A bare `call:name{` line (special tokens decoded away) is hidden too.
  return stripMarkup(head.replace(/(^|\n)\s*call:[A-Za-z_][\w.-]*\s*\{[\s\S]*$/, '$1'));
}

function stripMarkup(text: string): string {
  return text.split(CALL_START).join('').split(CALL_END).join('').split(RESPONSE_START).join('').replace(LEAKED_TOKENS, '');
}

// --- A small recursive-descent parser for Gemma's argument syntax. ---

function skipSpace(s: string, i: number): number {
  while (i < s.length && /\s/.test(s[i]!)) i++;
  return i;
}

function parseValue(s: string, i: number): { value: unknown; end: number } {
  i = skipSpace(s, i);
  if (s.startsWith(STRING_DELIM, i)) {
    const close = s.indexOf(STRING_DELIM, i + STRING_DELIM.length);
    if (close < 0) throw new Error('unterminated string');
    return { value: s.slice(i + STRING_DELIM.length, close), end: close + STRING_DELIM.length };
  }
  const c = s[i];
  if (c === '"') return parseJsonString(s, i);
  if (c === '{') return parseObject(s, i);
  if (c === '[') return parseArray(s, i);
  // Bare scalar: runs to the next separator.
  let end = i;
  while (end < s.length && !',}]'.includes(s[end]!)) end++;
  const raw = s.slice(i, end).trim();
  if (!raw) throw new Error('missing value');
  return { value: scalar(raw), end };
}

function scalar(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
}

function parseJsonString(s: string, i: number): { value: string; end: number } {
  let j = i + 1;
  while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1;
  if (j >= s.length) throw new Error('unterminated string');
  return { value: JSON.parse(s.slice(i, j + 1)) as string, end: j + 1 };
}

function parseKey(s: string, i: number): { key: string; end: number } {
  i = skipSpace(s, i);
  if (s.startsWith(STRING_DELIM, i) || s[i] === '"') {
    const { value, end } = parseValue(s, i);
    return { key: String(value), end };
  }
  let end = i;
  while (end < s.length && s[end] !== ':' && s[end] !== '}') end++;
  const key = s.slice(i, end).trim();
  if (!key) throw new Error('missing key');
  return { key, end };
}

function parseObject(s: string, i: number): { value: Record<string, unknown>; end: number } {
  const obj: Record<string, unknown> = {};
  i = skipSpace(s, i + 1);
  if (s[i] === '}') return { value: obj, end: i + 1 };
  while (i < s.length) {
    const { key, end: keyEnd } = parseKey(s, i);
    i = skipSpace(s, keyEnd);
    if (s[i] !== ':') throw new Error('expected :');
    const { value, end } = parseValue(s, i + 1);
    obj[key] = value;
    i = skipSpace(s, end);
    if (s[i] === ',') i = skipSpace(s, i + 1);
    else if (s[i] === '}') return { value: obj, end: i + 1 };
    else throw new Error('expected , or }');
  }
  throw new Error('unterminated object');
}

function parseArray(s: string, i: number): { value: unknown[]; end: number } {
  const arr: unknown[] = [];
  i = skipSpace(s, i + 1);
  if (s[i] === ']') return { value: arr, end: i + 1 };
  while (i < s.length) {
    const { value, end } = parseValue(s, i);
    arr.push(value);
    i = skipSpace(s, end);
    if (s[i] === ',') i = skipSpace(s, i + 1);
    else if (s[i] === ']') return { value: arr, end: i + 1 };
    else throw new Error('expected , or ]');
  }
  throw new Error('unterminated array');
}
