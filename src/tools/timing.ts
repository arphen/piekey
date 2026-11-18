export const MIN_TOOL_BPM = 30;
export const MAX_TOOL_BPM = 240;

export function clampToolBpm(bpm: number): number {
  return Math.round(Math.max(MIN_TOOL_BPM, Math.min(MAX_TOOL_BPM, Number.isFinite(bpm) ? bpm : 80)));
}

/** A fresh sequence after a pause; the median interval resists an accidental uneven tap. */
export function tapTempo(previous: readonly number[], at: number): { taps: number[]; bpm: number | null } {
  const last = previous[previous.length - 1];
  if (last === undefined || at - last > 2500 || at < last) return { taps: [at], bpm: null };
  if (at - last < 200) return { taps: [...previous], bpm: null };
  const taps = [...previous, at].slice(-8);
  const intervals = taps.slice(1).map((time, i) => time - taps[i]).sort((a, b) => a - b);
  const middle = Math.floor(intervals.length / 2);
  const interval = intervals.length % 2 ? intervals[middle] : (intervals[middle - 1] + intervals[middle]) / 2;
  return { taps, bpm: clampToolBpm(60000 / interval) };
}
