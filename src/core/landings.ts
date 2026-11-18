import { mod } from "../musicTheory";
import type { ChordInBar, KeyInfo } from "./contract";
import { spell } from "./scales";

const ROLES = ["3rd", "7th"];

function signed(from: number, to: number): number {
  const d = mod(to - from);
  return d > 6 ? d - 12 : d;
}

function stepWord(d: number): string {
  const a = Math.abs(d);
  const size = a === 1 ? "a half step" : a === 2 ? "a whole step" : `${a} semitones`;
  return `${d < 0 ? "falls" : "rises"} ${size}`;
}

/** For each guide tone (3rd, 7th) of `from`, the nearest guide tone of `to`. */
export function landingMoves(from: ChordInBar, to: ChordInBar, key: KeyInfo): string[] {
  const moves: string[] = [];
  from.guideTones.forEach((pc, i) => {
    const name = spell(pc, from.parentScale, key);
    const common = to.guideTones.indexOf(pc);
    if (common >= 0) {
      moves.push(`${name} stays (${ROLES[i]} of ${from.symbol} = ${ROLES[common]} of ${to.symbol})`);
      return;
    }
    let best = 0;
    let bestD = Infinity;
    to.guideTones.forEach((t, j) => {
      const d = signed(pc, t);
      if (Math.abs(d) < Math.abs(bestD)) {
        bestD = d;
        best = j;
      }
    });
    const target = to.guideTones[best];
    moves.push(
      `${name} → ${spell(target, to.parentScale, key)} (${ROLES[i]} of ${from.symbol} ${stepWord(bestD)} to ${ROLES[best]} of ${to.symbol})`,
    );
    const isDominant = i === 0 && from.guideTones[1] === mod(from.rootPc + 10) && pc === mod(from.rootPc + 4);
    if (isDominant && mod(pc + 1) === to.rootPc) {
      moves.push(`${name} → ${spell(to.rootPc, to.parentScale, key)} (leading tone resolves to root)`);
    }
  });
  return moves;
}

export interface LandingTarget {
  /** guide tone of `from` to end the chord on */
  endPc: number;
  endName: string;
  endRole: string;
  /** guide tone of `to` it resolves into on the next downbeat */
  landPc: number;
  landName: string;
  landRole: string;
  /** signed semitones end → land (0 = common tone held over) */
  step: number;
}

/**
 * The single best note to end `from` on: the guide tone with the smallest
 * non-zero voice-leading move into a guide tone of `to` (ties favour landing
 * on the 3rd). If every move is a common tone, hold the one that becomes the 3rd.
 */
export function landingTarget(from: ChordInBar, to: ChordInBar, key: KeyInfo): LandingTarget {
  let pick = { i: 0, j: 0, d: Infinity };
  let held: { i: number; j: number } | null = null;
  for (let i = 0; i < from.guideTones.length; i++) {
    for (let j = 0; j < to.guideTones.length; j++) {
      const d = signed(from.guideTones[i], to.guideTones[j]);
      if (d === 0) {
        if (!held || j < held.j) held = { i, j };
      } else if (Math.abs(d) < Math.abs(pick.d) || (Math.abs(d) === Math.abs(pick.d) && j < pick.j)) {
        pick = { i, j, d };
      }
    }
  }
  if (Math.abs(pick.d) > 2 && held) pick = { ...held, d: 0 };
  if (!Number.isFinite(pick.d)) pick.d = 0;
  const endPc = from.guideTones[pick.i];
  const landPc = to.guideTones[pick.j];
  return {
    endPc,
    endName: spell(endPc, from.parentScale, key),
    endRole: ROLES[pick.i],
    landPc,
    landName: spell(landPc, to.parentScale, key),
    landRole: ROLES[pick.j],
    step: pick.d,
  };
}

/** "½ step down", "whole step up", "held" */
export function stepShort(d: number): string {
  if (d === 0) return "held over";
  const a = Math.abs(d);
  const size = a === 1 ? "½ step" : a === 2 ? "whole step" : `${a} semitones`;
  return `${size} ${d < 0 ? "down" : "up"}`;
}
