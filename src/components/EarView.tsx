import { useEffect, useMemo } from "react";
import type { InputApi } from "../listen/useInput";
import { setNavMuted } from "../nav/useGuitarNav";
import { noteName, useNoteKeys } from "./GuitarPad";
import { useEarTrainer, type EarTrainer } from "../ear/useEarTrainer";
import {
  CHORDS,
  FAMOUS,
  chordName,
  contrastTip,
  family,
  FAMILY_LABEL,
  KEY_NAMES,
  STAGE_WINDOW,
  TRACKS,
  type Family,
  type TrackId,
} from "../ear/theory";
import { LIBRARY_SIZE, MY_SONGS, matchFamous, songsFor, spotifyUrl, type MySong } from "../ear/library";
import "../ear/ear.css";

const FAMOUS_BY_ID = Object.fromEntries(FAMOUS.map((f) => [f.id, f]));
const FAMILIES: Family[] = ["tonic", "pre", "dominant", "colour"];

export function EarView({ input }: { input: InputApi }) {
  const ear = useEarTrainer();
  useShortcuts(ear);
  const held = useEarKeys(ear, input);
  useEffect(() => () => ear.stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="ear">
      <div className="ear-main">
        <div className="ear-modes">
          <div className="seg" role="group" aria-label="exercise">
            <button type="button" className={ear.mode === "chords" ? "is-on" : ""} onClick={() => ear.setMode("chords")}>
              Hear the chords
            </button>
            <button type="button" className={ear.mode === "names" ? "is-on" : ""} onClick={() => ear.setMode("names")}>
              Name that progression
            </button>
          </div>
          <div className="seg" role="group" aria-label="style">
            {(Object.keys(TRACKS) as TrackId[]).map((t) => (
              <button key={t} type="button" className={ear.track === t ? "is-on" : ""} onClick={() => ear.setTrack(t)}>
                {TRACKS[t].label}
              </button>
            ))}
          </div>
        </div>

        <EarKeys held={held} listening={input.status === "listening"} />

        {ear.unlocked !== null ? <Unlock ear={ear} stage={ear.unlocked} /> : null}

        {ear.q.kind === "chords" ? <ChordRound ear={ear} /> : <NameRound ear={ear} />}

        <Method />
      </div>

      <aside className="ear-side">
        <Ladder ear={ear} />
        <MasteryCard ear={ear} />
        <MyMusic ear={ear} />
        <Confusions ear={ear} />
        <SettingsCard ear={ear} />
      </aside>
    </main>
  );
}

/* ---------- keyboard ---------- */

function useShortcuts(ear: EarTrainer) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey) return;
      const q = ear.q;
      const done = q.kind === "chords" ? q.revealed : q.picked !== null;
      if (e.key === " ") {
        e.preventDefault();
        if (ear.playing) ear.stop();
        else ear.play(true);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (done) ear.next();
        else ear.check();
      } else if (e.key === "Backspace") {
        ear.undo();
      } else if (e.key.toLowerCase() === "b") {
        ear.playBass();
      } else if (e.key.toLowerCase() === "h") {
        ear.playHome();
      } else if (/^[1-9]$/.test(e.key)) {
        const i = Number(e.key) - 1;
        if (q.kind === "chords" && ear.vocab[i]) ear.choose(ear.vocab[i]);
        if (q.kind === "names" && q.choices[i]) ear.pickName(q.choices[i].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ear]);
}

/* ---------- guitar keys ---------- */

// Above the shell's navigation notes (E5–A5): the three things a round needs, so it can be
// played without the cursor. Answers are picked with the cursor (F♯5 presses a chord).
const EAR_KEYS = [
  { midi: 82, label: "play · stop" }, // A♯5
  { midi: 83, label: "check · next" }, // B5
  { midi: 84, label: "bass line" }, // C6
];

/** Silent while the trainer sounds: its own speakers must not press its keys. */
function useEarKeys(ear: EarTrainer, input: InputApi): number | null {
  useEffect(() => {
    setNavMuted(ear.playing);
    return () => setNavMuted(false);
  }, [ear.playing]);
  return useNoteKeys(
    input,
    input.status === "listening" && !ear.playing,
    EAR_KEYS.map((k) => k.midi),
    (k) => {
      const q = ear.q;
      const done = q.kind === "chords" ? q.revealed : q.picked !== null;
      if (k === 0) ear.play(true);
      else if (k === 1) (done ? ear.next : ear.check)();
      else ear.playBass();
    },
  );
}

function EarKeys({ held, listening }: { held: number | null; listening: boolean }) {
  if (!listening) return null;
  return (
    <ul className="ear-keys" aria-label="guitar keys">
      {EAR_KEYS.map((k, i) => (
        <li key={k.midi} className={held === i ? "is-held" : ""}>
          <b>{noteName(k.midi)}</b> {k.label}
        </li>
      ))}
    </ul>
  );
}

/* ---------- transport-ish row ---------- */

function Listen({ ear }: { ear: EarTrainer }) {
  return (
    <div className="ear-listen">
      <button type="button" className={`ear-play ${ear.playing ? "is-playing" : ""}`} onClick={() => (ear.playing ? ear.stop() : ear.play(true))}>
        <span aria-hidden="true">{ear.playing ? "■" : "▶"}</span>
        {ear.playing ? "Stop" : "Play"}
        <kbd>space</kbd>
      </button>
      <button type="button" className="ear-btn" onClick={() => ear.play(false)} title="Skip the key-setting cadence">
        Progression only
      </button>
      <button type="button" className="ear-btn" onClick={ear.playBass} title="Hear just the bass line — the best clue">
        Bass line <kbd>B</kbd>
      </button>
      <button type="button" className="ear-btn" onClick={ear.playHome} title="Hear the home chord">
        Home <kbd>H</kbd>
      </button>
    </div>
  );
}

/* ---------- chords mode ---------- */

function ChordRound({ ear }: { ear: EarTrainer }) {
  const q = ear.q;
  if (q.kind !== "chords") return null;
  const ready = q.answers.every((a) => a !== null);
  const scored = q.ids.filter((_, i) => !q.given[i]);
  const right = q.ids.filter((id, i) => !q.given[i] && q.answers[i] === id).length;
  const misses = q.ids
    .map((id, i) => ({ id, guess: q.answers[i]!, i }))
    .filter((m) => q.revealed && !q.given[m.i] && m.guess !== m.id);

  return (
    <section className="card ear-round">
      <header className="ear-round-head">
        <div>
          <p className="ear-eyebrow">
            Round {ear.stats.rounds + (q.revealed ? 0 : 1)} · {q.revealed ? `key of ${KEY_NAMES[q.keyPc]}` : "key hidden — numbers work in any key"}
          </p>
          <h2>What are the {q.ids.length} chords?</h2>
        </div>
        <Streak ear={ear} />
      </header>

      <Listen ear={ear} />

      <ol className="ear-slots">
        {q.ids.map((id, i) => {
          const a = q.answers[i];
          const state = q.given[i] ? "given" : !q.revealed ? (a ? "filled" : "empty") : a === id ? "right" : "wrong";
          return (
            <li
              key={i}
              className={`ear-slot is-${state} ${ear.cursor === i ? "is-sounding" : ""} ${ear.activeSlot === i ? "is-active" : ""}`}
              data-family={q.revealed || q.given[i] ? family(id) : a ? family(a) : undefined}
            >
              <button type="button" onClick={() => (q.revealed ? ear.audition(id) : ear.setSlot(i))} disabled={!q.revealed && (q.given[i] || !a)}>
                <span className="ear-slot-n">{i + 1}</span>
                {state === "wrong" ? <s className="ear-slot-guess">{a}</s> : null}
                <span className="ear-slot-num">{q.revealed || q.given[i] ? id : a ?? "?"}</span>
                {q.revealed || q.given[i] ? <span className="ear-slot-name">{chordName(id, q.keyPc)}</span> : null}
                {q.given[i] && !q.revealed ? <span className="ear-slot-name">given</span> : null}
              </button>
            </li>
          );
        })}
      </ol>

      {!q.revealed ? (
        <>
          <Pad ear={ear} />
          <div className="ear-actions">
            <button type="button" className="ear-btn" onClick={ear.undo}>
              Undo <kbd>⌫</kbd>
            </button>
            <button type="button" className="ear-primary" onClick={ear.check} disabled={!ready}>
              Check <kbd>enter</kbd>
            </button>
          </div>
        </>
      ) : (
        <div className="ear-result">
          <p className={`ear-verdict ${right === scored.length ? "is-good" : ""}`}>
            {right === scored.length ? "All correct." : `${right} of ${scored.length} right.`}{" "}
            <span>{right === scored.length ? "Click any chord to hear it against home." : "Compare, then hear the difference:"}</span>
          </p>
          <SongMatch ear={ear} ids={q.ids} />
          {misses.length ? (
            <>
              <div className="ear-actions ear-actions-left">
                <button type="button" className="ear-btn" onClick={ear.playAnswer}>
                  ▶ What you said
                </button>
                <button type="button" className="ear-btn" onClick={ear.playCorrect}>
                  ▶ What it was
                </button>
              </div>
              <ul className="ear-tips">
                {misses.map((m) => (
                  <li key={m.i}>
                    <button type="button" className="ear-btn ear-btn-sm" onClick={() => ear.contrast(m.id, m.guess)}>
                      ▶ {m.id} vs {m.guess}
                    </button>
                    <span>
                      <b>Chord {m.i + 1}:</b> {contrastTip(m.id, m.guess)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <Pad ear={ear} audition />
          <div className="ear-actions">
            <button type="button" className="ear-primary" onClick={ear.next}>
              Next <kbd>enter</kbd>
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Pad({ ear, audition = false }: { ear: EarTrainer; audition?: boolean }) {
  const byFamily = useMemo(() => {
    const groups = new Map<Family, { id: string; n: number }[]>();
    ear.vocab.forEach((id, n) => {
      const f = family(id);
      groups.set(f, [...(groups.get(f) ?? []), { id, n }]);
    });
    return FAMILIES.filter((f) => groups.has(f)).map((f) => ({ f, chords: groups.get(f)! }));
  }, [ear.vocab]);

  return (
    <div className={`ear-pad ${audition ? "is-audition" : ""}`}>
      {audition ? <p className="ear-pad-hint">Tap any chord to hear it framed by home (home → chord → home).</p> : null}
      {byFamily.map(({ f, chords }) => (
        <div key={f} className="ear-pad-group" data-family={f}>
          <span className="ear-pad-label">{FAMILY_LABEL[f]}</span>
          <div className="ear-pad-row">
            {chords.map(({ id, n }) => (
              <button key={id} type="button" className="ear-chord" data-family={f} onClick={() => ear.choose(id)} title={CHORDS[id].hear}>
                <span>{id}</span>
                {n < 9 && !audition ? <kbd>{n + 1}</kbd> : null}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Streak({ ear }: { ear: EarTrainer }) {
  return (
    <div className="ear-streak" title={`Best streak: ${ear.stats.best}`}>
      <b>{ear.stats.streak}</b>
      <span>streak</span>
    </div>
  );
}

/* ---------- names mode ---------- */

function NameRound({ ear }: { ear: EarTrainer }) {
  const q = ear.q;
  if (q.kind !== "names") return null;
  const done = q.picked !== null;
  const ok = q.picked === q.answer.id;
  return (
    <section className="card ear-round">
      <header className="ear-round-head">
        <div>
          <p className="ear-eyebrow">
            {ear.stats.names.right}/{ear.stats.names.total} named · {done ? `key of ${KEY_NAMES[q.keyPc]}${q.answer.mode === "minor" ? " minor" : ""}` : "plays twice"}
          </p>
          <h2>Which famous progression is this?</h2>
        </div>
        <Streak ear={ear} />
      </header>
      <Listen ear={ear} />
      <ol className="ear-slots">
        {q.answer.numerals.map((id, i) => (
          <li key={i} className={`ear-slot ${done ? "is-given" : "is-empty"} ${ear.cursor === i ? "is-sounding" : ""}`} data-family={done ? family(id) : undefined}>
            <button type="button" disabled={!done} onClick={() => ear.audition(id)}>
              <span className="ear-slot-n">{i + 1}</span>
              <span className="ear-slot-num">{done ? id : "·"}</span>
              {done ? <span className="ear-slot-name">{chordName(id, q.keyPc)}</span> : null}
            </button>
          </li>
        ))}
      </ol>
      <div className="ear-choices">
        {q.choices.map((f, n) => {
          const state = !done ? "" : f.id === q.answer.id ? "is-right" : f.id === q.picked ? "is-wrong" : "is-dim";
          return (
            <button key={f.id} type="button" className={`ear-choice ${state}`} onClick={() => ear.pickName(f.id)} disabled={done}>
              <kbd>{n + 1}</kbd>
              <span>{f.name}</span>
            </button>
          );
        })}
      </div>
      {done ? (
        <div className="ear-result">
          <p className={`ear-verdict ${ok ? "is-good" : ""}`}>{ok ? "Yes!" : `It was ${q.answer.name}.`}</p>
          <p className="ear-why">{q.answer.why}</p>
          <p className="ear-songs">
            <span>You've heard it in</span> {q.answer.songs}
          </p>
          <YourSongs ear={ear} songs={songsFor(q.answer.id)} />
          <div className="ear-actions">
            <button type="button" className="ear-primary" onClick={ear.next}>
              Next <kbd>enter</kbd>
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/* ---------- side ---------- */

/* ---------- your music ---------- */

function SongLink({ song }: { song: MySong }) {
  return (
    <a className="ear-song-link" href={spotifyUrl(song.spotify)} target="_blank" rel="noreferrer">
      {song.title}
    </a>
  );
}

function YourSongs({ ear, songs }: { ear: EarTrainer; songs: MySong[] }) {
  if (!songs.length) return null;
  return (
    <div className="ear-yours">
      <p className="ear-eyebrow">From your playlists</p>
      <ul>
        {songs.map((s) => (
          <li key={s.spotify}>
            <button type="button" className="ear-btn ear-btn-sm" onClick={() => ear.playSong(s)} title="Play it in the key the song is in">
              ▶ in {KEY_NAMES[s.keyPc]}
            </button>
            <span>
              <SongLink song={s} /> <span className="ear-muted">· {s.artist} · {s.part}</span>
              {s.guitar ? <span className="ear-badge">on your Guitar list</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SongMatch({ ear, ids }: { ear: EarTrainer; ids: string[] }) {
  const m = useMemo(() => matchFamous(ids), [ids]);
  if (!m) return null;
  const songs = songsFor(m.famous.id);
  return (
    <div className="ear-match">
      <p>
        {m.rotated ? "Same loop as " : "That's "}
        <b>{m.famous.name}</b>
        {m.rotated ? ", starting from a different chord." : "."}{" "}
        {songs.length ? null : <span className="ear-muted">You've heard it in {m.famous.songs}.</span>}
      </p>
      <YourSongs ear={ear} songs={songs} />
    </div>
  );
}

function MyMusic({ ear }: { ear: EarTrainer }) {
  const groups = useMemo(() => {
    const byProg = new Map<string, MySong[]>();
    for (const s of MY_SONGS) byProg.set(s.progression, [...(byProg.get(s.progression) ?? []), s]);
    return [...byProg.entries()].map(([id, songs]) => ({ f: FAMOUS_BY_ID[id], songs })).filter((g) => g.f);
  }, []);
  return (
    <section className="card ear-card">
      <h3>Your music</h3>
      <p className="ear-muted">
        {MY_SONGS.length} of your {LIBRARY_SIZE} songs mapped to their progressions. These come up more often in "Name that
        progression".
      </p>
      <ul className="ear-mymusic">
        {groups.map(({ f, songs }) => (
          <li key={f.id}>
            <p className="ear-mymusic-prog">
              {f.numerals.join(" – ")}
              {f.mode === "minor" ? <span className="ear-muted"> (minor)</span> : null}
            </p>
            {songs.map((s) => (
              <div key={s.spotify} className="ear-mymusic-song">
                <button type="button" onClick={() => ear.playSong(s)} title={`Play ${f.name} in ${KEY_NAMES[s.keyPc]}`} aria-label={`Play ${s.title} progression`}>
                  ▶
                </button>
                <SongLink song={s} />
                <span className="ear-muted">{s.artist}</span>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Unlock({ ear, stage }: { ear: EarTrainer; stage: number }) {
  const s = TRACKS[ear.track].stages[stage];
  return (
    <section className="card ear-unlock" role="status">
      <div>
        <p className="ear-eyebrow">Level {stage + 1} unlocked</p>
        <h3>New: {s.add.join(", ")}</h3>
        <p>{s.note}</p>
        {s.add.map((id) => (
          <p key={id} className="ear-unlock-hear">
            <b>{id}</b> — {CHORDS[id].hear}
          </p>
        ))}
      </div>
      <div className="ear-unlock-actions">
        {s.add.map((id) => (
          <button key={id} type="button" className="ear-btn" onClick={() => ear.audition(id)}>
            ▶ Meet {id}
          </button>
        ))}
        <button type="button" className="ear-btn" onClick={ear.dismissUnlock}>
          Got it
        </button>
      </div>
    </section>
  );
}

function Ladder({ ear }: { ear: EarTrainer }) {
  const stages = TRACKS[ear.track].stages;
  const recent = ear.progress.recent.slice(-STAGE_WINDOW);
  const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  return (
    <section className="card ear-card">
      <h3>Path · {TRACKS[ear.track].label}</h3>
      <p className="ear-muted">{TRACKS[ear.track].blurb}</p>
      <ol className="ear-ladder">
        {stages.map((s, i) => (
          <li key={i} className={i < ear.progress.stage ? "is-done" : i === ear.progress.stage ? "is-current" : ""}>
            <button type="button" onClick={() => ear.setStage(i)} title={s.note}>
              <span className="ear-ladder-n">{i + 1}</span>
              <span>{i === 0 ? s.add.join(" ") : `+ ${s.add.join(" ")}`}</span>
            </button>
          </li>
        ))}
      </ol>
      {ear.mode === "chords" && ear.progress.stage < stages.length - 1 ? (
        <div className="ear-progress" title="Next level unlocks at 85% over your last 10 rounds">
          <div className="ear-meter">
            <i style={{ width: `${Math.round((recent.length / STAGE_WINDOW) * avg * 100)}%` }} />
            <b style={{ left: "85%" }} />
          </div>
          <span>
            {recent.length < STAGE_WINDOW ? `${recent.length}/${STAGE_WINDOW} rounds` : `${Math.round(avg * 100)}%`} · unlocks at 85%
          </span>
        </div>
      ) : null}
    </section>
  );
}

function MasteryCard({ ear }: { ear: EarTrainer }) {
  return (
    <section className="card ear-card">
      <h3>Your ear</h3>
      <p className="ear-muted">Tap a chord to hear it against home. Weak chords come up more often.</p>
      <ul className="ear-mastery">
        {ear.vocab.map((id) => {
          const m = ear.progress.mastery[id];
          const pct = m ? Math.round(m.score * 100) : 0;
          return (
            <li key={id} data-family={family(id)}>
              <button type="button" onClick={() => ear.audition(id)} title={CHORDS[id].hear}>
                <span className="ear-mastery-id">{id}</span>
                <span className="ear-meter">
                  <i style={{ width: `${m ? pct : 0}%` }} />
                </span>
                <span className="ear-mastery-pct">{m ? `${pct}%` : "new"}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Confusions({ ear }: { ear: EarTrainer }) {
  const top = Object.entries(ear.progress.confusion)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, n]) => {
      const [actual, guess] = k.split(">");
      return { actual, guess, n };
    })
    .filter((c) => CHORDS[c.actual] && CHORDS[c.guess]);
  if (!top.length) return null;
  return (
    <section className="card ear-card">
      <h3>Mix-ups to drill</h3>
      <ul className="ear-confusions">
        {top.map((c) => (
          <li key={`${c.actual}>${c.guess}`}>
            <div>
              <b>{c.actual}</b> heard as <b>{c.guess}</b> <span className="ear-muted">×{c.n}</span>
            </div>
            <p>{contrastTip(c.actual, c.guess)}</p>
            <button type="button" className="ear-btn ear-btn-sm" onClick={() => ear.contrast(c.actual, c.guess)}>
              ▶ Drill: {c.actual} then {c.guess}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SettingsCard({ ear }: { ear: EarTrainer }) {
  const s = ear.settings;
  return (
    <section className="card ear-card ear-settings">
      <h3>Settings</h3>
      <label>
        <span>Sound</span>
        <div className="seg">
          {(["keys", "guitar"] as const).map((i) => (
            <button key={i} type="button" className={s.instrument === i ? "is-on" : ""} onClick={() => ear.updateSettings({ instrument: i })}>
              {i === "keys" ? "Keys" : "Guitar"}
            </button>
          ))}
        </div>
      </label>
      <label>
        <span>Pace</span>
        <input type="range" min={0.7} max={2.4} step={0.1} value={s.pace} onChange={(e) => ear.updateSettings({ pace: Number(e.target.value) })} />
        <span className="ear-muted">{s.pace.toFixed(1)}s</span>
      </label>
      {ear.mode === "chords" ? (
        <label>
          <span>Chords</span>
          <div className="seg">
            {[3, 4, 5, 6].map((n) => (
              <button key={n} type="button" className={s.length === n ? "is-on" : ""} onClick={() => ear.updateSettings({ length: n })}>
                {n}
              </button>
            ))}
          </div>
        </label>
      ) : null}
      <label>
        <span>Key</span>
        <select
          value={s.randomKey ? "random" : String(s.fixedKey)}
          onChange={(e) =>
            e.target.value === "random"
              ? ear.updateSettings({ randomKey: true })
              : ear.updateSettings({ randomKey: false, fixedKey: Number(e.target.value) })
          }
        >
          <option value="random">Random every round</option>
          {KEY_NAMES.map((k, i) => (
            <option key={k} value={i}>
              {k}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="ear-btn ear-btn-sm ear-reset" onClick={() => window.confirm("Reset progress for this style?") && ear.reset()}>
        Reset progress
      </button>
    </section>
  );
}

function Method() {
  return (
    <details className="card ear-method">
      <summary>Why this works</summary>
      <ol>
        <li>
          <b>Hear the key first.</b> Every round opens with a quick home cadence. Chords only have meaning relative to home.
        </li>
        <li>
          <b>Numbers, not letters.</b> You answer in Roman numerals and the key changes every round, so you learn the sound of
          "IV" — not "C to F" — and it works in every song.
        </li>
        <li>
          <b>Follow the bass.</b> The upper voices move smoothly like a real player's, so the bass line carries the most
          information. Stuck? Press <kbd>B</kbd> and hum along.
        </li>
        <li>
          <b>Learn from contrast.</b> When you miss, hear your answer against the real one and drill the pair. That's where
          the ear actually learns.
        </li>
        <li>
          <b>A few chords at a time.</b> You start with three. New ones unlock at 85%, and chords you miss come up more often.
        </li>
      </ol>
    </details>
  );
}
