import { useCallback, useEffect, useRef, useState } from "react";
import { getKey } from "./core";
import type { KeyInfo } from "./core/contract";
import { GuitarNav } from "./components/GuitarNav";
import { EarHub } from "./components/EarHub";
import { FocusView } from "./components/FocusView";
import { KeyContext, RomanContext } from "./components/keyContext";
import { OverviewView } from "./components/OverviewView";
import { ScalesView } from "./components/ScalesView";
import { TuneView } from "./components/TuneView";
import { FreePlayView } from "./components/FreePlayView";
import { SaveNotice } from "./components/SaveNotice";
import { Glyph } from "./components/Glyph";
import { DeviceSync } from "./components/DeviceSync";
import { openPractice } from "./components/SongCoach";
import type { GlyphName, TutorTargetTab } from "./overview/modes";
import { useInput } from "./listen/useInput";
import { saveCurrentTuneId } from "./tunes/library";
import { getStoredItem, setStoredItem } from "./storage";
import "./practice.css";

type Tab = "tutor" | TutorTargetTab;
type PracticeLaunch = { kind: "song" | "session" | "card"; tuneId?: string; cardId?: string };

const KEY_STORAGE = "guitar-key";
const TABS: { id: Tab; label: string; glyph: GlyphName | "home" }[] = [
  { id: "tutor", label: "Tutor", glyph: "home" },
  { id: "tunes", label: "Song", glyph: "melody" },
  { id: "changes", label: "Changes", glyph: "chords" },
  { id: "scales", label: "Scales", glyph: "scales" },
  { id: "reading", label: "Reading", glyph: "reading" },
  { id: "ear", label: "Ear", glyph: "ear" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("tutor");
  const [launch, setLaunch] = useState<PracticeLaunch>();
  const [stateRevision, setStateRevision] = useState(0);
  const [devicesOpen, setDevicesOpen] = useState(() => new URLSearchParams(location.hash.slice(1)).has("pair"));
  const topbar = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = topbar.current;
    if (!header) return;
    const measure = () => document.documentElement.style.setProperty("--topbar-h", `${header.getBoundingClientRect().height}px`);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(header);
    return () => { observer?.disconnect(); document.documentElement.style.removeProperty("--topbar-h"); };
  }, []);
  // the key only drives the scale-shape explorer; songs bring their own
  const [key, setKey] = useState<KeyInfo>(() => {
    try {
      return getKey(getStoredItem(KEY_STORAGE) ?? "A");
    } catch {
      return getKey("A");
    }
  });
  const changeKey = useCallback((tonic: string) => {
    setKey(getKey(tonic));
    try {
      setStoredItem(KEY_STORAGE, tonic);
    } catch {
      // preference only
    }
  }, []);
  const refreshState = useCallback(() => {
    setLaunch(undefined);
    try { setKey(getKey(getStoredItem(KEY_STORAGE) ?? "A")); } catch { /* Existing key remains usable. */ }
    setStateRevision((revision) => revision + 1);
  }, []);

  // one guitar input for the whole shell: the menus, the tune views and every session share it
  const input = useInput({ fftSize: 4096, intervalMs: 25 });
  const { autoStart } = input;
  useEffect(() => { autoStart(); }, [autoStart]);
  const home = useCallback(() => { setLaunch(undefined); setTab("tutor"); }, []);
  const moveTab = useCallback((dir: 1 | -1) => {
    setLaunch(undefined);
    setTab((now) => TABS[(TABS.findIndex((t) => t.id === now) + dir + TABS.length) % TABS.length].id);
  }, []);

  const openTunes = useCallback(() => { setLaunch(undefined); setTab("tunes"); }, []);
  const openSong = useCallback((tuneId: string) => {
    saveCurrentTuneId(tuneId);
    setLaunch({ kind: "song", tuneId });
    setTab("tunes");
  }, []);

  const startPractice = useCallback((tuneId: string, cardId?: string, prepared = false) => {
    saveCurrentTuneId(tuneId);
    if (!prepared) openPractice(input);
    setLaunch({ kind: cardId ? "card" : "session", tuneId, cardId });
    setTab("tunes");
  }, [input]);
  const openMode = useCallback((target: TutorTargetTab) => {
    setLaunch(undefined);
    if (target === "free") openPractice(input);
    setTab(target);
  }, [input]);
  const launched = useCallback(() => setLaunch(undefined), []);
  const closeFree = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    setTab("tutor");
  }, []);

  useEffect(() => {
    window.scrollTo?.(0, 0);
  }, [tab]);

  return (
    <KeyContext.Provider value={key}>
      <RomanContext.Provider value={true}>
        <div className={`app tab-${tab}`}>
          <header className="topbar" ref={topbar}>
            <div className="brand">
              <span className="brand-mark" aria-hidden="true"><Glyph name="melody" size={20} /></span>
              <h1>Fretboard Focus Lab</h1>
            </div>
            <nav className="tabs" aria-label="views">
              {TABS.map((t) => (
                <button key={t.id} type="button" className={tab === t.id ? "is-on" : ""} aria-current={tab === t.id ? "page" : undefined} onClick={() => { setLaunch(undefined); setTab(t.id); }}>
                  <Glyph name={t.glyph} size={18} /><span>{t.label}</span>
                </button>
              ))}
            </nav>
            <DeviceSync open={devicesOpen} onOpenChange={setDevicesOpen} onUpdated={refreshState} />
          </header>

          <SaveNotice />

          {devicesOpen ? <main className="device-sync-placeholder" aria-hidden="true" /> : tab === "tutor" ? (
            <OverviewView key={stateRevision} onOpenMode={openMode} onOpenSong={openSong} onStartPractice={startPractice} onPreparePractice={() => openPractice(input)} />
          ) : tab === "tunes" ? (
            <TuneView key={stateRevision} input={input} launch={launch} onLaunched={launched} />
          ) : tab === "free" ? (
            <FreePlayView key={stateRevision} input={input} onClose={closeFree} />
          ) : tab === "changes" ? (
            <FocusView key={stateRevision} focus="changes" input={input} onOpenTunes={openTunes} />
          ) : tab === "scales" ? (
            <ScalesView key={stateRevision} keyInfo={key} input={input} onKey={changeKey} onOpenTunes={openTunes} />
          ) : tab === "reading" ? (
            <FocusView key={stateRevision} focus="reading" input={input} onOpenTunes={openTunes} />
          ) : (
            <EarHub key={stateRevision} input={input} onOpenTunes={openTunes} />
          )}
          <footer className="app-legal" data-nav-skip>
            <a href={import.meta.env.VITE_SOURCE_URL} target="_blank" rel="noreferrer">Source</a>
            <a href={`${import.meta.env.BASE_URL}licenses/index.html`} target="_blank" rel="noreferrer">AGPLv3 · licenses</a>
            <span>No warranty</span>
          </footer>
          <GuitarNav input={input} onHome={home} onTab={moveTab} />
        </div>
      </RomanContext.Provider>
    </KeyContext.Provider>
  );
}
