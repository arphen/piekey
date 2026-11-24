// Exercise ids. Inside one tune an id is local ("mel:new:0-1", "sec:A#0:arps"). A session that
// mixes tunes names the exercises of every tune but the first with their tune in front
// ("<tune>::mel:new:0-1"), so they stay apart; each tune's box is still kept under its local ids.
// Scale exercises belong to the player, not to a tune: their ids are the same everywhere.

export const GLUE = "::";

/** Scale and foundational technique exercises are the same skill whatever tune asks for them. */
export const isShared = (id: string) => id.startsWith("scale:") || id.startsWith("tech:");

export const glue = (tuneId: string, id: string) => (isShared(id) ? id : `${tuneId}${GLUE}${id}`);

/** The id inside its own tune. */
export const localId = (id: string) => {
  const i = id.indexOf(GLUE);
  return i < 0 ? id : id.slice(i + GLUE.length);
};

/** The tune an id names, or null for an exercise of the session's own tune (or a shared one). */
export const tuneOf = (id: string): string | null => {
  const i = id.indexOf(GLUE);
  return i < 0 ? null : id.slice(0, i);
};
