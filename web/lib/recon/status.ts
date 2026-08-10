/**
 * Reconstruction job status — the TypeScript side of the `recon_status` enum in
 * supabase/migrations/006.
 *
 * These two lists must stay in step. Postgres is the one that matters: an enum
 * value written here that the database does not know becomes a runtime insert
 * failure, not a type error, because the value crosses the wire as a string.
 * The exhaustive `COARSE` map below is what makes drift visible — add a status
 * to the union and every switch over it stops compiling.
 *
 * No `next/*` imports and no dependencies: scripts/verify-pipeline.ts reaches
 * this under tsx, as do the worker and the browser.
 */

export const RECON_STATUSES = [
  "draft",
  "uploading",
  "queued",
  "reconstructing",
  "downloading",
  "transcoding",
  "ready",
  "failed",
  "cancelled",
] as const;

export type ReconStatus = (typeof RECON_STATUSES)[number];

/**
 * Collapse onto the three-state `SplatStatus` in lib/types.ts:180.
 *
 * The UI has always spoken in those three, and every existing consumer —
 * `SplatViewer`'s checking/real/synthetic switch, the album's "Training…" badge
 * — reads them. Widening the pipeline's vocabulary must not force a rewrite of
 * components that only ever needed to know "can I render this yet".
 */
export const COARSE: Record<ReconStatus, "processing" | "ready" | "failed"> = {
  draft: "processing",
  uploading: "processing",
  queued: "processing",
  reconstructing: "processing",
  downloading: "processing",
  transcoding: "processing",
  ready: "ready",
  failed: "failed",
  // A cancelled job is not an error to apologise for, but it has no artifact
  // either, and "failed" is the only non-ready state the viewer understands.
  cancelled: "failed",
};

/** Nothing more will happen to a job in one of these states. */
export const TERMINAL: ReadonlySet<ReconStatus> = new Set<ReconStatus>([
  "ready",
  "failed",
  "cancelled",
]);

export const isTerminalStatus = (s: ReconStatus): boolean => TERMINAL.has(s);

/**
 * The legal transitions, and the single place they are written down.
 *
 * `advance()` does a compare-and-swap against this — `UPDATE … WHERE id = $1 AND
 * status = $2` — so a late webhook racing the reconciliation sweep produces one
 * winner and one no-op rather than two zip downloads and two spent credits.
 */
export const TRANSITIONS: Record<ReconStatus, readonly ReconStatus[]> = {
  draft: ["uploading", "cancelled", "failed"],
  uploading: ["queued", "cancelled", "failed"],
  queued: ["reconstructing", "cancelled", "failed"],
  reconstructing: ["downloading", "cancelled", "failed"],
  downloading: ["transcoding", "cancelled", "failed"],
  // transcoding → ready even when the transcode ITSELF failed: the PLY is still
  // a perfectly good artifact and the viewer falls back to it. A capture that
  // reconstructed fine must not be reported as failed because its optional
  // compression step did not. See phase 2 of the plan.
  transcoding: ["ready", "cancelled", "failed"],
  ready: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: ReconStatus, to: ReconStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
