import type { llm } from 'react-native-executorch';

import DeviceMetrics from '../../modules/device-metrics';
import type { ToolActivity } from '@/harness/filesystem';
import { setActive, submitTrace, traceDevice } from '@/observe/collector';
import { createTraceBuilder, type AttrValue, type TraceBuilder } from '@/observe/trace';

/*
 * Everyday chats, traced (Settings → Benchmark → Trace my chats): one trace per
 * reply, and one when a model loads. Each samples the device natively while it
 * runs, so the dashboard shows what a real conversation costs.
 */

const SAMPLE_MS = 500;

type ChatTraceContext = {
  modelId: string;
  modelName: string;
  fileTools: boolean;
  /** The conversation (a thread on the dashboard). */
  threadId: string;
};

/** How much of a message or reply a trace carries. */
const MAX_TEXT = 1000;
const clip = (text: string) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text);

/** Starts native sampling unless something else (a benchmark) already is. */
function startSampling(): boolean {
  if (!DeviceMetrics || DeviceMetrics.isSampling()) return false;
  DeviceMetrics.startSampling(SAMPLE_MS);
  return true;
}

export function traceModelLoad(ctx: ChatTraceContext) {
  const builder = createTraceBuilder('chat', `Load ${ctx.modelName}`, traceDevice(), {
    ...ctx,
    kind: 'load',
  });
  const root = builder.start(`Load ${ctx.modelName}`, 'run');
  const load = builder.start('load', 'load', root.id);
  const sampling = startSampling();
  setActive({ traceId: builder.trace.traceId, source: 'chat', name: builder.trace.name, span: { name: 'load', kind: 'load', start: Date.now() } });

  return {
    finish(status: 'ok' | 'error', attrs?: Record<string, AttrValue>) {
      load.end(status, attrs);
      root.end(status);
      if (sampling) builder.trace.samples = DeviceMetrics?.stopSampling() ?? [];
      setActive(null);
      submitTrace(builder.finish(status, attrs));
    },
  };
}

export function traceChatTurn(ctx: ChatTraceContext, prompt: string) {
  const name = `${ctx.modelName}: ${prompt.length > 48 ? `${prompt.slice(0, 48)}…` : prompt}`;
  const builder = createTraceBuilder('chat', name, traceDevice(), {
    ...ctx,
    kind: 'turn',
    promptChars: prompt.length,
    input: clip(prompt),
  });
  const root = builder.start(name, 'run');
  const turn = builder.start('turn', 'turn', root.id);
  const sampling = startSampling();
  const live = (spanName: string, kind: 'turn' | 'tool') =>
    setActive({ traceId: builder.trace.traceId, source: 'chat', name, span: { name: spanName, kind, start: Date.now() } });
  live('generating', 'turn');

  return {
    tool(a: ToolActivity) {
      addToolSpan(builder, turn.id, a);
      live('generating', 'turn');
    },
    finish(
      result: {
        stats: readonly llm.LLMGenerationStats[];
        finishReason?: string;
        kvPos?: number;
        kvPosBefore?: number;
        firstTokenWallMs?: number;
        reply: string;
      } | null,
      error?: string
    ) {
      const reading = readingPerCall(result?.stats ?? [], result?.kvPosBefore, result?.kvPos);
      for (const [i, s] of (result?.stats ?? []).entries()) addGenerationSpan(builder, turn.id, s, i, reading.calls[i]);
      const status = error ? 'error' : 'ok';
      const stats = result?.stats ?? [];
      const attrs: Record<string, AttrValue> = {
        modelCalls: stats.length,
        promptTokens: stats.reduce((a, s) => a + s.numPromptTokens, 0),
        generatedTokens: stats.reduce((a, s) => a + s.numGeneratedTokens, 0),
        finishReason: result?.finishReason ?? 'error',
        kvPos: result?.kvPos ?? null,
        kvPosBefore: result?.kvPosBefore ?? null,
        firstTokenWallMs: result?.firstTokenWallMs ?? null,
        readTokens: reading.tokens,
        readMs: reading.ms,
        replyChars: result?.reply.length ?? 0,
        output: result ? clip(result.reply) : null,
        error: error ?? null,
      };
      turn.end(status, attrs);
      root.end(status);
      if (sampling) builder.trace.samples = DeviceMetrics?.stopSampling() ?? [];
      setActive(null);
      submitTrace(builder.finish(status, attrs));
    },
  };
}

export function addToolSpan(builder: TraceBuilder, parentId: string, a: ToolActivity) {
  const start = a.startedAt ?? Date.now();
  builder.add({
    parentId,
    name: a.name,
    kind: 'tool',
    start,
    end: start + (a.durationMs ?? 0),
    status: a.ok ? 'ok' : 'error',
    attrs: {
      label: a.label,
      path: a.path ?? null,
      resultChars: a.resultChars ?? null,
      args: a.args ? JSON.stringify(a.args).slice(0, 300) : null,
    },
  });
}

/** executorch stamps generations with wall-clock ms, the same clock as Date.now(). */
/**
 * What the model read in a turn, and how long reading took. executorch's chat session reads the
 * user's message in a separate prefill (timed as prefillDurationMs) and then generates from just
 * the turn header, so numPromptTokens and the time to first token cover only that header on the
 * first call; later calls (after tools) read the tool results inside generate. Tokens read in the
 * turn = context growth minus what the model wrote; the first call gets what later calls didn't.
 */
export function readingPerCall(stats: readonly llm.LLMGenerationStats[], kvBefore?: number, kvAfter?: number) {
  const calls = stats.map((s) => ({
    tokens: s.numPromptTokens as number | null,
    ms: (s.prefillDurationMs ?? 0) + (s.firstTokenMs - s.inferenceStartMs),
  }));
  const written = stats.reduce((a, s) => a + s.numGeneratedTokens, 0);
  let tokens: number | null = null;
  if (kvBefore !== undefined && kvAfter !== undefined && kvAfter >= kvBefore) {
    tokens = Math.max(0, kvAfter - kvBefore - written);
    const later = calls.slice(1).reduce((a, c) => a + (c.tokens ?? 0), 0);
    if (calls[0]) calls[0].tokens = Math.max(0, tokens - later);
  } else if (calls[0]) {
    calls[0].tokens = null; // unknown: the separate prefill isn't counted anywhere else
  }
  return { tokens, ms: calls.reduce((a, c) => a + c.ms, 0), calls };
}

export function addGenerationSpan(builder: TraceBuilder, parentId: string, s: llm.LLMGenerationStats, index: number, read?: { tokens: number | null; ms: number }) {
  const decodeS = (s.inferenceEndMs - s.firstTokenMs) / 1000;
  builder.add({
    parentId,
    name: `generation ${index + 1}`,
    kind: 'generation',
    start: s.inferenceStartMs,
    end: s.inferenceEndMs,
    status: 'ok',
    attrs: {
      promptTokens: s.numPromptTokens,
      generatedTokens: s.numGeneratedTokens,
      ttftMs: s.firstTokenMs - s.inferenceStartMs,
      firstTokenAt: s.firstTokenMs,
      tokensPerSec: decodeS > 0 ? Math.round((s.numGeneratedTokens / decodeS) * 10) / 10 : null,
      prefillMs: s.prefillDurationMs ?? null,
      // Tokens this call read and how long reading took (see readingPerCall).
      readTokens: read ? read.tokens : s.numPromptTokens,
      readMs: read ? read.ms : (s.prefillDurationMs ?? 0) + (s.firstTokenMs - s.inferenceStartMs),
    },
  });
}
