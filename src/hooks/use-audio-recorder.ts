// Adapted from Software Mansion's react-native-executorch-gallery (MIT):
// src/hooks/useAudioRecorder.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioManager, AudioRecorder } from 'react-native-audio-api';

/**
 * Streams microphone audio as mono Float32 PCM chunks (e.g. 16 kHz for Whisper)
 * via react-native-audio-api. The recorder is released on stop and on unmount.
 */
export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const recorderRef = useRef<AudioRecorder | null>(null);

  const stopRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) await recorder.stop().catch(() => {});
    setIsRecording(false);
  }, []);

  useEffect(() => () => void stopRecording(), [stopRecording]);

  const startRecording = useCallback(
    async (sampleRate: number, onChunk: (samples: Float32Array) => void, bufferLength = 4096) => {
      await stopRecording();

      AudioManager.setAudioSessionOptions({
        iosCategory: 'playAndRecord',
        iosMode: 'spokenAudio',
        iosOptions: ['allowBluetoothHFP', 'defaultToSpeaker'],
      });
      const permission = await AudioManager.requestRecordingPermissions();
      if (permission !== 'Granted') throw new Error('Microphone access is turned off.');

      const recorder = new AudioRecorder();
      recorderRef.current = recorder;
      recorder.onAudioReady({ sampleRate, bufferLength, channelCount: 1 }, (event) => {
        onChunk(new Float32Array(event.buffer.getChannelData(0)));
      });

      const result = await recorder.start();
      if (result.status === 'error') {
        recorderRef.current = null;
        throw new Error(result.message || 'Could not start the microphone.');
      }
      setIsRecording(true);
    },
    [stopRecording]
  );

  return { isRecording, startRecording, stopRecording };
}
