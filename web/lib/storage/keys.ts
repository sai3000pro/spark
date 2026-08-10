/**
 * Object keys, built here and nowhere else.
 *
 * Every key is assembled from ids the server already trusts — never from a
 * filename, a form field, or anything else that crossed the wire. The old
 * upload route derived an extension with `path.extname(file.name)` and carried
 * a comment acknowledging the traversal risk; this module removes the question
 * by never letting user input reach a path at all. The original filename is
 * still kept, as a `source_name` COLUMN, which is where a display string
 * belongs.
 *
 * Keys are also unguessable by construction (asset ids are uuids), but that is
 * defence in depth and not the permission model — reads are authorised against
 * `can_read_journey` before a URL is ever minted.
 */
import type { StorageClass } from "./provider";

/** Extensions we will ever write. Anything else is a bug, not a user error. */
const EXT = {
  spz: "spz",
  ply: "ply",
  ndjson: "ndjson.gz",
  avif: "avif",
  mp4: "mp4",
  mov: "mov",
  webm: "webm",
} as const;

export type KnownExt = keyof typeof EXT;

/** Uuid or the app's own `trip_*` / slug ids. Rejects anything path-shaped. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function safe(kind: string, value: string): string {
  if (!SAFE_ID.test(value)) {
    throw new Error(`unsafe ${kind} for a storage key: ${JSON.stringify(value)}`);
  }
  return value;
}

/** The SPZ a browser downloads. Immutable, CDN-cached for a year. */
export function deliveryKey(ownerId: string, journeyId: string, assetId: string): string {
  return `splats/${safe("ownerId", ownerId)}/${safe("journeyId", journeyId)}/${safe("assetId", assetId)}.${EXT.spz}`;
}

/** The PLY master. Never served to a browser; kept so a re-transcode is possible. */
export function archiveKey(ownerId: string, journeyId: string, assetId: string): string {
  return `splats/${safe("ownerId", ownerId)}/${safe("journeyId", journeyId)}/${safe("assetId", assetId)}.${EXT.ply}`;
}

/** Raw stage-1 detections. Written once at ingest, read on export or re-run. */
export function detectionsKey(journeyId: string): string {
  return `detections/${safe("journeyId", journeyId)}.${EXT.ndjson}`;
}

/** Moment cover frames. */
export function keyframeKey(journeyId: string, momentId: string, keyframeId: string): string {
  return `keyframes/${safe("journeyId", journeyId)}/${safe("momentId", momentId)}/${safe("keyframeId", keyframeId)}.${EXT.avif}`;
}

/** The uploaded source video. Lifecycle-deleted after 7 days — it is not ours to keep. */
export function sourceVideoKey(jobId: string, ext: "mp4" | "mov" | "webm"): string {
  return `video/${safe("jobId", jobId)}.${EXT[ext]}`;
}

/**
 * Map a browser-supplied MIME type onto an extension we are willing to write.
 * Returns null for anything unrecognised, which the caller must turn into a 415
 * rather than guessing — a guess here is how a path becomes attacker-shaped.
 */
export function videoExtFor(mime: string): "mp4" | "mov" | "webm" | null {
  const m = mime.toLowerCase().split(";")[0].trim();
  if (m === "video/mp4") return "mp4";
  if (m === "video/quicktime") return "mov";
  if (m === "video/webm") return "webm";
  return null;
}

/** Which storage class a key belongs to, so placement and lifecycle agree. */
export function classOf(key: string): StorageClass {
  if (key.startsWith("video/")) return "ephemeral";
  if (key.endsWith(`.${EXT.ply}`) || key.startsWith("detections/")) return "archive";
  return "delivery";
}
