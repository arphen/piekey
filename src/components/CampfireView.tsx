import { useEffect, useMemo, useState } from "react";
import { parseTuneEntry, type TuneEntry } from "../tunes/library";
import { buildCampfireSheet } from "../tunes/campfire";
import { ChordBox } from "./ChordBox";
import { Glyph } from "./Glyph";
import { ChordSymbol } from "./LeadSheet";
import "../tunes/campfire.css";

interface CampfireViewProps {
  library: TuneEntry[];
  initialTuneId: string | null;
  onClose(): void;
  onOpenScore(tuneId: string): void;
  onPractice(tuneId: string): void;
}

type ScrollSpeed = 0 | 1 | 2;
const SCROLL_PX_PER_SEC: Record<ScrollSpeed, number> = { 0: 0, 1: 18, 2: 34 };
const SCROLL_LABEL: Record<ScrollSpeed, string> = { 0: "Auto-scroll: Off", 1: "Auto-scroll: Slow", 2: "Auto-scroll: Medium" };

export function CampfireView({ library, initialTuneId, onClose, onOpenScore, onPractice }: CampfireViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(initialTuneId);
  const [query, setQuery] = useState("");
  const [transpose, setTranspose] = useState(0);
  const [showDiagrams, setShowDiagrams] = useState(true);
  const [scrollSpeed, setScrollSpeed] = useState<ScrollSpeed>(0);
  const [awake, setAwake] = useState(false);

  // Reset transpose & auto-scroll when switching songs
  useEffect(() => {
    setTranspose(0);
    setScrollSpeed(0);
  }, [selectedId]);

  // Request Screen Wake Lock while Campfire view is open so the screen stays lit off-grid
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null;
    let active = true;
    const wakeLock = (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock;
    if (wakeLock?.request) {
      void wakeLock.request("screen").then((sentinel) => {
        if (!active) { void sentinel.release().catch(() => undefined); return; }
        lock = sentinel;
        setAwake(true);
      }).catch(() => { if (active) setAwake(false); });
    }
    return () => {
      active = false;
      setAwake(false);
      if (lock) void lock.release().catch(() => undefined);
    };
  }, []);

  // Gentle hands-free auto-scroll
  useEffect(() => {
    if (scrollSpeed === 0 || !selectedId) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      window.scrollBy(0, SCROLL_PX_PER_SEC[scrollSpeed] * dt);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [scrollSpeed, selectedId]);

  // Index metadata for fast search/browsing
  const catalog = useMemo(() => {
    return library.map((entry) => {
      try {
        const sheet = parseTuneEntry(entry);
        return {
          id: entry.id,
          title: sheet.title,
          composer: sheet.composer,
          key: sheet.keySignature,
          bars: sheet.bars.length,
          hasChords: Boolean(sheet.source?.hasChords),
          hasLyrics: sheet.bars.some((b) => Boolean(b.lyrics)),
          sheet,
        };
      } catch {
        return {
          id: entry.id,
          title: entry.name,
          composer: "",
          key: "",
          bars: 0,
          hasChords: false,
          hasLyrics: false,
          sheet: null,
        };
      }
    });
  }, [library]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.composer.toLowerCase().includes(q) ||
        item.key.toLowerCase().includes(q),
    );
  }, [catalog, query]);

  const activeItem = selectedId ? catalog.find((c) => c.id === selectedId) ?? null : null;
  const campfire = useMemo(
    () => (activeItem?.sheet ? buildCampfireSheet(activeItem.sheet, transpose) : null),
    [activeItem?.sheet, transpose],
  );

  // Songbook index view
  if (!selectedId || !campfire) {
    return (
      <main className="campfire" aria-label="Campfire songbook">
        <header className="cf-head">
          <div>
            <button type="button" className="tunes-back" onClick={onClose}><Glyph name="arrow" size={18} />Library</button>
            <p className="tunes-kicker">Campfire songbook</p>
            <h2>Offline chords &amp; lyrics</h2>
            <p className="tunes-byline">{library.length} song{library.length === 1 ? "" : "s"} saved on this device{awake ? " · Screen kept awake" : ""}</p>
          </div>
        </header>

        <div className="cf-search">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by song, artist, or key…"
            aria-label="Filter songbook"
          />
        </div>

        {!filtered.length ? (
          <p className="tunes-note">
            {library.length ? "No songs match that filter." : "Your library is empty. Import Guitar Pro (.gp) or MusicXML scores in Library first."}
          </p>
        ) : (
          <div className="cf-list">
            {filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                className="cf-song-row"
                onClick={() => setSelectedId(item.id)}
                disabled={!item.sheet}
              >
                <span className="cf-song-main">
                  <strong>{item.title}</strong>
                  <small>{[item.composer, item.bars ? `${item.bars} bars` : null].filter(Boolean).join(" · ")}</small>
                </span>
                <span className="cf-song-tags">
                  {item.key ? <span className="cf-pill">{item.key}</span> : null}
                  {item.hasChords ? <span className="cf-pill is-chords">Chords</span> : <span className="cf-pill is-muted">No chords</span>}
                  {item.hasLyrics ? <span className="cf-pill is-lyrics">Lyrics</span> : null}
                </span>
              </button>
            ))}
          </div>
        )}
      </main>
    );
  }

  const capoHint = transpose < 0 ? ` · Capo ${-transpose}` : transpose > 0 ? ` · +${transpose} st` : "";

  return (
    <main className="campfire is-sheet" aria-label={`${campfire.title} campfire sheet`}>
      <header className="cf-sticky">
        <div className="cf-sticky-top">
          <button type="button" className="cf-btn" onClick={() => setSelectedId(null)}><Glyph name="library" size={16} />Songbook</button>
          <div className="cf-title-wrap">
            <h2>{campfire.title}</h2>
            <p>{[campfire.composer, `Key ${campfire.key}${capoHint}`, campfire.tempo ? `♩ ${campfire.tempo}` : null, awake ? "Awake" : null].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
        <div className="cf-controls" role="toolbar" aria-label="Campfire controls">
          <div className="cf-transpose" role="group" aria-label="Transpose chords">
            <button type="button" className="cf-btn" aria-label="Transpose down" onClick={() => setTranspose((v) => Math.max(-11, v - 1))}>−</button>
            <span>{transpose === 0 ? "Original" : transpose < 0 ? `Capo ${-transpose}` : `+${transpose}`}</span>
            <button type="button" className="cf-btn" aria-label="Transpose up" onClick={() => setTranspose((v) => Math.min(11, v + 1))}>+</button>
            {transpose !== 0 ? <button type="button" className="cf-btn" onClick={() => setTranspose(0)}>Reset</button> : null}
          </div>
          {campfire.palette.length ? (
            <button type="button" className="cf-btn" aria-pressed={showDiagrams} onClick={() => setShowDiagrams((v) => !v)}>
              {showDiagrams ? "Hide shapes" : "Chord shapes"}
            </button>
          ) : null}
          <button
            type="button"
            className="cf-btn"
            aria-pressed={scrollSpeed > 0}
            onClick={() => setScrollSpeed((v) => ((v + 1) % 3) as ScrollSpeed)}
          >
            {SCROLL_LABEL[scrollSpeed]}
          </button>
          <button type="button" className="cf-btn" onClick={() => onOpenScore(campfire.id)}>Full score</button>
          <button type="button" className="cf-btn is-primary" onClick={() => onPractice(campfire.id)}><Glyph name="play" size={15} />Practice</button>
        </div>
      </header>

      {showDiagrams && campfire.palette.length ? (
        <section className="cf-palette" aria-label="Chord shapes">
          {campfire.palette.map((item) => (
            <div key={item.symbol} className="cf-diagram-card">
              <div className="cf-diagram-name"><ChordSymbol symbol={item.symbol} /></div>
              <ChordBox voicing={item.voicing} size="small" />
            </div>
          ))}
        </section>
      ) : null}

      {!campfire.hasChords ? (
        <p className="tunes-note">This score has no chord symbols yet. You can still view sections, lyrics, or open the full score.</p>
      ) : null}

      <div className="cf-sections">
        {campfire.sections.map((section) => (
          <section key={`${section.title}-${section.startBar}`} className="cf-section">
            <h3 className="cf-section-title">{section.title}</h3>
            <div className="cf-grid">
              {section.bars.map((bar) => (
                <div
                  key={bar.index}
                  className={`cf-bar ${bar.repeatStart ? "is-rep-start" : ""} ${bar.repeatEnd ? "is-rep-end" : ""}`}
                >
                  <span className="cf-bar-num">{bar.barNumber}</span>
                  <div className="cf-bar-chords">
                    {bar.chords.length ? (
                      bar.chords.map((sym, ci) => (
                        <span key={`${sym}-${ci}`} className="cf-chord">
                          <ChordSymbol symbol={sym} />
                        </span>
                      ))
                    ) : (
                      <span className="cf-chord-empty">/</span>
                    )}
                  </div>
                  {bar.lyrics ? <p className="cf-bar-lyric">{bar.lyrics}</p> : null}
                  {bar.repeatEnd && bar.repeatEnd > 1 ? <span className="cf-rep-count">×{bar.repeatEnd}</span> : null}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
