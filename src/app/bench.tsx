import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';

import DeviceMetrics, { type MetricSample } from '../../modules/device-metrics';
import { setBenchMode } from '@/bench/bench-mode';
import { startBenchClient, type BenchStatus } from '@/bench/client';
import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSettings } from '@/lib/settings';

const MAX_LOG_LINES = 60;
const KEEP_AWAKE_TAG = 'benchmark';

/**
 * Connects this phone to the dashboard on the Mac (on-device/dashboard).
 * Live monitoring streams device metrics and a trace of every reply while the
 * app is open. Benchmarks are optional controlled runs started from the
 * dashboard: while connected for them, the chat's model is unloaded and the
 * screen stays awake.
 */
export default function DashboardScreen() {
  const theme = useTheme();
  const { settings, update } = useSettings();
  const [host, setHost] = useState(settings.dashboardUrl);
  const [status, setStatus] = useState<BenchStatus>({ state: 'idle' });
  const [log, setLog] = useState<string[]>([]);
  const [completed, setCompleted] = useState(0);
  const stopRef = useRef<(() => void) | null>(null);

  // Retrying after an error still counts as connected: Stop first, then edit the address.
  const connected = status.state === 'waiting' || status.state === 'running' || status.state === 'error';

  // Only a benchmark connection unloads the chat and holds the screen awake.
  useEffect(() => {
    if (!connected) return;
    setBenchMode(true);
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => {
      setBenchMode(false);
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, [connected]);
  useEffect(() => () => stopRef.current?.(), []);

  // Paused during a run so the live readout doesn't add to what's measured.
  const live = useLiveMetrics(status.state !== 'running');

  const saveHost = () => {
    if (host.trim() !== settings.dashboardUrl) update({ dashboardUrl: host.trim() });
  };

  const toggleBenchmarks = () => {
    stopRef.current?.();
    stopRef.current = null;
    if (connected) {
      setStatus({ state: 'idle' });
      return;
    }
    saveHost();
    setLog([]);
    stopRef.current = startBenchClient(host.trim(), {
      onStatus: setStatus,
      onLog: (line) => setLog((prev) => [...prev.slice(-(MAX_LOG_LINES - 1)), line]),
      onResult: () => setCompleted((n) => n + 1),
    });
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Dashboard',
          headerRight: () => (
            <Pressable
              onPress={() => router.back()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close">
              <SymbolView name="xmark" size={18} tintColor={theme.text} weight="semibold" />
            </Pressable>
          ),
        }}
      />
      <ScrollView
        style={{ backgroundColor: theme.background }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}>
        <ThemedText type="small" themeColor="textSecondary">
          See this phone live on your Mac. Start the dashboard there (`npm run dev` in
          on-device/dashboard) and enter the address it shows. Android: run `adb reverse tcp:8787
          tcp:8787` and use localhost.
        </ThemedText>

        <TextInput
          value={host}
          onChangeText={setHost}
          onEndEditing={saveHost}
          editable={!connected}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="done"
          placeholder={Platform.OS === 'ios' ? 'http://192.168.1.10:8787' : 'http://localhost:8787'}
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />

        <View style={[styles.card, styles.switchRow, { backgroundColor: theme.backgroundElement }]}>
          <View style={styles.switchText}>
            <ThemedText type="smallBold">Live monitoring</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              While the app is open, sends memory, CPU, heat and battery every few seconds, and a
              trace of every reply and model load. Traces include your messages and the replies (up
              to 1,000 characters each) and go only to your Mac; they wait on the phone until it&apos;s
              reachable.
            </ThemedText>
          </View>
          <Switch
            value={settings.liveMonitoring}
            onValueChange={(liveMonitoring) => update({ dashboardUrl: host.trim(), liveMonitoring })}
          />
        </View>

        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold">This phone now</ThemedText>
          {DeviceMetrics ? (
            <ThemedText type="small" style={styles.mono}>
              {live ?? 'Sampling…'}
            </ThemedText>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              Device metrics aren&apos;t in this build. Rebuild the app (npx expo run:ios / run:android).
            </ThemedText>
          )}
        </View>

        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <ThemedText type="smallBold">Benchmarks (optional)</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Controlled test runs you start from the dashboard. While connected, the chat&apos;s
                model is unloaded and the screen stays on.
              </ThemedText>
            </View>
            <PressableScale
              onPress={toggleBenchmarks}
              disabled={!host.trim()}
              accessibilityRole="button"
              style={[styles.button, { backgroundColor: connected ? theme.backgroundSelected : theme.text }]}>
              <ThemedText style={{ color: connected ? theme.text : theme.background, fontWeight: '600' }}>
                {connected ? 'Stop' : 'Connect'}
              </ThemedText>
            </PressableScale>
          </View>
          {connected || completed > 0 ? <ThemedText type="small">{statusText(status, completed)}</ThemedText> : null}
          {log.length > 0 && (
            <ThemedText type="small" selectable style={styles.mono}>
              {log.join('\n')}
            </ThemedText>
          )}
        </View>
      </ScrollView>
    </>
  );
}

function statusText(status: BenchStatus, completed: number): string {
  switch (status.state) {
    case 'idle':
      return completed ? `Stopped · ${completed} runs done` : 'Not connected';
    case 'waiting':
      return `Connected · waiting for jobs · ${completed} runs done`;
    case 'running':
      return `Running ${status.label} · ${completed} done`;
    case 'done':
      return `All jobs finished · ${status.runs} runs`;
    case 'error':
      return status.message;
  }
}

/** A once-a-second summary of the native metrics, so you can see the phone settle. */
function useLiveMetrics(enabled: boolean): string | null {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!DeviceMetrics || !enabled) return;
    let previous: MetricSample | null = null;
    const tick = () => {
      const sample = DeviceMetrics!.getSnapshot();
      setText(describe(sample, previous));
      previous = sample;
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return text;
}

function describe(s: MetricSample, prev: MetricSample | null): string {
  const mb = (bytes?: number) => (bytes === undefined ? '–' : `${Math.round(bytes / 1e6)} MB`);
  const cpu =
    prev && s.uptimeS > prev.uptimeS
      ? `${Math.round(((s.cpuTimeS - prev.cpuTimeS) / (s.uptimeS - prev.uptimeS)) * 100)}%`
      : '–';
  const lines = [
    `memory   ${mb(s.memFootprintBytes)} (available ${mb(s.memAvailableBytes)})`,
    `cpu      ${cpu}`,
    `thermal  ${s.thermal ?? '–'}${s.thermalHeadroom != null ? ` (headroom ${s.thermalHeadroom.toFixed(2)})` : ''}`,
    `battery  ${s.batteryLevel !== undefined ? `${Math.round(s.batteryLevel * 100)}%` : '–'} ${s.batteryState ?? ''}${s.lowPowerMode ? ' · low power' : ''}`,
  ];
  if (s.powerW !== undefined) lines.push(`power    ${s.powerW.toFixed(2)} W`);
  return lines.join('\n');
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.three,
    padding: Spacing.four,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  input: {
    flex: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  button: {
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    justifyContent: 'center',
    marginLeft: Spacing.two,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  switchText: {
    flex: 1,
    gap: Spacing.half,
  },
  card: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  mono: {
    fontFamily: Fonts?.mono,
    fontSize: 12,
    lineHeight: 17,
  },
});
