/*
 * Traces: what the agent did (spans) next to what it cost the phone (metric
 * samples), on one wall clock. Benchmark runs and everyday chat turns both end
 * up in this shape, and the Mac dashboard (on-device/dashboard) draws it.
 *
 * No React Native imports: the Mac side imports this file's types.
 */

import type { MetricSample } from '../../modules/device-metrics';

export type SpanKind =
  | 'run' // one benchmark run, or one chat turn (the root)
  | 'cooldown'
  | 'idle'
  | 'load' // model load + system prompt / tool declarations prefill
  | 'turn' // one user message → final reply
  | 'generation' // one model call inside a turn
  | 'tool'; // one tool call

export type SpanStatus = 'ok' | 'error' | 'timeout';

export type AttrValue = string | number | boolean | null;

export type Span = {
  id: string;
  parentId?: string;
  name: string;
  kind: SpanKind;
  /** ms since epoch (Date.now, native samples and executorch stats share this clock). */
  start: number;
  end?: number;
  status?: SpanStatus;
  attrs?: Record<string, AttrValue>;
};

export type TraceDevice = {
  /** Stable per install. */
  id: string;
  name: string | null;
  platform: string;
  osVersion: string | null;
};

export type Trace = {
  traceId: string;
  source: 'bench' | 'chat';
  name: string;
  start: number;
  end?: number;
  status?: SpanStatus;
  device: TraceDevice;
  attrs?: Record<string, AttrValue>;
  spans: Span[];
  samples: MetricSample[];
};

/** Sent every few seconds while something is running, for the live view. */
export type LiveBeat = {
  device: TraceDevice;
  t: number;
  sample: MetricSample | null;
  /** What's running now, if anything. */
  active?: {
    traceId: string;
    source: Trace['source'];
    name: string;
    span?: { name: string; kind: SpanKind; start: number };
  };
};

const id = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export type SpanHandle = {
  id: string;
  end: (status?: SpanStatus, attrs?: Record<string, AttrValue>) => void;
};

/** Builds one trace. Spans nest by passing a parent's id. */
export function createTraceBuilder(
  source: Trace['source'],
  name: string,
  device: TraceDevice,
  attrs?: Record<string, AttrValue>
) {
  const trace: Trace = {
    traceId: id() + id(),
    source,
    name,
    start: Date.now(),
    device,
    attrs,
    spans: [],
    samples: [],
  };
  const open: Span[] = [];

  const builder = {
    trace,
    start(spanName: string, kind: SpanKind, parentId?: string, spanAttrs?: Record<string, AttrValue>): SpanHandle {
      const span: Span = { id: id(), parentId, name: spanName, kind, start: Date.now(), attrs: spanAttrs };
      trace.spans.push(span);
      open.push(span);
      return {
        id: span.id,
        end: (status = 'ok', more) => {
          span.end = Date.now();
          span.status = status;
          if (more) span.attrs = { ...span.attrs, ...more };
          const i = open.indexOf(span);
          if (i >= 0) open.splice(i, 1);
        },
      };
    },
    /** Records a span that already happened (e.g. from executorch's generation stats). */
    add(span: Omit<Span, 'id'>): string {
      const full = { ...span, id: id() };
      trace.spans.push(full);
      return full.id;
    },
    /** The innermost span still running (for the live view). */
    current(): Span | undefined {
      return open.at(-1);
    },
    finish(status: SpanStatus = 'ok', attrs?: Record<string, AttrValue>): Trace {
      const now = Date.now();
      for (const span of open) {
        span.end ??= now;
        span.status ??= status;
      }
      open.length = 0;
      trace.end = now;
      trace.status = status;
      if (attrs) trace.attrs = { ...trace.attrs, ...attrs };
      return trace;
    },
  };
  return builder;
}

export type TraceBuilder = ReturnType<typeof createTraceBuilder>;
