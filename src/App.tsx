import { useCallback, useEffect, useRef, useState } from "react";
import { getKey } from "./core";
import type { KeyInfo } from "./core/contract";
import { GuitarNav } from "./components/GuitarNav";
import { EarHub } from "./components/EarHub";
import { TriadsView } from "./components/TriadsView";
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
import { sessionOpen } from "./nav/useGuitarNav";
import { saveCurrentTuneId } from "./tunes/library";
import { getStoredItem, setStoredItem } from "./storage";
import { GuitarTools } from "./tools/GuitarTools";
import "./practice.css";
import "./shell.css";

type Tab = "tutor" | "progress" | TutorTargetTab;
type PracticeLaunch = { kind: "song" | "listen" | "session" | "card"; tuneId?: string; cardId?: string };
/** Where the shell is. Mirrored into the browser history, so Back (button, key, swipe) walks it. */
interface Route { tab: Tab; song: string | null; depth: number }

const KEY_STORAGE = "guitar-key";
const HOME: Route = { tab: "tutor", song: null, depth: 0 };
const TABS: { id: Tab; label: string; glyph: GlyphName | UtilityGlyphName }[] = [
  { id: "tutor", label: "Home", glyph: "home" },
  { id: "tunes", label: "Library", glyph: "library" },
  { id: "progress", label: "Progress", glyph: "progress" },
];
const primaryTab = (tab: Tab) => tab === "tunes" || tab === "progress" ? tab : "tutor";
const routeOf = (state: unknown): Route | null => {
  const route = (state as { ffl?: Route } | null)?.ffl;
  return route && typeof route.tab === "string" && typeof route.depth === "number" ? route : null;
};
const trySaveTune = (id: string) => { try { saveCurrentTuneId(id); } catch { /* the save notice reports it */ } };

export default function App() {
  const [route, setRoute] = useState<Route>(() => routeOf(history.state) ?? HOME);
  const routeRef = useRef(route);
  routeRef.current = route;
  const tab = route.tab;
  const [launch, setLaunch] = useState<PracticeLaunch>();
  const returnAfterSession = useRef(false);
  const ownPop = useRef(false); // a Back the shell asked for itself, as opposed to the browser's
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

  // ---------- routes and the browser history ----------
  useEffect(() => {
    try { history.replaceState({ ...(history.state ?? {}), ffl: routeRef.current }, ""); } catch { /* history is a convenience */ }
    const onPop = (event: PopStateEvent) => {
      // guitar mode owns the screen: Back there is its own Dashboard button, so the shell stays put
      const own = ownPop.current;
      ownPop.current = false;
      if (!own && sessionOpen()) {
        try { history.pushState({ ffl: routeRef.current }, ""); } catch { /* ignore */ }
        return;
      }
      setToolsOpen(false);
      setLaunch(undefined);
      returnAfterSession.current = false;
      setRoute(routeOf(event.state) ?? HOME);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  /** Move to a place. Returns whether a history entry was added. */
  const go = useCallback((tab: Tab, song: string | null = null, replace = false): boolean => {
    const now = routeRef.current;
    if (now.tab === tab && now.song === song) return false;
    const next: Route = { tab, song, depth: replace ? now.depth : tab === "tutor" && song === null ? 0 : now.depth + 1 };
    routeRef.current = next;
    setRoute(next);
    try {
      if (replace || next.depth === 0) history.replaceState({ ffl: next }, "");
      else history.pushState({ ffl: next }, "");
    } catch { /* history is a convenience */ }
    return !replace && next.depth > 0;
  }, []);
  const historyBack = useCallback(() => { ownPop.current = true; history.back(); }, []);
  const back = useCallback(() => {
    if (toolsOpen) { setToolsOpen(false); return; }
    setLaunch(undefined);
    if (routeRef.current.depth > 0) historyBack();
    else go("tutor");
  }, [go, toolsOpen, historyBack]);

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
  const moveTab = useCallback((dir: 1 | -1) => {
    setLaunch(undefined);
    setToolsOpen(false);
    const at = TABS.findIndex((t) => t.id === primaryTab(routeRef.current.tab));
    go(TABS[(at + dir + TABS.length) % TABS.length].id);
  }, [go]);

  const openLibrary = useCallback(() => { setLaunch(undefined); setToolsOpen(false); go("tunes", null); }, [go]);
  const openTunes = openLibrary;
  const openSong = useCallback((tuneId: string) => {
    trySaveTune(tuneId);
    setLaunch({ kind: "song", tuneId });
    go("tunes", tuneId);
  }, [go]);
  const listenSong = useCallback((tuneId: string) => {
    trySaveTune(tuneId);
    setLaunch({ kind: "listen", tuneId });
    go("tunes", tuneId);
  }, [go]);
  /** TuneView moves between its library and a song itself (a pick, a tune change in guitar mode). */
  const songRoute = useCallback((tuneId: string | null, replace = false) => { go("tunes", tuneId, replace); }, [go]);

  const startPractice = useCallback((tuneId: string, cardId?: string, prepared = false) => {
    trySaveTune(tuneId);
    if (!prepared) openPractice(input);
    setLaunch({ kind: cardId ? "card" : "session", tuneId, cardId });
    returnAfterSession.current = go("tunes", tuneId);
  }, [input, go]);
  /** Leaving guitar mode returns to wherever it was entered from. */
  const sessionEnded = useCallback(() => {
    if (!returnAfterSession.current) return;
    returnAfterSession.current = false;
    historyBack();
  }, [historyBack]);
  const openMode = useCallback((target: TutorTargetTab) => {
    setLaunch(undefined);
    if (target === "free") openPractice(input);
    go(target);
  }, [input, go]);
  const launched = useCallback(() => setLaunch(undefined), []);
  const closeFree = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    back();
  }, [back]);

  useEffect(() => {
    window.scrollTo?.(0, 0);
  }, [route.tab, route.song]);

  const canGoBack = route.depth > 0 || toolsOpen;
  return (
    <KeyContext.Provider value={key}>
      <RomanContext.Provider value={true}>
        <div className={`app tab-${tab}`}>
          <header className="topbar" ref={topbar}>
            <div className="shell-start">
              <button type="button" className="shell-back" onClick={back} disabled={!canGoBack} aria-label="Back" title="Back">
                <Glyph name="arrow" size={20} /><span>Back</span>
              </button>
              <div className="brand">
                <span className="brand-mark" aria-hidden="true"><Glyph name="melody" size={20} /></span>
                <h1>Fretboard Focus Lab</h1>
              </div>
            </div>
            <nav className="tabs" aria-label="views">
              {TABS.map((t) => (
                <button key={t.id} type="button" className={primaryTab(tab) === t.id && !toolsOpen ? "is-on" : ""} aria-current={primaryTab(tab) === t.id ? "page" : undefined} onClick={() => { setToolsOpen(false); setLaunch(undefined); go(t.id); }}>
                  <Glyph name={t.glyph} size={20} /><span>{t.label}</span>
                </button>
              ))}
            </nav>
            <div className="shell-end">
              <button type="button" className="device-sync-trigger guitar-tools-trigger" aria-pressed={toolsOpen} onClick={() => { setDevicesOpen(false); setToolsOpen(true); }} aria-label="Guitar tools"><Glyph name="tools" size={20} /><span>Tools</span></button>
              <DeviceSync open={devicesOpen} onOpenChange={(open) => { setToolsOpen(false); setDevicesOpen(open); }} onUpdated={refreshState} />
            </div>
          </header>

          <SaveNotice />
          <PlatformStatus />

          {devicesOpen ? <main className="device-sync-placeholder" aria-hidden="true" /> : toolsOpen ? <GuitarTools input={input} onClose={() => setToolsOpen(false)} /> : tab === "tutor" ? (
            <OverviewView key={stateRevision} input={input} onOpenMode={openMode} onOpenSong={openSong} onOpenLibrary={openLibrary} onListenSong={listenSong} onStartPractice={startPractice} />
          ) : tab === "progress" ? (
            <ProgressView key={stateRevision} onOpenSong={openSong} onStartPractice={startPractice} />
          ) : tab === "tunes" ? (
            <TuneView key={stateRevision} input={input} launch={launch} onLaunched={launched} songId={route.song} onSong={songRoute} onSessionEnd={sessionEnded} onStartPractice={startPractice} />
          ) : tab === "free" ? (
            <FreePlayView key={stateRevision} input={input} onClose={closeFree} />
          ) : tab === "changes" ? (
            <FocusView key={stateRevision} focus="changes" input={input} onOpenTunes={openTunes} />
          ) : tab === "scales" ? (
            <ScalesView key={stateRevision} keyInfo={key} input={input} onKey={changeKey} onOpenTunes={openTunes} />
          ) : tab === "reading" ? (
            <FocusView key={stateRevision} focus="reading" input={input} onOpenTunes={openTunes} />
          ) : tab === "triads" ? (
            <TriadsView key={stateRevision} input={input} onExit={back} />
          ) : (
            <EarHub key={stateRevision} input={input} onOpenTunes={openTunes} />
          )}
          <footer className="app-legal" data-nav-skip>
            <a href={import.meta.env.VITE_SOURCE_URL} target="_blank" rel="noreferrer">Source</a>
            <a href={`${import.meta.env.BASE_URL}licenses/index.html`} target="_blank" rel="noreferrer">AGPLv3 · licenses</a>
            <span>No warranty</span>
          </footer>
          <GuitarNav input={input} onHome={back} onTab={moveTab} />
        </div>
      </RomanContext.Provider>
    </KeyContext.Provider>
  );
}
