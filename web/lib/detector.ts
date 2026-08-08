/**
 * Real in-browser object detection, emitting records in the pipeline's own
 * `Detection` shape.
 *
 * This is the bridge that makes the whole contract credible: the same
 * `Detection[]` type that lib/mock generates is produced here by an actual model,
 * and fed to the same `scoreCandidates`. If it type-checks and produces
 * candidates, the schema is right.
 *
 * Client-only — Transformers.js needs WebGPU/WASM.
 */
import type { BBox, Detection } from "./types";

/**
 * Model choices, verified to exist with ONNX weights on the Hub.
 *
 * NB: `onnx-community/rtdetr_v2_r18vd` (a tempting first guess for RT-DETR) does
 * NOT resolve — checked, returns 401. Do not "fix" the default to it.
 */
export interface DetectorModel {
  id: string;
  label: string;
  note: string;
  /** Rough download size for the quantized weights, for the progress UI. */
  approxMb: number;
}

export const DETECTOR_MODELS: DetectorModel[] = [
  {
    id: "Xenova/yolos-tiny",
    label: "YOLOS-tiny",
    note: "Small and quick — closest to what would actually run on the robot.",
    approxMb: 26,
  },
  {
    id: "Xenova/detr-resnet-50",
    label: "DETR ResNet-50",
    note: "Slower, noticeably better. Stands in for the cloud-side pass.",
    approxMb: 43,
  },
];

export interface ProgressInfo {
  status: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

export interface DetectorHandle {
  modelId: string;
  device: string;
  detect: (
    input: string | HTMLCanvasElement,
    threshold: number,
  ) => Promise<RawDetection[]>;
}

export interface RawDetection {
  label: string;
  score: number;
  box: { xmin: number; ymin: number; xmax: number; ymax: number };
}

/**
 * One pipeline per model, cached at module scope — the weights are tens of MB and
 * must never be downloaded twice in a session.
 */
const cache = new Map<string, Promise<DetectorHandle>>();

export function loadDetector(
  modelId: string,
  onProgress?: (p: ProgressInfo) => void,
): Promise<DetectorHandle> {
  const existing = cache.get(modelId);
  if (existing) return existing;

  const promise = (async (): Promise<DetectorHandle> => {
    const { pipeline } = await import("@huggingface/transformers");

    // Try WebGPU, fall back to WASM. Plenty of hackathon laptops have no WebGPU
    // and a hard failure there would take the whole demo down.
    let pipe: Awaited<ReturnType<typeof pipeline>> | null = null;
    let device = "webgpu";
    try {
      pipe = await pipeline("object-detection", modelId, {
        device: "webgpu",
        progress_callback: onProgress as never,
      });
    } catch (err) {
      console.warn("[detector] WebGPU unavailable, falling back to wasm:", err);
      device = "wasm";
      pipe = await pipeline("object-detection", modelId, {
        device: "wasm",
        progress_callback: onProgress as never,
      });
    }

    return {
      modelId,
      device,
      detect: async (input, threshold) => {
        const out = await (pipe as never as (
          i: string | HTMLCanvasElement,
          o: { threshold: number; percentage: boolean },
        ) => Promise<RawDetection[]>)(input, { threshold, percentage: true });
        return Array.isArray(out) ? out : [];
      },
    };
  })();

  // Never cache a rejection — a transient network failure should be retryable.
  promise.catch(() => cache.delete(modelId));
  cache.set(modelId, promise);
  return promise;
}

/**
 * Model output → the pipeline's `Detection`.
 *
 * `percentage: true` gives boxes already normalized 0..1, which is exactly what
 * `BBox` is defined as — so there is no image-size coupling here.
 */
export function toDetections(
  raw: RawDetection[],
  opts: {
    tripId: string;
    frameId: string;
    t: number;
    /** Frame width/height, only used to estimate a depth proxy. */
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
      // A single frame has no temporal tracking, so each detection is its own
      // track. On the robot this comes from the tracker, not the detector.
      trackId: `live_${opts.frameId}_${i}`,
      // Crude but honest monocular proxy: bigger box ≈ closer. The real thing
      // reads iPhone LiDAR.
      depthM: Number((1.4 / Math.max(0.02, Math.sqrt(w * h))).toFixed(2)),
      source: opts.source ?? "manual",
    };
  });
}

const round = (v: number) => Number(v.toFixed(4));

export const formatBytes = (n?: number) =>
  n === undefined ? "" : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${(n / 1e3).toFixed(0)} kB`;
