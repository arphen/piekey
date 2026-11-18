import { useCallback, useEffect, useRef, useState } from "react";
import { midiOf } from "../listen/pitch";
import type { InputApi } from "../listen/useInput";
import { initThemeCapture, rankThemeMatches, stepThemeCapture, type ThemeCandidate, type ThemeCatalog } from "./theme";

interface ThemeSnapshot {
  heard: readonly number[];
  candidates: readonly ThemeCandidate[];
}

const emptySnapshot = (): ThemeSnapshot => ({ heard: [], candidates: [] });

/** No permission request, audio context or navigation: the mounted chooser explicitly arms it. */
export function useThemePicker(input: InputApi, catalog: ThemeCatalog, enabled: boolean) {
  const capture = useRef(initThemeCapture());
  const [snapshot, setSnapshot] = useState<ThemeSnapshot>(emptySnapshot);
  const reset = useCallback(() => {
    capture.current = initThemeCapture();
    setSnapshot(emptySnapshot());
  }, []);
  const status = !enabled ? "off" : input.status === "listening" && !input.paused ? "listening" : "waiting";

  useEffect(() => {
    reset();
    if (status !== "listening") return;
    let live = true;
    let source = input.stream?.();
    let sampleRate: number | null = null;
    let lastTime: number | null = null;
    const unsubscribe = input.subscribe((frame) => {
      if (!live) return;
      const currentSource = input.stream?.();
      if (currentSource !== source || (sampleRate !== null && sampleRate !== frame.sampleRate) || (lastTime !== null && frame.now < lastTime)) {
        capture.current = initThemeCapture();
        setSnapshot(emptySnapshot());
      }
      source = currentSource;
      sampleRate = frame.sampleRate;
      lastTime = frame.now;
      const previous = capture.current;
      const next = stepThemeCapture(previous, { midi: midiOf(frame), rms: frame.rms });
      capture.current = next;
      if (next.heard === previous.heard) return;
      const candidates = rankThemeMatches(catalog, next.heard);
      // Keep an offered opening while the player continues beyond the cached prefix.
      setSnapshot((prior) => ({ heard: next.heard, candidates: candidates.length ? candidates : prior.candidates }));
    });
    return () => {
      live = false;
      unsubscribe();
      capture.current = initThemeCapture();
    };
  }, [catalog, enabled, input.deviceId, input.paused, input.status, input.stream, input.subscribe, reset, status]);

  return { status, ...snapshot, reset };
}
