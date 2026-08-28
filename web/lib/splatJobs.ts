/**
 * Reconstruction jobs: a video went in, a .ply is expected out.
 *
 * The reconstruction itself is NOT here and cannot be. It is COLMAP →
 * Brush, run by tools/video_intel/splat_batch.py against a GPU box with
 * ComfyUI installed — minutes of work, none of it expressible in a request
 * handler. What this module owns is the seam: where the video is put, what the
 * job is called, and how the app learns that the result has landed.
 *
 * STATUS IS DERIVED FROM THE FILESYSTEM, never ticked. A job is `ready` exactly
 * when a splat for it exists on disk under public/mock/splats — so the loop
 * closes for real the moment the pipeline drops a file there, with nothing to
 * poll, no timer to leak, and correct answers on a cold read hours later. Same
 * derive-don't-sync discipline as getActiveTrip().
 *
 * "A splat", not "a .ply", and the difference is load-bearing since the upload
 * gate started accepting .spz, .splat and .ksplat as well. The format is NOT
 * recorded on the job: it is recovered by looking, in `storedSplatFor`, which
 * is the only way it cannot drift from what is actually on disk. The
 * reconstruction pipeline still writes PLY, so the hand-drop instructions below
 * still say .ply.
 *
 * The handoff, end to end:
 *
 *   1. POST /api/splat/jobs with the video  → written to .uploads/<jobId>.mp4
 *   2. you run, on the machine with the GPU:
 *        python -m tools.video_intel.splat_batch --specs <spec.json>
 *   3. drop the decoded result at:
 *        web/public/mock/splats/<jobId>.ply
 *   4. GET /api/splat/jobs/<jobId> flips to ready and hands back the url
 *
 * Step 3 is a copy, not an integration, and that is deliberate — the alternative
 * is this app holding credentials for a box it does not own.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { SPLAT_EXTENSIONS } from "./splat/extensions";
import { SPLAT_DIR } from "./splat/store";
import { BROWSER_COPY_SUFFIX } from "./video/remux";

export type SplatJobStatus = "queued" | "processing" | "ready" | "failed";

/**
 * How this job expects to acquire its .ply.
 *
 *   video   a clip was uploaded and something still has to reconstruct it
 *   ply     a finished splat was handed to us and the work is already done
 *
 * The distinction is not cosmetic: it decides what an ABSENT file means. For a
 * video job, no .ply is the normal state for the first hour — the pipeline is
 * still running, and the honest note is "waiting". For a ply job it can only
 * mean the file was uploaded and has since been deleted, and telling that user
 * to "wait for the reconstruction" would be waiting for something that already
 * happened. One field, two very different sentences.
 */
export type SplatJobOrigin = "video" | "ply";

export interface SplatJob {
  id: string;
  createdAt: string;
  sourceName: string;
  /** Bytes of the uploaded video, so the UI can be honest about the wait. */
  sourceBytes: number;
  origin: SplatJobOrigin;
  /** The walk this reconstruction belongs to, once one has been built. */
  tripId: string | null;
  status: SplatJobStatus;
  /** Set only when status is "ready". Served straight to the splat viewer. */
  url: string | null;
  note: string;
  /**
   * KIRI's own handle for this reconstruction, once one has been submitted.
   *
   * Without it a dispatch to KIRI is write-only: the clip goes, a credit is
   * spent, and nothing here can ever ask what became of it. See
   * lib/reconstruction/collect.ts, which is what turns it back into a .ply.
   */
  kiriSerialize: string | null;
}

/** Uploaded videos. Gitignored — these are large and they are not ours to keep. */
export const UPLOAD_DIR = path.join(process.cwd(), ".uploads");

/**
 * Where a finished reconstruction has to be dropped to close the loop.
 *
 * Re-exported rather than declared, so every caller that has always imported it
 * from here still can. It lives in ./splat/store.ts because the upload limits
 * need the same path and cannot import this module — see that file.
 */
export { SPLAT_DIR };

const KEY = Symbol.for("spark.splatJobs.store");

type StoredJob = Omit<SplatJob, "status" | "url">;

interface Store {
  jobs: Map<string, StoredJob>;
  hydrated: boolean;
}

/**
 * Job records live on disk beside the clip they describe.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT JUST A CACHE
 *
 * This map used to be memory only, and a dev-server restart erased it while
 * leaving every video on disk — so the clips became unreachable: `getSplatJob`
 * returned null and each route 404'd on bytes that were sitting right there.
 * Eight restarts in one afternoon orphaned a 105 MB recording that way.
 *
 * Worse once KIRI is involved. `kiriSerialize` is the ONLY handle to a
 * reconstruction that has already cost a credit, and holding it in memory means
 * a reload turns a paid job into one nobody can ever collect — it then expires
 * at KIRI untouched. A sidecar makes the restart survivable and costs a few
 * hundred bytes next to a hundred megabytes of video.
 *
 * Same derive-don't-sync spirit as the rest of this file: readiness still comes
 * from the .ply existing, and this only persists the facts that cannot be
 * recovered by looking.
 */
const RECORD_SUFFIX = ".job.json";

function recordPath(id: string): string {
  return path.join(UPLOAD_DIR, `${id}${RECORD_SUFFIX}`);
}

/** Best effort: a record that cannot be written must not fail the upload. */
function persist(job: StoredJob): void {
  try {
    mkdirSync(UPLOAD_DIR, { recursive: true });
    writeFileSync(recordPath(job.id), JSON.stringify(job, null, 1), "utf8");
  } catch {
    // The job still works for this process; only the restart is lost.
  }
}

/**
 * Rebuild the map from disk, once per process.
 *
 * Two sources, in order of trust: a sidecar written by a previous run, then any
 * video with no sidecar at all. The second is what adopts clips uploaded before
 * records existed — an id is recoverable from the filename, and a job that can
 * be reached with a guessed source name beats a file nothing can address.
 */
function hydrate(s: Store): void {
  if (s.hydrated) return;
  s.hydrated = true;

  let entries: string[];
  try {
    entries = readdirSync(UPLOAD_DIR);
  } catch {
    return; // Nothing uploaded yet.
  }

  for (const name of entries) {
    if (!name.endsWith(RECORD_SUFFIX)) continue;
    try {
      const raw = JSON.parse(
        readFileSync(path.join(UPLOAD_DIR, name), "utf8"),
      ) as Partial<StoredJob>;
      if (typeof raw?.id !== "string") continue;
      s.jobs.set(raw.id, {
        id: raw.id,
        createdAt: raw.createdAt ?? new Date().toISOString(),
        sourceName: raw.sourceName ?? raw.id,
        sourceBytes: raw.sourceBytes ?? 0,
        // Records written before uploads existed have no origin and are all
        // videos. Defaulting rather than dropping keeps them readable.
        origin: raw.origin === "ply" ? "ply" : "video",
        tripId: raw.tripId ?? null,
        note: "",
        kiriSerialize: raw.kiriSerialize ?? null,
      });
    } catch {
      // A truncated record is not worth taking the process down for.
    }
  }

  for (const name of entries) {
    if (name.endsWith(RECORD_SUFFIX) || name.endsWith(BROWSER_COPY_SUFFIX)) continue;
    const id = name.slice(0, name.length - path.extname(name).length);
    if (!id.startsWith("splat_") || s.jobs.has(id)) continue;
    let bytes = 0;
    try {
      const st = statSync(path.join(UPLOAD_DIR, name));
      bytes = st.size;
      const adopted: StoredJob = {
        id,
        createdAt: new Date(st.mtimeMs).toISOString(),
        sourceName: name,
        sourceBytes: bytes,
        origin: "video",
        tripId: null,
        note: "",
        // Unrecoverable. A clip adopted this way may already have been sent to
        // KIRI by a previous run, and re-sending it would spend a second credit
        // — so callers should treat adoption as "reachable again", not "unsent".
        kiriSerialize: null,
      };
      s.jobs.set(id, adopted);
      persist(adopted);
    } catch {
      // Vanished between readdir and stat.
    }
  }

  /*
    Third: finished splats with no record at all.

    Two ways to arrive here, and both are real. The header of this file
    documents "drop the decoded result at public/mock/splats/<jobId>.ply" as
    the way to close the loop by hand — and doing exactly that for an id this
    process has never seen produced a file sitting in the served directory that
    `getSplatJob` answered `null` for. The documented step did not work on a
    cold start. The second way is an upload whose sidecar was swept, which
    matters more now that a .ply can BE the whole job: for those the sidecar is
    not a convenience over a video that is also on disk, it is the only record
    that the id was ever minted.

    Same derive-don't-sync rule the rest of the file runs on. A .ply in the
    served directory is a finished capture whatever the bookkeeping says, so it
    is adopted rather than ignored. The authored mock captures are skipped by
    the same `splat_` test the video pass uses — they are scenery, not jobs.
  */
  let splats: string[];
  try {
    splats = readdirSync(SPLAT_DIR);
  } catch {
    return; // Nothing reconstructed yet.
  }
  for (const name of splats) {
    /*
      Any format the upload gate accepts, not just PLY.

      This pass read `.ply` alone, which was right when that was the only thing
      that could be stored. With .spz, .splat and .ksplat accepted, an
      extension test that narrow would leave a perfectly good compressed
      capture in the served directory that no job could ever address — the
      cold-start orphan this whole pass exists to rescue, reintroduced for
      three quarters of the formats.

      `.uploading-*.tmp` files are excluded by the same test, for free: a temp
      file has no accepted extension and no `splat_` prefix, so an upload in
      flight is never adopted as a finished capture.
    */
    // `extname`, not `endsWith`. Two of these extensions are suffixes of each
    // other — ".ksplat" ends with "splat" — so a suffix test gets the right
    // answer only while the list happens to be in the right order, and silently
    // gets the wrong one the day somebody sorts it alphabetically.
    const ext = path.extname(name).toLowerCase();
    if (!SPLAT_EXTENSIONS.includes(ext)) continue;
    const id = name.slice(0, name.length - ext.length);
    if (!id.startsWith("splat_") || s.jobs.has(id)) continue;
    try {
      const st = statSync(path.join(SPLAT_DIR, name));
      const adopted: StoredJob = {
        id,
        createdAt: new Date(st.mtimeMs).toISOString(),
        sourceName: name,
        sourceBytes: st.size,
        // Whatever produced it, what we HAVE is the finished splat — and that
        // is what `origin` describes. Claiming "video" would make a missing
        // file read as "still reconstructing" for something already finished.
        origin: "ply",
        tripId: null,
        note: "",
        kiriSerialize: null,
      };
      s.jobs.set(id, adopted);
      persist(adopted);
    } catch {
      // Vanished between readdir and stat.
    }
  }
}

function store(): Store {
  const g = globalThis as unknown as Record<symbol, Store | undefined>;
  const existing = g[KEY];
  if (existing) {
    hydrate(existing);
    return existing;
  }
  const fresh: Store = { jobs: new Map(), hydrated: false };
  g[KEY] = fresh;
  hydrate(fresh);
  return fresh;
}

/**
 * Mint an id nothing is already using.
 *
 * The id was the millisecond alone, which collides — and a collision does not
 * fail, it OVERWRITES: the second job takes the first one's name, and its bytes
 * land on the first one's file. For a video that costs an upload. For a .ply it
 * costs a finished reconstruction, which may be the only copy in existence and
 * may have taken an hour of someone's laptop to produce.
 *
 * Two uploads inside one millisecond is not the realistic case; two browser
 * tabs, a retried request, or the studio pushing several results at once is.
 * Checked against BOTH the job map and the served directory, because a splat
 * adopted from disk is a real claim on an id even before its record is read —
 * and against EVERY format, because `<id>.spz` occupying the name is exactly as
 * much of a collision as `<id>.ply` occupying it.
 */
function mintId(now: Date): string {
  const base = `splat_${now.getTime().toString(36)}`;
  const taken = (id: string) => store().jobs.has(id) || storedSplatFor(id) !== null;
  if (!taken(base)) return base;
  for (let i = 0; i < 64; i++) {
    const candidate = `${base}${(36 + i).toString(36)}`;
    if (!taken(candidate)) return candidate;
  }
  // 64 collisions in one millisecond is not a case worth branching for, but
  // silently reusing an id is never acceptable. Randomness ends it.
  return `${base}${Math.random().toString(36).slice(2, 8)}`;
}

export function createSplatJob(input: {
  sourceName: string;
  sourceBytes: number;
  tripId?: string | null;
  /** Defaults to "video" — the long-standing case, and every existing caller. */
  origin?: SplatJobOrigin;
}): SplatJob {
  const now = new Date();
  const id = mintId(now);
  store().jobs.set(id, {
    id,
    createdAt: now.toISOString(),
    sourceName: input.sourceName,
    sourceBytes: input.sourceBytes,
    origin: input.origin ?? "video",
    tripId: input.tripId ?? null,
    note: "",
    kiriSerialize: null,
  });
  persist(store().jobs.get(id)!);
  sweepUploads();
  return getSplatJob(id)!;
}

/**
 * How long a source video is kept.
 *
 * Seven days, matching the lifecycle rule the storage plan sets on the uploads
 * bucket. The source is the largest artefact in the system by a wide margin — a
 * 3-minute 1080p clip is 150–400 MB against a ~7 MB delivered splat — and it is
 * read exactly twice: once by the detector, once by the reconstructor. Keeping
 * it forever means a demo laptop fills up with footage nobody will watch again.
 *
 * This is NOT the reclaim policy in lib/storage/reclaim.ts, and the difference
 * matters: that one gives up a PLY master a user might still want, so it ranks
 * candidates, previews the loss and demands the replacement be verified first.
 * A source video is working material — everything downstream has already been
 * extracted from it — so it can go on a timer.
 */
export const UPLOAD_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Drop source videos past their retention window.
 *
 * Bounded and lazy, on the same principle as lib/handoff.ts's sweep: no cron,
 * no timer to leak, and the work happens when something is already happening.
 * Deliberately does NOT consult the job record — a video whose job was lost to
 * a restart is exactly the kind of orphan that would otherwise never be
 * collected, and age alone is the honest test.
 */
export function sweepUploads(now = Date.now()): number {
  let removed = 0;
  let entries: string[];
  try {
    entries = readdirSync(UPLOAD_DIR);
  } catch {
    // Nothing has been uploaded yet. Not an error.
    return 0;
  }

  for (const name of entries) {
    /*
      NEVER the job record.

      This swept the sidecar alongside the video, because both live in
      `.uploads` and both were older than the window. That reclaimed a few
      hundred bytes and threw away the job — and for a KIRI job it threw away
      `kiriSerialize`, which is the ONLY handle to a reconstruction whose
      credit is already spent. Retention exists to reclaim the 150–400 MB
      video; a record costing 0.0002% of that is not what it is for, and
      deleting it at exactly the moment the video goes is what turns an
      expected state ("source expired, result still collectable") into a
      permanent one ("nothing here ever existed").

      The record outliving the video is the correct shape: `findUploadFor`
      already returns null for a swept clip and every caller handles it.
    */
    if (name.endsWith(RECORD_SUFFIX)) continue;
    const file = path.join(UPLOAD_DIR, name);
    try {
      if (now - statSync(file).mtimeMs < UPLOAD_RETENTION_MS) continue;
      unlinkSync(file);
      removed++;
    } catch {
      // Being written right now, or already gone. Either way, leave it.
    }
  }
  if (removed > 0) console.log(`[splatJobs] swept ${removed} expired upload(s)`);
  return removed;
}

/**
 * Remember what KIRI called this job, so the result can be collected later.
 *
 * Recorded the instant KIRI accepts, because from that moment the credit is
 * already spent — losing the handle after that point means paying for a
 * reconstruction nobody can ever download.
 */
export function noteKiriSubmission(jobId: string, serialize: string): boolean {
  const job = store().jobs.get(jobId);
  if (!job) return false;
  job.kiriSerialize = serialize;
  // Straight to disk: from here a credit is already spent, and this string is
  // the only way back to what it bought.
  persist(job);
  return true;
}

/** Late-binds the walk, since the walk id is only known after the pipeline runs. */
export function linkJobToTrip(jobId: string, tripId: string): boolean {
  const job = store().jobs.get(jobId);
  if (!job) return false;
  job.tripId = tripId;
  persist(job);
  return true;
}

export function getSplatJob(id: string): SplatJob | null {
  const job = store().jobs.get(id);
  if (!job) return null;

  const stored = storedSplatFor(id);
  const ready = stored !== null;

  return {
    ...job,
    /*
      A ply job with no file is FAILED, not processing.

      "Processing" is a promise that waiting will help. That is true of a video
      whose reconstruction is still running and false of an upload whose file
      has been deleted — nothing is working on it and nothing ever will, so
      reporting progress would leave someone watching a spinner for a job that
      finished before it was ever created.
    */
    status: ready ? "ready" : job.origin === "ply" ? "failed" : "processing",
    // The name the file actually has, not a name we would like it to have. A
    // capture stored as `.spz` is served from `/mock/splats/<id>.spz`, and
    // asserting `.ply` here would hand the viewer a 404 for a file on disk.
    url: stored ? `/mock/splats/${stored.filename}` : null,
    note: stored
      ? `Reconstructed. ${(statSync(stored.path).size / 1_048_576).toFixed(1)} MB on disk.`
      : job.origin === "ply"
        ? "The uploaded splat is no longer on disk. Upload it again to restore this capture."
        : // Still the .ply spelling, and deliberately: this sentence is an
          // instruction to whoever is running the reconstruction by hand, and
          // the pipeline in tools/video_intel writes PLY.
          `Waiting on the reconstruction. Drop it at public/mock/splats/${id}.ply to close the loop.`,
  };
}

export function listSplatJobs(): SplatJob[] {
  return [...store().jobs.keys()]
    .map((id) => getSplatJob(id)!)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * The stored clip for a job, or null if it is gone.
 *
 * The extension is chosen from a whitelist at upload time and is deliberately
 * NOT recorded on the job, so it is recovered by looking rather than by
 * trusting anything a caller says. Callers must check `getSplatJob` first: the
 * job record is the only proof this id was ever minted here, and checking it
 * keeps a traversal attempt from reaching `readdirSync` at all.
 *
 * Returns the absolute path and the bare filename, because `dispatch()` wants
 * both — the path to read and the name to send onward.
 */
export function findUploadFor(jobId: string): { path: string; filename: string } | null {
  let entries: string[];
  try {
    entries = readdirSync(UPLOAD_DIR);
  } catch {
    // No .uploads directory yet is the normal cold state, not an error.
    return null;
  }
  // The ORIGINAL VIDEO, and nothing else that shares its prefix.
  //
  // Three files can now be called `<jobId>.something`: the recording, the
  // browser copy remux.ts writes beside it, and this module's own `.job.json`
  // sidecar. Without both exclusions the answer depended on readdir order —
  // and picking the sidecar made /video serve a JSON file, which surfaced as a
  // 415 on a clip that was sitting there perfectly intact.
  const name = entries.find(
    (e) =>
      e.startsWith(`${jobId}.`) &&
      !e.endsWith(BROWSER_COPY_SUFFIX) &&
      !e.endsWith(RECORD_SUFFIX),
  );
  if (!name) return null;
  return { path: path.join(UPLOAD_DIR, name), filename: name };
}

/**
 * Where this job's finished splat belongs, given the format it turned out to be.
 *
 * The one place that spelling lives, so an uploader writing a file and
 * `storedSplatFor` looking for it cannot drift apart. `id` is always one this
 * module minted, never caller input — see `mintId` — and `ext` comes from
 * SPLAT_EXTENSIONS rather than from anything a caller named their file.
 */
export function splatPathFor(id: string, ext: string): string {
  if (!SPLAT_EXTENSIONS.includes(ext)) {
    // Not a user-facing error: reaching this means code in this repo tried to
    // store a format the rest of the module cannot find again, which would
    // produce a job stuck at "failed" over a file sitting right there.
    throw new Error(`refusing to store a splat as \`${ext}\` — not a format this app serves`);
  }
  return path.join(SPLAT_DIR, `${id}${ext}`);
}

/**
 * The stored splat for an id, whatever format it was uploaded in.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS AT ALL
 *
 * Readiness used to be `existsSync(<id>.ply)`, which was true when `.ply` was
 * the only thing the upload gate accepted. Now that it takes .spz, .splat and
 * .ksplat as well, that spelling would make every non-PLY upload land on disk
 * and immediately report `failed` with a note saying the file is "no longer on
 * disk" — a lie told about a file the same process had just written.
 *
 * So the question stops being "is `<id>.ply` there" and becomes "is there a
 * splat for this id", which is answered by LOOKING. Same derive-don't-sync rule
 * as everything else here: the format is not recorded on the job and does not
 * need to be, because the filesystem already knows.
 *
 * Extensions are tried in SPLAT_EXTENSIONS order so the answer is deterministic
 * if somebody hand-drops two formats for one id. It is not a case worth
 * preventing — both files are real captures — but it IS worth answering the
 * same way every time rather than by readdir order.
 */
export function storedSplatFor(id: string): { path: string; filename: string } | null {
  for (const ext of SPLAT_EXTENSIONS) {
    const filename = `${id}${ext}`;
    const file = path.join(SPLAT_DIR, filename);
    if (existsSync(file)) return { path: file, filename };
  }
  return null;
}

/** Both directories, created on demand — neither is committed. */
export function ensureDirs(): void {
  mkdirSync(UPLOAD_DIR, { recursive: true });
  mkdirSync(SPLAT_DIR, { recursive: true });
}
