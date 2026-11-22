import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { dueCount, keyStats, loadTriads, type Focus } from "../triads/box";
import {
  degreeTriad, germanName, keyId, keyName, MINOR_KEYS, noteName, parallelOf, relativeOf, romanOf, signatureOf, TRIAD_CARDS, TRIAD_KEY_BY_ID, TRIAD_KEYS, wheelPosition,
  type Naming, type TriadKey,
} from "../triads/triads";
import { today } from "../song/leitner";

// The circle of fifths as the way into the triads: major keys round the rim, their relative minors
// inside, each lit by how well it is known and dim until the drill has opened it. Choosing a key
// turns the wheel to bring it to the top and unfolds its seven triads in the middle; a triad, or the
// key's name at the centre, starts drilling that key. The centre of the closed wheel is the drill
// as it has opened. Every key and triad is a real button, so the guitar's cursor reaches them.

const C = 200;
const R_OUT = 196;
const R_MID = 136;
const R_IN = 84;
const R_DEG = 52;
const GAP = 0.7; // degrees between wedges

const polar = (r: number, a: number) => [C + r * Math.sin((a * Math.PI) / 180), C - r * Math.cos((a * Math.PI) / 180)];
function sector(r0: number, r1: number, a0: number, a1: number): string {
  const [x0, y0] = polar(r1, a0);
  const [x1, y1] = polar(r1, a1);
  const [x2, y2] = polar(r0, a1);
  const [x3, y3] = polar(r0, a0);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r1} ${r1} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}A${r0} ${r0} 0 ${large} 0 ${x3.toFixed(2)} ${y3.toFixed(2)}Z`;
}

/** Keys sharing a place on the circle (F♯ and G♭) split it between them. */
function placed(keys: readonly TriadKey[]): { key: TriadKey; angle: number; span: number }[] {
  return keys.map((k) => {
    const pos = wheelPosition(k);
    const twins = keys.filter((o) => wheelPosition(o) === pos);
    const i = twins.indexOf(k);
    const span = 30 / twins.length;
    return { key: k, angle: pos * 30 - 15 + span * (i + 0.5), span };
  });
}
const MAJORS = placed(TRIAD_KEYS);
const MINORS = placed(MINOR_KEYS);

const shortName = (k: TriadKey, naming: Naming) =>
  k.mode === "major" ? noteName(k.name, naming) : naming === "german" ? germanName(k.name).toLowerCase() : `${k.name}m`;

export function TriadWheel({ onDrill }: { onDrill(focus: Focus | null): void }) {
  const [store] = useState(loadTriads);
  const naming: Naming = store.naming ?? "german";
  const day = today();
  const stats = useMemo(() => keyStats(store, day), [store, day]);
  const due = useMemo(() => dueCount(store, day), [store, day]);
  const known = useMemo(() => TRIAD_CARDS.filter((c) => (store.cards[c.id]?.box ?? 0) >= 2).length, [store]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null); // a wedge and its label light together
  const pick = (id: string) => setChosen(chosen === id ? null : id);
  const key = chosen ? TRIAD_KEY_BY_ID.get(chosen)! : null;
  const pos = key ? wheelPosition(key) : 0;
  const spin = key ? -(pos <= 6 ? pos : pos - 12) * 30 : 0;

  useEffect(() => {
    const esc = (event: KeyboardEvent) => { if (event.key === "Escape" && chosen) { event.preventDefault(); setChosen(null); } };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [chosen]);

  const wedge = (k: TriadKey, angle: number, span: number, r0: number, r1: number, minor = false) => {
    const s = stats.get(keyId(k))!;
    const depth = s.total ? s.known / s.total : 0;
    const hue = (wheelPosition(k) * 30 + 40) % 360;
    const id = keyId(k);
    const here = chosen === id;
    // the whole wedge answers the pointer; its label is the button for the keyboard and the guitar
    return (
      <path
        key={id}
        d={sector(r0, r1, angle - span / 2 + GAP / 2, angle + span / 2 - GAP / 2)}
        className={`wheel-wedge ${minor ? "is-minor" : ""} ${s.open ? "is-open" : ""} ${here ? "is-here" : ""} ${hover === id ? "is-hover" : ""}`}
        style={{ "--hue": hue, "--depth": depth.toFixed(3) } as CSSProperties}
        onClick={() => pick(id)}
        onMouseEnter={() => setHover(id)}
        onMouseLeave={() => setHover((h) => (h === id ? null : h))}
      />
    );
  };
  const spot = (k: TriadKey, angle: number, r: number, minor: boolean) => {
    const id = keyId(k);
    const s = stats.get(id)!;
    return (
      <span key={id} className="wheel-spot" style={{ "--a": `${angle}deg`, "--r": r / 400 } as CSSProperties}>
        <button
          type="button"
          className={`wheel-key ${minor ? "is-minor" : ""} ${s.open ? "is-open" : ""} ${chosen === id ? "is-here" : ""}`}
          onClick={() => pick(id)}
          onMouseEnter={() => setHover(id)}
          onMouseLeave={() => setHover((h) => (h === id ? null : h))}
          aria-label={`${keyName(k, naming)}${s.open ? "" : ", not yet opened"}, ${s.known} of ${s.total} known`}
          aria-pressed={chosen === id}
        >
          <b>{shortName(k, naming)}</b>
          {!minor && signatureOf(k) ? <small>{signatureOf(k)}</small> : null}
        </button>
      </span>
    );
  };

  const degrees = key ? Array.from({ length: 7 }, (_, d) => ({ d, triad: degreeTriad(key, d), roman: romanOf(key, d), box: stats.get(keyId(key))!.boxes[d] })) : [];
  const stat = key ? stats.get(keyId(key))! : null;
  const relative = key ? relativeOf(key) : null;
  const parallel = key ? parallelOf(key) : null;

  return (
    <main className="triads triads-home">
      <div className={`wheel ${key ? "is-open" : ""}`} style={{ "--spin": `${spin}deg` } as CSSProperties}>
        <div className="wheel-spin">
          <svg viewBox="0 0 400 400" aria-hidden="true" data-nav-skip>
            <defs>
              <linearGradient id="wheel-metal" x1="30" y1="10" x2="370" y2="390" gradientUnits="userSpaceOnUse">
                <stop stopColor="#dbd7bc" stopOpacity=".55" /><stop offset=".4" stopColor="#9cae94" stopOpacity=".12" /><stop offset=".75" stopColor="#a8b89b" stopOpacity=".3" /><stop offset="1" stopColor="#d3ae7a" stopOpacity=".5" />
              </linearGradient>
            </defs>
            {MAJORS.map(({ key: k, angle, span }) => wedge(k, angle, span, R_MID + 1, R_OUT))}
            {MINORS.map(({ key: k, angle, span }) => wedge(k, angle, span, R_IN, R_MID - 1, true))}
            <circle cx={C} cy={C} r={R_OUT + 2} fill="none" stroke="url(#wheel-metal)" strokeWidth=".8" />
            <circle cx={C} cy={C} r={R_MID} fill="none" stroke="url(#wheel-metal)" strokeWidth=".5" />
            <circle cx={C} cy={C} r={R_IN - 1} fill="none" stroke="url(#wheel-metal)" strokeWidth=".5" />
            {Array.from({ length: 12 }, (_, i) => { const [x0, y0] = polar(R_OUT + 3, i * 30 - 15); const [x1, y1] = polar(R_OUT + 9, i * 30 - 15); return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke="url(#wheel-metal)" strokeWidth=".7" />; })}
          </svg>
          {MAJORS.map(({ key: k, angle }) => spot(k, angle, (R_MID + R_OUT) / 2, false))}
          {!key ? MINORS.map(({ key: k, angle }) => spot(k, angle, (R_IN + R_MID) / 2, true)) : null}
        </div>

        {key ? (
          <div className="wheel-inset" key={chosen}>
            <svg viewBox="0 0 400 400" aria-hidden="true" data-nav-skip>
              {degrees.map(({ d, box }) => (
                <path
                  key={d}
                  d={sector(R_DEG, R_MID - 2, d * (360 / 7) - 360 / 14 + GAP, d * (360 / 7) + 360 / 14 - GAP)}
                  className={`wheel-degree-wedge ${hover === `deg:${d}` ? "is-hover" : ""}`}
                  style={{ "--box": box / 5 } as CSSProperties}
                  onClick={() => onDrill({ key: keyId(key), degree: d })}
                  onMouseEnter={() => setHover(`deg:${d}`)}
                  onMouseLeave={() => setHover((h) => (h === `deg:${d}` ? null : h))}
                />
              ))}
              <circle cx={C} cy={C} r={R_DEG - 3} className="wheel-core" />
            </svg>
            {degrees.map(({ d, triad, roman, box }) => (
              <span key={d} className="wheel-spot is-flat" style={{ "--a": `${d * (360 / 7)}deg`, "--r": (R_DEG + R_MID) / 2 / 400 } as CSSProperties}>
                <button type="button" className={`wheel-degree ${box >= 2 ? "is-known" : ""}`} onClick={() => onDrill({ key: keyId(key), degree: d })} onMouseEnter={() => setHover(`deg:${d}`)} onMouseLeave={() => setHover((h) => (h === `deg:${d}` ? null : h))} aria-label={`${roman} of ${keyName(key, naming)}: ${triad.notes.map((n) => noteName(n, naming)).join(" ")}, box ${box}`}>
                  <b>{roman}</b>
                  <small>{triad.notes.map((n) => noteName(n, naming)).join(" ")}</small>
                </button>
              </span>
            ))}
            <button type="button" className="wheel-center is-key" onClick={() => onDrill({ key: keyId(key) })}>
              <b>{keyName(key, naming)}</b>
              <small>practice</small>
            </button>
          </div>
        ) : (
          <button type="button" className="wheel-center" onClick={() => onDrill(null)}>
            <b>Drill</b>
            <small>{due ? `${due} due` : "all of it"}</small>
          </button>
        )}
      </div>

      <section className="wheel-panel" aria-live="polite">
        {key && stat ? (
          <>
            <p className="wheel-panel-key">{keyName(key, naming)}{signatureOf(key) ? <span>{signatureOf(key)}</span> : null}</p>
            <p className="wheel-panel-stats"><span>{stat.known}/{stat.total} known</span>{stat.due ? <span>{stat.due} due</span> : null}<span>{stat.open ? "open" : "not yet opened"}</span></p>
            <div className="wheel-panel-actions">
              {relative ? <button type="button" onClick={() => setChosen(keyId(relative))}>{keyName(relative, naming)}<small>relative</small></button> : null}
              {parallel ? <button type="button" onClick={() => setChosen(keyId(parallel))}>{keyName(parallel, naming)}<small>parallel</small></button> : null}
              <button type="button" onClick={() => setChosen(null)} aria-label="Back to the whole circle">◎</button>
            </div>
          </>
        ) : (
          <p className="wheel-panel-stats"><span>{due} due</span><span>{known}/{TRIAD_CARDS.length} known</span></p>
        )}
      </section>
    </main>
  );
}
