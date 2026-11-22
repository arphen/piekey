import { useEffect, useRef, useState } from "react";
import * as Tone from "tone";
import { ensureAudio } from "../audio/context";
import { ctxToPerf, fitLatency, saveLatency } from "../audio/latency";
import { clickBuffer, OneShots } from "../audio/samples";
import { fitProfile, saveProfile, soundsLike, type Profile, type StringTake } from "../listen/calibration";
import { createAttacks } from "../listen/attacks";
import { midiOf } from "../listen/pitch";
import type { InputApi } from "../listen/useInput";
import { analysePitch } from "../pitchDetection";
import { currentInputSetup } from "../audio/setup";

// "Let me hear your guitar": a moment of quiet, then each open string once, low to high. Nothing
// to click: a string is taken when it is picked, and the next one lights up. A wrong string is
// simply asked for again. At the end each string shows how it sits against concert pitch.
// Then a few clicks to play along with: how late a note is heard after it sounds, so that
// "ahead of the beat" and "behind it" mean the player and not the input (audio/latency.ts).

const OPEN = [40, 45, 50, 55, 59, 64];
const NAMES = ["E", "A", "D", "G", "B", "e"];
const SPOKEN = ["the low E", "the A string", "the D string", "the G string", "the B string", "the high E"];
const QUIET_MS = 700;
const RING_MS = 1100;
const PICK_RATIO = 1.7;
const SHOW_MS = 3200; // the result stays up this long
const CLICKS = 10;
const CLICK_BPM = 80;
const TAP_LEAD_S = 1.2; // before the first click
const ATTACK_LOOKBACK_MS = 160; // a pitch is found up to this long after its string was struck
const TAP_GAP_MS = 180; // a new note no sooner than this after the last

type Mark = "todo" | "now" | "ok" | "again";

export function Calibrate({ input, onDone }: { input: InputApi; onDone(p: Profile | null): void }) {
  const [step, setStep] = useState(-1); // -1 quiet, 0..5 strings, 6 done
  const [again, setAgain] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [timing, setTiming] = useState<"wait" | "play" | "done">("wait");
  const [lagMs, setLagMs] = useState<number | null>(null);
  const fill = useRef<(HTMLSpanElement | null)[]>([]);
  const done = useRef(onDone);
  done.current = onDone;
  const listening = input.status === "listening" && !input.paused;
  const { subscribe } = input;
  const setup = JSON.stringify(currentInputSetup());

  useEffect(() => {
    setStep(-1);
    setAgain(false);
    setProfile(null);
    setTiming("wait");
    setLagMs(null);
  }, [setup]);

  useEffect(() => {
    if (!listening || profile) return;
    let at = -1;
    let began = 0;
    const quiet: number[] = [];
    let noise = 0;
    const takes: StringTake[] = [];
    let frames: StringTake["frames"] | null = null; // recording
    let ringFrom = 0;
    const recent: number[] = [];
    const show = (i: number, p: number) => fill.current[i]?.style.setProperty("--p", p.toFixed(3));
    return subscribe((f) => {
      if (at > 5) return;
      if (at === -1) {
        began ||= f.now;
        quiet.push(f.rms);
        if (f.now - began < QUIET_MS) return;
        // the quieter half of what was heard: a string still ringing does not count as the room
        noise = [...quiet].sort((a, b) => a - b)[quiet.length >> 2];
        setStep((at = 0));
        return;
      }
      const floor = recent.length ? Math.min(...recent) : Infinity;
      recent.push(f.rms);
      if (recent.length > 8) recent.shift();
      if (!frames) {
        if (f.rms > Math.max(noise * 4, 0.006) && f.rms > floor * PICK_RATIO) {
          frames = [];
          ringFrom = f.now;
        } else return;
      }
      frames.push(analysePitch(f.buf, f.sampleRate));
      show(at, Math.min(1, (f.now - ringFrom) / RING_MS));
      if (f.now - ringFrom < RING_MS) return;
      const take = { midi: OPEN[at], frames };
      frames = null;
      if (!soundsLike(take)) {
        show(at, 0);
        setAgain(true);
        return;
      }
      setAgain(false);
      takes.push(take);
      setStep(++at);
      if (at > 5) {
        const p = fitProfile(noise, takes, new Date().toISOString());
        saveProfile(p);
        setProfile(p);
      }
    });
  }, [listening, subscribe, setup, profile]);

  // the strings are in: a moment to read them, then the clicks
  useEffect(() => {
    if (!profile || timing !== "wait") return;
    const id = window.setTimeout(() => setTiming("play"), SHOW_MS);
    return () => window.clearTimeout(id);
  }, [profile, timing]);

  useEffect(() => {
    if (timing !== "play" || !listening) return;
    ensureAudio();
    const ctx = Tone.getContext().rawContext as AudioContext;
    const shots = new OneShots();
    const t0 = ctx.currentTime + TAP_LEAD_S;
    const clicks: number[] = [];
    for (let i = 0; i < CLICKS; i++) {
      const time = t0 + (i * 60) / CLICK_BPM;
      shots.play(clickBuffer(i % 4 === 0), Tone.getDestination(), time);
      clicks.push(ctxToPerf(ctx, time));
    }
    const heard: number[] = [];
    let floor = Infinity;
    let armed = false;
    let lastNote = -Infinity;
    let struck: number | null = null;
    const attacks = createAttacks();
    const off = subscribe((f) => {
      // a fresh attack, then the first frame that has a pitch: the note began where the string was
      // struck, as the practice session times it (listen/attacks.ts)
      const found = attacks(f);
      if (found.length && found[found.length - 1].at - lastNote > TAP_GAP_MS) struck = found[found.length - 1].at;
      if (found.length || (f.rms > floor * PICK_RATIO && f.rms > 0.006)) if (f.now - lastNote > TAP_GAP_MS) armed = true;
      floor = Math.min(floor * 1.02, f.rms || floor);
      if (armed && midiOf(f) !== null) {
        const at = struck !== null && f.now - struck <= ATTACK_LOOKBACK_MS ? struck : f.now;
        heard.push(at);
        lastNote = at;
        armed = false;
        struck = null;
      }
    });
    const end = window.setTimeout(() => {
      const ms = fitLatency(clicks, heard);
      if (ms !== null) saveLatency(ms);
      setLagMs(ms);
      setTiming("done");
    }, TAP_LEAD_S * 1000 + (CLICKS * 60000) / CLICK_BPM + 600);
    return () => {
      off();
      window.clearTimeout(end);
      shots.stopAll();
    };
  }, [timing, listening, subscribe, setup]);

  useEffect(() => {
    if (timing !== "done" || !profile) return;
    const id = window.setTimeout(() => done.current(profile), SHOW_MS);
    return () => window.clearTimeout(id);
  }, [timing, profile]);

  const say = !listening
    ? "I can't hear you yet. Tap the circle."
    : timing === "play"
      ? "A note with each click."
      : timing === "done"
        ? lagMs === null
          ? "Timing: not measured."
          : `Timing: ${lagMs} ms`
    : step < 0
      ? "Quiet for a moment."
      : step > 5
        ? "Got it. I know your guitar now."
        : again
          ? `That wasn't it. Open string: ${SPOKEN[step]}.`
          : `Pick ${SPOKEN[step]}, open. Let it ring.`;
  const mark = (i: number): Mark => (step > i ? "ok" : step === i ? (again ? "again" : "now") : "todo");

  return (
    <div className="ss-cal" role="dialog" aria-label="calibration">
      <p className="ss-kicker">Before we play</p>
      <h1 className="ss-display">Let me hear your guitar</h1>
      <div className="ss-pad-strings ss-cal-strings">
        {[5, 4, 3, 2, 1, 0].map((i) => {
          const r = profile?.strings[i];
          return (
            <div key={i} className={`ss-pad-row ss-cal-row is-${mark(i)}`} ref={(el) => (fill.current[i] = el)}>
              <span className="ss-pad-note">{NAMES[i]}</span>
              <span className="ss-pad-string" style={{ height: 1 + i * 0.5 }}>
                {r && r.cents !== null ? <i className={Math.abs(r.cents) > 12 ? "is-off" : ""} style={{ left: `${50 + Math.max(-48, Math.min(48, r.cents))}%` }} /> : null}
              </span>
              <span className="ss-pad-label">
                {r ? (
                  <em>{r.cents === null ? "" : Math.abs(r.cents) <= 12 ? "in tune" : `${Math.abs(r.cents)} cents ${r.cents < 0 ? "flat" : "sharp"}`}</em>
                ) : mark(i) === "ok" ? (
                  <svg className="ss-cal-tick" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 12.5 L10 17.5 L19 7" pathLength={1} />
                  </svg>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
      <p className="ss-say" key={say} aria-live="polite">
        {say}
      </p>
      {profile ? null : (
        <button type="button" className="ss-cal-skip" onClick={() => onDone(null)}>
          not now
        </button>
      )}
    </div>
  );
}
