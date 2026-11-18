import type { ReactNode } from "react";
import type { GlyphName } from "../overview/modes";

export type UtilityGlyphName = "home" | "play" | "library" | "arrow" | "clock" | "check" | "devices" | "sync" | "close" | "copy" | "plus" | "download" | "progress" | "tools";

const PATHS: Record<GlyphName | UtilityGlyphName, ReactNode> = {
  home: <><path d="m3 11 9-7 9 7" /><path d="M5 10v10h5v-6h4v6h5V10" /></>,
  play: <path d="m9 5 10 7-10 7z" />,
  library: <><path d="M5 4v16M10 4v16M15 5l5 14" /><path d="M4 8h2M9 16h2M15.8 8l2-.7" /></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  devices: <><rect x="3" y="4" width="12" height="10" rx="1" /><path d="M5 18h8M9 14v4" /><rect x="16" y="9" width="5" height="11" rx="1" /></>,
  sync: <><path d="M20 10a8 8 0 0 0-14-4L3 9m0-5v5h5M4 14a8 8 0 0 0 14 4l3-3m0 5v-5h-5" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  copy: <><path d="M8 4H4v12h4" /><rect x="8" y="8" width="12" height="13" rx="1" /></>,
  plus: <path d="M12 4v16M4 12h16" />,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></>,
  progress: <><path d="M4 19h16M5 15l4-5 4 2 6-7" /><circle cx="9" cy="10" r="1" /><circle cx="13" cy="12" r="1" /></>,
  tools: <><path d="M6 4v16M12 4v16M18 4v16" /><path d="M3 8h6M9 16h6M15 10h6" /></>,
  melody: (
    <>
      <path d="M9 18V6l9-2v12" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="16" cy="16" r="2" />
    </>
  ),
  chords: (
    <>
      <path d="M5 4v16M12 4v16M19 4v16M4 8h16M4 13h16M4 18h16" />
      <circle cx="8.5" cy="8" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="13" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="18" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  harmony: (
    <>
      <path d="M4 17V8l8-3 8 3v9" />
      <path d="M4 12h16" />
      <circle cx="8" cy="17" r="2" />
      <circle cx="16" cy="17" r="2" />
    </>
  ),
  scales: (
    <>
      <path d="M5 20V4M12 20V4M19 20V4" />
      <path d="M4 8h16M4 12h16M4 16h16" />
    </>
  ),
  reading: (
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v16H6.5A2.5 2.5 0 0 0 4 21.5z" />
      <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H12v16h5.5A2.5 2.5 0 0 1 20 21.5z" />
    </>
  ),
  ear: (
    <>
      <path d="M7 10a5 5 0 0 1 10 0c0 3-3 4-3 7a3 3 0 0 1-6 0" />
      <path d="M10 10a2 2 0 0 1 4 0c0 1.5-1.5 2-1.5 3.5" />
      <path d="M3 8h1.5M19.5 8H21M4.5 5l1 .8M18.5 5l-1 .8" />
    </>
  ),
  free: (
    <>
      <path d="M9 4h6l4 16H5z" />
      <path d="M8.5 16h7" />
      <path d="M12 16V9" />
      <circle cx="12" cy="8" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
};

export function Glyph({ name, size = 22 }: { name: GlyphName | UtilityGlyphName; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
