import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import type { InputApi } from "../listen/useInput";
import { PoolBus, type PoolEvent, type PublisherProps } from "./bus";
import { useRoomRender } from "./mode";
import "./pool.css";

// One pool per practice room. The canvas and its fluid live here, outside the session, free play
// and instruments, so switching between them keeps the water moving. The visible room's
// PracticeAtmosphere is the publisher; the canvas moves into it. A WebGL context survives the move.

const PoolContext = createContext<PoolBus | null>(null);

interface HostHandle { retire(): void; revive(): void; dispose(): void; setAnimate(animate: boolean): void }

/** `parked`: the room is behind another tab, so the engine retires (no GPU work) until it returns. */
export function PoolRoom({ input, parked = false, children }: { input: InputApi; parked?: boolean; children: ReactNode }) {
  const parent = useContext(PoolContext);
  return parent ? <>{children}</> : <PoolRoot input={input} parked={parked}>{children}</PoolRoot>;
}

function PoolRoot({ input, parked, children }: { input: InputApi; parked: boolean; children: ReactNode }) {
  const bus = useMemo(() => new PoolBus(), []);
  const host = useRef<HostHandle | null>(null);
  const room = useRoomRender();
  const living = room.effective === "living" && !parked;
  const animate = useRef(room.animate);
  animate.current = room.animate;

  useEffect(() => {
    if (!living) return;
    let cancelled = false;
    if (host.current) host.current.revive();
    // The engine is downloaded only when this device actually shows the living pool.
    else void import("./host").then(({ createHost }) => {
      if (!cancelled) host.current = createHost(bus, { animate: animate.current });
    }).catch(() => undefined);
    return () => { cancelled = true; host.current?.retire(); };
  }, [living, bus]);
  useEffect(() => { host.current?.setAnimate(room.animate); }, [room.animate]);
  useEffect(() => () => { host.current?.dispose(); host.current = null; }, []);

  const listening = living && input.status === "listening" && !input.paused;
  useEffect(() => {
    if (!listening) return;
    return input.subscribe((frame) => bus.frame(frame));
  }, [listening, input.subscribe, bus]);

  return <PoolContext.Provider value={bus}>{children}</PoolContext.Provider>;
}

/** Called once per room render; the pool reads the latest props when it needs them. */
export function usePoolPublisher(host: RefObject<HTMLElement>, props: PublisherProps): boolean {
  const bus = useContext(PoolContext);
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    const el = host.current;
    if (!bus || !el) return;
    const publisher = { host: el, get props() { return latest.current; } };
    return bus.publish(publisher);
  }, [bus, host]);
  return bus !== null;
}

/** While `on`, the pool calms: modal menus, the guitar pad and calibration. */
export function usePoolCalm(on: boolean): void {
  const bus = useContext(PoolContext);
  useEffect(() => (bus && on ? bus.calm() : undefined), [bus, on]);
}

/** Fire-and-forget: nothing returns from the pool. A no-op outside a living room. */
export function usePoolEmit(): (event: PoolEvent) => void {
  const bus = useContext(PoolContext);
  return useMemo(() => (event: PoolEvent) => bus?.emit(event), [bus]);
}
