"use client";

/**
 * The WebXR capture loop: frames and the poses that go with them.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * NOTHING IN THIS FILE HAS BEEN RUN ON A DEVICE.
 *
 * There is no Android phone on the machine this was written on, and WebXR
 * cannot be exercised anywhere else — there is no emulator in this repo, no
 * headless path, and `immersive-ar` refuses to start without real tracking.
 * So: the arithmetic this file DEPENDS on is proven — ./math.ts, ./intrinsics.ts
 * and ./colmap.ts are exercised by web/scripts/verify-webxr.ts, and
 * tools/spark_studio/verify_webxr.py then checks the result against pycolmap's
 * own reader, which is a second implementation of the same convention. The
 * session plumbing BELOW is written, reviewed against the specs, and unproven.
 *
 * Do not describe this path as working until someone has run the manual test in
 * docs/webxr_capture.md on an ARCore phone and a splat has come out the far end.
 * The house rule is that a false claim is worse than a missing feature, and this
 * is the file where it would be easiest to make one.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT IS FOR
 *
 * Skipping stage 2. ARCore already solves 6-DoF tracking on the phone, every
 * frame, for free; COLMAP spends 2.5 minutes re-deriving the same thing from
 * pixels and fails outright on a wall with no texture. Recording the pose the
 * phone already knows turns "solve, then train" into "train".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY FRAMES ARE SPACED BY MOVEMENT, NOT BY TIME
 *
 * `requestAnimationFrame` fires at 60 Hz. A person walking round a statue for
 * ninety seconds would produce 5 400 frames, of which perhaps 200 see anything
 * the others do not. Every duplicate costs a JPEG encode on a phone, a megabyte
 * on the wire, and training time — and buys nothing, because a splat is
 * constrained by the VARIETY of viewpoints, not their number.
 *
 * So a frame is kept when the camera has moved far enough OR turned far enough
 * since the last keeper. That is also what makes a stationary phone stop
 * producing data rather than filling the dataset with one viewpoint, which is
 * the input COLMAP fails on and which would produce an equally degenerate splat
 * here even though no solve is involved.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE PIXELS ARE READ SYNCHRONOUSLY, INSIDE THE FRAME CALLBACK
 *
 * `getCameraImage` returns a texture whose backing image the spec permits the
 * UA to recycle the moment the callback returns. Deferring the read — even by a
 * microtask — is reading whatever the compositor put there next. So the read is
 * a blocking `readPixels` into a reused buffer, and only the JPEG encode (which
 * does not touch the texture) is allowed to be async.
 */

import { cameraPositionFromXr, isRigid, type Mat4, type Vec3 } from "./math";
// The wire record and its intrinsics derivation live in ./record.ts rather than
// here, because this module is "use client" and Next turns every export of a
// "use client" module into a client reference the server may not call. See the
// header of ./record.ts for the error that taught us so.
import type { CapturedFrameRecord } from "./record";

export interface CapturedFrame {
  record: CapturedFrameRecord;
  jpeg: Blob;
}

export interface CaptureOptions {
  /**
   * Metres of translation since the last kept frame that make a new one worth
   * having. 4 cm is roughly a phone-width of baseline — enough parallax to be
   * a different view of anything closer than a few metres.
   */
  minTranslationMetres?: number;
  /** Radians of rotation that make a new frame worth having. ~4 degrees. */
  minRotationRadians?: number;
  /**
   * Longest edge of the stored image. Brush's presets top out at 1600 px
   * (`tools/spark_studio/train.py`), so anything larger is decoded and thrown
   * away — while costing a phone a full-resolution JPEG encode per frame.
   */
  maxDimension?: number;
  /** JPEG quality. 0.85 is where phone captures stop looking compressed. */
  quality?: number;
  /**
   * Hard ceiling. A capture that runs away is a browser tab that gets killed
   * for memory with everything in it, so it stops rather than degrades.
   */
  maxFrames?: number;
  /** Called after every kept frame, for the progress readout. */
  onFrame?: (frame: CapturedFrame, total: number) => void;
  /** Called when the session ends for any reason, including the headset button. */
  onEnd?: (reason: string) => void;
}

const DEFAULTS = {
  minTranslationMetres: 0.04,
  minRotationRadians: 0.07,
  maxDimension: 1280,
  quality: 0.85,
  maxFrames: 400,
} as const;

export class WebXrCaptureError extends Error {
  /** True when the failure is the platform's, not the person's. */
  readonly platform: boolean;
  constructor(message: string, platform = true) {
    super(message);
    this.platform = platform;
  }
}

/**
 * One capture. Construct, `start()` from a user gesture, `stop()` when done,
 * then read `frames`.
 *
 * `start()` MUST be called synchronously from a click or tap handler:
 * `requestSession` requires transient user activation and there is no way to
 * ask for it later.
 */
export class WebXrCapture {
  readonly frames: CapturedFrame[] = [];
  private session: XRSession | null = null;
  private refSpace: XRReferenceSpace | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private binding: XRWebGLBinding | null = null;
  private readFbo: WebGLFramebuffer | null = null;
  private pixels: Uint8Array | null = null;
  private lastPosition: Vec3 | null = null;
  private lastRotation: number[] | null = null;
  private nextIndex = 1;
  private pending = 0;
  private readonly opts: Required<Omit<CaptureOptions, "onFrame" | "onEnd">> &
    Pick<CaptureOptions, "onFrame" | "onEnd">;

  constructor(options: CaptureOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
  }

  get active(): boolean {
    return this.session !== null;
  }

  async start(): Promise<void> {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) {
      throw new WebXrCaptureError("This browser has no WebXR at all.");
    }

    // `camera-access` is REQUIRED, not optional, and that is the point. A
    // session granted without it tracks perfectly and hands back no pixels —
    // poses for photographs that do not exist. Failing at requestSession is a
    // clear error before anyone has filmed; discovering it on frame one is a
    // capture someone has already walked around a statue for.
    let session: XRSession;
    try {
      session = await xr.requestSession("immersive-ar", {
        requiredFeatures: ["camera-access"],
        // Not required: on a phone that cannot place the floor, a `local` space
        // still gives correct RELATIVE poses, and relative is all COLMAP needs
        // — the world origin is arbitrary. Demanding `local-floor` would refuse
        // sessions that would have reconstructed fine.
        optionalFeatures: ["local-floor", "unbounded", "dom-overlay"],
      });
    } catch (err) {
      throw new WebXrCaptureError(
        "This phone would not start an AR session with camera access. " +
          `The browser said: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // A WebGL2 context is not optional scaffolding: `XRWebGLBinding` is the only
    // route to the camera texture, and it needs a context that was created
    // xrCompatible. The canvas is never displayed — the compositor draws the
    // passthrough itself — so it stays 1x1 and off the document.
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const gl = canvas.getContext("webgl2", { xrCompatible: true, antialias: false });
    if (!gl) {
      await session.end().catch(() => {});
      throw new WebXrCaptureError("This browser could not make an XR-compatible WebGL2 context.");
    }

    await gl.makeXRCompatible();
    session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });

    // Preference order matters only for how stable the world origin is across a
    // long walk; `unbounded` drifts least, `local` is guaranteed to exist.
    let refSpace: XRReferenceSpace | null = null;
    for (const type of ["unbounded", "local-floor", "local"] as XRReferenceSpaceType[]) {
      try {
        refSpace = await session.requestReferenceSpace(type);
        break;
      } catch {
        // Not supported on this device. Try the next, weaker guarantee.
      }
    }
    if (!refSpace) {
      await session.end().catch(() => {});
      throw new WebXrCaptureError("This phone offered no usable reference space to track against.");
    }

    this.session = session;
    this.gl = gl;
    this.refSpace = refSpace;
    this.binding = new XRWebGLBinding(session, gl);
    this.readFbo = gl.createFramebuffer();

    session.addEventListener("end", () => {
      this.session = null;
      this.opts.onEnd?.("session ended");
    });

    session.requestAnimationFrame(this.onXrFrame);
  }

  /** Ends the session. Safe to call twice, and safe to call from a UI handler. */
  async stop(): Promise<void> {
    const session = this.session;
    this.session = null;
    if (session) await session.end().catch(() => {});
    // Outstanding JPEG encodes still resolve into `frames`; awaiting them here
    // is what makes `frames` complete by the time stop() returns.
    while (this.pending > 0) await new Promise((r) => setTimeout(r, 16));
  }

  private onXrFrame = (time: number, frame: XRFrame): void => {
    const session = this.session;
    if (!session) return;
    session.requestAnimationFrame(this.onXrFrame);

    if (this.frames.length + this.pending >= this.opts.maxFrames) return;

    const refSpace = this.refSpace;
    const binding = this.binding;
    const gl = this.gl;
    if (!refSpace || !binding || !gl) return;

    const viewerPose = frame.getViewerPose(refSpace);
    // A null pose is NORMAL and frequent — it means tracking is momentarily
    // lost (a blank wall, a fast turn). Dropping the frame is correct; the
    // alternative is a pose that is not where the camera was.
    if (!viewerPose) return;

    // Phones have exactly one view. A headset has two, and taking both would
    // write two images with two poses for one instant, which is legitimate
    // COLMAP input — but the second eye's camera image is usually absent, so
    // the first view with a camera behind it is the honest choice.
    const view = viewerPose.views.find((v) => v.camera);
    if (!view || !view.camera) return;

    if (!this.worthKeeping(view.transform.matrix)) return;

    const camera = view.camera;
    const texture = binding.getCameraImage(camera);
    if (!texture) return;

    const w = camera.width;
    const h = camera.height;
    const need = w * h * 4;
    if (!this.pixels || this.pixels.length < need) this.pixels = new Uint8Array(need);
    const pixels = this.pixels;

    const previousFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.readFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    if (complete) {
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, previousFbo);
    if (!complete) return;

    // Everything the texture owns has been copied out. From here it is CPU work
    // and may safely outlive the callback.
    const index = this.nextIndex++;
    this.markKept(view.transform.matrix);
    this.pending++;
    void this.encode(pixels.subarray(0, need), w, h, view, camera, index, time)
      .then((captured) => {
        if (captured) {
          this.frames.push(captured);
          this.opts.onFrame?.(captured, this.frames.length);
        }
      })
      .finally(() => {
        this.pending--;
      });
  };

  /**
   * Has the camera moved or turned enough since the last kept frame?
   *
   * Rotation is measured as the angle between the two view directions rather
   * than a quaternion distance, because a phone held still while its user
   * shuffles is dominated by tiny roll about the optical axis — which changes
   * the quaternion and shows the scene nothing new.
   */
  private worthKeeping(m: Mat4): boolean {
    if (!isRigid(m)) return false;
    if (!this.lastPosition || !this.lastRotation) return true;

    const p = cameraPositionFromXr(m);
    const moved = Math.hypot(
      p[0] - this.lastPosition[0],
      p[1] - this.lastPosition[1],
      p[2] - this.lastPosition[2],
    );
    if (moved >= this.opts.minTranslationMetres) return true;

    // Column 2 is the camera's +Z axis; it looks down -Z, so this is the
    // forward direction negated — which is fine, the angle between two of them
    // is the angle between the two view directions either way.
    const fwd = [m[8], m[9], m[10]];
    const dot =
      fwd[0] * this.lastRotation[0] + fwd[1] * this.lastRotation[1] + fwd[2] * this.lastRotation[2];
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    return angle >= this.opts.minRotationRadians;
  }

  private markKept(m: Mat4): void {
    this.lastPosition = cameraPositionFromXr(m);
    this.lastRotation = [m[8], m[9], m[10]];
  }

  private async encode(
    rgba: Uint8Array,
    width: number,
    height: number,
    view: XRView,
    camera: XRCamera,
    index: number,
    timeMs: number,
  ): Promise<CapturedFrame | null> {
    // readPixels hands back rows bottom-to-top (GL's origin is bottom-left).
    // Every image format, and every intrinsics convention including the one in
    // ./intrinsics.ts, measures v downward from the top. Flipping here is what
    // makes cy mean what cameras.txt says it means.
    const flipped = new Uint8ClampedArray(rgba.length);
    const stride = width * 4;
    for (let y = 0; y < height; y++) {
      const src = (height - 1 - y) * stride;
      flipped.set(rgba.subarray(src, src + stride), y * stride);
    }

    const source = new OffscreenCanvas(width, height);
    const sctx = source.getContext("2d");
    if (!sctx) return null;
    sctx.putImageData(new ImageData(flipped, width, height), 0, 0);

    const scale = Math.min(1, this.opts.maxDimension / Math.max(width, height));
    const outW = Math.max(1, Math.round(width * scale));
    const outH = Math.max(1, Math.round(height * scale));

    let blob: Blob;
    if (scale === 1) {
      blob = await source.convertToBlob({ type: "image/jpeg", quality: this.opts.quality });
    } else {
      const target = new OffscreenCanvas(outW, outH);
      const tctx = target.getContext("2d");
      if (!tctx) return null;
      tctx.drawImage(source, 0, 0, outW, outH);
      blob = await target.convertToBlob({ type: "image/jpeg", quality: this.opts.quality });
    }

    return {
      jpeg: blob,
      record: {
        index,
        // Copied out of the Float32Array: these are live views onto XR-owned
        // memory that the UA is free to reuse after the callback.
        cameraToWorld: Array.from(view.transform.matrix),
        projection: Array.from(view.projectionMatrix),
        cameraWidth: camera.width,
        cameraHeight: camera.height,
        imageWidth: outW,
        imageHeight: outH,
        timestampMs: timeMs,
      },
    };
  }
}
