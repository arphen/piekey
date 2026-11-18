import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Tone from "tone";
import { version as appVersion } from "../../package.json";
import { buildPracticeBrief, type BriefMaterial, type PracticeBrief } from "../agent/brief";
import { ensureAudio } from "../audio/context";
import type { InputApi } from "../listen/useInput";
import { setNavMuted } from "../nav/useGuitarNav";
import { pitchClassToName } from "../musicTheory";
import { hasOldLibrary, loadCurrentTuneId, loadLibrary, loadLibraryAsync, newTuneId, parseTuneEntry, sameTuneContent, saveCurrentTuneId, saveLibrary, type TuneEntry } from "../tunes/library";
import { loadTuneFile, parseMusicXml, type LeadSheet } from "../tunes/musicxml";
import { createBackup, parseBackup, restoreBackup, type PracticeBackup } from "../tunes/backup";
import { BLUE_HOUR_ENTRY, DEMO_TUNES, type DemoTune } from "../tunes/demos";
import { MUSICXML_AGENT_PROMPT } from "../tunes/agentPrompt";
import { retryStorageWrites } from "../storage";
import { buildTimeline } from "../tunes/order";
import { usePlayback } from "../tunes/usePlayback";
import type { NoteResult } from "../core/contract";
import { buildDeck, familiesOnly, type Family } from "../song/deck";
import { allStores, loadStore, today } from "../song/leitner";
import { nextUnits } from "../overview/summary";
import { Glyph } from "./Glyph";
import { UnitCard } from "./UnitCard";
import { Score } from "./Score";
import { openPractice, SongCoach } from "./SongCoach";
import "../tunes/tunes.css";

const NO_RESULTS: NoteResult[] = [];
const EXERCISE_FAMILIES: Family[] = ["scales", "harmony", "chords", "reading", "ear", "fretboard"];

const noteLabel = (midi: number) => `${pitchClassToName(midi).replace("#", "♯")}${Math.floor(midi / 12) - 1}`;

interface Launch {
  kind: "song" | "session" | "card";
  tuneId?: string;
  cardId?: string;
}

type PendingImport = Omit<TuneEntry, "id">;

export function TuneView({ input, launch, onLaunched }: { input: InputApi; launch?: Launch; onLaunched?: () => void }) {
  const [library, setLibrary] = useState<TuneEntry[]>(() => loadLibrary());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingImport[]>([]);
  const [replaceId, setReplaceId] = useState("");
  const [restore, setRestore] = useState<PracticeBackup | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(() => loadCurrentTuneId());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [brief, setBrief] = useState<PracticeBrief | null>(null);
  const [revision, setRevision] = useState(0);
  const [showFingering, setShowFingering] = useState(false);
  const [melody, setMelody] = useState(true);
  const [chords, setChords] = useState(true);
  const [click, setClick] = useState(false);
  const [countIn, setCountIn] = useState(false);
  const [bpm, setBpm] = useState(80);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null); // playing-order slots for an optional listening loop
  const [looping, setLooping] = useState(false);
  const [coach, setCoach] = useState(false); // the full-screen practice session
  const [sessionLaunch, setSessionLaunch] = useState<Launch>();
  const [demoToListen, setDemoToListen] = useState<string | null>(null);
  const launched = useRef<Launch>();
  const openingDemo = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);

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

  const entry = library.find((t) => t.id === selected) ?? library[0] ?? null;
  useEffect(() => { setBrief(null); }, [entry, revision]);
  const parsed = useMemo((): { sheet: LeadSheet | null; error: string | null } => {
    if (!entry) return { sheet: null, error: null };
    try {
      return { sheet: parseTuneEntry(entry), error: null };
    } catch (e) {
      return { sheet: null, error: e instanceof Error ? e.message : "Couldn't read this tune." };
    }
  }, [entry]);
  const sheet = parsed.sheet;
  const tl = useMemo(() => buildTimeline(sheet ?? { bars: [], comp: [] }), [sheet]);

  // the rest of the library, read only while the practice session is open: it can mix them in
  const others = useMemo(
    () =>
      coach
        ? library.flatMap((t) => {
            if (t.id === entry?.id) return [];
            try {
              const s = parseTuneEntry(t);
              return [{ sheet: s, tl: buildTimeline(s) }];
            } catch {
              return [];
            }
          })
        : [],
    [coach, library, entry],
  );

  // a new tune: its own tempo, no loop
  useEffect(() => {
    setBpm(sheet?.tempo ?? 80);
    setRange(null);
    setLooping(false);
  }, [sheet]);

  const pick = useCallback((id: string) => {
    setSelected(id);
    saveCurrentTuneId(id);
    setLibraryOpen(false);
  }, []);

  useEffect(() => {
    if (!launch || loading || launched.current === launch) return;
    if (launch.tuneId && entry?.id !== launch.tuneId) {
      if (library.some((tune) => tune.id === launch.tuneId)) pick(launch.tuneId);
      else {
        setLoadError("That tune is no longer in the library.");
        launched.current = launch;
        onLaunched?.();
      }
      return;
    }
    if (!sheet) return;
    launched.current = launch;
    if (launch.kind !== "song") {
      setSessionLaunch(launch);
      setCoach(true);
    } else setCoach(false);
    onLaunched?.();
  }, [launch, loading, sheet, entry?.id, library, pick, onLaunched]);

  const candidate = pending[0];
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
    async (files: FileList | File[]) => {
      setLoadError(null);
      setNotice(null);
      const previews: PendingImport[] = [];
      for (const file of [...files]) {
        try {
          const { xml, name } = await loadTuneFile(file);
          parseMusicXml(xml, name);
          previews.push({ xml, name });
        } catch (e) {
          setLoadError(`${file.name}: ${e instanceof Error ? e.message : "couldn't read it"}`);
        }
      }
      setPending((current) => [...current, ...previews]);
      setReplaceId("");
    },
    [],
  );

  const remove = useCallback(async () => {
    if (!entry) return;
    setBusy(true);
    const next = library.filter((tune) => tune.id !== entry.id);
    if (await saveLibrary(next)) setLibrary(next);
    else setLoadError("The tune could not be removed. Your saved library is unchanged.");
    setBusy(false);
  }, [entry, library]);

  const acceptImport = async () => {
    if (!candidate || !preview?.sheet || !previewSource || busy) return;
    if (duplicate && !replaceId) {
      pick(duplicate.id);
      setPending((queue) => queue.slice(1));
      setNotice("That score is already in your library. Opened the existing tune.");
      return;
    }
    setBusy(true);
    const imported: TuneEntry = { ...candidate, id: replaceId || newTuneId(), partId: previewSource.partId, voice: previewSource.voice };
    const next = [...library.filter((saved) => saved.id !== imported.id), imported];
    if (await saveLibrary(next)) {
      setLibrary(next);
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
        setSelected(loadCurrentTuneId());
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
  const playback = usePlayback(tl, { bpm, melody, chords, click, countIn }, input, false, true);
  const { play, stop } = playback;
  const playingRef = useRef(false);
  playingRef.current = playback.playing;
  const slotRef = useRef(-1);
  slotRef.current = playback.activeSlot;
  const start = useCallback((from = 0) => {
    const phrase = looping && range ? phrases.find((card) => card.from === range.start && card.to === range.end) : undefined;
    void play(phrase?.from ?? from, phrase?.to, Boolean(phrase)).catch((error: unknown) => {
      setLoadError(error instanceof Error ? error.message : "Playback could not start.");
    });
  }, [play, looping, range, phrases]);
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
      const chosen = saved ?? demo.entry;
      const chosenSheet = parseTuneEntry(chosen);
      const next = saved ? library : [...library, chosen];
      if (!saved && !await saveLibrary(next)) {
        setLoadError("This demo could not be saved. Free browser storage and try again.");
        return;
      }
      setLibrary(next);
      pick(chosen.id);
      setBpm(chosenSheet.tempo ?? 80);
      setRange(null);
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
      }));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "The practice brief could not be prepared.");
    } finally {
      setBusy(false);
    }
  };
  const onBarClick = useCallback((bar: number) => {
    const phrase = phrases.find((card) => card.tl.slots.slice(card.from, card.to + 1).some((slot) => slot.bar === bar));
    if (phrase || whole) practice((phrase ?? whole)!.id);
    else setNotice("There are no melody notes to practise in this bar.");
  }, [phrases, whole, practice]);
  const playingBar = playback.playing ? tl.slots[playback.activeSlot]?.bar ?? -1 : -1;
  const barLabel = (bar: number) => sheet?.barNumbers[bar] ?? String(bar + 1);
  const activeTarget = playback.activeTarget >= 0 ? tl.targets[playback.activeTarget] : undefined;
  const marked = looping && range ? {
    start: Math.min(...tl.slots.slice(range.start, range.end + 1).map((slot) => slot.bar)),
    end: Math.max(...tl.slots.slice(range.start, range.end + 1).map((slot) => slot.bar)),
  } : null;

  if (coach && sheet) return (
    <SongCoach
      key={sheet.id}
      sheet={sheet}
      tl={tl}
      input={input}
      onClose={() => { setCoach(false); setRevision((value) => value + 1); }}
      tunes={library.map((tune) => ({ id: tune.id, title: tune.name }))}
      onTune={(id) => { setSessionLaunch(undefined); pick(id); }}
      others={others}
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
      <header className="tunes-heading">
        <div>
          <p className="tunes-kicker">Song</p>
          <h2>{sheet?.title ?? (loading ? "Opening library…" : "Your music")}</h2>
          {sheet ? <p className="tunes-byline">{[sheet.composer, sheet.keySignature, sheet.timeSignature, `${sheet.bars.length} bars`].filter(Boolean).join(" · ")}</p> : null}
        </div>
        <button type="button" className="tunes-library-toggle" aria-expanded={libraryOpen} aria-controls="song-library" onClick={() => setLibraryOpen((open) => !open)}>
          <Glyph name="library" size={19} />Library<span>{library.length || ""}</span>
        </button>
      </header>

      {libraryOpen ? <section id="song-library" className="tunes-library" aria-label="Tune library">
        <div className="tunes-library-list">
          {library.map((tune) => <button type="button" key={tune.id} className={tune.id === entry?.id ? "is-selected" : ""} aria-current={tune.id === entry?.id ? "true" : undefined} onClick={() => pick(tune.id)} disabled={loading || busy}>
            <Glyph name="melody" size={17} /><span>{tune.id === entry?.id && sheet ? sheet.title : tune.name}</span><Glyph name={tune.id === entry?.id ? "check" : "arrow"} size={15} />
          </button>)}
          {!library.length ? <p className="tunes-note">No saved tunes</p> : null}
        </div>
        <div className="tunes-library-actions">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={loading || busy}>Import MusicXML<Glyph name="arrow" size={15} /></button>
          <button type="button" aria-expanded={toolsOpen} aria-controls="song-library-tools" onClick={() => setToolsOpen((open) => !open)}>Library tools</button>
        </div>
        {library.length ? <DemoShelf library={library} disabled={loading || busy} onChoose={(demo, action) => void chooseDemo(demo, action)} onDownload={downloadDemo} /> : null}
        {toolsOpen ? <div id="song-library-tools" className="tunes-backup" aria-label="Library tools">
          <button type="button" onClick={() => void exportPractice()} disabled={loading || busy}>Export practice backup</button>
          <button type="button" onClick={() => void generateBrief()} disabled={loading || busy}>Practice brief<Glyph name="arrow" size={15} /></button>
          <button type="button" onClick={() => backupRef.current?.click()} disabled={busy}>Restore backup…</button>
          <button type="button" onClick={() => {
            const saved = retryStorageWrites();
            setNotice(saved ? "Pending changes saved." : "Some changes are still unsaved. Keep the app open and export a backup.");
          }} disabled={busy}>Retry saving</button>
          {entry ? <button type="button" className="tunes-remove" onClick={() => void remove()} disabled={loading || busy}>Remove this tune</button> : null}
          <p className="tunes-note">Backups include tunes, settings and progress · audio recordings excluded</p>
          {brief ? <PracticeBriefPreview brief={brief} onClose={() => setBrief(null)} /> : null}
        </div> : null}
        {library.length ? <AgentScorePrompt /> : null}
      </section> : null}
      <input ref={fileRef} hidden type="file" accept=".musicxml,.xml,.mxl" multiple onChange={(event) => {
        if (event.target.files?.length) void addFiles(event.target.files);
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
                      setReplaceId("");
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
                {library.length && !duplicate ? (
                  <label>Save as{" "}
                    <select value={replaceId} onChange={(event) => setReplaceId(event.target.value)}>
                      <option value="">A separate tune or arrangement</option>
                      {library.map((saved) => <option key={saved.id} value={saved.id}>Replace {saved.name} · keep its history</option>)}
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


      {sheet ? <>
        <div className="tunes-score-actions">
          <button type="button" className={`tunes-listen-button ${playback.playing ? "is-playing" : ""}`} aria-pressed={playback.playing} onClick={() => playback.playing ? stop() : start()} disabled={!tl.slots.length || loading || busy}>
            {playback.playing ? <span className="tunes-stop" aria-hidden="true" /> : <Glyph name="play" size={17} />}{playback.playing ? "Stop" : looping ? "Listen to phrase" : "Listen to piece"}
          </button>
          <button type="button" className="tunes-practice-piece" onClick={() => practice(whole?.id)} disabled={!whole || loading || busy}>Practice piece<Glyph name="arrow" size={16} /></button>
          <span className="tunes-play-position">{playback.playing ? playback.counting ? "Count-in" : playingBar >= 0 ? `Bar ${barLabel(playingBar)}` : "" : ""}</span>
          <button type="button" className="tunes-sound-toggle" aria-expanded={soundOpen} aria-controls="song-sound" onClick={() => setSoundOpen((open) => !open)}><Glyph name="free" size={17} />{bpm}<span>Sound</span></button>
        </div>
        {soundOpen ? <div id="song-sound" className="tunes-sound" aria-label="Playback options">
          <div className="tunes-tempo" role="group" aria-label="Playback tempo"><button type="button" aria-label="Slower" onClick={() => setBpm((value) => Math.max(30, value - 5))}>−</button><span>{bpm} bpm</span><button type="button" aria-label="Faster" onClick={() => setBpm((value) => Math.min(240, value + 5))}>+</button></div>
          <button type="button" aria-pressed={melody} onClick={() => setMelody((value) => !value)}>Melody</button>
          {sheet.comp.length ? <button type="button" aria-pressed={chords} onClick={() => setChords((value) => !value)}>Chords</button> : null}
          <button type="button" aria-pressed={click} onClick={() => setClick((value) => !value)}>Click</button>
          <button type="button" aria-pressed={countIn} onClick={() => setCountIn((value) => !value)}>Count-in</button>
          <button type="button" aria-pressed={showFingering} onClick={() => setShowFingering((value) => !value)}>String &amp; fret hints</button>
          {phrases.length ? <label>Listen range<select value={looping && range ? `${range.start}:${range.end}` : ""} onChange={(event) => {
            stop();
            const phrase = phrases.find((card) => `${card.from}:${card.to}` === event.target.value);
            setRange(phrase ? { start: phrase.from, end: phrase.to } : null);
            setLooping(Boolean(phrase));
          }}><option value="">Whole piece</option>{phrases.map((card) => <option key={card.id} value={`${card.from}:${card.to}`}>Loop {card.where}</option>)}</select></label> : null}
        </div> : null}
        <section className="tunes-manuscript" aria-label={`${sheet.title} score`}>
          <div className="tunes-score-caption"><Glyph name="melody" size={15} /><span>Click a bar to practice its phrase</span></div>
          <Score exercise={sheet} activeStep={activeTarget?.notes[0] ?? -1} activeNotes={activeTarget?.notes ?? []} results={NO_RESULTS} showFingering={showFingering} autoScroll onBarClick={onBarClick} marked={marked} playingBar={playingBar} />
        </section>
        {phrases.length ? <section className="tunes-phrases" aria-labelledby="song-phrases-title">
          <h3 id="song-phrases-title">Phrases</h3>
          <div>{phrases.map((card) => <button type="button" key={card.id} onClick={() => practice(card.id)} aria-label={`Practice ${card.where}`}><span>{card.where}</span><Glyph name="arrow" size={14} /></button>)}</div>
        </section> : null}
        {exercises.length ? <section className="tunes-exercises" aria-labelledby="song-exercises-title">
          <header><h3 id="song-exercises-title">Exercises</h3><button type="button" onClick={() => practice()}>Daily session<Glyph name="arrow" size={15} /></button></header>
          <div>{exercises.map((unit) => <UnitCard key={unit.id} unit={unit} onOpen={() => practice(unit.id)} />)}</div>
        </section> : null}
      </> : !entry && !loading ? <section className="tunes-empty">
        <DemoShelf library={library} disabled={busy} onChoose={(demo, action) => void chooseDemo(demo, action)} onDownload={downloadDemo} />
        <div className="tunes-empty-import"><button type="button" onClick={() => fileRef.current?.click()} disabled={busy}>Open your own score<Glyph name="arrow" size={16} /></button><p>MusicXML · .musicxml · .xml · .mxl</p></div>
        {hasOldLibrary() ? <p className="tunes-upgrade">Load your previous tunes again to update their playing order.</p> : null}
      </section> : null}
      {!entry && !loading ? <AgentScorePrompt /> : null}
    </main>
  );
}

function PracticeBriefPreview({ brief, onClose }: { brief: PracticeBrief; onClose(): void }) {
  const [status, setStatus] = useState("");
  const preview = useRef<HTMLTextAreaElement>(null);
  const json = useMemo(() => JSON.stringify(brief, null, 2), [brief]);
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(json);
      setStatus("Practice brief copied.");
    } catch {
      setStatus("Copy is unavailable. Select the JSON below and copy it manually.");
      preview.current?.focus();
      preview.current?.select();
    }
  };
  const download = () => {
    try {
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `fretboard-practice-brief-${brief.window.endDay}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setStatus("The download could not start. Copy the JSON below instead.");
    }
  };
  return (
    <section className="tunes-brief" aria-labelledby="song-practice-brief-title">
      <header><h3 id="song-practice-brief-title">Practice brief</h3><button type="button" onClick={onClose}>Close preview</button></header>
      <p className="tunes-note">{brief.selectedTune?.material.titleData ?? "Overall practice"} · last 28 days · generated {new Date(brief.generatedAt).toLocaleString()}</p>
      <p className="tunes-note">Review this snapshot, then copy or download it for your agent. Scores and recordings stay out of the brief.</p>
      <div className="tunes-brief-actions"><button type="button" onClick={() => void copy()}><Glyph name="copy" size={15} />Copy brief</button><button type="button" onClick={download}><Glyph name="download" size={15} />Download JSON</button></div>
      {status ? <p className="tunes-note" role="status">{status}</p> : null}
      <textarea ref={preview} readOnly value={json} aria-label="Practice brief JSON" spellCheck={false} />
    </section>
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
