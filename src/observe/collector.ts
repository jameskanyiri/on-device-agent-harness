import * as Device from 'expo-device';
import { AppState, Platform } from 'react-native';
import RNBlobUtil from 'react-native-blob-util';

import DeviceMetrics from '../../modules/device-metrics';
import type { LiveBeat, Trace, TraceDevice } from '@/observe/trace';

/*
 * Ships traces and live heartbeats to the Mac dashboard (on-device/dashboard).
 * Finished traces are queued on the phone and uploaded whenever the Mac is
 * reachable, so a chat traced on the train shows up later. Heartbeats go out
 * every ACTIVE_BEAT_MS while something runs, and every IDLE_BEAT_MS otherwise
 * when live monitoring is on, only while the app is in the foreground.
 */

const QUEUE_DIR = `${RNBlobUtil.fs.dirs.DocumentDir}/traces`;
const DEVICE_ID_PATH = `${RNBlobUtil.fs.dirs.DocumentDir}/device-id.txt`;
const MAX_QUEUED = 300;
const ACTIVE_BEAT_MS = 2000;
const IDLE_BEAT_MS = 5000;
const FLUSH_EVERY_MS = 60_000;
const REQUEST_TIMEOUT_MS = 4000;

let host = '';
let device: TraceDevice = {
  id: 'unknown',
  name: Device.modelName,
  platform: Platform.OS,
  osVersion: Device.osVersion,
};
let active: LiveBeat['active'] | null = null;
let liveMonitoring = false;
let foreground = AppState.currentState === 'active';
let beatTimer: ReturnType<typeof setInterval> | undefined;
let lastBeat = 0;
let flushTimer: ReturnType<typeof setInterval> | undefined;
let flushing = false;

/**
 * Where to send (the Mac's address, e.g. http://192.168.1.10:8787; empty turns
 * uploads off), and whether to send heartbeats even when nothing is running.
 */
export function configureCollector(nextHost: string, live = false) {
  host = nextHost.trim().replace(/\/+$/, '');
  liveMonitoring = live;
  clearInterval(flushTimer);
  if (host) {
    flushTimer = setInterval(flush, FLUSH_EVERY_MS);
    flush();
  }
  updateBeats();
}

AppState.addEventListener('change', (state) => {
  foreground = state === 'active';
  updateBeats();
  if (foreground) flush();
});

/** One 1 s ticker while heartbeats are wanted; it sends at the active or idle pace. */
function updateBeats() {
  const wanted = !!host && foreground && (!!active || liveMonitoring);
  if (wanted && !beatTimer) {
    beatTimer = setInterval(() => {
      if (Date.now() - lastBeat >= (active ? ACTIVE_BEAT_MS : IDLE_BEAT_MS)) beat();
    }, 1000);
    beat();
  } else if (!wanted && beatTimer) {
    clearInterval(beatTimer);
    beatTimer = undefined;
  }
}

export function collectorHost() {
  return host;
}

/** Loads (or creates) this install's id. Called once at startup. */
export async function initCollectorDevice(): Promise<void> {
  try {
    let saved = (await RNBlobUtil.fs.exists(DEVICE_ID_PATH))
      ? ((await RNBlobUtil.fs.readFile(DEVICE_ID_PATH, 'utf8')) as string).trim()
      : '';
    if (!saved) {
      saved = Math.random().toString(36).slice(2, 12);
      await RNBlobUtil.fs.writeFile(DEVICE_ID_PATH, saved, 'utf8');
    }
    device = { ...device, id: saved };
    // Anything queued while the id was loading can go now.
    flush();
  } catch {
    // Traces still work; the device just shows as "unknown".
  }
}

export function traceDevice(): TraceDevice {
  return device;
}

/** What's running now (null when idle). Drives the live heartbeat. */
export function setActive(next: LiveBeat['active'] | null) {
  const changed = !!active !== !!next;
  active = next;
  updateBeats();
  // Show the start and end of work at once, not on the next tick.
  if (changed && host) beat();
}

function beat() {
  // Until the saved device id has loaded, a beat would show up as a separate "unknown" device.
  if (!host || device.id === 'unknown') return;
  lastBeat = Date.now();
  const payload: LiveBeat = {
    device,
    t: Date.now(),
    sample: DeviceMetrics?.getSnapshot() ?? null,
    active: active ?? undefined,
  };
  post('/v1/live', payload).catch(() => {});
}

/** Queues a finished trace and tries to upload it. */
export async function submitTrace(trace: Trace): Promise<void> {
  try {
    const fs = RNBlobUtil.fs;
    if (!(await fs.exists(QUEUE_DIR))) await fs.mkdir(QUEUE_DIR);
    await fs.writeFile(`${QUEUE_DIR}/${trace.start}-${trace.traceId}.json`, JSON.stringify(trace), 'utf8');
    const queued = (await fs.ls(QUEUE_DIR)).sort();
    for (const old of queued.slice(0, Math.max(0, queued.length - MAX_QUEUED))) {
      await fs.unlink(`${QUEUE_DIR}/${old}`).catch(() => {});
    }
  } catch {
    return;
  }
  flush();
}

/** Uploads queued traces, oldest first; stops at the first failure. */
async function flush() {
  // Never upload during a benchmark run: it would show up in the measurements.
  if (!host || flushing || active?.source === 'bench') return;
  flushing = true;
  try {
    const fs = RNBlobUtil.fs;
    if (!(await fs.exists(QUEUE_DIR))) return;
    for (const file of (await fs.ls(QUEUE_DIR)).sort()) {
      const path = `${QUEUE_DIR}/${file}`;
      let body = (await fs.readFile(path, 'utf8')) as string;
      // A trace recorded before the device id loaded gets the real id now.
      if (device.id !== 'unknown' && body.includes('"id":"unknown"')) {
        const trace = JSON.parse(body) as Trace;
        if (trace.device.id === 'unknown') body = JSON.stringify({ ...trace, device: { ...trace.device, id: device.id } });
      }
      const res = await post('/v1/traces', body);
      if (!res.ok) break;
      await fs.unlink(path);
    }
  } catch {
    // Mac not reachable: try again later.
  } finally {
    flushing = false;
  }
}

async function post(path: string, body: unknown): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${host}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
