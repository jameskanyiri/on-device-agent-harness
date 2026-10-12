import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Appearance, Platform } from 'react-native';
import RNBlobUtil from 'react-native-blob-util';
import { setTelemetryEnabled } from 'react-native-executorch';

import { CHAT_MODELS, deleteRetiredModels } from '@/lib/chat-models';
import { ensureMedGemmaFiles } from '@/lib/medgemma';
import { setHapticsEnabled } from '@/lib/haptics';
import { configureCollector, initCollectorDevice } from '@/observe/collector';

export type AppearanceMode = 'system' | 'light' | 'dark';

export type Personalization = {
  /** What the assistant should call you. */
  name: string;
  /** Context about you, e.g. job, interests, location. */
  about: string;
  /** How replies should sound, e.g. "short and direct". */
  style: string;
};

export type Settings = {
  modelId: string;
  appearance: AppearanceMode;
  haptics: boolean;
  /** Anonymous model-download stats sent by react-native-executorch. */
  downloadStats: boolean;
  /** Lets tool-capable models (Gemma 4) read and write files in the workspace. */
  fileTools: boolean;
  /** Address of the dashboard on the Mac (Settings → Dashboard). */
  dashboardUrl: string;
  /** Live monitoring: heartbeats while the app is open, and a trace of every reply and model load. */
  liveMonitoring: boolean;
  personalization: Personalization;
};

/**
 * The dashboard's address, written into .env.local by `npm run dashboard:env`
 * (part of `npm run ios:release`) as this Mac's .local name, which survives IP changes.
 */
const BUILD_DASHBOARD_URL = process.env.EXPO_PUBLIC_DASHBOARD_URL ?? '';

const DEFAULTS: Settings = {
  modelId: CHAT_MODELS[0]!.id,
  appearance: 'system',
  haptics: true,
  downloadStats: true,
  fileTools: true,
  // Builds made on the Mac (npm run ios:release) know its address, so they connect with no setup.
  dashboardUrl: BUILD_DASHBOARD_URL,
  liveMonitoring: !!BUILD_DASHBOARD_URL,
  personalization: { name: '', about: '', style: '' },
};

const STORE_PATH = `${RNBlobUtil.fs.dirs.DocumentDir}/settings.json`;

type SettingsContextValue = {
  settings: Settings;
  /** False until the saved settings have been read from disk. */
  loaded: boolean;
  update: (patch: Partial<Settings>) => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const writeQueue = useRef(Promise.resolve());

  useEffect(() => {
    (async () => {
      try {
        if (!(await RNBlobUtil.fs.exists(STORE_PATH))) return;
        const saved = JSON.parse(await RNBlobUtil.fs.readFile(STORE_PATH, 'utf8'));
        // A model id that no longer exists (e.g. a retired model) falls back to the default.
        if (saved.modelId && !CHAT_MODELS.some((m) => m.id === saved.modelId)) delete saved.modelId;
        // localhost never reaches the Mac from an iPhone.
        if (Platform.OS === 'ios' && /localhost/.test(saved.dashboardUrl ?? '')) delete saved.dashboardUrl;
        setSettings((s) => ({
          ...s,
          ...saved,
          personalization: { ...s.personalization, ...saved.personalization },
        }));
      } catch {
        // A corrupt file just falls back to defaults.
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    deleteRetiredModels();
    ensureMedGemmaFiles();
  }, []);

  // Apply settings that live outside React.
  useEffect(() => {
    Appearance.setColorScheme(
      settings.appearance === 'system' ? 'unspecified' : settings.appearance
    );
  }, [settings.appearance]);
  useEffect(() => setHapticsEnabled(settings.haptics), [settings.haptics]);
  useEffect(() => setTelemetryEnabled(settings.downloadStats), [settings.downloadStats]);
  useEffect(() => {
    initCollectorDevice();
  }, []);
  useEffect(
    () => configureCollector(settings.dashboardUrl, settings.liveMonitoring),
    [settings.dashboardUrl, settings.liveMonitoring]
  );

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      writeQueue.current = writeQueue.current
        .then(() => RNBlobUtil.fs.writeFile(STORE_PATH, JSON.stringify(next), 'utf8'))
        .catch(() => {});
      return next;
    });
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, loaded, update }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside <SettingsProvider>');
  return ctx;
}

/** Turns personalization into a short system prompt (empty when nothing is set). */
export function systemPromptFrom(p: Personalization): string {
  const lines = [
    p.name.trim() && `The user's name is ${p.name.trim()}.`,
    p.about.trim() && `About the user: ${p.about.trim()}`,
    p.style.trim() && `How to respond: ${p.style.trim()}`,
  ].filter(Boolean);
  return lines.join('\n');
}
