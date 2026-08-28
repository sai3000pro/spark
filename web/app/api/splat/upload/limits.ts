/**
 * What stops one client from filling this disk, today, with no account system.
 *
 * /api/splat/upload takes up to a gigabyte per request, unauthenticated, and
 * writes it into a directory Next serves statically. Nothing above it says how
 * many times. A `while true; do curl --data-binary @walk.ply ...; done` fills a
 * laptop in the time it takes to notice, and the app's own captures go down
 * with it because they live in the same directory.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT AUTHENTICATION
 *
 * The obvious answer is "make them log in", and it is not available. Supabase
 * is not configured in this checkout — lib/db/config.ts returns null and
 * .env.local carries a KIRI key and nothing else — so an auth layer written
 * here would be a layer nobody could run, test, or trust. Untestable security
 * code is worse than none: it looks like the problem is handled.
 *
 * So this file does the part that CAN be done and verified on a machine with no
 * database: a ceiling on total bytes, a ceiling on requests per window, and a
 * ceiling on how many uploads may be in flight at once. All three are per
 * process and in memory, which is the honest scope — restart the server and the
 * request counters reset, while the DISK ceiling does not, because it is
 * derived by looking at the directory rather than remembered. That asymmetry is
 * deliberate: the limit that protects the machine survives a restart, and the
 * limit that only smooths traffic does not need to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE AUTHENTICATION GOES — `identifyUploader`
 *
 * One function, called once, returning the key everything else is counted
 * against. Today that key is a network address, because an address is the only
 * thing an anonymous request carries. When there are accounts, that function is
 * the whole change: it becomes async, reads the session, and returns a stable
 * user id — and the rate limiter, having always been keyed on whatever it
 * returned, starts counting per person instead of per address without another
 * line moving.
 *
 * What it will need, concretely, and what none of it can be built against yet:
 *
 *   - a session to read (a cookie, or an Authorization header on the studio
 *     executable's `--push`, which is a CLI and has no cookie jar)
 *   - somewhere to look the session up that is not this process, or the limits
 *     go back to being per-process the moment there are two of them
 *   - per-user quota rather than one global byte budget, since the budget below
 *     is a property of the disk and a quota is a property of a person
 *   - a decision about anonymous uploads: keeping them means keeping every
 *     limit in this file as the floor, and the address key alongside the user
 *     key rather than instead of it
 *
 * Nothing here is a placeholder for that. Every function below is used and does
 * something today; an abstraction waiting for a feature that does not exist
 * would just be code nobody can check.
 */
import { readdirSync, statSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { SPLAT_EXTENSIONS } from "@/lib/splat/extensions";
import { SPLAT_DIR } from "@/lib/splat/store";

/**
 * The ceiling on a single splat.
 *
 * Higher than the 512 MB video limit on /api/splat/jobs, and deliberately so:
 * that limit is about an upload that has to survive a phone's connection, while
 * this one is usually a local file moving over localhost. A 4-million-gaussian
 * export at full spherical-harmonic detail is around 900 MB, and refusing it
 * would refuse the best output the studio can produce.
 */
/*
  THE CEILING IS NOT OURS TO SET ON EVERY HOST.

  A gigabyte is the right number for a splat arriving over localhost, and it is
  fiction on a serverless platform: Vercel caps a serverless function's request
  body at 4.5 MB, and the request is rejected by the platform before this code
  runs at all. Advertising 1024 MB there would mean a limit nobody can reach and
  a refusal nobody can explain — the upload dies with a platform error naming
  neither the real limit nor a way around it.

  So the number is the smaller of what we want and what the host allows. On a
  laptop nothing changes. On Vercel the panel and the refusals both say 4 MB,
  which is true and is at least actionable: it tells you this deployment cannot
  be the one that takes your captures.

  Kept slightly under the platform's own figure. 4.5 MB is the ceiling on the
  whole request, and a multipart body carries boundaries and headers a file does
  not; refusing at 4 MB is a refusal WE can word, rather than one the platform
  words for us.
*/
const SERVERLESS_BODY_LIMIT_BYTES = 4 * 1024 * 1024;
const PREFERRED_MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

export const MAX_UPLOAD_BYTES =
  process.env.VERCEL === "1" || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME
    ? SERVERLESS_BODY_LIMIT_BYTES
    : PREFERRED_MAX_UPLOAD_BYTES;

/** Below this there is no plausible splat — it is a stray or an empty file. */
export const MIN_UPLOAD_BYTES = 256;

/**
 * Total bytes of UPLOADED splats this app will keep on disk.
 *
 * Six gigabytes. The arithmetic behind that number:
 *
 *   - the two real captures in this repo are 59 MB and 143 MB, so a typical
 *     one is well under 200 MB and six gigabytes is thirty-odd of them
 *   - the per-file ceiling is 1 GB, so the worst case is six maximum-size
 *     exports rather than a number that sounds large and admits two
 *   - it is small enough to matter on a laptop with a demo on it, which is the
 *     machine this actually runs on, and large enough that no honest session of
 *     adding captures will ever reach it
 *
 * Counting is done by LOOKING at the directory, not by keeping a running total,
 * for the same reason readiness is derived rather than flagged: somebody who
 * deletes a capture by hand should get the space back immediately, and a
 * counter would insist the disk was still full.
 */
export const SPLAT_STORE_BUDGET_BYTES = 6 * 1024 * 1024 * 1024;

/**
 * Requests per window, per uploader.
 *
 * Twenty in ten minutes. A person adding captures by hand does perhaps five in
 * a sitting and would have to be unusually busy to reach ten; a loop reaches
 * twenty in under a second. The window is long enough that the limit is about
 * sustained abuse rather than about someone retrying a failed upload three
 * times in a row, which is a thing people legitimately do.
 *
 * Refused uploads count. They still cost a connection, a temp file and a scan
 * of the directory, and a client that has been told "no" a hundred times is
 * exactly the client this is for.
 */
export const RATE_LIMIT_UPLOADS = 20;
export const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

/**
 * Uploads allowed in flight at once, across all uploaders.
 *
 * Four. Each one may be holding up to MAX_UPLOAD_BYTES of temp file, so this is
 * what bounds the transient disk on top of the stored budget: four gigabytes in
 * the very worst case, which the budget check below already accounts for
 * because in-flight bytes are counted against it. Four is also more parallel
 * uploads than a single person's browser will ever open.
 */
export const MAX_CONCURRENT_UPLOADS = 4;

/**
 * How long an abandoned temp file is left alone before it is swept.
 *
 * Six hours, and the number is set by the slowest upload that could still be
 * genuine rather than by how long rubbish deserves to sit: a 1 GB export over a
 * 500 kbit link takes about four and a half hours, and deleting the temp file
 * out from under a transfer that is still running is a far worse outcome than
 * leaving a dead one around for an afternoon.
 *
 * Temps are swept at all because a process killed mid-upload leaves its
 * `.uploading-*.tmp` behind forever, and those bytes count against the budget —
 * so without this, enough hard restarts eventually refuse every upload with
 * "the store is full" over files nothing will ever finish writing.
 */
export const TEMP_STALE_MS = 6 * 60 * 60 * 1000;

/** Prefix of an upload in progress. Nothing serves these and no job derives from one. */
const TEMP_PREFIX = ".uploading-";
const TEMP_SUFFIX = ".tmp";

// ─────────────────────────────────────────────────────────────────────────────
// Who is asking
// ─────────────────────────────────────────────────────────────────────────────

export interface Uploader {
  /** The rate-limit key. Opaque to everything else in this file. */
  key: string;
  /** What that key IS, so a refusal can be honest about how coarse it is. */
  kind: "address" | "shared";
}

/**
 * The identity to count this request against — the auth seam.
 *
 * An address today, and the header of this file describes what replaces it.
 * Read from the forwarding headers rather than the socket because Next's
 * Request does not expose a socket, and because in every deployment that has a
 * proxy the socket address is the proxy's.
 *
 * `x-forwarded-for` is a claim by whoever sent it and is trivially spoofed by
 * anyone who wants a fresh bucket per request. That is a real limit on what
 * this can promise, and it is not a reason to skip it: the client this stops is
 * the accidental one — a retry loop, a script left running, a page with a bug
 * in it — and those do not forge headers. The byte budget is what stands
 * between a deliberate attacker and the disk, and that one cannot be spoofed
 * because it is measured rather than attributed.
 *
 * With no forwarding headers at all, everyone shares one bucket. That is the
 * honest degradation for a local dev server, where "everyone" is one person.
 */
export function identifyUploader(request: Request): Uploader {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  const real = request.headers.get("x-real-ip")?.trim();
  const addr = first || real;
  if (addr) return { key: addr, kind: "address" };
  return { key: "local", kind: "shared" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Process-wide state
//
// On globalThis under a Symbol, matching lib/splatJobs.ts. Next's dev server
// re-evaluates modules on edit, and module-level `const` would give every
// recompile a fresh, empty rate limiter — which is to say no rate limiter at
// all for anyone editing the app while it runs.
// ─────────────────────────────────────────────────────────────────────────────

interface InFlight {
  /** Bytes written so far by this upload. Updated as it streams. */
  bytes: number;
}

interface LimitState {
  /** Uploader key → request timestamps inside the current window. */
  hits: Map<string, number[]>;
  inFlight: Set<InFlight>;
}

const KEY = Symbol.for("spark.splatUpload.limits");

function state(): LimitState {
  const g = globalThis as unknown as Record<symbol, LimitState | undefined>;
  const existing = g[KEY];
  if (existing) return existing;
  const fresh: LimitState = { hits: new Map(), inFlight: new Set() };
  g[KEY] = fresh;
  return fresh;
}

// ─────────────────────────────────────────────────────────────────────────────
// Disk
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bytes of uploaded splats on disk, plus the temps of uploads in progress.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS COUNTED, AND WHY THE MOCKS ARE NOT
 *
 * public/mock/splats holds two different things: captures that arrived through
 * this endpoint (`splat_<id>.<ext>`, which is the id shape `mintId` produces)
 * and the authored mock captures checked into the repo. The mocks are 322 MB
 * and they are scenery — committed, fixed, and never growing. Counting them
 * would mean a fixed 322 MB of the budget is spent before anyone uploads
 * anything, and worse, that the meaning of the number changes if someone adds
 * a mock. The budget is about growth this endpoint causes, so it measures
 * exactly that.
 *
 * Temps count. They are bytes on the disk right now, and an upload in progress
 * is the most real claim on space there is.
 *
 * A readdir plus a stat per file, on every upload. That is a few dozen syscalls
 * against a request that is about to move hundreds of megabytes, and it buys
 * the property that matters: the number is what is actually there, so deleting
 * a capture by hand frees the space with nothing to tell.
 */
export function storedUploadBytes(): number {
  let entries: string[];
  try {
    entries = readdirSync(SPLAT_DIR);
  } catch {
    return 0; // No directory yet is zero bytes, not an error.
  }

  let total = 0;
  for (const name of entries) {
    const isTemp = name.startsWith(TEMP_PREFIX) && name.endsWith(TEMP_SUFFIX);
    // `extname` rather than a suffix test: ".ksplat" ends with "splat", so
    // `endsWith` is only correct while the list stays in one particular order.
    const isUpload =
      name.startsWith("splat_") && SPLAT_EXTENSIONS.includes(path.extname(name).toLowerCase());
    if (!isTemp && !isUpload) continue;
    try {
      total += statSync(path.join(SPLAT_DIR, name)).size;
    } catch {
      // Vanished between readdir and stat. Zero bytes is the right answer.
    }
  }
  return total;
}

/**
 * A temp path nothing serves and no job derives from.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A UUID AND NOT A TIMESTAMP
 *
 * This was `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, and both
 * halves are weaker than they look. `Math.random().toString(36)` is not a
 * fixed-length string — a value like 0.5 renders as "0.i", so `.slice(2, 8)`
 * can return a single character — and Math.random is not required to differ
 * between two calls in the same tick. Two concurrent uploads landing on one
 * temp name is not a slow path or a bad error message: both streams write into
 * the same file, the first rename wins, and the winner gets a splat with the
 * other upload's bytes interleaved through it. It would pass the header check,
 * because the header belongs to whichever stream wrote first.
 *
 * `randomUUID` is 122 bits from the platform CSPRNG and cannot collide in
 * practice. The timestamp stays because it makes an abandoned temp file
 * readable to a person deciding whether to delete it.
 *
 * In SPLAT_DIR rather than the system temp directory, so the final step is a
 * rename WITHIN a directory. A rename across filesystems is a copy plus a
 * delete — not atomic, and on a 500 MB file not fast — which would reintroduce
 * the window where a half-written file sits under the served name.
 */
export function tempUploadPath(): string {
  return path.join(
    SPLAT_DIR,
    `${TEMP_PREFIX}${Date.now().toString(36)}-${randomUUID()}${TEMP_SUFFIX}`,
  );
}

/**
 * Drop temp files old enough that nothing could still be writing them.
 *
 * Bounded and lazy, on the same principle as `sweepUploads` in lib/splatJobs.ts:
 * no cron, no timer to leak, and the work happens when something is already
 * happening. Age alone is the test, because a temp file whose request died has
 * nothing left to consult about it.
 */
export function sweepStaleTemps(now = Date.now()): number {
  let entries: string[];
  try {
    entries = readdirSync(SPLAT_DIR);
  } catch {
    return 0;
  }

  let removed = 0;
  for (const name of entries) {
    if (!name.startsWith(TEMP_PREFIX) || !name.endsWith(TEMP_SUFFIX)) continue;
    const file = path.join(SPLAT_DIR, name);
    try {
      if (now - statSync(file).mtimeMs < TEMP_STALE_MS) continue;
      unlinkSync(file);
      removed++;
    } catch {
      // Being written right now, or already gone, or held open by another
      // process — Windows refuses the unlink outright, which is the safe
      // failure. Leave it; the next upload will try again.
    }
  }
  if (removed > 0) console.log(`[splatUpload] swept ${removed} abandoned upload(s)`);
  return removed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admission
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The whole size decision, as arithmetic with nothing behind it.
 *
 * Pulled out of `accept` so it can be TESTED. The interesting case — a stream
 * that fits under the per-file ceiling and still runs the store out — needs the
 * disk to be nearly six gigabytes full to reproduce against a real directory,
 * which is not a state a test suite can arrange. As three numbers it is four
 * lines and every branch is reachable. The values are still measured, never
 * asserted: `accept` passes what it counted and what the directory held.
 */
export function budgetVerdict(
  bytesSoFar: number,
  onDisk: number,
  otherInFlight: number,
): "ok" | "too-large" | "no-space" {
  if (bytesSoFar > MAX_UPLOAD_BYTES) return "too-large";
  if (onDisk + otherInFlight + bytesSoFar > SPLAT_STORE_BUDGET_BYTES) return "no-space";
  return "ok";
}

export interface UploadRefusal {
  ok: false;
  status: number;
  /** Written for the person holding the file, like every other refusal here. */
  error: string;
}

export interface UploadSlot {
  ok: true;
  uploader: Uploader;
  /**
   * Record progress and ask whether to keep going.
   *
   * Called per chunk with the RUNNING byte total, so the answer accounts for
   * what every other in-flight upload has written since the last chunk. That is
   * what makes the byte budget hold under concurrency: three simultaneous
   * uploads cannot each be told there is room for the same last gigabyte.
   */
  accept(bytesSoFar: number): "ok" | "too-large" | "no-space";
  /** Release the slot. Must run in a `finally` — a leak here jams the endpoint. */
  close(): void;
}

/**
 * Decide whether to take this upload, and reserve the room for it.
 *
 * The order of the checks is the order of how cheap they are and how certain:
 * the concurrency count is free, the rate limit is a map lookup, and the disk
 * scan comes last because it touches the filesystem. All three run before a
 * single byte is read, so a refused upload costs the sender a connection and
 * costs this machine nothing.
 */
export function openUploadSlot(request: Request, now = Date.now()): UploadSlot | UploadRefusal {
  const s = state();
  const uploader = identifyUploader(request);

  if (s.inFlight.size >= MAX_CONCURRENT_UPLOADS) {
    return {
      ok: false,
      // 503, not 429: this is about the server being busy right now, and it
      // will be untrue in a minute. Retry-After is set by the caller.
      status: 503,
      error:
        `This app is already receiving ${MAX_CONCURRENT_UPLOADS} splats. ` +
        "Wait for one to finish and send this one again.",
    };
  }

  const window = now - RATE_LIMIT_WINDOW_MS;
  const recent = (s.hits.get(uploader.key) ?? []).filter((t) => t > window);
  if (recent.length >= RATE_LIMIT_UPLOADS) {
    return {
      ok: false,
      status: 429,
      error:
        `That is ${RATE_LIMIT_UPLOADS} uploads in ${RATE_LIMIT_WINDOW_MS / 60_000} minutes, ` +
        "which is as many as this app takes from one sender. Wait a few minutes and try again.",
    };
  }
  recent.push(now);
  s.hits.set(uploader.key, recent);

  /*
    Keep the map from growing forever.

    One entry per address that has ever uploaded, and nothing removes them —
    which on a long-running process is a slow leak of exactly the kind that is
    invisible until it is not. Sweeping expired keys here costs a pass over a
    map that is normally a handful of entries.
  */
  for (const [key, times] of s.hits) {
    if (times.every((t) => t <= window)) s.hits.delete(key);
  }

  sweepStaleTemps(now);

  const onDisk = storedUploadBytes();
  const mine: InFlight = { bytes: 0 };

  /*
    `onDisk` is a snapshot, taken once, and the in-flight totals are live.

    Re-scanning the directory on every chunk would be the exact answer and would
    also mean a readdir per 64 KB, which is absurd. The snapshot is only stale
    in one direction that matters — another upload finishing and renaming its
    temp into place — and that upload's bytes were already counted while it was
    in flight, so the sum does not undercount. It can OVER-count for a moment,
    which errs toward refusing rather than toward filling the disk.
  */
  const otherInFlight = () => {
    let n = 0;
    for (const f of s.inFlight) if (f !== mine) n += f.bytes;
    return n;
  };

  const free = SPLAT_STORE_BUDGET_BYTES - onDisk - otherInFlight();
  if (free < MIN_UPLOAD_BYTES) {
    return {
      ok: false,
      status: 507,
      error:
        `This app is holding ${(onDisk / 1_073_741_824).toFixed(1)} GB of uploaded splats, which is ` +
        `its ${SPLAT_STORE_BUDGET_BYTES / 1_073_741_824} GB limit. Delete a capture you no longer ` +
        "want and send this one again.",
    };
  }

  s.inFlight.add(mine);
  let closed = false;

  return {
    ok: true,
    uploader,
    accept(bytesSoFar: number) {
      mine.bytes = bytesSoFar;
      return budgetVerdict(bytesSoFar, onDisk, otherInFlight());
    },
    close() {
      // Idempotent: the route calls this in a `finally` that can be reached
      // more than once on some error paths, and double-removal from a Set is
      // silent but the flag makes the intent readable.
      if (closed) return;
      closed = true;
      s.inFlight.delete(mine);
    },
  };
}

/**
 * Reset every counter. Tests only.
 *
 * The rate limiter is per process and scripts/verify-splat-upload.ts drives it
 * more times in a second than any person would in an hour — without this, the
 * test for the limit would poison every test after it.
 */
export function resetUploadLimitsForTest(): void {
  const s = state();
  s.hits.clear();
  s.inFlight.clear();
}
