import { lazy, Suspense, useEffect, useSyncExternalStore } from "react";
import { sessionOpen } from "../nav/useGuitarNav";
import { initializeSyncJournal } from "../sync/state";
import { getSyncState, subscribeSyncState } from "../sync/journal";
import { clearStorageError, reportStorageError } from "../storage";
import { isLibraryBusy, subscribeLibraryOperations } from "../tunes/library";
import { Glyph } from "./Glyph";
import "../sync/sync.css";

const DeviceSyncPanel = lazy(() => import("./DeviceSyncPanel"));

export function DeviceSync({ open, onOpenChange, onUpdated }: { open: boolean; onOpenChange: (open: boolean) => void; onUpdated: () => void }) {
  const libraryBusy = useSyncExternalStore(subscribeLibraryOperations, isLibraryBusy);
  useEffect(() => {
    const update = () => {
      const { error } = getSyncState();
      if (error) reportStorageError("sync-history", new Error(error), `${error} Keep this app open and retry saving before syncing.`);
      else clearStorageError("sync-history");
    };
    const unsubscribe = subscribeSyncState(update);
    void initializeSyncJournal().catch(update);
    return unsubscribe;
  }, []);
  return <>
    <button type="button" className="device-sync-trigger" disabled={libraryBusy} title={libraryBusy ? "Wait for the library to finish saving." : undefined} onClick={() => { if (!sessionOpen() && !isLibraryBusy()) onOpenChange(true); }} aria-label="Devices and sync">
      <Glyph name="devices" size={19} /><span>Devices</span>
    </button>
    {open ? <Suspense fallback={<span className="device-sync-loading" role="status">Opening devices…</span>}>
      <DeviceSyncPanel onClose={() => onOpenChange(false)} onUpdated={onUpdated} />
    </Suspense> : null}
  </>;
}
