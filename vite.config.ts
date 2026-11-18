import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const sourceUrl = (() => {
  try {
    const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return `https://github.com/arphen/piekey/tree/${revision}`;
  } catch { return "https://github.com/arphen/piekey"; }
})();

/** Ship complete license texts alongside browser code, including in the offline cache. */
function releaseNotices(): Plugin {
  return {
    name: "fretboard-release-notices",
    apply: "build",
    generateBundle() {
      const files = new Map<string, string>([
        ["LICENSE.txt", readFileSync(join(projectRoot, "LICENSE"), "utf8")],
        ["THIRD_PARTY_NOTICES.md", readFileSync(join(projectRoot, "THIRD_PARTY_NOTICES.md"), "utf8")],
        ["ASSETS.md", readFileSync(join(projectRoot, "ASSETS.md"), "utf8")],
      ]);
      const collect = (relative: string) => {
        for (const entry of readdirSync(join(projectRoot, relative), { withFileTypes: true })) {
          const path = `${relative}/${entry.name}`;
          if (entry.isDirectory()) collect(path);
          else if (entry.isFile()) files.set(path, readFileSync(join(projectRoot, path), "utf8"));
          else throw new Error(`Release notices must be ordinary files: ${path}`);
        }
      };
      collect("notices");
      for (const [name, source] of files) this.emitFile({ type: "asset", fileName: `licenses/${name}`, source });
      const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
      const links = [...files.keys()].sort().map((name) => `<li><a href="${name.split("/").map(encodeURIComponent).join("/")}">${escape(name)}</a></li>`).join("\n");
      this.emitFile({ type: "asset", fileName: "licenses/index.html", source: `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Licenses · Fretboard Focus Lab</title>
<style>body{max-width:72ch;margin:3rem auto;padding:0 1.25rem;font:16px/1.6 system-ui;background:#141714;color:#e9e8df}a{color:#cbd2b7}li{margin:.4rem 0;overflow-wrap:anywhere}</style>
<h1>Licenses</h1>
<p>Copyright © 2026 Fretboard Focus Lab contributors.</p>
<p>This program is free software under GNU Affero GPL version 3 only. You may redistribute and modify it under those terms. It comes with no warranty, including merchantability or fitness for a particular purpose. See the <a href="LICENSE.txt">full license</a>.</p>
<p><a href="${escape(sourceUrl)}">Corresponding source code</a>. Third-party libraries and fonts keep their own copyright notices and licenses, preserved below. Imported scores remain the user's material and are not relicensed by the app.</p>
<ul>${links}</ul></html>` });
    },
  };
}

/** Build the offline shell from the final asset list, including imported images and split chunks. */
function offlineShell(): Plugin {
  return {
    name: "fretboard-offline-shell",
    apply: "build",
    enforce: "post",
    generateBundle(_, bundle) {
      const assets = Object.keys(bundle).filter((name) => !name.endsWith(".map"));
      assets.push("manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png");
      // Every deployment gets its own complete cache, including public files with stable names.
      const revision = Date.now().toString(36);
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: `const ROOT = new URL("./", self.location.href);
const PREFIX = "fretboard-shell:" + ROOT.pathname + ":";
const CACHE = PREFIX + "${revision}";
const ASSETS = ${JSON.stringify(assets.sort())}.map(path => new URL(path, ROOT).href);
const SHELL = new URL("index.html", ROOT).href;

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(
    ASSETS.map(url => new Request(url, { cache: "reload" }))
  )));
});

// Leave an update waiting until every old app window closes. Never reload a practice session.
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key))
  )));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  if (ASSETS.includes(url.href)) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(request)).then(cached => cached || fetch(request)));
  } else if (request.mode === "navigate") {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(SHELL)).then(cached => cached || fetch(request)));
  }
});
`,
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), releaseNotices(), offlineShell()],
  define: { "import.meta.env.VITE_SOURCE_URL": JSON.stringify(sourceUrl) },
});
