"use client";

import { useEffect, useRef } from "react";

/**
 * Plan spec: "confetti plus a synthesised crowd-roar (Web Audio, ~3.5s)".
 * Synthesised, not a sample — white noise through a swept bandpass filter
 * reads as a distant crowd roar without shipping an audio asset.
 *
 * Opt-in and off by default (UX-05, honored by the caller checking
 * useReducedMotion before calling play()). `prime()` exists because
 * browsers only allow creating/resuming an AudioContext from inside a
 * user-gesture handler — call it synchronously at the top of the ANALYZE
 * click, before the `await` on the submit action, or the context is
 * created too late for autoplay policy to allow it.
 */
export function useCrowdRoar() {
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    return () => {
      void ctxRef.current?.close();
    };
  }, []);

  function prime() {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    if (ctxRef.current.state === "suspended") void ctxRef.current.resume();
  }

  function play() {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const duration = 3.5;

    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const bandpass = ctx.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.Q.value = 0.7;
    bandpass.frequency.setValueAtTime(280, t0);
    bandpass.frequency.exponentialRampToValueAtTime(1900, t0 + 0.8);
    bandpass.frequency.exponentialRampToValueAtTime(420, t0 + duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.32, t0 + 0.45);
    gain.gain.setValueAtTime(0.32, t0 + 1.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 3.2;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.06;
    lfo.connect(lfoGain).connect(gain.gain);

    source.connect(bandpass).connect(gain).connect(ctx.destination);
    source.start(t0);
    source.stop(t0 + duration);
    lfo.start(t0);
    lfo.stop(t0 + duration);
  }

  return { prime, play };
}
