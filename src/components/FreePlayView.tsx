import { useEffect, useMemo, useState } from "react";
import type { InputApi } from "../listen/useInput";
import { loadLibraryAsync, parseTuneEntry, saveCurrentTuneId } from "../tunes/library";
import type { LeadSheet } from "../tunes/musicxml";
import { buildTimeline, type Timeline } from "../tunes/order";
import { FreePlay } from "./FreePlay";
import { InputBar } from "./InputBar";
import { SongCoachRoom } from "./SongCoach";
import { TunePicker } from "./TunePicker";
import { PracticeWindowBoundary } from "../platform/PracticeWindowBoundary";
import { PoolRoom } from "../pool/PoolRoom";
import { settlePracticeWrites } from "../platform/practiceWindow";
import "../song/song.css";

/** The existing free-play engine, reachable without importing a tune or opening a card box. */
export function FreePlayView({ input, onClose }: { input: InputApi; onClose(): void }) {
  return <PracticeWindowBoundary onExit={onClose}><PoolRoom input={input}><FreePlayRoom input={input} onClose={onClose} /></PoolRoom></PracticeWindowBoundary>;
}

function FreePlayRoom({ input, onClose }: { input: InputApi; onClose(): void }) {
  const [music, setMusic] = useState<{ sheet: LeadSheet; tl: Timeline }[]>([]);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [instruments, setInstruments] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    void loadLibraryAsync().then((entries) => {
      if (disposed) return;
      const unreadable: string[] = [];
      setMusic(entries.flatMap((entry) => {
        try {
          const sheet = parseTuneEntry(entry);
          return [{ sheet, tl: buildTimeline(sheet) }];
        } catch { unreadable.push(entry.name); return []; }
      }));
      if (unreadable.length) setLibraryError(`These scores could not be opened: ${unreadable.join(", ")}. Repair them in Songs.`);
    }).catch(() => { if (!disposed) setLibraryError("The saved library could not be opened. Free play is still available."); });
    return () => { disposed = true; };
  }, []);
  const sources = useMemo(() => music.map(({ sheet, tl }) => ({ id: sheet.id, title: sheet.title, tl })), [music]);
  // stable between renders: a new list rebuilds every deck, and the exercise playing restarts from its top
  const others = useMemo(() => music.filter(({ sheet }) => sheet.id !== selected), [music, selected]);
  const current = music.find(({ sheet }) => sheet.id === selected);
  const chooseTune = async (id: string) => {
    if (!music.some(({ sheet }) => sheet.id === id)) throw new Error("That tune is no longer available. Choose another tune.");
    await settlePracticeWrites();
    saveCurrentTuneId(id);
    setSelected(id);
    setPicking(false);
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !picking && !selected && !instruments) onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose, picking, selected, instruments]);

  if (current) return <SongCoachRoom key={current.sheet.id} sheet={current.sheet} tl={current.tl} input={input}
    onClose={onClose} tunes={sources} onTune={chooseTune} others={others} />;

  return (
    <main className="ss fp-standalone" role="dialog" aria-label="free play">
      {picking ? <>
        {libraryError ? <p className="ss-sub" role="status">{libraryError}</p> : null}
        <TunePicker input={input} sources={sources} currentTuneId="" onCancel={() => setPicking(false)} onChoose={chooseTune} />
      </> : <FreePlay input={input} onClose={onClose} onPractise={() => undefined} onChooseTune={() => setPicking(true)} onToolsChange={setInstruments} />}
      {!picking && !instruments ? <div className="fp-standalone-input"><InputBar input={input} /></div> : null}
      {!picking && !instruments ? <div className="ss-chrome">
        <button type="button" className="ss-icon" onClick={onClose} aria-label="leave free play" title="Leave (Esc)">×</button>
      </div> : null}
    </main>
  );
}
