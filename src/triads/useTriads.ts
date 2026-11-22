import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Tone from "tone";
import { ensureAudio } from "../audio/context";
import { createAttacks } from "../listen/attacks";
import { detectNotes, strongPitchClasses } from "../listen/spectrum";
import type { InputApi } from "../listen/useInput";
import { padChord } from "../song/cues";
import { today } from "../song/leitner";
import { mod } from "../musicTheory";
import { answerTriad, boxCounts, loadTriads, newDrill, nextTriad, openMap, saveTriads, type Focus, type TriadStore } from "./box";
import { choicesFor, TRIAD_BY_ID, type Naming, type Triad } from "./triads";

// The triad drill as a hook. Answered by tapping (a phone at night), the keys 1–4, the guitar's
// navigation cursor, or by strumming the triad: when the strings ring exactly one choice's three
// notes, that is the answer. A strum counts only after a fresh attack, so the chord left ringing
// from the last answer never answers the next card.
//
// At the guitar, a triad that is well known (box 4 up) is asked without choices: play it from
// memory, and any other three notes ringing together are the wrong answer. The choices come back
// on request or after a while, and an answer then is a slow one. Away from the guitar nothing changes.

const NEXT_RIGHT_MS = 650;
const NEXT_WRONG_MS = 1900;
const GATE_RMS = 0.004;
const RING_FRAMES = 3; // frames the same three notes must ring together
export const PLAY_BOX = 4; // known this well, at the guitar it is played, not picked
const REVEAL_MS = 8000; // without an answer the choices come back

export interface TriadAnswer {
  picked: number | null; // the choice taken, or null when it was played without choices
  right: boolean;
  ms: number;
}

const pcsOf = (t: Triad) => new Set(t.midis.map((m) => mod(m)));

/** `focus`: a key chosen on the circle, and the degree to begin with; none is the whole drill as it has opened. */
export function useTriads(input: InputApi, focus: Focus | null = null) {
  const [store, setStore] = useState<TriadStore>(loadTriads);
  const storeRef = useRef(store);
  storeRef.current = store;
  const drill = useRef(newDrill());
  const [card, setCard] = useState(() => (focus?.degree !== undefined ? TRIAD_BY_ID.get(`triad:${focus.key}:${focus.degree}`) : undefined) ?? nextTriad(store, drill.current, today(), focus));
  const [answer, setAnswer] = useState<TriadAnswer | null>(null);
  const [shown, setShown] = useState(0); // each showing of a card, even the same one again
  const [revealed, setRevealed] = useState(false);
  const [session, setSession] = useState({ asked: 0, right: 0, streak: 0, best: 0, fastMs: [] as number[] });
  const shownAt = useRef(performance.now());
  const timer = useRef<number | null>(null);
  const turn = store.cards[card.id]?.seen ?? 0;
  const { choices, answer: correct } = useMemo(() => choicesFor(card, turn), [card, shown]); // eslint-disable-line react-hooks/exhaustive-deps
  const naming: Naming = store.naming ?? "german";

  const advance = useCallback(() => {
    timer.current = null;
    drill.current.asked.set(card.id, drill.current.turn++);
    setCard(nextTriad(storeRef.current, drill.current, today(), focus));
    setShown((n) => n + 1);
    setRevealed(false);
    setAnswer(null);
    shownAt.current = performance.now();
  }, [card, focus]);

  const settle = useCallback(
    (right: boolean, picked: number | null) => {
      if (answer) return;
      const ms = performance.now() - shownAt.current;
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
    [answer, card, advance],
  );

  const listening = input.status === "listening" && !input.paused;
  const playOnly = listening && card.ask === "name" && card.inversion === 0 && (store.cards[card.id]?.box ?? 0) >= PLAY_BOX && !revealed;
  const choose = useCallback(
    (picked: number) => {
      if (playOnly || picked < 0 || picked >= choices.length) return;
      settle(picked === correct, picked);
    },
    [playOnly, choices.length, correct, settle],
  );
  const reveal = useCallback(() => setRevealed(true), []);
  useEffect(() => {
    if (!playOnly || answer) return;
    const id = window.setTimeout(() => setRevealed(true), REVEAL_MS);
    return () => window.clearTimeout(id);
  }, [playOnly, answer, shown]);

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
      if (n >= 1 && n <= 4) { event.preventDefault(); if (playOnly) reveal(); else choose(n - 1); }
      else if ((event.key === "Enter" || event.key === " ") && answer) { event.preventDefault(); skipAhead(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [choose, skipAhead, answer, playOnly, reveal]);

  // strumming answers: exactly one choice's three notes ringing together after a fresh attack; or,
  // played from memory, the card's own three notes (right) or any other three (wrong)
  const live = useRef({ choose, settle, playOnly, target: pcsOf(card.triad) });
  live.current = { choose, settle, playOnly, target: pcsOf(card.triad) };
  const sets = useMemo(() => choices.map((c) => (c.triad ? pcsOf(c.triad) : null)), [choices]);
  const setsRef = useRef(sets);
  setsRef.current = sets;
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
      const now = live.current;
      const fits = (set: Set<number> | null) => Boolean(set && ringing.length === set.size && ringing.every((pc) => set.has(pc)));
      let match = -1;
      if (now.playOnly) match = ringing.length === 3 ? (fits(now.target) ? 1 : 0) : -1; // 1 right, 0 wrong
      else {
        const matches = setsRef.current.map((set, i) => (fits(set) ? i : -1)).filter((i) => i >= 0);
        match = matches.length === 1 ? matches[0] : -1;
      }
      if (!armed) match = -1;
      frames = match >= 0 && match === run ? frames + 1 : match >= 0 ? 1 : 0;
      run = match;
      if (frames < RING_FRAMES) return;
      frames = 0;
      armed = false;
      if (now.playOnly) now.settle(match === 1, null);
      else now.choose(match);
    });
  }, [listening, subscribe]);

  const counts = useMemo(() => boxCounts(store), [store]);
  const open = useMemo(() => openMap(store), [store]);
  return { card, choices, correct, answer, choose, skipAhead, reveal, playOnly, naming, setNaming, session, counts, open, listening, state: store.cards[card.id] };
}
