jest.mock('@/observe/collector', () => ({ setActive: jest.fn(), submitTrace: jest.fn() }));
jest.mock('../modules/device-metrics', () => ({ __esModule: true, default: null }));

import { readingPerCall } from '@/observe/chat-tracing';

const stat = (promptTokens: number, generated: number, prefillMs: number | undefined, ttftMs: number) =>
  ({
    numPromptTokens: promptTokens,
    numGeneratedTokens: generated,
    prefillDurationMs: prefillMs,
    inferenceStartMs: 1000,
    firstTokenMs: 1000 + ttftMs,
    inferenceEndMs: 5000,
  }) as never;

describe('readingPerCall', () => {
  it('counts the separately prefilled user message on the first call', () => {
    // Context 1,138 → 1,300 over a turn that wrote 100 tokens: it read 62 (the generate call saw only 3).
    const r = readingPerCall([stat(3, 100, 400, 80)], 1138, 1300);
    expect(r.tokens).toBe(62);
    expect(r.calls[0]).toEqual({ tokens: 62, ms: 480 });
  });

  it('gives later calls the tool results they read inside generate', () => {
    const r = readingPerCall([stat(3, 20, 300, 80), stat(90, 40, 0, 500)], 1000, 1200);
    // 200 growth − 60 written = 140 read: 90 tool results on call 2, the rest on call 1.
    expect(r.tokens).toBe(140);
    expect(r.calls.map((c) => c.tokens)).toEqual([50, 90]);
    expect(r.ms).toBe(880);
  });

  it('leaves the first call unknown without context sizes', () => {
    expect(readingPerCall([stat(3, 10, 200, 80)]).calls[0]!.tokens).toBeNull();
  });
});
