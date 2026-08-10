/**
 * What THIS browser can actually do — asked at runtime, never inferred.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOT USER-AGENT SNIFFING
 *
 * "Which phones support in-page recording" has no stable answer by make or
 * model. Safari gained MediaRecorder in 14.3 and it works on hardware going back
 * years; a brand-new Android phone behind a corporate policy that blocks camera
 * permission fails where a 2019 handset succeeds; Firefox, Samsung Internet,
 * Brave and every WebView-based in-app browser each differ. A UA table encodes a
 * snapshot of that mess and is wrong the day after it is written.
 *
 * So every check below is a direct question to the platform: is there a secure
 * context, does mediaDevices exist, does MediaRecorder exist, does it support a
 * container we can actually produce. Each is cheap, synchronous, and true.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE THING THAT GATES EVERYTHING
 *
 * `getUserMedia` is only exposed in a secure context. Every browser, no
 * exceptions, no user-facing flag. So a page served over plain HTTP on a LAN
 * cannot record in-page on ANY phone of ANY make — this is not a device
 * limitation to work around but a property of the origin, and the fix is
 * serving over HTTPS (a tunnel in development, the deployment in production).
 *
 * `<input capture>` is not gated that way, which is why it is the floor of the
 * ladder: it works on every phone, over any origin, and hands off to the OS
 * camera app — which takes a better video than a browser would anyway.
 */

export type CaptureMode =
  /** Live preview, coverage ring, motion warnings. Needs HTTPS + MediaRecorder. */
  | "guided"
  /** The OS camera app via a file input. Works everywhere. */
  | "camera-app";

export interface CaptureSupport {
  /** Every mode this browser can actually do, best first. Never empty. */
  available: CaptureMode[];
  best: CaptureMode;
  secureContext: boolean;
  hasMediaDevices: boolean;
  hasMediaRecorder: boolean;
  /** The container we would record into, or null if none is supported. */
  mimeType: string | null;
  /** Why `guided` is unavailable, phrased for a person. Null when it is. */
  guidedBlockedBecause: string | null;
}

/**
 * Ordered by preference. mp4 first because iOS produces it natively and because
 * it is the container the reconstruction path is happiest with; webm variants
 * cover Android and desktop Firefox.
 */
const CANDIDATE_TYPES = [
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
] as const;

/**
 * What the server renders, and therefore what the first client render must
 * agree with or React will complain about a hydration mismatch: the floor.
 *
 * A frozen module constant rather than a fresh object, because
 * `useSyncExternalStore` compares snapshots by identity and a new object each
 * call is an infinite render loop.
 */
export const SERVER_CAPTURE_SUPPORT: CaptureSupport = Object.freeze({
  available: ["camera-app"],
  best: "camera-app",
  secureContext: false,
  hasMediaDevices: false,
  hasMediaRecorder: false,
  mimeType: null,
  guidedBlockedBecause: null,
}) as CaptureSupport;

/**
 * Detection is idempotent for the lifetime of the page — a browser does not
 * grow a MediaRecorder mid-session — so the result is computed once and handed
 * back by identity. Required by `useSyncExternalStore`, and a small win anyway.
 */
let cached: CaptureSupport | null = null;

export function getCaptureSupport(): CaptureSupport {
  return (cached ??= detectCaptureSupport());
}

/** Capabilities never change after load, so there is nothing to subscribe to. */
export function subscribeCaptureSupport(): () => void {
  return () => {};
}

export function detectCaptureSupport(): CaptureSupport {
  // SSR, or a very old browser. The floor is always reachable.
  if (typeof window === "undefined") return SERVER_CAPTURE_SUPPORT;

  // `isSecureContext` is the browser's own answer and already accounts for the
  // localhost exemption, so it beats parsing location.protocol ourselves.
  const secureContext = window.isSecureContext === true;
  const hasMediaDevices =
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function";
  const hasMediaRecorder = typeof window.MediaRecorder === "function";

  const mimeType = hasMediaRecorder
    ? (CANDIDATE_TYPES.find((t) => {
        try {
          return MediaRecorder.isTypeSupported(t);
        } catch {
          return false;
        }
      }) ?? null)
    : null;

  // A MediaRecorder that supports no container we can name is not usable, but it
  // is worth trying the constructor's default before giving up — some builds
  // report false for everything and still record.
  const canRecord = hasMediaRecorder && (mimeType !== null || hasMediaDevices);

  const guidedBlockedBecause = !secureContext
    ? "In-page recording needs a secure (HTTPS) connection — that's a browser rule, not a limit of your phone. Your camera app works fine here."
    : !hasMediaDevices
      ? "This browser doesn't expose camera access to web pages. Your camera app works fine here."
      : !canRecord
        ? "This browser can show the camera but can't record from a web page. Your camera app works fine here."
        : null;

  const available: CaptureMode[] =
    guidedBlockedBecause === null ? ["guided", "camera-app"] : ["camera-app"];

  return {
    available,
    best: available[0],
    secureContext,
    hasMediaDevices,
    hasMediaRecorder,
    mimeType,
    guidedBlockedBecause,
  };
}

/**
 * A one-line reason the guided mode is missing, for a laptop that wants to warn
 * BEFORE the user walks away with their phone. The server can only reason about
 * the origin, which is the dominant cause — so this is the honest subset.
 */
export function guidedLikelyAvailable(originIsHttps: boolean): boolean {
  return originIsHttps;
}
