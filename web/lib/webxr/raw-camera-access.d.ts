/**
 * The `camera-access` half of WebXR, which @types/webxr does not declare.
 *
 * @types/webxr 0.5.24 ships `XRView` and `XRWebGLBinding` but neither
 * `XRView.camera` nor `XRWebGLBinding.getCameraImage` — the raw camera access
 * module is a separate draft (immersive-web/raw-camera-access) and the types
 * package tracks the core spec only.
 *
 * Declared here rather than cast away at the call site on purpose. A `as any`
 * at the one place we read the camera image would hide the fact that this is a
 * DRAFT API whose shape can change; a declaration file names exactly what we are
 * assuming, in one place, where the next person can compare it against the spec
 * and delete it the day @types/webxr grows its own.
 *
 * Deliberately narrower than the draft: only the members the capture path
 * actually touches. Declaring more would be inventing agreement we have not
 * checked.
 */

interface XRCamera {
  /** Width of the camera image in pixels — NOT the framebuffer's width. */
  readonly width: number;
  readonly height: number;
}

interface XRView {
  /**
   * Present only when the session was granted `camera-access`, and only on the
   * views that actually have a camera behind them. Optional in the type because
   * it is optional in reality.
   */
  readonly camera?: XRCamera;
}

interface XRWebGLBinding {
  /**
   * A texture holding this frame's camera image. Valid ONLY for the duration of
   * the requestAnimationFrame callback it was obtained in — the spec explicitly
   * says the underlying image may be recycled after that, so anything that
   * needs the pixels must read them before returning.
   */
  getCameraImage(camera: XRCamera): WebGLTexture | null;
}
