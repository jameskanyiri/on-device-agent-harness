// Adapted from Software Mansion's react-native-executorch-gallery (MIT):
// src/hooks/useAudioPlayer.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioContext, type AudioBufferQueueSourceNode } from 'react-native-audio-api';

export type AudioChunk = { readonly audio: Float32Array; readonly sampleRate: number };

/**
 * Plays a stream of PCM chunks (e.g. Kokoro TTS output) gaplessly through a
 * buffer queue, starting as soon as the first chunk arrives.
 */
export function useAudioPlayer(sampleRate: number) {
  const [isPlaying, setIsPlaying] = useState(false);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferQueueSourceNode | null>(null);
  const resolveRef = useRef<(() => void) | null>(null);
  const lastBufferIdRef = useRef<string | null>(null);
  const streamDoneRef = useRef(false);

  const stop = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.clearBuffers();
      sourceRef.current.stop();
      sourceRef.current = null;
    }
    setIsPlaying(false);
    lastBufferIdRef.current = null;
    streamDoneRef.current = false;
    resolveRef.current?.();
    resolveRef.current = null;
  }, []);

  const playStream = useCallback(
    async (chunks: AsyncIterable<AudioChunk>) => {
      stop();
      if (!contextRef.current || contextRef.current.state === 'closed') {
        contextRef.current = new AudioContext({ sampleRate });
      }
      const ctx = contextRef.current;
      if (ctx.state === 'suspended') await ctx.resume();

      const source = ctx.createBufferQueueSource();
      source.connect(ctx.destination);
      sourceRef.current = source;

      const finished = new Promise<void>((resolve) => {
        resolveRef.current = resolve;
        source.onBufferEnded = (event) => {
          if (streamDoneRef.current && event.bufferId === lastBufferIdRef.current) {
            setIsPlaying(false);
            resolveRef.current = null;
            resolve();
          }
        };
      });

      let started = false;
      try {
        for await (const chunk of chunks) {
          if (sourceRef.current !== source) break; // stopped while synthesizing
          const buffer = ctx.createBuffer(1, chunk.audio.length, chunk.sampleRate);
          buffer.copyToChannel(chunk.audio as Float32Array<ArrayBuffer>, 0);
          lastBufferIdRef.current = source.enqueueBuffer(buffer);
          if (!started) {
            started = true;
            setIsPlaying(true);
            source.start(0, 0);
          }
        }
        streamDoneRef.current = true;
        if (!started) stop();
      } catch (e) {
        stop();
        throw e;
      }
      await finished;
    },
    [sampleRate, stop]
  );

  useEffect(
    () => () => {
      stop();
      contextRef.current?.close().catch(() => {});
      contextRef.current = null;
    },
    [stop]
  );

  return { isPlaying, playStream, stop };
}
