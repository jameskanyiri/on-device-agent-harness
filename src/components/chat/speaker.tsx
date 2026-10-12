import { useEffect, useRef } from 'react';
import { KOKORO_SAMPLE_RATE, models, useTextToSpeech } from 'react-native-executorch';

import { useAudioPlayer } from '@/hooks/use-audio-player';

/** Kokoro, American English (~330 MB), with a warm default voice. */
const TTS_MODEL = models.textToSpeech.KOKORO.EN_US.DEFAULT;
const VOICE = 'af_heart';

export type SpeakerStatus =
  | { state: 'downloading'; progress: number }
  | { state: 'loading' }
  | { state: 'speaking' }
  | { state: 'idle' }
  | { state: 'error'; message: string };

/** Turns Markdown into plain sentences worth hearing (no code, symbols or URLs). */
export function speakable(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' (code omitted) ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_~|#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

type SpeakerProps = {
  /** Text to read; a new value restarts playback, null stops it. */
  text: string | null;
  onStatus: (status: SpeakerStatus) => void;
};

/**
 * On-device text-to-speech. Renders nothing: owns the Kokoro model and the
 * audio output. Mounted by VoiceProvider on the first "Read aloud" and kept for
 * the rest of the app run, so the voice model loads once.
 */
export function Speaker({ text, onStatus }: SpeakerProps) {
  const tts = useTextToSpeech(TTS_MODEL);
  const player = useAudioPlayer(KOKORO_SAMPLE_RATE);

  const statusRef = useRef(onStatus);
  useEffect(() => {
    statusRef.current = onStatus;
  });

  const progress = Math.round(tts.downloadProgress);
  useEffect(() => {
    if (!text) return;
    if (tts.error) statusRef.current({ state: 'error', message: tts.error.message });
    else if (!tts.isReady)
      statusRef.current(progress < 100 ? { state: 'downloading', progress } : { state: 'loading' });
  }, [text, tts.error, tts.isReady, progress]);

  useEffect(() => {
    if (!text || !tts.isReady || !tts.synthesize) return;
    const { synthesize, synthesizeStop } = tts;
    let cancelled = false;

    statusRef.current({ state: 'speaking' });
    player
      .playStream(synthesize(speakable(text), { voice: VOICE }))
      .catch((e) => {
        if (!cancelled) {
          statusRef.current({
            state: 'error',
            message: e instanceof Error ? e.message : String(e),
          });
        }
      })
      .finally(() => {
        if (!cancelled) statusRef.current({ state: 'idle' });
      });

    return () => {
      cancelled = true;
      synthesizeStop?.();
      player.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, tts.isReady]);

  return null;
}
