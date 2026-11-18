import { readAllTakes, storeTransferredTake, type TakeMeta } from "../audio/recorder";
import { captureSnapshot, mergeSnapshot } from "./state";
import { canonical, parseSyncSnapshot, type MergeResult, type SyncSnapshot } from "./model";
import type { SyncConnection } from "./transport";

const MAX_RECORDING = 128 * 1024 * 1024;
const MAX_HEADER = 128 * 1024 * 1024;
const MAX_ARCHIVE = 2 * 1024 * 1024 * 1024;
const MAGIC = new TextEncoder().encode("FRETPK01");

export interface RecordingDescriptor extends TakeMeta {
  size: number;
  mime: string;
  hash: string;
}

interface Inventory {
  kind: "inventory";
  version: 1;
  transactions: string[];
  recordings: RecordingDescriptor[];
}

export interface ExchangeProgress { message: string; done: number; total: number }
export interface ExchangeResult {
  added: number;
  sent: number;
  recordings: number;
  conflicts: MergeResult["conflicts"];
}
type Progress = (progress: ExchangeProgress) => void;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function parseRecordingManifest(value: unknown): RecordingDescriptor[] {
  if (!Array.isArray(value) || value.length > 20_000) throw new Error("The recording list is invalid.");
  const ids = new Set<string>();
  return value.map((raw: unknown) => {
    if (!object(raw) || typeof raw.id !== "string" || !raw.id || raw.id.length > 512 || ids.has(raw.id)
      || typeof raw.tuneId !== "string" || raw.tuneId.length > 512 || typeof raw.cardId !== "string" || raw.cardId.length > 1024
      || typeof raw.day !== "string" || !finite(raw.at) || !finite(raw.bpm) || raw.bpm <= 0
      || !(raw.share === null || (finite(raw.share) && raw.share >= 0 && raw.share <= 1))
      || !Number.isSafeInteger(raw.size) || (raw.size as number) < 0 || (raw.size as number) > MAX_RECORDING
      || typeof raw.mime !== "string" || raw.mime.length > 256 || typeof raw.hash !== "string" || !/^[a-f0-9]{64}$/.test(raw.hash))
      throw new Error("The exchange contains invalid recording metadata.");
    ids.add(raw.id);
    return { id: raw.id, tuneId: raw.tuneId, cardId: raw.cardId, day: raw.day, at: raw.at, bpm: raw.bpm,
      share: raw.share, size: raw.size as number, mime: raw.mime, hash: raw.hash };
  });
}

export async function recordingHash(blob: Blob): Promise<string> {
  if (blob.size > MAX_RECORDING) throw new Error("A recording exceeds the 128 MB transfer limit.");
  const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function inventory(progress?: Progress) {
  const snapshot = await captureSnapshot();
  const takes = await readAllTakes();
  const recordings: RecordingDescriptor[] = [];
  for (const [index, { blob, ...meta }] of takes.entries()) {
    progress?.({ message: "Checking recordings", done: index, total: takes.length });
    recordings.push({ ...meta, size: blob.size, mime: blob.type, hash: await recordingHash(blob) });
  }
  return { snapshot, takes, manifest: { kind: "inventory", version: 1,
    transactions: snapshot.transactions.map((transaction) => transaction.id), recordings } satisfies Inventory };
}

function parseInventory(value: unknown): Inventory {
  if (!object(value) || value.kind !== "inventory" || value.version !== 1 || !Array.isArray(value.transactions)
    || value.transactions.length > 250_000 || new Set(value.transactions).size !== value.transactions.length
    || !value.transactions.every((id) => typeof id === "string" && id.length <= 512))
    throw new Error("The other device sent an unsupported exchange.");
  return { kind: "inventory", version: 1, transactions: value.transactions as string[], recordings: parseRecordingManifest(value.recordings) };
}

function checkCollisions(local: RecordingDescriptor[], remote: RecordingDescriptor[]) {
  const hashes = new Map(local.map((take) => [take.id, take.hash]));
  for (const take of remote) if (hashes.has(take.id) && hashes.get(take.id) !== take.hash)
    throw new Error("Two different recordings have the same identity. Both originals have been kept; export a transfer file before continuing.");
}

async function saveRecording(meta: RecordingDescriptor, blob: Blob): Promise<void> {
  if (blob.size !== meta.size || await recordingHash(blob) !== meta.hash) throw new Error("A recording was incomplete. Sync again to retry it.");
  const { size: _size, hash: _hash, mime, ...take } = meta;
  await storeTransferredTake({ ...take, blob: blob.slice(0, blob.size, mime) });
}

/** Both sides exchange only missing transactions and immutable audio files, then acknowledge durable writes. */
export async function exchangeState(connection: SyncConnection, progress?: Progress): Promise<ExchangeResult> {
  const local = await inventory(progress);
  progress?.({ message: "Comparing changes", done: 0, total: 0 });
  await connection.sendJson(local.manifest);
  const remote = parseInventory(await connection.receiveJson());
  checkCollisions(local.manifest.recordings, remote.recordings);
  const known = new Set(remote.transactions);
  const outgoing = { ...local.snapshot, transactions: local.snapshot.transactions.filter((transaction) => !known.has(transaction.id)) };
  const theirTakes = new Set(remote.recordings.map((take) => take.id));
  const ourTakes = new Set(local.manifest.recordings.map((take) => take.id));
  const ourTransactions = new Set(local.manifest.transactions);
  const recordings = local.manifest.recordings.filter((take) => !theirTakes.has(take.id));
  let received: MergeResult | undefined;
  let receivedTakes = 0;
  const send = async () => {
    progress?.({ message: "Sending changes", done: 0, total: outgoing.transactions.length });
    await connection.sendJson({ kind: "changes", snapshot: outgoing, recordings });
    for (const [index, meta] of recordings.entries()) {
      progress?.({ message: "Sending recordings", done: index, total: recordings.length });
      const take = local.takes.find((item) => item.id === meta.id)!;
      await connection.sendBlob(take.blob);
      const saved = await connection.receiveJson();
      if (!object(saved) || saved.kind !== "recording-saved" || saved.id !== meta.id || saved.hash !== meta.hash)
        throw new Error("The other device has not confirmed saving this recording. Sync again to finish.");
    }
    const ack = await connection.receiveJson();
    if (!object(ack) || ack.kind !== "saved") throw new Error("The other device has not confirmed saving. Sync again to finish.");
  };
  const receive = async () => {
    const message = await connection.receiveJson();
    if (!object(message) || message.kind !== "changes") throw new Error("The device exchange was interrupted.");
    const snapshot = parseSyncSnapshot(message.snapshot);
    const expectedTransactions = new Set(remote.transactions.filter((id) => !ourTransactions.has(id)));
    if (snapshot.transactions.length !== expectedTransactions.size || snapshot.transactions.some((transaction) => !expectedTransactions.has(transaction.id)))
      throw new Error("Some changes did not arrive. Sync again to finish; nothing has been marked as synced.");
    const incoming = parseRecordingManifest(message.recordings);
    const expected = remote.recordings.filter((take) => !ourTakes.has(take.id));
    if (incoming.length !== expected.length || incoming.some((take, index) => JSON.stringify(take) !== JSON.stringify(expected[index])))
      throw new Error("The recording list changed during transfer. Sync again.");
    for (const [index, meta] of incoming.entries()) {
      progress?.({ message: "Saving recordings", done: index, total: incoming.length });
      await saveRecording(meta, await connection.receiveBlob());
      await connection.sendJson({ kind: "recording-saved", id: meta.id, hash: meta.hash });
    }
    progress?.({ message: "Merging history", done: 0, total: snapshot.transactions.length });
    received = await mergeSnapshot(snapshot);
    receivedTakes = incoming.length;
    await connection.sendJson({ kind: "saved" });
  };
  if (connection.initiator) { await send(); await receive(); }
  else { await receive(); await send(); }
  if (!received) throw new Error("The exchange did not finish.");
  return { added: received.added, sent: outgoing.transactions.length, recordings: receivedTakes, conflicts: received.conflicts };
}

/** A portable fallback carries the same immutable journal and audio as a paired exchange. */
export async function createTransferFile(progress?: Progress): Promise<Blob> {
  const local = await inventory(progress);
  const content = { snapshot: local.snapshot, recordings: local.manifest.recordings };
  const checksum = await recordingHash(new Blob([canonical(content)]));
  const header = new TextEncoder().encode(JSON.stringify({ format: "fretboard-focus-transfer", version: 1, checksum, ...content }));
  if (header.byteLength > MAX_HEADER) throw new Error("The transaction archive is too large for one file.");
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, header.byteLength);
  const blob = new Blob([MAGIC, length, header, ...local.takes.map((take) => take.blob)], { type: "application/octet-stream" });
  if (blob.size > MAX_ARCHIVE) throw new Error("The transfer file exceeds 2 GB. Use device pairing instead.");
  return blob;
}

export async function importTransferFile(file: Blob, progress?: Progress): Promise<ExchangeResult> {
  if (file.size < 12 || file.size > MAX_ARCHIVE) throw new Error("That transfer file is invalid or too large.");
  const prefix = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (MAGIC.some((byte, index) => prefix[index] !== byte)) throw new Error("Choose a .fretpack transfer file.");
  const headerSize = new DataView(prefix.buffer).getUint32(8);
  if (headerSize > MAX_HEADER || headerSize + 12 > file.size) throw new Error("That transfer file is incomplete.");
  const header: unknown = JSON.parse(await file.slice(12, 12 + headerSize).text());
  if (!object(header) || header.format !== "fretboard-focus-transfer" || header.version !== 1) throw new Error("That transfer format is not supported.");
  const snapshot: SyncSnapshot = parseSyncSnapshot(header.snapshot);
  const recordings = parseRecordingManifest(header.recordings);
  if (typeof header.checksum !== "string" || await recordingHash(new Blob([canonical({ snapshot, recordings })])) !== header.checksum)
    throw new Error("The practice history in this transfer file is damaged.");
  if (recordings.reduce((bytes, take) => bytes + take.size, headerSize + 12) !== file.size) throw new Error("That transfer file is incomplete.");
  const current = await inventory();
  checkCollisions(current.manifest.recordings, recordings);
  const known = new Set(current.takes.map((take) => take.id));
  let offset = headerSize + 12;
  let count = 0;
  // Verify every binary before applying any practice state. Retrying an interrupted save is safe.
  const checked: { meta: RecordingDescriptor; blob: Blob }[] = [];
  for (const [index, meta] of recordings.entries()) {
    progress?.({ message: "Checking recordings", done: index, total: recordings.length });
    const blob = file.slice(offset, offset + meta.size, meta.mime);
    offset += meta.size;
    if (await recordingHash(blob) !== meta.hash) throw new Error("A recording in the transfer file is damaged.");
    if (!known.has(meta.id)) checked.push({ meta, blob });
  }
  for (const { meta, blob } of checked) { await saveRecording(meta, blob); count++; }
  const merged = await mergeSnapshot(snapshot);
  return { added: merged.added, sent: 0, recordings: count, conflicts: merged.conflicts };
}
