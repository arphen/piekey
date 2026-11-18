// @vitest-environment jsdom
import { IDBFactory, IDBObjectStore as FakeObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const meta = (id = "take-1", at = 1) => ({ id, tuneId: "tune", cardId: "run", day: "2026-11-18", at, bpm: 80, share: 0.9 });
const blob = new Blob(["guitar"], { type: "audio/webm" });

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("recording durability", () => {
  it("keeps failed audio available and retries the same identity after storage recovers", async () => {
    const recorder = await import("../audio/recorder");
    const factory = indexedDB;
    vi.stubGlobal("indexedDB", { open() { throw new DOMException("denied", "SecurityError"); } });
    expect(await recorder.saveTake(meta(), blob)).toBe("pending");
    expect(recorder.getPendingTakes()).toEqual([{ ...meta(), blob }]);
    expect(await recorder.takeAudio("tune", "take-1")).toBe(blob);
    await expect(recorder.listTakes("tune")).rejects.toThrow("could not be opened");
    await expect(recorder.takeAudio("tune", "another-take")).rejects.toThrow("could not be opened");
    await expect(recorder.readAllTakes()).rejects.toThrow("could not be opened");
    vi.stubGlobal("indexedDB", factory);
    expect(await recorder.retryPendingTakes()).toBe(true);
    expect(recorder.getPendingTakes()).toEqual([]);
    expect(recorder.getRecordingSaves().get("take-1")).toBe("saved");
    expect((await recorder.readAllTakes()).map((take) => take.id)).toEqual(["take-1"]);
    expect((await recorder.listTakes("tune")).map((take) => take.id)).toEqual(["take-1"]);
  });

  it("keeps assessment and score identity metadata through durable storage and listing", async () => {
    const recorder = await import("../audio/recorder");
    const take = { ...meta(), conditions: { v: 1 as const, source: "measured" as const, confidence: "unknown" as const, tempo: "fixed" as const, uninterrupted: true }, arrangementFingerprint: "score-version-1" };
    await recorder.storeTransferredTake({ ...take, blob });
    expect(await recorder.listTakes("tune")).toEqual([take]);
    expect((await recorder.readExportableTakes())[0]).toMatchObject(take);
  });

  it("does not report a failed write as saved or advertise it as durable", async () => {
    const recorder = await import("../audio/recorder");
    await recorder.saveTake(meta("saved"), blob);
    const failure = vi.spyOn(FakeObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore) {
      this.transaction.abort();
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(await recorder.saveTake(meta("unsaved", 2), blob)).toBe("pending");
    expect((await recorder.readAllTakes()).map((take) => take.id)).toEqual(["saved"]);
    expect((await recorder.readExportableTakes()).map((take) => take.id)).toEqual(["saved", "unsaved"]);
    await expect(recorder.storeTransferredTake({ ...meta("remote"), blob })).rejects.toThrow();
    failure.mockRestore();
    expect(await recorder.retryPendingTakes()).toBe(true);
    expect((await recorder.readAllTakes()).map((take) => take.id)).toEqual(["saved", "unsaved"]);
  });

  it("keeps first and latest takes when retrying an existing identity", async () => {
    const recorder = await import("../audio/recorder");
    for (let at = 0; at < 13; at++) await recorder.saveTake(meta(`take-${at}`, at), blob);
    await recorder.saveTake(meta("take-0", 0), blob);
    const takes = await recorder.readAllTakes();
    expect(takes).toHaveLength(11);
    expect(takes.map((take) => take.id)).toContain("take-0");
    expect(takes.map((take) => take.id)).toContain("take-12");
    expect(takes.map((take) => take.id)).not.toContain("take-1");
    expect(await recorder.saveTake(meta("recovered-old", 1), blob)).toBe("saved");
    expect((await recorder.readAllTakes()).map((take) => take.id)).toContain("recovered-old");
    const factory = indexedDB;
    vi.stubGlobal("indexedDB", { open() { throw new Error("storage offline"); } });
    await recorder.saveTake(meta("pending-old-a", 1), blob);
    await recorder.saveTake(meta("pending-old-b", 2), blob);
    vi.stubGlobal("indexedDB", factory);
    expect(await recorder.retryPendingTakes()).toBe(true);
    const recovered = (await recorder.readAllTakes()).map((take) => take.id);
    expect(recovered).toContain("pending-old-a");
    expect(recovered).toContain("pending-old-b");
  });
});

describe("capture completion", () => {
  it("reports missing or failed capture as unavailable without inventing a saved take", async () => {
    const recorder = await import("../audio/recorder");
    expect(await recorder.finishTake(meta(), null)).toBe("unavailable");
    expect(await recorder.finishTake(meta("empty"), { stop: async () => new Blob() })).toBe("unavailable");
    expect(await recorder.finishTake(meta("failed"), { stop: async () => { throw new Error("capture failed"); } })).toBe("unavailable");
    expect(recorder.getPendingTakes()).toEqual([]);
  });

  it("shares one final capture between repeated stop calls", async () => {
    const stop = vi.fn();
    vi.stubGlobal("MediaRecorder", class {
      state = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      start() { this.state = "recording"; }
      stop() {
        stop();
        this.state = "inactive";
        queueMicrotask(() => { this.ondataavailable?.({ data: blob }); this.onstop?.(); });
      }
    });
    const recorder = await import("../audio/recorder");
    const recording = recorder.record({} as MediaStream);
    const first = recording.stop();
    expect(recording.stop()).toBe(first);
    expect((await first)?.size).toBe(blob.size);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
