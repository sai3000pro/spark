/**
 * Which engine draws the capture — a preference, not a build-time decision.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY TWO ENGINES STAY IN THE TREE
 *
 * They are not redundant. They read different files:
 *
 *   Spark 2.1 (@sparkjsdev/spark)      ply · spz · splat · ksplat · pcsogs
 *   mkkellogg 0.4.7                    ply · splat · ksplat
 *
 * SPZ is the format everything is served as once storage matters — it is about
 * a third the size of the PLY it came from — and mkkellogg cannot open it at
 * all. That alone settles the default.
 *
 * The other direction is real too. Spark runs on the app's own bundled three
 * (0.185) inside React Three Fiber, so it shares the scene with the anchors and
 * the orbit controls; mkkellogg needs a second, isolated three 0.160.1 from a
 * CDN and its own canvas (lib/splat/gs3d.ts explains that in detail). That
 * makes mkkellogg the one that keeps working when the CDN is fine but WebGL2
 * compute paths are not, and the one whose sort is a known quantity on old
 * hardware. Keeping it is cheap; losing it costs someone their capture.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE COPY MUST NOT SAY
 *
 * Compression is a QUOTA limit, never a capability limit. A user can keep the
 * full-detail PLY for every capture they own — it simply counts against their
 * storage, and lib/storage/reclaim.ts is the deliberate, previewed way to trade
 * some of it back for space. Nothing in this app is allowed to imply that
 * choosing an engine, or running out of quota, costs you detail you cannot get
 * back. Say "counts against storage", not "reduces quality".
 */

/** The engines. Stable strings — they are persisted. */
export const SPLAT_RENDERERS = ["spark", "gs3d"] as const;
export type SplatRenderer = (typeof SPLAT_RENDERERS)[number];

export function isSplatRenderer(v: unknown): v is SplatRenderer {
  return typeof v === "string" && (SPLAT_RENDERERS as readonly string[]).includes(v);
}

/**
 * The default. Spark, because it opens every format this app produces and
 * mkkellogg opens a subset — a default that cannot render some captures is not
 * a default. `NEXT_PUBLIC_SPLAT_RENDERER` still overrides it for a deployment
 * that wants the other one first, and a person's own choice overrides both.
 */
export const DEFAULT_SPLAT_RENDERER: SplatRenderer = isSplatRenderer(
  process.env.NEXT_PUBLIC_SPLAT_RENDERER,
)
  ? (process.env.NEXT_PUBLIC_SPLAT_RENDERER as SplatRenderer)
  : "spark";

// ─────────────────────────────────────────────────────────────────────────────
// What each engine can actually open
// ─────────────────────────────────────────────────────────────────────────────

const SPARK_FORMATS = ["ply", "spz", "splat", "ksplat", "sog"] as const;
const GS3D_FORMATS = ["ply", "splat", "ksplat"] as const;

export const RENDERER_FORMATS: Record<SplatRenderer, readonly string[]> = {
  spark: SPARK_FORMATS,
  gs3d: GS3D_FORMATS,
};

/**
 * The extension, ignoring a query string and a signed-URL's worth of tail.
 * Returns null when there isn't one — a URL that hides its format behind a
 * content-disposition header is not something to guess at.
 */
export function formatOf(url: string): string | null {
  const path = url.split(/[?#]/)[0];
  const dot = path.lastIndexOf(".");
  if (dot < 0 || dot < path.lastIndexOf("/")) return null;
  const ext = path.slice(dot + 1).toLowerCase();
  return ext.length > 0 && ext.length <= 8 ? ext : null;
}

/**
 * Can this engine open this file?
 *
 * An unknown extension is `true`, deliberately. The alternative is refusing to
 * try, and a renderer that declines to attempt a file it might well handle is
 * worse than one that attempts and falls back — the fallback already exists and
 * is already honest about what it is showing.
 */
export function canOpen(renderer: SplatRenderer, url: string): boolean {
  const ext = formatOf(url);
  if (ext === null) return true;
  return RENDERER_FORMATS[renderer].includes(ext);
}

/**
 * The engine to actually use for one capture: the preference, unless it cannot
 * read the file, in which case the other one — silently, because "your chosen
 * renderer cannot open this" is a sentence about our plumbing, not about their
 * memory. The viewer chip still names whichever engine ran.
 */
export function rendererFor(preferred: SplatRenderer, url: string): SplatRenderer {
  if (canOpen(preferred, url)) return preferred;
  const other = SPLAT_RENDERERS.find((r) => r !== preferred && canOpen(r, url));
  return other ?? preferred;
}

export interface RendererDescription {
  id: SplatRenderer;
  /** What it is called on screen. */
  label: string;
  /** The library, for anyone who wants to go and read it. */
  library: string;
  /** One line, honest, in the viewer's voice. */
  note: string;
  formats: readonly string[];
}

export const RENDERER_INFO: Record<SplatRenderer, RendererDescription> = {
  spark: {
    id: "spark",
    label: "Spark",
    library: "@sparkjsdev/spark 2.1",
    note: "Opens every format here, compressed ones included. Draws in the same scene as the object markers.",
    formats: SPARK_FORMATS,
  },
  gs3d: {
    id: "gs3d",
    label: "Original",
    library: "@mkkellogg/gaussian-splats-3d 0.4.7",
    note: "The original engine, on its own canvas. Reads raw PLY at full detail; cannot open compressed SPZ.",
    formats: GS3D_FORMATS,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Persistence
//
// localStorage, matching every other preference in the app. A renderer choice
// is not worth an account, and it is per-device on purpose: the reason to
// switch is usually the machine in front of you.
// ─────────────────────────────────────────────────────────────────────────────

export const RENDERER_STORAGE_KEY = "spark.splatRenderer";

export function readRendererPreference(): SplatRenderer {
  if (typeof window === "undefined") return DEFAULT_SPLAT_RENDERER;
  try {
    const stored = window.localStorage.getItem(RENDERER_STORAGE_KEY);
    return isSplatRenderer(stored) ? stored : DEFAULT_SPLAT_RENDERER;
  } catch {
    // Private mode, or storage disabled. Not a reason to fail to render.
    return DEFAULT_SPLAT_RENDERER;
  }
}

export function writeRendererPreference(renderer: SplatRenderer): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RENDERER_STORAGE_KEY, renderer);
  } catch {
    // Same: the choice just does not survive the tab.
  }
}
