import { useState, useSyncExternalStore } from "react";
import { getPendingTakes, getRecordingSaves, retryPendingTakes, subscribeRecordingSaves, type StoredTake } from "../audio/recorder";
import type { InputApi } from "../listen/useInput";
import { ToneTag, useToneKeys } from "./GuitarPad";

const LABEL = {
  saving: "Saving recording…",
  saved: "Recording saved on this device",
  pending: "Recording unsaved · retry or download in Settings",
  unavailable: "Audio recording unavailable · practice result kept separately",
};

export function RecordingStatus({ ids }: { ids: string[] }) {
  const saves = useSyncExternalStore(subscribeRecordingSaves, getRecordingSaves, getRecordingSaves);
  const states = ids.map((id) => saves.get(id)).filter((state) => state !== undefined);
  if (!states.length) return null;
  const state = states.includes("pending") ? "pending" : states.includes("saving") ? "saving" : states.includes("unavailable") ? "unavailable" : "saved";
  return <p className={`recording-status is-${state}`} role="status">{LABEL[state]}</p>;
}

export function downloadTake(take: StoredTake): void {
  const url = URL.createObjectURL(take.blob);
  const link = document.createElement("a");
  link.href = url;
  const extension = take.blob.type.includes("mp4") ? "m4a" : take.blob.type.includes("ogg") ? "ogg" : take.blob.type.includes("wav") ? "wav" : "webm";
  link.download = `guitar-${take.day}-${take.id}.${extension}`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Recovery stays available after leaving the session, with played controls in its settings. */
export function RecordingRecovery({ input, tones }: { input?: InputApi; tones?: number[] }) {
  const takes = useSyncExternalStore(subscribeRecordingSaves, getPendingTakes, getPendingTakes);
  const [selected, setSelected] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const at = Math.min(selected, Math.max(0, takes.length - 1));
  const retry = () => {
    if (retrying) return;
    setRetrying(true);
    void retryPendingTakes().finally(() => setRetrying(false));
  };
  const next = () => setSelected((value) => (value + 1) % Math.max(1, takes.length));
  const download = () => { if (takes[at]) downloadTake(takes[at]); };
  if (!takes.length) return null;
  return (
    <div className="recording-recovery">
      {input && tones ? <PlayedRecovery input={input} tones={tones} retry={retry} next={next} download={download} /> : null}
      <p>{takes.length} recording{takes.length === 1 ? "" : "s"} waiting for storage. Keep this page open.</p>
      <button type="button" onClick={retry} disabled={retrying}>{retrying ? "Retrying…" : "Retry recordings"}{tones?.[0] !== undefined ? <ToneTag pc={tones[0]} lit={false} /> : null}</button>
      {takes.length > 1 ? <button type="button" onClick={next}>Recording {at + 1} of {takes.length}{tones?.[1] !== undefined ? <ToneTag pc={tones[1]} lit={false} /> : null}</button> : null}
      <button type="button" onClick={download}>Download audio · {takes[at].day} · ♩ {takes[at].bpm}{tones?.[2] !== undefined ? <ToneTag pc={tones[2]} lit={false} /> : null}</button>
    </div>
  );
}

function PlayedRecovery({ input, tones, retry, next, download }: { input: InputApi; tones: number[]; retry(): void; next(): void; download(): void }) {
  useToneKeys(input, true, tones, (key) => [retry, next, download][key]?.());
  return null;
}
