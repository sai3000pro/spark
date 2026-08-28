/**
 * The wire format for one posed frame, and the one thing both ends derive from it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS ITS OWN MODULE AND NOT PART OF ./capture.ts
 *
 * `./capture.ts` carries a `"use client"` directive, because it drives a WebXR
 * session and a WebGL context and has no meaning on a server. Next takes that
 * directive at its word: every export of a `"use client"` module becomes a
 * CLIENT REFERENCE, and a server that calls one gets
 *
 *     Attempted to call intrinsicsForRecord() from the server but
 *     intrinsicsForRecord is on the client.
 *
 * which is exactly what `app/api/capture/posed/[handoffId]` got when this
 * function lived beside the capture class. Found by running the route, not by
 * reading it: it typechecks perfectly, and the failure only appears when a real
 * request reaches a real handler.
 *
 * So the shared, pure part lives here, where neither end owns it. The phone
 * fills a record in; the server derives intrinsics from it with the same code.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RECORD CARRIES RAW PLATFORM VALUES, NOT OUR READING OF THEM
 *
 * Derive, don't sync. `cameraToWorld` and `projection` are `XRView`'s own
 * matrices, verbatim and column-major; the intrinsics and the COLMAP pose are
 * computed from them wherever they are needed. Sending fx/fy/cx/cy instead would
 * put a second author on the format, and a fix to the derivation would land on
 * only one of them.
 */

import { intrinsicsFromProjection, scaleIntrinsics, type PinholeIntrinsics } from "./intrinsics";

/** What the phone sends up for one frame. */
export interface CapturedFrameRecord {
  /** 1-based, dense, in capture order. Becomes the image id and the filename. */
  index: number;
  /** `XRView.transform.matrix`, verbatim, column-major. Camera-to-world. */
  cameraToWorld: number[];
  /** `XRView.projectionMatrix`, verbatim, column-major. */
  projection: number[];
  /**
   * `XRCamera.width`/`.height` — the size the projection matrix belongs to, and
   * NOT the size of the framebuffer the scene was rendered into.
   */
  cameraWidth: number;
  cameraHeight: number;
  /** The size the JPEG was actually encoded at, after downscaling. */
  imageWidth: number;
  imageHeight: number;
  /** `XRFrame`'s predicted display time. Provenance only; nothing reads it. */
  timestampMs: number;
}

/**
 * The intrinsics for one recorded frame, in pixels of the stored image.
 *
 * Two steps, and both matter: read fx/fy/cx/cy against the CAMERA image size the
 * projection matrix describes, then rescale to the size we actually wrote. Doing
 * it in one step against the stored size would be wrong by the downscale ratio —
 * a focal length off by 2x, which reconstructs as a scene at the wrong distance.
 */
export function intrinsicsForRecord(record: CapturedFrameRecord): PinholeIntrinsics {
  const full = intrinsicsFromProjection(record.projection, record.cameraWidth, record.cameraHeight);
  return scaleIntrinsics(full, record.imageWidth, record.imageHeight);
}
