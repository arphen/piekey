import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rootMeanSquare } from "../pitchDetection";
import { setInputSetup } from "../audio/setup";
import { applyProfile, loadProfile } from "./calibration";

// Audio input shared by every listening feature. Remembers the chosen device and prefers an
// audio interface (Scarlett / Focusrite) over the built-in mic. Interfaces put each input jack on
// its own channel, so both channels are read and the louder one wins: the guitar can sit in
// either jack.
//
// Devices come and go (a cable pulled, the interface switched off and on). When the one in use
// disappears the input falls back to whatever is there, and when the preferred one is back it is
// taken up again, without a reload and without a click.

export interface InputFrame {
  buf: Float32Array; // newest `fftSize` samples of the louder channel
  sampleRate: number;
  now: number; // performance.now()
  rms: number;
}

export type InputStatus = "idle" | "starting" | "listening" | "error";

export interface InputApi {
  status: InputStatus;
  error: string | null;
  devices: { id: string; label: string }[];
  deviceId: string | null;
  setDeviceId(id: string): void;
  start(): Promise<void>;
  stop(): void;
  level: { current: number }; // 0..1, polled by the meter; not React state, so listening never re-renders the app
  subscribe(fn: (frame: InputFrame) => void): () => void;
  paused: boolean; // the browser holds audio until the next click or key press
  autoStart(): void; // start only if the browser already allows the input (no permission prompt)
  stream?(): MediaStream | null; // the open input, for recording a take
}

const DEVICE_STORAGE = "guitar-input";
const INTERFACE_LABEL = /scarlett|focusrite|2i2|interface|usb audio/i;

function savedDevice(): string | null {
  try {
    return localStorage.getItem(DEVICE_STORAGE);
  } catch {
    return null;
  }
}

function saveDevice(id: string) {
  try {
    localStorage.setItem(DEVICE_STORAGE, id);
  } catch {
    // preference only
  }
}

async function audioInputs(): Promise<{ id: string; label: string }[]> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications")
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Input ${i + 1}` }));
}

function openStream(deviceId: string | null) {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 2 },
    },
    video: false,
  });
}

export function useInput(opts: { fftSize: number; intervalMs: number }): InputApi {
  const [status, setStatus] = useState<InputStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<{ id: string; label: string }[]>([]);
  const [deviceId, setDeviceState] = useState<string | null>(savedDevice);
  const [paused, setPaused] = useState(false);

  const listeners = useRef(new Set<(frame: InputFrame) => void>());
  const level = useRef(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const deviceRef = useRef(deviceId);
  const statusRef = useRef<InputStatus>("idle");
  statusRef.current = status;
  const nodesRef = useRef<AudioNode[]>([]);
  const lost = useRef(false); // the device went away while listening: come back when one is there
  const openRef = useRef<(wanted: string | null, reuse?: boolean) => Promise<void>>(async () => undefined);
  const generation = useRef(0);
  const wakeRef = useRef<(() => void) | null>(null);

  /** `keepContext`: only let go of the device, so a reconnect needs no new click. */
  const teardown = useCallback((keepContext = false) => {
    generation.current++;
    if (wakeRef.current) {
      window.removeEventListener("pointerdown", wakeRef.current, true);
      window.removeEventListener("keydown", wakeRef.current, true);
      wakeRef.current = null;
    }
    if (ctxRef.current) ctxRef.current.onstatechange = null;
    setPaused(false);
    setInputSetup(null);
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    streamRef.current = null;
    nodesRef.current.forEach((n) => n.disconnect());
    nodesRef.current = [];
    if (!keepContext) {
      void ctxRef.current?.close().catch(() => undefined);
      ctxRef.current = null;
    }
    level.current = 0;
  }, []);

  const open = useCallback(
    async (wanted: string | null, reuse = false) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("error");
        setError(window.isSecureContext === false
          ? "Microphone access needs HTTPS. Open the secure app address on this device."
          : "This browser has no audio input API.");
        return;
      }
      const kept = reuse && ctxRef.current && ctxRef.current.state !== "closed" ? ctxRef.current : null;
      teardown(kept !== null);
      const token = generation.current;
      statusRef.current = "starting";
      setStatus("starting");
      setError(null);
      // The context is made here, inside the click, before any await: one made after the
      // permission prompt can lose the click and stay suspended, hearing only silence.
      // A reconnect has no click to ride on, so it keeps the context it already has.
      const Ctor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const ctx = kept ?? new Ctor({ latencyHint: "interactive" });
      ctxRef.current = ctx;
      let opened: MediaStream | null = null;
      try {
        let stream: MediaStream;
        try {
          stream = await openStream(wanted);
        } catch {
          if (generation.current !== token || ctxRef.current !== ctx) return;
          stream = await openStream(null); // remembered device unplugged
        }
        opened = stream;
        // Labels only show up after permission: now pick the interface if nothing was chosen yet.
        const list = await audioInputs();
        if (generation.current !== token || ctxRef.current !== ctx) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        setDevices(list);
        const openedId = stream.getAudioTracks()[0]?.getSettings().deviceId ?? null;
        if (!wanted || !list.some((d) => d.id === wanted)) {
          const iface = list.find((d) => INTERFACE_LABEL.test(d.label));
          if (iface && iface.id !== openedId) {
            stream.getTracks().forEach((t) => t.stop());
            stream = await openStream(iface.id);
            opened = stream;
          }
        }
        if (generation.current !== token || ctxRef.current !== ctx) {
          // stopped or restarted while waiting for the browser
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const activeId = stream.getAudioTracks()[0]?.getSettings().deviceId ?? openedId;
        if (activeId) {
          deviceRef.current = activeId;
          setDeviceState(activeId);
        }
        setInputSetup({ deviceId: activeId ?? wanted ?? "default", sampleRate: ctx.sampleRate });
        // A different input (including a temporary fallback) must not inherit another one's fit.
        applyProfile(loadProfile());
        // the device went away under us (unplugged): take whatever is there now
        const track = stream.getAudioTracks()[0];
        if (track)
          track.onended = () => {
            if (streamRef.current !== stream) return;
            lost.current = true;
            void openRef.current(savedDevice(), true);
          };
        const src = ctx.createMediaStreamSource(stream);
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 60;
        const split = ctx.createChannelSplitter(2);
        src.connect(hp);
        hp.connect(split);
        const analysers = [0, 1].map((ch) => {
          const a = ctx.createAnalyser();
          a.fftSize = opts.fftSize;
          a.smoothingTimeConstant = 0;
          split.connect(a, ch);
          return a;
        });
        nodesRef.current = [src, hp, split, ...analysers];
        streamRef.current = stream;

        // Still suspended (no click to ride on)? Resume on the next click or key press.
        const wake = () => {
          if (ctxRef.current === ctx && generation.current === token) void ctx.resume().catch(() => undefined);
        };
        const stateChanged = () => {
          if (ctxRef.current !== ctx || generation.current !== token) return;
          const waiting = ctx.state !== "running";
          setPaused(waiting);
          if (waiting && !wakeRef.current) {
            wakeRef.current = wake;
            window.addEventListener("pointerdown", wake, true);
            window.addEventListener("keydown", wake, true);
          } else if (!waiting && wakeRef.current === wake) {
            window.removeEventListener("pointerdown", wake, true);
            window.removeEventListener("keydown", wake, true);
            wakeRef.current = null;
          }
        };
        ctx.onstatechange = stateChanged;
        stateChanged();
        // resume() can stay pending until a click. Install recovery first and never block opening.
        if (ctx.state !== "running") wake();

        const bufs = analysers.map(() => new Float32Array(opts.fftSize));
        const avg = [0, 0];
        timerRef.current = window.setInterval(() => {
          if (ctx.state !== "running") {
            level.current = 0;
            return;
          }
          let pick = 0;
          const rms = analysers.map((a, i) => {
            a.getFloatTimeDomainData(bufs[i]);
            const r = rootMeanSquare(bufs[i]);
            avg[i] = avg[i] * 0.8 + r * 0.2;
            return r;
          });
          if (avg[1] > avg[0] * 1.5) pick = 1;
          level.current = Math.min(1, Math.sqrt(rms[pick]) * 2.2);
          const frame = { buf: bufs[pick], sampleRate: ctx.sampleRate, now: performance.now(), rms: rms[pick] };
          listeners.current.forEach((fn) => fn(frame));
        }, opts.intervalMs);
        lost.current = false;
        statusRef.current = "listening";
        setStatus("listening");
      } catch (e) {
        opened?.getTracks().forEach((t) => t.stop());
        // A rejected request from an old open must not tear down the newer input.
        if (generation.current !== token || ctxRef.current !== ctx) return;
        teardown();
        statusRef.current = "error";
        setStatus("error");
        setError(e instanceof Error ? e.message : "Could not open the audio input.");
      }
    },
    [teardown, opts.fftSize, opts.intervalMs],
  );

  openRef.current = open;
  const start = useCallback(() => open(deviceRef.current), [open]);

  const autoStart = useCallback(() => {
    if (statusRef.current !== "idle") return;
    const perms = navigator.permissions;
    if (!perms?.query) return;
    perms
      .query({ name: "microphone" as PermissionName })
      .then((p) => {
        if (p.state === "granted" && statusRef.current === "idle") void open(deviceRef.current);
      })
      .catch(() => undefined);
  }, [open]);

  const stop = useCallback(() => {
    lost.current = false;
    teardown();
    statusRef.current = "idle";
    setStatus("idle");
  }, [teardown]);

  const setDeviceId = useCallback(
    (id: string) => {
      deviceRef.current = id;
      setDeviceState(id);
      saveDevice(id);
      if (statusRef.current === "listening" || statusRef.current === "starting") void open(id);
    },
    [open],
  );

  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const refresh = () => {
      void audioInputs()
        .then((list) => {
          setDevices(list);
          const st = statusRef.current;
          if (st === "starting" || st === "idle") return;
          // the device asked for, when it is there; else an interface, as when first opening
          const want = savedDevice();
          const preferred = (want && list.some((d) => d.id === want) ? want : null) ?? list.find((d) => INTERFACE_LABEL.test(d.label))?.id ?? null;
          const track = streamRef.current?.getAudioTracks()[0];
          const dead = st === "listening" && (!track || track.readyState === "ended");
          const better = st === "listening" && preferred !== null && preferred !== deviceRef.current;
          const retry = st === "error" && lost.current && list.length > 0;
          if (dead || better || retry) void openRef.current(preferred ?? want, true);
        })
        .catch(() => undefined);
    };
    md.addEventListener("devicechange", refresh);
    return () => md.removeEventListener("devicechange", refresh);
  }, []);

  const subscribe = useCallback((fn: (frame: InputFrame) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  const stream = useCallback(() => streamRef.current, []);

  return useMemo(
    () => ({ status, error, devices, deviceId, setDeviceId, start, stop, level, subscribe, paused, autoStart, stream }),
    [status, error, devices, deviceId, setDeviceId, start, stop, subscribe, paused, autoStart],
  );
}
