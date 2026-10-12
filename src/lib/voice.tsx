import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

import { Dictation, type DictationStatus } from '@/components/chat/dictation';
import { Speaker, type SpeakerStatus } from '@/components/chat/speaker';

type VoiceContextValue = {
  /** Mic on: Whisper is (or is about to be) transcribing into `onTranscript`. */
  listening: boolean;
  dictationStatus: DictationStatus | null;
  startListening: (onTranscript: (text: string) => void) => void;
  stopListening: () => void;
  /** Text being read aloud, or null when quiet. */
  speechText: string | null;
  speakerStatus: SpeakerStatus | null;
  speak: (text: string) => void;
  stopSpeaking: () => void;
};

const VoiceContext = createContext<VoiceContextValue | null>(null);

/**
 * Owns the on-device voice models (Whisper for dictation, Kokoro for read-aloud)
 * above the chat screen, so they load once per app run rather than once per chat.
 * Each model is mounted on its first use and kept loaded from then on.
 */
export function VoiceProvider({ children }: { children: ReactNode }) {
  const [dictationEnabled, setDictationEnabled] = useState(false);
  const [listening, setListening] = useState(false);
  const [dictationStatus, setDictationStatus] = useState<DictationStatus | null>(null);
  const transcriptHandler = useRef<((text: string) => void) | null>(null);

  const startListening = useCallback((onTranscript: (text: string) => void) => {
    transcriptHandler.current = onTranscript;
    setDictationEnabled(true);
    setListening(true);
  }, []);
  const stopListening = useCallback(() => setListening(false), []);
  const onTranscript = useCallback((text: string) => transcriptHandler.current?.(text), []);
  const onDictationFinished = useCallback(() => setListening(false), []);

  const [speakerEnabled, setSpeakerEnabled] = useState(false);
  const [speechText, setSpeechText] = useState<string | null>(null);
  const [speakerStatus, setSpeakerStatus] = useState<SpeakerStatus | null>(null);

  const speak = useCallback((text: string) => {
    setSpeakerEnabled(true);
    setSpeechText(text);
  }, []);
  const stopSpeaking = useCallback(() => {
    setSpeechText(null);
    setSpeakerStatus(null);
  }, []);
  const onSpeakerStatus = useCallback((status: SpeakerStatus) => {
    setSpeakerStatus(status);
    if (status.state === 'idle') setSpeechText(null);
  }, []);

  return (
    <VoiceContext.Provider
      value={{
        listening,
        dictationStatus,
        startListening,
        stopListening,
        speechText,
        speakerStatus,
        speak,
        stopSpeaking,
      }}>
      {children}
      {dictationEnabled && (
        <Dictation
          listening={listening}
          onStatus={setDictationStatus}
          onTranscript={onTranscript}
          onFinished={onDictationFinished}
        />
      )}
      {speakerEnabled && <Speaker text={speechText} onStatus={onSpeakerStatus} />}
    </VoiceContext.Provider>
  );
}

export function useVoice() {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error('useVoice must be used inside VoiceProvider');
  return ctx;
}
