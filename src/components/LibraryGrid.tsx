import { useEffect, useMemo, useRef, useState } from "react";
import { useSongSummaries } from "../overview/useSongSummaries";
import { buildCatalog, filterCatalog, type CatalogSong, type LibraryFilter, type LibrarySort } from "../tunes/catalog";
import type { LibraryIssue, TuneEntry } from "../tunes/library";
import type { SessionSetApi } from "../song/sessionSet";
import { relativeDay } from "../overview/visual";
import { today } from "../song/leitner";
import { ChordSymbol } from "./LeadSheet";
import { Glyph } from "./Glyph";

// User-journey-first Library: fast search by title/artist/key/chords, scannable list view,
// 1-click chords & lyrics for jamming with friends, and an interactive song inspector.

const FILTER_LABELS: { id: LibraryFilter; label: string }[] = [
  { id: "all", label: "All songs" },
  { id: "session", label: "Next session" },
  { id: "chords", label: "With chords" },
  { id: "lyrics", label: "With lyrics" },
];

export function LibraryGrid({
  library,
  issues,
  session,
  busy,
  onOpen,
  onCampfire,
  onPlay,
  onRemove,
  onImport,
  onRepair,
}: {
  library: TuneEntry[];
  issues: readonly LibraryIssue[];
  session: SessionSetApi;
  busy: boolean;
  onOpen(id: string): void;
  onCampfire?(id: string): void;
  onPlay?(id: string): void;
  onRemove(id: string): void;
  onImport(): void;
  onRepair(id: string): void;
}) {
  const { songs } = useSongSummaries(library.length);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [sort, setSort] = useState<LibrarySort>("recent");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const day = today();

  // Quick `/` shortcut focuses repertoire search (just like real songbook/music apps)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const catalog = useMemo(
    () => buildCatalog(library, songs, (id) => session.has(id)),
    [library, songs, session],
  );

  const visible = useMemo(
    () => filterCatalog(catalog, query, filter, sort),
    [catalog, query, filter, sort],
  );

  const counts = useMemo(() => ({
    all: catalog.length,
    session: catalog.filter((s) => s.inSession).length,
    chords: catalog.filter((s) => s.hasChords).length,
    lyrics: catalog.filter((s) => s.hasLyrics).length,
  }), [catalog]);

  // Keep inspector focused on a visible song if one was picked, else default to first visible on wide screens
  const activeSong: CatalogSong | null = useMemo(() => {
    if (!visible.length) return null;
    return visible.find((item) => item.id === selectedId) ?? visible[0];
  }, [visible, selectedId]);

  return (
    <section className="lib-workspace" aria-label="Song library">
      {/* Search, filter & sort command strip */}
      <div className="lib-toolbar">
        <div className="lib-search-wrap">
          <Glyph name="search" size={16} />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by song, artist, key, or chord…"
            aria-label="Search library"
          />
          {query ? (
            <button type="button" className="lib-search-clear" onClick={() => setQuery("")} aria-label="Clear search">
              <Glyph name="close" size={14} />
            </button>
          ) : (
            <kbd className="lib-kbd" aria-hidden="true">/</kbd>
          )}
        </div>

        <div className="lib-filters" role="group" aria-label="Filter songs">
          {FILTER_LABELS.map((item) => {
            const count = counts[item.id];
            if (item.id !== "all" && count === 0) return null;
            return (
              <button
                key={item.id}
                type="button"
                className={`lib-filter-pill ${filter === item.id ? "is-on" : ""}`}
                aria-pressed={filter === item.id}
                onClick={() => setFilter(item.id)}
              >
                <span>{item.label}</span>
                <small>{count}</small>
              </button>
            );
          })}
        </div>

        <label className="lib-sort">
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as LibrarySort)} aria-label="Sort songs">
            <option value="recent">Recent &amp; session</option>
            <option value="title">Title A–Z</option>
            <option value="artist">Artist A–Z</option>
            <option value="progress">Mastery</option>
          </select>
        </label>
      </div>

      {/* Main split layout: rapid scannable list + interactive song dock */}
      <div className="lib-split">
        <div className="lib-list-col">
          {!library.length && !issues.length ? (
            <div className="lib-empty-panel">
              <Glyph name="melody" size={28} />
              <h3>Your songbook is empty</h3>
              <p>Drop guitar song files anywhere on this page or add your first piece to start building your repertoire.</p>
              <button type="button" className="lib-btn is-primary" onClick={onImport} disabled={busy}>
                <Glyph name="plus" size={18} />Add songs
              </button>
            </div>
          ) : !visible.length ? (
            <div className="lib-empty-panel is-compact">
              <p>No songs match <strong>{query || FILTER_LABELS.find((f) => f.id === filter)?.label}</strong>.</p>
              <button type="button" className="lib-btn" onClick={() => { setQuery(""); setFilter("all"); }}>
                Reset filters
              </button>
            </div>
          ) : (
            <div className="lib-list" role="list" aria-label="Songs">
              {visible.map((song) => {
                const isSelected = activeSong?.id === song.id;
                const pct = Math.round(song.fill * 100);
                return (
                  <article
                    key={song.id}
                    role="listitem"
                    className={`lib-row ${isSelected ? "is-selected" : ""} ${song.inSession ? "is-session" : ""}`}
                  >
                    <button
                      type="button"
                      className="lib-row-main"
                      onClick={() => { setSelectedId(song.id); setConfirming(null); }}
                      onDoubleClick={() => onOpen(song.id)}
                      aria-current={isSelected ? "true" : undefined}
                      aria-label={`Select ${song.title}`}
                    >
                      <span className="lib-row-key" title={`Key of ${song.keyDisplay}`}>{song.keyDisplay}</span>
                      <span className="lib-row-copy">
                        <strong className="lib-row-title">{song.title}</strong>
                        <span className="lib-row-sub">
                          {song.artist ? <span className="lib-row-artist">{song.artist}</span> : null}
                          {song.tempo ? <span>♩ {song.tempo}</span> : null}
                          {song.hasChords ? <span className="lib-tag is-chords">Chords</span> : null}
                          {song.hasLyrics ? <span className="lib-tag is-lyrics">Lyrics</span> : null}
                        </span>
                      </span>
                      <span className="lib-row-meter" title={`${pct}% of exercises climbed`}>
                        <small>{pct}%</small>
                        <span className="lib-meter"><i style={{ width: `${Math.max(pct, pct > 0 ? 6 : 0)}%` }} /></span>
                      </span>
                    </button>

                    <div className="lib-row-quick">
                      {onCampfire ? (
                        <button
                          type="button"
                          className="lib-quick-btn is-jam"
                          onClick={() => onCampfire(song.id)}
                          disabled={busy}
                          title="Chords & lyrics (jam sheet)"
                          aria-label={`Chords and lyrics for ${song.title}`}
                        >
                          <Glyph name="chords" size={16} />
                          <span>Chords</span>
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={`lib-quick-btn is-toggle ${song.inSession ? "is-on" : ""}`}
                        aria-pressed={song.inSession}
                        onClick={() => session.toggle(song.id)}
                        title={song.inSession ? "In next practice session" : "Add to next practice session"}
                        aria-label={song.inSession ? `Remove ${song.title} from next session` : `Add ${song.title} to next session`}
                      >
                        <Glyph name={song.inSession ? "check" : "plus"} size={15} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {issues.length ? (
            <div className="lib-issues-list" aria-label="Songs needing repair">
              {issues.map((issue) => (
                <article key={issue.id} className="lib-row is-broken">
                  <div className="lib-row-main">
                    <span className="lib-row-key is-warn">!</span>
                    <span className="lib-row-copy">
                      <strong className="lib-row-title">{issue.name}</strong>
                      <span className="lib-row-sub">{issue.message}</span>
                    </span>
                  </div>
                  <div className="lib-row-quick">
                    <button type="button" className="lib-quick-btn" onClick={() => onRepair(issue.id)} disabled={busy}>Re-import</button>
                    <button type="button" className="lib-quick-btn" onClick={() => onRemove(issue.id)} disabled={busy} aria-label={`Remove damaged ${issue.name}`}>
                      <Glyph name="close" size={15} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </div>

        {/* Interactive song inspector: immediate actions & chord glimpse when a song is clicked */}
        {activeSong ? (
          <aside className="lib-inspector" aria-label={`Selected song: ${activeSong.title}`}>
            <div className="lib-insp-head">
              <div className="lib-insp-badges">
                <span className="lib-card-key">{activeSong.keyDisplay}</span>
                {activeSong.tempo ? <span className="lib-insp-pill">♩ {activeSong.tempo} bpm</span> : null}
                {activeSong.partCount > 1 ? <span className="lib-insp-pill">{activeSong.partCount} parts</span> : null}
              </div>
              <h3>{activeSong.title}</h3>
              {activeSong.artist ? <p className="lib-insp-artist">{activeSong.artist}</p> : null}
            </div>

            {/* Instant mastery & recency pulse */}
            <div className="lib-insp-pulse">
              <div>
                <span>Mastery</span>
                <strong>{Math.round(activeSong.fill * 100)}%</strong>
              </div>
              <div>
                <span>Last played</span>
                <strong>{activeSong.lastPlayed ? relativeDay(activeSong.lastPlayed, day) : "Not yet"}</strong>
              </div>
              <div>
                <span>Session</span>
                <strong>{activeSong.inSession ? "Queued" : "Not queued"}</strong>
              </div>
            </div>
            <span className="lib-meter is-wide" aria-hidden="true">
              <i style={{ width: `${Math.max(activeSong.fill * 100, activeSong.fill > 0 ? 5 : 0)}%` }} />
            </span>

            {/* Instant chord preview for jamming with friends */}
            {activeSong.chordPalette.length ? (
              <div className="lib-insp-chords">
                <p className="lib-insp-label">Chords in this song</p>
                <div className="lib-chord-chips">
                  {activeSong.chordPalette.map((sym) => (
                    <span key={sym} className="lib-chord-chip">
                      <ChordSymbol symbol={sym} />
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Primary user-journey actions */}
            <div className="lib-insp-actions">
              {onCampfire ? (
                <button
                  type="button"
                  className="lib-btn is-jam-primary"
                  onClick={() => onCampfire(activeSong.id)}
                  disabled={busy}
                >
                  <Glyph name="chords" size={18} />
                  <span>Chords &amp; lyrics</span>
                </button>
              ) : null}
              {onPlay ? (
                <button
                  type="button"
                  className="lib-btn is-primary"
                  onClick={() => onPlay(activeSong.id)}
                  disabled={busy}
                >
                  <Glyph name="play" size={16} />
                  <span>Practice</span>
                </button>
              ) : null}
              <button
                type="button"
                className="lib-btn"
                onClick={() => onOpen(activeSong.id)}
                disabled={busy}
              >
                <Glyph name="reading" size={17} />
                <span>Full score &amp; listen</span>
              </button>
              <button
                type="button"
                className="lib-btn"
                aria-pressed={activeSong.inSession}
                onClick={() => session.toggle(activeSong.id)}
              >
                <Glyph name={activeSong.inSession ? "check" : "plus"} size={17} />
                <span>{activeSong.inSession ? "In next session" : "Add to next session"}</span>
              </button>
            </div>

            {/* Remove from collection with safe inline confirmation */}
            <div className="lib-insp-foot">
              {confirming === activeSong.id ? (
                <div className="lib-insp-confirm" role="group" aria-label={`Remove ${activeSong.title}?`}>
                  <p>Remove from your collection? Your practice history is kept.</p>
                  <div>
                    <button
                      type="button"
                      className="lib-btn is-danger"
                      onClick={() => { setConfirming(null); onRemove(activeSong.id); }}
                      disabled={busy}
                    >
                      Remove
                    </button>
                    <button type="button" className="lib-btn" onClick={() => setConfirming(null)}>
                      Keep
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="lib-remove-link"
                  onClick={() => setConfirming(activeSong.id)}
                  disabled={busy}
                >
                  <Glyph name="close" size={14} />
                  <span>Remove from library</span>
                </button>
              )}
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  );
}
