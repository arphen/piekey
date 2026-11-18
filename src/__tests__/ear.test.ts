import { describe, expect, it } from "vitest";
import {
  CHORDS,
  FAMOUS,
  TRACKS,
  chordName,
  contrastTip,
  famousChoices,
  famousPool,
  generateProgression,
  makeRng,
  readyToAdvance,
  updateMastery,
  vocabulary,
  voiceProgression,
  type TrackId,
} from "../ear/theory";
import { buildEvents } from "../ear/engine";

describe("ear theory", () => {
  it("every stage chord and famous numeral exists", () => {
    for (const t of Object.values(TRACKS)) for (const s of t.stages) for (const id of s.add) expect(CHORDS[id], id).toBeDefined();
    for (const f of FAMOUS) for (const id of f.numerals) expect(CHORDS[id], `${f.id}:${id}`).toBeDefined();
  });

  it("spells chords in key", () => {
    expect(chordName("vi", 0)).toBe("Am");
    expect(chordName("bVII", 7)).toBe("F");
    expect(chordName("V7", 3)).toBe("Bb7");
    expect(chordName("viiø7", 10)).toBe("Am7b5");
    expect(chordName("ii7", 7)).toBe("Am7");
  });

  for (const track of ["pop", "jazz"] as TrackId[]) {
    it(`${track}: progressions stay in vocabulary, anchored ones start home`, () => {
      const rng = makeRng(7);
      TRACKS[track].stages.forEach((_, stage) => {
        const vocab = vocabulary(track, stage);
        for (let n = 0; n < 40; n++) {
          const anchorStart = stage < 2;
          const p = generateProgression({ track, vocab, length: 4, mastery: {}, anchorStart, rng });
          expect(p).toHaveLength(4);
          for (const id of p) expect(vocab).toContain(id);
          for (let i = 1; i < p.length; i++) expect(p[i]).not.toBe(p[i - 1]);
          if (anchorStart) expect(p[0]).toBe(track === "pop" ? "I" : "Imaj7");
        }
      });
    });
  }

  it("jazz grammar favours falling fifths", () => {
    const rng = makeRng(3);
    let fifths = 0;
    let moves = 0;
    for (let n = 0; n < 200; n++) {
      const p = generateProgression({ track: "jazz", vocab: vocabulary("jazz", 3), length: 4, mastery: {}, anchorStart: false, rng });
      for (let i = 1; i < p.length; i++) {
        moves++;
        if ((CHORDS[p[i]].degree - CHORDS[p[i - 1]].degree + 12) % 12 === 5) fifths++;
      }
    }
    expect(fifths / moves).toBeGreaterThan(0.45);
  });

  it("weak chords appear more often", () => {
    const count = (mastery: Parameters<typeof generateProgression>[0]["mastery"]) => {
      const rng = makeRng(11);
      let n = 0;
      for (let k = 0; k < 300; k++)
        n += generateProgression({ track: "pop", vocab: vocabulary("pop", 2), length: 4, mastery, anchorStart: false, rng }).filter((id) => id === "ii").length;
      return n;
    };
    const strong = { I: { score: 0.95, attempts: 30 }, IV: { score: 0.95, attempts: 30 }, V: { score: 0.95, attempts: 30 }, vi: { score: 0.95, attempts: 30 } };
    expect(count({ ...strong, ii: { score: 0.2, attempts: 30 } })).toBeGreaterThan(count({ ...strong, ii: { score: 0.95, attempts: 30 } }));
  });

  it("voice leading keeps upper voices close and in range", () => {
    const v = voiceProgression(["I", "IV", "V", "I"], 0);
    for (const x of v) {
      expect(x.upper).toHaveLength(3);
      expect(Math.min(...x.upper)).toBeGreaterThanOrEqual(52);
      expect(Math.max(...x.upper)).toBeLessThanOrEqual(76);
      expect(x.bass).toBeGreaterThanOrEqual(36);
      expect(x.bass).toBeLessThanOrEqual(50);
    }
    for (let i = 1; i < v.length; i++) {
      const move = v[i].upper.reduce((a, m, k) => a + Math.abs(m - v[i - 1].upper[k]), 0);
      expect(move).toBeLessThanOrEqual(6);
    }
  });

  it("events lay phrases end to end with slots", () => {
    const ev = buildEvents([{ ids: ["I", "IV", "V", "I"], slotBase: -1, len: 0.5, gap: 1 }, { ids: ["I", "vi"], slotBase: 0 }], 0, 1);
    expect(ev.map((e) => e.slot)).toEqual([-1, -1, -1, -1, 0, 1]);
    expect(ev[4].at).toBeCloseTo(3);
  });

  it("mastery converges and gates advancement", () => {
    let m = updateMastery(undefined, true);
    for (let i = 0; i < 10; i++) m = updateMastery(m, true);
    expect(m.score).toBeGreaterThan(0.9);
    const vocab = ["I", "IV", "V"];
    const mastery = Object.fromEntries(vocab.map((id) => [id, m]));
    expect(readyToAdvance(Array(10).fill(1), vocab, mastery)).toBe(true);
    expect(readyToAdvance(Array(9).fill(1), vocab, mastery)).toBe(false);
    expect(readyToAdvance(Array(10).fill(0.7), vocab, mastery)).toBe(false);
  });

  it("contrast tips mention bass or colour", () => {
    expect(contrastTip("ii", "IV")).toMatch(/bass/);
    expect(contrastTip("IV", "iv")).toMatch(/Same bass/);
  });

  it("famous choices include the answer without duplicates", () => {
    const pool = famousPool("pop", 7);
    const rng = makeRng(5);
    for (const f of pool) {
      const ch = famousChoices(f, pool, 4, rng);
      expect(ch).toHaveLength(4);
      expect(ch.map((c) => c.id)).toContain(f.id);
      expect(new Set(ch.map((c) => c.id)).size).toBe(4);
    }
  });
});

describe("your music", async () => {
  const { MY_SONGS, matchFamous, songsFor } = await import("../ear/library");
  it("every song maps to a known progression with valid numerals", () => {
    for (const s of MY_SONGS) {
      const f = FAMOUS.find((x) => x.id === s.progression);
      expect(f, s.title).toBeDefined();
      expect(s.keyPc).toBeGreaterThanOrEqual(0);
      expect(s.keyPc).toBeLessThan(12);
    }
    expect(new Set(MY_SONGS.map((s) => s.spotify)).size).toBe(MY_SONGS.length);
  });
  it("matches generated progressions, preferring ones with your songs", () => {
    expect(matchFamous(["vi", "IV", "I", "V"])?.famous.id).toBe("sensitive");
    expect(matchFamous(["I", "V", "vi", "IV"])?.rotated).toBe(false);
    expect(matchFamous(["IV", "I", "vi", "V"])?.famous.id).toBe("fastcar");
    expect(matchFamous(["I", "ii", "V", "I"])).toBeNull();
    expect(songsFor("sensitive").length).toBeGreaterThanOrEqual(3);
  });
});
