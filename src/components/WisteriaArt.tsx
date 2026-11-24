import { Fragment } from "react";
import { MID, ORBIT, WHEEL_ORBITS } from "../overview/homeTree";
import { polarPoint } from "../tree/layout";

// Pure deterministic SVG geometry for Home's botanical wisteria trellis and ornate node medallions.
// Zero heavy SVG filters: luminosity comes from clean layered gradients, crisp filigree strokes,
// and sculpted botanical curves so the tree stays silky smooth over AbyssalWater.

const f = (n: number) => n.toFixed(2);

/** A closed scalloped floral-rosette ring around (0, 0): `lobes` smooth botanical arches. */
export function scallopPath(rInner: number, rOuter: number, lobes: number, phaseDeg = 0): string {
  const step = 360 / lobes;
  const parts: string[] = [];
  for (let i = 0; i < lobes; i++) {
    const a0 = phaseDeg + i * step;
    const am = a0 + step / 2;
    const a1 = a0 + step;
    const p0 = polarPoint(0, 0, rInner, a0);
    const pm = polarPoint(0, 0, rOuter, am);
    const p1 = polarPoint(0, 0, rInner, a1);
    if (i === 0) parts.push(`M ${f(p0.x)} ${f(p0.y)}`);
    parts.push(`Q ${f(pm.x)} ${f(pm.y)} ${f(p1.x)} ${f(p1.y)}`);
  }
  parts.push("Z");
  return parts.join(" ");
}

/** Pointed lotus/wisteria calyx petals radiating around (0, 0). */
export function calyxPath(rBase: number, rTip: number, count: number, halfWidthDeg: number, phaseDeg = 0): string {
  const step = 360 / count;
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const a = phaseDeg + i * step;
    const left = polarPoint(0, 0, rBase, a - halfWidthDeg);
    const right = polarPoint(0, 0, rBase, a + halfWidthDeg);
    const tip = polarPoint(0, 0, rTip, a);
    const cL = polarPoint(0, 0, (rBase + rTip) * 0.54, a - halfWidthDeg * 0.72);
    const cR = polarPoint(0, 0, (rBase + rTip) * 0.54, a + halfWidthDeg * 0.72);
    parts.push(`M ${f(left.x)} ${f(left.y)} Q ${f(cL.x)} ${f(cL.y)} ${f(tip.x)} ${f(tip.y)} Q ${f(cR.x)} ${f(cR.y)} ${f(right.x)} ${f(right.y)}`);
  }
  return parts.join(" ");
}

/** A single pointed botanical leaflet growing from (0, 0) along +x to (len, 0). */
export function leafPath(len: number, width: number): string {
  return `M 0 0 Q ${f(len * 0.44)} ${f(-width)} ${f(len)} 0 Q ${f(len * 0.44)} ${f(width)} 0 0 Z`;
}

/** An undulating vine wave along a circle around (cx, cy). */
function vineRingPath(cx: number, cy: number, radius: number, waves: number, amp: number, phaseDeg = 0): string {
  const steps = waves * 2;
  const step = 360 / steps;
  const parts: string[] = [];
  for (let i = 0; i < steps; i++) {
    const a0 = phaseDeg + i * step;
    const am = a0 + step / 2;
    const a1 = a0 + step;
    const sign = i % 2 === 0 ? 1 : -1;
    const p0 = polarPoint(cx, cy, radius, a0);
    const pm = polarPoint(cx, cy, radius + sign * amp, am);
    const p1 = polarPoint(cx, cy, radius, a1);
    if (i === 0) parts.push(`M ${f(p0.x)} ${f(p0.y)}`);
    parts.push(`Q ${f(pm.x)} ${f(pm.y)} ${f(p1.x)} ${f(p1.y)}`);
  }
  parts.push("Z");
  return parts.join(" ");
}

/** A circular arc around (cx, cy) by bearing (clockwise from up). */
function ringArc(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  const a = polarPoint(cx, cy, r, fromDeg);
  const b = polarPoint(cx, cy, r, toDeg);
  const delta = ((toDeg - fromDeg) % 360 + 360) % 360;
  return `M ${f(a.x)} ${f(a.y)} A ${f(r)} ${f(r)} 0 ${delta > 180 ? 1 : 0} 1 ${f(b.x)} ${f(b.y)}`;
}

/**
 * A drooping wisteria blossom cluster (raceme) hanging downward from (x, y).
 * IMPORTANT: the outer `<g>` holds the SVG translate, while the inner `.hm-raceme` holds the
 * gentle CSS sway animation so CSS `transform` never overrides the SVG placement!
 */
function WisteriaRaceme({
  x,
  y,
  length,
  sway,
  scale = 1,
  variant = 0,
}: {
  x: number;
  y: number;
  length: number;
  sway: number;
  scale?: number;
  variant?: number;
}) {
  const count = Math.max(7, Math.round(length / 7.6));
  const cp1x = sway * 0.42;
  const cp1y = length * 0.34;
  const cp2x = sway * 0.86;
  const cp2y = length * 0.72;
  const endX = sway;
  const endY = length;

  const pointAt = (t: number) => {
    const mt = 1 - t;
    const px = 3 * mt * mt * t * cp1x + 3 * mt * t * t * cp2x + t * t * t * endX;
    const py = 3 * mt * mt * t * cp1y + 3 * mt * t * t * cp2y + t * t * t * endY;
    return { x: px, y: py };
  };

  const blossoms: { x: number; y: number; rx: number; ry: number; rot: number; tone: number }[] = [];
  for (let i = 0; i < count; i++) {
    const t = 0.06 + (i / (count - 1)) * 0.89;
    const p = pointAt(t);
    const taper = 1 - t * 0.68;
    const spread = (7.2 * taper + 1.1) * scale;
    const side = (i + variant) % 2 === 0 ? 1 : -1;
    blossoms.push({
      x: p.x + side * spread * 0.7,
      y: p.y + 0.5,
      rx: 4.4 * taper * scale,
      ry: 5.9 * taper * scale,
      rot: side * (16 + t * 11),
      tone: t < 0.34 ? 0 : t < 0.68 ? 1 : 2,
    });
    if (i < count - 2) {
      blossoms.push({
        x: p.x - side * spread * 0.56,
        y: p.y + 2.3 * taper * scale,
        rx: 3.8 * taper * scale,
        ry: 5.1 * taper * scale,
        rot: -side * (14 + t * 9),
        tone: t < 0.44 ? 1 : 2,
      });
    }
    if (i % 2 === 0 && i < count - 1) {
      blossoms.push({
        x: p.x + side * 0.8 * scale,
        y: p.y + 1.4 * scale,
        rx: 3.2 * taper * scale,
        ry: 4.5 * taper * scale,
        rot: side * 5,
        tone: t < 0.48 ? 2 : 3,
      });
    }
  }

  return (
    <g transform={`translate(${f(x)} ${f(y)})`}>
      <g className={`hm-raceme hm-raceme--${variant % 3}`}>
        {/* Tender hanging stem + curling spiral tendril at crown */}
        <path className="hm-raceme-stem" d={`M 0 0 C ${f(cp1x)} ${f(cp1y)}, ${f(cp2x)} ${f(cp2y)}, ${f(endX)} ${f(endY)}`} />
        <path
          className="hm-raceme-tendril"
          d={`M 0 2 C ${f(sway * 0.2 - 11 * scale)} ${f(-5 * scale)}, ${f(-16 * scale)} ${f(9 * scale)}, ${f(-9 * scale)} ${f(14 * scale)} C ${f(-5 * scale)} ${f(17 * scale)}, ${f(-2 * scale)} ${f(12 * scale)}, ${f(-6 * scale)} ${f(10 * scale)}`}
        />
        {/* Paired wisteria leaflets at the crown */}
        <path className="hm-w-leaf" d={leafPath(14.5 * scale, 4.1 * scale)} transform={`translate(0 0) rotate(${sway >= 0 ? -22 : -158})`} />
        <path className="hm-w-leaf is-soft" d={leafPath(12 * scale, 3.4 * scale)} transform={`translate(0 2) rotate(${sway >= 0 ? -154 : -26})`} />
        {/* Graduated blossoms from deep twilight violet down to pale moonlight tips */}
        {blossoms.map((b, idx) => (
          <ellipse
            key={idx}
            className={`hm-w-petal is-tone-${b.tone}`}
            cx={b.x}
            cy={b.y}
            rx={b.rx}
            ry={b.ry}
            transform={`rotate(${f(b.rot)} ${f(b.x)} ${f(b.y)})`}
          />
        ))}
        {/* Delicate dewdrop tip buds */}
        <circle className="hm-w-bud" cx={endX} cy={endY + 2.2 * scale} r={1.85 * scale} />
        <circle className="hm-w-bud is-faint" cx={endX + sway * 0.05} cy={endY + 5.2 * scale} r={1.15 * scale} />
      </g>
    </g>
  );
}

/** A delicate pinnate wisteria leaf spray along a bough. */
function PinnateSpray({ x, y, angle, scale = 1, flip = 1 }: { x: number; y: number; angle: number; scale?: number; flip?: 1 | -1 }) {
  const pairs = [
    { d: 8, len: 12.5, w: 3.5 },
    { d: 19, len: 14, w: 3.8 },
    { d: 30, len: 12, w: 3.3 },
    { d: 40, len: 9, w: 2.6 },
  ];
  return (
    <g className="hm-pinnate" transform={`translate(${f(x)} ${f(y)}) rotate(${f(angle)}) scale(${f(scale)} ${f(scale * flip)})`}>
      <path className="hm-raceme-stem" d="M 0 0 Q 24 -4 51 -2" />
      {pairs.map((p, i) => (
        <Fragment key={i}>
          <path className="hm-w-leaf" d={leafPath(p.len, p.w)} transform={`translate(${p.d} ${f(-p.d * 0.06)}) rotate(-52)`} />
          <path className="hm-w-leaf is-soft" d={leafPath(p.len * 0.94, p.w * 0.92)} transform={`translate(${p.d} ${f(-p.d * 0.06)}) rotate(48)`} />
        </Fragment>
      ))}
      <path className="hm-w-leaf" d={leafPath(10.8, 2.9)} transform="translate(50 -2) rotate(-4)" />
    </g>
  );
}

/** SVG `<defs>` gradients shared by the wisteria trellis and ornate medallions. */
export function WisteriaDefs() {
  return (
    <>
      <radialGradient id="hm-core">
        <stop offset="0" stopColor="#b98cff" stopOpacity="0.22" />
        <stop offset="0.26" stopColor="#65d48a" stopOpacity="0.11" />
        <stop offset="0.58" stopColor="#422a6e" stopOpacity="0.08" />
        <stop offset="0.82" stopColor="#122138" stopOpacity="0.03" />
        <stop offset="1" stopColor="#040914" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="hm-bloom">
        <stop offset="0" stopColor="#d8b4ff" stopOpacity="0.46" />
        <stop offset="0.48" stopColor="#74e48c" stopOpacity="0.18" />
        <stop offset="1" stopColor="#74e48c" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="hm-wisteria-glow">
        <stop offset="0" stopColor="#dfc2ff" stopOpacity="0.44" />
        <stop offset="0.52" stopColor="#9b6dff" stopOpacity="0.15" />
        <stop offset="1" stopColor="#9b6dff" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="hm-kin-glow">
        <stop offset="0" stopColor="#ebd182" stopOpacity="0.34" />
        <stop offset="0.58" stopColor="#c49eff" stopOpacity="0.1" />
        <stop offset="1" stopColor="#ebd182" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="hm-f-aura">
        <stop offset="0" stopColor="currentColor" stopOpacity="0.24" />
        <stop offset="1" stopColor="currentColor" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="hm-enamel" cx="38%" cy="32%" r="72%">
        <stop offset="0" stopColor="#1e1a36" />
        <stop offset="0.58" stopColor="#0d1122" />
        <stop offset="1" stopColor="#060914" />
      </radialGradient>
      <radialGradient id="hm-core-enamel" cx="38%" cy="30%" r="74%">
        <stop offset="0" stopColor="#2a1f48" />
        <stop offset="0.52" stopColor="#12162c" />
        <stop offset="1" stopColor="#060b16" />
      </radialGradient>
      <linearGradient id="hm-wisteria-gold" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0" stopColor="#f0d99e" />
        <stop offset="0.48" stopColor="#d6bbf6" />
        <stop offset="1" stopColor="#bc9b5e" />
      </linearGradient>
      <linearGradient id="hm-vine-bough" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0" stopColor="#9e7dd1" stopOpacity="0.62" />
        <stop offset="0.5" stopColor="#96ba96" stopOpacity="0.48" />
        <stop offset="1" stopColor="#d6b97c" stopOpacity="0.56" />
      </linearGradient>
    </>
  );
}

/**
 * Ornate botanical wisteria trellis & hanging pergola canopy drawn beneath links and nodes.
 * Carefully keeps 12 o'clock songs, 6 o'clock Rhythm pyramid, and East/West keystones clear.
 */
export function WisteriaUnderlay() {
  const rPetals = WHEEL_ORBITS[ORBIT.petals];
  const rMinor = WHEEL_ORBITS[ORBIT.minor];
  const rMajor = WHEEL_ORBITS[ORBIT.major];
  const rSongs = WHEEL_ORBITS[ORBIT.songs];
  const rCanopy = rSongs + 68;

  // Quadratic Bezier point helper so corner racemes attach seamlessly to the corner boughs
  const quadAt = (x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, t: number) => {
    const mt = 1 - t;
    return { x: mt * mt * x0 + 2 * mt * t * cx + t * t * x1, y: mt * mt * y0 + 2 * mt * t * cy + t * t * y1 };
  };
  const leftCorner = (t: number) => quadAt(MID - 475, MID - 310, MID - 375, MID - 368, MID - 242, MID - 294, t);
  const rightCorner = (t: number) => quadAt(MID + 475, MID - 310, MID + 375, MID - 368, MID + 242, MID - 294, t);
  const leftLowerBough = (t: number) => quadAt(MID - 442, MID + 90, MID - 454, MID + 148, MID - 352, MID + 242, t);
  const rightLowerBough = (t: number) => quadAt(MID + 442, MID + 90, MID + 454, MID + 148, MID + 352, MID + 242, t);

  // Hanging wisteria racemes — every single cluster grows directly from a vine bough
  const racemes: { x: number; y: number; length: number; sway: number; scale: number; variant: number }[] = [
    // Upper-left pergola arch (draping down left of C/F/B♭, above Ear training)
    { ...polarPoint(MID, MID, rCanopy + 8, 300), length: 82, sway: -9, scale: 0.96, variant: 0 },
    { ...polarPoint(MID, MID, rCanopy + 8, 311), length: 98, sway: -7, scale: 1.04, variant: 1 },
    { ...polarPoint(MID, MID, rCanopy + 8, 323), length: 74, sway: -5, scale: 0.88, variant: 2 },
    { ...polarPoint(MID, MID, rCanopy + 8, 334), length: 54, sway: -3, scale: 0.76, variant: 0 },
    // Upper-left far corner pergola drape (attached directly to leftCorner bough)
    { ...leftCorner(0.24), length: 90, sway: -8, scale: 0.98, variant: 2 },
    { ...leftCorner(0.52), length: 66, sway: -4, scale: 0.82, variant: 1 },
    // Upper-right pergola arch (mirror: draping down right of C/G/D, above Triads)
    { ...polarPoint(MID, MID, rCanopy + 8, 26), length: 54, sway: 3, scale: 0.76, variant: 1 },
    { ...polarPoint(MID, MID, rCanopy + 8, 37), length: 76, sway: 5, scale: 0.88, variant: 2 },
    { ...polarPoint(MID, MID, rCanopy + 8, 49), length: 100, sway: 7, scale: 1.04, variant: 0 },
    { ...polarPoint(MID, MID, rCanopy + 8, 60), length: 82, sway: 9, scale: 0.96, variant: 1 },
    // Upper-right far corner pergola drape (attached directly to rightCorner bough)
    { ...rightCorner(0.52), length: 66, sway: 4, scale: 0.82, variant: 0 },
    { ...rightCorner(0.24), length: 90, sway: 8, scale: 0.98, variant: 2 },
    // Lower-flank hanging clusters growing from graceful outer lower vine boughs
    { ...rightLowerBough(0.28), length: 68, sway: 7, scale: 0.86, variant: 2 },
    { ...rightLowerBough(0.56), length: 48, sway: 4, scale: 0.72, variant: 1 },
    { ...leftLowerBough(0.28), length: 68, sway: -7, scale: 0.86, variant: 0 },
    { ...leftLowerBough(0.56), length: 48, sway: -4, scale: 0.72, variant: 2 },
  ];

  // Drifting moonlit wisteria petals around the outer canopy
  const motes: { x: number; y: number; r: number; rot: number }[] = [
    { ...polarPoint(MID, MID, rCanopy + 54, 305), r: 2.6, rot: 25 },
    { ...polarPoint(MID, MID, rCanopy + 36, 326), r: 2.1, rot: -18 },
    { ...polarPoint(MID, MID, rCanopy + 54, 55), r: 2.6, rot: -28 },
    { ...polarPoint(MID, MID, rCanopy + 36, 34), r: 2.1, rot: 20 },
    { ...polarPoint(MID, MID, rCanopy + 62, 108), r: 2.2, rot: 40 },
    { ...polarPoint(MID, MID, rCanopy + 62, 252), r: 2.2, rot: -40 },
    { x: MID - 395, y: MID - 220, r: 2.4, rot: 14 },
    { x: MID + 395, y: MID - 220, r: 2.4, rot: -14 },
  ];

  const spokes = Array.from({ length: 12 }, (_, i) => i * 30);
  const halfSpokes = Array.from({ length: 12 }, (_, i) => i * 30 + 15);
  const petalAngles = [30, 90, 150, 210, 270, 330];

  return (
    <g className="hm-trellis">
      {/* Ambient twilight wisteria & garden moonlight wash */}
      <circle cx={MID} cy={MID} r={rSongs + 120} fill="url(#hm-core)" />

      {/* Outer arched wisteria pergola boughs (upper & lower sweeps + corner vine arches) */}
      <g className="hm-canopy-boughs">
        <path className="hm-bough" d={ringArc(MID, MID, rCanopy + 8, 296, 64)} />
        <path className="hm-bough is-thin" d={ringArc(MID, MID, rCanopy + 15, 300, 60)} />
        <path className="hm-bough is-soft" d={ringArc(MID, MID, rCanopy + 8, 114, 246)} />
        <path className="hm-bough is-thin is-soft" d={ringArc(MID, MID, rCanopy + 14, 120, 240)} />
        {/* Swooping corner & lower-flank wisteria vine boughs framing all four outer edges */}
        <path className="hm-bough is-corner" d={`M ${f(MID - 475)} ${f(MID - 310)} Q ${f(MID - 375)} ${f(MID - 368)} ${f(MID - 242)} ${f(MID - 294)}`} />
        <path className="hm-bough is-corner" d={`M ${f(MID + 475)} ${f(MID - 310)} Q ${f(MID + 375)} ${f(MID - 368)} ${f(MID + 242)} ${f(MID - 294)}`} />
        <path className="hm-bough is-corner is-soft" d={`M ${f(MID - 442)} ${f(MID + 90)} Q ${f(MID - 454)} ${f(MID + 148)} ${f(MID - 352)} ${f(MID + 242)}`} />
        <path className="hm-bough is-corner is-soft" d={`M ${f(MID + 442)} ${f(MID + 90)} Q ${f(MID + 454)} ${f(MID + 148)} ${f(MID + 352)} ${f(MID + 242)}`} />
        <PinnateSpray {...leftLowerBough(0.76)} angle={42} scale={0.76} flip={1} />
        <PinnateSpray {...rightLowerBough(0.76)} angle={138} scale={0.76} flip={-1} />
        {/* Pinnate leaf sprays unfurling along the upper & lower boughs */}
        {[
          { angle: 298, r: rCanopy + 10, rot: 142, s: 0.94, flip: 1 as const },
          { angle: 328, r: rCanopy + 9, rot: 162, s: 0.82, flip: -1 as const },
          { angle: 32, r: rCanopy + 9, rot: 18, s: 0.82, flip: 1 as const },
          { angle: 62, r: rCanopy + 10, rot: 38, s: 0.94, flip: -1 as const },
          { angle: 124, r: rCanopy + 10, rot: 122, s: 0.74, flip: 1 as const },
          { angle: 236, r: rCanopy + 10, rot: 58, s: 0.74, flip: -1 as const },
        ].map((sp, i) => {
          const p = polarPoint(MID, MID, sp.r, sp.angle);
          return <PinnateSpray key={i} x={p.x} y={p.y} angle={sp.rot} scale={sp.s} flip={sp.flip} />;
        })}
      </g>

      {/* Hanging wisteria blossom clusters */}
      <g className="hm-canopy-racemes">
        {racemes.map((r, i) => (
          <WisteriaRaceme key={i} x={r.x} y={r.y} length={r.length} sway={r.sway} scale={r.scale} variant={r.variant} />
        ))}
        {motes.map((m, i) => (
          <ellipse
            key={i}
            className="hm-w-mote"
            cx={m.x}
            cy={m.y}
            rx={m.r}
            ry={m.r * 1.45}
            transform={`rotate(${m.rot} ${f(m.x)} ${f(m.y)})`}
          />
        ))}
      </g>

      {/* Ornate Song Rim trellis hoop */}
      <g className="hm-ring-songs">
        <circle className="hm-track hm-track--outer" cx={MID} cy={MID} r={rSongs} />
        <circle className="hm-track hm-track--hairline" cx={MID} cy={MID} r={rSongs - 4.8} />
        <circle className="hm-track hm-track--hairline" cx={MID} cy={MID} r={rSongs + 4.8} />
        {halfSpokes.map((a) => {
          const p = polarPoint(MID, MID, rSongs, a);
          return (
            <g key={a} transform={`translate(${f(p.x)} ${f(p.y)}) rotate(${a})`}>
              <path className="hm-rim-trefoil" d="M 0 -5.2 Q 2.8 -1.5 0 3.4 Q -2.8 -1.5 0 -5.2 Z" />
              <circle className="hm-filigree-pearl is-dim" cy={4.8} r={1.15} />
            </g>
          );
        })}
      </g>

      {/* Delicate botanical compass spokes connecting minor & major rings */}
      <g className="hm-compass-spokes">
        {spokes.map((a) => {
          const p0 = polarPoint(MID, MID, rPetals + 14, a);
          const p1 = polarPoint(MID, MID, rMajor, a);
          const mid = polarPoint(MID, MID, (rMinor + rMajor) / 2, a);
          return (
            <g key={a}>
              <line className="hm-spoke-line" x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} />
              <rect className="hm-spoke-pip" x={mid.x - 1.6} y={mid.y - 1.6} width={3.2} height={3.2} transform={`rotate(${a + 45} ${f(mid.x)} ${f(mid.y)})`} />
            </g>
          );
        })}
      </g>

      {/* Major Ring: braided wisteria wreath with midpoint leaves & miniature blossom buds */}
      <g className="hm-ring-major">
        <circle className="hm-track is-strong" cx={MID} cy={MID} r={rMajor} />
        <circle className="hm-track hm-track--filigree" cx={MID} cy={MID} r={rMajor - 4.6} />
        <circle className="hm-track hm-track--filigree" cx={MID} cy={MID} r={rMajor + 4.6} />
        <path className="hm-vine-braid" d={vineRingPath(MID, MID, rMajor, 24, 4, 7.5)} />
        {halfSpokes.map((a) => {
          const p = polarPoint(MID, MID, rMajor, a);
          return (
            <g key={a} transform={`translate(${f(p.x)} ${f(p.y)}) rotate(${a})`}>
              <path className="hm-wreath-leaf" d={leafPath(8.6, 2.5)} transform="rotate(-142)" />
              <path className="hm-wreath-leaf" d={leafPath(8.6, 2.5)} transform="rotate(-38)" />
              <circle className="hm-wreath-bud" cy={-3.6} r={1.65} />
              <circle className="hm-filigree-pearl" r={1.5} />
            </g>
          );
        })}
      </g>

      {/* Minor Ring: beaded floral filigree */}
      <g className="hm-ring-minor">
        <circle className="hm-track" cx={MID} cy={MID} r={rMinor} />
        <circle className="hm-track hm-track--hairline" cx={MID} cy={MID} r={rMinor - 3.6} />
        <circle className="hm-track hm-track--hairline" cx={MID} cy={MID} r={rMinor + 3.6} />
        <path className="hm-vine-braid is-delicate" d={vineRingPath(MID, MID, rMinor, 12, 2.8, 15)} />
        {halfSpokes.map((a) => {
          const p = polarPoint(MID, MID, rMinor, a);
          return (
            <g key={a} transform={`translate(${f(p.x)} ${f(p.y)}) rotate(${a})`}>
              <path className="hm-wreath-leaf is-tiny" d={leafPath(5.4, 1.6)} transform="rotate(38)" />
              <path className="hm-wreath-leaf is-tiny" d={leafPath(5.4, 1.6)} transform="rotate(142)" />
              <circle className="hm-filigree-pearl is-dim" r={1.3} />
            </g>
          );
        })}
      </g>

      {/* Inner Petal Mandala: 12-petal scalloped rosette cradling the 6 discipline petals */}
      <g className="hm-ring-inner" transform={`translate(${f(MID)} ${f(MID)})`}>
        <circle className="hm-track hm-track--inner" r={rPetals} />
        <path className="hm-rosette-arch" d={scallopPath(rPetals - 3.5, rPetals + 10.5, 12, 15)} />
        <path className="hm-rosette-calyx" d={calyxPath(rPetals + 2, rPetals + 14.5, 6, 9, 0)} />
        <path className="hm-rosette-lace" d={scallopPath(46, 55, 12, 0)} />
        {petalAngles.map((a) => {
          const inner = polarPoint(0, 0, 41, a);
          const outer = polarPoint(0, 0, rPetals - 6, a);
          const ctrl = polarPoint(0, 0, 53, a + 6);
          return <path key={a} className="hm-petal-stem" d={`M ${f(inner.x)} ${f(inner.y)} Q ${f(ctrl.x)} ${f(ctrl.y)} ${f(outer.x)} ${f(outer.y)}`} />;
        })}
      </g>
    </g>
  );
}

/** Center core medallion: 12-petal wisteria rose-window & gilded calyx bezel. */
export function CoreMedallion({ kind, targeted }: { kind: string; targeted: boolean }) {
  const petalAngles = [30, 90, 150, 210, 270, 330];
  const crownAngles = Array.from({ length: 12 }, (_, i) => i * 30);
  return (
    <g className={`hm-scion-svg is-${kind} ${targeted ? "is-targeted" : ""}`}>
      <circle className="hm-scion-aura" r={66} fill={kind === "custom-mix" ? "url(#hm-kin-glow)" : "url(#hm-wisteria-glow)"} />
      {/* Breathing outer floral halo */}
      <path className="hm-scion-pulse" d={scallopPath(43.5, 48.2, 12, 15)} />
      {/* 6 slender wisteria leaves pointing toward the 6 discipline petals */}
      {petalAngles.map((a) => (
        <path key={a} className="hm-scion-leaf" d={leafPath(10, 3)} transform={`rotate(${a - 90}) translate(40 0)`} />
      ))}
      {/* Sculpted 12-petal scalloped floral bezel */}
      <path className="hm-scion-crest" d={scallopPath(37.4, 43.8, 12, 0)} />
      <path className="hm-scion-calyx" d={calyxPath(37.8, 45.2, 12, 6, 15)} />
      {/* 12 dewdrop pearls at petal peaks */}
      {crownAngles.map((a) => {
        const p = polarPoint(0, 0, 42.4, a + 15);
        return <circle key={a} className="hm-scion-pearl" cx={p.x} cy={p.y} r={1.4} />;
      })}
      {/* Main botanical enamel ring & engraved inner rosette */}
      <circle className="hm-scion-ring" r={37.5} />
      <circle className="hm-scion-bezel" r={34.4} />
      <path className="hm-scion-rosette" d={scallopPath(28.5, 32.8, 12, 15)} />
      <circle className="hm-scion-inner" r={29.5} />
    </g>
  );
}

/** Key hub medallion: ornate floral filigree bezel for major (8-lobed) and minor (6-lobed) keys. */
export function HubMedallion({
  size,
  minor,
  outward,
  fill,
  label,
  selected,
  focus,
  kin,
  session,
  rhythmTier,
}: {
  size: number;
  minor: boolean;
  outward: number;
  fill: number;
  label: string;
  selected: boolean;
  focus: boolean;
  kin: boolean;
  session: boolean;
  rhythmTier?: string;
}) {
  const lobes = minor ? 6 : 8;
  const crownDir = minor ? outward + 180 : outward;
  const advanced = fill >= 0.78 || rhythmTier === "triplets" || rhythmTier === "sixteenths";
  return (
    <>
      {selected || focus || fill > 0.2 ? (
        <circle className="hm-hub-glow" r={size + (selected ? 21 : 14)} fill="url(#hm-bloom)" />
      ) : kin ? (
        <circle className="hm-hub-glow" r={size + 14} fill="url(#hm-kin-glow)" />
      ) : null}
      {selected || session ? <path className="hm-hub-pulse" d={scallopPath(size + 5.4, size + 8, lobes, 0)} /> : null}
      {/* Ornate outer scalloped bezel rotated outward (inward for minors) */}
      <g className="hm-hub-ornament" transform={`rotate(${f(crownDir)})`}>
        <path className="hm-hub-filigree" d={scallopPath(size + 1.3, size + (minor ? 3.5 : 4.5), lobes, minor ? 30 : 22.5)} />
        {/* Paired wisteria calyx leaves cradling the direction the branch grows */}
        <path className="hm-hub-leaf" d={leafPath(minor ? 6.2 : 8.2, minor ? 1.9 : 2.5)} transform={`translate(0 ${f(-(size + 1.4))}) rotate(-132)`} />
        <path className="hm-hub-leaf" d={leafPath(minor ? 6.2 : 8.2, minor ? 1.9 : 2.5)} transform={`translate(0 ${f(-(size + 1.4))}) rotate(-48)`} />
        {!minor ? (
          <>
            <circle className="hm-hub-stud" cx={0} cy={size + 3.4} r={1.35} />
            <circle className="hm-hub-stud" cx={size + 3.4} cy={0} r={1.25} />
            <circle className="hm-hub-stud" cx={-(size + 3.4)} cy={0} r={1.25} />
          </>
        ) : (
          <circle className="hm-hub-stud" cx={0} cy={size + 2.7} r={1.15} />
        )}
        {/* Tiny wisteria blossom jewel when mastered or rhythm-advanced */}
        {advanced ? (
          <g className="hm-hub-crown" transform={`translate(0 ${f(-(size + (minor ? 4.6 : 5.6)))})`}>
            <circle r={minor ? 1.8 : 2.2} />
          </g>
        ) : null}
      </g>
      {/* Enamel medallion base, luminous fill, inner hairline rim, and progress arc */}
      <circle className="hm-hub-enamel" r={size} />
      <circle className="hm-dot" r={size} style={{ fillOpacity: 0.09 + 0.42 * fill }} />
      <circle className="hm-hub-inner" r={size - (minor ? 2.2 : 2.8)} />
      {fill > 0 ? <circle className="hm-arc" r={size} pathLength={1} strokeDasharray={`${fill.toFixed(3)} 1`} transform="rotate(-90)" /> : null}
      <text dy="0.36em">{label}</text>
    </>
  );
}

/** Skill node: a wisteria bud that unfolds into a 5-petal blossom as it grows. */
export function SkillBlossom({
  r,
  outward,
  fill,
  growing,
  mastered,
  focus,
  isHover,
}: {
  r: number;
  outward: number;
  fill: number;
  growing: boolean;
  mastered: boolean;
  focus: boolean;
  isHover: boolean;
}) {
  return (
    <>
      {mastered || isHover ? <circle className="hm-skill-halo" r={r + 6.5} fill="url(#hm-wisteria-glow)" /> : null}
      {mastered ? (
        /* Full 5-petal luminous wisteria blossom */
        <g className="hm-skill-bloom" transform={`rotate(${f(outward)})`}>
          <path className="hm-skill-petals" d={scallopPath(r * 0.58, r * 1.52, 5, 0)} />
          <circle className="hm-dot" r={r * 0.88} style={{ fillOpacity: 0.92 }} />
          <circle className="hm-spore-core" r={1.9} />
        </g>
      ) : growing ? (
        /* Unfurling 4-petal bud */
        <g className="hm-skill-bud" transform={`rotate(${f(outward)})`}>
          <path className="hm-skill-petals is-soft" d={scallopPath(r * 0.72, r * 1.36, 4, 45)} />
          <circle className="hm-dot" r={r} style={{ fillOpacity: 0.52 + 0.48 * fill }} />
          <circle className="hm-skill-pip" r={1.2} />
        </g>
      ) : (
        /* Closed botanical wisteria bud with delicate 4-petal filigree calyx & dewdrop heart */
        <g transform={`rotate(${f(outward)})`}>
          <path className="hm-skill-calyx" d={scallopPath(r + 0.5, r + 2, 4, 0)} />
          <circle className="hm-dot" r={r} style={{ fillOpacity: fill > 0 ? 0.5 : focus ? 0.34 : 0.16 }} />
          <circle className="hm-skill-seed" r={1.05} />
        </g>
      )}
    </>
  );
}

/** Foundation (notable) medallion: ornate botanical cameo with jeweled tempo gauge. */
export function NotableFrame({
  s,
  share,
  fill,
  mastered,
  active,
  arcPath,
}: {
  s: number;
  share: number;
  fill: number;
  mastered: boolean;
  active: boolean;
  arcPath: (r: number, from: number, to: number) => string;
}) {
  const g = s + 4.8;
  const endL = polarPoint(0, 0, g, -135);
  const endR = polarPoint(0, 0, g, 135);
  return (
    <>
      <circle className="hm-f-aura" r={s + 17} />
      {active ? <path className="hm-f-halo" d={scallopPath(s + 8.2, s + 10.8, 8, 22.5)} /> : null}
      {/* Ornate scalloped outer crest + 4 cardinal leaf-studs */}
      <path className="hm-f-filigree" d={scallopPath(s + 1.2, s + 3.4, 8, 22.5)} />
      {[0, 90, 180, 270].map((a) => {
        const p = polarPoint(0, 0, s + 2.8, a);
        return <circle key={a} className="hm-f-stud" cx={p.x} cy={p.y} r={1.2} />;
      })}
      {/* Twin gilded calyx crown when mastered */}
      {mastered ? (
        <g className="hm-f-crown" transform={`translate(0 ${f(-(s + 2.6))})`}>
          <path d={leafPath(6.8, 2.1)} transform="rotate(-144)" />
          <path d={leafPath(6.8, 2.1)} transform="rotate(-36)" />
        </g>
      ) : null}
      {/* Horological-botanical tempo arc with pearl end-caps */}
      <path className="hm-f-track" d={arcPath(g, -135, 135)} />
      {share > 0 ? <path className="hm-f-gauge" d={arcPath(g, -135, -135 + 270 * share)} /> : null}
      <circle className="hm-f-cap" cx={endL.x} cy={endL.y} r={1.15} />
      <circle className="hm-f-cap" cx={endR.x} cy={endR.y} r={1.15} />
      {/* Enamel disc & glowing inner botanical heart */}
      <circle className="hm-f-disc" r={s} />
      <circle className="hm-f-inner" r={s - 2.3} />
      <circle className="hm-f-fill" r={s - 1.8} style={{ fillOpacity: 0.1 + 0.52 * fill }} />
    </>
  );
}

/** Grand Keystone medallion: Art-Nouveau wisteria arch crest with hanging blossom shoulders. */
export function KeystoneFrame({ s, fill, label }: { s: number; fill: number; label: string }) {
  const cardinals = [0, 90, 180, 270];
  const diagonals = [45, 135, 225, 315];
  return (
    <>
      <circle className="hm-k-aura" r={s + 30} />
      {/* Outer 12-petal ornate botanical wreath */}
      <path className="hm-k-wreath" d={scallopPath(s + 10.2, s + 14.4, 12, 15)} />
      <path className="hm-k-halo" d={scallopPath(s + 12.2, s + 16.6, 12, 0)} />
      {/* Crown twin wisteria leaves at north pole */}
      <g className="hm-k-crown" transform={`translate(0 ${f(-(s + 11.4))})`}>
        <path d={leafPath(10.8, 3.2)} transform="rotate(-148)" />
        <path d={leafPath(10.8, 3.2)} transform="rotate(-32)" />
        <path d={leafPath(7.6, 2.3)} transform="rotate(-90)" />
      </g>
      {/* Miniature drooping wisteria blossom clusters tucked on lower shoulders */}
      {([-1, 1] as const).map((dir) => (
        <g key={dir} className="hm-k-cluster" transform={`translate(${f(dir * (s + 9.4))} ${f(s * 0.36)})`}>
          <ellipse cx={0} cy={0} rx={2.6} ry={3.4} transform={`rotate(${dir * -14})`} />
          <ellipse cx={dir * 2.1} cy={4.7} rx={2.2} ry={3} transform={`rotate(${dir * 12})`} />
          <ellipse cx={dir * -0.4} cy={8.8} rx={1.75} ry={2.4} />
          <circle cx={dir * 0.3} cy={12.6} r={1.15} />
        </g>
      ))}
      {/* Progress gauge track & luminous fill arc */}
      <circle className="hm-k-track" r={s + 7.2} />
      {fill > 0 ? <circle className="hm-k-gauge" r={s + 7.2} pathLength={1} strokeDasharray={`${fill.toFixed(3)} 1`} transform="rotate(-90)" /> : null}
      {/* Sculpted brass-lilac bezel with cardinal leaf-finials & diagonal pearls */}
      <path className="hm-k-filigree" d={scallopPath(s + 2.2, s + 4.9, 8, 22.5)} />
      <circle className="hm-k-frame" r={s + 2.6} />
      {cardinals.map((a) => (
        <path
          key={a}
          className="hm-k-finial"
          d="M 0 -5.8 Q 2.9 -2 0 1.5 Q -2.9 -2 0 -5.8 Z"
          transform={`rotate(${a}) translate(0 ${f(-(s + 3.2))})`}
        />
      ))}
      {diagonals.map((a) => {
        const p = polarPoint(0, 0, s + 4.2, a);
        return <circle key={a} className="hm-k-stud" cx={p.x} cy={p.y} r={1.65} />;
      })}
      {/* Deep enamel disc + inner engraved ring */}
      <circle className="hm-k-disc" r={s} />
      <circle className="hm-k-inner" r={s - 3} />
      <circle className="hm-k-fill" r={s - 2.6} style={{ fillOpacity: 0.08 + 0.42 * fill }} />
      {/* Label */}
      <g className="hm-k-ribbon" transform={`translate(0 ${f(s + 23.5)})`}>
        <text className="hm-k-name" y={0}>{label}</text>
      </g>
    </>
  );
}

/** Travel stepping-stone node along the keystone path: tiny 4-petal botanical diamond bead. */
export function TravelBead({ size }: { size: number }) {
  return (
    <>
      <path className="hm-t-calyx" d={scallopPath(size + 0.6, size + 2.6, 4, 45)} />
      <circle className="hm-t-dot" r={size} />
    </>
  );
}

/** Ornate SVG floral locket ring behind each orbiting discipline icon-petal. */
export function PetalCradle({ outward, active }: { outward: number; active: boolean }) {
  return (
    <g className={`hm-petal-cradle ${active ? "is-on" : ""}`} transform={`rotate(${f(outward)})`}>
      <path className="hm-petal-bezel" d={scallopPath(11.4, 14.2, 6, 30)} />
      <circle className="hm-petal-enamel" r={11.4} />
      <circle className="hm-petal-inner" r={9.2} />
      <path className="hm-petal-leaf" d={leafPath(6.2, 1.9)} transform="translate(0 -11.4) rotate(-135)" />
      <path className="hm-petal-leaf" d={leafPath(6.2, 1.9)} transform="translate(0 -11.4) rotate(-45)" />
      <circle className="hm-petal-pip" cy={-14.2} r={1.25} />
    </g>
  );
}

/** Ornate SVG botanical wisteria medallion drawn directly behind each Song node on the rim. */
export function SongMedallion({
  fill,
  outward,
  inSession,
  isLead,
  isSelected,
  isTargeted,
}: {
  fill: number;
  outward: number;
  inSession: boolean;
  isLead: boolean;
  isSelected: boolean;
  isTargeted: boolean;
}) {
  const r = 13.5 + 7.5 * fill;
  const flags = `${inSession ? "is-session" : ""} ${isLead ? "is-lead" : ""} ${isSelected ? "is-selected" : ""} ${isTargeted ? "is-targeted" : ""}`;
  return (
    <g className={`hm-song-svg ${flags}`}>
      {inSession || isSelected || isTargeted ? (
        <circle className="hm-song-aura" r={r + 14} fill={isLead ? "url(#hm-kin-glow)" : "url(#hm-wisteria-glow)"} />
      ) : null}
      {/* Breathing golden-lilac floral wreath for the lead song */}
      {isLead ? <path className="hm-song-lead-wreath" d={scallopPath(r + 5.6, r + 8.8, 10, 0)} /> : null}
      {/* Ornate 8-petal floral filigree bezel + outward paired wisteria leaves & tiny bud */}
      <g transform={`rotate(${f(outward)})`}>
        <path className="hm-song-filigree" d={scallopPath(r + 1.2, r + 4.1, 8, 22.5)} />
        <path className="hm-song-leaf" d={leafPath(8.6, 2.5)} transform={`translate(0 ${f(-(r + 1.6))}) rotate(-136)`} />
        <path className="hm-song-leaf" d={leafPath(8.6, 2.5)} transform={`translate(0 ${f(-(r + 1.6))}) rotate(-44)`} />
        {/* Tiny 3-drop wisteria blossom finial at the outer crest */}
        <circle className="hm-song-bud" cx={0} cy={-(r + 4.6)} r={1.8} />
        <circle className="hm-song-bud is-soft" cx={-2.3} cy={-(r + 2.9)} r={1.2} />
        <circle className="hm-song-bud is-soft" cx={2.3} cy={-(r + 2.9)} r={1.2} />
      </g>
      {/* Enamel disc, inner ring, luminous blossom core, and circular progress arc */}
      <circle className="hm-song-enamel" r={r} />
      <circle className="hm-song-inner" r={r - 2.4} />
      <circle className="hm-song-core" r={Math.max(4, r * (0.34 + 0.44 * fill))} style={{ fillOpacity: 0.48 + 0.52 * fill }} />
      <circle className="hm-song-core-glint" cx={-r * 0.14} cy={-r * 0.16} r={Math.max(1.4, r * 0.15)} />
      {fill > 0 ? <circle className="hm-song-arc" r={r} pathLength={1} strokeDasharray={`${fill.toFixed(3)} 1`} transform="rotate(-90)" /> : null}
    </g>
  );
}
