import { Midi } from "@tonejs/midi";
import type { Tune } from "../core/contract";
import { generateBacking } from "./backing";

export function exportBackingMidi(tune: Tune, loop: { start: number; end: number }, bpm: number, swing = 0.6): Blob {
  const midi = new Midi();
  midi.header.setTempo(bpm);
  const ppq = midi.header.ppq;
  const bass = midi.addTrack();
  bass.name = "Bass";
  const comp = midi.addTrack();
  comp.name = "Comp";
  const drums = midi.addTrack();
  drums.name = "Drums";
  drums.channel = 9;
  const drumNote = { ride: 51, hat: 44, kick: 36 } as const;
  for (const ev of generateBacking(tune, loop)) {
    const beat = ev.beat + (ev.off ? swing / 6 : 0);
    const ticks = Math.round(beat * ppq);
    const durationTicks = Math.max(1, Math.round(ev.durBeats * ppq));
    const velocity = ev.vel;
    if (ev.kind === "bass") bass.addNote({ midi: ev.midis[0], ticks, durationTicks, velocity });
    else if (ev.kind === "comp") for (const m of ev.midis) comp.addNote({ midi: m, ticks, durationTicks, velocity });
    else drums.addNote({ midi: drumNote[ev.kind], ticks, durationTicks, velocity });
  }
  return new Blob([midi.toArray() as BlobPart], { type: "audio/midi" });
}
