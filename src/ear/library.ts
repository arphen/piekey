import { FAMOUS, type Famous } from "./theory";

/**
 * Songs from the user's own Spotify playlists ("Guitar" and "Liked Songs"), mapped to the
 * named progression they're built on. Only songs whose changes are well documented are mapped;
 * `keyPc` is the key they're usually played in (major-key tonic, or minor tonic for minor progressions).
 */

export interface MySong {
  title: string;
  artist: string;
  spotify: string;
  progression: string;
  /** where in the song you hear it */
  part: string;
  keyPc: number;
  /** on the user's Guitar playlist (they play it, not just listen) */
  guitar?: boolean;
}

export const MY_SONGS: MySong[] = [
  { title: "Zombie", artist: "The Cranberries", spotify: "7EZC6E7UjZe63f1jRmkWxt", progression: "sensitive", part: "whole song (Em–C–G–D)", keyPc: 7 },
  { title: "Africa", artist: "TOTO", spotify: "6c7AFG4njoFRDp9hjpM2OZ", progression: "sensitive", part: "chorus", keyPc: 9 },
  { title: "Otherside", artist: "Red Hot Chili Peppers", spotify: "64BbK9SFKH2jk86U3dGj2P", progression: "sensitive", part: "verse (Am–F–C–G)", keyPc: 0 },
  { title: "In the End", artist: "Linkin Park", spotify: "50LmbBKCBeDRKYvpR7ApjG", progression: "sensitive", part: "piano loop", keyPc: 6 },
  { title: "Fast Car", artist: "Tracy Chapman", spotify: "2M9ro2krNb7nr7HSprkEgo", progression: "fastcar", part: "the riff", keyPc: 9 },
  { title: "Hallelujah", artist: "Jeff Buckley", spotify: "3pRaLNL3b8x5uBOcsgvdqM", progression: "hallelujah", part: "chorus progression", keyPc: 0 },
  { title: "What's Up?", artist: "4 Non Blondes", spotify: "0jWgAnTrNZmOGmqgvHhZEm", progression: "whatsup", part: "whole song (A–Bm–D–A)", keyPc: 9 },
  { title: "Mr. Jones", artist: "Counting Crows", spotify: "5DiXcVovI0FcY2s0icWWUu", progression: "mrjones", part: "verse (Am–F–Dm–G)", keyPc: 0, guitar: true },
  { title: "Good Riddance (Time of Your Life)", artist: "Green Day", spotify: "6ORqU0bHbVCRjXm9AjyHyZ", progression: "rock145", part: "verse (G–C–D)", keyPc: 7 },
  { title: "Sultans Of Swing", artist: "Dire Straits", spotify: "37Tmv4NnfQeb0ZgUC4fOJj", progression: "andalusian", part: "verse (Dm–C–Bb–A)", keyPc: 2 },
  { title: "Layla (Acoustic Live)", artist: "Eric Clapton", spotify: "0zxj7dVhYZq5ACyaDx5XIo", progression: "aeolian", part: "the riff (Dm–Bb–C–Dm)", keyPc: 2 },
  { title: "Hotel California", artist: "Eagles", spotify: "40riOy7x9W7GXjyGp4pjAv", progression: "hotel", part: "verse (Bm–F#–A–E–G–D–Em–F#)", keyPc: 11 },
  { title: "Dani California", artist: "Red Hot Chili Peppers", spotify: "10Nmj3JCNoMeBQ87uw5j8k", progression: "dani", part: "verse (Am–G–Dm–Am)", keyPc: 9 },
  { title: "Back To Black", artist: "Amy Winehouse", spotify: "1KU5EHSz04JhGg3rReGJ0N", progression: "backtoblack", part: "verse (Dm–Gm–Bb–A)", keyPc: 2 },
];

/** How many tracks were in the two playlists, for the "mapped x of y" note. */
export const LIBRARY_SIZE = 91;

export const spotifyUrl = (id: string) => `https://open.spotify.com/track/${id}`;

export function songsFor(progressionId: string): MySong[] {
  return MY_SONGS.filter((s) => s.progression === progressionId);
}

const rotations = (xs: string[]) => xs.map((_, i) => [...xs.slice(i), ...xs.slice(0, i)].join(" "));

/**
 * The named progression (that you own a song for, ideally) a generated progression is,
 * exactly or as a rotation of the same loop.
 */
export function matchFamous(ids: string[]): { famous: Famous; rotated: boolean } | null {
  const key = ids.join(" ");
  const candidates = FAMOUS.filter((f) => f.mode === "major" && f.numerals.length === ids.length);
  const ranked = [...candidates].sort((a, b) => songsFor(b.id).length - songsFor(a.id).length);
  for (const f of ranked) if (f.numerals.join(" ") === key) return { famous: f, rotated: false };
  for (const f of ranked) if (new Set(f.numerals).size === f.numerals.length && rotations(f.numerals).includes(key)) return { famous: f, rotated: true };
  return null;
}
