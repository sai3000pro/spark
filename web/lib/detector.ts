/**
 * Real in-browser object detection, emitting records in the pipeline's own
 * `Detection` shape.
 *
 * This is the bridge that makes the whole contract credible: the same
 * `Detection[]` type that lib/mock generates is produced here by an actual model,
 * and fed to the same `scoreCandidates`. If it type-checks and produces
 * candidates, the schema is right.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NO LONGER ONE MODEL CALL
 *
 * It used to be: load YOLOS-tiny, call it once, take what comes back. That is
 * the arrangement that made detection feel unreliable, and the model was the
 * least of it. Three things were wrong and all three are fixed here.
 *
 *   1. ONE SAMPLE. A single forward pass is a noisy draw. Boxes wobble, scores
 *      wobble, marginal objects appear and vanish between two nearly identical
 *      frames. We now run several augmented passes and fuse them (./detect/tta.ts
 *      → ./detect/boxes.ts), which both steadies the boxes and — more useful —
 *      reports how many passes AGREED. A detection 6 of 6 passes found and one
 *      that 1 of 6 found are no longer presented as the same claim.
 *
 *   2. SMALL OBJECTS WERE UNREACHABLE. These models resize to a ~800 px short
 *      edge before inference, so a bottle on a table across a wide frame is
 *      destroyed in preprocessing, not missed by the detector. No threshold
 *      recovers it. Tiled passes fix it properly.
 *
 *   3. INT8 WEIGHTS BY DEFAULT ON WASM. Transformers.js defaults `dtype` to q8
 *      on the wasm backend (see DEFAULT_DEVICE_DTYPE_MAPPING in its source). Any
 *      machine without WebGPU was quietly running a quantized model, and box
 *      regression is exactly the thing 8-bit quantization degrades first. The
 *      precision is now chosen explicitly and reported in the UI.
 *
 * The cost is real — "balanced" is six forward passes, not one — so the quality
 * preset is a knob the caller sets, and `fast` is still one pass for the on-robot
 * path where the frame budget is 100 ms.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Client-only — Transformers.js needs WebGPU/WASM.
 */
import { dropContained, fuseBoxes, type FusedBox, type ScoredBox } from "./detect/boxes";
import { assignTracks } from "./detect/track";
import {
  loadFrame,
  mapPassBoxes,
  planPasses,
  QUALITY_PRESETS,
  renderPass,
  type QualityMode,
} from "./detect/tta";
import type { BBox, Detection } from "./types";

export { QUALITY_PRESETS, passCountFor, type QualityMode } from "./detect/tta";

/**
 * Model choices, verified to exist with ONNX weights on the Hub.
 *
 * NB: `onnx-community/rtdetr_v2_r18vd` (a tempting first guess for RT-DETR) does
 * NOT resolve — checked again, still returns 401. Do not "fix" the default to it.
 */
export interface DetectorModel {
  id: string;
  label: string;
  note: string;
  /** Rough download size for the default weights, for the progress UI. */
  approxMb: number;
  /** Ordering hint for the picker — roughly accuracy, inversely speed. */
  tier: "onboard" | "balanced" | "cloud";
}

export const DETECTOR_MODELS: DetectorModel[] = [
  {
    id: "Xenova/yolos-tiny",
    label: "YOLOS-tiny",
    note: "Small and quick — closest to what would actually run on the robot.",
    approxMb: 26,
    tier: "onboard",
  },
  {
    id: "Xenova/yolos-small",
    label: "YOLOS-small",
    note: "Same family, ~5× the weights. Much steadier on small objects.",
    approxMb: 120,
    tier: "balanced",
  },
  {
    id: "Xenova/detr-resnet-50",
    label: "DETR ResNet-50",
    note: "Slower, noticeably better. Stands in for the cloud-side pass.",
    approxMb: 43,
    tier: "balanced",
  },
  {
    id: "Xenova/detr-resnet-101",
    label: "DETR ResNet-101",
    note: "The most accurate of the four, and the slowest. Worth it on a still.",
    approxMb: 77,
    tier: "cloud",
  },
];

/**
 * Weight precision.
 *
 * `auto` keeps whatever the runtime picks, which is fp32 on WebGPU and q8 on
 * wasm. `full` forces fp32 everywhere — a large download and a slow pass on
 * wasm, but it removes quantization error from the box coordinates, which is the
 * single biggest quality difference on a machine with no WebGPU.
 */
export type Precision = "auto" | "full" | "quantized";

export interface ProgressInfo {
  status: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

/** One detection after fusion, with the evidence that produced it. */
export interface RawDetection {
  label: string;
  score: number;
  box: { xmin: number; ymin: number; xmax: number; ymax: number };
  /** Passes that found it. 1 with `fast`, up to `passCount` otherwise. */
  support: number;
  /** `support / passCount`, 0..1 — the consistency readout. */
  agreement: number;
  /** Mean IoU of the contributing boxes against the fused one. */
  tightness: number;
  /** Score before the agreement penalty. */
  rawScore: number;
}

export interface DetectRun {
  detections: RawDetection[];
  /** Passes actually run, so `agreement` can be read as a fraction of it. */
  passCount: number;
  elapsedMs: number;
  frame: { width: number; height: number };
}

export interface DetectOptions {
  threshold: number;
  quality?: QualityMode;
  /** Called after each forward pass, for a progress bar over a slow run. */
  onPass?: (done: number, total: number) => void;
}

export interface DetectorHandle {
  modelId: string;
  device: string;
  /** Resolved weight precision — what actually loaded, not what was asked for. */
  dtype: string;
  detect: (
    input: string | HTMLCanvasElement | HTMLImageElement | Blob,
    opts: DetectOptions,
  ) => Promise<DetectRun>;
}

/**
 * One pipeline per model+device+precision, cached at module scope — the weights
 * are tens of MB and must never be downloaded twice in a session.
 */
const cache = new Map<string, Promise<DetectorHandle>>();

type Pipe = (
  input: HTMLCanvasElement,
  opts: { threshold: number; percentage: boolean },
) => Promise<Array<{ label: string; score: number; box: Record<string, number> }>>;

export function loadDetector(
  modelId: string,
  onProgress?: (p: ProgressInfo) => void,
  precision: Precision = "auto",
): Promise<DetectorHandle> {
  const key = `${modelId}::${precision}`;
  const existing = cache.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<DetectorHandle> => {
    const { pipeline } = await import("@huggingface/transformers");

    // Try WebGPU, fall back to WASM. Plenty of hackathon laptops have no WebGPU
    // and a hard failure there would take the whole demo down.
    let pipe: unknown = null;
    let device = "webgpu";
    let dtype = dtypeFor("webgpu", precision);
    try {
      pipe = await pipeline("object-detection", modelId, {
        device: "webgpu",
        dtype: dtype as never,
        progress_callback: onProgress as never,
      });
    } catch (err) {
      console.warn("[detector] WebGPU unavailable, falling back to wasm:", err);
      device = "wasm";
      dtype = dtypeFor("wasm", precision);
      pipe = await pipeline("object-detection", modelId, {
        device: "wasm",
        dtype: dtype as never,
        progress_callback: onProgress as never,
      });
    }

    const call = pipe as Pipe;

    return {
      modelId,
      device,
      dtype,
      detect: (input, opts) => runPasses(call, input, opts),
    };
  })();

  // Never cache a rejection — a transient network failure should be retryable.
  promise.catch(() => cache.delete(key));
  cache.set(key, promise);
  return promise;
}

/**
 * The runtime's own defaults are fp32 on WebGPU and q8 on wasm. `auto` keeps
 * them; the other two say what they mean on both backends.
 */
function dtypeFor(device: string, precision: Precision): string {
  if (precision === "full") return "fp32";
  if (precision === "quantized") return "q8";
  return device === "wasm" ? "q8" : "fp32";
}

/**
 * Run the planned passes and fuse them.
 *
 * The per-pass threshold is deliberately well below the caller's: fusion applies
 * an agreement penalty AFTER the fact, so filtering hard inside each pass would
 * throw away exactly the marginal detections that several passes agreeing is
 * supposed to rescue. Recall at the pass level, precision at the fusion level.
 */
async function runPasses(
  pipe: Pipe,
  input: string | HTMLCanvasElement | HTMLImageElement | Blob,
  opts: DetectOptions,
): Promise<DetectRun> {
  const started = performance.now();
  const preset = QUALITY_PRESETS[opts.quality ?? "balanced"];
  const frame = await loadFrame(input);
  const passes = planPasses(preset);
  const passThreshold = Math.max(0.05, opts.threshold * 0.5);

  const perPass: ScoredBox[][] = [];
  for (const [i, pass] of passes.entries()) {
    const canvas = renderPass(frame, pass);
    let out: Awaited<ReturnType<Pipe>>;
    try {
      out = await pipe(canvas, { threshold: passThreshold, percentage: true });
    } catch (err) {
      // One bad pass must not lose the whole run — the others still fuse, and
      // `passCount` stays honest so agreement is not silently inflated.
      console.warn(`[detector] pass ${pass.id} failed:`, err);
      out = [];
    }
    perPass.push(mapPassBoxes(pass, out.map(toScoredBox).filter(Boolean) as ScoredBox[]));
    opts.onPass?.(i + 1, passes.length);
  }

  const fused = fuseBoxes(perPass, {
    passCount: passes.length,
    minScore: opts.threshold,
    // A single pass has nothing to agree with, so the penalty is meaningless
    // there and would just scale every score down by a constant.
    agreementWeight: passes.length > 1 ? 0.55 : 0,
  });

  return {
    detections: dropContained(fused).map(toRawDetection),
    passCount: passes.length,
    elapsedMs: Math.round(performance.now() - started),
    frame: { width: frame.width, height: frame.height },
  };
}

/** Model output → the fusion module's box shape. Returns null on a malformed row. */
function toScoredBox(d: {
  label: string;
  score: number;
  box: Record<string, number>;
}): ScoredBox | null {
  const { xmin, ymin, xmax, ymax } = d.box;
  if (![xmin, ymin, xmax, ymax].every((v) => typeof v === "number" && Number.isFinite(v))) {
    return null;
  }
  return {
    label: d.label.toLowerCase(),
    score: d.score,
    // Some checkpoints emit inverted corners on degenerate boxes.
    box: {
      x0: Math.min(xmin, xmax),
      y0: Math.min(ymin, ymax),
      x1: Math.max(xmin, xmax),
      y1: Math.max(ymin, ymax),
    },
  };
}

const toRawDetection = (f: FusedBox): RawDetection => ({
  label: f.label,
  score: f.score,
  box: { xmin: f.box.x0, ymin: f.box.y0, xmax: f.box.x1, ymax: f.box.y1 },
  support: f.support,
  agreement: f.agreement,
  tightness: f.tightness,
  rawScore: f.rawScore,
});

/**
 * Model output → the pipeline's `Detection`.
 *
 * `percentage: true` gives boxes already normalized 0..1, which is exactly what
 * `BBox` is defined as — so there is no image-size coupling here.
 *
 * `trackId` is left UNSET on purpose. A single frame has no temporal evidence,
 * and minting a unique id per detection — which this used to do — is worse than
 * leaving it blank: it looks like tracking to every downstream consumer while
 * guaranteeing every track has exactly one hit, so `collapseToSightings` (which
 * wants three) silently produces nothing. Sequences go through `trackFrames`
 * below, which assigns real ids.
 */
export function toDetections(
  raw: RawDetection[],
  opts: {
    tripId: string;
    frameId: string;
    t: number;
    source?: "onboard" | "cloud" | "manual";
  },
): Detection[] {
  return raw.map((d, i) => {
    const x = Math.max(0, Math.min(1, d.box.xmin));
    const y = Math.max(0, Math.min(1, d.box.ymin));
    const w = Math.max(0, Math.min(1 - x, d.box.xmax - d.box.xmin));
    const h = Math.max(0, Math.min(1 - y, d.box.ymax - d.box.ymin));
    const bbox: BBox = [round(x), round(y), round(w), round(h)];

    return {
      id: `det_live_${opts.frameId}_${i}`,
      tripId: opts.tripId,
      frameId: opts.frameId,
      t: opts.t,
      label: d.label.toLowerCase(),
      confidence: Number(d.score.toFixed(3)),
      bbox,
      // Crude but honest monocular proxy: bigger box ≈ closer. The real thing
      // reads iPhone LiDAR.
      depthM: Number((1.4 / Math.max(0.02, Math.sqrt(w * h))).toFixed(2)),
      source: opts.source ?? "manual",
    };
  });
}

/**
 * A sequence of frames → tracked `Detection[]`.
 *
 * This is the shape the robot's stream takes, and the only path that produces
 * detections `collapseToSightings` will accept. Flicker — a track seen once or
 * twice — is dropped here rather than downstream.
 */
export function trackFrames(
  frames: Array<{ frameId: string; t: number; detections: RawDetection[] }>,
  opts: { tripId: string; source?: "onboard" | "cloud" | "manual"; minHits?: number },
): Detection[] {
  const flat = frames.flatMap((f) =>
    toDetections(f.detections, {
      tripId: opts.tripId,
      frameId: f.frameId,
      t: f.t,
      source: opts.source,
    }),
  );
  return assignTracks(flat, { minHits: opts.minHits ?? 3, idPrefix: `${opts.tripId}_trk` });
}

const round = (v: number) => Number(v.toFixed(4));

export const formatBytes = (n?: number) =>
  n === undefined ? "" : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${(n / 1e3).toFixed(0)} kB`;
