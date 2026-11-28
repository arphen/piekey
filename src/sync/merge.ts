import type { TuneEntry } from "../tunes/library";
import { addedRows, canonical, isRecord, parseValue, unionTransactions, validGoalData, validTune, type SyncConflict, type SyncTransaction } from "./model";

type Obj = Record<string, unknown>;
type Path = string[];
interface Reset { tx: SyncTransaction; path: Path }
const obj = (value: unknown): Obj => isRecord(value) ? value : {};
const rows = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const num = (value: unknown, fallback = 0): number => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const owns = (value: Obj, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const sees = (a: SyncTransaction, b: SyncTransaction) => a.id === b.id || (a.context[b.device] ?? 0) >= b.seq;
const concurrent = (a: SyncTransaction, b: SyncTransaction) => !sees(a, b) && !sees(b, a);
const prefix = (a: Path, b: Path) => a.length <= b.length && a.every((part, index) => part === b[index]);
const clone = <T,>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
const BOX_DAYS = [0, 0, 1, 3, 7, 21];

function datePlus(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return day;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function resetPaths(tx: SyncTransaction): Path[] {
  if (tx.reset || tx.after === null) return [[]];
  const before = obj(parseValue(tx.before)), after = obj(parseValue(tx.after));
  const paths: Path[] = [];
  for (const [id, card] of Object.entries(obj(before.cards))) {
    const next = obj(after.cards)[id];
    if (!owns(obj(after.cards), id) || (isRecord(next) && num(next.seen) < num(obj(card).seen))) paths.push(["cards", id]);
  }
  if (tx.key === "guitar-ear-v1") {
    for (const [track, progress] of Object.entries(obj(before.progress))) {
      const previous = obj(progress), next = obj(obj(after.progress)[track]);
      if (owns(next, "mastery") && !Object.keys(obj(next.mastery)).length && Object.keys(obj(previous.mastery)).length) paths.push(["progress", track]);
    }
    if (owns(obj(after.stats), "rounds") && num(obj(after.stats).rounds) < num(obj(before.stats).rounds)) paths.push(["stats"]);
  }
  return paths;
}

function blocked(tx: SyncTransaction, path: Path, resets: readonly Reset[]): boolean {
  return resets.some((reset) => {
    if (!prefix(reset.path, path) || !concurrent(tx, reset.tx)) return false;
    // Concurrent explicit generation boundaries need one deterministic winner. Dropping both
    // would expose the older baseline again.
    if ((tx.reset || tx.after === null) && !reset.path.length)
      return reset.tx.clock > tx.clock || (reset.tx.clock === tx.clock && (reset.tx.device.localeCompare(tx.device) || reset.tx.seq - tx.seq) > 0);
    return true;
  });
}

function patch(current: unknown, before: unknown, after: unknown, tx: SyncTransaction, resets: readonly Reset[], path: Path = []): unknown {
  if (equal(before, after) || blocked(tx, path, resets)) return current;
  const reset = resets.some((entry) => entry.tx.id === tx.id && equal(entry.path, path));
  if (reset) return clone(after);
  if (isRecord(before) && isRecord(after)) {
    const next = { ...obj(current) };
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (blocked(tx, [...path, key], resets)) continue;
      if (!owns(after, key)) delete next[key];
      else next[key] = patch(next[key], before[key], after[key], tx, resets, [...path, key]);
    }
    return next;
  }
  return clone(after);
}

function unionRows(left: unknown, right: unknown): unknown[] {
  return [...rows(left), ...addedRows(rows(left), rows(right))];
}

/** Goals are immutable identities, including independently created first writes. Only the
 * active selection uses transaction order; replacing the collection requires an explicit reset. */
function goals(current: unknown, before: unknown, after: unknown): unknown {
  const byTune = clone(obj(obj(current).byTune));
  const previous = obj(obj(before).byTune);
  for (const [tuneId, raw] of Object.entries(obj(obj(after).byTune))) {
    const bucket = obj(raw), old = obj(previous[tuneId]), have = obj(byTune[tuneId]);
    const entries = { ...obj(have.goals) };
    for (const [id, goal] of Object.entries(obj(bucket.goals))) {
      if (owns(entries, id) && !equal(entries[id], goal))
        throw new Error("Two devices have different content for the same musical goal. Their transactions are retained; export both devices before repairing the goal.");
      entries[id] = clone(goal);
    }
    const activeId = owns(bucket, "activeId") && !equal(old.activeId, bucket.activeId)
      ? bucket.activeId : have.activeId ?? null;
    byTune[tuneId] = { activeId, goals: entries };
  }
  return { v: 1, byTune };
}

/** Legacy aggregates cannot prove whether devices share an ancestor. Keep evidence and flag it. */
function baselineMerge(left: unknown, right: unknown, path: Path = []): unknown {
  if (equal(left, right)) return clone(left);
  if (left === undefined || left === null) return clone(right);
  if (Array.isArray(left) && Array.isArray(right)) return unionRows(left, right);
  if (isRecord(left) && isRecord(right)) {
    if (typeof left.attempts === "number" && typeof right.attempts === "number" && typeof left.score === "number")
      return clone(num(left.attempts) >= num(right.attempts) ? left : right);
    const next = { ...left };
    for (const [key, value] of Object.entries(right)) next[key] = baselineMerge(next[key], value, [...path, key]);
    return next;
  }
  if (typeof left === "number" && typeof right === "number" && ["seen", "clean", "bestCleanBpm", "rounds", "right", "total", "best", "secs"].includes(path[path.length - 1])) return Math.max(left, right);
  return clone(right);
}

function appendHistory(current: unknown, before: unknown, after: unknown, tx: SyncTransaction, field: string): unknown[] {
  const list = [...rows(current)], known = new Set(list.flatMap((row) => typeof obj(row).uid === "string" ? [obj(row).uid] : []));
  addedRows(rows(before), rows(after)).forEach((row, index) => {
    const entry = obj(row), uid = typeof entry.uid === "string" ? entry.uid : `${tx.id}:${field}:${index}`;
    if (!known.has(uid)) { list.push({ ...entry, uid }); known.add(uid); }
  });
  return list;
}

function practice(current: unknown, before: unknown, after: unknown, tx: SyncTransaction, resets: readonly Reset[]): unknown {
  const c = obj(current), b = obj(before), a = obj(after);
  const omit = (value: Obj) => Object.fromEntries(Object.entries(value).filter(([key]) => !["cards", "credit", "history", "sessions"].includes(key)));
  const next = obj(patch(c, omit(b), omit(a), tx, resets));
  const cards = { ...obj(c.cards) }, credit = { ...obj(c.credit) };
  const additions = addedRows(rows(b.history), rows(a.history));
  const selfOnly = !tx.baseline && !tx.reset && additions.length > 0 && additions.every((row) => obj(obj(row).conditions).source === "self");
  for (const id of selfOnly ? [] : new Set([...Object.keys(obj(b.cards)), ...Object.keys(obj(a.cards))])) {
    // The same scale snapshot is written into many tune stores. Only guitar-skills owns it.
    if (tx.key !== "guitar-skills" && id.startsWith("scale:")) continue;
    const path = ["cards", id];
    if (blocked(tx, path, resets)) continue;
    if (!owns(obj(a.cards), id)) { delete cards[id]; continue; }
    const prev = obj(obj(b.cards)[id]), local = obj(obj(a.cards)[id]), have = obj(cards[id]);
    if (resets.some((entry) => entry.tx.id === tx.id && equal(entry.path, path))) { cards[id] = clone(local); continue; }
    const state = { ...obj(patch(have, prev, local, tx, resets, path)) };
    const seen = Math.max(0, num(local.seen) - num(prev.seen));
    const clean = Math.max(0, num(local.clean) - num(prev.clean));
    state.seen = num(have.seen) + seen;
    state.clean = num(have.clean) + clean;
    state.bestCleanBpm = Math.max(num(have.bestCleanBpm), num(local.bestCleanBpm));
    if (!state.bestCleanBpm) delete state.bestCleanBpm;
    const attempts = additions.filter((row) => obj(row).id === id && obj(obj(row).conditions).source !== "self").map(obj);
    let box = num(have.box, 1);
    if (attempts.length) {
      for (const attempt of attempts) box = attempt.result === "fail" ? 1 : attempt.result === "clean" ? Math.min(5, box + 1) : box;
      // Any extra first-play head start is real consumed kinship, rather than another attempt.
      const normal = local.last === "fail" ? 1 : local.last === "clean" ? Math.min(5, num(prev.box, 1) + clean) : num(prev.box, 1);
      box = Math.min(5, box + Math.max(0, num(local.box) - normal));
    } else if (seen) box = local.last === "fail" ? 1 : local.last === "clean" ? Math.min(5, box + clean) : box;
    else box = Math.max(1, Math.min(5, box + num(local.box) - num(prev.box, 1)));
    state.box = box;
    if (state.excluded === true) {
      state.due = "9999-12-31";
    } else if (typeof local.due === "string") {
      const day = typeof attempts[attempts.length - 1]?.day === "string" ? attempts[attempts.length - 1].day as string
        : datePlus(local.due, -BOX_DAYS[Math.max(1, Math.min(5, num(local.box, 1)))]);
      state.due = datePlus(day, BOX_DAYS[box]);
    }
    cards[id] = state;
  }
  for (const id of selfOnly ? [] : new Set([...Object.keys(obj(b.credit)), ...Object.keys(obj(a.credit))])) {
    if (tx.key !== "guitar-skills" && id.startsWith("scale:")) continue;
    if (blocked(tx, ["cards", id], resets)) continue;
    if (!owns(obj(a.credit), id)) { delete credit[id]; continue; }
    let amount = Math.max(0, Math.min(2, num(credit[id]) + num(obj(a.credit)[id]) - num(obj(b.credit)[id])));
    const state = obj(cards[id]);
    // Concurrent small credits can together cross the next box even if neither device did.
    if (amount >= 1 && Object.keys(state).length && num(state.box) < 5) {
      const box = num(state.box, 1) + 1;
      const local = obj(obj(a.cards)[id]);
      const day = typeof local.due === "string" ? datePlus(local.due, -BOX_DAYS[num(local.box, 1)]) : new Date(tx.at).toISOString().slice(0, 10);
      cards[id] = { ...state, box, due: datePlus(day, BOX_DAYS[box]) };
      amount -= 1;
    }
    credit[id] = Math.round(amount * 100) / 100;
  }
  next.cards = cards;
  if (owns(c, "credit") || owns(a, "credit")) next.credit = credit;
  if (tx.key !== "guitar-skills") {
    next.history = appendHistory(c.history, b.history, a.history, tx, "attempt");
    next.sessions = appendHistory(c.sessions, b.sessions, a.sessions, tx, "session");
  }
  return next;
}

function freeplay(current: unknown, before: unknown, after: unknown): unknown {
  const next = rows(current).map((row) => ({ ...obj(row) }));
  const identity = (row: Obj) => `${row.day}\0${row.key}\0${row.pattern}`;
  const previous = new Map(rows(before).map((row) => [identity(obj(row)), obj(row)]));
  for (const value of rows(after)) {
    const row = obj(value), old = previous.get(identity(row)) ?? {};
    if (equal(row, old)) continue;
    const found = next.find((entry) => identity(entry) === identity(row));
    const secs = Math.max(0, num(row.secs) - num(old.secs));
    if (!found) next.push({ ...row, secs });
    else {
      found.secs = num(found.secs) + secs;
      if (num(row.bpm) * num(row.division) > num(found.bpm) * num(found.division)) { found.bpm = row.bpm; found.division = row.division; }
    }
  }
  return next;
}

/** Recover the small original response sequence, then replay using the merged attempt count. */
function answers(before: Obj, after: Obj): boolean[] | null {
  const count = num(after.attempts) - num(before.attempts);
  if (!Number.isInteger(count) || count < 1 || count > 12) return null;
  const initial = num(before.score, 0.5), start = num(before.attempts);
  const search = (remaining: number, score: number): boolean[] | null => {
    if (!remaining) return Math.abs(score - initial) < 1e-7 ? [] : null;
    const alpha = start + remaining - 1 < 4 ? 0.35 : 0.18;
    for (const correct of [false, true]) {
      const previous = (score - alpha * Number(correct)) / (1 - alpha);
      if (previous < -1e-7 || previous > 1 + 1e-7) continue;
      const sequence = search(remaining - 1, previous);
      if (sequence) return [...sequence, correct];
    }
    return null;
  };
  return search(count, num(after.score, initial));
}

function ear(current: unknown, before: unknown, after: unknown, tx: SyncTransaction, resets: readonly Reset[]): unknown {
  const c = obj(current), b = obj(before), a = obj(after);
  const next = obj(patch(c, b, a, tx, resets));
  for (const [track, value] of Object.entries(obj(a.progress))) {
    const path = ["progress", track];
    if (blocked(tx, path, resets) || resets.some((reset) => reset.tx.id === tx.id && equal(reset.path, path))) continue;
    const old = obj(obj(b.progress)[track]), update = obj(value), have = obj(obj(c.progress)[track]);
    const progress = obj(obj(next.progress)[track]);
    const mastery = { ...obj(have.mastery) };
    for (const [id, value] of Object.entries(obj(update.mastery))) {
      const was = obj(obj(old.mastery)[id]), result = obj(value), present = obj(mastery[id]);
      const delta = Math.max(0, num(result.attempts) - num(was.attempts));
      if (!delta) { mastery[id] = result; continue; }
      let score = num(present.score, 0.5), attempts = num(present.attempts);
      const sequence = answers(was, result);
      if (sequence) for (const correct of sequence) {
        const alpha = attempts < 4 ? 0.35 : 0.18;
        score += alpha * (Number(correct) - score); attempts++;
      } else {
        let factor = 1;
        for (let i = 0; i < delta; i++) factor *= 1 - (num(was.attempts) + i < 4 ? 0.35 : 0.18);
        score = Math.max(0, Math.min(1, factor * score + num(result.score) - factor * num(was.score, 0.5)));
        attempts += delta;
      }
      mastery[id] = { score, attempts };
    }
    progress.mastery = mastery;
    const confusion = { ...obj(have.confusion) };
    for (const [id, count] of Object.entries(obj(update.confusion))) confusion[id] = num(confusion[id]) + Math.max(0, num(count) - num(obj(old.confusion)[id]));
    progress.confusion = confusion;
    if (owns(update, "recent")) progress.recent = [...rows(have.recent), ...addedRows(rows(old.recent), rows(update.recent))].slice(-20);
    obj(next.progress)[track] = progress;
  }
  if (!blocked(tx, ["stats"], resets) && !resets.some((reset) => reset.tx.id === tx.id && equal(reset.path, ["stats"]))) {
    const have = obj(c.stats), old = obj(b.stats), update = obj(a.stats), stats = obj(next.stats);
    if (owns(update, "rounds")) stats.rounds = num(have.rounds) + Math.max(0, num(update.rounds) - num(old.rounds));
    const names = { ...obj(have.names) };
    for (const key of ["right", "total"]) if (owns(obj(update.names), key)) names[key] = num(names[key]) + Math.max(0, num(obj(update.names)[key]) - num(obj(old.names)[key]));
    stats.names = names;
    if (owns(update, "streak")) stats.streak = num(update.streak) === 0 ? 0 : num(have.streak) + Math.max(0, num(update.streak) - num(old.streak));
    stats.best = Math.max(num(have.best), num(update.best), num(stats.streak));
    next.stats = stats;
  }
  return next;
}

function changedFields(tx: SyncTransaction): string[] {
  return [...new Set([...Object.keys(obj(parseValue(tx.before))), ...Object.keys(obj(parseValue(tx.after)))])];
}

function tuneAt(all: readonly SyncTransaction[], end: SyncTransaction): TuneEntry | null {
  let value: unknown = null;
  for (const tx of all) if (tx.kind === "tune" && tx.key === end.key && sees(end, tx)) {
    value = tx.after === null ? null : tx.delta ? patch(value, parseValue(tx.before), parseValue(tx.after), tx, []) : parseValue(tx.after);
  }
  return validTune(value) ? value : null;
}

export interface Projection { storage: Map<string, string | null>; tunes: TuneEntry[]; conflicts: SyncConflict[] }

/** A replay is a pure function of the immutable set, independent of exchange order or clocks. */
export function projectTransactions(input: readonly SyncTransaction[]): Projection {
  const all = unionTransactions([], input);
  const groups = new Map<string, SyncTransaction[]>();
  for (const tx of all) { const key = `${tx.kind}:${tx.key}`; groups.set(key, [...(groups.get(key) ?? []), tx]); }
  const storage = new Map<string, string | null>(), tunes = new Map<string, TuneEntry>(), conflicts: SyncConflict[] = [];
  for (const group of groups.values()) {
    const { kind, key } = group[0];
    const allResets: Reset[] = group.filter((tx) => !tx.baseline).flatMap((tx) => resetPaths(tx).map((path) => ({ tx, path })));
    const boundaries = allResets.filter((reset) => !reset.path.length);
    const boundary = boundaries[boundaries.length - 1];
    // A whole-store replacement supersedes earlier generations and concurrent losing resets.
    // Their boundaries must not block practice that observes the winning replacement.
    const resets = boundary
      ? [boundary, ...allResets.filter((reset) => reset.path.length && sees(reset.tx, boundary.tx))]
      : allResets;
    let value: unknown = null;
    const baselines = group.filter((tx) => tx.baseline), unique = new Set<string>();
    for (const tx of baselines) {
      const baseline = parseValue(tx.after), identity = canonical(baseline);
      if (unique.has(identity)) continue;
      if (unique.size && kind === "storage") conflicts.push({ kind: "legacy", key, message: "Both devices already had different history before transaction recording. Original snapshots are retained; overlapping legacy totals need review.", transactionIds: baselines.map((entry) => entry.id) });
      value = key === "guitar-goals-v1" ? goals(value, null, baseline)
        : value === null ? clone(baseline) : baselineMerge(value, baseline);
      unique.add(identity);
    }
    for (const tx of group.filter((entry) => !entry.baseline)) {
      if (blocked(tx, [], resets)) {
        const restore = resets.find((reset) => reset.tx.reset && concurrent(tx, reset.tx));
        if (restore && kind === "storage") conflicts.push({ kind: "legacy", key,
          message: "A backup restore replaced this store. Concurrent offline changes remain in transaction history for review.", transactionIds: [restore.tx.id, tx.id] });
        continue;
      }
      if (tx.reset) { value = clone(parseValue(tx.after)); continue; }
      if (tx.after === null) { value = null; continue; }
      const before = parseValue(tx.before), after = parseValue(tx.after);
      if (kind === "tune") value = tx.delta ? patch(value, before, after, tx, resets) : clone(after);
      else if (key.startsWith("guitar-song-deck:") || key === "guitar-skills") value = practice(value, before, after, tx, resets);
      else if (key === "guitar-freeplay") value = freeplay(value, before, after);
      else if (key === "guitar-ear-v1") value = ear(value, before, after, tx, resets);
      else if (key === "guitar-goals-v1") value = goals(value, before, after);
      else if (key.startsWith("guitar-learn:")) {
        value = patch(value, before, after, tx, resets);
        if (isRecord(value)) value.done = unionRows(obj(value).done, obj(after).done);
      } else value = patch(value, before, after, tx, resets);
    }
    if (kind === "storage") {
      if (key === "guitar-goals-v1" && value !== null && !validGoalData(value))
        throw new Error("The combined musical goals exceed the supported limits or need repair. No goals were discarded. Export both devices before changing their goals.");
      storage.set(key, value === null ? null : typeof value === "string" ? value : canonical(value));
    }
    else {
      if (validTune(value)) tunes.set(key, value);
      const edits = group.filter((tx) => !tx.baseline);
      const variants = new Set<string>();
      for (let i = 0; i < edits.length; i++) for (let j = i + 1; j < edits.length; j++) {
        const a = edits[i], b = edits[j];
        if (!concurrent(a, b)) continue;
        const overlap = a.after === null || b.after === null || changedFields(a).some((field) => changedFields(b).includes(field));
        const left = tuneAt(group, a), right = tuneAt(group, b);
        if (!overlap || equal(left, right)) continue;
        conflicts.push({ kind: "tune", key, message: "Concurrent score edits were kept as separate library copies.", transactionIds: [a.id, b.id] });
        for (const [tx, entry] of [[a, left], [b, right]] as const) {
          if (!entry || equal(entry, value) || variants.has(tx.id)) continue;
          const id = `${key}~${tx.device}-${tx.seq}`;
          tunes.set(id, { ...entry, id, name: `${entry.name} (other device)` }); variants.add(tx.id);
        }
      }
      // Divergent pre-journal arrangements are also real music: preserve each one by identity.
      for (const tx of baselines) {
        const entry = parseValue(tx.after);
        if (validTune(entry) && validTune(value) && !equal(entry, value) && baselines.length > 1
          && !edits.some((edit) => sees(edit, tx))) {
          const id = `${key}~${tx.device}-${tx.seq}`;
          tunes.set(id, { ...entry, id, name: `${entry.name} (other device)` });
          conflicts.push({ kind: "tune", key, message: "Different existing versions of this score were preserved.", transactionIds: [tx.id] });
        }
      }
    }
  }
  return { storage, tunes: [...tunes.values()].sort((a, b) => a.id.localeCompare(b.id)), conflicts };
}
