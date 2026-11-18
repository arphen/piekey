/// <reference types="vite/client" />

/** Production only; updates wait for all app windows to close and never interrupt practice. */
export function registerOfflineShell(): void {
  if (!import.meta.env.PROD || !window.isSecureContext || !("serviceWorker" in navigator)) return;
  const register = () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
      updateViaCache: "none",
    }).then((registration) => {
      window.addEventListener("online", () => { void registration.update().catch(() => undefined); });
    }).catch(() => {
      // The app still works online when offline storage is unavailable or disallowed.
    });
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
