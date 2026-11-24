import { useMemo, useRef, useState, type CSSProperties } from "react";
import { TUTOR_MODES, type TutorTargetTab } from "../overview/modes";
import { cachedSong, useSongSummaries } from "../overview/useSongSummaries";
import { keyName, practiceMap, songFill, songKey, type MapSong } from "../overview/map";
import type { SongSummary } from "../overview/summary";
import { loadLibraryAsync, saveCurrentTuneId, saveLibrary } from "../tunes/library";
import { DEMO_TUNES, type DemoTune } from "../tunes/demos";
import { useSessionSet } from "../song/sessionSet";
import type { InputApi } from "../listen/useInput";
import { Glyph } from "./Glyph";
import { SongMap } from "./SongMap";
import "../overview/overview.css";
import "../overview/home.css";

// Home: the player's map and what the next session holds. The map is the circle of fifths with
// every song beside its key, growing as songs and drills climb the card box. The rail holds the
// songs the next session draws from, big enough to change with a hand off the guitar, the way
// into guitar mode, and the focused drills. Nothing here is "due": the player chooses.

const DRILLS = TUTOR_MODES.filter((mode) => mode.id !== "song");

function ConnectGuitar({ input }: { input: InputApi }) {
  const starting = input.status === "starting";
  return (
    <div className="hm-connect">
      <button type="button" onClick={() => void input.start()} disabled={starting}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 3v9a3 3 0 0 0 6 0V3a3 3 0 0 0-6 0ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" /></svg>
        {starting ? "Connecting…" : input.status === "error" ? "Retry guitar input" : "Connect your guitar"}
      </button>
      {input.status === "error" && input.error ? <p className="hm-error" role="alert">{input.error}</p> : null}
    </div>
  );
}


function Progress({ song }: { song: SongSummary }) {
  const fill = songFill(song);
  return <span className="hm-meter" aria-label={`${Math.round(fill * 100)}% of exercises climbed`}><i style={{ width: `${Math.max(fill * 100, fill > 0 ? 4 : 0)}%` }} /></span>;
}

export function OverviewView({
  input,
  onOpenMode,
  onOpenSong,
  onOpenLibrary,
  onListenSong,
  onStartPractice,
}: {
  input?: InputApi;
  onOpenMode: (target: TutorTargetTab) => void;
  onOpenSong: (tuneId: string) => void;
  onOpenLibrary?: () => void;
  onListenSong?: (tuneId: string) => void;
  onStartPractice: (tuneId: string, cardId?: string, prepared?: boolean) => void;
}) {
  const [revision, setRevision] = useState(0);
  const { songs, currentTuneId, loading, error, issues = [] } = useSongSummaries(revision);
  const libraryIds = useMemo(() => songs.map((song) => song.tuneId), [songs]);
  const session = useSessionSet(libraryIds);
  const [lead, setLead] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const demoLock = useRef(false);
  const byId = useMemo(() => new Map(songs.map((song) => [song.tuneId, song])), [songs]);

  const chosenLead = lead ?? currentTuneId;
  const leadId = chosenLead && session.has(chosenLead) ? chosenLead : session.ids[0] ?? (chosenLead && byId.has(chosenLead) ? chosenLead : songs[0]?.tuneId ?? null);
  const sessionSongs = useMemo(() => {
    const listed = session.ids.flatMap((id) => byId.get(id) ?? []);
    return leadId ? [...listed.filter((song) => song.tuneId === leadId), ...listed.filter((song) => song.tuneId !== leadId)] : listed;
  }, [session.ids, byId, leadId]);
  const outside = songs.filter((song) => !session.has(song.tuneId));
  const leadSong = leadId ? byId.get(leadId) : undefined;
  const sessionIds = useMemo(() => new Set(session.ids), [session.ids]);

  const keys = useMemo(() => new Map(songs.map((song) => [song.tuneId, songKey(cachedSong(song.tuneId)?.deck.harmony.home.id, song.key)])), [songs]);
  const keyLabel = (song: SongSummary) => { const key = keys.get(song.tuneId); return key ? keyName(key) : song.key; };
  const mapSongs = useMemo((): MapSong[] => songs.flatMap((song) => {
    const key = keys.get(song.tuneId);
    return key ? [{ id: song.tuneId, title: song.title, key, fill: songFill(song) }] : [];
  }), [songs, keys]);
  const map = useMemo(() => practiceMap(mapSongs), [mapSongs]);
  const keysLit = map.nodes.filter((node) => (node.kind === "major" || node.kind === "minor") && node.fill > 0).length;
  const keyCount = new Set(mapSongs.map((song) => song.key)).size;
  const picked = selected ? byId.get(selected) : undefined;

  const makeLead = (id: string) => {
    setLead(id);
    try { saveCurrentTuneId(id); } catch { /* the storage notice reports it */ }
  };
  const play = (id: string | null | undefined) => { if (id) onStartPractice(id); };
  const addDemo = async (demo: DemoTune) => {
    if (demoLock.current) return;
    demoLock.current = true;
    setDemoBusy(true);
    try {
      const entries = await loadLibraryAsync();
      if (!entries.some((entry) => entry.id === demo.entry.id)) await saveLibrary([...entries, demo.entry]);
      session.add(demo.entry.id);
      makeLead(demo.entry.id);
      setRevision((value) => value + 1);
    } catch {
      onOpenSong(demo.entry.id); // the bundled original still opens as a preview
    } finally {
      demoLock.current = false;
      setDemoBusy(false);
    }
  };

  const empty = !loading && !songs.length;
  return (
    <main className="home">
      <section className="hm-world" aria-label="Your map">
        <header className="hm-head">
          <p className="hm-kicker">Your map</p>
          <p className="hm-stats">
            {loading ? "Opening library…" : empty ? "Songs you add appear beside their key" : <>
              <span><b>{songs.length}</b> song{songs.length === 1 ? "" : "s"} in <b>{keyCount}</b> key{keyCount === 1 ? "" : "s"}</span>
              {keysLit ? <span><b>{keysLit}</b> growing</span> : null}
            </>}
          </p>
        </header>
        <SongMap map={map} sessionIds={sessionIds} leadId={leadId} selectedId={selected} onSelect={setSelected} />
        {picked ? (
          <div className="hm-inspect" role="group" aria-label={`${picked.title}`}>
            <button type="button" className="hm-inspect-close" aria-label="Close" onClick={() => setSelected(null)}><Glyph name="close" size={18} /></button>
            <p className="hm-kicker">{[keyLabel(picked), picked.barCount ? `${picked.barCount} bars` : null, picked.composer].filter(Boolean).join(" · ")}</p>
            <h3>{picked.title}</h3>
            <Progress song={picked} />
            <div className="hm-inspect-actions">
              <button type="button" className="hm-btn is-primary" onClick={() => play(picked.tuneId)}><Glyph name="play" size={20} />Play now</button>
              <button type="button" className="hm-btn" aria-pressed={session.has(picked.tuneId)} onClick={() => session.toggle(picked.tuneId)}>
                <Glyph name={session.has(picked.tuneId) ? "check" : "plus"} size={18} />{session.has(picked.tuneId) ? "In next session" : "Add to next session"}
              </button>
              {onListenSong ? <button type="button" className="hm-btn" onClick={() => onListenSong(picked.tuneId)}><Glyph name="ear" size={18} />Listen</button> : null}
              <button type="button" className="hm-btn" onClick={() => onOpenSong(picked.tuneId)}><Glyph name="melody" size={18} />Score</button>
            </div>
          </div>
        ) : null}
      </section>

      <aside className="hm-rail">
        <section className="hm-session" aria-labelledby="hm-session-title">
          <header>
            <h2 id="hm-session-title">Next session</h2>
            {sessionSongs.length ? <span>{sessionSongs.length} song{sessionSongs.length === 1 ? "" : "s"}</span> : null}
          </header>
          {loading ? <p className="hm-quiet">Opening library…</p> : empty ? (
            <div className="hm-demos">
              {DEMO_TUNES.map((demo) => (
                <button key={demo.entry.id} type="button" className="hm-tile is-demo" disabled={demoBusy} onClick={() => void addDemo(demo)}>
                  <span className="hm-tile-key">{demo.label}</span>
                  <span className="hm-tile-title">{demo.title}</span>
                  <span className="hm-tile-meta"><Glyph name="plus" size={14} />Add to library</span>
                </button>
              ))}
              {onOpenLibrary ? <button type="button" className="hm-add" onClick={onOpenLibrary}><Glyph name="library" size={20} />Import your own score</button> : null}
            </div>
          ) : (
            <>
              <ol className="hm-tiles">
                {sessionSongs.map((song) => (
                  <li key={song.tuneId} className={`hm-tile-row ${song.tuneId === leadId ? "is-lead" : ""}`}>
                    <button type="button" className="hm-tile" aria-pressed={song.tuneId === leadId} onClick={() => makeLead(song.tuneId)} title={song.tuneId === leadId ? "The session starts here" : "Start the session with this song"}>
                      <span className="hm-tile-key">{keyLabel(song)}{song.tuneId === leadId ? <em>starts here</em> : null}</span>
                      <span className="hm-tile-title">{song.title}</span>
                      <Progress song={song} />
                    </button>
                    <button type="button" className="hm-tile-x" aria-label={`Remove ${song.title} from next session`} onClick={() => session.remove(song.tuneId)}><Glyph name="close" size={18} /></button>
                  </li>
                ))}
              </ol>
              {!sessionSongs.length ? <p className="hm-quiet">No songs chosen. Guitar mode plays {leadSong?.title ?? "the first song"} alone.</p> : null}
              <button type="button" className="hm-add" onClick={() => setAdding(true)} disabled={!outside.length && !onOpenLibrary}><Glyph name="plus" size={20} />Add songs</button>
            </>
          )}
        </section>

        <button type="button" className="hm-play" disabled={loading || !leadId} onClick={() => play(leadId)}>
          <span className="hm-play-icon"><Glyph name="play" size={26} /></span>
          <span className="hm-play-copy"><strong>Guitar mode</strong><small>{leadSong ? `${leadSong.title}${sessionSongs.length > 1 ? ` + ${sessionSongs.length - 1} more` : ""}` : empty ? "Add a song first" : ""}</small></span>
        </button>
        {input && input.status === "error" ? <ConnectGuitar input={input} /> : null}
        {error ? <p className="hm-error" role="alert">{error}</p> : null}
        {issues.length ? <button type="button" className="hm-notice" onClick={onOpenLibrary}>{issues.length} score{issues.length === 1 ? " needs" : "s need"} repair<Glyph name="arrow" size={16} /></button> : null}

        <section className="hm-drills" aria-label="Drills">
          {DRILLS.map((mode) => (
            <button key={mode.id} type="button" className="hm-drill" style={{ "--mode": mode.color } as CSSProperties} onClick={() => onOpenMode(mode.targetTab)} title={mode.blurb}>
              <Glyph name={mode.glyph} size={26} />
              <span>{mode.label}</span>
            </button>
          ))}
        </section>
      </aside>

      {adding ? (
        <div className="hm-sheet" role="dialog" aria-modal="true" aria-label="Add songs to next session">
          <div className="hm-sheet-scrim" onClick={() => setAdding(false)} />
          <section className="hm-sheet-body">
            <header>
              <h2>Add songs</h2>
              <button type="button" className="hm-btn" onClick={() => setAdding(false)}><Glyph name="check" size={18} />Done</button>
            </header>
            {outside.length ? <div className="hm-sheet-grid">
              {outside.map((song) => (
                <button key={song.tuneId} type="button" className="hm-tile" onClick={() => session.add(song.tuneId)}>
                  <span className="hm-tile-key">{keyLabel(song)}</span>
                  <span className="hm-tile-title">{song.title}</span>
                  <span className="hm-tile-meta"><Glyph name="plus" size={14} />Add</span>
                </button>
              ))}
            </div> : <p className="hm-quiet">Every song in your library is in the next session.</p>}
            {onOpenLibrary ? <button type="button" className="hm-add" onClick={() => { setAdding(false); onOpenLibrary(); }}><Glyph name="library" size={20} />Import a new score</button> : null}
          </section>
        </div>
      ) : null}
    </main>
  );
}
