import Peer, { type DataConnection, type PeerOptions } from "peerjs";

export interface PairedDevice {
  deviceId: string;
  name: string;
  peerId: string;
  secret: string;
}

export interface PairInvite {
  v: 1;
  peerId: string;
  inviteId: string;
  secret: string;
  expiresAt: number;
}

export interface SyncConnection {
  readonly remote: PairedDevice;
  readonly initiator: boolean;
  readonly closed: Promise<Error | undefined>;
  sendJson(value: unknown): Promise<void>;
  receiveJson(): Promise<unknown>;
  sendBlob(blob: Blob): Promise<void>;
  receiveBlob(): Promise<Blob>;
  close(): void;
}

export interface SyncTransportOptions {
  deviceId: string;
  deviceName: string;
  pairedDevices: readonly PairedDevice[] | (() => readonly PairedDevice[]);
  onConnection(connection: SyncConnection): void | Promise<void>;
  onError?(error: Error): void;
  signaling?: Pick<PeerOptions, "host" | "port" | "path" | "secure" | "key">;
  iceServers?: RTCIceServer[];
  maxMessageBytes?: number;
  connectionTimeoutMs?: number;
  transferTimeoutMs?: number;
}

export interface SyncTransport {
  start(): Promise<string>;
  createInvite(appUrl: string): Promise<{ invite: PairInvite; url: string }>;
  connectInvite(invite: PairInvite | string): Promise<SyncConnection>;
  connectPaired(device: PairedDevice): Promise<SyncConnection>;
  close(): void;
}

/** Build-time broker/relay settings are public app configuration, never pairing secrets. */
export function syncNetworkConfig(
  env: Readonly<Record<string, unknown>> = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env ?? {},
): Pick<SyncTransportOptions, "signaling" | "iceServers"> {
  const text = (key: string): string | undefined => {
    const value = env[key];
    if (value === undefined || value === "") return undefined;
    if (typeof value !== "string" || value.length > 8192) throw new Error(`Invalid ${key} device connection setting.`);
    return value.trim() || undefined;
  };
  const host = text("VITE_SYNC_SIGNALING_HOST");
  const rawPort = text("VITE_SYNC_SIGNALING_PORT");
  const path = text("VITE_SYNC_SIGNALING_PATH");
  const rawSecure = text("VITE_SYNC_SIGNALING_SECURE");
  const key = text("VITE_SYNC_SIGNALING_KEY");
  if (host && (!/^[A-Za-z0-9.:[\]-]+$/.test(host) || host.length > 253)) throw new Error("VITE_SYNC_SIGNALING_HOST must contain a hostname without a URL scheme.");
  if (rawPort && (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535)) throw new Error("VITE_SYNC_SIGNALING_PORT must be a valid port number.");
  if (path && (!path.startsWith("/") || /[?#\s]/.test(path))) throw new Error("VITE_SYNC_SIGNALING_PATH must be an absolute broker path.");
  if (rawSecure && rawSecure !== "true" && rawSecure !== "false") throw new Error("VITE_SYNC_SIGNALING_SECURE must be true or false.");
  const signaling = host || rawPort || path || rawSecure || key ? {
    ...(host ? { host } : {}), ...(rawPort ? { port: Number(rawPort) } : {}), ...(path ? { path } : {}),
    ...(rawSecure ? { secure: rawSecure === "true" } : {}), ...(key ? { key } : {}),
  } : undefined;
  const rawIce = text("VITE_WEBRTC_ICE_SERVERS");
  if (!rawIce) return signaling ? { signaling } : {};
  try {
    const parsed: unknown = JSON.parse(rawIce);
    if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 16) throw new Error();
    const iceServers: RTCIceServer[] = parsed.map((raw: unknown) => {
      const entry = object(raw);
      const urls = typeof entry.urls === "string" ? [entry.urls] : entry.urls;
      if (!Array.isArray(urls) || !urls.length || urls.length > 16 || !urls.every((url) => typeof url === "string" && /^(stun|stuns|turn|turns):\S+$/.test(url)) ||
          (entry.username !== undefined && typeof entry.username !== "string") || (entry.credential !== undefined && typeof entry.credential !== "string")) throw new Error();
      return { urls, ...(typeof entry.username === "string" ? { username: entry.username } : {}),
        ...(typeof entry.credential === "string" ? { credential: entry.credential } : {}) };
    });
    return { ...(signaling ? { signaling } : {}), iceServers };
  } catch { throw new Error("VITE_WEBRTC_ICE_SERVERS must be a JSON list of STUN/TURN servers with urls and optional username/credential."); }
}

const PROTOCOL = "fretboard-focus-sync-1";
const INVITE_LIFETIME = 10 * 60_000;
const CHUNK_BYTES = 16 * 1024;
const MAX_FRAME_BYTES = CHUNK_BYTES + 2048;
const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;
const BUFFER_LIMIT = 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function errorFrom(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid device message.");
  return value as Record<string, unknown>;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(value);
}

function peerIdFor(deviceId: string): string {
  if (!validId(deviceId) || deviceId.length > 113) throw new Error("This device has an invalid identity.");
  return `guitar-${deviceId}`;
}

function encodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBytes(value: unknown, length?: number): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > 4096) {
    throw new Error("Invalid device invitation.");
  }
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (length !== undefined && bytes.length !== length) throw new Error("Invalid device invitation key.");
  return bytes;
}

function randomCode(length: number): string {
  return encodeBytes(crypto.getRandomValues(new Uint8Array(length)));
}

function parseInvite(value: unknown, now: number): PairInvite {
  const invite = object(value);
  if (invite.v !== 1 || !validId(invite.peerId) || !invite.peerId.startsWith("guitar-") ||
      typeof invite.inviteId !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(invite.inviteId) ||
      typeof invite.secret !== "string" || typeof invite.expiresAt !== "number" ||
      !Number.isSafeInteger(invite.expiresAt)) throw new Error("Invalid device invitation.");
  decodeBytes(invite.secret, 32);
  if (invite.expiresAt <= now) throw new Error("This invitation expired. Create a new QR code on the other device.");
  if (invite.expiresAt > now + INVITE_LIFETIME + 60_000) throw new Error("This invitation has an invalid expiry time.");
  return { v: 1, peerId: invite.peerId, inviteId: invite.inviteId, secret: invite.secret, expiresAt: invite.expiresAt };
}

export function encodePairInvite(invite: PairInvite): string {
  return encodeBytes(encoder.encode(JSON.stringify(parseInvite(invite, Date.now()))));
}

export function decodePairInvite(value: string, now = Date.now()): PairInvite {
  let code = value.trim();
  if (code.length > 8192) throw new Error("Invalid device invitation.");
  if (code.includes("#")) code = new URLSearchParams(code.slice(code.indexOf("#") + 1)).get("pair") ?? "";
  else if (code.startsWith("pair=")) code = new URLSearchParams(code).get("pair") ?? "";
  try {
    return parseInvite(JSON.parse(decoder.decode(decodeBytes(code))), now);
  } catch (error) {
    if (error instanceof Error && error.message.includes("expired")) throw error;
    throw new Error("Invalid device invitation. Scan a new QR code from Devices.");
  }
}

type Payload = { kind: "json"; value: unknown; bytes: number } | { kind: "blob"; value: Blob; bytes: number };
type Incoming = { kind: "json" | "blob"; bytes: number; received: number; mime: string; chunks: ArrayBuffer[] };
type Waiting = { resolve(payload: Payload): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };

/** One encrypted, ordered channel. Application acknowledgements follow durable state writes. */
class EncryptedConnection implements SyncConnection {
  readonly ready: Promise<SyncConnection>;
  readonly closed: Promise<Error | undefined>;
  remote!: PairedDevice;
  private resolveReady!: (connection: SyncConnection) => void;
  private rejectReady!: (error: Error) => void;
  private resolveClosed!: (error: Error | undefined) => void;
  private readonly nonce = randomCode(32);
  private readonly sharedKey: Promise<CryptoKey>;
  private sendKey?: CryptoKey;
  private receiveKey?: CryptoKey;
  private sendCounter = 0;
  private receiveCounter = 0;
  private sentHello = false;
  private receivedHello = false;
  private sentReady = false;
  private authenticated = false;
  private ended = false;
  private sendChain: Promise<void> = Promise.resolve();
  private wireChain: Promise<void> = Promise.resolve();
  private receiveChain: Promise<void> = Promise.resolve();
  private incoming?: Incoming;
  private queued: Payload[] = [];
  private queuedBytes = 0;
  private waiting: Waiting[] = [];
  private readonly handshakeTimer: ReturnType<typeof setTimeout>;
  private incomingTimer?: ReturnType<typeof setTimeout>;
  private readonly maxBytes: number;
  private readonly timeout: number;

  constructor(
    private readonly channel: DataConnection,
    readonly initiator: boolean,
    private readonly secret: string,
    private readonly options: SyncTransportOptions,
    private readonly authenticate: (device: PairedDevice) => void,
  ) {
    this.maxBytes = options.maxMessageBytes ?? DEFAULT_MAX_BYTES;
    this.timeout = options.transferTimeoutMs ?? 120_000;
    this.sharedKey = crypto.subtle.importKey("raw", decodeBytes(secret, 32).slice().buffer, "AES-GCM", false, ["encrypt", "decrypt"]);
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    this.closed = new Promise((resolve) => { this.resolveClosed = resolve; });
    this.handshakeTimer = setTimeout(() => this.fail(new Error("The other device did not connect. Keep Devices open on both screens and try again.")), options.connectionTimeoutMs ?? 25_000);
    channel.on("data", (data: unknown) => {
      this.receiveChain = this.receiveChain.then(() => this.readFrame(data)).catch((error: unknown) => this.fail(errorFrom(error)));
    });
    channel.on("error", (error) => this.fail(errorFrom(error)));
    channel.on("close", () => this.fail(new Error("The other device disconnected before the exchange finished.")));
    channel.on("open", () => { void this.hello().catch((error: unknown) => this.fail(errorFrom(error))); });
    if (channel.open) void this.hello().catch((error: unknown) => this.fail(errorFrom(error)));
  }

  private async hello(): Promise<void> {
    if (this.sentHello || this.ended) return;
    this.sentHello = true;
    await this.sendFrame(0, encoder.encode(JSON.stringify({
      type: "hello", deviceId: this.options.deviceId, name: this.options.deviceName.slice(0, 80), nonce: this.nonce,
    })));
  }

  private sendFrame(phase: 0 | 1, plaintext: Uint8Array): Promise<void> {
    const task = this.wireChain.then(async () => {
      if (this.ended) throw new Error("The device connection is closed.");
      const header = new Uint8Array(14);
      header[0] = 1;
      header[1] = phase;
      if (phase === 0) crypto.getRandomValues(header.subarray(2));
      else {
        if (!this.sendKey || !Number.isSafeInteger(this.sendCounter + 1)) throw new Error("Invalid encryption session.");
        new DataView(header.buffer).setBigUint64(6, BigInt(this.sendCounter++));
      }
      const key = phase === 0 ? await this.sharedKey : this.sendKey!;
      const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: header.subarray(2), additionalData: header }, key, plaintext.slice().buffer);
      const frame = new Uint8Array(header.length + encrypted.byteLength);
      frame.set(header);
      frame.set(new Uint8Array(encrypted), header.length);
      await this.waitForBuffer(BUFFER_LIMIT);
      if (this.ended || !this.channel.open) throw new Error("The device connection is closed.");
      this.channel.send(frame.buffer);
    });
    this.wireChain = task.catch((error: unknown) => this.fail(errorFrom(error)));
    return task;
  }

  private async waitForBuffer(limit: number): Promise<void> {
    const started = Date.now();
    while (this.channel.dataChannel.bufferedAmount > limit) {
      if (this.ended || !this.channel.open) throw new Error("The device connection closed during the transfer.");
      if (Date.now() - started > this.timeout) throw new Error("The device transfer stopped responding.");
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
  }

  private control(message: Record<string, unknown>): Promise<void> {
    const json = encoder.encode(JSON.stringify(message));
    const content = new Uint8Array(json.length + 1);
    content.set(json, 1);
    return this.sendFrame(1, content);
  }

  private async readFrame(data: unknown): Promise<void> {
    if (this.ended) return;
    let buffer: ArrayBuffer;
    if (data instanceof ArrayBuffer) buffer = data;
    else if (data instanceof Blob && data.size <= MAX_FRAME_BYTES) buffer = await data.arrayBuffer();
    else if (ArrayBuffer.isView(data) && data.byteLength <= MAX_FRAME_BYTES) buffer = new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice().buffer;
    else throw new Error("The other device sent an invalid encrypted frame.");
    if (buffer.byteLength < 30 || buffer.byteLength > MAX_FRAME_BYTES) throw new Error("Invalid device frame size.");
    const frame = new Uint8Array(buffer);
    const header = frame.subarray(0, 14);
    if (header[0] !== 1 || (header[1] !== 0 && header[1] !== 1)) throw new Error("Unsupported device protocol.");
    const phase = header[1];
    if (phase === 0 && this.receivedHello) throw new Error("Repeated device handshake.");
    if (phase === 1) {
      if (!this.receiveKey || header.subarray(2, 6).some((byte) => byte !== 0) ||
          new DataView(header.buffer, header.byteOffset).getBigUint64(6) !== BigInt(this.receiveCounter)) {
        throw new Error("The device message was replayed or arrived out of order.");
      }
    }
    const key = phase === 0 ? await this.sharedKey : this.receiveKey!;
    let plaintext: ArrayBuffer;
    try {
      plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: header.subarray(2), additionalData: header }, key, frame.subarray(14));
    } catch {
      throw new Error("The other device could not prove this pairing. Create a new invitation.");
    }
    if (phase === 0) await this.readHello(object(JSON.parse(decoder.decode(plaintext))));
    else {
      this.receiveCounter++;
      await this.readContent(new Uint8Array(plaintext));
    }
  }

  private async readHello(hello: Record<string, unknown>): Promise<void> {
    if (hello.type !== "hello" || !validId(hello.deviceId) || peerIdFor(hello.deviceId) !== this.channel.peer ||
        hello.deviceId === this.options.deviceId || typeof hello.name !== "string" || !hello.name.trim() || hello.name.length > 80) {
      throw new Error("The other device has an invalid identity.");
    }
    decodeBytes(hello.nonce, 32);
    const remoteNonce = hello.nonce as string;
    this.receivedHello = true;
    this.remote = { deviceId: hello.deviceId, name: hello.name, peerId: this.channel.peer, secret: this.secret };
    const localFirst = this.options.deviceId < hello.deviceId;
    const salt = encoder.encode(localFirst ? `${this.nonce}:${remoteNonce}` : `${remoteNonce}:${this.nonce}`);
    const master = await crypto.subtle.importKey("raw", decodeBytes(this.secret, 32).slice().buffer, "HKDF", false, ["deriveKey"]);
    const derive = (from: string, to: string) => crypto.subtle.deriveKey({
      name: "HKDF", hash: "SHA-256", salt, info: encoder.encode(`${PROTOCOL}:${from}:${to}`),
    }, master, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    [this.sendKey, this.receiveKey] = await Promise.all([
      derive(this.options.deviceId, hello.deviceId), derive(hello.deviceId, this.options.deviceId),
    ]);
    await this.hello();
    await this.control({ type: "ready" });
    this.sentReady = true;
  }

  private async readContent(content: Uint8Array): Promise<void> {
    if (!content.length) throw new Error("Empty device message.");
    if (content[0] === 1) {
      if (!this.authenticated || !this.incoming || content.length === 1 || content.length - 1 > CHUNK_BYTES ||
          this.incoming.received + content.length - 1 > this.incoming.bytes) throw new Error("Invalid device transfer chunk.");
      this.incoming.chunks.push(content.slice(1).buffer);
      this.incoming.received += content.length - 1;
      this.refreshTransferTimeout();
      return;
    }
    if (content[0] !== 0 || content.length > 2048) throw new Error("Invalid device transfer control.");
    const message = object(JSON.parse(decoder.decode(content.subarray(1))));
    if (message.type === "ready") {
      if (this.authenticated || !this.sentReady) throw new Error("Invalid device session confirmation.");
      this.authenticate(this.remote);
      this.authenticated = true;
      clearTimeout(this.handshakeTimer);
      this.resolveReady(this);
      return;
    }
    if (!this.authenticated) throw new Error("The device transfer started before pairing finished.");
    if (message.type === "start") {
      if (this.incoming || (message.kind !== "json" && message.kind !== "blob") ||
          typeof message.bytes !== "number" || !Number.isSafeInteger(message.bytes) || message.bytes < 0 ||
          message.bytes > this.maxBytes || this.queuedBytes + message.bytes > this.maxBytes || this.queued.length >= 8 ||
          (message.mime !== undefined && (typeof message.mime !== "string" || message.mime.length > 255))) {
        throw new Error("The incoming transfer is too large or malformed.");
      }
      this.incoming = { kind: message.kind, bytes: message.bytes, received: 0, mime: typeof message.mime === "string" ? message.mime : "", chunks: [] };
      this.refreshTransferTimeout();
      return;
    }
    if (message.type !== "finish" || !this.incoming || this.incoming.bytes !== this.incoming.received) {
      throw new Error("The device transfer was incomplete.");
    }
    clearTimeout(this.incomingTimer);
    const incoming = this.incoming;
    this.incoming = undefined;
    let payload: Payload;
    if (incoming.kind === "blob") payload = { kind: "blob", value: new Blob(incoming.chunks, { type: incoming.mime }), bytes: incoming.bytes };
    else {
      const bytes = new Uint8Array(incoming.bytes);
      let offset = 0;
      for (const chunk of incoming.chunks) { bytes.set(new Uint8Array(chunk), offset); offset += chunk.byteLength; }
      payload = { kind: "json", value: JSON.parse(decoder.decode(bytes)), bytes: incoming.bytes };
    }
    const waiting = this.waiting.shift();
    if (waiting) { clearTimeout(waiting.timer); waiting.resolve(payload); }
    else { this.queued.push(payload); this.queuedBytes += payload.bytes; }
  }

  private refreshTransferTimeout(): void {
    clearTimeout(this.incomingTimer);
    this.incomingTimer = setTimeout(() => this.fail(new Error("The device transfer stopped before it finished.")), this.timeout);
    for (const waiting of this.waiting) {
      clearTimeout(waiting.timer);
      waiting.timer = setTimeout(() => this.fail(new Error("The other device did not finish its exchange.")), this.timeout);
    }
  }

  private sendPayload(kind: "json" | "blob", source: Uint8Array | Blob): Promise<void> {
    const bytes = source instanceof Blob ? source.size : source.length;
    if (bytes > this.maxBytes) return Promise.reject(new Error(`This item exceeds the ${Math.floor(this.maxBytes / 1024 / 1024)} MiB device transfer limit.`));
    const task = this.sendChain.then(async () => {
      await this.ready;
      await this.control({ type: "start", kind, bytes, ...(source instanceof Blob ? { mime: source.type } : {}) });
      for (let offset = 0; offset < bytes; offset += CHUNK_BYTES) {
        const chunk = source instanceof Blob
          ? new Uint8Array(await source.slice(offset, offset + CHUNK_BYTES).arrayBuffer())
          : source.subarray(offset, offset + CHUNK_BYTES);
        const content = new Uint8Array(chunk.length + 1);
        content[0] = 1;
        content.set(chunk, 1);
        await this.sendFrame(1, content);
      }
      await this.control({ type: "finish" });
      await this.waitForBuffer(0);
    });
    this.sendChain = task.catch((error: unknown) => this.fail(errorFrom(error)));
    return task;
  }

  async sendJson(value: unknown): Promise<void> {
    const json = JSON.stringify(value);
    if (json === undefined) throw new Error("This value cannot be sent to another device.");
    await this.sendPayload("json", encoder.encode(json));
  }

  sendBlob(blob: Blob): Promise<void> { return this.sendPayload("blob", blob); }

  private async receivePayload(): Promise<Payload> {
    await this.ready;
    if (this.ended) throw new Error("The device connection is closed.");
    const payload = this.queued.shift();
    if (payload) { this.queuedBytes -= payload.bytes; return payload; }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error("The other device did not finish its exchange.")), this.timeout);
      this.waiting.push({ resolve, reject, timer });
    });
  }

  async receiveJson(): Promise<unknown> {
    const payload = await this.receivePayload();
    if (payload.kind !== "json") { this.fail(new Error("Expected device state before a recording.")); throw new Error("Unexpected recording transfer."); }
    return payload.value;
  }

  async receiveBlob(): Promise<Blob> {
    const payload = await this.receivePayload();
    if (payload.kind !== "blob") { this.fail(new Error("Expected a recording from the other device.")); throw new Error("Unexpected state transfer."); }
    return payload.value;
  }

  private fail(error?: Error): void {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.handshakeTimer);
    clearTimeout(this.incomingTimer);
    const reason = error ?? new Error("The device connection was closed.");
    this.rejectReady(reason);
    for (const waiting of this.waiting.splice(0)) { clearTimeout(waiting.timer); waiting.reject(reason); }
    this.incoming = undefined;
    this.queued = [];
    this.queuedBytes = 0;
    this.channel.close();
    this.resolveClosed(error);
  }

  close(): void { this.fail(); }
}

export function createSyncTransport(options: SyncTransportOptions): SyncTransport {
  const peerId = peerIdFor(options.deviceId);
  if (!options.deviceName.trim() || options.deviceName.length > 80) throw new Error("Give this device a name of at most 80 characters.");
  if (options.maxMessageBytes !== undefined && (!Number.isSafeInteger(options.maxMessageBytes) || options.maxMessageBytes < 1)) throw new Error("Invalid device transfer size limit.");
  for (const timeout of [options.connectionTimeoutMs, options.transferTimeoutMs]) {
    if (timeout !== undefined && (!Number.isSafeInteger(timeout) || timeout < 1)) throw new Error("Invalid device connection timeout.");
  }
  let peer: Peer | undefined;
  let starting: Promise<string> | undefined;
  let settleStart: ((error?: Error, id?: string) => void) | undefined;
  let disposed = false;
  const invites = new Map<string, PairInvite>();
  const links = new Set<EncryptedConnection>();
  const paired = () => typeof options.pairedDevices === "function" ? options.pairedDevices() : options.pairedDevices;
  const report = (error: unknown) => options.onError?.(errorFrom(error));

  function attach(channel: DataConnection, initiator: boolean, secret: string, invite?: PairInvite): Promise<SyncConnection> {
    const connection = new EncryptedConnection(channel, initiator, secret, options, () => {
      if (invite && !initiator) {
        if (invites.get(invite.inviteId) !== invite || invite.expiresAt <= Date.now()) throw new Error("This device invitation has expired or was already used.");
        invites.delete(invite.inviteId);
      }
    });
    links.add(connection);
    void connection.closed.then(() => links.delete(connection));
    void connection.ready.then((ready) => options.onConnection(ready)).catch((error: unknown) => { connection.close(); report(error); });
    return connection.ready;
  }

  function receiveConnection(channel: DataConnection): void {
    try {
      if (disposed || links.size >= 4) throw new Error("Another device exchange is already connecting. Try again when it finishes.");
      const metadata = object(channel.metadata);
      if (metadata.protocol !== PROTOCOL || channel.peer === peerId) throw new Error("Unknown device connection.");
      if (metadata.mode === "invite" && typeof metadata.inviteId === "string") {
        const invite = invites.get(metadata.inviteId);
        if (!invite || invite.expiresAt <= Date.now()) throw new Error("This device invitation is no longer active.");
        void attach(channel, false, invite.secret, invite).catch(() => {});
      } else if (metadata.mode === "paired") {
        const known = paired().find((entry) => entry.peerId === channel.peer && peerIdFor(entry.deviceId) === channel.peer);
        if (!known) throw new Error("This device has not been paired.");
        void attach(channel, false, known.secret).catch(() => {});
      } else throw new Error("Unknown device pairing request.");
    } catch (error) {
      channel.close();
      report(error);
    }
  }

  function start(): Promise<string> {
    if (disposed) return Promise.reject(new Error("The device connection was closed. Reopen Devices to connect."));
    if (peer?.open) return Promise.resolve(peer.id);
    if (starting) return starting;
    if (!globalThis.crypto?.subtle || !globalThis.RTCPeerConnection) return Promise.reject(new Error("Device pairing needs a secure HTTPS browser with WebRTC support."));
    const pending = new Promise<string>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finish(new Error("The pairing service could not be reached. Check the connection and try again.")), options.connectionTimeoutMs ?? 25_000);
      function finish(error?: Error, id?: string): void {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        settleStart = undefined;
        starting = undefined;
        if (error) { peer?.destroy(); peer = undefined; reject(error); }
        else resolve(id!);
      }
      settleStart = finish;
    });
    starting = pending;
    try {
      if (peer && !peer.destroyed) peer.reconnect();
      else {
        peer = new Peer(peerId, {
          ...options.signaling,
          config: { iceServers: options.iceServers ?? [{ urls: "stun:stun.cloudflare.com:3478" }] },
        });
        const current = peer;
        current.on("open", (id) => { if (peer === current) settleStart?.(undefined, id); });
        current.on("connection", (channel) => { if (peer === current && !disposed) receiveConnection(channel); else channel.close(); });
        current.on("error", (error) => {
          if (peer !== current || disposed) return;
          if (settleStart) settleStart(errorFrom(error)); else report(error);
        });
        current.on("disconnected", () => {
          if (peer === current && !disposed) report(new Error("The pairing service disconnected. Reconnect to make another device exchange."));
        });
      }
    } catch (error) { settleStart?.(errorFrom(error)); }
    return pending;
  }

  return {
    start,
    async createInvite(appUrl) {
      await start();
      if (disposed || !peer?.open) throw new Error("The pairing service is disconnected. Reopen Devices to try again.");
      for (const [id, invite] of invites) if (invite.expiresAt <= Date.now()) invites.delete(id);
      if (invites.size >= 16) invites.delete(invites.keys().next().value!);
      const invite: PairInvite = { v: 1, peerId, inviteId: randomCode(16), secret: randomCode(32), expiresAt: Date.now() + INVITE_LIFETIME };
      invites.set(invite.inviteId, invite);
      const url = new URL(appUrl);
      url.hash = new URLSearchParams({ pair: encodePairInvite(invite) }).toString();
      return { invite, url: url.toString() };
    },
    async connectInvite(value) {
      const invite = typeof value === "string" ? decodePairInvite(value) : parseInvite(value, Date.now());
      await start();
      if (disposed || !peer?.open) throw new Error("The pairing service is disconnected. Reopen Devices to try again.");
      if (invite.peerId === peerId) throw new Error("Open this invitation on the other device.");
      const channel = peer!.connect(invite.peerId, { reliable: true, serialization: "raw", metadata: { protocol: PROTOCOL, mode: "invite", inviteId: invite.inviteId } });
      return attach(channel, true, invite.secret);
    },
    async connectPaired(device) {
      if (peerIdFor(device.deviceId) !== device.peerId || device.peerId === peerId) throw new Error("Invalid paired device.");
      decodeBytes(device.secret, 32);
      await start();
      if (disposed || !peer?.open) throw new Error("The pairing service is disconnected. Reopen Devices to try again.");
      const channel = peer!.connect(device.peerId, { reliable: true, serialization: "raw", metadata: { protocol: PROTOCOL, mode: "paired" } });
      return attach(channel, true, device.secret);
    },
    close() {
      disposed = true;
      settleStart?.(new Error("The device connection was closed."));
      invites.clear();
      for (const link of links) link.close();
      links.clear();
      peer?.destroy();
      peer = undefined;
    },
  };
}
