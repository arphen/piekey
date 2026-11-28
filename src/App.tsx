import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
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
import { TuneView, type PracticeLaunchOptions } from "./components/TuneView";
import { isKeyStudyId } from "./song/keyStudy";
import { FreePlayView } from "./components/FreePlayView";
import { SaveNotice } from "./components/SaveNotice";
import { PlatformStatus } from "./platform/PlatformStatus";
import { Glyph, type UtilityGlyphName } from "./components/Glyph";
import { AbyssalWater, type WaterScene } from "./components/AbyssalWater";
import { DeviceSync } from "./components/DeviceSync";
import { openPractice, type RoomHandle, type RoomRequest, type RoomSurface } from "./components/SongCoach";
import { PracticeRoom, type RoomLaunch } from "./components/PracticeRoom";
import type { GlyphName, TutorTargetTab } from "./overview/modes";
import { useInput } from "./listen/useInput";
import { saveCurrentTuneId } from "./tunes/library";
import { getStoredItem, setStoredItem } from "./storage";
import { GuitarTools } from "./tools/GuitarTools";
import "./practice.css";
import "./shell.css";

type Tab = "tutor" | "progress" | "play" | TutorTargetTab;
type PracticeLaunch = PracticeLaunchOptions & { kind: "song" | "listen"; tuneId?: string };
/** Where the shell is. Mirrored into the browser history, so Back (button, key, swipe) walks it. */
interface Route { tab: Tab; song: string | null; depth: number }

const KEY_STORAGE = "guitar-key";
const HOME: Route = { tab: "tutor", song: null, depth: 0 };
const TABS: { id: Tab; label: string; glyph: GlyphName | UtilityGlyphName }[] = [
  { id: "tutor", label: "Home", glyph: "home" },
  { id: "tunes", label: "Library", glyph: "library" },
  { id: "progress", label: "Progress", glyph: "progress" },
];
/** The guitar walks the three tabs and then Play, the room they lead to. */
const TAB_CYCLE: Tab[] = ["tutor", "tunes", "progress", "play"];
const primaryTab = (tab: Tab) => tab === "tunes" || tab === "progress" ? tab : tab === "play" ? "play" : tab === "free" ? "free" : "tutor";
const tabRank = (route: Route, tool: "tuner" | "metronome" | null = null, surface: RoomSurface = "practice") => {
  if (tool === "tuner") return 4;
  if (tool === "metronome") return 4.5;
  if (route.tab === "play") {
    if (surface === "metronome") return 4.5;
    if (surface === "tuner") return 4;
    if (surface === "free") return 3.5;
    return 3;
  }
  const p = primaryTab(route.tab);
  if (p === "tutor") return route.tab === "tutor" ? 0 : 0.5;
  if (p === "tunes") return route.song ? 1.5 : 1;
  if (p === "free") return 3.5;
  return 2;
};

type ViewTransitionLike = { finished?: Promise<unknown> };
type ViewTransitionDocument = Document & { startViewTransition?(update: () => Promise<void> | void): ViewTransitionLike };
type TransitionKind = "right" | "left" | "fade";
/** Resolves once a selector has appeared, checked on timers (rendering is held during a view transition). */
const appeared = (selector: string, ms: number) => new Promise<void>((resolve) => {
  const until = Date.now() + ms;
  const check = () => (document.querySelector(selector) || Date.now() > until ? resolve() : window.setTimeout(check, 16));
  check();
});
interface PressOrigin { el: Element | null; x: number; y: number }
/** The morph's source: a pressed exercise/card title in the page (never a topbar button or icon blossom). */
function markMorphSource(from: Element | null): () => void {
  if (!from || from.closest(".topbar, .hm-skill-btn")) return () => undefined;
  const el =
    from.closest("[data-morph]") ??
    from.closest(".hm-skill-card, .hm-ex-row, .hm-mode-pill")?.querySelector("strong") ??
    from.closest(".hm-rhythm-chip")?.querySelector("span") ??
    from.closest(".hm-card, .lib-card, .lib-row")?.querySelector("h3, .lib-card-title, .lib-row-title");
  if (!(el instanceof HTMLElement)) return () => undefined;
  el.style.viewTransitionName = "room-title";
  return () => { el.style.viewTransitionName = ""; };
}
const BOUNDARY_SETTLED = '.platform-practice[data-state="blocked"], .platform-practice[data-state="error"], .platform-practice[data-state="unsupported"]';
const stageReadySelector = (tab: Tab, tool: "tuner" | "metronome" | null = null, surface: RoomSurface = "practice"): string | undefined => {
  if (tool === "tuner" || (tab === "play" && surface === "tuner")) return `.guitar-tools.is-tuner, ${BOUNDARY_SETTLED}`;
  if (tool === "metronome" || (tab === "play" && surface === "metronome")) return `.guitar-tools.is-metronome, ${BOUNDARY_SETTLED}`;
  if (tab === "free" || (tab === "play" && surface === "free")) return `.fp-room, ${BOUNDARY_SETTLED}`;
  if (tab === "play") return `.room-host:not([hidden]) :is(.ss-ready, .ss-run, .ss-summary, .ss-cal, .room-empty), ${BOUNDARY_SETTLED}`;
  return undefined;
};
let vtSerial = 0;
/**
 * Unified directional screen transitions across every view (Home, Library, Song, Progress,
 * Practice, Free play, Tuner, Metronome): glides the topbar tab ink and slides the transparent
 * stage sideways over the continuous abyssal lagoon. Falls back cleanly without View Transitions
 * or under reduced motion.
 */
function transitionScreen(
  kind: TransitionKind,
  update: () => void,
  options?: { morphFrom?: Element | null; waitSelector?: string },
) {
  const rootEl = document.documentElement;
  const doc = document as ViewTransitionDocument;
  const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!doc.startViewTransition || still) { update(); return; }
  const token = ++vtSerial;
  rootEl.dataset.vt = kind;
  const unmark = options?.morphFrom ? markMorphSource(options.morphFrom) : () => undefined;
  const clear = () => { if (vtSerial === token) delete rootEl.dataset.vt; };
  try {
    const vt = doc.startViewTransition(async () => {
      unmark();
      flushSync(update);
      if (options?.waitSelector) await appeared(options.waitSelector, 450);
    });
    if (vt?.finished && typeof vt.finished.finally === "function") void vt.finished.finally(clear);
    else window.setTimeout(clear, 550);
  } catch {
    unmark();
    clear();
    update();
  }
}
const routeOf = (state: unknown): Route | null => {
  const route = (state as { ffl?: Route } | null)?.ffl;
  return route && typeof route.tab === "string" && typeof route.depth === "number" ? route : null;
};
const trySaveTune = (id: string) => { try { saveCurrentTuneId(id); } catch { /* the save notice reports it */ } };

export default function App() {
  const [route, setRoute] = useState<Route>(() => routeOf(history.state) ?? HOME);
  const [navDir, setNavDir] = useState<"right" | "left" | "fade">("fade");
  const routeRef = useRef(route);
  routeRef.current = route;
  const tab = route.tab;
  const [launch, setLaunch] = useState<PracticeLaunch>();
  // the Play tab's room: mounted from the first visit, parked (not unmounted) behind other tabs
  const [room, setRoom] = useState<RoomLaunch | null>(() => (route.tab === "play" ? { serial: 1, tuneId: null } : null));
  const roomSerial = useRef(1);
  const roomHandle = useRef<RoomHandle | null>(null);
  const [roomLive, setRoomLive] = useState(false);
  const [roomSurface, setRoomSurface] = useState<RoomSurface>("practice");
  const roomSurfaceRef = useRef<RoomSurface>("practice");
  roomSurfaceRef.current = roomSurface;
  const [roomRequest, setRoomRequest] = useState<RoomRequest>();
  const lastPress = useRef<PressOrigin | null>(null);
  useEffect(() => {
    const press = (event: PointerEvent) => { lastPress.current = { el: event.target as Element | null, x: event.clientX, y: event.clientY }; };
    window.addEventListener("pointerdown", press, true);
    return () => window.removeEventListener("pointerdown", press, true);
  }, []);
  const [stateRevision, setStateRevision] = useState(0);
  const [devicesOpen, setDevicesOpen] = useState(() => new URLSearchParams(location.hash.slice(1)).has("pair"));
  const [toolsTool, setToolsTool] = useState<"tuner" | "metronome" | null>(null);
  const toolsRef = useRef(toolsTool);
  toolsRef.current = toolsTool;
  const toolsOpen = toolsTool !== null;
  const handleRoomSurface = useCallback((surface: RoomSurface) => {
    roomSurfaceRef.current = surface;
    setRoomSurface(surface);
  }, []);
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
      const prev = routeRef.current;
      const prevTool = toolsRef.current;
      const prevSurface = roomSurfaceRef.current;
      const nextRoute = routeOf(event.state) ?? HOME;
      const diff = tabRank(nextRoute, null, "practice") - tabRank(prev, prevTool, prevSurface);
      const dir: TransitionKind = diff > 0 ? "right" : diff < 0 ? "left" : "fade";
      routeRef.current = nextRoute;
      toolsRef.current = null;
      roomSurfaceRef.current = "practice";
      transitionScreen(
        dir,
        () => {
          setToolsTool(null);
          setRoomSurface("practice");
          setLaunch(undefined);
          setNavDir(dir);
          setRoute(nextRoute);
        },
        { waitSelector: stageReadySelector(nextRoute.tab, null, "practice") },
      );
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  /** Move to a place. Returns whether a history entry was added. */
  const go = useCallback((tab: Tab, song: string | null = null, replace = false, commit?: () => void, targetSurface: RoomSurface = "practice"): boolean => {
    const now = routeRef.current;
    const prevTool = toolsRef.current;
    const prevSurface = roomSurfaceRef.current;
    if (now.tab === tab && now.song === song && !prevTool && (tab !== "play" || prevSurface === targetSurface)) {
      commit?.();
      return false;
    }
    const next: Route = { tab, song, depth: replace ? now.depth : tab === "tutor" && song === null ? 0 : now.depth + 1 };
    const diff = tabRank(next, null, targetSurface) - tabRank(now, prevTool, prevSurface);
    const dir: TransitionKind = diff > 0 ? "right" : diff < 0 ? "left" : "fade";
    const toPractice = tab === "play" && targetSurface === "practice";
    routeRef.current = next;
    toolsRef.current = null;
    roomSurfaceRef.current = targetSurface;
    const apply = () => {
      setToolsTool(null);
      setRoomSurface(targetSurface);
      setNavDir(dir);
      commit?.();
      setRoute(next);
      window.scrollTo?.(0, 0);
    };
    transitionScreen(dir, apply, {
      morphFrom: toPractice ? lastPress.current?.el ?? null : null,
      waitSelector: stageReadySelector(tab, null, targetSurface),
    });
    try {
      if (replace || next.depth === 0) history.replaceState({ ffl: next }, "");
      else history.pushState({ ffl: next }, "");
    } catch { /* history is a convenience */ }
    return !replace && next.depth > 0;
  }, []);
  const historyBack = useCallback(() => { history.back(); }, []);
  const closeTools = useCallback(() => {
    if (!toolsRef.current) return;
    const prev = routeRef.current;
    const diff = tabRank(prev, null, "practice") - tabRank(prev, toolsRef.current, roomSurfaceRef.current);
    const dir: TransitionKind = diff > 0 ? "right" : diff < 0 ? "left" : "left";
    toolsRef.current = null;
    transitionScreen(dir, () => {
      setNavDir(dir);
      setToolsTool(null);
    }, { waitSelector: stageReadySelector(prev.tab, null, "practice") });
  }, []);
  const back = useCallback(() => {
    if (toolsOpen) { closeTools(); return; }
    setLaunch(undefined);
    if (routeRef.current.depth > 0) historyBack();
    else go("tutor");
  }, [go, toolsOpen, closeTools, historyBack]);

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

  // ---------- the Play tab's room ----------
  /** Replace what the room plays, after a session under way there has finished and saved. */
  const startPractice = useCallback(async (tuneId: string | null, cardId?: string, prepared = false, options?: PracticeLaunchOptions) => {
    if (tuneId && !isKeyStudyId(tuneId)) trySaveTune(tuneId);
    if (!prepared) openPractice(input);
    setLaunch(undefined);
    await roomHandle.current?.leave();
    roomSerial.current += 1;
    const nextRoom: RoomLaunch = { serial: roomSerial.current, tuneId, cardId, ...options };
    go("play", null, false, () => {
      setRoomRequest(undefined);
      setRoom(nextRoom);
    });
  }, [input, go]);
  const startTune = useCallback((tuneId: string, cardId?: string, prepared = false, options?: PracticeLaunchOptions) => { void startPractice(tuneId, cardId, prepared, options); }, [startPractice]);
  /** The Play tab: back to the room as it was left, or the next session when none is open. */
  const openPlay = useCallback(() => {
    setLaunch(undefined);
    if (!room) { void startPractice(null); return; }
    if (routeRef.current.tab === "play" && !toolsRef.current) {
      if (roomSurfaceRef.current === "practice") return;
      const diff = tabRank(routeRef.current, null, "practice") - tabRank(routeRef.current, null, roomSurfaceRef.current);
      const dir: TransitionKind = diff > 0 ? "right" : diff < 0 ? "left" : "fade";
      roomSurfaceRef.current = "practice";
      transitionScreen(dir, () => {
        setNavDir(dir);
        setRoomSurface("practice");
        setRoomRequest((prev) => ({ serial: (prev?.serial ?? 0) + 1, kind: "practice" }));
      }, { waitSelector: stageReadySelector("play", null, "practice") });
      return;
    }
    go("play", null, false, () => {
      setRoomRequest((prev) => ({ serial: (prev?.serial ?? 0) + 1, kind: "practice" }));
    }, "practice");
  }, [room, go, startPractice]);
  /** The room closed itself (Esc, another window took the practice): it unmounts, the shell steps back. */
  const closeRoom = useCallback(() => {
    setRoom(null);
    setRoomLive(false);
    roomSurfaceRef.current = "practice";
    setRoomSurface("practice");
    if (routeRef.current.tab !== "play") return;
    if (routeRef.current.depth > 0) historyBack();
    else go("tutor");
  }, [go, historyBack]);
  // arriving on Play through history with no room (after a reload or a closed room): the next session
  useEffect(() => {
    if (tab !== "play" || room) return;
    roomSerial.current += 1;
    setRoom({ serial: roomSerial.current, tuneId: null });
  }, [tab, room]);
  /** Devices pairs only outside practice: a room's session finishes and saves, and the room closes. */
  const changeDevices = useCallback((open: boolean) => {
    setToolsTool(null);
    if (!open) { setDevicesOpen(false); return; }
    void (async () => {
      await roomHandle.current?.leave();
      setRoom(null);
      setRoomLive(false);
      roomSurfaceRef.current = "practice";
      setRoomSurface("practice");
      setDevicesOpen(true);
    })();
  }, []);

  const moveTab = useCallback((dir: 1 | -1) => {
    setLaunch(undefined);
    const at = TAB_CYCLE.indexOf(primaryTab(routeRef.current.tab));
    const next = TAB_CYCLE[(at + dir + TAB_CYCLE.length) % TAB_CYCLE.length];
    if (next === "play") openPlay();
    else go(next);
  }, [go, openPlay]);

  const openLibrary = useCallback(() => { setLaunch(undefined); go("tunes", null); }, [go]);
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

  /**
   * One practice surface per window owns the practice lock, so with a room open the shell never
   * mounts a second one: instruments and free play open inside the room, and the separate
   * trainers (Triads, Ear) first let the room finish and save.
   */
  const askRoom = useCallback((kind: RoomRequest["kind"]) => {
    setLaunch(undefined);
    const targetSurface: RoomSurface = kind === "settings" ? "practice" : kind;
    const now = routeRef.current;
    const prevTool = toolsRef.current;
    if (now.tab === "play" && !prevTool) {
      if (kind !== "settings" && roomSurfaceRef.current === targetSurface) return;
      const diff = tabRank(now, null, targetSurface) - tabRank(now, null, roomSurfaceRef.current);
      const dir: TransitionKind = diff > 0 ? "right" : diff < 0 ? "left" : "fade";
      roomSurfaceRef.current = targetSurface;
      if (kind === "settings" && dir === "fade") {
        setRoomRequest((prev) => ({ serial: (prev?.serial ?? 0) + 1, kind }));
        return;
      }
      transitionScreen(dir, () => {
        setNavDir(dir);
        setRoomSurface(targetSurface);
        setRoomRequest((prev) => ({ serial: (prev?.serial ?? 0) + 1, kind }));
      }, { waitSelector: stageReadySelector("play", null, targetSurface) });
      return;
    }
    go("play", null, false, () => {
      setRoomRequest((prev) => ({ serial: (prev?.serial ?? 0) + 1, kind }));
    }, targetSurface);
  }, [go]);
  const openTools = useCallback((tool: "tuner" | "metronome") => {
    setDevicesOpen(false);
    if (room && roomHandle.current) { askRoom(tool); return; }
    if (toolsRef.current === tool) return;
    const diff = tabRank(routeRef.current, tool, "practice") - tabRank(routeRef.current, toolsRef.current, roomSurfaceRef.current);
    const dir: TransitionKind = diff > 0 ? "right" : diff < 0 ? "left" : "fade";
    toolsRef.current = tool;
    transitionScreen(dir, () => {
      setNavDir(dir);
      setToolsTool(tool);
    }, { waitSelector: stageReadySelector(routeRef.current.tab, tool, "practice") });
  }, [room, askRoom]);
  const openSettings = useCallback(() => {
    setDevicesOpen(false);
    if (room && roomHandle.current) askRoom("settings");
    else openPlay();
  }, [room, askRoom, openPlay]);
  const openMode = useCallback((target: TutorTargetTab) => {
    setLaunch(undefined);
    if (target === "free") {
      openPractice(input);
      if (room && roomHandle.current) { askRoom("free"); return; }
    }
    if ((target === "triads" || target === "ear") && room) {
      void (async () => {
        await roomHandle.current?.leave();
        setRoom(null);
        setRoomLive(false);
        roomSurfaceRef.current = "practice";
        setRoomSurface("practice");
        go(target);
      })();
      return;
    }
    go(target);
  }, [input, go, room, askRoom]);
  const launched = useCallback(() => setLaunch(undefined), []);
  const closeFree = back;

  useEffect(() => {
    window.scrollTo?.(0, 0);
  }, [route.tab, route.song]);

  const canGoBack = route.depth > 0 || toolsOpen;
  const roomParked = tab !== "play" || toolsOpen || devicesOpen;
  const onPlay = tab === "play" && !toolsOpen && roomSurface === "practice";
  const onFree = !toolsOpen && (tab === "free" || (tab === "play" && roomSurface === "free"));
  const onTuner = toolsTool === "tuner" || (tab === "play" && !toolsOpen && roomSurface === "tuner");
  const onMetronome = toolsTool === "metronome" || (tab === "play" && !toolsOpen && roomSurface === "metronome");
  const waterScene: WaterScene =
    toolsTool ??
    (tab === "play"
      ? roomSurface
      : tab === "free"
        ? "free"
        : tab === "progress"
          ? "progress"
          : tab === "tunes"
            ? route.song ? "song" : "library"
            : "home");
  // Keep one continuous abyssal lagoon alive behind every screen; suspend only behind the Devices modal.
  const waterSuspended = devicesOpen;
  return (
    <KeyContext.Provider value={key}>
      <RomanContext.Provider value={true}>
        <div className={`app tab-${tab} dir-${navDir} ${toolsOpen ? "has-tools" : ""}`}>
          <AbyssalWater scene={waterScene} suspended={waterSuspended} />
          <header className="topbar" ref={topbar}>
            <div className="shell-start">
              <button type="button" className="shell-back" onClick={back} disabled={!canGoBack} aria-label="Back" title="Back">
                <Glyph name="arrow" size={20} /><span>Back</span>
              </button>
              <div className="brand">
                <span className="brand-mark" aria-hidden="true"><Glyph name="melody" size={20} /></span>
                <h1>Piekey</h1>
              </div>
            </div>
            <nav className="tabs" aria-label="views">
              {TABS.map((t) => {
                const on = primaryTab(tab) === t.id && !toolsOpen;
                return (
                  <button key={t.id} type="button" className={on ? "is-on" : ""} aria-current={on ? "page" : undefined} onClick={() => { setLaunch(undefined); go(t.id); }}>
                    <Glyph name={t.glyph} size={20} /><span>{t.label}</span>{on ? <i className="tab-ink" aria-hidden="true" /> : null}
                  </button>
                );
              })}
              <span className="tabs-rule" aria-hidden="true" />
              <button type="button" className={`tab-play ${onPlay ? "is-on" : ""} ${roomLive && !onPlay ? "is-live" : ""}`} aria-current={onPlay ? "page" : undefined} onClick={openPlay} title={roomLive && !onPlay ? "Back to the session" : "Practice"} aria-label={roomLive && !onPlay ? "Practice, session waiting" : "Practice"}>
                <Glyph name="play" size={20} /><span>Practice</span>{onPlay ? <i className="tab-ink" aria-hidden="true" /> : null}
                {roomLive && !onPlay ? <b className="tab-live" aria-hidden="true" /> : null}
              </button>
              <span className="tabs-rule" aria-hidden="true" />
              <button type="button" className={`tab-tool ${onFree ? "is-on" : ""}`} aria-current={onFree ? "page" : undefined} onClick={() => openMode("free")} title="Free play">
                <Glyph name="free" size={20} /><span>Free play</span>{onFree ? <i className="tab-ink" aria-hidden="true" /> : null}
              </button>
              <button type="button" className={`tab-tool ${onTuner ? "is-on" : ""}`} aria-current={onTuner ? "page" : undefined} onClick={() => openTools("tuner")} title="Chromatic tuner">
                <Glyph name="tools" size={20} /><span>Tuner</span>{onTuner ? <i className="tab-ink" aria-hidden="true" /> : null}
              </button>
              <button type="button" className={`tab-tool ${onMetronome ? "is-on" : ""}`} aria-current={onMetronome ? "page" : undefined} onClick={() => openTools("metronome")} title="Metronome">
                <Glyph name="clock" size={20} /><span>Metronome</span>{onMetronome ? <i className="tab-ink" aria-hidden="true" /> : null}
              </button>
            </nav>
            <div className="shell-end">
              <button type="button" className="device-sync-trigger shell-settings" onClick={openSettings} aria-label="Practice settings" title="Practice settings"><Glyph name="gear" size={20} /><span>Settings</span></button>
              <DeviceSync open={devicesOpen} onOpenChange={changeDevices} onUpdated={refreshState} />
            </div>
          </header>

          <SaveNotice />
          <PlatformStatus />

          {devicesOpen ? <main className="device-sync-placeholder" aria-hidden="true" /> : toolsTool ? <GuitarTools input={input} initialTool={toolsTool} onToolChange={(next) => { toolsRef.current = next; setToolsTool(next); }} onClose={closeTools} /> : tab === "play" ? null : tab === "tutor" ? (
            <OverviewView key={stateRevision} input={input} onOpenMode={openMode} onOpenSong={openSong} onOpenLibrary={openLibrary} onListenSong={listenSong} onStartPractice={startTune} />
          ) : tab === "progress" ? (
            <ProgressView key={stateRevision} onOpenSong={openSong} onStartPractice={startTune} />
          ) : tab === "tunes" ? (
            <TuneView key={stateRevision} input={input} launch={launch} onLaunched={launched} songId={route.song} onSong={songRoute} onStartPractice={startTune} />
          ) : tab === "free" ? (
            <FreePlayView key={stateRevision} input={input} onClose={closeFree} />
          ) : tab === "changes" ? (
            <FocusView key={stateRevision} focus="changes" input={input} onOpenTunes={openTunes} onStartPractice={startTune} />
          ) : tab === "scales" ? (
            <ScalesView key={stateRevision} keyInfo={key} input={input} onKey={changeKey} onOpenTunes={openTunes} />
          ) : tab === "reading" ? (
            <FocusView key={stateRevision} focus="reading" input={input} onOpenTunes={openTunes} onStartPractice={startTune} />
          ) : tab === "triads" ? (
            <TriadsView key={stateRevision} input={input} onExit={back} />
          ) : (
            <EarHub key={stateRevision} input={input} onOpenTunes={openTunes} />
          )}
          {room && !devicesOpen ? (
            <div className="room-host" hidden={roomParked}>
              <PracticeRoom key={room.serial} input={input} launch={room} parked={roomParked} request={roomRequest} handle={roomHandle} onClose={closeRoom} onLive={setRoomLive} onSurface={handleRoomSurface} onOpenLibrary={openLibrary} />
            </div>
          ) : null}
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
