import { useMemo, useRef, useState } from "react";
import type { TutorTargetTab } from "../overview/modes";
import { cachedSong, useSongSummaries } from "../overview/useSongSummaries";
import { hubIdForKey, keyDetail, keyName, practiceMap, songFill, songKey, type MapSong } from "../overview/map";
import type { SongSummary } from "../overview/summary";
import { FAMILY_LABEL, wholeTuneCard } from "../song/deck";
import { BOXES, loadSharedSkills } from "../song/leitner";
import { parseScaleId } from "../song/kin";
import { keyStudyId, parseHubId, resolveTreeSelection, type CenterPlan, type TreeFocus } from "../song/keyStudy";
import { FOUNDATION_GROUPS, TECHNIQUE_TRACKS, type FoundationGroup, type TechniqueMeta } from "../song/technique";
import { loadLibraryAsync, saveCurrentTuneId, saveLibrary } from "../tunes/library";
import { DEMO_TUNES, type DemoTune } from "../tunes/demos";
import { useSessionSet } from "../song/sessionSet";
import type { InputApi } from "../listen/useInput";
import type { PracticeLaunchOptions } from "./TuneView";
import { Glyph } from "./Glyph";
import { SongMap } from "./SongMap";
import "../overview/overview.css";
import "../overview/home.css";

// Home is the passive tree and nothing else. The circle of fifths carries the keys, their
// exercises, the foundations hung in the keys tunes rarely visit and the songs on the rim; the core
// at the centre launches whatever is selected (nothing selected: the next session, lead song
// first). Selecting a node opens its card beside it: a key, a song, a foundation, or the mix when
// several are blended (Shift-click or Mix select).

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

/** Where a tempo stands between where it started and its goal: a thin road with the numbers at its ends. */
function TempoRoad({ bpm, start, goal }: { bpm: number; start: number; goal: number }) {
  const share = goal > start ? Math.max(0, Math.min(1, (bpm - start) / (goal - start))) : 0;
  return (
    <div className="hm-road" aria-label={`${bpm} bpm, from ${start} towards ${goal}`}>
      <small>{start}</small>
      <span className="hm-road-line"><i style={{ width: `${share * 100}%` }} /><b style={{ left: `${share * 100}%` }}>♩{bpm}</b></span>
      <small>{goal}</small>
    </div>
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

const GROUP_ORDER: FoundationGroup[] = ["fingers", "picking", "time", "phrasing"];

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
  const [selectedFoundation, setSelectedFoundation] = useState<string | null>(null);
  const [mixMode, setMixMode] = useState(false);
  const [adding, setAdding] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const demoLock = useRef(false);
  const byId = useMemo(() => new Map(songs.map((song) => [song.tuneId, song])), [songs]);

  const chosenLead = lead ?? currentTuneId;
  const leadId = chosenLead && session.has(chosenLead) ? chosenLead : session.ids[0] ?? (chosenLead && byId.has(chosenLead) ? chosenLead : songs[0]?.tuneId ?? null);
  const outside = songs.filter((song) => !session.has(song.tuneId));
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
  // the shared box (foundations, scales) is re-read whenever the library refreshes
  const shared = useMemo(() => loadSharedSkills(), [revision, songs]);

  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const selectedSongSet = useMemo(() => new Set(selectedSongs), [selectedSongs]);

  const centerPlan = useMemo(
    () => resolveTreeSelection({ selectedKeys, selectedSongs, selectedFocus, songs, songHubs, sessionIds: session.ids, leadId }),
    [selectedKeys, selectedSongs, selectedFocus, songs, songHubs, session.ids, leadId],
  );

  const foundation = useMemo(() => {
    const track = selectedFoundation ? TECHNIQUE_TRACKS.find((t) => t.id === selectedFoundation) : undefined;
    if (!track) return null;
    const st = shared.cards[track.id];
    const box = st?.box ?? 0;
    const needs = track.needs ? TECHNIQUE_TRACKS.find((t) => t.id === track.needs) : undefined;
    const locked = Boolean(needs) && (shared.cards[needs!.id]?.box ?? 0) < 2 && (shared.credit[track.id] ?? 0) < 1;
    return { track, box, bpm: st?.bpm ?? track.bpm, needs, locked, key: parseHubId(track.hub)!, status: box >= 4 ? ("mastered" as const) : box > 0 ? ("growing" as const) : ("unexplored" as const) };
  }, [selectedFoundation, shared]);

  // a selected foundation takes over the core: it plays that exercise, in its key
  const plan: CenterPlan = foundation
    ? {
        kind: "focus",
        orbLabel: foundation.track.short.replace(/-/g, "\u2011"), // keeps "1-2-3-4" on one line
        orbSub: `${foundation.key.shortName} · ♩${foundation.bpm}`,
        headline: `${foundation.track.short} · ${foundation.key.fullName}`,
        summary: foundation.track.detail,
        tuneIds: [],
        studyHubIds: [foundation.track.hub],
        focus: "technique",
        openTab: null,
        exercises: [],
        modes: [],
        activeHubIds: [foundation.track.hub],
        activeSongIds: [],
      }
    : centerPlan;

  // single-item inspection targets (exactly one key or one song, nothing blended)
  const singleKeyId = selectedKeys.length === 1 && selectedSongs.length === 0 && !selectedFocus ? selectedKeys[0] : null;
  const singleSongId = selectedSongs.length === 1 && selectedKeys.length === 0 && !selectedFocus ? selectedSongs[0] : null;
  const pickedSong = singleSongId ? byId.get(singleSongId) : undefined;
  const pickedKey = useMemo(() => (singleKeyId ? keyDetail(singleKeyId, map) : null), [singleKeyId, map]);
  const keySongs = useMemo(() => (pickedKey ? songs.filter((song) => songHubs.get(song.tuneId) === pickedKey.hubId) : []), [pickedKey, songs, songHubs]);
  const keyFoundations = useMemo(() => (pickedKey ? TECHNIQUE_TRACKS.filter((t) => t.hub === pickedKey.hubId) : []), [pickedKey]);
  const showMix = !foundation && !pickedSong && !pickedKey && (selectedKeys.length > 0 || selectedSongs.length > 0 || selectedFocus !== null);

  const makeLead = (id: string) => {
    if (!session.has(id)) session.add(id);
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
    if (tuneId) play(tuneId, wholeIdOf(tuneId));
  };
  const playFoundation = (track: TechniqueMeta) => play(keyStudyId(track.hub), track.id, { focus: "technique", mixIds: [], studyHubIds: [track.hub] });

  const launchPlan = () => {
    if (foundation) {
      playFoundation(foundation.track);
      return;
    }
    const p = centerPlan;
    if (p.openTab) {
      onOpenMode(p.openTab);
      return;
    }
    if (p.tuneIds.length > 0) {
      const [first, ...restTunes] = p.tuneIds;
      if (p.kind === "full-mix") play(first);
      else play(first, undefined, { focus: p.focus, mixIds: [...restTunes, ...p.studyHubIds.map(keyStudyId)], studyHubIds: p.studyHubIds });
      return;
    }
    if (p.studyHubIds.length > 0) {
      const [firstHub, ...restHubs] = p.studyHubIds;
      play(keyStudyId(firstHub), undefined, { focus: p.focus, mixIds: restHubs.map(keyStudyId), studyHubIds: p.studyHubIds });
    }
  };

  const clearSelection = () => {
    setSelectedKeys([]);
    setSelectedSongs([]);
    setSelectedFocus(null);
    setSelectedFoundation(null);
    setMixMode(false);
  };
  const selectKey = (hubId: string) => { setSelectedFoundation(null); setSelectedKeys([hubId]); setSelectedSongs([]); };
  const selectSong = (id: string) => { setSelectedFoundation(null); setSelectedSongs([id]); setSelectedKeys([]); };

  const handleClickKey = (hubId: string, additive: boolean) => {
    setSelectedFoundation(null);
    if (additive) {
      setSelectedKeys((cur) => (cur.includes(hubId) ? cur.filter((k) => k !== hubId) : [...cur, hubId]));
      return;
    }
    if (selectedKeys.length === 1 && selectedKeys[0] === hubId && selectedSongs.length === 0) setSelectedKeys([]);
    else selectKey(hubId);
  };
  const handleClickSong = (songId: string, additive: boolean) => {
    setSelectedFoundation(null);
    if (additive) {
      setSelectedSongs((cur) => (cur.includes(songId) ? cur.filter((s) => s !== songId) : [...cur, songId]));
      return;
    }
    if (selectedSongs.length === 1 && selectedSongs[0] === songId && selectedKeys.length === 0) setSelectedSongs([]);
    else selectSong(songId);
  };
  const handleClickFocus = (focus: TreeFocus) => {
    setSelectedFoundation(null);
    setSelectedFocus((cur) => (cur === focus ? null : focus));
  };
  const handleClickFoundation = (id: string) => {
    const again = selectedFoundation === id;
    clearSelection();
    if (!again) setSelectedFoundation(id);
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
    if (found) play(found.tuneId, found.cardId);
    else play(keyStudyId(hubId), undefined, { focus: "scales", mixIds: [], studyHubIds: [hubId] });
  };

  const empty = !loading && !songs.length;
  const close = <button type="button" className="hm-card-close" aria-label="Close" onClick={clearSelection}><Glyph name="close" size={15} /></button>;

  const exerciseList = (title: string, list: CenterPlan["exercises"]) =>
    list.length ? (
      <div className="hm-card-list">
        <p className="hm-kicker">{title}</p>
        <ul>
          {list.map((ex) => (
            <li key={`${ex.tuneId}:${ex.cardId}`}>
              <button type="button" className="hm-ex-row" onClick={() => play(ex.tuneId, ex.cardId)}>
                <span className="hm-ex-copy">
                  <strong>{ex.title}</strong>
                  <small>{ex.tuneTitle} · {FAMILY_LABEL[ex.family]}{ex.bpm ? ` · ♩${ex.bpm}` : ""}</small>
                </span>
                <span className="hm-ex-go"><Glyph name="play" size={12} /></span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  const modePills = (title: string) =>
    centerPlan.modes.length ? (
      <div className="hm-card-list">
        <p className="hm-kicker">{title}</p>
        <div className="hm-mode-pills">
          {centerPlan.modes.map((m) => (
            <button key={m.name} type="button" className="hm-mode-pill" onClick={() => launchSkill(m.hubId, m.skill)}>
              <strong>{m.name}</strong>
              <small>{m.role}</small>
            </button>
          ))}
        </div>
      </div>
    ) : null;

  let card: { anchor: string; content: JSX.Element } | null = null;
  if (foundation) {
    const { track, key } = foundation;
    card = {
      anchor: track.id,
      content: (
        <div className="hm-card is-foundation" data-family={track.group} role="group" aria-label={`${track.short}, ${key.fullName}`}>
          {close}
          <p className="hm-card-kicker"><i aria-hidden="true" />{FOUNDATION_GROUPS[track.group].label} · {key.fullName}</p>
          <h3>{track.short}</h3>
          <TempoRoad bpm={foundation.bpm} start={track.bpm} goal={track.goalBpm} />
          <p className="hm-card-detail">{track.detail}</p>
          <div className="hm-card-meta">
            <BoxPips box={foundation.box} status={foundation.status} />
            {foundation.locked && foundation.needs ? <span className="hm-card-needs">after {foundation.needs.short}</span> : null}
          </div>
          <button type="button" className="hm-btn is-primary" onClick={() => playFoundation(track)}>
            <Glyph name="play" size={15} />Play in {key.shortName}
          </button>
        </div>
      ),
    };
  } else if (showMix) {
    card = {
      anchor: "core",
      content: (
        <div className="hm-card is-mix" role="group" aria-label={centerPlan.headline}>
          {close}
          <p className="hm-card-kicker">{centerPlan.kind === "focus" ? "Focus" : "Mix"} · {centerPlan.orbSub}</p>
          <h3>{centerPlan.headline}</h3>
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
              <span>{mixMode ? "Picking" : "Add more"}</span>
            </button>
          </div>
          <button type="button" className="hm-btn is-primary" disabled={!centerPlan.openTab && !centerPlan.tuneIds.length && !centerPlan.studyHubIds.length} onClick={launchPlan}>
            <Glyph name="play" size={15} />Play {centerPlan.headline}
          </button>
          {exerciseList("Exercises", centerPlan.exercises.slice(0, 4))}
          {modePills("Scales & modes")}
        </div>
      ),
    };
  } else if (pickedSong) {
    const hub = songHubs.get(pickedSong.tuneId);
    const isLead = pickedSong.tuneId === leadId && session.has(pickedSong.tuneId);
    const inSession = session.has(pickedSong.tuneId);
    card = {
      anchor: `tune:${pickedSong.tuneId}`,
      content: (
        <div className="hm-card is-song" role="group" aria-label={pickedSong.title}>
          {close}
          <div className="hm-card-head">
            <button type="button" className="hm-key-chip" onClick={() => hub && selectKey(hub)}>{keyLabel(pickedSong)}</button>
            <p className="hm-kicker">{[pickedSong.barCount ? `${pickedSong.barCount} bars` : null, pickedSong.composer].filter(Boolean).join(" · ")}</p>
          </div>
          <h3>{pickedSong.title}</h3>
          <Progress song={pickedSong} />
          <button type="button" className="hm-btn is-primary" onClick={launchPlan}>
            <Glyph name="play" size={15} />Practice solo
          </button>
          <div className="hm-card-actions">
            <button type="button" className="hm-btn" onClick={() => playWhole(pickedSong.tuneId)}><Glyph name="melody" size={15} />Whole tune</button>
            <button type="button" className="hm-btn" aria-pressed={inSession} onClick={() => session.toggle(pickedSong.tuneId)}>
              <Glyph name={inSession ? "check" : "plus"} size={15} />{inSession ? "In session" : "Add to session"}
            </button>
            <button type="button" className={`hm-btn ${isLead ? "is-lead" : ""}`} aria-pressed={isLead} disabled={isLead} onClick={() => makeLead(pickedSong.tuneId)}>
              <Glyph name="arrow" size={15} />{isLead ? "Starts here" : "Start here"}
            </button>
            <button type="button" className="hm-btn" onClick={() => onOpenSong(pickedSong.tuneId)}><Glyph name="reading" size={15} />Score</button>
            {onListenSong ? <button type="button" className="hm-btn hm-btn--span" onClick={() => onListenSong(pickedSong.tuneId)}><Glyph name="ear" size={15} />Listen to backing</button> : null}
          </div>
          {pickedSong.next.length ? (
            <div className="hm-card-list">
              <p className="hm-kicker">Next up</p>
              <ul>
                {pickedSong.next.slice(0, 3).map((unit) => (
                  <li key={unit.id}>
                    <button type="button" className="hm-ex-row" onClick={() => play(pickedSong.tuneId, unit.id)}>
                      <span className="hm-ex-copy">
                        <strong>{unit.title}</strong>
                        <small>{FAMILY_LABEL[unit.family]}{unit.where ? ` · ${unit.where}` : ""}{unit.bpm ? ` · ♩${unit.bpm}` : ""}</small>
                      </span>
                      <span className="hm-ex-go"><Glyph name="play" size={12} /></span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ),
    };
  } else if (pickedKey) {
    const patterns = pickedKey.skills.filter((s) => !s.skill.startsWith("run:"));
    const rhythms = pickedKey.skills.filter((s) => s.skill === "run" || s.skill.startsWith("run:"));
    card = {
      anchor: pickedKey.hubId,
      content: (
        <div className="hm-card is-key" role="group" aria-label={pickedKey.fullName}>
          {close}
          <div className="hm-card-head">
            <span className="hm-key-chip is-static">{pickedKey.shortName}</span>
            <button type="button" className="hm-rel-link" onClick={() => selectKey(pickedKey.relativeHubId)}>Relative · {pickedKey.relativeName}</button>
          </div>
          <h3>{pickedKey.fullName}</h3>
          <button type="button" className="hm-btn is-primary" onClick={launchPlan}>
            <Glyph name="play" size={15} />
            {keySongs.length ? `Play ${pickedKey.shortName} · ${keySongs.length} tune${keySongs.length === 1 ? "" : "s"} & scales` : `Play ${pickedKey.shortName} · scales & modes`}
          </button>
          <div className="hm-skill-grid" role="list" aria-label={`Exercises in ${pickedKey.fullName}`}>
            {patterns.map((skill) => {
              const bpm = map.tempo?.get(skill.id);
              return (
                <button key={skill.id} type="button" role="listitem" className={`hm-skill-card is-${skill.status}`} onClick={() => launchSkill(pickedKey.hubId, skill.skill)}>
                  <span className="hm-skill-head">
                    <strong>{skill.skill === "triads" ? "Chords" : skill.skill === "sevenths" ? "Arps" : skill.skill === "run" ? "Scale" : skill.label}</strong>
                    <BoxPips box={skill.box} status={skill.status} />
                  </span>
                  <small>{bpm ? `♩${bpm}` : skill.status === "kinship" ? "kinship" : "new"}</small>
                </button>
              );
            })}
          </div>
          <div className="hm-rhythm-bar" aria-label="Rhythm">
            {rhythms.map((r) => {
              const tier = r.skill === "run:sixteenths" ? "sixteenths" : r.skill === "run:triplets" ? "triplets" : "straight";
              return (
                <button key={r.id} type="button" className={`hm-rhythm-chip is-${tier} ${r.box > 0 ? "is-on" : ""}`} onClick={() => launchSkill(pickedKey.hubId, r.skill)}>
                  <i aria-hidden="true" />
                  <span>{tier === "sixteenths" ? "16ths" : tier === "triplets" ? "Triplets" : "Straight"}</span>
                  <small>{r.box > 0 ? `B${r.box}` : "—"}</small>
                </button>
              );
            })}
          </div>
          {keyFoundations.length ? (
            <div className="hm-card-list">
              <p className="hm-kicker">Foundations in {pickedKey.shortName}</p>
              <div className="hm-found-chips">
                {keyFoundations.map((t) => (
                  <button key={t.id} type="button" className="hm-found-chip" data-family={t.group} onClick={() => handleClickFoundation(t.id)}>
                    <i aria-hidden="true" />
                    <span>{t.short}</span>
                    <small>♩{shared.cards[t.id]?.bpm ?? t.bpm}</small>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {exerciseList(`From your tunes in ${pickedKey.shortName}`, centerPlan.exercises.slice(0, 3))}
          {keySongs.length ? (
            <div className="hm-card-list">
              <p className="hm-kicker">Tunes in {pickedKey.shortName}</p>
              <ul>
                {keySongs.map((song) => {
                  const inSession = session.has(song.tuneId);
                  return (
                    <li key={song.tuneId} className="hm-key-tune-row">
                      <button type="button" className="hm-ex-row" onClick={() => selectSong(song.tuneId)}>
                        <span className="hm-ex-copy">
                          <strong>{song.title}</strong>
                          <small>{Math.round(songFill(song) * 100)}% grown</small>
                        </span>
                        <span className="hm-ex-go"><Glyph name="arrow" size={12} /></span>
                      </button>
                      <button type="button" className={`hm-mini-toggle ${inSession ? "is-on" : ""}`} aria-pressed={inSession} onClick={() => session.toggle(song.tuneId)}>
                        {inSession ? "In session" : "+ Session"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          {modePills("Scales & modes")}
          {keySongs.length < 2 && pickedKey.ideas.length ? (
            <div className="hm-card-list">
              <div className="hm-ideas-head">
                <p className="hm-kicker">{keySongs.length ? `More tunes in ${pickedKey.shortName}` : `Tunes in ${pickedKey.shortName}`}</p>
                {onOpenLibrary ? <button type="button" className="hm-ideas-import" onClick={onOpenLibrary}><Glyph name="plus" size={12} />Import score</button> : null}
              </div>
              <ul className="hm-idea-chips">
                {pickedKey.ideas.map((idea) => (
                  <li key={idea.title}><strong>{idea.title}</strong><span>{idea.note}</span></li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ),
    };
  }

  return (
    <main className="home">
      <section className="hm-world" aria-label="Your map">
        <div className="hm-pond-bg" aria-hidden="true" data-nav-skip />

        <SongMap
          songs={mapSongs}
          map={map}
          shared={shared}
          sessionIds={sessionIds}
          leadId={leadId}
          selectedSongIds={selectedSongSet}
          selectedKeyIds={selectedKeySet}
          selectedFocus={selectedFocus}
          selectedFoundation={selectedFoundation}
          centerPlan={plan}
          mixMode={mixMode}
          popover={card}
          onToggleMixMode={() => setMixMode((on) => !on)}
          onClickSong={handleClickSong}
          onClickKey={handleClickKey}
          onClickFocus={handleClickFocus}
          onClickFoundation={handleClickFoundation}
          onLaunchCenter={launchPlan}
          onClearSelection={clearSelection}
          onToggleSession={(id) => session.toggle(id)}
          onAddSong={() => setAdding(true)}
        />

        <ul className="hm-legend" aria-label="Colours" data-nav-skip>
          <li data-family="scales"><i />Key exercises</li>
          {GROUP_ORDER.map((g) => <li key={g} data-family={g}><i />{FOUNDATION_GROUPS[g].label}</li>)}
          <li data-family="song"><i />Songs</li>
        </ul>

        <div className="hm-notices">
          {loading ? <p className="hm-quiet">Opening library…</p> : null}
          {input && input.status === "error" ? <ConnectGuitar input={input} /> : null}
          {error ? <p className="hm-error" role="alert">{error}</p> : null}
          {issues.length ? <button type="button" className="hm-notice" onClick={onOpenLibrary}>{issues.length} score{issues.length === 1 ? " needs" : "s need"} repair<Glyph name="arrow" size={16} /></button> : null}
        </div>

        {empty ? (
          <section className="hm-welcome" aria-label="Start with a song">
            <div className="hm-demos">
              {DEMO_TUNES.map((demo) => (
                <button key={demo.entry.id} type="button" className="hm-tile is-demo" disabled={demoBusy} onClick={() => void addDemo(demo)}>
                  <span className="hm-tile-key">{demo.label}</span>
                  <span className="hm-tile-title">{demo.title}</span>
                  <span className="hm-tile-meta"><Glyph name="plus" size={14} />Add to library</span>
                </button>
              ))}
            </div>
            {onOpenLibrary ? <button type="button" className="hm-add" onClick={onOpenLibrary}><Glyph name="library" size={18} />Import your own score</button> : null}
          </section>
        ) : null}
      </section>

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
