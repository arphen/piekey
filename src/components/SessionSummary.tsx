import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { InputApi } from "../listen/useInput";
import { hush, interlude } from "../song/cues";
import { FAMILY_LABEL, type Deck, type Family } from "../song/deck";
import { loadFreePlay } from "../song/freeplay";
import { allStores, boxCounts, BOXES, chronologicalAttempts, type CardState, type Result } from "../song/leitner";
import { familyOf, meanShare, sessionTrend, totals } from "../song/stats";
import { buildTree } from "../song/tree";
import type { SessionApi } from "../song/useSession";
import { NoteTag, useNoteKeys } from "./GuitarPad";
import { SkillTree } from "./SkillTree";
import { RecordingStatus } from "./RecordingStatus";

// Between sessions. A few bars of music, then what happened, in the order the eye should take it:
// the numbers, the exercises travelling to their new boxes, the map filling in, and last what a
// note does next. Nothing here needs the keyboard: each action is a note, shown beside it.

// by name, in any octave: C carries on, D is free play with the metronome, C♯ the settings
const KEYS = { more: 48, free: 50, settings: 49, tune: 53, shuffle: 54 };
const ARM_MS = 2500; // let the last notes ring out before a note can mean something
const MOVE_MS = 1100; // then the exercises set off for their new boxes
const FAMILIES: Family[] = ["scales", "melody", "harmony", "chords", "reading", "ear", "fretboard"];
const MAX_CARRIED = 4;

interface Row {
  id: string;
  title: string;
  tune: string;
  family: Family;
  from: number; // box before (0: new)
  to: number;
  result: Result | "carried"; // carried: moved up by a relative, not played
  bpm: number | null;
  delta: number | null; // tempo against the time before
  tempos: number[]; // each time it was played, oldest first
  tempoLabel: "played" | "call" | "reference" | null;
  self: boolean;
}

/** A number's history as a line: no axes, the last point marked. */
function Spark({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const w = 56;
  const h = 18;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = (i: number) => 3 + (i * (w - 6)) / (values.length - 1);
  const y = (v: number) => (hi === lo ? h / 2 : h - 3 - ((v - lo) / (hi - lo)) * (h - 6));
  return (
    <svg className="sm-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={label}>
      <title>{label}</title>
      <path d={values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ")} />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="2.5" />
    </svg>
  );
}

/** Share of exercises that came out clean, session by session. */
function Trend({ points }: { points: { date: string; value: number; cards: number }[] }) {
  const w = 360;
  const h = 70;
  const pad = { l: 6, r: 44, t: 8, b: 8 };
  const x = (i: number) => pad.l + (i * (w - pad.l - pad.r)) / Math.max(1, points.length - 1);
  const y = (v: number) => pad.t + (1 - v) * (h - pad.t - pad.b);
  const last = points[points.length - 1];
  return (
    <svg className="sm-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="clean exercises per session">
      <line className="sm-grid" x1={pad.l} x2={w - pad.r} y1={y(1)} y2={y(1)} />
      <line className="sm-grid" x1={pad.l} x2={w - pad.r} y1={y(0)} y2={y(0)} />
      <path className="sm-line" d={points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ")} />
      {points.map((p, i) => (
        <g key={i}>
          <title>{`${p.date}: ${Math.round(p.value * 100)}% of ${p.cards} clean`}</title>
          <circle className="sm-hit" cx={x(i)} cy={y(p.value)} r="9" />
          <circle className={`sm-point ${i === points.length - 1 ? "is-last" : ""}`} cx={x(i)} cy={y(p.value)} r={i === points.length - 1 ? 4 : 2.5} />
        </g>
      ))}
      <text className="sm-value" x={x(points.length - 1) + 9} y={y(last.value)} dy="0.35em">
        {Math.round(last.value * 100)}%
      </text>
    </svg>
  );
}

export function SessionSummary({
  deck,
  session: s,
  input,
  title,
  tuneId,
  tunes,
  onTune,
  onFree,
  onSettings,
  enabled,
  ear,
}: {
  deck: Deck;
  session: SessionApi;
  input: InputApi;
  title: string;
  tuneId: string;
  tunes: { id: string; title: string }[];
  onTune?(id: string): void;
  onFree(): void;
  onSettings(): void;
  enabled: boolean; // false while a menu is open over it
  ear: ReactNode;
}) {
  const byId = useMemo(() => new Map(deck.cards.map((c) => [c.id, c])), [deck]);
  const [armed, setArmed] = useState(false);
  const [moved, setMoved] = useState(false);
  const [more, setMore] = useState(true);
  const played = s.log.filter((o) => o.result !== "skip");
  const home = deck.harmony.home;
  const any = played.length > 0;

  useEffect(() => {
    let arm = 0;
    const music = window.setTimeout(() => {
      const ms = any ? interlude(home.tonic, home.mode === "minor") : 0;
      arm = window.setTimeout(() => setArmed(true), Math.max(ARM_MS - 600, ms - 900));
    }, 600);
    const move = window.setTimeout(() => setMoved(true), MOVE_MS);
    return () => {
      window.clearTimeout(music);
      window.clearTimeout(arm);
      window.clearTimeout(move);
      hush();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- the numbers ----------

  const clean = played.filter((o) => o.result === "clean").length;
  const up = played.filter((o) => o.to > o.from).length;
  const minutes = Math.max(1, Math.round(s.elapsed() / 60000));
  const landed = meanShare(played);
  const sessions = sessionTrend(s.store);
  const before = any && sessions.length >= 2 ? sessions[sessions.length - 2] : null;
  const landedDelta = landed !== null && before?.share !== undefined ? Math.round((landed - before.share) * 100) : null;
  const all = totals(s.store);
  const counts = boxCounts(deck, s.store);

  // ---------- the exercises, from the box they were in to the one they are in now ----------

  const { rows, carried } = useMemo(() => {
    const out = new Map<string, Row>();
    for (const o of s.log) {
      if (o.result === "skip") continue;
      const self = o.conditions?.source === "self";
      const timed = !self && (o.conditions?.tempo === "fixed" || o.conditions?.tempo === "adaptive");
      const visits = chronologicalAttempts(s.store.history ?? []).filter((attempt) => attempt.id === o.id);
      const version = visits[visits.length - 1]?.arrangementFingerprint;
      const tempos = timed && version ? visits
        .filter((attempt) => attempt.arrangementFingerprint === version && attempt.conditions?.source === "measured" && (attempt.conditions.tempo === "fixed" || attempt.conditions.tempo === "adaptive") && (attempt.ev?.time?.n ?? 0) > 0)
        .slice(-10).map((attempt) => attempt.bpm) : [];
      out.set(o.id, {
        id: o.id,
        title: `${byId.get(o.id)?.title ?? o.id}${o.secret ? ` · ${o.secret}` : ""}`,
        tune: byId.get(o.id)?.tune ?? title,
        family: byId.get(o.id)?.family ?? familyOf(o.id),
        from: out.get(o.id)?.from ?? o.from, // twice in a session: from where it started
        to: o.to,
        result: o.result,
        bpm: self ? null : o.bpm,
        delta: tempos.length >= 2 ? tempos[tempos.length - 1] - tempos[tempos.length - 2] : null,
        tempos,
        tempoLabel: self ? null : timed ? "played" : byId.get(o.id)?.family === "ear" ? "call" : "reference",
        self,
      });
    }
    const along: Row[] = [];
    for (const o of s.log)
      for (const a of o.also)
        if (!out.has(a.id) && !along.some((r) => r.id === a.id))
          along.push({ id: a.id, title: byId.get(a.id)?.title ?? a.id, tune: byId.get(a.id)?.tune ?? title, family: byId.get(a.id)?.family ?? familyOf(a.id), from: a.from, to: a.to, result: "carried", bpm: null, delta: null, tempos: [], tempoLabel: null, self: false });
    return { rows: [...out.values()], carried: along };
  }, [s.log, s.store, byId, title]);

  // two axes to read the session along: the tune, then the kind of exercise
  const groups = useMemo(() => {
    const shown = [...rows, ...carried.slice(0, MAX_CARRIED)];
    const tunesIn = [...new Set(shown.map((r) => r.tune))];
    return tunesIn.flatMap((tune) =>
      FAMILIES.map((family) => ({ tune: tunesIn.length > 1 ? tune : "", family, rows: shown.filter((r) => r.tune === tune && r.family === family) })).filter((g) => g.rows.length),
    );
  }, [rows, carried]);

  // ---------- the map ----------

  const tree = useMemo(() => {
    const cards: Record<string, CardState> = {};
    const credit: Record<string, number> = {};
    const tunesIn: { id: string; title: string; key: string; fill: number }[] = [];
    for (const { tuneId: id, store } of allStores()) {
      for (const [cid, st] of Object.entries(store.cards)) if (cid.startsWith("scale:") && (!cards[cid] || st.seen >= cards[cid].seen)) cards[cid] = st;
      Object.assign(credit, store.credit);
      const own = Object.entries(store.cards).filter(([cid]) => !cid.startsWith("scale:"));
      if (store.meta) tunesIn.push({ id, title: store.meta.title, key: store.meta.key, fill: own.length ? own.reduce((n, [, st]) => n + st.box, 0) / own.length / BOXES : 0 });
    }
    const lit = new Set(s.log.flatMap((o) => (o.result === "skip" ? [] : [o.id, ...o.also.map((a) => a.id)])));
    return buildTree({ cards, credit, tunes: tunesIn, free: loadFreePlay(), lit });
  }, [s.store, s.log]);

  // ---------- what a note does next ----------

  const at = tunes.findIndex((t) => t.id === tuneId);
  const nextTune = tunes.length > 1 && onTune ? tunes[(at + 1) % tunes.length] : null;
  const carryOn = () => {
    if (!s.keepGoing()) setMore(false);
  };
  const shuffle = () => s.updateSettings({ shuffle: !s.settings.shuffle });
  const fire = [carryOn, onFree, onSettings, () => nextTune && onTune?.(nextTune.id), shuffle];
  const held = useNoteKeys(input, enabled && armed, [more ? KEYS.more : null, KEYS.free, KEYS.settings, nextTune ? KEYS.tune : null, KEYS.shuffle], (k) => fire[k](), true);

  let row = 0;
  return (
    <div className="sm">
      <header className="sm-head">
        <p className="ss-kicker">
          {title} · {any ? "session" : "nothing played"}
        </p>
        {any ? (
          <dl className="sm-tiles">
            <div>
              <dt>played</dt>
              <dd>
                {minutes}
                <small>min</small>
              </dd>
              <p>
                {all.sessions} session{all.sessions === 1 ? "" : "s"} · {all.minutes} min in all
              </p>
            </div>
            <div>
              <dt>exercises</dt>
              <dd>{played.length}</dd>
              <p>{clean} clean</p>
            </div>
            {landed !== null ? (
              <div>
                <dt>notes landed</dt>
                <dd>
                  {Math.round(landed * 100)}
                  <small>%</small>
                </dd>
                <p>{landedDelta === null ? " " : landedDelta === 0 ? "as last time" : `${landedDelta > 0 ? "+" : "−"}${Math.abs(landedDelta)} on last time`}</p>
              </div>
            ) : null}
            <div>
              <dt>up a box</dt>
              <dd>{up}</dd>
              <p>{carried.length ? `+${carried.length} carried along` : " "}</p>
            </div>
          </dl>
        ) : null}
      </header>

      {s.log.some((outcome) => outcome.conditions?.source === "self") ? <p className="recording-status">Self-guided practice is activity, with no mic score or box advancement.</p> : null}
      {s.log.some((outcome) => outcome.conditions?.tempo === "own-pace" && outcome.conditions.source !== "self") ? <p className="recording-status">Own-pace BPM is the call or reference tempo, not your performed speed.</p> : null}
      <RecordingStatus ids={s.log.flatMap((outcome) => outcome.recordingId ? [outcome.recordingId] : [])} />

      <div className="sm-body">
        <section className="sm-left">
          {groups.length ? (
            <div className="sm-moves" role="img" aria-label="each exercise, from the box it was in to the box it is in now">
              <div className="sm-axis" aria-hidden="true">
                <span />
                <span className="sm-scale">
                  {["new", 1, 2, 3, 4, 5].map((b, i) => (
                    <span key={i} style={{ "--b": i } as CSSProperties}>
                      {b}
                    </span>
                  ))}
                </span>
                <span>tempo</span>
                <span />
              </div>
              {groups.map((g) => (
                <div key={`${g.tune}:${g.family}`} className={`fam-${g.family}`}>
                  <p className="sm-group">
                    <i />
                    {g.tune ? `${g.tune} · ` : ""}
                    {FAMILY_LABEL[g.family]}
                  </p>
                  {g.rows.map((r) => {
                    const here = moved ? r.to : r.from;
                    const style = { "--from": r.from, "--at": here, "--lo": Math.min(r.from, here), "--span": Math.abs(here - r.from), "--d": `${row++ * 90}ms` } as CSSProperties;
                    return (
                      <div key={r.id} className={`sm-row is-${r.result}`} style={style} title={r.self ? `${r.title}: self-guided, unscored` : `${r.title}: ${r.from ? `box ${r.from}` : "new"} → box ${r.to}`}>
                        <span className="sm-name">{r.title}</span>
                        <span className="sm-track">
                          {[0, 1, 2, 3, 4, 5].map((b) => (
                            <s key={b} style={{ "--b": b } as CSSProperties} />
                          ))}
                          <i className="sm-link" />
                          <i className="sm-from" />
                          <i className="sm-to" />
                        </span>
                        <span className="sm-tempo">
                          <Spark values={r.tempos} label={`tempo each time: ${r.tempos.join(", ")}`} />
                          {r.bpm !== null ? <b>{r.tempoLabel === "call" ? "call " : r.tempoLabel === "reference" ? "ref. " : ""}♩ {r.bpm}</b> : null}
                          {r.delta ? <em>{r.delta > 0 ? `+${r.delta}` : `−${-r.delta}`}</em> : null}
                        </span>
                        <span className="sm-verdict">{r.self ? "unscored" : r.result === "clean" ? "✓ clean" : r.result === "ok" ? "through" : r.result === "fail" ? "↺ comes back" : "carried"}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
              {carried.length > MAX_CARRIED ? <p className="sm-rest">+{carried.length - MAX_CARRIED} more carried along by their relatives</p> : null}
            </div>
          ) : null}
          {sessions.length >= 2 ? (
            <div className="sm-trend">
              <h3>Clean exercises, session by session</h3>
              <Trend points={sessions.map((p) => ({ date: p.date, value: p.cleanShare, cards: p.cards }))} />
            </div>
          ) : null}
        </section>

        <section className="sm-map">
          <SkillTree nodes={tree.nodes} edges={tree.edges} />
          <p className="sm-cap">from each key outward: scale → 3rds → triads → 7ths, and → triplets → 16ths · tunes by their key</p>
        </section>
      </div>

      <footer className="sm-foot">
        {ear}
        <ul className={`ss-acts ${armed && enabled ? "is-armed" : ""}`} aria-label="played on the guitar">
          <li className="is-main">
            <button type="button" onClick={carryOn} disabled={!more}>
              <NoteTag midi={KEYS.more} held={held === 0} octave={false} />
              <span>{more ? (counts.due ? `carry on · ${counts.due} due` : "a few more") : "nothing more for today"}</span>
            </button>
          </li>
          <li>
            <button type="button" onClick={onFree}>
              <NoteTag midi={KEYS.free} held={held === 1} octave={false} />
              <span>free play · metronome</span>
            </button>
          </li>
          <li>
            <button type="button" onClick={onSettings}>
              <NoteTag midi={KEYS.settings} held={held === 2} octave={false} />
              <span>settings</span>
            </button>
          </li>
          {nextTune ? (
            <li>
              <button type="button" onClick={() => onTune?.(nextTune.id)}>
                <NoteTag midi={KEYS.tune} held={held === 3} octave={false} />
                <span>{nextTune.title}</span>
              </button>
            </li>
          ) : null}
          <li>
            <button type="button" onClick={shuffle}>
              <NoteTag midi={KEYS.shuffle} held={held === 4} octave={false} />
              <span>shuffle {s.settings.shuffle ? "on" : "off"}</span>
            </button>
          </li>
        </ul>
        <span className="sm-esc">Esc leaves</span>
      </footer>
    </div>
  );
}
