/**
 * Small durable records, one JSON file each, beside the process that made them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DELIBERATELY NO `import "server-only"`, THOUGH THIS IS SERVER-ONLY CODE
 *
 * `server-only` throws the moment it is evaluated outside a Next server build,
 * and `scripts/verify-*.ts` reach the stores that use this module through `tsx`
 * — where it is not there to be imported. Adding the guard would trade a real
 * safety net for breaking every verification script in the repo, which is the
 * same trade lib/splatJobs.ts already declined for the same reason.
 *
 * The boundary is held by the import graph instead: nothing under
 * `components/` imports a store that imports this, and `node:fs` in a client
 * bundle is a build error rather than a silent leak. Check before adding a
 * caller.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PROBLEM THIS SOLVES, IN ONE SENTENCE
 *
 * Nine of this app's ten stores are `globalThis` singletons, so a server
 * restart erases every journey, walk, album and posted trip while the videos
 * they describe sit untouched on disk. A journey hands out a link —
 * `/journey/<id>` — and that link 404s after any redeploy. Handing someone a
 * URL that will stop working is the same class of promise-you-cannot-keep this
 * codebase is otherwise careful about.
 *
 * `lib/splatJobs.ts` already solved this for its own records and its header
 * explains why it had to: eight dev-server restarts in one afternoon orphaned a
 * 105 MB recording. This is that pattern, extracted so the other stores can use
 * it without each reinventing the failure modes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS NOT
 *
 * It is NOT a database, and it does not pretend to be one. There are no
 * queries, no indexes, no transactions across records, and no story for two
 * processes writing at once. It is durability for a single-process,
 * single-machine deployment — which is what this app currently IS: the studio
 * runs on localhost, clips live in `.uploads`, splats live in
 * `public/mock/splats`.
 *
 * **On a serverless host with an ephemeral filesystem this buys you nothing.**
 * Vercel gives each invocation its own disk, so records written by one request
 * are not there for the next. Real multi-instance production needs the Supabase
 * schema in `supabase/migrations/`, which is written and not yet wired. This
 * makes the single-machine case correct and does not stand in the way of that:
 * every caller goes through `hydrate`/`persist`/`forget`, which is exactly the
 * seam a repository swap replaces.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BEST EFFORT, ALWAYS. NEVER FATAL.
 *
 * A record that cannot be written must not fail the request that created it.
 * The in-memory store is still correct for this process, the user's action
 * still happened, and turning a full disk into a 500 on a journey someone just
 * built is a worse outcome than losing durability for it. So every function
 * here swallows its errors and the caller keeps its Map. The cost is that
 * persistence is invisible when it fails, which is why `persistedCount` exists
 * — a caller that wants to know can look.
 *
 * READS ARE VALIDATED, NEVER TRUSTED. A sidecar is a file on disk that any
 * process, or a half-finished write from a previous build, could have produced.
 * `hydrate` hands every record to a parser supplied by the caller and drops
 * whatever fails, because a store repopulated with malformed records is worse
 * than an empty one: the malformed ones are reachable by URL.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

/**
 * Where sidecars live. Sibling of `.uploads`, gitignored for the same reason:
 * these are records of one machine's activity, not source.
 */
export const DATA_ROOT = path.join(process.cwd(), ".data");

/** Ids reach the filesystem, so they are fenced rather than trusted. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * A directory per store. Created lazily — a store nobody has written to should
 * not leave an empty folder behind.
 */
export function storeDir(name: string): string {
  return path.join(DATA_ROOT, name);
}

function ensure(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Write one record, atomically.
 *
 * Temp file then rename, because `hydrate` can run at any moment — including
 * while this is writing — and a half-written JSON file is a record that parses
 * as garbage or not at all. Rename is atomic within a filesystem, so a reader
 * sees either the old file or the new one and never a torn one. Same reasoning
 * as `pipeline.publish` staging a .ply before moving it into place.
 */
export function persist(name: string, id: string, value: unknown): boolean {
  if (!SAFE_ID.test(id)) return false;
  const dir = storeDir(name);
  if (!ensure(dir)) return false;
  const target = path.join(dir, `${id}.json`);
  const staging = `${target}.tmp`;
  try {
    writeFileSync(staging, JSON.stringify(value), "utf8");
    renameSync(staging, target);
    return true;
  } catch {
    try {
      rmSync(staging, { force: true });
    } catch {
      /* the temp file is litter, not a failure worth reporting */
    }
    return false;
  }
}

/** Drop one record. A record that was never there is not an error. */
export function forget(name: string, id: string): boolean {
  if (!SAFE_ID.test(id)) return false;
  try {
    rmSync(path.join(storeDir(name), `${id}.json`), { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Read every record back, dropping the ones that do not parse.
 *
 * `parse` returns the record or null, and null means "this is not one of mine"
 * — a shape from an older build, a truncation, a file someone dropped in. Those
 * are skipped silently and left on disk rather than deleted: they cost nothing,
 * and deleting data we failed to understand is not a decision this function
 * should be making on its own.
 */
export function hydrate<T>(name: string, parse: (raw: unknown) => T | null): T[] {
  const dir = storeDir(name);
  if (!existsSync(dir)) return [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const file of names) {
    if (!file.endsWith(".json")) continue; // skips .tmp mid-write
    try {
      const raw: unknown = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
      const record = parse(raw);
      if (record !== null) out.push(record);
    } catch {
      continue;
    }
  }
  return out;
}

/** How many records are actually on disk. For callers that want to be sure. */
export function persistedCount(name: string): number {
  const dir = storeDir(name);
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

/**
 * Delete a whole store's records. Tests only — never call this from a route.
 * Named to be conspicuous in a diff for exactly that reason.
 */
export function __wipeStore(name: string): void {
  try {
    rmSync(storeDir(name), { recursive: true, force: true });
  } catch {
    /* nothing to wipe */
  }
}
