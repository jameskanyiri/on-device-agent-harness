import { Platform } from 'react-native';

import type { JobResponse, RunResult } from '@/bench/protocol';
import { runJob } from '@/bench/runner';

export type BenchStatus =
  | { state: 'idle' }
  | { state: 'waiting' }
  | { state: 'running'; jobId: string; label: string }
  | { state: 'done'; runs: number }
  | { state: 'error'; message: string };

type ClientOptions = {
  onStatus: (status: BenchStatus) => void;
  onLog: (line: string) => void;
  onResult: (result: RunResult) => void;
};

/**
 * Identifies this launch of the app. The driver uses it to tell a restarted app
 * (a lost run: the OS killed it) from a second connection in the same app.
 */
const LAUNCH_ID = Math.random().toString(36).slice(2);

const POLL_MS = 2000;
const RETRY_MS = 3000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls the Mac bench driver for jobs, runs each on this phone and posts the
 * results back. Returns a function that stops after the current job.
 */
export function startBenchClient(host: string, options: ClientOptions) {
  const base = host.replace(/\/+$/, '');
  const clientId = Math.random().toString(36).slice(2);
  let stopped = false;
  let runs = 0;
  // Once stopped, a client never reports again (a new one may already be running).
  const onStatus = (status: BenchStatus) => !stopped && options.onStatus(status);
  const onLog = (line: string) => !stopped && options.onLog(line);
  const onResult = (result: RunResult) => !stopped && options.onResult(result);

  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  (async () => {
    onStatus({ state: 'waiting' });
    while (!stopped) {
      let job: JobResponse | null;
      try {
        const res = await fetch(`${base}/job?launch=${LAUNCH_ID}&client=${clientId}`);
        if (res.status === 409) {
          onStatus({ state: 'error', message: 'The Mac is already running a job for another connection.' });
          await sleep(RETRY_MS);
          continue;
        }
        job = res.status === 204 ? null : ((await res.json()) as JobResponse);
      } catch (e) {
        // On an iPhone, localhost is the phone itself, never the Mac.
        const hint =
          Platform.OS === 'ios' && /localhost|127\.0\.0\.1/.test(base)
            ? ' On iPhone use the Mac\'s Wi-Fi address shown on the dashboard\'s Overview page.'
            : '';
        onStatus({
          state: 'error',
          message: `Can't reach ${base}: ${e instanceof Error ? e.message : String(e)}.${hint}`,
        });
        await sleep(RETRY_MS);
        continue;
      }
      if (!job) {
        onStatus({ state: 'waiting' });
        await sleep(POLL_MS);
        continue;
      }
      if (job.type === 'done') {
        onStatus({ state: 'done', runs });
        return;
      }

      const current = job;
      const label = `${current.scenario.label} · ${current.task.id} · rep ${current.rep}`;
      onStatus({ state: 'running', jobId: current.jobId, label });
      onLog(`▶ ${label}`);
      const log = (message: string) => {
        onLog(message);
        post('/log', { jobId: current.jobId, message }).catch(() => {});
      };
      const result = await runJob(current, log);
      runs++;
      onResult(result);
      onLog(result.ok ? '✓ done' : `✗ ${result.error}`);
      // Results can be large (samples); retry a few times before giving up.
      let sent = false;
      for (let attempt = 0; attempt < 5 && !sent; attempt++) {
        if (attempt > 0) await sleep(RETRY_MS);
        sent = await post('/result', result).then(
          (res) => res.ok,
          () => false
        );
      }
      if (!sent) onLog('Could not send the result to the Mac');
    }
    options.onStatus({ state: 'idle' });
  })();

  return () => {
    stopped = true;
  };
}
