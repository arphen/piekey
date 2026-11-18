import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { setNavMuted } from "../nav/useGuitarNav";
import { createSyncTransport, decodePairInvite, syncNetworkConfig, type PairInvite, type SyncConnection, type SyncTransport } from "../sync/transport";
import { initializeSyncJournal } from "../sync/state";
import { readSyncJournal } from "../sync/journal";
import { createTransferFile, exchangeState, importTransferFile, type ExchangeProgress, type ExchangeResult } from "../sync/exchange";
import { loadDevicePreferences, saveDevicePreferences, type DevicePreferences } from "../sync/devices";
import { Glyph } from "./Glyph";
import { keepPracticeWrite } from "../platform/practiceWindow";

function errorText(error: unknown): string { return error instanceof Error ? error.message : "The transfer could not finish. Try again."; }
function lastSync(at: number) { return new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }

export default function DeviceSyncPanel({ onClose, onUpdated }: { onClose: () => void; onUpdated: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const transport = useRef<SyncTransport>();
  const connection = useRef<SyncConnection>();
  const preferences = useRef<DevicePreferences>(loadDevicePreferences());
  const onUpdatedRef = useRef(onUpdated);
  onUpdatedRef.current = onUpdated;
  const alive = useRef(true);
  const busyRef = useRef(false);
  const pendingDial = useRef(false);
  const generation = useRef(0);
  const started = useRef<Promise<SyncTransport>>();
  const [name, setName] = useState(preferences.current.name);
  const [appUrl, setAppUrl] = useState(preferences.current.appUrl);
  const [peers, setPeers] = useState(preferences.current.peers);
  const [invite, setInvite] = useState<{ invite: PairInvite; url: string }>();
  const [joining, setJoining] = useState(() => {
    const fragment = new URLSearchParams(location.hash.slice(1));
    return fragment.has("pair") ? location.href : "";
  });
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [progress, setProgress] = useState<ExchangeProgress>();
  const [result, setResult] = useState<ExchangeResult>();
  const [resultLabel, setResultLabel] = useState("Synced");
  const fileRef = useRef<HTMLInputElement>(null);

  const finishResult = (value: ExchangeResult, label = "Synced") => {
    if (!alive.current) return;
    setResult(value);
    setResultLabel(label);
    setProgress(undefined);
    onUpdatedRef.current();
  };
  const updateProgress = (value: ExchangeProgress) => { if (alive.current) setProgress(value); };
  const receiveConnection = async (channel: SyncConnection) => {
    if (!alive.current || busyRef.current) { channel.close(); return; }
    pendingDial.current = false;
    busyRef.current = true;
    connection.current = channel;
    setBusy(true); setError(undefined); setNotice(undefined); setInvite(undefined);
    try {
      const outcome = await keepPracticeWrite(exchangeState(channel, updateProgress));
      if (!alive.current) return;
      const peer = { ...channel.remote, lastSynced: Date.now() };
      const next = { ...preferences.current, peers: [...preferences.current.peers.filter((item) => item.deviceId !== peer.deviceId), peer] };
      saveDevicePreferences(next);
      preferences.current = next;
      setPeers(next.peers);
      setJoining("");
      finishResult(outcome);
    } catch (failure) { if (alive.current) { setError(errorText(failure)); onUpdatedRef.current(); } }
    finally {
      channel.close(); connection.current = undefined; busyRef.current = false;
      if (alive.current) { setBusy(false); setProgress(undefined); }
    }
  };

  const ensureTransport = () => {
    if (!started.current) {
      const activeGeneration = generation.current;
      const pending = (async () => {
      if (!window.isSecureContext) throw new Error("Open this app over HTTPS to pair devices. Transfer files are also available below.");
      await initializeSyncJournal();
      const { device } = await readSyncJournal();
      if (!alive.current || generation.current !== activeGeneration) throw new Error("Devices closed.");
      const controller = createSyncTransport({ ...syncNetworkConfig(), deviceId: device, deviceName: preferences.current.name,
        pairedDevices: () => preferences.current.peers, onConnection: receiveConnection,
        onError: (failure) => { if (alive.current) setError(errorText(failure)); } });
      transport.current = controller;
      await controller.start();
      if (!alive.current || generation.current !== activeGeneration) { controller.close(); throw new Error("Devices closed."); }
      setReady(true);
      return controller;
      })();
      started.current = pending;
      void pending.catch(() => { if (started.current === pending) started.current = undefined; });
    }
    return started.current;
  };

  useEffect(() => {
    alive.current = true;
    dialog.current?.showModal();
    setNavMuted(true);
    const fragment = new URLSearchParams(location.hash.slice(1));
    if (fragment.has("pair")) { fragment.delete("pair"); history.replaceState(null, "", `${location.pathname}${location.search}${fragment.size ? `#${fragment}` : ""}`); }
    if (preferences.current.peers.length) void ensureTransport().catch((failure: unknown) => { if (alive.current) setError(errorText(failure)); });
    return () => { generation.current++; alive.current = false; connection.current?.close(); transport.current?.close(); transport.current = undefined; started.current = undefined; setNavMuted(false); };
    // The dialog owns one foreground connection lifecycle.
  }, []);

  const pair = async () => {
    setError(undefined); setResult(undefined); setNotice(undefined);
    setProgress({ message: "Opening connection", done: 0, total: 0 });
    try {
      const address = new URL(appUrl || `${location.origin}${location.pathname}`);
      const local = /^(localhost|127\..*|\[::1\])$/.test(address.hostname);
      if (address.protocol !== "https:" && !(local && address.protocol === "http:")) throw new Error("Use the HTTPS address where you open this app on your phone.");
      if (local) throw new Error("Enter the app’s HTTPS address. This laptop’s localhost address cannot open on your phone.");
      preferences.current = { ...preferences.current, appUrl: address.href };
      saveDevicePreferences(preferences.current);
      setInvite(await (await ensureTransport()).createInvite(address.href));
    }
    catch (failure) { setError(errorText(failure)); }
    finally { setProgress(undefined); }
  };
  const join = async (value: string) => {
    if (busyRef.current || pendingDial.current) return;
    pendingDial.current = true;
    setError(undefined); setResult(undefined); setNotice(undefined);
    try {
      const invitation = decodePairInvite(value);
      setProgress({ message: "Connecting", done: 0, total: 0 });
      await (await ensureTransport()).connectInvite(invitation);
    } catch (failure) { pendingDial.current = false; if (alive.current) { setError(errorText(failure)); setProgress(undefined); } }
  };
  const rename = () => {
    const next = { ...preferences.current, name: name.trim().slice(0, 60) || "My device" };
    if (next.name === preferences.current.name) return;
    try {
      saveDevicePreferences(next); preferences.current = next; setName(next.name);
      generation.current++; transport.current?.close(); transport.current = undefined; started.current = undefined; setReady(false);
    }
    catch (failure) { setError(errorText(failure)); }
  };
  const fileAction = async (action: () => Promise<void>) => {
    if (busyRef.current || pendingDial.current) return;
    busyRef.current = true; setBusy(true); setError(undefined); setResult(undefined); setNotice(undefined);
    try { await keepPracticeWrite(action()); } catch (failure) { if (alive.current) { setError(errorText(failure)); onUpdatedRef.current(); } }
    finally { busyRef.current = false; setBusy(false); setProgress(undefined); }
  };
  const exportFile = () => fileAction(async () => {
    const blob = await createTransferFile(updateProgress);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `guitar-${new Date().toISOString().slice(0, 10)}.fretpack`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    setNotice("Transfer file saved. Open it in Devices on the other device.");
  });

  return <dialog ref={dialog} className="device-sync-dialog" aria-labelledby="devices-title" onCancel={(event) => { event.preventDefault(); if (!busyRef.current) onClose(); }}>
    <div className="device-sync-head"><Glyph name="devices" size={24} /><h2 id="devices-title">Devices</h2><button type="button" className="device-sync-close" onClick={onClose} disabled={busy} aria-label="Close devices"><Glyph name="close" size={20} /></button></div>
    <label className="device-sync-name"><span>This device</span><input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} onBlur={rename} disabled={busy || Boolean(progress) || Boolean(invite)} /></label>

    {joining ? <div className="device-sync-join"><Glyph name="devices" size={36} /><p>Merge tunes, practice history and recordings with the other device.</p><button type="button" className="device-sync-primary" disabled={busy || Boolean(progress)} onClick={() => void join(joining)}>Connect & sync <Glyph name="arrow" size={17} /></button></div> : null}

    {peers.length ? <ul className="device-sync-peers">{peers.map((peer) => <li key={peer.deviceId}><Glyph name="devices" size={24} /><div><strong>{peer.name}</strong><small>Last synced {lastSync(peer.lastSynced)}</small></div><button type="button" disabled={busy || Boolean(progress)} onClick={() => {
      pendingDial.current = true;
      setError(undefined); setResult(undefined); setProgress({ message: `Connecting to ${peer.name}`, done: 0, total: 0 });
      void ensureTransport().then((controller) => controller.connectPaired(peer)).catch((failure: unknown) => { pendingDial.current = false; if (alive.current) { setError(errorText(failure)); setProgress(undefined); } });
    }}><Glyph name="sync" size={18} />Sync</button><button type="button" className="device-sync-forget" aria-label={`Forget ${peer.name}`} disabled={busy || Boolean(progress)} onClick={() => {
      const next = { ...preferences.current, peers: preferences.current.peers.filter((item) => item.deviceId !== peer.deviceId) };
      try { saveDevicePreferences(next); preferences.current = next; setPeers(next.peers); }
      catch (failure) { setError(errorText(failure)); }
    }}><Glyph name="close" size={15} /></button></li>)}</ul> : null}
    {peers.length ? <p className="device-sync-hint">Open Devices on both screens when you want to sync.</p> : null}

    {invite ? <div className="device-sync-invite"><div className="device-sync-qr"><QRCodeSVG value={invite.url} size={232} level="M" marginSize={2} /></div><p>Scan with the other device’s camera.</p><small>One scan · expires {new Date(invite.invite.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small><button type="button" onClick={() => { void navigator.clipboard.writeText(invite.url).then(() => setNotice("Pairing link copied.")).catch(() => setError("Copy the link from the field below.")); }}>Copy pairing link <Glyph name="copy" size={16} /></button><input aria-label="Pairing link" readOnly value={invite.url} onFocus={(event) => event.target.select()} /></div> : null}

    {!joining ? <button type="button" className="device-sync-pair" disabled={busy || Boolean(progress)} onClick={() => void pair()}><Glyph name="plus" size={18} />Pair device</button> : null}
    {!joining && /^(localhost|127\..*|\[::1\])$/.test(location.hostname) ? <label className="device-sync-address">App address on your phone<input type="url" placeholder="https://…" value={appUrl} onChange={(event) => setAppUrl(event.target.value)} disabled={busy || Boolean(progress)} /></label> : null}
    {ready && !busy && !invite ? <p className="device-sync-online"><i />Ready to receive</p> : null}
    {progress ? <div className="device-sync-progress" role="status"><Glyph name="sync" size={18} /><span>{progress.message}</span>{progress.total ? <span>{progress.done}/{progress.total}</span> : null}</div> : null}
    {busy && connection.current ? <button type="button" className="device-sync-cancel" onClick={() => connection.current?.close()}>Cancel transfer</button> : null}
    {error ? <p className="device-sync-error" role="alert">{error}</p> : null}
    {notice ? <p className="device-sync-notice" role="status">{notice}</p> : null}
    {result ? <div className="device-sync-result" role="status"><Glyph name="check" size={22} /><div><strong>{resultLabel}</strong><p>{result.added} changes received · {result.sent} sent · {result.recordings} recordings received</p>{result.conflicts.length ? <details><summary>{result.conflicts.length} preserved conflicts</summary>{result.conflicts.map((conflict, index) => <p key={index}>{conflict.message}</p>)}</details> : null}</div></div> : null}

    {!joining ? <details className="device-sync-link"><summary>Use a pairing link</summary><form onSubmit={(event) => { event.preventDefault(); void join(link); }}><input aria-label="Paste pairing link" value={link} onChange={(event) => setLink(event.target.value)} placeholder="Paste link" disabled={busy || Boolean(progress)} /><button type="submit" disabled={!link.trim() || busy || Boolean(progress)}>Connect <Glyph name="arrow" size={16} /></button></form></details> : null}
    <details className="device-sync-files"><summary>Transfer file <Glyph name="arrow" size={15} /></summary><p>Library, practice history and recordings. Merge the file on either device.</p><div><button type="button" disabled={busy || Boolean(progress) || Boolean(invite)} onClick={() => void exportFile()}><Glyph name="download" size={17} />Save file</button><button type="button" disabled={busy || Boolean(progress) || Boolean(invite)} onClick={() => fileRef.current?.click()}><Glyph name="library" size={17} />Open file</button></div><input ref={fileRef} type="file" hidden accept=".fretpack,application/octet-stream" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void fileAction(async () => finishResult(await importTransferFile(file, updateProgress), "Merged")); }} /></details>
    <p className="device-sync-footnote">Audio input, output and calibration stay with this device.</p>
  </dialog>;
}
