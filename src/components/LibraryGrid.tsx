import { useState } from "react";
import { useSongSummaries } from "../overview/useSongSummaries";
import { songFill } from "../overview/map";
import type { LibraryIssue, TuneEntry } from "../tunes/library";
import type { SessionSetApi } from "../song/sessionSet";
import { Glyph } from "./Glyph";

// The library as cards: every saved song with what the session needs to know at a glance and
// the few things done to a song, each one a big target. Opening a card shows the song's page.

const keyLabel = (signature: string) => signature.replace("b", "♭").replace("#", "♯");

export function LibraryGrid({ library, issues, session, busy, onOpen, onPlay, onRemove, onImport, onRepair }: {
  library: TuneEntry[];
  issues: readonly LibraryIssue[];
  session: SessionSetApi;
  busy: boolean;
  onOpen(id: string): void;
  onPlay?(id: string): void;
  onRemove(id: string): void;
  onImport(): void;
  onRepair(id: string): void;
}) {
  const { songs } = useSongSummaries(library.length);
  const byId = new Map(songs.map((song) => [song.tuneId, song]));
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <section className="lib-grid" aria-label="Songs">
      {library.map((tune) => {
        const song = byId.get(tune.id);
        const title = song?.title ?? tune.name;
        const fill = song ? songFill(song) : 0;
        const inSession = session.has(tune.id);
        return (
          <article key={tune.id} className={`lib-card ${inSession ? "is-session" : ""}`}>
            <button type="button" className="lib-card-open" onClick={() => onOpen(tune.id)} disabled={busy} aria-label={`Open ${title}`}>
              <span className="lib-card-top">
                <span className="lib-card-key">{song ? keyLabel(song.key) : "Score"}</span>
                <span className="lib-card-pct">{Math.round(fill * 100)}%</span>
              </span>
              <span className="lib-card-title">{title}</span>
              <span className="lib-card-meta">{[song?.composer, song?.barCount ? `${song.barCount} bars` : null, song?.tempo ? `♩ ${song.tempo}` : null].filter(Boolean).join(" · ")}</span>
              <span className="lib-meter" aria-label={`${Math.round(fill * 100)}% of exercises climbed`}><i style={{ width: `${Math.max(fill * 100, fill > 0 ? 5 : 0)}%` }} /></span>
            </button>
            {confirming === tune.id ? (
              <div className="lib-card-confirm" role="group" aria-label={`Remove ${title}?`}>
                <p>Remove from the library? Practice history is kept.</p>
                <button type="button" className="lib-btn is-danger" onClick={() => { setConfirming(null); onRemove(tune.id); }} disabled={busy}>Remove</button>
                <button type="button" className="lib-btn" onClick={() => setConfirming(null)}>Keep</button>
              </div>
            ) : (
              <div className="lib-card-actions">
                <button type="button" className="lib-btn lib-session" aria-pressed={inSession} onClick={() => session.toggle(tune.id)}>
                  <Glyph name={inSession ? "check" : "plus"} size={18} />{inSession ? "In next session" : "Next session"}
                </button>
                {onPlay ? <button type="button" className="lib-btn lib-icon is-play" onClick={() => onPlay(tune.id)} disabled={busy} aria-label={`Play ${title} in guitar mode`} title="Play in Guitar mode"><Glyph name="play" size={17} /></button> : null}
                <button type="button" className="lib-btn lib-icon" onClick={() => setConfirming(tune.id)} disabled={busy} aria-label={`Remove ${title}`} title="Remove"><Glyph name="close" size={18} /></button>
              </div>
            )}
          </article>
        );
      })}
      {issues.map((issue) => (
        <article key={issue.id} className="lib-card is-broken">
          <div className="lib-card-open">
            <span className="lib-card-key">Needs repair</span>
            <span className="lib-card-title">{issue.name}</span>
            <span className="lib-card-meta">{issue.message}</span>
          </div>
          <div className="lib-card-actions">
            <button type="button" className="lib-btn" onClick={() => onRepair(issue.id)} disabled={busy}>Re-import</button>
            <button type="button" className="lib-btn lib-icon" onClick={() => onRemove(issue.id)} disabled={busy} aria-label={`Remove damaged ${issue.name}`}><Glyph name="close" size={18} /></button>
          </div>
        </article>
      ))}
      <button type="button" className="lib-import" onClick={onImport} disabled={busy}>
        <Glyph name="plus" size={28} />
        <strong>Add a score</strong>
        <small>MusicXML · .musicxml · .xml · .mxl — or drop files anywhere here</small>
      </button>
    </section>
  );
}
