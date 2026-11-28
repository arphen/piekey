import type { InputFrame } from "../listen/useInput";
import type { BeatSignal } from "../song/pulse";

// The room's line to the pool: imperative, no React state per frame. Rooms publish what they
// already know (whose turn it is, the heard beat); instruments and the session send events.
// Nothing here is read back into practice logic.

export type PoolAnchor = "metronome" | "tuner" | "cursor" | "focus";
export type PoolEvent =
  | { kind: "tune"; cents: number | null; frequency: number | null }
  | { kind: "bloom"; strength: number; at?: PoolAnchor } // a clean pass
  | { kind: "heal"; strength: number } // a clean hit knitting and reviving a localized wound
  | { kind: "decay"; strength: number; tone?: "drift" | "miss" } // spawns a localized dying/wilted wound patch
  | { kind: "sweep"; direction: -1 | 1 }; // the card changed

export interface PublisherProps { playing: boolean; warmth: number; flow?: number; beat?: BeatSignal; bpm?: number; decay?: number }
export interface Publisher { host: HTMLElement; props: PublisherProps }

export interface PoolSink {
  frame(frame: InputFrame): void;
  publishers(): void;
}

export class PoolBus {
  private readonly stack: Publisher[] = [];
  private queue: PoolEvent[] = [];
  private calmTokens = 0;
  sink: PoolSink | null = null;

  /** The last mounted room wins, matching how only one atmosphere is visible at a time. */
  publish(publisher: Publisher): () => void {
    this.stack.push(publisher);
    this.sink?.publishers();
    return () => {
      const at = this.stack.lastIndexOf(publisher);
      if (at >= 0) this.stack.splice(at, 1);
      this.sink?.publishers();
    };
  }

  top(): Publisher | null { return this.stack[this.stack.length - 1] ?? null; }

  emit(event: PoolEvent): void {
    if (!this.sink) return;
    this.queue.push(event);
    if (this.queue.length > 64) this.queue.shift();
  }

  drain(): PoolEvent[] {
    const events = this.queue;
    this.queue = [];
    return events;
  }

  frame(frame: InputFrame): void { this.sink?.frame(frame); }

  /** A menu, pad or calibration is open: the pool thickens and its eddies fade. */
  calm(): () => void {
    this.calmTokens++;
    let held = true;
    return () => { if (held) { held = false; this.calmTokens--; } };
  }

  get calmed(): boolean { return this.calmTokens > 0; }
}
