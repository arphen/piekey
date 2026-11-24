import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import type { InputApi } from "../listen/useInput";
import { hubIdFromStudyId, isKeyStudyId, keyStudySheet } from "../song/keyStudy";
import { loadSessionSet, resolveSessionSet } from "../song/sessionSet";
import { DEMO_TUNES } from "../tunes/demos";
import { loadCurrentTuneId, loadLibraryAsync, parseTuneEntry, saveCurrentTuneId, type TuneEntry } from "../tunes/library";
import type { LeadSheet } from "../tunes/musicxml";
import { buildTimeline } from "../tunes/order";
import { Glyph } from "./Glyph";
import { SongCoach, type RoomHandle, type RoomRequest } from "./SongCoach";
import type { PracticeLaunchOptions } from "./TuneView";

// The Play tab's room: it holds one practice room (`SongCoach`) for the shell, apart from the
// Library's score browser. The shell keeps it mounted while the player looks at other tabs
// (`parked`), so a session waits where it was; a new launch replaces it only after the room has
// finished and saved what was played (`RoomHandle.leave`).

/** What the Play tab opens: a tune (null = the next session's lead), an exact card, a mix. */
export interface RoomLaunch extends PracticeLaunchOptions {
  serial: number;
  tuneId: string | null;
  cardId?: string;
}

/** The next session's lead: the current tune if the session includes it, else the set's first. */
export function sessionLead(library: readonly TuneEntry[]): string | null {
  const ids = library.map((tune) => tune.id);
  const set = resolveSessionSet(loadSessionSet(), ids);
  const current = loadCurrentTuneId();
  if (current && set.includes(current)) return current;
  return set[0] ?? ids[0] ?? null;
}

const trySaveTune = (id: string) => { try { saveCurrentTuneId(id); } catch { /* the save notice reports it */ } };

export function PracticeRoom({ input, launch, parked, request, handle, onClose, onLive, onOpenLibrary }: {
  input: InputApi;
  launch: RoomLaunch;
  parked: boolean;
  request?: RoomRequest;
  handle: MutableRefObject<RoomHandle | null>;
  onClose(): void;
  onLive(live: boolean): void;
  onOpenLibrary(): void;
}) {
  const [library, setLibrary] = useState<TuneEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // a tune chosen inside the room replaces the launch's tune and drops its card and mix
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    let gone = false;
    void loadLibraryAsync().then((entries) => { if (!gone) setLibrary(entries); }).catch((error: unknown) => {
      if (!gone) setLoadError(error instanceof Error ? error.message : "The saved library could not be opened.");
    });
    return () => { gone = true; };
  }, []);

  const tuneId = chosen ?? launch.tuneId ?? (library ? sessionLead(library) : null);
  const options: PracticeLaunchOptions = chosen ? {} : launch;
  const cardId = chosen ? undefined : launch.cardId;

  const resolved = useMemo((): { sheet: LeadSheet | null; error: string | null } => {
    if (!tuneId) return { sheet: null, error: null };
    if (isKeyStudyId(tuneId)) {
      const hub = hubIdFromStudyId(tuneId);
      const built = hub ? keyStudySheet(hub) : null;
      return built ? { sheet: built, error: null } : { sheet: null, error: "Could not build that key study." };
    }
    if (!library) return { sheet: null, error: null };
    // a bundled study the browser could not save still plays as a preview
    const entry = library.find((tune) => tune.id === tuneId) ?? DEMO_TUNES.find((demo) => demo.entry.id === tuneId)?.entry;
    if (!entry) return { sheet: null, error: "That tune is no longer in the library." };
    try {
      return { sheet: parseTuneEntry(entry), error: null };
    } catch (error) {
      return { sheet: null, error: error instanceof Error ? error.message : "Couldn't read this tune." };
    }
  }, [tuneId, library]);
  const sheet = resolved.sheet;
  const tl = useMemo(() => (sheet ? buildTimeline(sheet) : null), [sheet]);

  // the rest of the library and any key studies of a custom mix: their exercises can join the session
  const studyHubIds = options.studyHubIds;
  const others = useMemo(() => {
    if (!sheet) return [];
    const fromLibrary = (library ?? []).flatMap((tune) => {
      if (tune.id === sheet.id) return [];
      try {
        const other = parseTuneEntry(tune);
        return [{ sheet: other, tl: buildTimeline(other) }];
      } catch {
        return [];
      }
    });
    const fromStudies = (studyHubIds ?? []).flatMap((hub) => {
      const study = keyStudySheet(hub);
      return study && study.id !== sheet.id ? [{ sheet: study, tl: buildTimeline(study) }] : [];
    });
    return [...fromLibrary, ...fromStudies];
  }, [library, sheet, studyHubIds]);

  if (sheet && tl) return (
    <SongCoach
      sheet={sheet}
      tl={tl}
      input={input}
      parked={parked}
      request={request}
      handle={handle}
      onLive={onLive}
      onClose={onClose}
      tunes={(library ?? []).map((tune) => ({ id: tune.id, title: tune.name }))}
      onTune={(id) => {
        const target = library?.find((tune) => tune.id === id);
        if (!target) throw new Error("That tune is no longer available. Choose another tune.");
        parseTuneEntry(target); // Keep the current room if the next score cannot open.
        trySaveTune(id);
        setChosen(id);
      }}
      others={others}
      mixIds={options.mixIds}
      focus={options.focus}
      initialCardId={cardId}
    />
  );

  const error = loadError ?? resolved.error;
  if (!error && (!library || tuneId)) return null; // opening: the room appears as soon as the score is read
  return (
    <main className="room-empty" aria-live="polite">
      <p className="room-empty-kicker">Play</p>
      <h2>{error ? "This room could not open" : "No songs yet"}</h2>
      <p>{error ?? "Add a song to the library and it opens here, ready to play."}</p>
      <button type="button" onClick={onOpenLibrary}><Glyph name="library" size={16} />Open library</button>
    </main>
  );
}
