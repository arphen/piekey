#!/usr/bin/env node
/**
 * Generate docs/REPO_MAP.md: a bounded, deterministic path + symbol index.
 *
 * Usage:
 *   node scripts/generate-repo-map.mjs           # write the map
 *   node scripts/generate-repo-map.mjs --check   # exit 1 if missing or stale
 *
 * The map includes git-tracked and untracked (non-ignored) files, so work in
 * progress is visible without staging it. It never includes file bodies,
 * timestamps, or dependency/build output.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, renameSync, mkdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUTPUT = join(ROOT, "docs", "REPO_MAP.md");
const OUTPUT_REL = "docs/REPO_MAP.md";
const MAX_SYMBOLS = 16;
const MAX_BYTES = 256_000;

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const PATH_ONLY_EXTENSIONS = new Set([".css", ".html", ".json", ".md", ".musicxml", ".txt"]);
const ROOT_FILES = [
  ".gitattributes",
  "AGENTS.md",
  "ASSETS.md",
  "LICENSE",
  "Makefile",
  "PLAN.md",
  "README.md",
  "THIRD_PARTY_NOTICES.md",
  "index.html",
  "package.json",
  "tsconfig.json",
  "vite.config.ts",
];
const EXCLUDED_DIRS = new Set([
  ".git",
  ".claude",
  ".idea",
  ".vscode",
  "node_modules",
  "dist",
  "dist-ssr",
  "coverage",
  "test-results",
  "playwright-report",
  "logs",
  "tmp",
  "temp",
]);

function toPosix(path) {
  return path.split(sep).join("/");
}

function candidateFiles() {
  let listing;
  try {
    listing = execFileSync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
  } catch {
    throw new Error("generate-repo-map: run this inside a git checkout");
  }

  const files = listing
    .split("\0")
    .filter(Boolean)
    .map(toPosix)
    .filter((path) => !path.split("/").some((part) => EXCLUDED_DIRS.has(part)))
    .filter((path) => path !== OUTPUT_REL)
    .filter((path) => {
      const name = path.split("/").pop() ?? path;
      if (name.startsWith(".env") || name === ".DS_Store") return false;
      if (name.toLowerCase().includes("lock")) return false;
      return (
        SOURCE_EXTENSIONS.has(extname(name)) ||
        PATH_ONLY_EXTENSIONS.has(extname(name)) ||
        name === "LICENSE" ||
        ROOT_FILES.includes(path)
      );
    });

  return [...new Set(files)].sort(comparePaths);
}

function compareText(a, b) {
  // Byte-wise comparison keeps the map stable across locales.
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparePaths(a, b) {
  const aGroup = a.includes("/") ? a.split("/")[0] : "";
  const bGroup = b.includes("/") ? b.split("/")[0] : "";
  if (aGroup !== bGroup) return compareText(aGroup, bGroup);
  return compareText(a, b);
}

function isTestFile(rel) {
  return (
    rel.startsWith("src/__tests__/") ||
    /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(rel)
  );
}

function hasExportModifier(node) {
  return Boolean(node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
}

function declarationName(node) {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  return null;
}

function exportedSymbols(rel, text) {
  const scriptKind = rel.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : rel.endsWith(".jsx")
      ? ts.ScriptKind.JSX
      : rel.endsWith(".ts")
        ? ts.ScriptKind.TS
        : ts.ScriptKind.JS;
  const source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, scriptKind);
  const found = [];
  const seen = new Set();

  const add = (name, node) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    found.push([name, line + 1]);
  };

  for (const statement of source.statements) {
    // `export { a, b } from "./x"` is an ExportDeclaration, not a declaration
    // with an export modifier, so handle it before the modifier check.
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          add(element.name.text, element);
        }
      } else if (statement.exportClause && ts.isNamespaceExport(statement.exportClause)) {
        add(statement.exportClause.name.text, statement.exportClause);
      }
      continue;
    }

    if (!hasExportModifier(statement)) continue;

    if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    ) {
      add(declarationName(statement) ?? "default", statement);
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        add(declarationName(declaration), declaration);
      }
      continue;
    }

  }

  return found;
}

function renderNavigation() {
  return [
    "## Navigation",
    "",
    "- `src/App.tsx` — app shell: Practice/Songs/Progress, focused modes, tools, direct practice launches, standalone Free play, scale-explorer key and shared mic input.",
    "- `src/core/` — pure music domain: `contract.ts` shared types, keys/scales, fretboard, patterns, landings, shapes, Roman numerals, tune data.",
    "- `src/musicTheory.ts`, `src/pitchDetection.ts` — shared pitch/note-name primitives and microphone analysis.",
    "- `src/components/` — Practice, Songs, Progress, focused modes and Free play views; shared score, fretboard, session and device controls.",
    "- `src/audio/` — Web Audio playback: context, samples/pluck, metronome, backing band, MIDI export, `usePlayer` transport hook.",
    "- `src/reading/` — legacy deterministic sight-reading generator and levels, retained as score test fixtures.",
    "- `src/song/` — song/coach domain: harmony, cues, deck, fingering, Leitner review, lines, notation, voicings, session/follower hooks.",
    "- `src/tunes/` — MusicXML import/preview/unzip/order, durable library identities, IndexedDB score storage, backups, scoring and playback.",
    "- `src/storage.ts` — visible browser-save failures, pending writes and retry/read-through helpers.",
    "- `src/agent/` — pure, bounded practice-brief projection for explicit user export to an external agent.",
    "- `src/ear/` — ear-training engine, library, theory and session hook.",
    "- `src/listen/` — microphone input, pitch/spectrum analysis, calibration.",
    "- `src/follow/` — own-pace melody follower and hook.",
    "- `src/__tests__/` — Vitest suites; tests are path-only in this map.",
    "- `scripts/` — repository tooling (repo-map generator).",
    "- `tunes/` — local score staging; only its guidance is published.",
    "",
    "Read source to confirm any line hint. Search exact symbol names with `grep`/`rg`",
    "instead of recursively listing directories.",
  ];
}

function render() {
  const lines = [
    "# Repository Map",
    "",
    "Generated by `scripts/generate-repo-map.mjs`; do not edit manually.",
    "Regenerate with `make map-update`; verify with `make map-check`.",
    "",
    ...renderNavigation(),
    "",
    "## Index contract",
    "",
    "Bounded symbol index for TypeScript/JavaScript: top-level exported declarations only",
    "(functions, classes, interfaces, types, enums, variables, re-exports), capped at",
    `${MAX_SYMBOLS} per file with \`+N more\` when truncated. CSS, HTML, JSON, Markdown,`,
    "MusicXML, license texts and tests are path-only. Files over 256 KB are path-only. Paths are sorted",
    "deterministically; the map never contains source bodies or timestamps. Only git-tracked",
    "and untracked non-ignored files are indexed, so dependency/build/cache directories and",
    "local secrets never appear. `--check` exits 1 when the committed map is stale.",
  ];

  let currentGroup = null;
  for (const rel of candidateFiles()) {
    const group = rel.includes("/") ? rel.split("/")[0] : "Root configuration & entry files";
    if (group !== currentGroup) {
      lines.push("", `## ${group}`, "");
      currentGroup = group;
    }

    let detail = "";
    if (!isTestFile(rel) && SOURCE_EXTENSIONS.has(extname(rel))) {
      const absolute = join(ROOT, rel);
      if (statSync(absolute).size <= MAX_BYTES) {
        const found = exportedSymbols(rel, readFileSync(absolute, "utf8"));
        const shown = found.slice(0, MAX_SYMBOLS);
        detail = shown.map(([name, line]) => `\`${name}:${line}\``).join(", ");
        if (found.length > MAX_SYMBOLS) detail += ` (+${found.length - MAX_SYMBOLS} more)`;
      } else {
        detail = "large file; path only";
      }
    }

    lines.push(`- \`${rel}\`` + (detail ? ` — ${detail}` : ""));
  }

  return `${lines.join("\n")}\n`;
}

function main() {
  const check = process.argv.includes("--check");
  const content = render();

  if (check) {
    let existing = "";
    try {
      existing = readFileSync(OUTPUT, "utf8");
    } catch {
      // Missing map is stale.
    }
    if (existing !== content) {
      console.error("Repository map is missing or stale; run `make map-update`.");
      process.exit(1);
    }
    console.log("Repository map is current.");
    return;
  }

  mkdirSync(dirname(OUTPUT), { recursive: true });
  const temporary = `${OUTPUT}.tmp`;
  writeFileSync(temporary, content, { mode: 0o644 });
  renameSync(temporary, OUTPUT);
  console.log(`Wrote ${toPosix(relative(ROOT, OUTPUT))}.`);
}

main();
