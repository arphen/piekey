import { useCallback, useEffect, useState } from "react";
import * as Tone from "tone";
import { setOutputSetup } from "./setup";

// Where the app's sound comes out. By default a browser plays through the system's output, which
// on a machine with an audio interface plugged in is usually the interface. Choosing a device here
// (the laptop's own speakers, say) sends the app's sound there while the guitar still comes in
// through the interface. Needs a browser that can route an audio context (Chrome, Edge).

const STORAGE = "guitar-output";
export const SYSTEM_OUTPUT = ""; // follow the system

export interface OutputDevice {
  id: string;
  label: string;
}

interface Sinkable {
  setSinkId(id: string): Promise<void>;
}

const sinkable = (x: unknown): x is Sinkable => typeof x === "object" && x !== null && typeof (x as { setSinkId?: unknown }).setSinkId === "function";

/** The audio context that can be pointed at a device: Tone wraps the browser's own. */
function sink(): Sinkable | null {
  try {
    const raw = Tone.getContext().rawContext as unknown as Record<string, unknown>;
    return [raw, raw._nativeAudioContext, raw._nativeContext].find(sinkable) ?? null;
  } catch {
    return null;
  }
}

export const canChooseOutput = () => sink() !== null;

export function savedOutput(): string {
  try {
    return localStorage.getItem(STORAGE) ?? SYSTEM_OUTPUT;
  } catch {
    return SYSTEM_OUTPUT;
  }
}

export async function listOutputs(): Promise<OutputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === "audiooutput" && d.deviceId !== "default" && d.deviceId !== "communications")
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Output ${i + 1}` }));
}

let current = SYSTEM_OUTPUT; // what the context is pointed at now

async function route(id: string): Promise<boolean> {
  const s = sink();
  if (!s) return false;
  try {
    await s.setSinkId(id);
    current = id;
    setOutputSetup(id);
    return true;
  } catch {
    return false;
  }
}

/** Send the app's sound to a device and remember it. False when this browser (or the device) won't have it. */
export async function setOutput(id: string): Promise<boolean> {
  const ok = await route(id);
  if (ok)
    try {
      localStorage.setItem(STORAGE, id);
    } catch {
      // for this visit only
    }
  return ok;
}

/**
 * The remembered device, if it is plugged in; the system's output while it isn't. Called when the
 * audio starts and whenever devices come and go, so pulling a cable never leaves the app silent
 * and plugging it back in brings the sound back to where it was.
 */
export async function restoreOutput(): Promise<void> {
  if (!sink()) return;
  const want = savedOutput();
  const there = want === SYSTEM_OUTPUT || (await listOutputs().catch(() => [])).some((d) => d.id === want);
  const to = there ? want : SYSTEM_OUTPUT;
  if (to !== current) await route(to);
  // a context that lost its device may have stopped: wake it
  try {
    const ctx = Tone.getContext();
    if (ctx.state !== "running") await ctx.resume();
  } catch {
    // nothing to wake
  }
}

let watching = false;

/** Keep the routing right as devices come and go. Safe to call more than once. */
export function watchOutputs(): void {
  if (watching || typeof navigator === "undefined" || !navigator.mediaDevices?.addEventListener) return;
  watching = true;
  navigator.mediaDevices.addEventListener("devicechange", () => void restoreOutput());
  void restoreOutput();
}

/** The outputs there are, which one is in use, and a way to choose: by id, or the next one round. */
export function useOutputs() {
  const [devices, setDevices] = useState<OutputDevice[]>([]);
  const [id, setId] = useState(savedOutput);
  const supported = canChooseOutput();

  useEffect(() => {
    const md = navigator.mediaDevices;
    const refresh = () => {
      void listOutputs()
        .then(setDevices)
        .catch(() => undefined);
    };
    refresh();
    md?.addEventListener?.("devicechange", refresh);
    return () => md?.removeEventListener?.("devicechange", refresh);
  }, []);

  const choose = useCallback(async (next: string) => {
    if (await setOutput(next)) setId(next);
  }, []);

  const all = [{ id: SYSTEM_OUTPUT, label: "System output" }, ...devices];
  const cycle = useCallback(() => {
    const at = all.findIndex((d) => d.id === id);
    void choose(all[(at + 1) % all.length].id);
  }, [all, id, choose]);

  return { devices: all, id, label: all.find((d) => d.id === id)?.label ?? "System output", supported, choose, cycle };
}
