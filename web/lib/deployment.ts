/**
 * What this deployment can actually do, measured rather than assumed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Every store in this app writes a sidecar under `.data/`, the upload route
 * streams a splat into `public/mock/splats/`, and `splatJobs` keeps job records
 * in `.uploads/`. All of that is correct on a laptop and none of it survives
 * contact with a serverless host:
 *
 *   · the filesystem is READ-ONLY outside the system temp directory, so a write
 *     does not degrade, it throws — `EROFS`, from inside a request handler that
 *     was not written expecting it
 *   · even where a write succeeds, the next request may land on a different
 *     instance with a different disk, so "it worked" and "it is still there"
 *     are unrelated facts
 *
 * `lib/persist.ts` already survives the first of those: it try/catches and
 * returns false, so the stores quietly become memory-only. The upload route does
 * not — `ensureDirs()` and `createWriteStream` both throw, and the caller gets a
 * 500 with a stack trace about a path instead of a sentence about a limitation.
 *
 * The rule this codebase runs on is that nothing is offered which cannot work.
 * That rule needs something to ask, and this is it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MEASURED, NOT SNIFFED
 *
 * The obvious implementation is `if (process.env.VERCEL) return read-only`. That
 * is a guess about one host's behaviour hardcoded into every other host's
 * answer, and it is wrong in both directions: a container with a read-only
 * volume is not Vercel and still cannot write, and a host that later gains a
 * writable mount would go on being told it has none.
 *
 * So `writable` is established by WRITING — one probe file into the directory
 * the app would really use, then removing it. Same discipline as
 * tools/spark_studio/doctor.py, which reports a binary as present by running
 * it rather than by finding a path.
 *
 * `durable` is different and genuinely cannot be measured from inside one
 * process: whether the bytes are still there on the NEXT request is a question
 * about the host's architecture, not about this disk. That one is inferred from
 * the environment, and the inference is stated as such.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { DATA_ROOT } from "./persist";

export type DeploymentHost = "local" | "serverless" | "unknown";

export interface StorageReality {
  /** A write to the app's own data directory succeeds. Established by doing it. */
  writable: boolean;
  /**
   * Bytes written now are expected to be readable by a later request.
   *
   * INFERRED, not measured — one process cannot observe what a different
   * instance will see. False whenever the host is serverless, because there the
   * filesystem is per-invocation whatever the probe says.
   */
  durable: boolean;
  host: DeploymentHost;
  /** One sentence, for a person, naming the actual limitation. */
  reason: string;
}

/**
 * Serverless, as far as the environment will admit.
 *
 * Vercel sets `VERCEL=1` on every deployment; `AWS_LAMBDA_FUNCTION_NAME` covers
 * Lambda directly and most things built on it. Neither is used to decide
 * `writable` — only `durable`, which is the part that cannot be probed.
 */
function detectHost(): DeploymentHost {
  if (process.env.VERCEL === "1" || process.env.VERCEL_ENV) return "serverless";
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return "serverless";
  // A plain `next start` on a box, or `next dev`. Not proof of durability on its
  // own, but there is nothing here suggesting otherwise.
  return process.env.NODE_ENV ? "local" : "unknown";
}

/** Try the write. Returns false rather than throwing, whatever went wrong. */
function probeWritable(): boolean {
  const probe = path.join(DATA_ROOT, `.probe-${process.pid}-${Date.now()}`);
  try {
    mkdirSync(DATA_ROOT, { recursive: true });
    writeFileSync(probe, "probe", "utf8");
    return true;
  } catch {
    return false;
  } finally {
    try {
      rmSync(probe, { force: true });
    } catch {
      /* litter, not a failure worth reporting */
    }
  }
}

/*
  Cached for the life of the process.

  The answer cannot change under a running instance — a read-only mount does not
  become writable — and the probe is a syscall on a path every request would
  otherwise hit. Recomputing it per request would be measuring the same
  unchanging fact repeatedly, on the hot path.
*/
let cached: StorageReality | null = null;

export function storageReality(): StorageReality {
  if (cached) return cached;

  const host = detectHost();
  const writable = probeWritable();
  const durable = writable && host !== "serverless";

  let reason: string;
  if (!writable) {
    reason =
      "This deployment's filesystem is read-only, so uploads and captures cannot be stored here. " +
      "It needs object storage and a database — see web/docs/production-readiness.md.";
  } else if (!durable) {
    reason =
      "This deployment can write, but each request may run on a different instance with its own " +
      "disk, so anything stored is likely gone by the next request. It needs object storage and " +
      "a database before it can keep anything.";
  } else {
    reason = "This deployment stores captures on its own disk.";
  }

  cached = { writable, durable, host, reason };
  return cached;
}

/**
 * Can this deployment accept and keep an uploaded capture?
 *
 * The question the upload route asks. Deliberately requires DURABLE and not
 * merely writable: accepting a 200 MB splat onto a disk that evaporates before
 * anyone can open it is worse than refusing it, because the user has spent the
 * upload and been told it worked.
 */
export function canStoreUploads(): boolean {
  return storageReality().durable;
}

/** Tests only. The probe result is cached for the process; this clears it. */
export function __resetStorageReality(): void {
  cached = null;
}
