/**
 * XRView projection matrix -> COLMAP PINHOLE intrinsics, in pixels.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT JUST "fov -> focal length"
 *
 * A phone's AR camera frustum is frequently NOT symmetric. The colour sensor is
 * offset from the centre of the display, the passthrough image gets cropped to
 * the display aspect, and on a headset each eye is deliberately off-axis. So the
 * principal point is not W/2, H/2, and a derivation that assumes it is will put
 * every reprojection a few pixels out — enough to make a splat soft everywhere
 * and nowhere obviously broken.
 *
 * The projection matrix already carries the asymmetry, in P[0][2] and P[1][2].
 * Reading it out is exact, needs no assumption about the device, and survives a
 * platform that changes its crop mid-session.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DERIVATION, WRITTEN DOWN BECAUSE THE TWO SIGNS ARE NOT THE SAME
 *
 * WebXR gives a standard GL perspective matrix, column-major:
 *
 *     clip.x = P00 * x + P02 * z          clip.w = -z
 *     clip.y = P11 * y + P12 * z
 *
 * With d = -z (metres in front of the camera, positive):
 *
 *     ndc.x = clip.x / clip.w = P00 * (x/d) - P02
 *     ndc.y = clip.y / clip.w = P11 * (y/d) - P12
 *
 * Pixels. NDC x runs left-to-right like pixel u, but NDC y runs BOTTOM-to-top
 * while pixel v runs TOP-to-bottom, so the two mappings are not symmetric:
 *
 *     u = (ndc.x + 1) / 2 * W
 *     v = (1 - ndc.y) / 2 * H
 *
 * And OpenCV camera coordinates, which is what COLMAP's fx/fy/cx/cy index into,
 * are the GL ones with Y and Z negated: X_cv = x, Y_cv = -y, Z_cv = d. So
 *
 *     u = fx * (x/d)  + cx        v = fy * (-y/d) + cy
 *
 * Substituting and matching coefficients:
 *
 *     fx = W * P00 / 2            cx = W * (1 - P02) / 2
 *     fy = H * P11 / 2            cy = H * (1 + P12) / 2
 *                                          ^^^ minus for x, PLUS for y
 *
 * That asymmetric pair of signs is the whole reason this file has a derivation
 * in it and a round-trip test behind it. Both reduce to the centre of the image
 * when the frustum is symmetric (P02 = P12 = 0), which is exactly why a symmetric
 * test case proves nothing and the verifier uses an off-axis one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHICH WIDTH AND HEIGHT
 *
 * The camera IMAGE's, not the WebGL layer viewport's. The raw-camera-access
 * spec aligns the camera image with the XRView it came from — same pose, same
 * projection — but the image is delivered at the sensor's own resolution
 * (`XRCamera.width` / `.height`), which on a phone is routinely different from
 * the framebuffer the scene is rendered into. Intrinsics are in pixels OF THE
 * IMAGE COLMAP WILL READ, so they must be derived against the image we actually
 * write to disk. Passing the viewport here would scale fx/fy by the ratio of
 * the two and put the reconstruction at the wrong focal length.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOT VERIFIED ON HARDWARE. See the note at the top of ./capture.ts: the
 * arithmetic below is tested against synthetic matrices in
 * web/scripts/verify-webxr.ts, but no real XRView projection matrix from a real
 * Android device has ever been fed to it on this machine.
 */

/** COLMAP's PINHOLE model: no distortion terms, four parameters, in pixels. */
export interface PinholeIntrinsics {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
}

/** 16 numbers, column-major — `XRView.projectionMatrix`'s own layout. */
export type ProjectionMatrix = ArrayLike<number>;

export class IntrinsicsError extends Error {}

/**
 * Read fx/fy/cx/cy out of a WebXR projection matrix.
 *
 * `width`/`height` are the dimensions of the image these intrinsics will be
 * paired with — the camera image, not the render target. See above.
 */
export function intrinsicsFromProjection(
  projection: ProjectionMatrix,
  width: number,
  height: number,
): PinholeIntrinsics {
  if (projection.length < 16) {
    throw new IntrinsicsError(
      `Projection matrix has ${projection.length} elements, expected 16.`,
    );
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new IntrinsicsError(
      `Camera image size must be positive, got ${width}x${height}.`,
    );
  }

  // Column-major: element (row r, col c) lives at c*4 + r.
  const p00 = projection[0];
  const p11 = projection[5];
  const p02 = projection[8];
  const p12 = projection[9];

  if (!Number.isFinite(p00) || !Number.isFinite(p11) || p00 <= 0 || p11 <= 0) {
    throw new IntrinsicsError(
      "Projection matrix has no usable focal terms — this is not a perspective " +
        "projection. An orthographic or zero matrix cannot describe a camera.",
    );
  }

  return {
    fx: (width * p00) / 2,
    fy: (height * p11) / 2,
    cx: (width * (1 - p02)) / 2,
    cy: (height * (1 + p12)) / 2,
    width,
    height,
  };
}

/**
 * The inverse: a GL projection matrix that reproduces these intrinsics exactly.
 *
 * Exists ONLY so the verifier can state a test case in terms a person can check
 * ("a 640x480 camera with a 30-pixel principal-point offset") and then assert
 * that the reader gets those numbers back. Nothing in the capture path calls it.
 */
export function projectionFromIntrinsics(
  k: PinholeIntrinsics,
  near = 0.1,
  far = 1000,
): number[] {
  const m = new Array<number>(16).fill(0);
  m[0] = (2 * k.fx) / k.width;
  m[5] = (2 * k.fy) / k.height;
  m[8] = 1 - (2 * k.cx) / k.width;
  m[9] = (2 * k.cy) / k.height - 1;
  m[10] = -(far + near) / (far - near);
  m[11] = -1;
  m[14] = -(2 * far * near) / (far - near);
  return m;
}

/**
 * Rescale intrinsics for an image that was resized before being written.
 *
 * The capture path downscales frames — a 4K camera image per frame is both more
 * than Brush uses at `--max-resolution 720` and more than a phone can JPEG-
 * encode at capture rate. A resize that does not carry the intrinsics with it is
 * the same bug as using the viewport size above, just later.
 */
export function scaleIntrinsics(
  k: PinholeIntrinsics,
  width: number,
  height: number,
): PinholeIntrinsics {
  const sx = width / k.width;
  const sy = height / k.height;
  return {
    fx: k.fx * sx,
    fy: k.fy * sy,
    cx: k.cx * sx,
    cy: k.cy * sy,
    width,
    height,
  };
}

/**
 * Do two sets of intrinsics describe the same camera?
 *
 * Used to decide whether a capture needs one `cameras.txt` entry or one per
 * frame. Tolerance is a quarter of a pixel: below that the difference cannot
 * move a reprojection by a pixel even at the edge of the sensor, and treating
 * float noise as a new camera would write one camera record per frame for no
 * reason.
 */
export function sameIntrinsics(
  a: PinholeIntrinsics,
  b: PinholeIntrinsics,
  tolerance = 0.25,
): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    Math.abs(a.fx - b.fx) <= tolerance &&
    Math.abs(a.fy - b.fy) <= tolerance &&
    Math.abs(a.cx - b.cx) <= tolerance &&
    Math.abs(a.cy - b.cy) <= tolerance
  );
}
