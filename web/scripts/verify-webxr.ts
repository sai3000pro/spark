/**
 * The WebXR capture path's arithmetic, proven without a phone.
 *
 *   npx tsx scripts/verify-webxr.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS CAN AND CANNOT ESTABLISH
 *
 * There is no Android phone on this machine and WebXR cannot be run anywhere
 * else, so the capture SESSION is unverifiable here — see the block at the top
 * of lib/webxr/capture.ts, which says so in the code as well. What IS verifiable
 * is everything the session hands off to: the coordinate conversion, the
 * intrinsics derivation, and the file format. Those are where the bugs live.
 *
 * A coordinate convention has exactly two failure modes and both are silent:
 * a reconstruction that comes out mirrored, or one that comes out upside down
 * and converges to mush. Neither throws. Neither is visible in a diff. So the
 * checks below are not "does the function return a number" — they are:
 *
 *   · put a camera somewhere known, looking at something known;
 *   · convert it;
 *   · project a world point THROUGH the converted pose;
 *   · assert the pixel it lands on is the one a person can work out by hand.
 *
 * Plus round-trips, which catch transposed indices that a single-direction test
 * cannot, and a hard-coded quaternion for the identity camera, which catches a
 * basis flip applied on the wrong side.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THEN A SECOND OPINION
 *
 * Agreeing with yourself about a coordinate system proves nothing. So this
 * script also WRITES a synthetic COLMAP dataset, and
 * `tools/spark_studio/verify_webxr.py` reads it back with pycolmap — a separate
 * implementation of the same format by the people who defined it — and checks
 * that pycolmap's own projection of the same world points lands on the same
 * pixels this file predicted. Run them in that order:
 *
 *   npx tsx scripts/verify-webxr.ts
 *   ../.venv-splat/Scripts/python.exe ../tools/spark_studio/verify_webxr.py
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  camerasTxt,
  frameFileName,
  imagesTxt,
  points3DTxt,
  projectThroughColmapPose,
  sparseModel,
  type PosedFrame,
} from "../lib/webxr/colmap";
import {
  intrinsicsFromProjection,
  projectionFromIntrinsics,
  sameIntrinsics,
  scaleIntrinsics,
  type PinholeIntrinsics,
} from "../lib/webxr/intrinsics";
import {
  colmapPoseFromXrCameraToWorld,
  isRigid,
  lookAtCameraToWorld,
  quatFromRotation,
  rotationFromQuat,
  xrCameraToWorldFromColmapPose,
  type Vec3,
} from "../lib/webxr/math";
import { describeWebXrSupport, type WebXrFacts } from "../lib/webxr/support";

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
}

function near(label: string, got: number, want: number, tol = 1e-6): void {
  const ok = Number.isFinite(got) && Math.abs(got - want) <= tol;
  check(label, ok, ok ? "" : `got ${got}, want ${want} (tol ${tol})`);
}

function section(title: string): void {
  console.log(`\n${title}`);
}

// ── deterministic pseudo-random, so a failure is reproducible ────────────────
//
// Math.random() would make a rare sign bug appear once in fifty runs and be
// unreproducible when it did. A fixed seed means the same 300 poses every time.
let seed = 0x2f6e2b1;
function rand(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
}

function randomRigid(): number[] {
  const eye: Vec3 = [(rand() - 0.5) * 8, (rand() - 0.5) * 8, (rand() - 0.5) * 8];
  const target: Vec3 = [(rand() - 0.5) * 4, (rand() - 0.5) * 4, (rand() - 0.5) * 4];
  // A random up vector too, or every test case shares one gauge and a bug in
  // the Y row hides behind it.
  const up: Vec3 = [rand() - 0.5, rand() - 0.5 + 1.0, rand() - 0.5];
  try {
    return lookAtCameraToWorld(eye, target, up);
  } catch {
    return lookAtCameraToWorld([0, 0, 3], [0, 0, 0]);
  }
}

// ═════════════════════════════════════════════════════════════════════════════

function checkRigidity(): void {
  section("A pose is a pose");

  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  check("identity is rigid", isRigid(identity));
  check("a look-at is rigid", isRigid(lookAtCameraToWorld([0, 1.5, 3], [0, 0, 0])));

  const scaled = identity.slice();
  scaled[0] = 2;
  check("a scaled matrix is refused", !isRigid(scaled));

  const sheared = identity.slice();
  sheared[4] = 0.3; // column 1, row 0
  check("a sheared matrix is refused", !isRigid(sheared));

  const projective = identity.slice();
  projective[11] = -1; // bottom row, column 2 — a projection, not a transform
  check("a projection matrix is refused", !isRigid(projective));

  const nan = identity.slice();
  nan[5] = Number.NaN;
  check("NaN is refused", !isRigid(nan));

  let threw = false;
  try {
    colmapPoseFromXrCameraToWorld(scaled);
  } catch {
    threw = true;
  }
  check("converting a non-rigid matrix throws rather than guessing", threw);
}

function checkQuaternions(): void {
  section("Quaternions, including the branches that only 180 degrees reaches");

  // Each of Shepperd's four branches, chosen so the trace lands in a different
  // one. These are the cases the naive trace formula divides by ~zero on, and
  // they are ordinary phone motions: a half-turn around a subject hits all of
  // them.
  const cases: Record<string, number[][]> = {
    identity: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    "180 about x": [
      [1, 0, 0],
      [0, -1, 0],
      [0, 0, -1],
    ],
    "180 about y": [
      [-1, 0, 0],
      [0, 1, 0],
      [0, 0, -1],
    ],
    "180 about z": [
      [-1, 0, 0],
      [0, -1, 0],
      [0, 0, 1],
    ],
  };
  for (const [name, r] of Object.entries(cases)) {
    const back = rotationFromQuat(quatFromRotation(r));
    let worst = 0;
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) worst = Math.max(worst, Math.abs(back[i][j] - r[i][j]));
    check(`${name} survives R -> q -> R`, worst < 1e-9, `max element error ${worst.toExponential(2)}`);
  }

  // Random rotations, from the same look-at generator the poses use.
  let worst = 0;
  for (let n = 0; n < 500; n++) {
    const m = randomRigid();
    const r = [
      [m[0], m[4], m[8]],
      [m[1], m[5], m[9]],
      [m[2], m[6], m[10]],
    ];
    const back = rotationFromQuat(quatFromRotation(r));
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) worst = Math.max(worst, Math.abs(back[i][j] - r[i][j]));
  }
  check("500 random rotations survive R -> q -> R", worst < 1e-9, `max ${worst.toExponential(2)}`);
}

function checkIdentityCameraPose(): void {
  section("The one pose whose answer can be written down in advance");

  // A camera at the world origin, unrotated: in WebXR that is +X right, +Y up,
  // looking down -Z. Its camera-to-world is the identity, so world-to-camera is
  // also the identity, and the ONLY thing the conversion does is the basis flip
  // diag(1,-1,-1) — which is a 180-degree rotation about X, quaternion
  // (w=0, x=1, y=0, z=0).
  //
  // This is the check that catches a flip applied on the wrong side or omitted:
  // with no flip the answer would be the identity quaternion (1,0,0,0), and
  // with the flip applied on the right it would be the same here but wrong the
  // moment the camera moves — which is why the translation cases follow.
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const pose = colmapPoseFromXrCameraToWorld(identity);
  near("identity camera: qw", pose.q[0], 0);
  near("identity camera: qx", Math.abs(pose.q[1]), 1);
  near("identity camera: qy", pose.q[2], 0);
  near("identity camera: qz", pose.q[3], 0);
  near("identity camera: tx", pose.t[0], 0);
  near("identity camera: ty", pose.t[1], 0);
  near("identity camera: tz", pose.t[2], 0);

  // Move the camera two metres along +X, still unrotated. COLMAP stores
  // world-to-camera, so the translation is the world origin AS SEEN FROM the
  // camera: two metres to its LEFT, i.e. tx = -2. Getting -2 rather than +2 is
  // the difference between a scene and its mirror image.
  const shifted = identity.slice();
  shifted[12] = 2;
  const shiftedPose = colmapPoseFromXrCameraToWorld(shifted);
  near("camera moved +2 in x: world origin sits at tx = -2", shiftedPose.t[0], -2);

  // Two metres UP in WebXR (+Y). In OpenCV camera axes +Y is DOWN, so the world
  // origin is two metres below the camera, which is +2 in ty. The sign FLIPS
  // relative to the x case, and that is the whole basis flip in one number.
  const lifted = identity.slice();
  lifted[13] = 2;
  const liftedPose = colmapPoseFromXrCameraToWorld(lifted);
  near("camera moved +2 in y: world origin sits at ty = +2 (Y is down)", liftedPose.t[1], 2);

  // Two metres BACK in WebXR (+Z is behind the camera, which looks down -Z). In
  // OpenCV +Z is forward, so the world origin is two metres IN FRONT: tz = +2,
  // positive depth. A negative answer here means every point in the scene is
  // behind the camera.
  const backed = identity.slice();
  backed[14] = 2;
  const backedPose = colmapPoseFromXrCameraToWorld(backed);
  near("camera moved +2 in z: world origin sits at tz = +2 (in front)", backedPose.t[2], 2);
}

function checkIntrinsics(): void {
  section("Intrinsics out of a projection matrix");

  // Deliberately OFF-AXIS. A symmetric frustum makes cx = W/2 and cy = H/2
  // whatever the sign convention, so a symmetric test passes with the two signs
  // swapped and proves nothing at all.
  const truth: PinholeIntrinsics = {
    fx: 812.5,
    fy: 806.25,
    cx: 331.5, // not 320
    cy: 237.25, // not 240
    width: 640,
    height: 480,
  };
  const projection = projectionFromIntrinsics(truth);
  const got = intrinsicsFromProjection(projection, truth.width, truth.height);
  near("fx round-trips", got.fx, truth.fx, 1e-9);
  near("fy round-trips", got.fy, truth.fy, 1e-9);
  near("cx round-trips (off-axis)", got.cx, truth.cx, 1e-9);
  near("cy round-trips (off-axis)", got.cy, truth.cy, 1e-9);

  // A symmetric frustum must still land in the middle. This is the sanity leg:
  // if the off-axis case passes and this one does not, the two signs are the
  // wrong way round in a way that happens to cancel.
  const symmetric = intrinsicsFromProjection(
    projectionFromIntrinsics({ fx: 500, fy: 500, cx: 320, cy: 240, width: 640, height: 480 }),
    640,
    480,
  );
  near("symmetric frustum: cx is the middle", symmetric.cx, 320, 1e-9);
  near("symmetric frustum: cy is the middle", symmetric.cy, 240, 1e-9);

  // The asymmetry is real and has the sign the derivation claims: a frustum
  // shifted so P02 > 0 puts the optical axis LEFT of the image centre.
  const shifted = projectionFromIntrinsics({ ...truth, cx: 200 });
  check("P02 > 0 when the principal point is left of centre", shifted[8] > 0, `P02=${shifted[8]}`);

  // A downscaled image, which the capture path always produces.
  const half = scaleIntrinsics(truth, 320, 240);
  near("halving the image halves fx", half.fx, truth.fx / 2, 1e-9);
  near("halving the image halves cy", half.cy, truth.cy / 2, 1e-9);
  check("a halved camera is not the same camera", !sameIntrinsics(truth, half));
  check("a camera equals itself", sameIntrinsics(truth, { ...truth }));

  // Garbage in, exception out. An orthographic or zeroed projection matrix is
  // not a camera, and returning Infinity for fx would write "Infinity" into
  // cameras.txt and fail three stages later.
  let threw = 0;
  for (const bad of [new Array(16).fill(0), new Array(4).fill(1)]) {
    try {
      intrinsicsFromProjection(bad, 640, 480);
    } catch {
      threw++;
    }
  }
  check("a non-perspective projection is refused", threw === 2);
}

/**
 * The check that means the most: a scene laid out in metres, and the pixels a
 * person can verify with a ruler and no code at all.
 */
function checkProjectionGeometry(): void {
  section("A known camera, a known point, and the pixel it must land on");

  const k: PinholeIntrinsics = {
    fx: 800,
    fy: 800,
    cx: 320,
    cy: 240,
    width: 640,
    height: 480,
  };

  // Camera two metres back along +Z, looking at the origin — so it looks down
  // -Z, +X is right and +Y is up. Exactly the arrangement a person can picture.
  const cameraToWorld = lookAtCameraToWorld([0, 0, 2], [0, 0, 0]);
  const pose = colmapPoseFromXrCameraToWorld(cameraToWorld);

  const at = (p: Vec3) => projectThroughColmapPose(pose, k, p);

  const centre = at([0, 0, 0]);
  check("the origin is in front of the camera", centre !== null);
  if (centre) {
    near("the origin lands on the principal point (u)", centre.u, 320, 1e-9);
    near("the origin lands on the principal point (v)", centre.v, 240, 1e-9);
    near("the origin is two metres away", centre.depth, 2, 1e-9);
  }

  // 0.1 m to the right, 2 m away, 800 px focal length: 800 * 0.1 / 2 = 40 px.
  const right = at([0.1, 0, 0]);
  check("a point to the world's +x is in front", right !== null);
  if (right) near("...and lands 40 px RIGHT of centre", right.u, 360, 1e-9);

  // 0.1 m UP in the world. Pixel v grows DOWNWARD, so up in the world must mean
  // a SMALLER v. This single assertion is what a missing Y flip breaks.
  const up = at([0, 0.1, 0]);
  check("a point above the origin is in front", up !== null);
  if (up) near("...and lands 40 px ABOVE centre (v smaller)", up.v, 200, 1e-9);

  // Behind the camera. Must be null, not a plausible pixel — a sign error in
  // the Z flip shows up first as points that project sensibly while sitting
  // behind the lens, and a reconstruction built from those is inside out.
  check("a point behind the camera projects to nothing", at([0, 0, 4]) === null);

  // Now move the camera and look from the side. The subject is still at the
  // origin, so it must STILL land on the principal point — this is the check
  // that the rotation, not just the translation, converted correctly.
  for (const eye of [
    [2, 0, 0],
    [0, 2, 0.001],
    [-1.5, 1.0, 2.2],
    [0, 0, -3],
  ] as Vec3[]) {
    const p = colmapPoseFromXrCameraToWorld(lookAtCameraToWorld(eye, [0, 0, 0]));
    const hit = projectThroughColmapPose(p, k, [0, 0, 0]);
    const ok =
      hit !== null && Math.abs(hit.u - 320) < 1e-6 && Math.abs(hit.v - 240) < 1e-6 && hit.depth > 0;
    check(
      `a camera at [${eye}] looking at the origin puts it dead centre`,
      ok,
      ok ? "" : JSON.stringify(hit),
    );
  }

  // Handedness. Standing at +Z looking at the origin, world +X is on the right.
  // Standing at -Z looking at the origin, the same world point is on the LEFT.
  // A mirrored conversion passes every symmetric test above and fails this one.
  const front = colmapPoseFromXrCameraToWorld(lookAtCameraToWorld([0, 0, 2], [0, 0, 0]));
  const behind = colmapPoseFromXrCameraToWorld(lookAtCameraToWorld([0, 0, -2], [0, 0, 0]));
  const a = projectThroughColmapPose(front, k, [0.1, 0, 0]);
  const b = projectThroughColmapPose(behind, k, [0.1, 0, 0]);
  check(
    "the scene is not mirrored: +x is right from the front and left from behind",
    a !== null && b !== null && a.u > 320 && b.u < 320,
    `${a?.u} then ${b?.u}`,
  );
}

function checkRoundTrip(): void {
  section("There and back again, 300 times");

  let worstR = 0;
  let worstT = 0;
  for (let n = 0; n < 300; n++) {
    const m = randomRigid();
    const back = xrCameraToWorldFromColmapPose(colmapPoseFromXrCameraToWorld(m));
    for (let i = 0; i < 12; i++) {
      const err = Math.abs(back[i] - m[i]);
      if (i % 4 === 3) continue;
      if (i >= 12) worstT = Math.max(worstT, err);
      else worstR = Math.max(worstR, err);
    }
    for (let i = 12; i < 15; i++) worstT = Math.max(worstT, Math.abs(back[i] - m[i]));
  }
  check("rotation survives the round trip", worstR < 1e-9, `max ${worstR.toExponential(2)}`);
  check("translation survives the round trip", worstT < 1e-9, `max ${worstT.toExponential(2)}`);

  // And the round trip is not trivially the identity function: assert the
  // intermediate really is a different convention, or a pair of no-ops would
  // pass everything above.
  //
  // The camera is deliberately off every axis. A camera at [0,0,2] looking at
  // the origin happens to give tz = +2 in BOTH conventions — the inversion and
  // the Z flip cancel — so that case would have proved the opposite of what it
  // looks like it proves.
  const m = lookAtCameraToWorld([1, 2, 3], [0, 0, 0]);
  const pose = colmapPoseFromXrCameraToWorld(m);
  const drift = Math.hypot(pose.t[0] - m[12], pose.t[1] - m[13], pose.t[2] - m[14]);
  check(
    "the COLMAP pose is genuinely a different convention, not a copy",
    drift > 1,
    `t=[${pose.t.map((n) => n.toFixed(3))}] vs matrix t=[${[m[12], m[13], m[14]]}]`,
  );
}

function checkTextFormat(): void {
  section("The three files, as COLMAP's text reader will see them");

  const k: PinholeIntrinsics = { fx: 800, fy: 800, cx: 320, cy: 240, width: 640, height: 480 };
  const frames: PosedFrame[] = [1, 2, 3].map((index) => ({
    index,
    cameraToWorld: lookAtCameraToWorld([index * 0.3, 0, 2], [0, 0, 0]),
    intrinsics: k,
  }));

  const cams = camerasTxt(frames).trimEnd().split("\n");
  check("cameras.txt starts with a comment", cams[0].startsWith("#"));
  check("cameras.txt has one record per image", cams.length === 4);
  const camFields = cams[1].split(" ");
  check("a camera record has 8 fields", camFields.length === 8, cams[1]);
  check("the model is PINHOLE", camFields[1] === "PINHOLE");
  check("width and height are integers", /^\d+$/.test(camFields[2]) && /^\d+$/.test(camFields[3]));

  const raw = imagesTxt(frames);
  const lines = raw.split("\n");
  check("images.txt starts with a comment", lines[0].startsWith("#"));
  // Each image is a pose line then a BLANK points2D line. A reader that has
  // consumed a pose line consumes the next line as its 2D points whatever it
  // holds, so dropping the blank makes image 2 read as image 1's feature list.
  check("image 1 pose then a blank line", lines[1].length > 0 && lines[2] === "");
  check("image 2 pose then a blank line", lines[3].length > 0 && lines[4] === "");
  const imgFields = lines[1].split(" ");
  check("an image record has 10 fields", imgFields.length === 10, lines[1]);
  check("the NAME field matches the file on disk", imgFields[9] === frameFileName(1));
  check(
    "the NAME field is the frame_*.jpg the pipeline globs for",
    /^frame_\d{5}\.jpg$/.test(imgFields[9]),
  );

  // Exponential notation is the quiet killer here: COLMAP's text reader scans a
  // plain float and stops at the 'e', silently reading 1e-7 as 1. A camera a
  // ten-millionth of a metre from the origin is an entirely ordinary first
  // frame of a session.
  check("no scientific notation anywhere in images.txt", !/[eE][+-]?\d/.test(raw), raw.slice(0, 120));
  check("no scientific notation in cameras.txt", !/[eE][+-]?\d/.test(camerasTxt(frames)));

  const tiny: PosedFrame[] = [
    {
      index: 1,
      cameraToWorld: (() => {
        const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        m[12] = 1e-9;
        return m;
      })(),
      intrinsics: k,
    },
  ];
  check(
    "a nanometre offset writes as fixed point, not 1e-9",
    imagesTxt(tiny).includes("-0.000000001") || imagesTxt(tiny).includes("0.000000000"),
    imagesTxt(tiny).split("\n")[1],
  );

  const pts = points3DTxt();
  check("points3D.txt is written even though it is empty", pts.startsWith("# 3D point list"));
  check("points3D.txt has no body", pts.trimEnd().split("\n").length === 1);

  let threw = false;
  try {
    sparseModel([]);
  } catch {
    threw = true;
  }
  check("a model with no images is refused", threw);
}

function checkSupportPolicy(): void {
  section("What the UI is allowed to say");

  const facts = (over: Partial<WebXrFacts> = {}): WebXrFacts => ({
    hasXr: true,
    secureContext: true,
    immersiveAr: true,
    looksLikeIos: false,
    ...over,
  });

  const good = describeWebXrSupport(facts(), "granted");
  check("a granted ARCore phone is offered the option", good.available);
  check("...with no excuse attached", good.blockedBecause === null);
  check("...and nothing left unproven", !good.cameraAccessUnproven);

  const untested = describeWebXrSupport(facts(), "unknown");
  check("before anyone taps, the option is offered", untested.available);
  check(
    "...but camera access is flagged as not yet proven",
    untested.cameraAccessUnproven,
    "the UI must not promise what needs a gesture to find out",
  );

  const ios = describeWebXrSupport(facts({ hasXr: false, immersiveAr: null, looksLikeIos: true }));
  check("an iPhone is not offered the option", !ios.available);
  check("...and is told it is Safari, not the phone", /Safari/.test(ios.blockedBecause ?? ""));
  check(
    "...and is not told to try another browser, which cannot help on iOS",
    !/try (another|a different)/i.test(ios.blockedBecause ?? ""),
  );
  check("...and is told what to do instead", /video/i.test(ios.blockedBecause ?? ""));

  const noXr = describeWebXrSupport(facts({ hasXr: false, immersiveAr: null }));
  check("a non-iOS browser without WebXR gets the generic reason", !noXr.available);
  check("...which does not blame Safari", !/Safari/.test(noXr.blockedBecause ?? ""));

  const noArcore = describeWebXrSupport(facts({ immersiveAr: false }));
  check("WebXR without an AR session is refused", !noArcore.available);
  check(
    "...and names the thing that is missing",
    /Google Play Services for AR/.test(noArcore.blockedBecause ?? ""),
  );

  const insecure = describeWebXrSupport(facts({ secureContext: false }));
  check("plain HTTP is refused", !insecure.available);
  check(
    "...and blamed on the connection, not the phone",
    /HTTPS/.test(insecure.blockedBecause ?? "") && /not a limit of your phone/.test(insecure.blockedBecause ?? ""),
  );

  const refused = describeWebXrSupport(facts(), "refused");
  check("a phone that withholds the camera image is refused", !refused.available);
  check(
    "...and told why, in terms of the outcome",
    /poses and no pictures/.test(refused.blockedBecause ?? ""),
  );

  // Every blocked reason must be a sentence, not a code. This is the rule
  // lib/reconstruction/targets.ts sets and the reason it exists.
  for (const s of [ios, noXr, noArcore, insecure, refused]) {
    check(
      `blocked reason reads as English (${(s.blockedBecause ?? "").slice(0, 28)}...)`,
      (s.blockedBecause ?? "").length > 40 && /[.!]$/.test(s.blockedBecause ?? ""),
    );
  }
}

/**
 * Write a real dataset for pycolmap to argue with.
 *
 * The images are a genuine 1x1 JPEG rather than empty files: `PrecomputedSolver`
 * only counts them, but a dataset whose images will not decode is not a dataset
 * and would be a lie sitting in a temp directory waiting to be trusted.
 */
function writeSyntheticDataset(): string {
  section("A synthetic dataset, for the second opinion");

  const out =
    process.env.WEBXR_VERIFY_DIR ?? path.join(os.tmpdir(), "spark-webxr-verify");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(path.join(out, "images"), { recursive: true });
  mkdirSync(path.join(out, "sparse", "0"), { recursive: true });

  const k: PinholeIntrinsics = {
    fx: 812.5,
    fy: 806.25,
    cx: 331.5,
    cy: 237.25,
    width: 640,
    height: 480,
  };

  // A ring of cameras around the origin at eye height, which is the motion this
  // whole capture path is for.
  const eyes: Vec3[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    eyes.push([Math.cos(a) * 2.5, 1.4 + Math.sin(a * 3) * 0.15, Math.sin(a) * 2.5]);
  }

  const frames: PosedFrame[] = eyes.map((eye, i) => ({
    index: i + 1,
    cameraToWorld: lookAtCameraToWorld(eye, [0, 0.4, 0]),
    intrinsics: k,
  }));

  const model = sparseModel(frames);
  for (const [name, text] of Object.entries(model)) {
    writeFileSync(path.join(out, "sparse", "0", name), text, "utf8");
  }

  // 1x1 white JPEG, base64. Small enough to inline, real enough to decode.
  const jpeg = Buffer.from(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
      "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
      "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
    "base64",
  );
  for (const f of frames) {
    writeFileSync(path.join(out, "images", frameFileName(f.index)), jpeg);
  }

  // The predictions pycolmap has to agree with. Chosen to span the image, not
  // to sit on the principal point where every convention agrees.
  const probes: Vec3[] = [
    [0, 0.4, 0],
    [0.5, 0.4, 0],
    [0, 0.9, 0],
    [-0.3, 0.1, 0.4],
  ];
  const expected = frames.map((f) => ({
    image: frameFileName(f.index),
    pixels: probes.map((p) => {
      const hit = projectThroughColmapPose(
        colmapPoseFromXrCameraToWorld(f.cameraToWorld),
        f.intrinsics,
        p,
      );
      return { world: p, uv: hit ? [hit.u, hit.v] : null, depth: hit?.depth ?? null };
    }),
  }));
  writeFileSync(
    path.join(out, "expected_projections.json"),
    // `eyes` is the input, not a prediction: pycolmap derives each camera centre
    // as -R^T t, entirely independently of us, so comparing against the WebXR
    // position we started from is a check on the INVERSION specifically. A pose
    // can put every point on the right pixel from the wrong place if the
    // rotation absorbs the error, and the projections alone would not notice.
    JSON.stringify({ probes, eyes, frames: expected }, null, 2),
    "utf8",
  );

  check(`wrote ${frames.length} posed frames`, true, out);
  console.log(
    `\n  Now get a second opinion from pycolmap, which did not write this file:\n` +
      `    .venv-splat/Scripts/python.exe tools/spark_studio/verify_webxr.py "${out}"\n`,
  );
  return out;
}

function main(): void {
  console.log("\nWebXR posed capture — the parts that do not need a phone\n");
  checkRigidity();
  checkQuaternions();
  checkIdentityCameraPose();
  checkIntrinsics();
  checkProjectionGeometry();
  checkRoundTrip();
  checkTextFormat();
  checkSupportPolicy();
  writeSyntheticDataset();

  console.log(
    failures === 0
      ? "\nThe conversion holds. The capture session itself is still unproven — " +
          "see the note at the top of lib/webxr/capture.ts.\n"
      : `\n${failures} check(s) failed.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
