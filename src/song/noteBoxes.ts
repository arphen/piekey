export interface NoteBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const NOTE_BOXES = new WeakMap<HTMLElement, () => readonly (NoteBox | null)[]>();

/** Register cached host-local notehead positions so overlays never force per-note layout reflows. */
export function registerNoteBoxes(host: HTMLElement, read: () => readonly (NoteBox | null)[]): void {
  NOTE_BOXES.set(host, read);
}

/** Read cached host-local notehead boxes if available. */
export function readNoteBoxes(host: HTMLElement | null): readonly (NoteBox | null)[] | null {
  return host ? NOTE_BOXES.get(host)?.() ?? null : null;
}
