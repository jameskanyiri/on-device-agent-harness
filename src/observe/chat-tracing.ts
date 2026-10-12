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
      result: { stats: readonly llm.LLMGenerationStats[]; finishReason?: string; kvPos?: number; reply: string } | null,
      error?: string
    ) {
      for (const [i, s] of (result?.stats ?? []).entries()) addGenerationSpan(builder, turn.id, s, i);
      const status = error ? 'error' : 'ok';
      const stats = result?.stats ?? [];
      const attrs: Record<string, AttrValue> = {
        modelCalls: stats.length,
        promptTokens: stats.reduce((a, s) => a + s.numPromptTokens, 0),
        generatedTokens: stats.reduce((a, s) => a + s.numGeneratedTokens, 0),
        finishReason: result?.finishReason ?? 'error',
        kvPos: result?.kvPos ?? null,
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
export function addGenerationSpan(builder: TraceBuilder, parentId: string, s: llm.LLMGenerationStats, index: number) {
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
    },
  });
}
