import { useEffect, useRef } from 'react';
import { models, useSpeechToText, WHISPER_SAMPLE_RATE_HZ } from 'react-native-executorch';

import { useAudioRecorder } from '@/hooks/use-audio-recorder';

/** Whisper tiny, English: ~57 MB, fast enough for live dictation on-device. */
const STT_MODEL = models.speechToText.WHISPER.EN.TINY.DEFAULT;

export type DictationStatus =
  | { state: 'downloading'; progress: number }
  | { state: 'loading' }
  | { state: 'ready' }
  | { state: 'error'; message: string };

type DictationProps = {
  /** Mic on/off. Turning it off finalizes the last words before `onFinished`. */
  listening: boolean;
  onStatus: (status: DictationStatus) => void;
  /** Full transcript so far (committed + in-progress words). */
  onTranscript: (text: string) => void;
  onFinished: () => void;
};

/**
 * Live on-device speech-to-text. Renders nothing: it owns the Whisper model and
 * the microphone. Mounted by VoiceProvider on the first mic tap and kept for the
 * rest of the app run, so the model loads once.
 */
export function Dictation({ listening, onStatus, onTranscript, onFinished }: DictationProps) {
  const stt = useSpeechToText(STT_MODEL);
  const { startRecording, stopRecording } = useAudioRecorder();

  // Latest callbacks without restarting the session when parents re-render.
  const callbacks = useRef({ onStatus, onTranscript, onFinished });
  useEffect(() => {
    callbacks.current = { onStatus, onTranscript, onFinished };
  });

  const progress = Math.round(stt.downloadProgress);
  useEffect(() => {
    const report = callbacks.current.onStatus;
    if (stt.error) report({ state: 'error', message: stt.error.message });
    else if (stt.isReady) report({ state: 'ready' });
    else if (progress < 100) report({ state: 'downloading', progress });
    else report({ state: 'loading' });
  }, [stt.error, stt.isReady, progress]);

  useEffect(() => {
    if (!listening || !stt.isReady || !stt.stream || !stt.streamInsert) return;
    const { stream, streamInsert, streamStop } = stt;

    (async () => {
      try {
        const updates = stream({ language: 'en' });
        await startRecording(WHISPER_SAMPLE_RATE_HZ, (samples) => streamInsert(samples));
        for await (const { committed, nonCommitted } of updates) {
          callbacks.current.onTranscript([committed, nonCommitted].filter(Boolean).join(' '));
        }
      } catch (e) {
        callbacks.current.onStatus({
          state: 'error',
          message: e instanceof Error ? e.message : String(e),
        });
      } finally {
        callbacks.current.onFinished();
      }
    })();

    // Mic off: stop capturing, then let Whisper finalize the last segment.
    return () => {
      stopRecording();
      streamStop?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening, stt.isReady]);

  return null;
}
