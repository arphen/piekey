import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import * as Tone from "tone";
import { version as appVersion } from "../../package.json";
import { buildPracticeBrief, type BriefDays, type BriefMaterial, type BriefScope, type PracticeBrief } from "../agent/brief";
import { ensureAudio } from "../audio/context";
import type { InputApi } from "../listen/useInput";
import { setNavMuted } from "../nav/useGuitarNav";
import { pitchClassToName } from "../musicTheory";
import { getLibraryIssues, hasOldLibrary, loadCurrentTuneId, loadLibrary, loadLibraryAsync, newTuneId, parseTuneEntry, removeLibraryEntry, sameTuneContent, saveCurrentTuneId, saveLibrary, subscribeLibraryIssues, type TuneEntry } from "../tunes/library";
import { loadTuneFile, parseMusicXml, type LeadSheet } from "../tunes/musicxml";
import { createBackup, parseBackup, restoreBackup, type PracticeBackup } from "../tunes/backup";
import { BLUE_HOUR_ENTRY, DEMO_TUNES, getDemoStudy, type DemoTune } from "../tunes/demos";
import { MUSICXML_AGENT_PROMPT } from "../tunes/agentPrompt";
import { retryStorageWrites } from "../storage";
import { buildTimeline } from "../tunes/order";
import { passageId, passageLabel, passageOccurrences, passageTimeline, validPassage, type PassageRange } from "../tunes/passage";
import { usePlayback } from "../tunes/usePlayback";
import type { NoteResult } from "../core/contract";
import { buildDeck, familiesOnly, type Family, type Focus } from "../song/deck";
import { hubIdFromStudyId, isKeyStudyId, keyStudySheet } from "../song/keyStudy";
import { allStores, BOXES, loadStore, today } from "../song/leitner";
import { addSessionTune, useSessionSet } from "../song/sessionSet";
import { loadActiveGoal } from "../song/goals";
import { nextUnits } from "../overview/summary";
import { Glyph } from "./Glyph";
import { UnitCard } from "./UnitCard";
import { Score } from "./Score";
import { GoalChooser } from "./GoalChooser";
import { PracticeBriefPanel } from "./PracticeBriefPanel";
import { openPractice, SongCoach } from "./SongCoach";
import { LibraryGrid } from "./LibraryGrid";
import "../tunes/tunes.css";
import "../tunes/library.css";

const NO_RESULTS: NoteResult[] = [];
const EXERCISE_FAMILIES: Family[] = ["scales", "technique", "harmony", "chords", "reading", "ear", "fretboard"];

const noteLabel = (midi: number) => `${pitchClassToName(midi).replace("#", "♯")}${Math.floor(midi / 12) - 1}`;

export interface PracticeLaunchOptions {
  focus?: Focus;
  mixIds?: string[];
  studyHubIds?: string[];
}

interface Launch extends PracticeLaunchOptions {
  kind: "song" | "listen" | "session" | "card";
  tuneId?: string;
  cardId?: string;
}

type PendingImport = Omit<TuneEntry, "id"> & { repairId?: string };

export function TuneView({ input, launch, onLaunched, songId, onSong, onSessionEnd, onStartPractice }: {
  input: InputApi;
  launch?: Launch;
  onLaunched?: () => void;
  /** The shell's route: a tune's page, or null for the library. Left out, the view keeps its own choice. */
  songId?: string | null;
  onSong?(id: string | null, replace?: boolean): void;
  onSessionEnd?(): void;
  onStartPractice?(tuneId: string): void;
}) {
  const [library, setLibrary] = useState<TuneEntry[]>(() => loadLibrary());
  const [demoPreview, setDemoPreview] = useState<TuneEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingImport[]>([]);
  const [replaceId, setReplaceId] = useState("");
  const [restore, setRestore] = useState<PracticeBackup | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const controlled = songId !== undefined;
  const [ownSelected, setOwnSelected] = useState<string | null>(() => loadCurrentTuneId());
  const selected = controlled ? songId : ownSelected;
  const browsing = controlled && songId === null;
  const [goalOpen, setGoalOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [brief, setBrief] = useState<PracticeBrief | null>(null);
  const [briefOpen, setBriefOpen] = useState(false);
  const [briefDays, setBriefDays] = useState<BriefDays>(28);
  const [briefScope, setBriefScope] = useState<BriefScope>("selected-tune");
  const [studyOpen, setStudyOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [showFingering, setShowFingering] = useState(false);
  const [melody, setMelody] = useState(true);
  const [chords, setChords] = useState(true);
  const [click, setClick] = useState(false);
  const [countIn, setCountIn] = useState(false);
  const [bpm, setBpm] = useState(80);
  const [range, setRange] = useState<PassageRange | null>(null); // inclusive playing-order slots
  const [customPassage, setCustomPassage] = useState(false);
  const [passageDraft, setPassageDraft] = useState<PassageRange | null>(null);
  const [looping, setLooping] = useState(false);
  const [coach, setCoach] = useState(false); // the full-screen practice session
  const [sessionLaunch, setSessionLaunch] = useState<Launch>();
  const [demoToListen, setDemoToListen] = useState<string | null>(null);
  const launched = useRef<Launch>();
  const openingDemo = useRef(false);
  const browseScroll = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);
  const passageToggle = useRef<HTMLButtonElement>(null);
  const repairTarget = useRef<string>();
  const libraryIssues = useSyncExternalStore(subscribeLibraryIssues, getLibraryIssues, getLibraryIssues);

  useEffect(() => {
    let gone = false;
    void loadLibraryAsync().then((entries) => {
      if (!gone) {
        setLibrary(entries);
        setLoading(false);
      }
    }).catch((error: unknown) => {
      if (!gone) {
        setLoadError(error instanceof Error ? error.message : "The saved library could not be opened.");
        setLoading(false);
      }
    });
    return () => { gone = true; };
  }, []);

  const selectedStudyHub = hubIdFromStudyId(selected);
  const selectedIssue = libraryIssues.find((issue) => issue.id === selected);
  const entry = selectedIssue || browsing || selectedStudyHub ? null : library.find((t) => t.id === selected)
    ?? (demoPreview?.id === selected ? demoPreview : null) ?? library[0] ?? null;
  const libraryIds = useMemo(() => library.map((tune) => tune.id), [library]);
  const sessionSet = useSessionSet(libraryIds);
  useEffect(() => { setBrief(null); setStudyOpen(false); }, [entry, revision]);
  const study = useMemo(() => entry ? getDemoStudy(entry) : undefined, [entry]);
  const parsed = useMemo((): { sheet: LeadSheet | null; error: string | null } => {
    if (selectedStudyHub) {
      const built = keyStudySheet(selectedStudyHub);
      return built ? { sheet: built, error: null } : { sheet: null, error: "Could not build that key study." };
    }
    if (!entry) return { sheet: null, error: null };
    try {
      return { sheet: parseTuneEntry(entry), error: null };
    } catch (e) {
      return { sheet: null, error: e instanceof Error ? e.message : "Couldn't read this tune." };
    }
  }, [entry, selectedStudyHub]);
  const sheet = parsed.sheet;
  const tl = useMemo(() => buildTimeline(sheet ?? { bars: [], comp: [] }), [sheet]);

  // the rest of the library + any virtual key studies in a custom mix, read only while the practice session is open
  const others = useMemo(() => {
    if (!coach) return [];
    const fromLibrary = library.flatMap((t) => {
      if (t.id === sheet?.id) return [];
      try {
        const s = parseTuneEntry(t);
        return [{ sheet: s, tl: buildTimeline(s) }];
      } catch {
        return [];
      }
    });
    const fromStudies = (sessionLaunch?.studyHubIds ?? []).flatMap((hub) => {
      const s = keyStudySheet(hub);
      if (!s || s.id === sheet?.id) return [];
      return [{ sheet: s, tl: buildTimeline(s) }];
    });
    return [...fromLibrary, ...fromStudies];
  }, [coach, library, sheet?.id, sessionLaunch?.studyHubIds]);

  // a new tune: its own tempo, no loop
  useEffect(() => {
    setBpm(sheet?.tempo ?? 80);
    setRange(null);
    setCustomPassage(false);
    setPassageDraft(null);
    setLooping(false);
  }, [sheet]);

  const pick = useCallback((id: string, replace = false) => {
    if (controlled) onSong?.(id, replace);
    else setOwnSelected(id);
    if (!isKeyStudyId(id)) saveCurrentTuneId(id);
  }, [controlled, onSong]);
  const toLibrary = useCallback((replace = false) => {
    if (controlled) onSong?.(null, replace);
  }, [controlled, onSong]);

  useEffect(() => {
    if (!launch || loading || launched.current === launch) return;
    if (launch.tuneId && sheet?.id !== launch.tuneId) {
      if (isKeyStudyId(launch.tuneId)) {
        pick(launch.tuneId, true);
        return;
      }
      if (libraryIssues.some((issue) => issue.id === launch.tuneId)) {
        toLibrary(true);
        launched.current = launch;
        onLaunched?.();
        return;
      }
      if (library.some((tune) => tune.id === launch.tuneId)) pick(launch.tuneId, true);
      else {
        const bundled = DEMO_TUNES.find((demo) => demo.entry.id === launch.tuneId);
        if (bundled) {
          setDemoPreview(bundled.entry);
          pick(bundled.entry.id, true);
          setNotice("Previewing the bundled study. It has not been saved to your library.");
        } else {
          setLoadError("That tune is no longer in the library.");
          launched.current = launch;
          onLaunched?.();
        }
      }
      return;
    }
    if (!sheet) return;
    launched.current = launch;
    if (launch.kind === "listen") {
      setCoach(false);
      setDemoToListen(sheet.id);
    } else if (launch.kind !== "song") {
      setSessionLaunch(launch);
      setCoach(true);
    } else setCoach(false);
    onLaunched?.();
  }, [launch, loading, sheet, library, libraryIssues, pick, toLibrary, onLaunched]);

  const candidate = pending[0];
  useEffect(() => { setReplaceId(candidate?.repairId ?? ""); }, [candidate?.xml, candidate?.repairId]);
  const preview = useMemo(() => {
    if (!candidate) return null;
    try {
      return { sheet: parseMusicXml(candidate.xml, candidate.name, candidate), error: null };
    } catch (error) {
      return { sheet: null, error: error instanceof Error ? error.message : "That part could not be read." };
    }
  }, [candidate]);
  const previewSource = preview?.sheet?.source;
  const duplicate = useMemo(() => candidate && previewSource
    ? library.find((saved) => sameTuneContent(saved, { ...candidate, partId: previewSource.partId, voice: previewSource.voice }))
    : undefined, [candidate, previewSource, library]);

  const addFiles = useCallback(
    async (files: FileList | File[], repairId?: string) => {
      setLoadError(null);
      setNotice(null);
      const previews: PendingImport[] = [];
      for (const file of [...files]) {
        try {
          const { xml, name } = await loadTuneFile(file);
          parseMusicXml(xml, name);
          previews.push({ xml, name, ...(repairId && !previews.length ? { repairId } : {}) });
        } catch (e) {
          setLoadError(`${file.name}: ${e instanceof Error ? e.message : "couldn't read it"}`);
        }
      }
      setPending((current) => [...current, ...previews]);
    },
    [],
  );

  const remove = useCallback(async (id: string) => {
    setBusy(true);
    try {
      if (await removeLibraryEntry(id)) {
        setLibrary(await loadLibraryAsync());
        setNotice("Removed from the library. Its practice history has been kept.");
        if (id === entry?.id) toLibrary(true);
      } else setLoadError("The tune could not be removed. Your saved library is unchanged.");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "The tune could not be removed.");
    } finally { setBusy(false); }
  }, [entry?.id, toLibrary]);

  const repairScore = (id: string) => {
    repairTarget.current = id;
    fileRef.current?.click();
  };
  const removeDamaged = async (id: string) => {
    if (loading || busy) return;
    setBusy(true);
    try {
      if (!await removeLibraryEntry(id)) throw new Error("This entry could not be removed. Try again after saving pending changes.");
      const entries = await loadLibraryAsync();
      setLibrary(entries);
      if (selected === id) {
        if (controlled) toLibrary(true);
        else setOwnSelected(entries[0]?.id ?? null);
      }
      setNotice("Damaged score entry removed. Its practice history has been kept.");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "The entry could not be removed.");
    } finally { setBusy(false); }
  };

  const acceptImport = async () => {
    if (!candidate || !preview?.sheet || !previewSource || busy) return;
    if (duplicate && !replaceId) {
      pick(duplicate.id);
      setPending((queue) => queue.slice(1));
      setNotice("That score is already in your library. Opened the existing tune.");
      return;
    }
    setBusy(true);
    const { repairId: _repair, ...score } = candidate;
    const imported: TuneEntry = { ...score, id: replaceId || newTuneId(), partId: previewSource.partId, voice: previewSource.voice };
    const next = [...library.filter((saved) => saved.id !== imported.id), imported];
    if (await saveLibrary(next)) {
      setLibrary(next);
      if (!replaceId) addSessionTune(imported.id, next.map((saved) => saved.id));
      pick(imported.id);
      setPending((queue) => queue.slice(1));
      setReplaceId("");
      setLoadError(null);
      setNotice(replaceId ? "Score replaced. Its practice history has been kept." : "Tune saved.");
    } else setLoadError("This tune has not been saved. Keep this preview open and try again after freeing browser storage.");
    setBusy(false);
  };

  const exportPractice = async () => {
    setBusy(true);
    try {
      const backup = await createBackup();
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `fretboard-practice-${backup.createdAt.slice(0, 10)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Backup exported: tunes, settings and practice history. Audio recordings are kept on this browser and are not included.");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "The backup could not be exported.");
    }
    setBusy(false);
  };

  const restorePractice = async () => {
    if (!restore) return;
    setBusy(true);
    try {
      if (await restoreBackup(restore)) {
        setLibrary(await loadLibraryAsync());
        if (!controlled) setOwnSelected(loadCurrentTuneId());
        setRevision((value) => value + 1);
        setLoading(false);
        setRestore(null);
        setNotice("Backup restored. Tunes with other IDs were kept; matching settings and practice histories were replaced.");
        setLoadError(null);
      } else setLoadError("The backup could not be restored. Keep the backup file and try again after freeing browser storage.");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "The restored library could not be opened.");
    } finally { setBusy(false); }
  };

  const store = useMemo(() => sheet ? loadStore(sheet.id) : null, [sheet, revision]);
  const deck = useMemo(() => sheet && store ? buildDeck(sheet, tl, {
    window: store.settings.window ?? undefined,
    round: `${today()}:${store.sessions.length}`,
    seen: Object.fromEntries(Object.entries(store.cards).map(([id, state]) => [id, state.seen])),
  }) : null, [sheet, tl, store]);
  const phrases = useMemo(() => deck?.cards.filter((card) => card.family === "melody" && (card.step?.kind === "new" || card.step?.kind === "review")) ?? [], [deck]);
  const whole = deck?.cards.find((card) => card.step?.kind === "tune");
  const exercises = useMemo(() => deck && store
    ? EXERCISE_FAMILIES.flatMap((family) => nextUnits(familiesOnly(deck, [family]), store, 1))
    : [], [deck, store]);

  // Browsing makes sound without scoring the mic. The full-screen coach owns all practice.
  const listeningTl = useMemo(() => sheet && range && validPassage(tl, range) ? passageTimeline(sheet, tl, range) : tl, [sheet, tl, range]);
  const occurrences = useMemo(() => sheet ? passageOccurrences(sheet, tl) : [], [sheet, tl]);
  const playback = usePlayback(listeningTl, { bpm, melody, chords, click, countIn }, input, false, true);
  const { play, stop } = playback;
  const playingRef = useRef(false);
  playingRef.current = playback.playing;
  const slotRef = useRef(-1);
  slotRef.current = playback.activeSlot;
  const start = useCallback((from?: number) => {
    const first = from === undefined ? range?.start ?? 0 : range ? Math.max(range.start, Math.min(range.end, from)) : from;
    void play(first, range?.end, looping && Boolean(range)).catch((error: unknown) => {
      setLoadError(error instanceof Error ? error.message : "Playback could not start.");
    });
  }, [play, looping, range]);
  const startRef = useRef(start);
  startRef.current = start;

  useEffect(() => {
    setNavMuted(playback.playing);
    return () => setNavMuted(false);
  }, [playback.playing]);
  useEffect(() => {
    if (coach) stop();
  }, [coach, stop]);
  useEffect(() => {
    if (playingRef.current) startRef.current(Math.max(0, slotRef.current));
  }, [bpm]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (coach || event.key !== " " || document.querySelector("dialog[open]") || ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(target.tagName)) return;
      event.preventDefault();
      if (playingRef.current) stop();
      else startRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [coach, stop]);

  const practice = useCallback((cardId?: string) => {
    if (!sheet || loading || busy) return;
    stop();
    browseScroll.current = window.scrollY;
    openPractice(input);
    setSessionLaunch(cardId ? { kind: "card", tuneId: sheet.id, cardId } : undefined);
    setCoach(true);
  }, [sheet, loading, busy, stop, input]);
  const chooseDemo = async (demo: DemoTune, action: "open" | "listen" | "practice") => {
    if (loading || busy || openingDemo.current) return;
    openingDemo.current = true;
    setBusy(true);
    setLoadError(null);
    setNotice(null);
    setDemoToListen(null);
    stop();
    try {
      // Unlock sound in the click, before saving. Playback waits for the selected score to render.
      let audioReady: Promise<boolean> | null = null;
      if (action === "listen") {
        ensureAudio();
        audioReady = Tone.start().then(() => true, () => false);
      } else if (action === "practice") openPractice(input);
      const saved = library.find((tune) => tune.id === demo.entry.id);
      if (libraryIssues.some((issue) => issue.id === demo.entry.id)) {
        toLibrary();
        return;
      }
      const chosen = saved ?? demo.entry;
      const chosenSheet = parseTuneEntry(chosen);
      const next = saved ? library : [...library, chosen];
      let persisted = Boolean(saved);
      if (!saved) {
        try { persisted = await saveLibrary(next); }
        catch { /* The original study remains playable when browser persistence is unavailable. */ }
      }
      if (persisted) {
        setLibrary(next);
        addSessionTune(chosen.id, next.map((tune) => tune.id));
      } else {
        setDemoPreview(chosen);
        setNotice("Previewing the bundled study. It has not been saved to your library.");
      }
      pick(chosen.id);
      setBpm(chosenSheet.tempo ?? 80);
      setRange(null);
      setCustomPassage(false);
      setPassageDraft(null);
      setLooping(false);
      if (saved && !sameTuneContent(saved, demo.entry)) setNotice("Opened your saved version of this demo.");
      if (action === "listen") {
        setMelody(true);
        if (await audioReady) setDemoToListen(chosen.id);
        else setLoadError("The score is ready. Use Listen to piece to enable audio.");
      } else if (action === "practice") {
        setSessionLaunch(undefined);
        setCoach(true);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "This demo could not be opened.");
    } finally {
      openingDemo.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!demoToListen || loading || busy) return;
    setDemoToListen(null);
    if (sheet?.id !== demoToListen) return;
    start();
  }, [demoToListen, loading, busy, sheet?.id, start]);
  const downloadDemo = (demo: DemoTune) => {
    try {
      const url = URL.createObjectURL(new Blob([demo.entry.xml], { type: "application/vnd.recordare.musicxml+xml" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${demo.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "guitar-study"}.musicxml`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setLoadError("The score could not be downloaded. You can still open and play it here.");
    }
  };
  const generateBrief = async () => {
    if (loading || busy) return;
    setBusy(true);
    setLoadError(null);
    try {
      const entries = await loadLibraryAsync();
      const sheets = new Map<string, LeadSheet>();
      const materials: BriefMaterial[] = entries.map((tune) => {
        try {
          const parsedSheet = parseTuneEntry(tune);
          sheets.set(tune.id, parsedSheet);
          return { tuneId: tune.id, title: parsedSheet.title, key: parsedSheet.keySignature };
        } catch {
          return { tuneId: tune.id, title: tune.name, key: null };
        }
      });
      materials.push(...getLibraryIssues().map(({ id, name }) => ({ tuneId: id, title: name, key: null })));
      const selectedSheet = entry ? sheets.get(entry.id) : undefined;
      const selectedDeck = selectedSheet ? buildDeck(selectedSheet, buildTimeline(selectedSheet), { window: loadStore(selectedSheet.id).settings.window ?? undefined }) : null;
      const now = new Date();
      setBrief(buildPracticeBrief({
        appVersion,
        generatedAt: now.toISOString(),
        day: today(now),
        selectedTuneId: entry?.id ?? null,
        materials,
        stores: allStores(),
        selectedExercises: selectedDeck?.cards.map((card) => ({ id: card.id, title: card.title })),
        selectedGoal: selectedSheet && selectedDeck ? loadActiveGoal(selectedSheet, selectedDeck) : null,
        scope: entry ? briefScope : "all-music",
        days: briefDays,
      }));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "The practice brief could not be prepared.");
    } finally {
      setBusy(false);
    }
  };
  const onBarClick = useCallback((bar: number) => {
    const phrase = phrases.find((card) => card.tl.slots.slice(card.from, card.to + 1).some((slot) => slot.bar === bar));
    if (phrase) { stop(); setRange({ start: phrase.from, end: phrase.to }); setCustomPassage(false); }
    else setNotice("There are no melody notes to practise in this bar.");
  }, [phrases, stop]);
  const selectedPhrase = !customPassage && range ? phrases.find((card) => card.from === range.start && card.to === range.end) : undefined;
  const hasPassageNotes = Boolean(range && listeningTl.targets.some((target) => target.slot >= range.start && target.slot <= range.end));
  const playingBar = playback.playing ? tl.slots[playback.activeSlot]?.bar ?? -1 : -1;
  const barLabel = (bar: number) => sheet?.barNumbers[bar] ?? String(bar + 1);
  const activeTarget = playback.activeTarget >= 0 ? listeningTl.targets[playback.activeTarget] : undefined;
  const selectedBars = range ? [...new Set(tl.slots.slice(range.start, range.end + 1).map((slot) => slot.bar))].sort((a, b) => a - b) : null;
  const marked = selectedBars?.length && selectedBars.every((bar, index) => bar === selectedBars[0] + index)
    ? { start: selectedBars[0], end: selectedBars[selectedBars.length - 1] } : null;

  if (coach && sheet) return (
    <SongCoach
      sheet={sheet}
      tl={tl}
      input={input}
      onClose={() => { setCoach(false); setRevision((value) => value + 1); window.requestAnimationFrame(() => window.scrollTo(0, browseScroll.current)); onSessionEnd?.(); }}
      tunes={library.map((tune) => ({ id: tune.id, title: tune.name }))}
      onTune={(id) => {
        const target = library.find((tune) => tune.id === id);
        if (!target) throw new Error("That tune is no longer available. Choose another tune.");
        parseTuneEntry(target); // Keep the current room if the next score cannot open.
        setSessionLaunch(undefined);
        pick(id, true);
      }}
      others={others}
      mixIds={sessionLaunch?.mixIds}
      focus={sessionLaunch?.focus}
      initialCardId={sessionLaunch?.kind === "card" ? sessionLaunch.cardId : undefined}
    />
  );

  return (
    <main className={`tunes ${dragging ? "is-dragging" : ""}`} aria-busy={loading || busy}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!loading && !busy && event.dataTransfer.files.length) void addFiles(event.dataTransfer.files);
      }}
    >
      {browsing ? <header className="lib-head">
        <div>
          <p className="tunes-kicker">Library</p>
          <h2>Your songs</h2>
          <p className="tunes-byline">{loading ? "Opening library…" : `${library.length} song${library.length === 1 ? "" : "s"} · ${sessionSet.ids.length} in the next session`}</p>
        </div>
        <div className="lib-head-actions">
          <button type="button" className="lib-btn is-primary" onClick={() => { repairTarget.current = undefined; fileRef.current?.click(); }} disabled={loading || busy}><Glyph name="plus" size={18} />Import score</button>
          <button type="button" className="lib-btn" aria-expanded={toolsOpen} aria-controls="song-library-tools" onClick={() => setToolsOpen((open) => !open)}><Glyph name="tools" size={18} />Backup &amp; tools</button>
        </div>
      </header> : <header className="tunes-heading">
        <div>
          {controlled ? <button type="button" className="tunes-back" onClick={() => toLibrary()}><Glyph name="arrow" size={18} />Library</button> : null}
          <p className="tunes-kicker">Song</p>
          <h2>{sheet?.title ?? selectedIssue?.name ?? (loading ? "Opening library…" : "Your music")}</h2>
          {sheet ? <p className="tunes-byline">{[sheet.composer, sheet.keySignature, sheet.timeSignature, `${sheet.bars.length} bars`].filter(Boolean).join(" · ")}</p> : null}
        </div>
        {sheet && library.some((tune) => tune.id === sheet.id) ? <button type="button" className="tunes-session-toggle" aria-pressed={sessionSet.has(sheet.id)} onClick={() => sessionSet.toggle(sheet.id)}>
          <Glyph name={sessionSet.has(sheet.id) ? "check" : "plus"} size={18} />{sessionSet.has(sheet.id) ? "In next session" : "Add to next session"}
        </button> : null}
      </header>}

      {browsing && toolsOpen ? <div id="song-library-tools" className="tunes-backup-deck" aria-label="Library tools">
        <div className="tunes-backup-grid">
          <button type="button" className="tunes-backup-card" onClick={() => void exportPractice()} disabled={loading || busy}>
            <strong><Glyph name="download" size={16} />Export practice backup</strong>
            <span>Download a JSON file of your songs, box progress and settings. Audio stays local or in a full .fretpack transfer.</span>
          </button>
          <button type="button" className="tunes-backup-card" onClick={() => backupRef.current?.click()} disabled={busy}>
            <strong><Glyph name="plus" size={16} />Restore backup…</strong>
            <span>Recover tunes, settings and practice history from a previously exported JSON backup file.</span>
          </button>
          <button type="button" className="tunes-backup-card" aria-expanded={briefOpen} onClick={() => setBriefOpen((open) => !open)} disabled={loading || busy}>
            <strong><Glyph name="arrow" size={16} />Practice brief</strong>
            <span>Create a private, read-only summary of recent practice data to share with a teacher or external assistant.</span>
          </button>
        </div>
        <div className="tunes-backup-foot">
          <p className="tunes-note">Everything stays local in your browser · use Devices for full encrypted .fretpack sync including audio.</p>
          <button type="button" className="tunes-retry-link" onClick={() => {
            const saved = retryStorageWrites();
            setNotice(saved ? "Pending changes saved." : "Some changes are still unsaved. Keep the app open and export a backup.");
          }} disabled={busy}>Retry saving</button>
        </div>
        {briefOpen ? <PracticeBriefPanel brief={brief} scope="all-music" days={briefDays} hasTune={false} busy={loading || busy}
          onScope={(scope) => { setBriefScope(scope); setBrief(null); }} onDays={(days) => { setBriefDays(days); setBrief(null); }}
          onPrepare={() => void generateBrief()} onClose={() => setBriefOpen(false)} /> : null}
      </div> : null}
      <input ref={fileRef} hidden type="file" accept=".musicxml,.xml,.mxl" multiple onChange={(event) => {
        if (event.target.files?.length) void addFiles(event.target.files, repairTarget.current);
        repairTarget.current = undefined;
        event.target.value = "";
      }} />
      <input ref={backupRef} hidden type="file" accept=".json,application/json" onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        setLoadError(null);
        if (file.size > 100 * 1024 * 1024) return setLoadError("Choose a practice backup smaller than 100 MB.");
        void file.text().then((raw) => setRestore(parseBackup(raw))).catch((error: unknown) => setLoadError(error instanceof Error ? error.message : "That backup could not be read."));
      }} />
      {loadError || parsed.error ? <p className="tunes-error" role="alert">{loadError ?? parsed.error}</p> : null}
      {notice ? <p className="tunes-note" role="status">{notice}</p> : null}
      {!loading && libraryIssues.length ? <section className="tunes-import" aria-label="Scores needing repair">
        <h3>Scores needing repair</h3>
        <p>Healthy tunes can still be played. Re-import a damaged score to keep its identity and practice history. Complete backups and device exchange require these entries to be repaired or explicitly removed.</p>
        {libraryIssues.map((issue) => <div key={issue.id}>
          <p><strong>{issue.name}</strong> · {issue.message}</p>
          <div className="reading-controls">
            <button type="button" onClick={() => repairScore(issue.id)} disabled={busy}>Re-import {issue.name}</button>
            <button type="button" className="tunes-remove" onClick={() => void removeDamaged(issue.id)} disabled={busy}>Remove damaged entry</button>
          </div>
        </div>)}
      </section> : null}
        {candidate ? (
          <section className="tunes-import" aria-label="import preview">
            <h3>Check this score</h3>
            <p><strong>{preview?.sheet?.title ?? candidate.name}</strong>{pending.length > 1 ? ` · ${pending.length} files to review` : ""}</p>
            {previewSource ? (
              <>
                <div className="reading-controls">
                  <label>Melody part{" "}
                    <select value={previewSource.partId} onChange={(event) => {
                      const partId = event.target.value;
                      setPending((queue) => [{ ...queue[0], partId, voice: undefined }, ...queue.slice(1)]);
                      setReplaceId(candidate.repairId ?? "");
                    }}>
                      {previewSource.parts.filter((part) => part.notes > 0).map((part) => <option key={part.id} value={part.id}>{part.name}</option>)}
                    </select>
                  </label>
                  {previewSource.parts.find((part) => part.id === previewSource.partId)!.voices.length > 1 ? (
                    <label>Voice{" "}
                      <select value={previewSource.voice} onChange={(event) => {
                        const voice = event.target.value;
                        setPending((queue) => [{ ...queue[0], voice }, ...queue.slice(1)]);
                      }}>
                        {previewSource.parts.find((part) => part.id === previewSource.partId)!.voices.map((voice) => <option key={voice} value={voice}>{voice}</option>)}
                      </select>
                    </label>
                  ) : null}
                </div>
                <p>{preview!.sheet!.bars.length} bars · Key {preview!.sheet!.keySignature} · Sounds {noteLabel(previewSource.range[0])}–{noteLabel(previewSource.range[1])} · {previewSource.hasChords ? "Chords available" : "No chords"}</p>
                {previewSource.warnings.length ? <ul>{previewSource.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
                {duplicate ? <p>This part and voice are already saved as <strong>{duplicate.name}</strong>.</p> : null}
                {(library.length || libraryIssues.length) && (!duplicate || candidate.repairId) ? (
                  <label>Save as{" "}
                    <select value={replaceId} onChange={(event) => setReplaceId(event.target.value)}>
                      <option value="">A separate tune or arrangement</option>
                      {library.map((saved) => <option key={saved.id} value={saved.id}>Replace {saved.name} · keep its history</option>)}
                      {libraryIssues.map((issue) => <option key={issue.id} value={issue.id}>Repair {issue.name} · keep its history</option>)}
                    </select>
                  </label>
                ) : null}
                {replaceId ? <p>Replacing keeps this tune's identity and practice history. Exercises may differ in the new score.</p> : null}
              </>
            ) : <p className="reading-error" role="alert">{preview?.error}</p>}
            <div className="reading-controls">
              <button type="button" className="tunes-play" onClick={() => void acceptImport()} disabled={!previewSource || loading || busy}>
                {busy ? "Saving…" : duplicate && !replaceId ? "Open existing tune" : replaceId ? "Replace selected tune" : "Import tune"}
              </button>
              <button type="button" className="coach-btn" disabled={busy} onClick={() => {
                setPending((queue) => queue.slice(1));
                setReplaceId("");
              }}>Skip this file</button>
            </div>
          </section>
        ) : null}

        {restore ? (
          <section className="tunes-import" aria-label="restore preview">
            <h3>Restore {restore.tunes.length} tunes and their practice data?</h3>
            <p>Matching tune identities, histories and settings will be replaced by this backup. Other tunes stay in the library. Audio recordings are not included.</p>
            <div className="reading-controls">
              <button type="button" className="tunes-play" onClick={() => void restorePractice()} disabled={busy}>{busy ? "Restoring…" : "Restore backup"}</button>
              <button type="button" className="coach-btn" onClick={() => setRestore(null)} disabled={busy}>Cancel restore</button>
            </div>
          </section>
        ) : null}


      {browsing ? <>
        <LibraryGrid
          library={library}
          issues={libraryIssues}
          session={sessionSet}
          busy={loading || busy}
          onOpen={(id) => pick(id)}
          onPlay={onStartPractice}
          onRemove={(id) => void remove(id)}
          onImport={() => { repairTarget.current = undefined; fileRef.current?.click(); }}
          onRepair={(id) => repairScore(id)}
        />
        {DEMO_TUNES.some((demo) => !library.some((tune) => tune.id === demo.entry.id)) ? <DemoShelf library={library} disabled={loading || busy} onChoose={(demo, action) => void chooseDemo(demo, action)} onDownload={downloadDemo} /> : null}
        <AgentScorePrompt />
      </> : sheet ? <>
        <div className="tunes-score-actions">
          <button type="button" className={`tunes-listen-button ${playback.playing ? "is-playing" : ""}`} aria-pressed={playback.playing} onClick={() => playback.playing ? stop() : start()} disabled={!tl.slots.length || loading || busy}>
            {playback.playing ? <span className="tunes-stop" aria-hidden="true" /> : <Glyph name="play" size={17} />}{playback.playing ? "Stop" : range ? customPassage ? "Listen to passage" : "Listen to phrase" : "Listen to piece"}
          </button>
          <button type="button" className="tunes-practice-piece" onClick={() => practice(whole?.id)} disabled={!whole || loading || busy}>Practice piece<Glyph name="arrow" size={16} /></button>
          <button type="button" ref={passageToggle} className="tunes-passage-toggle" aria-expanded={Boolean(passageDraft)} aria-controls="song-passage-picker" onClick={() => {
            stop();
            setPassageDraft((draft) => draft ? null : range ?? { start: 0, end: 0 });
          }} disabled={!tl.slots.length || loading || busy}>Select passage</button>
          <span className="tunes-play-position">{playback.playing ? playback.counting ? "Count-in" : playingBar >= 0 ? occurrences[playback.activeSlot]?.label ?? `Bar ${barLabel(playingBar)}` : "" : ""}</span>
          <button type="button" className="tunes-sound-toggle" aria-expanded={soundOpen} aria-controls="song-sound" onClick={() => setSoundOpen((open) => !open)}><Glyph name="free" size={17} />{bpm}<span>Sound</span></button>
        {range ? <div className="tunes-selection" role="group" aria-label={customPassage ? "Selected passage" : "Selected phrase"}>
          <span>{customPassage ? <strong>{passageLabel(sheet, tl, range)}</strong> : <><strong>{selectedPhrase?.where}</strong><small>Playing order {range.start + 1}–{range.end + 1}</small></>}</span>
          <button type="button" aria-pressed={looping} onClick={() => { stop(); setLooping((value) => !value); }}><Glyph name="sync" size={16} />Loop</button>
          <button type="button" disabled={!hasPassageNotes || loading || busy} onClick={() => practice(customPassage ? passageId(sheet, range) : selectedPhrase?.id)}><Glyph name="play" size={16} />{customPassage ? "Practise passage" : "Practise phrase"}</button>
          {selectedPhrase ? <button type="button" onClick={() => practice(`rhythm:${selectedPhrase.id}`)}><Glyph name="free" size={16} />Rhythm on one note</button> : null}
          <button type="button" aria-label={customPassage ? "Clear passage selection" : "Clear phrase selection"} onClick={() => { stop(); setRange(null); setCustomPassage(false); setPassageDraft(null); setLooping(false); }}><Glyph name="close" size={15} /></button>
          {!hasPassageNotes ? <small className="tunes-note">This passage has no melody notes to practise. You can still listen or loop.</small> : null}
        </div> : null}
        </div>
        {passageDraft ? <section id="song-passage-picker" className="tunes-passage" aria-label="Choose passage">
          <p className="tunes-note">Choose exact occurrences in playing order. Returns and repeats between them stay in the passage.</p>
          <div className="tunes-passage-fields">
            <label>Start<select value={passageDraft.start} onChange={(event) => {
              const start = Number(event.target.value);
              setPassageDraft((draft) => draft ? { start, end: Math.max(start, draft.end) } : null);
            }}>{occurrences.map((item) => <option key={item.slot} value={item.slot}>{item.label}</option>)}</select></label>
            <label>End<select value={passageDraft.end} onChange={(event) => {
              const end = Number(event.target.value);
              setPassageDraft((draft) => draft ? { ...draft, end } : null);
            }}>{occurrences.map((item) => <option key={item.slot} value={item.slot} disabled={item.slot < passageDraft.start}>{item.label}</option>)}</select></label>
          </div>
          <div className="tunes-passage-actions">
            <button type="button" onClick={() => { stop(); setRange(passageDraft); setCustomPassage(true); setPassageDraft(null); passageToggle.current?.focus(); }}>Use passage<Glyph name="arrow" size={14} /></button>
            <button type="button" onClick={() => { setPassageDraft(null); passageToggle.current?.focus(); }}>Cancel</button>
          </div>
          <p className="tunes-note">A note held into the start is picked again; notes stop at the selected end.</p>
        </section> : null}
        {soundOpen ? <div id="song-sound" className="tunes-sound" aria-label="Playback options">
          <div className="tunes-tempo" role="group" aria-label="Playback tempo"><button type="button" aria-label="Slower" onClick={() => setBpm((value) => Math.max(30, value - 5))}>−</button><span>{bpm} bpm</span><button type="button" aria-label="Faster" onClick={() => setBpm((value) => Math.min(240, value + 5))}>+</button></div>
          <button type="button" aria-pressed={melody} onClick={() => setMelody((value) => !value)}>Melody</button>
          {sheet.comp.length ? <button type="button" aria-pressed={chords} onClick={() => setChords((value) => !value)}>Chords</button> : null}
          <button type="button" aria-pressed={click} onClick={() => setClick((value) => !value)}>Click</button>
          <button type="button" aria-pressed={countIn} onClick={() => setCountIn((value) => !value)}>Count-in</button>
          <button type="button" aria-pressed={showFingering} onClick={() => setShowFingering((value) => !value)}>String &amp; fret hints</button>
          {phrases.length ? <label>Quick phrases<select value={selectedPhrase ? `${selectedPhrase.from}:${selectedPhrase.to}` : customPassage ? "custom" : ""} onChange={(event) => {
            stop();
            const phrase = phrases.find((card) => `${card.from}:${card.to}` === event.target.value);
            setRange(phrase ? { start: phrase.from, end: phrase.to } : null);
            setCustomPassage(false);
            setPassageDraft(null);
            setLooping(Boolean(phrase));
          }}><option value="">Whole piece</option>{customPassage ? <option value="custom" disabled>Selected passage</option> : null}{phrases.map((card) => <option key={card.id} value={`${card.from}:${card.to}`}>{card.where} · playing order {card.from + 1}–{card.to + 1}</option>)}</select></label> : null}
        </div> : null}
        <section className="tunes-manuscript" aria-label={`${sheet.title} score`}>
          <div className="tunes-score-caption"><Glyph name="melody" size={15} /><span>{passageDraft ? "Choose the start and end above" : "Choose a bar for its phrase, or select an exact passage"}</span></div>
          <Score exercise={sheet} activeStep={activeTarget?.notes[0] ?? -1} activeNotes={activeTarget?.notes ?? []} results={NO_RESULTS} showFingering={showFingering} autoScroll onBarClick={passageDraft ? undefined : onBarClick} marked={marked} focusBars={selectedBars} playingBar={playingBar} />
        </section>

        {phrases.length ? <section className="tunes-phrases" aria-labelledby="song-phrases-title">
          <h3 id="song-phrases-title">Phrases</h3>
          <div className="tunes-strip">{phrases.map((card) => {
            const bars = new Set(card.tl.slots.slice(card.from, card.to + 1).map((slot) => slot.bar)).size || 1;
            const box = store?.cards[card.id]?.box ?? 0;
            return <button type="button" key={card.id} aria-pressed={selectedPhrase?.id === card.id} style={{ "--bars": bars, "--box": box / BOXES } as CSSProperties} onClick={() => { stop(); setRange({ start: card.from, end: card.to }); setCustomPassage(false); setPassageDraft(null); }} aria-label={`Select ${card.where}`} title={card.where}>
              <span>{card.where.replace(/^bars?\s+/i, "")}</span>
            </button>;
          })}</div>
        </section> : null}
        {study ? <section className="tunes-study" aria-label="Study notes">
          <button type="button" className="tunes-agent-toggle" aria-expanded={studyOpen} aria-controls="song-study-notes" onClick={() => setStudyOpen((open) => !open)}><Glyph name="reading" size={17} />Study notes<Glyph name="plus" size={13} /></button>
          {studyOpen ? <div id="song-study-notes" className="tunes-study-body">
            <p>{study.purpose}</p>
            <dl><div><dt>Starting point</dt><dd>{study.startingPoint}</dd></div><div><dt>Under the fingers</dt><dd>{study.fingering}</dd></div><div><dt>Listen for</dt><dd>{study.listenFor}</dd></div><div><dt>{study.easier.bars[0] === study.easier.bars[1] ? `Bar ${study.easier.bars[0]}` : `Bars ${study.easier.bars.join("–")}`}</dt><dd>{study.easier.instruction}</dd></div><div><dt>Make it yours</dt><dd>{study.transfer}</dd></div></dl>
          </div> : null}
        </section> : null}
        {deck ? <section className="tunes-goal">
          <button type="button" className="tunes-agent-toggle" aria-expanded={goalOpen} aria-controls="song-goal" onClick={() => setGoalOpen((open) => !open)}><Glyph name="check" size={16} />Goal for this tune<Glyph name="plus" size={13} /></button>
          {goalOpen ? <div id="song-goal"><GoalChooser sheet={sheet} deck={deck} /></div> : null}
        </section> : null}
        {exercises.length ? <section className="tunes-exercises" aria-labelledby="song-exercises-title">
          <header><h3 id="song-exercises-title">Exercises</h3><button type="button" onClick={() => practice()}>Daily session<Glyph name="arrow" size={15} /></button></header>
          <div>{exercises.map((unit) => <UnitCard key={unit.id} unit={unit} onOpen={() => practice(unit.id)} />)}</div>
        </section> : null}
      </> : !entry && !loading ? <section className="tunes-empty">
        <DemoShelf library={library} disabled={busy} onChoose={(demo, action) => void chooseDemo(demo, action)} onDownload={downloadDemo} />
        <div className="tunes-empty-import"><button type="button" onClick={() => { repairTarget.current = undefined; fileRef.current?.click(); }} disabled={busy}>Open your own score<Glyph name="arrow" size={16} /></button><p>MusicXML · .musicxml · .xml · .mxl</p></div>
        {hasOldLibrary() ? <p className="tunes-upgrade">Load your previous tunes again to update their playing order.</p> : null}
      </section> : null}
      {!entry && !loading && !browsing ? <AgentScorePrompt /> : null}
    </main>
  );
}

function DemoShelf({ library, disabled, onChoose, onDownload }: {
  library: TuneEntry[];
  disabled: boolean;
  onChoose(demo: DemoTune, action: "open" | "listen" | "practice"): void;
  onDownload(demo: DemoTune): void;
}) {
  return (
    <section className="tunes-demos" aria-labelledby="song-demos-title">
      <header><h3 id="song-demos-title">Play a demo</h3><p className="tunes-note">Original guitar studies. Ready to hear and play.</p></header>
      <div className="tunes-demo-list">
        {DEMO_TUNES.map((demo) => <article className="tunes-demo" key={demo.entry.id}>
          <p className="tunes-demo-label">{demo.label}{library.some((tune) => tune.id === demo.entry.id) ? " · In your library" : ""}</p>
          <h4>{demo.title}</h4>
          <p className="tunes-demo-description">{demo.description}</p>
          <div className="tunes-demo-actions">
            <button type="button" className={demo.entry.id === BLUE_HOUR_ENTRY.id ? "tunes-listen-button" : "tunes-demo-listen"} onClick={() => onChoose(demo, "listen")} disabled={disabled} aria-label={`Listen to ${demo.title}`}><Glyph name="play" size={15} />Listen</button>
            <button type="button" onClick={() => onChoose(demo, "open")} disabled={disabled} aria-label={`Open ${demo.title} score`}>Open score<Glyph name="arrow" size={14} /></button>
            <button type="button" onClick={() => onChoose(demo, "practice")} disabled={disabled} aria-label={`Practice ${demo.title}`}>Practice<Glyph name="arrow" size={14} /></button>
            <button type="button" className="tunes-demo-download" onClick={() => onDownload(demo)} aria-label={`Download ${demo.title} MusicXML`}><Glyph name="download" size={15} />Score file</button>
          </div>
        </article>)}
      </div>
    </section>
  );
}

function AgentScorePrompt() {
  const [open, setOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const prompt = useRef<HTMLTextAreaElement>(null);
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(MUSICXML_AGENT_PROMPT);
      setCopyStatus("Prompt copied. Paste it into your agent and fill in the brackets.");
    } catch {
      setCopyStatus("Copy is unavailable. Select the prompt below and copy it manually.");
      prompt.current?.focus();
      prompt.current?.select();
    }
  };
  return (
    <section className="tunes-agent">
      <button type="button" className="tunes-agent-toggle" aria-expanded={open} aria-controls="song-agent-prompt" onClick={() => setOpen((value) => !value)}><Glyph name="plus" size={16} />Create a score with your agent</button>
      {open ? <div id="song-agent-prompt" className="tunes-agent-body">
        <p className="tunes-note">Copy this prompt into your agent, add your source or request an original study, then open the MusicXML score it creates here.</p>
        <button type="button" className="tunes-play" onClick={() => void copy()}><Glyph name="copy" size={15} />Copy prompt</button>
        {copyStatus ? <p className="tunes-note" role="status">{copyStatus}</p> : null}
        <textarea ref={prompt} readOnly value={MUSICXML_AGENT_PROMPT} aria-label="MusicXML creation prompt" spellCheck={false} />
      </div> : null}
    </section>
  );
}
