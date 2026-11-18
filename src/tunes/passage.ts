import { arrangementIdentity } from "../song/goals";
import type { LeadSheet } from "./musicxml";
import type { Timeline } from "./order";

export interface PassageRange { start: number; end: number }

export function validPassage(tl: Pick<Timeline, "slots">, range: PassageRange): boolean {
  return Number.isInteger(range.start) && Number.isInteger(range.end)
    && range.start >= 0 && range.start <= range.end && range.end < tl.slots.length;
}

/** Occurrences count the printed bar, including returns whose repeat-pass counter starts again. */
export function passageOccurrences(sheet: Pick<LeadSheet, "barNumbers">, tl: Pick<Timeline, "slots">) {
  const seen = new Map<number, number>();
  return tl.slots.map((slot, index) => {
    const occurrence = (seen.get(slot.bar) ?? 0) + 1;
    seen.set(slot.bar, occurrence);
    const bar = sheet.barNumbers[slot.bar] ?? String(slot.bar + 1);
    return { slot: index, bar, occurrence, label: `Bar ${bar} · occurrence ${occurrence} · playing order ${index + 1}` };
  });
}

export function passageLabel(sheet: Pick<LeadSheet, "barNumbers">, tl: Pick<Timeline, "slots">, range: PassageRange): string {
  const order = `playing order ${range.start + 1}${range.end === range.start ? "" : `–${range.end + 1}`}`;
  if (!validPassage(tl, range)) return `Selected passage · ${order}`;
  const occurrences = passageOccurrences(sheet, tl);
  const from = occurrences[range.start];
  const to = occurrences[range.end];
  return `Bar ${from.bar} · occurrence ${from.occurrence}${range.end === range.start ? "" : ` → bar ${to.bar} · occurrence ${to.occurrence}`} · ${order}`;
}

/** Arrangement-qualified IDs prevent an edited score from inheriting another passage's box. */
export function passageId(sheet: LeadSheet, range: PassageRange): string {
  return `mel:passage:${arrangementIdentity(sheet).fingerprint}:${range.start}-${range.end}`;
}

export function parsePassageId(id: string | undefined): (PassageRange & { fingerprint: string }) | null {
  const match = /^mel:passage:([0-9a-f]{1,8}-[0-9a-f]{1,8}-[1-9]\d{0,9}):(0|[1-9]\d{0,3})-(0|[1-9]\d{0,3})$/.exec(id ?? "");
  if (!match) return null;
  const start = Number(match[2]);
  const end = Number(match[3]);
  return start <= end && end < 4000 ? { fingerprint: match[1], start, end } : null;
}

/** Keep score order/indices; rearticulate a held boundary note and stop every voice at the end. */
export function passageTimeline(sheet: Pick<LeadSheet, "bars">, tl: Timeline, range: PassageRange): Timeline {
  if (!validPassage(tl, range)) throw new Error("Choose a passage in this score's playing order.");
  const from = tl.slots[range.start].start;
  const to = tl.slots[range.end].start + tl.slots[range.end].beats;
  const bars = new Set(tl.slots.slice(range.start, range.end + 1).map((slot) => slot.bar));
  const noteBars = sheet.bars.flatMap((bar, index) => bar.notes.filter((note) => !note.rest).map(() => index));
  const clip = <T extends { t: number; dur: number }>(event: T): T => event.t < to && event.t + event.dur > from
    ? { ...event, t: Math.max(from, event.t), dur: Math.min(to, event.t + event.dur) - Math.max(from, event.t) }
    : event;
  return {
    ...tl,
    targets: tl.targets.map((target) => {
      const clipped = clip(target);
      if (clipped === target) return target;
      return { ...clipped, slot: Math.max(range.start, target.slot), bar: target.slot < range.start ? tl.slots[range.start].bar : target.bar, notes: target.notes.filter((index) => bars.has(noteBars[index])) };
    }),
    comp: tl.comp.map(clip),
    ...(tl.bass ? { bass: tl.bass.map(clip) } : {}),
    ...(tl.guide ? { guide: tl.guide.map(clip) } : {}),
  };
}
