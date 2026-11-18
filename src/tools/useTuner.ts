import { useEffect, useRef, useState } from "react";
import { pitchOf } from "../listen/pitch";
import type { InputApi } from "../listen/useInput";
import { frequencyToDetectedPitch, type DetectedPitch } from "../pitchDetection";

export type TunerReading = { state: "quiet" | "uncertain" } | { state: "pitch"; pitch: DetectedPitch };

/** Reads the existing detector; cents stay relative to concert A440, not learned guitar tuning. */
export function useTuner(input: InputApi, active: boolean): TunerReading {
  const latest = useRef<{ at: number; reading: TunerReading }>();
  const [reading, setReading] = useState<TunerReading>({ state: "quiet" });
  const listening = active && input.status === "listening" && !input.paused;
  const { subscribe } = input;
  useEffect(() => {
    latest.current = undefined;
    setReading({ state: "quiet" });
    if (!listening) return;
    let recent: number[] = [];
    let midi: number | null = null;
    const unsubscribe = subscribe((frame) => {
      const found = pitchOf(frame);
      let next: TunerReading;
      if (frame.rms < 0.003) next = { state: "quiet" };
      else if (found.frequency === null || found.clarity < 0.8) next = { state: "uncertain" };
      else {
        const pitch = frequencyToDetectedPitch(found.frequency, found.clarity);
        recent = midi === pitch.midi ? [...recent, found.frequency].slice(-5) : [found.frequency];
        midi = pitch.midi;
        const sorted = [...recent].sort((a, b) => a - b);
        next = { state: "pitch", pitch: frequencyToDetectedPitch(sorted[sorted.length >> 1], found.clarity) };
      }
      if (next.state !== "pitch") { recent = []; midi = null; }
      latest.current = { at: frame.now, reading: next };
    });
    const timer = window.setInterval(() => {
      const value = latest.current;
      setReading(value && performance.now() - value.at < 450 ? value.reading : { state: "quiet" });
    }, 100);
    return () => { unsubscribe(); window.clearInterval(timer); };
  }, [listening, subscribe]);
  return reading;
}
