// Polyphonic note picking for strummed chords from a clean DI signal.
// Spectrum peaks are taken low to high; a peak sitting on a whole-number multiple of an
// already accepted note is that note's overtone, the rest are notes. Good enough for
// 3–4 note jazz voicings, where no played note lands on another's overtone.

export interface HeardNote {
  midi: number; // fractional
  pc: number;
  db: number;
}

const MIN_HZ = 70;
const MAX_HZ = 1150;
const RANGE_DB = 30; // peaks this far under the loudest are ignored
const FLOOR_DB = 14; // and they must clear the median spectrum level by this much
const HARMONIC_CENTS = 50;
const MAX_HARMONIC = 10;

const windows = new Map<number, Float32Array>();
const scratch = new Map<number, { re: Float32Array; im: Float32Array }>();
function hann(n: number): Float32Array {
  let w = windows.get(n);
  if (!w) {
    w = new Float32Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    windows.set(n, w);
  }
  return w;
}

/** In-place radix-2 FFT; length must be a power of two. */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Magnitude spectrum in dB of a Hann-windowed buffer (length a power of two). */
export function spectrumDb(buf: Float32Array, out?: Float32Array): Float32Array {
  const n = buf.length;
  const w = hann(n);
  let s = scratch.get(n);
  if (!s) {
    s = { re: new Float32Array(n), im: new Float32Array(n) };
    scratch.set(n, s);
  }
  const { re, im } = s;
  for (let i = 0; i < n; i++) {
    re[i] = buf[i] * w[i];
    im[i] = 0;
  }
  fft(re, im);
  const db = out ?? new Float32Array(n / 2);
  for (let k = 0; k < n / 2; k++) db[k] = 10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-20);
  return db;
}

const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);

export function detectNotes(buf: Float32Array, sampleRate: number): HeardNote[] {
  const n = buf.length;
  const db = spectrumDb(buf);
  const binHz = sampleRate / n;
  const lo = Math.max(3, Math.floor(MIN_HZ / binHz));
  const hi = Math.min(db.length - 4, Math.ceil(MAX_HZ / binHz));
  if (hi <= lo) return [];

  const band = Array.from(db.subarray(lo, hi)).sort((a, b) => a - b);
  const median = band[band.length >> 1];
  let top = -Infinity;
  for (let k = lo; k < hi; k++) top = Math.max(top, db[k]);
  const threshold = Math.max(top - RANGE_DB, median + FLOOR_DB);

  const peaks: HeardNote[] = [];
  for (let k = lo; k < hi; k++) {
    const v = db[k];
    if (v < threshold) continue;
    let isMax = true;
    for (let d = -3; d <= 3 && isMax; d++) if (d !== 0 && db[k + d] > v) isMax = false;
    if (!isMax) continue;
    const a = db[k - 1];
    const c = db[k + 1];
    const den = a - 2 * v + c;
    const shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
    const midi = hzToMidi((k + shift) * binHz);
    peaks.push({ midi, pc: ((Math.round(midi) % 12) + 12) % 12, db: v });
  }

  const notes: HeardNote[] = [];
  for (const p of peaks) {
    const overtone = notes.some((f) => {
      const ratio = 2 ** ((p.midi - f.midi) / 12);
      const h = Math.round(ratio);
      if (h < 2 || h > MAX_HARMONIC) return false;
      return Math.abs(1200 * Math.log2(ratio / h)) <= HARMONIC_CENTS;
    });
    if (!overtone) notes.push(p);
  }
  return notes;
}

/** Pitch classes loud enough to count, given the notes of one frame. */
export function strongPitchClasses(notes: HeardNote[], rangeDb = 24): number[] {
  if (!notes.length) return [];
  const top = Math.max(...notes.map((n) => n.db));
  return [...new Set(notes.filter((n) => n.db >= top - rangeDb).map((n) => n.pc))];
}
