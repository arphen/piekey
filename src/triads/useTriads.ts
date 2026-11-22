import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Tone from "tone";
import { ensureAudio } from "../audio/context";
import { createAttacks } from "../listen/attacks";
import { detectNotes, strongPitchClasses } from "../listen/spectrum";
import type { InputApi } from "../listen/useInput";
import { padChord } from "../song/cues";
import { today } from "../song/leitner";
import { mod } from "../musicTheory";
import { answerTriad, boxCounts, loadTriads, newDrill, nextTriad, openRings, saveTriads, type TriadStore } from "./box";
import { choicesFor, type Naming, type Triad } from "./triads";

// The triad drill as a hook. Answered by tapping (a phone at night), the keys 1–4, the guitar's
// navigation cursor, or by strumming the triad: when the strings ring exactly one choice's three
// notes, that is the answer. A strum counts only after a fresh attack, so the chord left ringing
// from the last answer never answers the next card.

const NEXT_RIGHT_MS = 650;
const NEXT_WRONG_MS = 1900;
const GATE_RMS = 0.004;
const RING_FRAMES = 3; // frames the same three notes must ring together

export interface TriadAnswer {
  picked: number;
  right: boolean;
  ms: number;
}

export function useTriads(input: InputApi) {
  const [store, setStore] = useState<TriadStore>(loadTriads);
  const storeRef = useRef(store);
  storeRef.current = store;
  const drill = useRef(newDrill());
  const [card, setCard] = useState(() => nextTriad(store, drill.current, today()));
  const [answer, setAnswer] = useState<TriadAnswer | null>(null);
  const [shown, setShown] = useState(0); // each showing of a card, even the same one again
  const [session, setSession] = useState({ asked: 0, right: 0, streak: 0, best: 0, fastMs: [] as number[] });
  const shownAt = useRef(performance.now());
  const timer = useRef<number | null>(null);
  const turn = store.cards[card.id]?.seen ?? 0;
  const { choices, answer: correct } = useMemo(() => choicesFor(card, turn), [card, shown]); // eslint-disable-line react-hooks/exhaustive-deps
  const naming: Naming = store.naming ?? "german";

  const advance = useCallback(() => {
    timer.current = null;
    drill.current.asked.set(card.id, drill.current.turn++);
    setCard(nextTriad(storeRef.current, drill.current, today()));
    setShown((n) => n + 1);
    setAnswer(null);
    shownAt.current = performance.now();
  }, [card]);

  const choose = useCallback(
    (picked: number) => {
      if (answer || picked < 0 || picked >= choices.length) return;
      const ms = performance.now() - shownAt.current;
      const right = picked === correct;
      const next = answerTriad(storeRef.current, card.id, right, ms, today());
      storeRef.current = next;
      setStore(next);
      saveTriads(next);
      setAnswer({ picked, right, ms });
      setSession((s) => ({ asked: s.asked + 1, right: s.right + (right ? 1 : 0), streak: right ? s.streak + 1 : 0, best: Math.max(s.best, right ? s.streak + 1 : 0), fastMs: right ? [...s.fastMs.slice(-19), ms] : s.fastMs }));
      // the answer sounds, as a guitar would voice it; a tap is the gesture that lets audio start
      ensureAudio();
      void Tone.start().then(() => padChord(card.triad.midis.map((m) => m - 12)), () => undefined);
      timer.current = window.setTimeout(advance, right ? NEXT_RIGHT_MS : NEXT_WRONG_MS);
    },
    [answer, choices.length, correct, card, advance],
  );

  /** Straight on after a miss, without waiting. */
  const skipAhead = useCallback(() => {
    if (!answer) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    advance();
  }, [answer, advance]);

  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  const setNaming = useCallback((value: Naming) => {
    const next = { ...storeRef.current, naming: value };
    storeRef.current = next;
    setStore(next);
    saveTriads(next);
  }, []);

  // keys 1–4 choose, Enter or Space carries on after an answer
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const n = Number(event.key);
      if (n >= 1 && n <= 4) { event.preventDefault(); choose(n - 1); }
      else if ((event.key === "Enter" || event.key === " ") && answer) { event.preventDefault(); skipAhead(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [choose, skipAhead, answer]);

  // strumming the triad answers: exactly one choice's three notes ringing together, after a fresh attack
  const chooseRef = useRef(choose);
  chooseRef.current = choose;
  const sets = useMemo(() => choices.map((t: Triad) => new Set(t.notes.map((_, i) => mod(t.midis[i])))), [choices]);
  const setsRef = useRef(sets);
  setsRef.current = sets;
  const listening = input.status === "listening" && !input.paused;
  const { subscribe } = input;
  useEffect(() => {
    if (!listening) return;
    const attacks = createAttacks();
    const presence = new Float32Array(12);
    let armed = false;
    let run = -1;
    let frames = 0;
    let shown = -1;
    return subscribe((f) => {
      if (shown !== drill.current.turn) { shown = drill.current.turn; armed = false; run = -1; frames = 0; presence.fill(0); }
      if (attacks(f).length) armed = true;
      const heard = f.rms < GATE_RMS ? [] : strongPitchClasses(detectNotes(f.buf, f.sampleRate));
      const ringing: number[] = [];
      for (let pc = 0; pc < 12; pc++) {
        presence[pc] = presence[pc] * 0.6 + (heard.includes(pc) ? 0.4 : 0);
        if (presence[pc] >= 0.5) ringing.push(pc);
      }
      const matches = setsRef.current.map((set, i) => (ringing.length === set.size && ringing.every((pc) => set.has(pc)) ? i : -1)).filter((i) => i >= 0);
      const match = armed && matches.length === 1 ? matches[0] : -1;
      frames = match >= 0 && match === run ? frames + 1 : match >= 0 ? 1 : 0;
      run = match;
      if (frames >= RING_FRAMES) { frames = 0; armed = false; chooseRef.current(match); }
    });
  }, [listening, subscribe]);

  const counts = useMemo(() => boxCounts(store), [store]);
  const rings = useMemo(() => openRings(store), [store]);
  return { card, choices, correct, answer, choose, skipAhead, naming, setNaming, session, counts, rings, listening, state: store.cards[card.id] };
}
