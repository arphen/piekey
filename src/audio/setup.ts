/** The hardware actually opened, rather than the preferred device that may currently be absent. */
export interface InputSetup {
  deviceId: string;
  sampleRate: number;
}

export interface AudioSetup extends InputSetup {
  outputId: string;
}

let input: InputSetup | null = null;
let outputId = "";

export const currentInputSetup = (): InputSetup | null => input;
export const currentAudioSetup = (): AudioSetup | null => input ? { ...input, outputId } : null;
export const setInputSetup = (next: InputSetup | null): void => { input = next; };
export const setOutputSetup = (next: string): void => { outputId = next; };
export const sameInputSetup = (a: InputSetup | undefined, b: InputSetup | null): boolean =>
  Boolean(a && b && a.deviceId === b.deviceId && a.sampleRate === b.sampleRate);
export const sameAudioSetup = (a: AudioSetup | undefined, b: AudioSetup | null): boolean =>
  sameInputSetup(a, b) && a?.outputId === b?.outputId;
