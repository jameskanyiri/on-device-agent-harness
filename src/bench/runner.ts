import Constants from 'expo-constants';
import * as Device from 'expo-device';
import RNBlobUtil from 'react-native-blob-util';
import {
  createLLMChatSession,
  download,
  type LLMChatSession,
  type llm,
} from 'react-native-executorch';

import DeviceMetrics from '../../modules/device-metrics';
import type { GenerationRecord, Job, RunResult, ToolRecord } from '@/bench/protocol';
import {
  createFilesystemTools,
  FILESYSTEM_SYSTEM_PROMPT,
  walk,
} from '@/harness/filesystem';
import { GEMMA_TOOL_STOP, parseGemmaToolCalls } from '@/harness/gemma-tool-parser';
import { finalReplyText } from '@/harness/reply';
import { CHAT_MODELS } from '@/lib/chat-models';
import { setActive } from '@/observe/collector';
import type { SpanKind } from '@/observe/trace';

/** Benchmarks get their own workspace, wiped before every run (never the user's files). */
export const BENCH_WORKSPACE_DIR = `${RNBlobUtil.fs.dirs.DocumentDir}/bench-workspace`;

const MAX_SNAPSHOT_FILES = 30;
const MAX_SNAPSHOT_CHARS = 4000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULT_TURN_TIMEOUT_MS = 240_000;
/** After stopping a timed-out turn, how long to wait for the model to let go. */
const STOP_GRACE_MS = 30_000;

class HungTurnError extends Error {}

/**
 * Runs one benchmark job on this phone: a fresh session of the model with the
 * scenario's harness, the task's messages in order, and native metric
 * sampling from an idle baseline to the end. Never throws: failures are
 * recorded in the result.
 */
export async function runJob(job: Job, log: (message: string) => void): Promise<RunResult> {
  const result: RunResult = {
    jobId: job.jobId,
    sessionId: job.sessionId,
    modelId: job.modelId,
    scenarioId: job.scenario.id,
    taskId: job.task.id,
    rep: job.rep,
    harness: job.scenario.harness,
    device: {
      ...(DeviceMetrics?.getDeviceInfo() ?? { platform: 'ios', cpuCount: 0, physicalMemoryBytes: 0 }),
      modelName: Device.modelName,
      osName: Device.osName,
      osVersion: Device.osVersion,
      appVersion: Constants.expoConfig?.version ?? null,
    },
    ok: false,
    startedAt: Date.now(),
    endedAt: 0,
    cooldownMs: 0,
    phases: { idleStart: 0 },
    turns: [],
    tools: [],
    workspaceAfter: {},
    samples: [],
  };

  let session: LLMChatSession | undefined;
  let sampling = false;
  // Tells the dashboard's live view what this run is doing right now.
  const phase = (name: string, kind: SpanKind) =>
    setActive({
      traceId: job.jobId,
      source: 'bench',
      name: `${job.scenario.label} · ${job.task.id} · rep ${job.rep}`,
      span: { name, kind, start: Date.now() },
    });
  try {
    phase('preparing', 'run');
    const model = CHAT_MODELS.find((m) => m.id === job.modelId);
    if (!model) throw new Error(`Unknown model '${job.modelId}'`);
    if (!DeviceMetrics) log('DeviceMetrics native module missing: rebuild the app to record device metrics');

    log(`Preparing ${model.name} files`);
    const config = await download(model.config);

    phase('cooldown', 'cooldown');
    result.cooldownMs = await coolDown(job, log);
    await resetWorkspace(job.task.files ?? {});

    // Idle baseline: what the phone costs with the app open but no model loaded.
    DeviceMetrics?.startSampling(job.sampleIntervalMs);
    sampling = true;
    result.phases.idleStart = Date.now();
    phase('idle baseline', 'idle');
    await sleep(job.idleMs);

    const { harness } = job.scenario;
    const fileTools = harness.fileTools
      ? createFilesystemTools({ root: BENCH_WORKSPACE_DIR })
      : null;
    let currentTurn = 0;
    fileTools?.setActivityListener((a) => {
      const record: ToolRecord = {
        turn: currentTurn,
        name: a.name,
        ok: a.ok,
        path: a.path,
        args: a.args,
        startedAt: a.startedAt,
        durationMs: a.durationMs,
        resultChars: a.resultChars,
      };
      result.tools.push(record);
      log(`  tool ${a.label}${a.ok ? '' : ' (failed)'}`);
      phase(`turn ${currentTurn + 1}`, 'turn');
    });

    const systemPrompt = [job.task.systemPrompt, fileTools && FILESYSTEM_SYSTEM_PROMPT]
      .filter(Boolean)
      .join('\n\n');
    const initialMessages: llm.ChatMessage[] = systemPrompt
      ? [{ role: 'system', content: systemPrompt }]
      : [];

    log(`Loading ${model.name} (${job.scenario.label})`);
    phase('load', 'load');
    result.phases.loadStart = Date.now();
    session = await createLLMChatSession(config, {
      generationConfig: job.generation,
      initialMessages,
      toolOpts: fileTools
        ? { tools: fileTools.tools, parseToolCalls: parseGemmaToolCalls, maxToolTurns: 6 }
        : undefined,
      stopRegex: fileTools ? GEMMA_TOOL_STOP : undefined,
    });
    result.phases.loadEnd = Date.now();
    const kv = session.getKVCacheState();
    result.load = {
      sessionCreateMs: result.phases.loadEnd - result.phases.loadStart,
      initTokens: kv.pos,
      maxSeqLen: kv.maxSeqLen,
    };

    for (const [index, prompt] of job.task.turns.entries()) {
      currentTurn = index;
      log(`Turn ${index + 1}/${job.task.turns.length}`);
      phase(`turn ${index + 1}`, 'turn');
      const startedAt = Date.now();
      let firstTokenAt: number | undefined;
      let streamed = '';
      // Watchdog: stop a turn that runs too long, and give up on one that won't stop.
      const timeoutMs = job.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
      let timedOut = false;
      const current = session;
      const stopTimer = setTimeout(() => {
        timedOut = true;
        log(`Turn ${index + 1} passed ${Math.round(timeoutMs / 1000)} s: stopping it`);
        current.stop();
      }, timeoutMs);
      let hungTimer: ReturnType<typeof setTimeout> | undefined;
      const hung = new Promise<never>((_, reject) => {
        hungTimer = setTimeout(() => reject(new HungTurnError('The model did not stop')), timeoutMs + STOP_GRACE_MS);
      });
      try {
        const turn = await Promise.race([
          current.sendMessage(prompt, (token) => {
            firstTokenAt ??= Date.now();
            streamed += token;
          }),
          hung,
        ]).finally(() => {
          clearTimeout(stopTimer);
          clearTimeout(hungTimer);
        });
        if (timedOut) {
          result.turns.push({
            index,
            prompt,
            reply: finalReplyText(turn, streamed),
            finishReason: 'timeout',
            startedAt,
            endedAt: Date.now(),
            firstTokenWallMs: firstTokenAt && firstTokenAt - startedAt,
            generations: turn.stats.map(toGenerationRecord),
            kvPosAfter: current.getKVCacheState().pos,
          });
          throw new Error(`Turn ${index + 1} timed out after ${Math.round(timeoutMs / 1000)} s`);
        }
        result.turns.push({
          index,
          prompt,
          reply: finalReplyText(turn, streamed),
          finishReason: turn.finishReason,
          startedAt,
          endedAt: Date.now(),
          firstTokenWallMs: firstTokenAt && firstTokenAt - startedAt,
          generations: turn.stats.map(toGenerationRecord),
          kvPosAfter: session.getKVCacheState().pos,
        });
      } catch (e) {
        if (e instanceof HungTurnError) {
          // Disposing a session that's still generating could crash the app; leave it.
          session = undefined;
          log('The model did not stop; restart the app before the next session');
        }
        if (timedOut && result.turns.at(-1)?.index === index) throw e;
        result.turns.push({
          index,
          prompt,
          reply: streamed,
          finishReason: timedOut ? 'timeout' : 'error',
          startedAt,
          endedAt: Date.now(),
          firstTokenWallMs: firstTokenAt && firstTokenAt - startedAt,
          generations: [],
        });
        throw e;
      }
    }
    result.phases.turnsEnd = Date.now();
    result.ok = true;
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    log(`Failed: ${result.error}`);
  } finally {
    setActive(null);
    session?.dispose();
    if (sampling) result.samples = DeviceMetrics?.stopSampling() ?? [];
    result.workspaceAfter = await snapshotWorkspace().catch(() => ({}));
    result.endedAt = Date.now();
  }
  return result;
}

function toGenerationRecord(s: llm.LLMGenerationStats): GenerationRecord {
  return {
    promptTokens: s.numPromptTokens,
    generatedTokens: s.numGeneratedTokens,
    ttftMs: s.firstTokenMs - s.inferenceStartMs,
    decodeMs: s.inferenceEndMs - s.firstTokenMs,
    prefillMs: s.prefillDurationMs,
    inferenceStartMs: s.inferenceStartMs,
    inferenceEndMs: s.inferenceEndMs,
  };
}

/** Waits `settleMs`, then until the phone is back to nominal thermal state (or `maxWaitMs`). */
async function coolDown(job: Job, log: (message: string) => void): Promise<number> {
  const start = Date.now();
  await sleep(job.cooldown.settleMs);
  for (;;) {
    const thermal = DeviceMetrics?.getSnapshot().thermal;
    if (!thermal || thermal === 'nominal' || Date.now() - start >= job.cooldown.maxWaitMs) break;
    log(`Cooling down (thermal: ${thermal})`);
    await sleep(5000);
  }
  return Date.now() - start;
}

async function resetWorkspace(files: Record<string, string>): Promise<void> {
  const fs = RNBlobUtil.fs;
  if (await fs.exists(BENCH_WORKSPACE_DIR)) await fs.unlink(BENCH_WORKSPACE_DIR);
  await fs.mkdir(BENCH_WORKSPACE_DIR);
  for (const [path, content] of Object.entries(files)) {
    const disk = BENCH_WORKSPACE_DIR + (path.startsWith('/') ? path : `/${path}`);
    const dir = disk.slice(0, disk.lastIndexOf('/'));
    // Create each missing parent folder.
    const missing: string[] = [];
    for (let d = dir; d.length > BENCH_WORKSPACE_DIR.length && !(await fs.exists(d)); ) {
      missing.unshift(d);
      d = d.slice(0, d.lastIndexOf('/'));
    }
    for (const d of missing) await fs.mkdir(d);
    await fs.writeFile(disk, content, 'utf8');
  }
}

async function snapshotWorkspace(): Promise<Record<string, string>> {
  const files = (await walk(BENCH_WORKSPACE_DIR, '/')).slice(0, MAX_SNAPSHOT_FILES);
  const snapshot: Record<string, string> = {};
  for (const file of files) {
    try {
      const content: string = await RNBlobUtil.fs.readFile(BENCH_WORKSPACE_DIR + file.path, 'utf8');
      snapshot[file.path] = content.slice(0, MAX_SNAPSHOT_CHARS);
    } catch {
      snapshot[file.path] = '<unreadable>';
    }
  }
  return snapshot;
}
