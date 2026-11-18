import type { Family } from "../song/deck";

export type GlyphName = "melody" | "chords" | "harmony" | "scales" | "reading" | "ear" | "free";
export type TutorTargetTab = "tunes" | "changes" | "scales" | "ear" | "reading" | "free";
export type TutorModeId = "song" | "changes" | "scales" | "ear" | "reading" | "free";

export interface TutorMode {
  id: TutorModeId;
  label: string;
  blurb: string;
  requiresTune: boolean;
  targetTab: TutorTargetTab;
  color: string;
  glyph: GlyphName;
}

export const FAMILY_META: Record<Family, { color: string; glyph: GlyphName }> = {
  scales: { color: "#5fb3a8", glyph: "scales" },
  harmony: { color: "#e0a956", glyph: "harmony" },
  melody: { color: "#b3a4ec", glyph: "melody" },
  chords: { color: "#e7826a", glyph: "chords" },
  reading: { color: "#8cc4ea", glyph: "reading" },
  ear: { color: "#d98fd3", glyph: "ear" },
  fretboard: { color: "#c9b46a", glyph: "scales" },
};

export const TUTOR_MODES: TutorMode[] = [
  {
    id: "song",
    label: "Song",
    blurb: "Melody · sections",
    requiresTune: true,
    targetTab: "tunes",
    color: "#b3a4ec",
    glyph: "melody",
  },
  {
    id: "changes",
    label: "Changes",
    blurb: "Voicings · harmony",
    requiresTune: true,
    targetTab: "changes",
    color: "#e7826a",
    glyph: "chords",
  },
  {
    id: "scales",
    label: "Scales",
    blurb: "Runs · patterns",
    requiresTune: false,
    targetTab: "scales",
    color: "#5fb3a8",
    glyph: "scales",
  },
  {
    id: "ear",
    label: "Ear",
    blurb: "Echo phrases",
    requiresTune: false,
    targetTab: "ear",
    color: "#d98fd3",
    glyph: "ear",
  },
  {
    id: "reading",
    label: "Reading",
    blurb: "Notation",
    requiresTune: true,
    targetTab: "reading",
    color: "#8cc4ea",
    glyph: "reading",
  },
  {
    id: "free",
    label: "Free play",
    blurb: "Adaptive click",
    requiresTune: false,
    targetTab: "free",
    color: "#7cc48a",
    glyph: "free",
  },
];
