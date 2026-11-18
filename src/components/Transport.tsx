import { useEffect } from "react";
import type { Mix, PlayerApi, Tune } from "../core/contract";

interface TransportProps {
  player: PlayerApi;
  tune: Tune;
  guideAudible: boolean;
  onGuideAudible: (on: boolean) => void;
}

const MIX_KEYS: { key: keyof Mix; label: string }[] = [
  { key: "click", label: "Click" },
  { key: "bass", label: "Bass" },
  { key: "comp", label: "Keys" },
  { key: "drums", label: "Drums" },
];

export function Transport({ player, tune, guideAudible, onGuideAudible }: TransportProps) {
  // Space toggles playback unless typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "BUTTON")) return;
      e.preventDefault();
      void player.toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player]);

  const beats = [0, 1, 2, 3];

  return (
    <div className="transport" role="toolbar" aria-label="transport">
      <button
        type="button"
        className={`play-btn ${player.isPlaying ? "is-playing" : ""}`}
        onClick={() => void player.toggle()}
        aria-label={player.isPlaying ? "Stop" : "Play"}
        title="Space"
      >
        {player.isPlaying ? (
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" /></svg>
        )}
      </button>

      <div className="beat-dots" aria-hidden="true">
        {beats.map((b) => (
          <span
            key={b}
            className={`beat-dot ${player.isPlaying && player.currentBeat === b ? "is-on" : ""} ${b === 0 ? "is-one" : ""}`}
          />
        ))}
      </div>

      <div className="tempo">
        <button type="button" className="step-btn" onClick={() => player.setBpm(Math.max(40, player.bpm - 4))}>
          −
        </button>
        <label className="tempo-read">
          <input
            type="number"
            min={40}
            max={220}
            value={player.bpm}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) player.setBpm(Math.min(220, Math.max(40, v)));
            }}
            aria-label="tempo"
          />
          <span>bpm</span>
        </label>
        <button type="button" className="step-btn" onClick={() => player.setBpm(Math.min(220, player.bpm + 4))}>
          +
        </button>
      </div>

      <label className="slider">
        <span>Swing</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={player.swing}
          onChange={(e) => player.setSwing(Number(e.target.value))}
        />
      </label>

      <div className="toggles">
        <button
          type="button"
          className={`pill ${player.clickOn24 ? "is-on" : ""}`}
          onClick={() => player.setClickOn24(!player.clickOn24)}
          title="Click on beats 2 and 4 only"
        >
          2 &amp; 4
        </button>
        <button
          type="button"
          className={`pill ${player.countIn ? "is-on" : ""}`}
          onClick={() => player.setCountIn(!player.countIn)}
        >
          Count-in
        </button>
        <button
          type="button"
          className={`pill ${guideAudible ? "is-on" : ""}`}
          onClick={() => onGuideAudible(!guideAudible)}
          title="Play the selected pattern along"
        >
          Guide melody
        </button>
      </div>

      <details className="mixer">
        <summary className="pill">Mix</summary>
        <div className="mixer-pop">
          {MIX_KEYS.map(({ key, label }) => (
            <label className="slider" key={key}>
              <span>{label}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={player.mix[key]}
                onChange={(e) => player.setMix({ [key]: Number(e.target.value) })}
              />
            </label>
          ))}
        </div>
      </details>

      <div className="loop-parts" role="group" aria-label="loop a part">
        {[{ name: "All", start: 0, end: tune.bars.length - 1 }, ...sectionRanges(tune)].map((p) => {
          const active = player.loop.start === p.start && player.loop.end === p.end;
          return (
            <button
              key={p.name}
              type="button"
              className={`loop-part ${active ? "is-active" : ""}`}
              aria-pressed={active}
              title={`Loop ${p.name === "All" ? "the whole tune" : `part ${p.name}`} (bars ${p.start + 1}–${p.end + 1})`}
              onClick={() => player.setLoop(p.start, p.end)}
            >
              {p.name}
            </button>
          );
        })}
      </div>

      <span className="loop-read">
        {player.loop.start === player.loop.end
          ? `looping bar ${player.loop.start + 1}`
          : `looping bars ${player.loop.start + 1}–${player.loop.end + 1}`}
        {!player.ready ? <em> · loading sounds…</em> : null}
      </span>
    </div>
  );
}

function sectionRanges(tune: Tune): { name: string; start: number; end: number }[] {
  const out: { name: string; start: number; end: number }[] = [];
  for (const bar of tune.bars) {
    const last = out[out.length - 1];
    if (last && last.name === bar.section) last.end = bar.index;
    else out.push({ name: bar.section, start: bar.index, end: bar.index });
  }
  return out;
}
