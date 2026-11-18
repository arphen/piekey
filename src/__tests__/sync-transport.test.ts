import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSyncTransport, decodePairInvite, encodePairInvite, syncNetworkConfig, type PairedDevice, type SyncConnection, type SyncTransport } from "../sync/transport";

const network = vi.hoisted(() => {
  class Events {
    private listeners = new Map<string, ((value?: unknown) => void)[]>();
    on(event: string, listener: (value?: unknown) => void) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    }
    emit(event: string, value?: unknown) { for (const listener of this.listeners.get(event) ?? []) listener(value); }
  }
  const peers = new Map<string, FakePeer>();
  const wire = { duplicate: false, tamper: false, frames: [] as Uint8Array[] };
  class Channel extends Events {
    open = false;
    other?: Channel;
    dataChannel = { bufferedAmount: 0 };
    constructor(readonly peer: string, readonly metadata: unknown) { super(); }
    send(buffer: ArrayBuffer) {
      const bytes = new Uint8Array(buffer.slice(0));
      wire.frames.push(bytes.slice());
      if (wire.tamper) { bytes[bytes.length - 1] ^= 1; wire.tamper = false; }
      const duplicate = wire.duplicate;
      wire.duplicate = false;
      queueMicrotask(() => {
        this.other?.emit("data", bytes.buffer);
        if (duplicate) this.other?.emit("data", bytes.buffer.slice(0));
      });
    }
    close() {
      if (!this.open) return;
      this.open = false;
      this.emit("close");
      if (this.other?.open) { this.other.open = false; this.other.emit("close"); }
    }
  }
  class FakePeer extends Events {
    open = false;
    channels: Channel[] = [];
    constructor(readonly id: string) {
      super();
      peers.set(id, this);
      queueMicrotask(() => { this.open = true; this.emit("open", id); });
    }
    connect(id: string, options: { metadata: unknown }) {
      const channel = new Channel(id, options.metadata);
      this.channels.push(channel);
      queueMicrotask(() => {
        const target = peers.get(id);
        if (!target) { channel.emit("error", new Error("Peer unavailable")); return; }
        const incoming = new Channel(this.id, options.metadata);
        channel.other = incoming;
        incoming.other = channel;
        target.channels.push(incoming);
        target.emit("connection", incoming);
        channel.open = incoming.open = true;
        incoming.emit("open");
        channel.emit("open");
      });
      return channel;
    }
    destroy() { for (const channel of this.channels) channel.close(); peers.delete(this.id); this.open = false; }
  }
  return { FakePeer, peers, wire };
});

vi.mock("peerjs", () => ({ default: network.FakePeer }));

const transports: SyncTransport[] = [];
beforeEach(() => {
  vi.stubGlobal("RTCPeerConnection", class {});
  network.wire.frames = [];
  network.wire.duplicate = network.wire.tamper = false;
});
afterEach(() => {
  for (const transport of transports.splice(0)) transport.close();
  network.peers.clear();
  vi.unstubAllGlobals();
});

function device(deviceId: string, known: PairedDevice[] = [], maxMessageBytes?: number) {
  let connected!: (connection: SyncConnection) => void;
  const incoming = new Promise<SyncConnection>((resolve) => { connected = resolve; });
  const errors: Error[] = [];
  const transport = createSyncTransport({
    deviceId, deviceName: deviceId, pairedDevices: () => known, maxMessageBytes,
    onConnection: connected, onError: (error) => errors.push(error),
  });
  transports.push(transport);
  return { transport, incoming, errors };
}

async function pair(maxMessageBytes?: number) {
  const host = device("desktop", [], maxMessageBytes);
  const phone = device("phone", [], maxMessageBytes);
  const invite = await host.transport.createInvite("https://practice.example/guitar/");
  const outgoing = await phone.transport.connectInvite(invite.url);
  const incoming = await host.incoming;
  return { host, phone, outgoing, incoming, invite };
}

describe("encrypted device exchange", () => {
  it("validates custom rendezvous and TURN settings without exposing credentials in errors", () => {
    const relay = { urls: ["turns:relay.example:5349"], username: "device", credential: "relay-secret" };
    expect(syncNetworkConfig({ VITE_SYNC_SIGNALING_HOST: "signal.example", VITE_SYNC_SIGNALING_PORT: "443",
      VITE_SYNC_SIGNALING_PATH: "/peer", VITE_SYNC_SIGNALING_SECURE: "true", VITE_WEBRTC_ICE_SERVERS: JSON.stringify([relay]) }))
      .toEqual({ signaling: { host: "signal.example", port: 443, path: "/peer", secure: true }, iceServers: [relay] });
    expect(() => syncNetworkConfig({ VITE_SYNC_SIGNALING_PORT: "0" })).toThrow("valid port");
    expect(() => syncNetworkConfig({ VITE_WEBRTC_ICE_SERVERS: "relay-secret" })).toThrow(/^VITE_WEBRTC_ICE_SERVERS must be a JSON list/);
  });

  it("pairs with one invitation, exchanges Unicode and chunked audio both ways, then reconnects remembered peers", async () => {
    const { host, phone, outgoing, incoming, invite } = await pair();
    expect(decodePairInvite(invite.url)).toEqual(invite.invite);
    expect(new URL(invite.url).search).toBe("");
    expect(outgoing.initiator).toBe(true);
    expect(incoming.initiator).toBe(false);
    await Promise.all([outgoing.sendJson({ name: "Été 🎸", transactions: [1, 2] }), incoming.sendJson({ name: "Desktop" })]);
    expect(await incoming.receiveJson()).toEqual({ name: "Été 🎸", transactions: [1, 2] });
    expect(await outgoing.receiveJson()).toEqual({ name: "Desktop" });
    const samples = Uint8Array.from({ length: 50_000 }, (_, i) => i % 251);
    await incoming.sendBlob(new Blob([samples], { type: "audio/webm;codecs=opus" }));
    const audio = await outgoing.receiveBlob();
    expect(audio.type).toBe("audio/webm;codecs=opus");
    expect(new Uint8Array(await audio.arrayBuffer())).toEqual(samples);
    // Even the identity handshake is encrypted; the rendezvous never receives app state or keys.
    expect(network.wire.frames.every((frame) => frame[0] === 1 && frame.length >= 30)).toBe(true);
    expect(network.wire.frames.some((frame) => new TextDecoder().decode(frame).includes("Été"))).toBe(false);
    const hostKnown = incoming.remote;
    const phoneKnown = outgoing.remote;
    host.transport.close();
    phone.transport.close();
    const nextHost = device("desktop", [hostKnown]);
    const nextPhone = device("phone", [phoneKnown]);
    await nextHost.transport.start();
    const reconnected = await nextPhone.transport.connectPaired(phoneKnown);
    const accepted = await nextHost.incoming;
    await reconnected.sendJson({ nextTransaction: true });
    expect(await accepted.receiveJson()).toEqual({ nextTransaction: true });
  });

  it("rejects expired invitations and oversized items before transfer", async () => {
    const { outgoing, invite } = await pair(100);
    const code = encodePairInvite(invite.invite);
    expect(() => decodePairInvite(code, invite.invite.expiresAt)).toThrow("expired");
    expect(() => decodePairInvite("not-an-invitation")).toThrow("Invalid device invitation");
    await expect(outgoing.sendBlob(new Blob([new Uint8Array(101)]))).rejects.toThrow("transfer limit");
  });

  it("cancels a pending rendezvous immediately when Devices closes", async () => {
    const { transport } = device("cancelled");
    const starting = transport.start();
    transport.close();
    await expect(starting).rejects.toThrow("closed");
  });

  it.each(["duplicate", "tamper"] as const)("closes an authenticated channel after a %s frame and rejects pending reads", async (fault) => {
    const { outgoing, incoming } = await pair();
    const reading = incoming.receiveJson();
    const rejected = expect(reading).rejects.toThrow(fault === "duplicate" ? /replayed|out of order/ : /prove this pairing/);
    network.wire[fault] = true;
    await outgoing.sendJson({ cannotApply: true }).catch(() => {});
    await rejected;
    expect(await incoming.closed).toBeInstanceOf(Error);
  });
});
