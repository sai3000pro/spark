/**
 * The bridge to the Reconstruction Studio (:8899) — where the splats actually
 * live. The Next app never rebuilds or re-serves a splat; it lists what the
 * studio already has (`/api/runs`) and links out to the studio's own bigview
 * engine to render it. bigview needs SharedArrayBuffer (COOP/COEP), which the
 * studio origin sets and this one does not — so the viewer MUST open on :8899,
 * not here. See memory: frontend-merge-platform.
 *
 * One base URL, read from the environment so a deployed studio can move, with
 * the dev default baked in. NEXT_PUBLIC_ is required because the album's viewer
 * links are followed by the browser, not the server.
 */
export const STUDIO_URL =
  process.env.NEXT_PUBLIC_STUDIO_URL?.replace(/\/$/, "") ?? "http://localhost:8899";

/**
 * The live splat viewer (:8765) — a separate service from the studio, opened in
 * a new tab from the Capture page's "Open viewer" action. NEXT_PUBLIC_ because,
 * like bigview, the link is followed by the browser, not the server.
 */
export const VIEWER_URL =
  process.env.NEXT_PUBLIC_VIEWER_URL?.replace(/\/$/, "") ?? "http://localhost:8765";

/** A finished splat as the studio reports it. Only the fields the album shows. */
export interface StudioRun {
  id: string;
  label?: string;
  status?: string;
  /** Absolute path on the studio host. Passed to bigview as `?ply=`, which
   *  header-sniffs it and auto-corrects a decoded ply to its raw sibling, so the
   *  gaussian renderer always ingests a raw 3DGS ply. */
  result_ply?: string | null;
  /** A representative source frame — the album cover. User-changeable via thumb. */
  ref_image?: string | null;
  gaussians?: number | null;
  scene?: string | null;
  place?: { name?: string; lat?: number; lng?: number } | null;
  tags?: string[] | null;
  started?: number;
  /** How the splat was built — brush | live | hybrid | feedforward. */
  pipeline?: string | null;
  /** Reconstruction specs, present on most runs (studio's pipeline_run writes them). */
  frames?: number | null;
  steps?: number | null;
  max_res?: number | null;
  /** Latest training iteration published so far (only while status === "running"). */
  latest_iter?: number | null;
}

/** 1_413_428 → "1.4M", 93_968 → "94k". Shared by the splat-count tag and specs. */
export function compactCount(n: number | null | undefined): string | null {
  if (!n) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return `${n}`;
}

/**
 * The short spec line under a card — only the fields a run actually has, so a
 * live scan shows "891 frames" while a Brush run shows "30k steps · 1600px".
 * While training, steps read as progress ("11k / 15k steps").
 */
export function runSpecs(run: StudioRun): string[] {
  const specs: string[] = [];
  if (run.frames) specs.push(`${run.frames.toLocaleString()} frames`);
  if (run.steps) {
    const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
    specs.push(
      isTraining(run) && run.latest_iter
        ? `${k(run.latest_iter)} / ${k(run.steps)} steps`
        : `${k(run.steps)} steps`,
    );
  }
  if (run.max_res) specs.push(`${run.max_res}px`);
  return specs;
}

/** Build a `/file?path=` URL the browser can load an image or ply from. */
export function studioFileUrl(absPath: string): string {
  return `${STUDIO_URL}/file?path=${encodeURIComponent(absPath)}`;
}

/**
 * The splat viewer link. bigview is the true gaussian renderer; `&ref` gives it
 * the source frame to show beside the orbit and `&run` lets it swap that frame
 * to match the current angle — the same query the studio's own cards build.
 */
export function bigviewUrl(run: StudioRun, opts?: { liveSeconds?: number }): string | null {
  if (!run.result_ply) return null;
  const ref = run.ref_image ? `&ref=${encodeURIComponent(run.ref_image)}` : "";
  // While a run trains, pipeline_run rewrites result.ply/result.raw.ply in place
  // every snapshot — `&live=N` makes bigview re-fetch that stable path on an
  // interval (camera preserved), so the viewer keeps updating as the splat grows.
  const live = opts?.liveSeconds ? `&live=${opts.liveSeconds}` : "";
  return `${STUDIO_URL}/bigview?ply=${encodeURIComponent(run.result_ply)}${ref}&run=${encodeURIComponent(run.id)}${live}`;
}

/** Every source frame this moment was reconstructed from — the frame album. */
export function framesAlbumUrl(run: StudioRun): string {
  return `${STUDIO_URL}/album?run=${encodeURIComponent(run.id)}`;
}

/** A located moment, ready to drop on the map. Only runs with real coordinates. */
export interface MapPin {
  id: string;
  title: string;
  lat: number;
  lng: number;
  placeName: string;
  cover: string | null;
  splatUrl: string | null;
  framesUrl: string;
}

/**
 * The map's real data: every finished splat that has been given coordinates in
 * the album. A run with a place NAME but no lat/lng is intentionally excluded —
 * it shows in the album but can't be pinned.
 */
export function locatedPins(runs: StudioRun[]): MapPin[] {
  const pins: MapPin[] = [];
  for (const r of runs) {
    const lat = r.place?.lat;
    const lng = r.place?.lng;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    pins.push({
      id: r.id,
      title: r.label || r.id,
      lat,
      lng,
      placeName: r.place?.name?.trim() || r.label || r.id,
      cover: r.ref_image ? studioFileUrl(r.ref_image) : null,
      splatUrl: bigviewUrl(r),
      framesUrl: framesAlbumUrl(r),
    });
  }
  return pins;
}

/** Statuses that mean a run is still being reconstructed (shown, but marked
 *  "training", with no splat link yet). Everything the studio's pipeline emits
 *  before it reaches "done": queued → exporting → running. */
const TRAINING_STATUSES = new Set(["queued", "exporting", "running", "training", "decoding"]);

/** True while a run is still reconstructing — no finished ply to open yet. */
export function isTraining(run: StudioRun): boolean {
  return !(run.status === "done" && !!run.result_ply) && TRAINING_STATUSES.has(run.status ?? "");
}

/** 260 → "4 min", 45 → "45 sec", 5400 → "1h 30m". Rough, for a training ETA. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return `${s} sec`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/**
 * The splats, newest first. Server-only fetch (no CORS in play), never cached —
 * the studio's library changes as runs finish. Includes runs that are still
 * training so the album can show them as in-progress; excludes failed/empty runs
 * (status "error", or "done" with no result_ply).
 */
export async function fetchRuns(): Promise<StudioRun[]> {
  try {
    const res = await fetch(`${STUDIO_URL}/api/runs`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as { runs?: StudioRun[] };
    return (data.runs ?? []).filter(
      (r) => (r.status === "done" && r.result_ply) || isTraining(r),
    );
  } catch {
    // Studio down → an empty album, not a crashed page.
    return [];
  }
}
