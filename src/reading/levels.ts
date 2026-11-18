import type { Exercise, ReadingLevel } from "../core";

export const READING_LEVELS: { level: ReadingLevel; label: string; description: string }[] = [
  { level: 1, label: "Level 1", description: "Quarter notes, mostly steps, a chord note on beat 1." },
  { level: 2, label: "Level 2", description: "8th notes and quarters, steps and thirds." },
  { level: 3, label: "Level 3", description: "Arpeggio leaps, dotted rhythms and rests." },
  { level: 4, label: "Level 4", description: "Syncopation, anticipations and chromatic approach notes." },
];

/** Convention: the reading exercise title is `Sight reading · level N`; the level is parsed back from it. */
export const readingTitle = (level: ReadingLevel) => `Sight reading · level ${level}`;

export function readingLevelFromExercise(ex: Pick<Exercise, "title">): ReadingLevel {
  const m = /level\s+([1-4])/i.exec(ex.title);
  return (m ? Number(m[1]) : 1) as ReadingLevel;
}
