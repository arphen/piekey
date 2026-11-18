import { useCallback, useEffect, useRef, useState } from "react";
import { getKey } from "./core";
import type { KeyInfo } from "./core/contract";
import { GuitarNav } from "./components/GuitarNav";
import { EarHub } from "./components/EarHub";
import { FocusView } from "./components/FocusView";
import { KeyContext, RomanContext } from "./components/keyContext";
import { OverviewView } from "./components/OverviewView";
import { ProgressView } from "./components/ProgressView";
import { ScalesView } from "./components/ScalesView";
import { TuneView } from "./components/TuneView";
import { FreePlayView } from "./components/FreePlayView";
import { SaveNotice } from "./components/SaveNotice";
import { PlatformStatus } from "./platform/PlatformStatus";
import { Glyph, type UtilityGlyphName } from "./components/Glyph";
import { DeviceSync } from "./components/DeviceSync";
import { openPractice } from "./components/SongCoach";
import type { GlyphName, TutorTargetTab } from "./overview/modes";
import { useInput } from "./listen/useInput";
import { saveCurrentTuneId } from "./tunes/library";
import { getStoredItem, setStoredItem } from "./storage";
import { GuitarTools } from "./tools/GuitarTools";
import "./practice.css";

type Tab = "tutor" | "progress" | TutorTargetTab;
type PracticeLaunch = { kind: "song" | "listen" | "session" | "card"; tuneId?: string; cardId?: string };

const KEY_STORAGE = "guitar-key";
const TABS: { id: Tab; label: string; glyph: GlyphName | UtilityGlyphName }[] = [
  { id: "tutor", label: "Practice", glyph: "home" },
  { id: "tunes", label: "Songs", glyph: "melody" },
  { id: "progress", label: "Progress", glyph: "progress" },
];
const primaryTab = (tab: Tab) => tab === "tunes" || tab === "progress" ? tab : "tutor";

export default function App() {
  const [tab, setTab] = useState<Tab>("tutor");
  const [launch, setLaunch] = useState<PracticeLaunch>();
  const [stateRevision, setStateRevision] = useState(0);
  const [devicesOpen, setDevicesOpen] = useState(() => new URLSearchParams(location.hash.slice(1)).has("pair"));
  const [toolsOpen, setToolsOpen] = useState(false);
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
  const home = useCallback(() => { setToolsOpen(false); setLaunch(undefined); setTab("tutor"); }, []);
  const moveTab = useCallback((dir: 1 | -1) => {
    setLaunch(undefined);
    setToolsOpen(false);
    setTab((now) => TABS[(TABS.findIndex((t) => t.id === primaryTab(now)) + dir + TABS.length) % TABS.length].id);
  }, []);

  const openTunes = useCallback(() => { setLaunch(undefined); setTab("tunes"); }, []);
  const openSong = useCallback((tuneId: string) => {
    saveCurrentTuneId(tuneId);
    setLaunch({ kind: "song", tuneId });
    setTab("tunes");
  }, []);
  const listenSong = useCallback((tuneId: string) => {
    saveCurrentTuneId(tuneId);
    setLaunch({ kind: "listen", tuneId });
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
                <button key={t.id} type="button" className={primaryTab(tab) === t.id ? "is-on" : ""} aria-current={primaryTab(tab) === t.id ? "page" : undefined} onClick={() => { setToolsOpen(false); setLaunch(undefined); setTab(t.id); }}>
                  <Glyph name={t.glyph} size={18} /><span>{t.label}</span>
                </button>
              ))}
            </nav>
            <button type="button" className="device-sync-trigger guitar-tools-trigger" onClick={() => { setDevicesOpen(false); setToolsOpen(true); }} aria-label="Guitar tools"><Glyph name="tools" size={19} /><span>Tools</span></button>
            <DeviceSync open={devicesOpen} onOpenChange={(open) => { setToolsOpen(false); setDevicesOpen(open); }} onUpdated={refreshState} />
          </header>

          <SaveNotice />
          <PlatformStatus />

          {devicesOpen ? <main className="device-sync-placeholder" aria-hidden="true" /> : toolsOpen ? <GuitarTools input={input} onClose={() => setToolsOpen(false)} /> : tab === "tutor" ? (
            <OverviewView key={stateRevision} onOpenMode={openMode} onOpenSong={openSong} onListenSong={listenSong} onOpenProgress={() => setTab("progress")} onStartPractice={startPractice} onPreparePractice={() => openPractice(input)} />
          ) : tab === "progress" ? (
            <ProgressView key={stateRevision} onOpenSong={openSong} onStartPractice={startPractice} />
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
