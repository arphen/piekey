import * as Tone from "tone";
import { watchOutputs } from "./output";

// One shared audio context for the player, legend demos and ear trainer.
// - latencyHint "playback": bigger audio buffers. Nothing here needs low output latency,
//   and small buffers crackle (underruns) as soon as the machine is busy.
// - master compressor + limiter: backing, plucks and demos all sum into one output;
//   without a ceiling the peaks clip, which is heard as distortion.
// - the output device the player chose (see output.ts) is applied here and kept as devices
//   come and go.

let ready = false;

export function ensureAudio(): void {
  if (ready) return;
  ready = true;
  try {
    Tone.setContext(new Tone.Context({ latencyHint: "playback", lookAhead: 0.2 }));
    const dest = Tone.getDestination();
    dest.volume.value = -3;
    dest.chain(new Tone.Compressor({ threshold: -16, ratio: 2.5, attack: 0.012, release: 0.18 }), new Tone.Limiter(-1));
    watchOutputs();
  } catch {
    /* no Web Audio (tests) */
  }
}
