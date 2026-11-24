import { useMemo, useRef, useState } from "react";
import type { TutorTargetTab } from "../overview/modes";
import { cachedSong, useSongSummaries } from "../overview/useSongSummaries";
import { hubIdForKey, keyDetail, keyName, practiceMap, songFill, songKey, type MapSong } from "../overview/map";
import type { SongSummary } from "../overview/summary";
import { FAMILY_LABEL, wholeTuneCard } from "../song/deck";
import { BOXES } from "../song/leitner";
import { parseScaleId } from "../song/kin";
import { keyStudyId, parseHubId, resolveTreeSelection, type CenterPlan, type TreeFocus } from "../song/keyStudy";
import { loadLibraryAsync, saveCurrentTuneId, saveLibrary } from "../tunes/library";
import { DEMO_TUNES, type DemoTune } from "../tunes/demos";
import { useSessionSet } from "../song/sessionSet";
import type { InputApi } from "../listen/useInput";
import type { PracticeLaunchOptions } from "./TuneView";
import { Glyph } from "./Glyph";
import { SongMap } from "./SongMap";
import "../overview/overview.css";
import "../overview/home.css";

// Home: the circle-of-fifths passive tree with a context-aware central Launch Core on the left,
// and the Next Session + live Selection Inspector rail on the right.
// Selecting a key focuses all tunes & scales/modes in that key; selecting a song focuses solo;
// Shift-clicking or enabling Mix Select blends multiple keys, songs, and disciplines into one session.

function ConnectGuitar({ input }: { input: InputApi }) {
  const starting = input.status === "starting";
  return (
    <div className="hm-connect">
      <button type="button" onClick={() => void input.start()} disabled={starting}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 3v9a3 3 0 0 0 6 0V3a3 3 0 0 0-6 0ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" /></svg>
        {starting ? "Connecting…" : input.status === "error" ? "Retry guitar input" : "Connect your guitar"}
      </button>
      {input.status === "error" && input.error ? <p className="hm-error" role="alert">{input.error}</p> : null}
    </div>
  );
}

function Progress({ song }: { song: SongSummary }) {
  const fill = songFill(song);
  return <span className="hm-meter" aria-label={`${Math.round(fill * 100)}% of exercises climbed`}><i style={{ width: `${Math.max(fill * 100, fill > 0 ? 5 : 0)}%` }} /></span>;
}

function BoxPips({ box, status }: { box: number; status: "mastered" | "growing" | "kinship" | "unexplored" }) {
  return (
    <span className={`hm-pips is-${status}`} aria-label={box > 0 ? `Box ${box} of ${BOXES}` : status === "kinship" ? "Kinship credit" : "Not started"}>
      {Array.from({ length: BOXES }, (_, i) => (
        <i key={i} className={i < box ? "is-on" : status === "kinship" && i === 0 ? "is-kin" : ""} />
      ))}
    </span>
  );
}

/** Find a concrete scale card in the player's library matching a hub + skill branch, if one exists. */
function findSkillCard(hubId: string, skill: string, songs: SongSummary[]): { tuneId: string; cardId: string } | null {
  const match = /^(M|m)(\d+)$/.exec(hubId);
  if (!match) return null;
  const minor = match[1] === "m";
  const pc = Number(match[2]);
  for (const song of songs) {
    const deck = cachedSong(song.tuneId)?.deck;
    if (!deck) continue;
    const card = deck.cards.find((c) => {
      const parsed = parseScaleId(c.id);
      if (!parsed) return false;
      const cardSkill = parsed.rhythm ? `${parsed.drill}:${parsed.rhythm}` : parsed.drill;
      return parsed.root === pc && (parsed.kind !== "major") === minor && cardSkill === skill;
    });
    if (card) return { tuneId: song.tuneId, cardId: card.id };
  }
  return null;
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
  onStartPractice: (tuneId: string, cardId?: string, prepared?: boolean, options?: PracticeLaunchOptions) => void;
}) {
  const [revision, setRevision] = useState(0);
  const { songs, currentTuneId, loading, error, issues = [] } = useSongSummaries(revision);
  const libraryIds = useMemo(() => songs.map((song) => song.tuneId), [songs]);
  const session = useSessionSet(libraryIds);
  const [lead, setLead] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [selectedSongs, setSelectedSongs] = useState<string[]>([]);
  const [selectedFocus, setSelectedFocus] = useState<TreeFocus | null>(null);
  const [mixMode, setMixMode] = useState(false);
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
  const songHubs = useMemo(() => {
    const out = new Map<string, string>();
    for (const [id, k] of keys) {
      const hub = k ? hubIdForKey(k) : null;
      if (hub) out.set(id, hub);
    }
    return out;
  }, [keys]);
  const keyLabel = (song: SongSummary) => { const key = keys.get(song.tuneId); return key ? keyName(key) : song.key; };
  const mapSongs = useMemo((): MapSong[] => songs.flatMap((song) => {
    const key = keys.get(song.tuneId);
    return key ? [{ id: song.tuneId, title: song.title, key, fill: songFill(song) }] : [];
  }), [songs, keys]);
  const map = useMemo(() => practiceMap(mapSongs), [mapSongs]);

  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const selectedSongSet = useMemo(() => new Set(selectedSongs), [selectedSongs]);

  const centerPlan = useMemo(
    () =>
      resolveTreeSelection({
        selectedKeys,
        selectedSongs,
        selectedFocus,
        songs,
        songHubs,
        sessionIds: session.ids,
        leadId,
      }),
    [selectedKeys, selectedSongs, selectedFocus, songs, songHubs, session.ids, leadId],
  );

  // Single-item inspection targets (when exactly one key or one song is focused with no mix)
  const singleKeyId = selectedKeys.length === 1 && selectedSongs.length === 0 && !selectedFocus ? selectedKeys[0] : null;
  const singleSongId = selectedSongs.length === 1 && selectedKeys.length === 0 && !selectedFocus ? selectedSongs[0] : null;
  const pickedSong = singleSongId ? byId.get(singleSongId) : undefined;
  const pickedKey = useMemo(() => (singleKeyId ? keyDetail(singleKeyId, map) : null), [singleKeyId, map]);
  const keySongs = useMemo(
    () => (pickedKey ? songs.filter((song) => songHubs.get(song.tuneId) === pickedKey.hubId) : []),
    [pickedKey, songs, songHubs],
  );
  const showMixInspector = !pickedSong && !pickedKey && (selectedKeys.length > 0 || selectedSongs.length > 0 || selectedFocus !== null);

  const makeLead = (id: string) => {
    setLead(id);
    try { saveCurrentTuneId(id); } catch { /* the storage notice reports it */ }
  };
  const play = (id: string | null | undefined, cardId?: string, options?: PracticeLaunchOptions) => {
    if (id) onStartPractice(id, cardId, false, options);
  };
  const wholeIdOf = (tuneId: string | null | undefined): string | undefined => {
    if (!tuneId) return undefined;
    const deck = cachedSong(tuneId)?.deck;
    return deck ? wholeTuneCard(deck)?.id : undefined;
  };
  const playWhole = (tuneId: string | null | undefined) => {
    if (!tuneId) return;
    play(tuneId, wholeIdOf(tuneId));
  };

  const launchPlan = (plan: CenterPlan = centerPlan) => {
    if (plan.openTab) {
      onOpenMode(plan.openTab);
      return;
    }
    if (plan.tuneIds.length > 0) {
      const [first, ...restTunes] = plan.tuneIds;
      const studyGuestIds = plan.studyHubIds.map(keyStudyId);
      if (plan.kind === "full-mix") {
        play(first);
      } else {
        play(first, undefined, {
          focus: plan.focus,
          mixIds: [...restTunes, ...studyGuestIds],
          studyHubIds: plan.studyHubIds,
        });
      }
      return;
    }
    if (plan.studyHubIds.length > 0) {
      const [firstHub, ...restHubs] = plan.studyHubIds;
      play(keyStudyId(firstHub), undefined, {
        focus: plan.focus,
        mixIds: restHubs.map(keyStudyId),
        studyHubIds: plan.studyHubIds,
      });
    }
  };

  const clearSelection = () => {
    setSelectedKeys([]);
    setSelectedSongs([]);
    setSelectedFocus(null);
    setMixMode(false);
  };

  const handleClickKey = (hubId: string, additive: boolean) => {
    if (additive) {
      setSelectedKeys((cur) => (cur.includes(hubId) ? cur.filter((k) => k !== hubId) : [...cur, hubId]));
      return;
    }
    if (selectedKeys.length === 1 && selectedKeys[0] === hubId && selectedSongs.length === 0) {
      setSelectedKeys([]);
    } else {
      setSelectedKeys([hubId]);
      setSelectedSongs([]);
    }
  };

  const handleClickSong = (songId: string, additive: boolean) => {
    if (additive) {
      setSelectedSongs((cur) => (cur.includes(songId) ? cur.filter((s) => s !== songId) : [...cur, songId]));
      return;
    }
    if (selectedSongs.length === 1 && selectedSongs[0] === songId && selectedKeys.length === 0) {
      setSelectedSongs([]);
    } else {
      setSelectedSongs([songId]);
      setSelectedKeys([]);
    }
  };

  const handleClickFocus = (focus: TreeFocus) => {
    setSelectedFocus((cur) => (cur === focus ? null : focus));
  };

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
      onOpenSong(demo.entry.id);
    } finally {
      demoLock.current = false;
      setDemoBusy(false);
    }
  };

  const launchSkill = (hubId: string, skill: string) => {
    const found = findSkillCard(hubId, skill, songs);
    if (found) {
      play(found.tuneId, found.cardId);
      return;
    }
    // Launch a live key study right in this key focused on scales!
    play(keyStudyId(hubId), undefined, { focus: "scales", mixIds: [], studyHubIds: [hubId] });
  };

  const patternSkills = pickedKey ? pickedKey.skills.filter((s) => !s.skill.startsWith("run:")) : [];
  const rhythmSkills = pickedKey ? pickedKey.skills.filter((s) => s.skill === "run" || s.skill.startsWith("run:")) : [];
  const empty = !loading && !songs.length;

  return (
    <main className="home">
      <section className="hm-world" aria-label="Your map">
        <div className="hm-pond-bg" aria-hidden="true" data-nav-skip />

        <SongMap
          map={map}
          sessionIds={sessionIds}
          leadId={leadId}
          selectedSongIds={selectedSongSet}
          selectedKeyIds={selectedKeySet}
          selectedFocus={selectedFocus}
          centerPlan={centerPlan}
          mixMode={mixMode}
          onToggleMixMode={() => setMixMode((on) => !on)}
          onClickSong={handleClickSong}
          onClickKey={handleClickKey}
          onClickFocus={handleClickFocus}
          onLaunchCenter={() => launchPlan()}
          onClearSelection={clearSelection}
          onToggleSession={(id) => session.toggle(id)}
          onAddSong={onOpenLibrary ? () => setAdding(true) : undefined}
        />
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
              {onOpenLibrary ? <button type="button" className="hm-add" onClick={onOpenLibrary}><Glyph name="library" size={18} />Import your own score</button> : null}
            </div>
          ) : (
            <>
              <ol className="hm-tiles">
                {sessionSongs.map((song) => {
                  const wholeId = wholeIdOf(song.tuneId);
                  return (
                    <li key={song.tuneId} className={`hm-tile-row ${song.tuneId === leadId ? "is-lead" : ""}`}>
                      <button type="button" className="hm-tile" aria-pressed={song.tuneId === leadId} onClick={() => makeLead(song.tuneId)} title={song.tuneId === leadId ? "The session starts here" : "Start the session with this song"}>
                        <span className="hm-tile-key">{keyLabel(song)}{song.tuneId === leadId ? <em>starts here</em> : null}</span>
                        <span className="hm-tile-title">{song.title}</span>
                        <Progress song={song} />
                      </button>
                      <div className="hm-tile-side">
                        {wholeId ? (
                          <button type="button" className="hm-tile-whole" aria-label={`Play whole tune: ${song.title}`} title="Play the whole tune" onClick={() => play(song.tuneId, wholeId)}>
                            <Glyph name="play" size={13} />
                          </button>
                        ) : null}
                        <button type="button" className="hm-tile-x" aria-label={`Remove ${song.title} from next session`} onClick={() => session.remove(song.tuneId)}><Glyph name="close" size={15} /></button>
                      </div>
                    </li>
                  );
                })}
              </ol>
              {!sessionSongs.length ? <p className="hm-quiet">No songs chosen. Guitar mode plays {leadSong?.title ?? "the first song"} alone.</p> : null}
              {outside.length > 0 && outside.length <= 4 ? (
                <div className="hm-quick-add" aria-label="Quick add songs">
                  {outside.map((song) => (
                    <button key={song.tuneId} type="button" className="hm-quick-chip" onClick={() => session.add(song.tuneId)}>
                      <Glyph name="plus" size={12} />
                      <span>{song.title}</span>
                      <em>{keyLabel(song)}</em>
                    </button>
                  ))}
                </div>
              ) : null}
              <button type="button" className="hm-add" onClick={() => setAdding(true)} disabled={!outside.length && !onOpenLibrary}><Glyph name="plus" size={16} />{outside.length ? "Add songs" : "Import new score"}</button>
            </>
          )}
        </section>

        <button type="button" className="hm-play" disabled={loading || !leadId} onClick={() => play(leadId)}>
          <span className="hm-play-icon"><Glyph name="play" size={22} /></span>
          <span className="hm-play-copy"><strong>Guitar mode</strong><small>{leadSong ? `${leadSong.title}${sessionSongs.length > 1 ? ` + ${sessionSongs.length - 1} more` : ""}` : empty ? "Add a song first" : ""}</small></span>
        </button>
        {leadSong && wholeIdOf(leadSong.tuneId) ? (
          <button type="button" className="hm-whole-cta" onClick={() => playWhole(leadSong.tuneId)}>
            <Glyph name="melody" size={16} />
            <span>Play whole tune · <b>{leadSong.title}</b></span>
            <em aria-hidden="true">↗</em>
          </button>
        ) : null}

        {showMixInspector ? (
          <div className="hm-inspect hm-inspect--mix" role="group" aria-label={centerPlan.headline}>
            <button type="button" className="hm-inspect-close" aria-label="Close" onClick={clearSelection}><Glyph name="close" size={16} /></button>
            <div className="hm-inspect-meta">
              <span className="hm-key-chip is-static">{centerPlan.kind === "focus" ? "Focus" : "Mix"}</span>
              <p className="hm-kicker">{centerPlan.orbSub}</p>
            </div>
            <h3>{centerPlan.headline}</h3>
            <p className="hm-quiet">{centerPlan.summary}</p>

            <div className="hm-mix-chips" aria-label="Selected items">
              {selectedKeys.map((hubId) => (
                <button key={hubId} type="button" className="hm-mix-chip is-key" onClick={() => setSelectedKeys((cur) => cur.filter((k) => k !== hubId))}>
                  <span>{parseHubId(hubId)?.shortName ?? hubId}</span>
                  <Glyph name="close" size={11} />
                </button>
              ))}
              {selectedSongs.map((id) => (
                <button key={id} type="button" className="hm-mix-chip is-song" onClick={() => setSelectedSongs((cur) => cur.filter((s) => s !== id))}>
                  <span>{byId.get(id)?.title ?? id}</span>
                  <Glyph name="close" size={11} />
                </button>
              ))}
              {selectedFocus ? (
                <button type="button" className="hm-mix-chip is-focus" onClick={() => setSelectedFocus(null)}>
                  <span>{selectedFocus}</span>
                  <Glyph name="close" size={11} />
                </button>
              ) : null}
              <button type="button" className={`hm-mix-chip is-add ${mixMode ? "is-on" : ""}`} onClick={() => setMixMode((on) => !on)}>
                <Glyph name="plus" size={11} />
                <span>{mixMode ? "Picking…" : "Add more"}</span>
              </button>
            </div>

            <button
              type="button"
              className="hm-btn is-primary"
              disabled={!centerPlan.openTab && !centerPlan.tuneIds.length && !centerPlan.studyHubIds.length}
              onClick={() => launchPlan()}
            >
              <Glyph name="play" size={16} />Play {centerPlan.headline}
            </button>

            {centerPlan.exercises.length ? (
              <div className="hm-inspect-list">
                <p className="hm-kicker">Most relevant exercises</p>
                <ul>
                  {centerPlan.exercises.slice(0, 4).map((ex) => (
                    <li key={`${ex.tuneId}:${ex.cardId}`}>
                      <button type="button" className="hm-ex-row" onClick={() => play(ex.tuneId, ex.cardId)}>
                        <span className="hm-ex-copy">
                          <strong>{ex.title}</strong>
                          <small>{ex.tuneTitle} · {FAMILY_LABEL[ex.family]}</small>
                        </span>
                        <span className="hm-ex-go"><Glyph name="play" size={13} /></span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {centerPlan.modes.length ? (
              <div className="hm-modes-block">
                <p className="hm-kicker">Relevant scales &amp; modes</p>
                <div className="hm-mode-pills">
                  {centerPlan.modes.map((m) => (
                    <button key={m.name} type="button" className="hm-mode-pill" onClick={() => launchSkill(m.hubId, m.skill)}>
                      <strong>{m.name}</strong>
                      <small>{m.role}</small>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : pickedSong ? (
          <div className="hm-inspect" role="group" aria-label={pickedSong.title}>
            <button type="button" className="hm-inspect-close" aria-label="Close" onClick={clearSelection}><Glyph name="close" size={16} /></button>
            <div className="hm-inspect-meta">
              <button
                type="button"
                className="hm-key-chip"
                onClick={() => {
                  const hub = songHubs.get(pickedSong.tuneId);
                  if (hub) { setSelectedKeys([hub]); setSelectedSongs([]); }
                }}
              >
                {keyLabel(pickedSong)}
              </button>
              <p className="hm-kicker">{[pickedSong.barCount ? `${pickedSong.barCount} bars` : null, pickedSong.composer].filter(Boolean).join(" · ")}</p>
              <button type="button" className={`hm-inline-mix ${mixMode ? "is-on" : ""}`} onClick={() => setMixMode((on) => !on)} title="Mix this song with other songs or keys">
                <Glyph name="plus" size={11} />Mix
              </button>
            </div>
            <h3>{pickedSong.title}</h3>
            <Progress song={pickedSong} />
            <div className="hm-inspect-actions">
              <button type="button" className="hm-btn is-primary" onClick={() => launchPlan()}>
                <Glyph name="play" size={16} />Practice solo
              </button>
              <button type="button" className="hm-btn" onClick={() => playWhole(pickedSong.tuneId)}>
                <Glyph name="melody" size={16} />Whole tune
              </button>
              <button type="button" className="hm-btn" aria-pressed={session.has(pickedSong.tuneId)} onClick={() => session.toggle(pickedSong.tuneId)}>
                <Glyph name={session.has(pickedSong.tuneId) ? "check" : "plus"} size={16} />{session.has(pickedSong.tuneId) ? "In session" : "Add to session"}
              </button>
              <button type="button" className="hm-btn" onClick={() => onOpenSong(pickedSong.tuneId)}>
                <Glyph name="reading" size={16} />Score
              </button>
              {onListenSong ? <button type="button" className="hm-btn hm-btn--span" onClick={() => onListenSong(pickedSong.tuneId)}><Glyph name="ear" size={16} />Listen to backing</button> : null}
            </div>
            {pickedSong.next.length ? (
              <div className="hm-inspect-list">
                <p className="hm-kicker">Next up in {pickedSong.title}</p>
                <ul>
                  {pickedSong.next.slice(0, 3).map((unit) => (
                    <li key={unit.id}>
                      <button type="button" className="hm-ex-row" onClick={() => play(pickedSong.tuneId, unit.id)}>
                        <span className="hm-ex-copy">
                          <strong>{unit.title}</strong>
                          <small>{FAMILY_LABEL[unit.family]}{unit.where ? ` · ${unit.where}` : ""}{unit.bpm ? ` · ${unit.bpm} bpm` : ""}</small>
                        </span>
                        <span className="hm-ex-go"><Glyph name="play" size={13} /></span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : pickedKey ? (
          <div className="hm-inspect hm-inspect--key" role="group" aria-label={pickedKey.fullName}>
            <button type="button" className="hm-inspect-close" aria-label="Close" onClick={clearSelection}><Glyph name="close" size={16} /></button>
            <div className="hm-inspect-meta">
              <span className="hm-key-chip is-static">{pickedKey.shortName}</span>
              <button type="button" className="hm-rel-link" onClick={() => { setSelectedKeys([pickedKey.relativeHubId]); setSelectedSongs([]); }}>
                Relative · {pickedKey.relativeName}
              </button>
              <button type="button" className={`hm-inline-mix ${mixMode ? "is-on" : ""}`} onClick={() => setMixMode((on) => !on)} title="Mix this key with other keys or songs">
                <Glyph name="plus" size={11} />Mix
              </button>
            </div>
            <h3>{pickedKey.fullName}</h3>

            <button type="button" className="hm-btn is-primary" onClick={() => launchPlan()}>
              <Glyph name="play" size={16} />
              {keySongs.length
                ? `Play ${pickedKey.shortName} · ${keySongs.length} tune${keySongs.length === 1 ? "" : "s"} & scales`
                : `Play ${pickedKey.fullName} · scales & modes`}
            </button>

            {centerPlan.exercises.length ? (
              <div className="hm-inspect-list">
                <p className="hm-kicker">Relevant exercises in {pickedKey.shortName}</p>
                <ul>
                  {centerPlan.exercises.slice(0, 3).map((ex) => (
                    <li key={`${ex.tuneId}:${ex.cardId}`}>
                      <button type="button" className="hm-ex-row" onClick={() => play(ex.tuneId, ex.cardId)}>
                        <span className="hm-ex-copy">
                          <strong>{ex.title}</strong>
                          <small>{ex.tuneTitle} · {FAMILY_LABEL[ex.family]}</small>
                        </span>
                        <span className="hm-ex-go"><Glyph name="play" size={13} /></span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="hm-skill-grid" role="list" aria-label={`Patterns in ${pickedKey.fullName}`}>
              {patternSkills.map((skill) => {
                const direct = findSkillCard(pickedKey.hubId, skill.skill, songs);
                return (
                  <button
                    key={skill.id}
                    type="button"
                    role="listitem"
                    className={`hm-skill-card is-${skill.status}`}
                    onClick={() => launchSkill(pickedKey.hubId, skill.skill)}
                  >
                    <span className="hm-skill-head">
                      <strong>{skill.skill === "triads" ? "Diatonic chords" : skill.label}</strong>
                      <BoxPips box={skill.box} status={skill.status} />
                    </span>
                    <small>{direct ? "Direct exercise ↗" : skill.box > 0 ? `Box ${skill.box}/${BOXES}` : skill.status === "kinship" ? "Kinship boost" : "Key study ↗"}</small>
                  </button>
                );
              })}
            </div>

            <div className="hm-rhythm-bar" aria-label="Rhythm color tiers">
              {rhythmSkills.map((r) => {
                const tier = r.skill === "run:sixteenths" ? "sixteenths" : r.skill === "run:triplets" ? "triplets" : "straight";
                const name = tier === "sixteenths" ? "16ths" : tier === "triplets" ? "Triplets" : "Straight";
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={`hm-rhythm-chip is-${tier} ${r.box > 0 ? "is-on" : ""}`}
                    onClick={() => launchSkill(pickedKey.hubId, r.skill)}
                  >
                    <i aria-hidden="true" />
                    <span>{name}</span>
                    <small>{r.box > 0 ? `B${r.box}` : "—"}</small>
                  </button>
                );
              })}
            </div>

            {centerPlan.modes.length ? (
              <div className="hm-modes-block">
                <p className="hm-kicker">Scales &amp; modes to learn</p>
                <div className="hm-mode-pills">
                  {centerPlan.modes.map((m) => (
                    <button key={m.name} type="button" className="hm-mode-pill" onClick={() => launchSkill(m.hubId, m.skill)}>
                      <strong>{m.name}</strong>
                      <small>{m.role}</small>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {keySongs.length ? (
              <div className="hm-inspect-list">
                <p className="hm-kicker">Your tunes in {pickedKey.shortName}</p>
                <ul>
                  {keySongs.map((song) => {
                    const inSession = session.has(song.tuneId);
                    return (
                      <li key={song.tuneId} className="hm-key-tune-row">
                        <button type="button" className="hm-ex-row" onClick={() => { setSelectedSongs([song.tuneId]); setSelectedKeys([]); }}>
                          <span className="hm-ex-copy">
                            <strong>{song.title}</strong>
                            <small>{Math.round(songFill(song) * 100)}% grown</small>
                          </span>
                          <span className="hm-ex-go"><Glyph name="arrow" size={13} /></span>
                        </button>
                        <button
                          type="button"
                          className={`hm-mini-toggle ${inSession ? "is-on" : ""}`}
                          aria-pressed={inSession}
                          onClick={() => session.toggle(song.tuneId)}
                        >
                          {inSession ? "In session" : "+ Session"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            {keySongs.length < 2 && pickedKey.ideas.length ? (
              <div className="hm-ideas">
                <div className="hm-ideas-head">
                  <p className="hm-kicker">{keySongs.length ? `More tunes in ${pickedKey.shortName}` : `Tune ideas in ${pickedKey.shortName}`}</p>
                  {onOpenLibrary ? (
                    <button type="button" className="hm-ideas-import" onClick={onOpenLibrary}>
                      <Glyph name="plus" size={13} />Import score
                    </button>
                  ) : null}
                </div>
                <ul className="hm-idea-chips">
                  {pickedKey.ideas.map((idea) => (
                    <li key={idea.title}>
                      <strong>{idea.title}</strong>
                      <span>{idea.note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {input && input.status === "error" ? <ConnectGuitar input={input} /> : null}
        {error ? <p className="hm-error" role="alert">{error}</p> : null}
        {issues.length ? <button type="button" className="hm-notice" onClick={onOpenLibrary}>{issues.length} score{issues.length === 1 ? " needs" : "s need"} repair<Glyph name="arrow" size={16} /></button> : null}
      </aside>

      {adding ? (
        <div className="hm-sheet" role="dialog" aria-modal="true" aria-label="Add songs to next session">
          <div className="hm-sheet-scrim" onClick={() => setAdding(false)} />
          <section className="hm-sheet-body">
            <header>
              <h2>Add songs</h2>
              <button type="button" className="hm-btn" onClick={() => setAdding(false)}><Glyph name="check" size={16} />Done</button>
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
            {DEMO_TUNES.some((demo) => !songs.some((s) => s.tuneId === demo.entry.id)) ? (
              <div className="hm-sheet-grid">
                {DEMO_TUNES.filter((demo) => !songs.some((s) => s.tuneId === demo.entry.id)).map((demo) => (
                  <button key={demo.entry.id} type="button" className="hm-tile is-demo" disabled={demoBusy} onClick={() => void addDemo(demo)}>
                    <span className="hm-tile-key">{demo.label} · Study</span>
                    <span className="hm-tile-title">{demo.title}</span>
                    <span className="hm-tile-meta"><Glyph name="plus" size={14} />Add study</span>
                  </button>
                ))}
              </div>
            ) : null}
            {onOpenLibrary ? <button type="button" className="hm-add" onClick={() => { setAdding(false); onOpenLibrary(); }}><Glyph name="library" size={18} />Import a new score</button> : null}
          </section>
        </div>
      ) : null}
    </main>
  );
}
