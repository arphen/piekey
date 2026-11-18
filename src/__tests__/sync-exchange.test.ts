import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTransferFile, exchangeState, importTransferFile, recordingHash } from "../sync/exchange";
import type { SyncSnapshot, SyncTransaction } from "../sync/model";
import type { StoredTake } from "../audio/recorder";
import type { SyncConnection } from "../sync/transport";

const persistence = vi.hoisted(() => ({ capture: vi.fn(), merge: vi.fn(), recordings: vi.fn(), exportable: vi.fn(), retry: vi.fn(), saveRecording: vi.fn() }));
vi.mock("../sync/state", () => ({ captureSnapshot: persistence.capture, mergeSnapshot: persistence.merge }));
vi.mock("../audio/recorder", () => ({ readAllTakes: persistence.recordings, readExportableTakes: persistence.exportable, retryPendingTakes: persistence.retry, storeTransferredTake: persistence.saveRecording }));

function transaction(seq: number): SyncTransaction {
  return { v: 1, id: `desktop:${seq}`, device: "desktop", seq, clock: seq, at: seq, context: {}, kind: "storage", key: "guitar-key", before: null, after: "C" };
}
function snapshot(transactions: SyncTransaction[] = []): SyncSnapshot {
  return { format: "fretboard-focus-sync", version: 1, device: "desktop", createdAt: "2026-11-18T00:00:00Z", transactions };
}
function take(id: string): StoredTake {
  return { id, tuneId: "tune", cardId: "card", day: "2026-11-18", at: 1, bpm: 80, share: 0.8,
    conditions: { v: 1, source: "measured", confidence: "unknown", tempo: "fixed", uninterrupted: true },
    arrangementFingerprint: "score-version-1", blob: new Blob([id], { type: "audio/webm" }) };
}
async function descriptor({ blob, ...meta }: StoredTake) {
  return { ...meta, size: blob.size, mime: blob.type, hash: await recordingHash(blob) };
}
function channel(messages: unknown[], initiator: boolean) {
  const sent: unknown[] = [];
  const blobs: Blob[] = [];
  const connection: SyncConnection = {
    initiator, remote: { deviceId: "remote", name: "Remote", peerId: "guitar-remote", secret: "unused" },
    closed: new Promise(() => {}), close() {},
    async sendJson(message) { sent.push(message); },
    async receiveJson() { if (!messages.length) throw new Error("Unexpected read"); return messages.shift(); },
    async sendBlob(blob) { blobs.push(blob); },
    async receiveBlob() { throw new Error("Unexpected audio read"); },
  };
  return { connection, sent, blobs };
}

beforeEach(() => {
  vi.clearAllMocks();
  persistence.capture.mockResolvedValue(snapshot());
  persistence.recordings.mockResolvedValue([]);
  persistence.exportable.mockImplementation(() => persistence.recordings());
  persistence.retry.mockResolvedValue(true);
  persistence.merge.mockResolvedValue({ received: 0, added: 0, changes: 0, conflicts: [], revision: 0 });
  persistence.saveRecording.mockResolvedValue(undefined);
});

describe("durable occasional exchanges", () => {
  it("rescues pending audio in a full file while refusing to advertise it as durable in pairing", async () => {
    const pending = take("unsaved");
    persistence.exportable.mockResolvedValue([pending]);
    persistence.retry.mockResolvedValue(false);
    const peer = channel([], true);
    await expect(exchangeState(peer.connection)).rejects.toThrow("still waiting to save");
    expect(peer.sent).toEqual([]);
    const file = await createTransferFile();
    await importTransferFile(file);
    expect(persistence.saveRecording).toHaveBeenCalledWith(expect.objectContaining({ id: pending.id, conditions: pending.conditions, arrangementFingerprint: pending.arrangementFingerprint }));
  });

  it("rejects an omitted advertised transaction before projecting or acknowledging it", async () => {
    const peer = channel([
      { kind: "inventory", version: 1, transactions: ["desktop:1"], recordings: [] },
      { kind: "changes", snapshot: snapshot(), recordings: [] },
    ], false);
    await expect(exchangeState(peer.connection)).rejects.toThrow("Some changes did not arrive");
    expect(persistence.merge).not.toHaveBeenCalled();
    expect(persistence.saveRecording).not.toHaveBeenCalled();
    expect(peer.sent).toEqual([expect.objectContaining({ kind: "inventory" })]);
  });

  it("rejects damaged JSON, damaged audio and truncated archives before any projection or recording write", async () => {
    persistence.capture.mockResolvedValue(snapshot([transaction(1)]));
    persistence.recordings.mockResolvedValue([take("recording")]);
    const file = await createTransferFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const size = new DataView(bytes.buffer).getUint32(8);
    const header = new TextDecoder().decode(bytes.subarray(12, 12 + size));
    const changed = header.replace('"after":"C"', '"after":"D"');
    expect(changed).not.toBe(header);
    const damagedJson = new Blob([bytes.subarray(0, 12), changed, bytes.subarray(12 + size)]);
    const damagedBytes = bytes.slice();
    damagedBytes[damagedBytes.length - 1] ^= 1;
    for (const bad of [damagedJson, new Blob([damagedBytes]), file.slice(0, file.size - 1)]) {
      await expect(importTransferFile(bad)).rejects.toThrow(/damaged|incomplete/);
    }
    expect(persistence.merge).not.toHaveBeenCalled();
    expect(persistence.saveRecording).not.toHaveBeenCalled();
  });

  it("waits for durable recording acknowledgements, sends only missing data and skips converged data", async () => {
    const incomingTake = take("incoming");
    const incomingMeta = await descriptor(incomingTake);
    let commit!: () => void;
    persistence.saveRecording.mockReturnValueOnce(new Promise<void>((resolve) => { commit = resolve; }));
    const receiver = channel([
      { kind: "inventory", version: 1, transactions: [], recordings: [incomingMeta] },
      { kind: "changes", snapshot: snapshot(), recordings: [incomingMeta] }, { kind: "saved" },
    ], false);
    receiver.connection.receiveBlob = async () => incomingTake.blob;
    const receiving = exchangeState(receiver.connection);
    await vi.waitFor(() => expect(persistence.saveRecording).toHaveBeenCalled());
    expect(receiver.sent).not.toContainEqual(expect.objectContaining({ kind: "recording-saved" }));
    commit();
    await receiving;
    expect(receiver.sent).toContainEqual({ kind: "recording-saved", id: incomingMeta.id, hash: incomingMeta.hash });

    const transactions = [transaction(1), transaction(2)];
    const takes = [take("known"), take("new"), take("next")];
    persistence.capture.mockResolvedValue(snapshot(transactions));
    persistence.recordings.mockResolvedValue(takes);
    const recordings = await Promise.all(takes.map(descriptor));
    const exchange = (known: number, firstAck?: Promise<unknown>) => channel([
      { kind: "inventory", version: 1, transactions: transactions.slice(0, known).map((tx) => tx.id), recordings: recordings.slice(0, known) },
      ...recordings.slice(known).map((meta, index) => index === 0 && firstAck ? firstAck : { kind: "recording-saved", id: meta.id, hash: meta.hash }),
      { kind: "saved" }, { kind: "changes", snapshot: snapshot(), recordings: [] },
    ], true);
    let saved!: () => void;
    const firstAck = new Promise<void>((resolve) => { saved = resolve; }).then(() => ({ kind: "recording-saved", id: recordings[1].id, hash: recordings[1].hash }));
    const first = exchange(1, firstAck);
    const sending = exchangeState(first.connection);
    await vi.waitFor(() => expect(first.blobs).toEqual([takes[1].blob]));
    saved();
    expect((await sending).sent).toBe(1);
    expect(first.sent).toContainEqual(expect.objectContaining({ kind: "changes", snapshot: expect.objectContaining({ transactions: [transactions[1]] }), recordings: recordings.slice(1) }));
    expect(first.blobs).toEqual([takes[1].blob, takes[2].blob]);
    const second = exchange(3);
    expect((await exchangeState(second.connection)).sent).toBe(0);
    expect(second.sent).toContainEqual(expect.objectContaining({ kind: "changes", snapshot: expect.objectContaining({ transactions: [] }), recordings: [] }));
    expect(second.blobs).toEqual([]);
  });
});
