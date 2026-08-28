/**
 * WebXR pose -> COLMAP pose. The one place a sign error can ruin a whole capture.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS AT ALL
 *
 * Stage 2 of the pipeline (structure-from-motion) is the expensive, fragile one:
 * ~2.5 minutes for 119 frames, and an outright failure on footage with no
 * parallax. It exists only to answer "where was the camera". An Android phone
 * running ARCore behind WebXR ALREADY KNOWS, to 6 degrees of freedom, every
 * frame. Record those poses alongside the frames and stage 2 is skipped, not
 * accelerated — `tools/spark_studio/poses.py::PrecomputedSolver` reads the
 * result and returns without solving anything.
 *
 * `tools/arkit_capture/export_colmap.py` already does exactly this for ARKit,
 * and `docs/brush_capability_report.md` S0.1 proves Brush trains from its
 * output with no COLMAP, no feature matching and no database.db. This file is
 * the browser half of the same trick, and it deliberately performs the SAME
 * conversion as that script, step for step, because that one is known-good
 * against a real trainer and a guess is not.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CONVERSION, AND WHY IT IS TWO THINGS AND NOT ONE
 *
 * WebXR hands you `XRView.transform.matrix`: a CAMERA-TO-WORLD rigid transform,
 * column-major, in a right-handed Y-up space where the camera looks down -Z
 * (the OpenGL convention, which is also ARKit's camera convention).
 *
 * COLMAP `images.txt` wants WORLD-TO-CAMERA, in the OpenCV convention where +Y
 * is down and +Z is forward, written as a Hamilton quaternion `QW QX QY QZ`
 * plus a translation `TX TY TZ`.
 *
 * So there are two independent operations and getting either one alone produces
 * a reconstruction that looks almost right and is wrong:
 *
 *   1. INVERSION.   camera->world becomes world->camera.
 *   2. BASIS FLIP.  diag(1, -1, -1) applied on the LEFT of the inverted pose,
 *                   negating the Y and Z axes of the CAMERA frame only. The
 *                   world frame is untouched — COLMAP does not care which way
 *                   up the world is, only that every camera agrees.
 *
 * Order matters. `FLIP @ inv(M)` is not `inv(FLIP @ M)`. We flip after
 * inverting, which is what export_colmap.py does:
 *
 *     T_wc = inv(camera_transform)
 *     R    = FLIP @ T_wc[:3,:3]
 *     t    = FLIP @ T_wc[:3,3]
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A RIGID INVERSE AND NOT A GENERAL ONE
 *
 * `XRRigidTransform` is, by its own definition, a position and an orientation —
 * there is no scale and no shear in it, ever. For [R | t] the inverse is
 * [R^T | -R^T t], which costs nine multiplies, cannot be ill-conditioned, and
 * cannot quietly absorb a determinant that should have been 1. A general 4x4
 * inverse would work and would also happily invert a matrix that had drifted
 * into being non-rigid, hiding the fact that something upstream was wrong.
 * `isRigid()` below is exported so callers and tests can assert the premise
 * rather than assume it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING HERE TOUCHES THE DOM
 *
 * Every function in this file is pure and takes plain numbers, because there is
 * no Android phone on the machine this was written on and none of it could
 * otherwise be verified. `web/scripts/verify-webxr.ts` exercises all of it, and
 * `tools/spark_studio/verify_webxr_dataset.py` re-checks the output against
 * pycolmap's own reader — a second implementation of the same convention, which
 * is the only kind of agreement worth having about a coordinate system.
 */

/** 16 numbers, COLUMN-major — the layout `XRRigidTransform.matrix` uses. */
export type Mat4 = ArrayLike<number>;

export type Vec3 = readonly [number, number, number];

/** Hamilton, w first. COLMAP's `QW QX QY QZ` order, not three.js's xyzw. */
export type Quat = readonly [number, number, number, number];

/** One camera as COLMAP stores it: the world-to-camera rigid transform. */
export interface ColmapPose {
  /** Rotation, world-to-camera, OpenCV axes. */
  q: Quat;
  /** Translation, world-to-camera, OpenCV axes. Metres, same scale as WebXR. */
  t: Vec3;
}

/** Column-major element access: row `r`, column `c`. */
function el(m: Mat4, r: number, c: number): number {
  return m[c * 4 + r];
}

/**
 * Is this actually a rigid transform?
 *
 * Checked rather than trusted because the entire conversion below assumes it.
 * A matrix whose rotation block has drifted off orthonormal still inverts by
 * transpose — it just inverts to the wrong thing, silently, and the failure
 * surfaces three stages later as a splat that will not converge.
 */
export function isRigid(m: Mat4, tolerance = 1e-4): boolean {
  if (m.length < 16) return false;
  for (let i = 0; i < 16; i++) if (!Number.isFinite(m[i])) return false;
  // Bottom row must be [0 0 0 1] — anything else is a projection, not a pose.
  if (
    Math.abs(el(m, 3, 0)) > tolerance ||
    Math.abs(el(m, 3, 1)) > tolerance ||
    Math.abs(el(m, 3, 2)) > tolerance ||
    Math.abs(el(m, 3, 3) - 1) > tolerance
  ) {
    return false;
  }
  // R^T R == I, column by column.
  for (let a = 0; a < 3; a++) {
    for (let b = a; b < 3; b++) {
      let dot = 0;
      for (let r = 0; r < 3; r++) dot += el(m, r, a) * el(m, r, b);
      if (Math.abs(dot - (a === b ? 1 : 0)) > tolerance) return false;
    }
  }
  return true;
}

/**
 * COLMAP (Hamilton, w-first) quaternion from a 3x3 rotation, as row-major rows.
 *
 * Shepperd's method with the same four branches, in the same order, as
 * `_quat_from_R` in tools/arkit_capture/export_colmap.py. Branching on the
 * largest diagonal term is not an optimisation: the naive trace formula divides
 * by sqrt(1 + trace), which goes to zero for a 180-degree rotation and loses
 * most of its precision well before that. A phone swept through a full circle
 * around a subject passes through exactly those rotations.
 */
export function quatFromRotation(m: readonly number[][]): Quat {
  const trace = m[0][0] + m[1][1] + m[2][2];
  let qw: number, qx: number, qy: number, qz: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    qw = 0.25 * s;
    qx = (m[2][1] - m[1][2]) / s;
    qy = (m[0][2] - m[2][0]) / s;
    qz = (m[1][0] - m[0][1]) / s;
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    qw = (m[2][1] - m[1][2]) / s;
    qx = 0.25 * s;
    qy = (m[0][1] + m[1][0]) / s;
    qz = (m[0][2] + m[2][0]) / s;
  } else if (m[1][1] > m[2][2]) {
    const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    qw = (m[0][2] - m[2][0]) / s;
    qx = (m[0][1] + m[1][0]) / s;
    qy = 0.25 * s;
    qz = (m[1][2] + m[2][1]) / s;
  } else {
    const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
    qw = (m[1][0] - m[0][1]) / s;
    qx = (m[0][2] + m[2][0]) / s;
    qy = (m[1][2] + m[2][1]) / s;
    qz = 0.25 * s;
  }
  return [qw, qx, qy, qz];
}

/** The inverse of `quatFromRotation`, as row-major rows. */
export function rotationFromQuat(q: Quat): number[][] {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  const [w, x, y, z] = [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}

/**
 * THE FUNCTION. WebXR camera-to-world -> COLMAP world-to-camera.
 *
 * `m` is `XRView.transform.matrix` verbatim: 16 numbers, column-major, mapping
 * a point in camera space (+X right, +Y up, -Z forward) into the session's
 * reference space.
 *
 * Throws on a non-rigid input rather than returning a plausible answer. This is
 * called once per captured frame with a value that came straight out of the
 * platform, so a throw here means the platform handed us something that is not
 * a pose — which is worth stopping the capture over, not averaging into it.
 */
export function colmapPoseFromXrCameraToWorld(m: Mat4): ColmapPose {
  if (!isRigid(m)) {
    throw new Error(
      "XR camera-to-world matrix is not a rigid transform; refusing to convert it.",
    );
  }

  // Step 1 — invert. R_wc = R_cw^T, t_wc = -R_cw^T * t_cw.
  const rCw = [
    [el(m, 0, 0), el(m, 0, 1), el(m, 0, 2)],
    [el(m, 1, 0), el(m, 1, 1), el(m, 1, 2)],
    [el(m, 2, 0), el(m, 2, 1), el(m, 2, 2)],
  ];
  const tCw: Vec3 = [el(m, 0, 3), el(m, 1, 3), el(m, 2, 3)];

  // Transpose, and negate-rotate the translation in one pass.
  const rWc = [
    [rCw[0][0], rCw[1][0], rCw[2][0]],
    [rCw[0][1], rCw[1][1], rCw[2][1]],
    [rCw[0][2], rCw[1][2], rCw[2][2]],
  ];
  const tWc: number[] = [0, 0, 0];
  for (let r = 0; r < 3; r++) {
    tWc[r] = -(rWc[r][0] * tCw[0] + rWc[r][1] * tCw[1] + rWc[r][2] * tCw[2]);
  }

  // Step 2 — flip the CAMERA axes: diag(1,-1,-1) on the left negates rows 1
  // and 2 of both the rotation and the translation. Applying it on the right
  // instead would flip the WORLD, which is a different (and wrong) scene.
  const rColmap = [
    [rWc[0][0], rWc[0][1], rWc[0][2]],
    [-rWc[1][0], -rWc[1][1], -rWc[1][2]],
    [-rWc[2][0], -rWc[2][1], -rWc[2][2]],
  ];
  const tColmap: Vec3 = [tWc[0], -tWc[1], -tWc[2]];

  return { q: quatFromRotation(rColmap), t: tColmap };
}

/**
 * The inverse trip, COLMAP -> WebXR camera-to-world (column-major).
 *
 * Only the verifier needs this, and that is reason enough for it to exist: a
 * conversion you can only run in one direction can only be checked against a
 * second implementation of itself. Round-tripping a few hundred random poses
 * through both directions catches a transposed index that no amount of reading
 * the code will.
 */
export function xrCameraToWorldFromColmapPose(pose: ColmapPose): number[] {
  const rColmap = rotationFromQuat(pose.q);

  // Undo the flip (diag(1,-1,-1) is its own inverse), giving world->camera in
  // the GL convention.
  const rWc = [
    [rColmap[0][0], rColmap[0][1], rColmap[0][2]],
    [-rColmap[1][0], -rColmap[1][1], -rColmap[1][2]],
    [-rColmap[2][0], -rColmap[2][1], -rColmap[2][2]],
  ];
  const tWc: Vec3 = [pose.t[0], -pose.t[1], -pose.t[2]];

  // Undo the inversion.
  const rCw = [
    [rWc[0][0], rWc[1][0], rWc[2][0]],
    [rWc[0][1], rWc[1][1], rWc[2][1]],
    [rWc[0][2], rWc[1][2], rWc[2][2]],
  ];
  const tCw: number[] = [0, 0, 0];
  for (let r = 0; r < 3; r++) {
    tCw[r] = -(rCw[r][0] * tWc[0] + rCw[r][1] * tWc[1] + rCw[r][2] * tWc[2]);
  }

  const out = new Array<number>(16).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) out[c * 4 + r] = rCw[r][c];
    out[12 + r] = tCw[r];
  }
  out[15] = 1;
  return out;
}

/** Where a WebXR camera stood in the reference space, straight off the matrix. */
export function cameraPositionFromXr(m: Mat4): Vec3 {
  return [el(m, 0, 3), el(m, 1, 3), el(m, 2, 3)];
}

/**
 * Build a camera-to-world matrix that puts a camera AT `eye` LOOKING AT
 * `target`, in WebXR's convention (-Z forward, +Y up).
 *
 * Test scaffolding, and exported rather than duplicated in the verifier because
 * a look-at written twice is a look-at written differently twice. It is also
 * the only way to state a test case in terms a person can check by eye — "the
 * camera is two metres back and the subject is at the origin, so the subject
 * must land on the principal point" — rather than in terms of sixteen numbers.
 */
export function lookAtCameraToWorld(eye: Vec3, target: Vec3, up: Vec3 = [0, 1, 0]): number[] {
  const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (v: Vec3): Vec3 => {
    const n = Math.hypot(v[0], v[1], v[2]);
    if (n === 0) throw new Error("lookAtCameraToWorld: degenerate direction");
    return [v[0] / n, v[1] / n, v[2] / n];
  };
  const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];

  // Camera looks down -Z, so the camera's +Z axis points AWAY from the target.
  const zAxis = norm(sub(eye, target));
  const xAxis = norm(cross(up, zAxis));
  const yAxis = cross(zAxis, xAxis);

  const out = new Array<number>(16).fill(0);
  for (let r = 0; r < 3; r++) {
    out[0 * 4 + r] = xAxis[r];
    out[1 * 4 + r] = yAxis[r];
    out[2 * 4 + r] = zAxis[r];
    out[3 * 4 + r] = eye[r];
  }
  out[15] = 1;
  return out;
}
