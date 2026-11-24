import type { Family } from "../song/deck";

export type GlyphName = "melody" | "chords" | "harmony" | "scales" | "reading" | "ear" | "free";
export type TutorTargetTab = "tunes" | "changes" | "scales" | "ear" | "reading" | "free" | "triads";
export type TutorModeId = "song" | "changes" | "scales" | "ear" | "reading" | "free" | "triads";

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
  scales: { color: "#6de64b", glyph: "scales" },
  technique: { color: "#58d4b4", glyph: "scales" },
  harmony: { color: "#dfc068", glyph: "harmony" },
  melody: { color: "#8ee6a8", glyph: "melody" },
  chords: { color: "#d69463", glyph: "chords" },
  reading: { color: "#7cc8c2", glyph: "reading" },
  ear: { color: "#a4d97c", glyph: "ear" },
  fretboard: { color: "#c9ba68", glyph: "scales" },
};

export const TUTOR_MODES: TutorMode[] = [
  {
    id: "song",
    label: "Song",
    blurb: "Melody · sections",
    requiresTune: true,
    targetTab: "tunes",
    color: "#8ee6a8",
    glyph: "melody",
  },
  {
    id: "changes",
    label: "Changes",
    blurb: "Voicings · harmony",
    requiresTune: true,
    targetTab: "changes",
    color: "#d69463",
    glyph: "chords",
  },
  {
    id: "scales",
    label: "Scales",
    blurb: "Runs · patterns",
    requiresTune: false,
    targetTab: "scales",
    color: "#6de64b",
    glyph: "scales",
  },
  {
    id: "ear",
    label: "Ear",
    blurb: "Echo phrases",
    requiresTune: false,
    targetTab: "ear",
    color: "#a4d97c",
    glyph: "ear",
  },
  {
    id: "reading",
    label: "Reading",
    blurb: "Notation",
    requiresTune: true,
    targetTab: "reading",
    color: "#7cc8c2",
    glyph: "reading",
  },
  {
    id: "triads",
    label: "Triads",
    blurb: "By heart · card box",
    requiresTune: false,
    targetTab: "triads",
    color: "#dfc068",
    glyph: "harmony",
  },
  {
    id: "free",
    label: "Free play",
    blurb: "Adaptive click",
    requiresTune: false,
    targetTab: "free",
    color: "#72e854",
    glyph: "free",
  },
];
