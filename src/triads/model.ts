// The triad card box's stored shape and its validation: pure, so the sync layer can check an
// exchanged copy without loading the drill (box.ts reads and writes it).

export type Naming = "german" | "english";

export const TOP_BOX = 5;

export interface TriadState {
  box: number; // 0 unseen, 1..5
  due: string; // YYYY-MM-DD
  seen: number;
  right: number;
  ms?: number; // the last answer's time
}

export interface TriadStore {
  v: 1;
  cards: Record<string, TriadState>;
  naming?: Naming;
}

export const emptyTriads = (): TriadStore => ({ v: 1, cards: {} });

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const count = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

export function validTriadState(value: unknown): value is TriadState {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return count(s.box) && s.box <= TOP_BOX && typeof s.due === "string" && DAY.test(s.due) && count(s.seen) && count(s.right) && s.right <= s.seen && (s.ms === undefined || count(s.ms));
}

export function validTriadStore(value: unknown): value is TriadStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1 || !v.cards || typeof v.cards !== "object" || Array.isArray(v.cards)) return false;
  if (v.naming !== undefined && v.naming !== "german" && v.naming !== "english") return false;
  return Object.values(v.cards as Record<string, unknown>).every(validTriadState);
}

