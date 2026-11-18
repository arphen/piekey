import { useCallback, useEffect, useRef, useState } from "react";
import * as Tone from "tone";
import { ensureAudio } from "./context";

type Phase = "stopped" | "starting" | "playing" | "paused" | "ended" | "error";
interface PlaybackState {
  id: string | null;
  phase: Phase;
  position: number;
  duration: number | null;
  seekEnd: number | null;
  error: string | null;
}
const EMPTY: PlaybackState = { id: null, phase: "stopped", position: 0, duration: null, seekEnd: null, error: null };

function seekEnd(audio: HTMLAudioElement): number | null {
  if (Number.isFinite(audio.duration) && audio.duration > 0) return audio.duration;
  const end = audio.seekable.length ? audio.seekable.end(audio.seekable.length - 1) : NaN;
  return Number.isFinite(end) && end > 0 ? end : null;
}

/** One read-only media player for a comparison, routed through the app's shared output. */
export function useTakePlayback() {
  const [state, setState] = useState<PlaybackState>(EMPTY);
  const player = useRef<{ audio: HTMLAudioElement; source: MediaElementAudioSourceNode; removeListeners(): void }>();
  const current = useRef<{ id: string; url: string }>();
  const generation = useRef(0);
  const alive = useRef(true);
  const update = useCallback((phase?: Phase, error: string | null = null) => {
    const audio = player.current?.audio;
    if (!alive.current || !audio || !current.current) return;
    setState((previous) => ({
      id: current.current?.id ?? null,
      phase: phase ?? previous.phase,
      position: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
      duration: Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null,
      seekEnd: seekEnd(audio),
      error,
    }));
  }, []);
  const stop = useCallback(() => {
    generation.current++;
    current.current = undefined;
    const audio = player.current?.audio;
    if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
    if (alive.current) setState(EMPTY);
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stop();
      player.current?.removeListeners();
      player.current?.source.disconnect();
      player.current = undefined;
    };
  }, [stop]);

  const play = useCallback(async (id: string, url: string, restart = false) => {
    const token = ++generation.current;
    try {
      ensureAudio();
      if (!player.current) {
        const audio = document.createElement("audio");
        audio.preload = "metadata";
        const source = (Tone.getContext().rawContext as AudioContext).createMediaElementSource(audio);
        Tone.connect(source, Tone.getDestination());
        const refresh = () => update();
        const playing = () => update("playing");
        const paused = () => update(audio.ended ? "ended" : "paused");
        const ended = () => update("ended");
        const failed = () => update("error", "This recording could not play. Try Play again or save the audio.");
        for (const event of ["timeupdate", "durationchange", "loadedmetadata", "seeked"]) audio.addEventListener(event, refresh);
        audio.addEventListener("playing", playing);
        audio.addEventListener("pause", paused);
        audio.addEventListener("ended", ended);
        audio.addEventListener("error", failed);
        player.current = { audio, source, removeListeners() {
          for (const event of ["timeupdate", "durationchange", "loadedmetadata", "seeked"]) audio.removeEventListener(event, refresh);
          audio.removeEventListener("playing", playing);
          audio.removeEventListener("pause", paused);
          audio.removeEventListener("ended", ended);
          audio.removeEventListener("error", failed);
        } };
      }
      const audio = player.current.audio;
      if (current.current?.url !== url) {
        audio.pause();
        audio.src = url;
      }
      current.current = { id, url };
      if (audio.error) audio.load();
      if (restart || audio.ended) audio.currentTime = 0;
      update("starting");
      // Resume the shared context and media element in the initiating click/note action.
      await Promise.all([Tone.start(), audio.play()]);
      if (alive.current && generation.current === token) update("playing");
    } catch {
      if (!alive.current || generation.current !== token) return;
      player.current?.audio.pause();
      if (!current.current) current.current = { id, url };
      if (player.current) update("error", "Audio could not start. Try Play again or save the audio.");
      else setState({ ...EMPTY, id, phase: "error", error: "Audio could not start. Try Play again or save the audio." });
    }
  }, [update]);
  const pause = useCallback(() => {
    generation.current++;
    player.current?.audio.pause();
    update("paused");
  }, [update]);
  const seek = useCallback((seconds: number) => {
    const audio = player.current?.audio;
    if (!audio || !Number.isFinite(seconds)) return;
    // Recorded WebM often has no finite total duration. Previously heard audio can
    // still be revisited; an available seek range permits forward movement too.
    const end = seekEnd(audio) ?? audio.currentTime;
    try {
      audio.currentTime = Math.max(0, Math.min(end, audio.currentTime + seconds));
      update();
    } catch {
      update(undefined, "This browser could not seek in the recording. Restart or save the audio instead.");
    }
  }, [update]);
  const release = useCallback((url: string) => { if (current.current?.url === url) stop(); }, [stop]);
  return { ...state, play, pause, seek, stop, release };
}
