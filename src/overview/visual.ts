// Small deterministic visual helpers for the overview. The family colour system lives in modes.ts;
// a song only needs a stable monogram and an accent for its avatar.

const STOP_WORDS = new Set(["a", "an", "the", "of", "in", "on", "to"]);

export function songMonogram(title: string): string {
  const words = title
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .split(/\s+/)
    .filter((word) => word && !STOP_WORDS.has(word.toLowerCase()));
  const first = words[0]?.[0] ?? "?";
  const second = words[1]?.[0] ?? words[0]?.[1] ?? "";
  return (first + second).toUpperCase();
}

const KEY_HUES: Record<string, number> = {
  C: 42,
  G: 88,
  D: 132,
  A: 176,
  E: 216,
  B: 258,
  "F#": 300,
  "C#": 338,
  F: 18,
  Bb: 62,
  Eb: 104,
  Ab: 154,
  Db: 196,
  Gb: 238,
};

export function songAccent(key: string): string {
  const base = key.replace(/m$/, "");
  const hue = KEY_HUES[base] ?? [...key].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 360, 0);
  return `hsl(${hue} 52% 56%)`;
}

export function relativeDay(date: string | null, today: string): string {
  if (!date) return "not played yet";
  if (date === today) return "played today";
  const days = Math.round((Date.parse(today) - Date.parse(date)) / 86_400_000);
  if (!Number.isFinite(days)) return date;
  if (days <= 0) return "played today";
  if (days === 1) return "played yesterday";
  if (days < 7) return `played ${days}d ago`;
  return `played ${date}`;
}
