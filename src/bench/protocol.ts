/*
 * What the Mac dashboard (on-device/dashboard, copied there as src/shared/protocol.ts) and the phone (src/bench/runner.ts)
 * exchange. Types only, so the Mac imports this file directly.
 *
 * Protocol (plain HTTP, the phone polls):
 *   GET  /job     → 200 Job | 200 { type: 'done' } | 204 (nothing yet)
 *   POST /log     ← { jobId, message }
 *   POST /result  ← RunResult
 */

import type { DeviceInfo, MetricSample } from '../../modules/device-metrics';

/**
 * Which harness pieces are switched on. Each new piece of the agent (memory,
 * compaction, verifier, …) adds a flag here, so a scenario can measure it
 * against the same model without it.
 */
export type HarnessConfig = {
  /** Filesystem tools (src/harness/filesystem.ts) and their system prompt. */
  fileTools: boolean;
  /** The todo planning tool (src/harness/planning.ts) and its system prompt. Step 2. */
  planning?: boolean;
  /** With fileTools, one bash tool (src/harness/bash.ts) instead of the seven file tools. Step 3a. */
  bash?: boolean;
};

export type Scenario = {
  id: string;
  label: string;
  harness: HarnessConfig;
  /** A system prompt this setup adds (before the task's own). The Mac merges it into the task. */
  systemPrompt?: string;
};

/** One task, run from a fresh session and a fresh workspace. */
export type TaskSpec = {
  id: string;
  /** Workspace files before the run: path → content. */
  files?: Record<string, string>;
  /** User messages, sent in order in one session. */
  turns: string[];
  /** Extra system prompt, before the harness's own. */
  systemPrompt?: string;
};

export type Job = {
  type: 'job';
  jobId: string;
  /** Groups the jobs of one `bench` invocation. */
  sessionId: string;
  modelId: string;
  scenario: Scenario;
  task: TaskSpec;
  rep: number;
  generation: { temperature: number; maxNewTokens: number };
  /** Native sampling period. */
  sampleIntervalMs: number;
  /** Idle sampling before the model loads, as each run's baseline. */
  idleMs: number;
  /**
   * Wait between runs: at least `settleMs`, then until thermal has been nominal for `stableMs`
   * (default 0: as soon as it's nominal), giving up after `maxWaitMs`. All zero = back to back.
   */
  cooldown: { settleMs: number; maxWaitMs: number; stableMs?: number };
  /** A turn running longer than this is stopped and the run recorded as timed out. */
  turnTimeoutMs?: number;
  /**
   * Before the measured session, load the model in a throwaway session and generate a few
   * tokens, so the first read after the app opens (weights paged in from flash) isn't
   * counted in turn 1. Recorded in `RunResult.warmup`.
   */
  warmup?: boolean;
  /**
   * Model calls allowed per user message with tools on, the final answer included (the
   * chat uses 6). Multi-step tasks need 5+, and a planning tool adds calls of its own.
   */
  maxToolTurns?: number;
};

export type JobResponse = Job | { type: 'done' };

/** Per-generation stats from react-native-executorch (one per model call in a turn). */
export type GenerationRecord = {
  promptTokens: number;
  generatedTokens: number;
  /** Prefill + first decode step. */
  ttftMs: number;
  /** First token → last token. */
  decodeMs: number;
  prefillMs?: number;
  inferenceStartMs: number;
  inferenceEndMs: number;
};

export type ToolRecord = {
  turn: number;
  name: string;
  ok: boolean;
  path?: string;
  args?: Record<string, unknown>;
  startedAt?: number;
  durationMs?: number;
  resultChars?: number;
};

export type TurnRecord = {
  index: number;
  prompt: string;
  /** Final visible reply. */
  reply: string;
  finishReason: 'stop' | 'maxToolTurns' | 'error' | 'timeout';
  startedAt: number;
  endedAt: number;
  /** Send → first streamed token (wall clock, includes harness work). */
  firstTokenWallMs?: number;
  generations: GenerationRecord[];
  /** KV cache position after the turn (context used). */
  kvPosAfter?: number;
  /** KV cache position before the turn: with kvPosAfter, gives the tokens the model read. */
  kvPosBefore?: number;
};

export type RunResult = {
  jobId: string;
  sessionId: string;
  modelId: string;
  scenarioId: string;
  taskId: string;
  rep: number;
  harness: HarnessConfig;
  device: DeviceInfo & {
    modelName: string | null;
    osName: string | null;
    osVersion: string | null;
    appVersion: string | null;
    /** Hardware model, e.g. `iPhone16,1` (an iPhone 15 Pro). */
    modelId?: string | null;
    /** Git commit the app was built from (EXPO_PUBLIC_GIT_COMMIT), so a result can be traced to its code. */
    appCommit?: string | null;
    /** Inference runtime and version, e.g. `react-native-executorch 0.10.4`. */
    runtime?: string | null;
  };
  /** The model file that ran (its name carries the export variant: backend and quantisation). */
  modelFile?: string | null;
  /** Generation settings used (greedy when temperature is 0). */
  generation?: Job['generation'];
  /** The phone just before the model loaded (after cool-down): thermal, battery, charging, brightness… */
  start?: MetricSample;
  ok: boolean;
  error?: string;
  startedAt: number;
  endedAt: number;
  cooldownMs: number;
  /** Phase boundaries (ms since epoch) for slicing the samples. */
  phases: { idleStart: number; warmupStart?: number; loadStart?: number; loadEnd?: number; turnsEnd?: number };
  /** The throwaway warm-up session (when `Job.warmup`): how cold the model was. */
  warmup?: {
    loadMs: number;
    /** Send → first token: mostly the one-off first-read cost when the model was cold. */
    firstTokenWallMs?: number;
    totalMs: number;
  };
  load?: {
    sessionCreateMs: number;
    /** Tokens in the KV cache before the first user message: system prompt + tool declarations. */
    initTokens: number;
    maxSeqLen: number;
  };
  turns: TurnRecord[];
  tools: ToolRecord[];
  /** Workspace after the run (path → content, truncated), for checks. */
  workspaceAfter: Record<string, string>;
  samples: MetricSample[];
};
