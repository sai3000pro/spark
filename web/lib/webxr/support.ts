/**
 * Can THIS phone record camera poses, and if not, why not — in words.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE STANDARD THIS FILE IS HELD TO
 *
 * `lib/reconstruction/targets.ts`: nothing is offered that is not reachable,
 * and where something is unavailable it still appears, with the real reason.
 * That matters more here than anywhere else in the capture flow, because the
 * population that cannot do this is not a rounding error — it is every iPhone
 * ever made. Apple does not implement WebXR in Safari, there is no flag, and
 * the third-party browsers on iOS are all WebKit underneath, so "try Chrome"
 * is advice that cannot work. A button that spins and fails would send a
 * meaningful fraction of users hunting through their own settings for a fault
 * that is not theirs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THREE QUESTIONS, ASKED SEPARATELY, BECAUSE THEY HAVE DIFFERENT ANSWERS
 *
 *   1. Is there a `navigator.xr` at all?          synchronous, free
 *   2. Does it support an `immersive-ar` session? async, one promise
 *   3. Will it grant the `camera-access` feature? CANNOT BE ASKED IN ADVANCE
 *
 * Question 3 is the honest problem. There is no `isFeatureSupported`. The only
 * way to find out is to call `requestSession` with `camera-access` in
 * `requiredFeatures`, which needs a user gesture and shows a permission prompt.
 * So this module reports (1) and (2) as facts and (3) as an unknown, and says
 * so — `cameraAccess: "unknown"` is a real state, not a loading state, and the
 * UI must not render it as "supported" while waiting for a truth that will only
 * arrive after someone taps.
 *
 * A device that answers yes to (1) and (2) and then refuses (3) is common:
 * ARCore is installed and the browser is current, but `camera-access` shipped
 * later than `immersive-ar` and is still absent on some builds.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ON USER-AGENT SNIFFING, WHICH lib/captureSupport.ts RIGHTLY FORBIDS
 *
 * The DECISION below is made entirely by the probe. The user agent is consulted
 * for exactly one thing: choosing which true sentence to show when the probe has
 * already said no. "This browser does not support WebXR" is correct on an
 * iPhone and useless — the reader will go looking for a setting. "Safari does
 * not implement WebXR, on any iPhone" is the same fact with the ending
 * attached. If the sniff is wrong, a person reads a slightly less apt sentence;
 * nothing behaves differently. That is the only place a UA string is allowed to
 * matter.
 */

export type CameraAccessState =
  /** A session has been opened and the feature was granted. */
  | "granted"
  /** Asked for, and refused — by the platform or by the person. */
  | "refused"
  /** Not askable without a user gesture. The state before anyone taps. */
  | "unknown";

export interface WebXrFacts {
  /** `typeof navigator.xr !== "undefined"`. */
  hasXr: boolean;
  /** `window.isSecureContext`. WebXR is secure-context only, no exceptions. */
  secureContext: boolean;
  /**
   * `navigator.xr.isSessionSupported("immersive-ar")`, or null when it could
   * not be asked (no `navigator.xr`) — which is NOT the same as false.
   */
  immersiveAr: boolean | null;
  /** Only ever used to pick wording. See the note above. */
  looksLikeIos: boolean;
}

export interface WebXrSupport extends WebXrFacts {
  /** May we offer the posed-capture button? */
  available: boolean;
  /** Why not, phrased for a person. Null when available. */
  blockedBecause: string | null;
  cameraAccess: CameraAccessState;
  /**
   * True when `available` is true but nobody has yet proven `camera-access`
   * works. The UI must say "we will know when you start" rather than promising.
   */
  cameraAccessUnproven: boolean;
}

/** The floor: what the server renders, and what a browser mid-probe shows. */
export const UNKNOWN_WEBXR_SUPPORT: WebXrSupport = Object.freeze({
  hasXr: false,
  secureContext: false,
  immersiveAr: null,
  looksLikeIos: false,
  available: false,
  blockedBecause: null,
  cameraAccess: "unknown",
  cameraAccessUnproven: false,
}) as WebXrSupport;

/**
 * The whole policy, as a pure function of facts. Tested in
 * web/scripts/verify-webxr.ts, which is the only reason it is separate from the
 * probe that gathers them.
 */
export function describeWebXrSupport(
  facts: WebXrFacts,
  cameraAccess: CameraAccessState = "unknown",
): WebXrSupport {
  const base = { ...facts, cameraAccess };

  if (!facts.secureContext) {
    return {
      ...base,
      available: false,
      cameraAccessUnproven: false,
      // Same rule, same wording register as lib/captureSupport.ts: this is a
      // property of the ORIGIN, not of the phone, and saying so stops anyone
      // blaming their hardware.
      blockedBecause:
        "Pose capture needs a secure (HTTPS) connection — that's a browser rule, " +
        "not a limit of your phone. Recording a video here still works.",
    };
  }

  if (!facts.hasXr) {
    return {
      ...base,
      available: false,
      cameraAccessUnproven: false,
      blockedBecause: facts.looksLikeIos
        ? // Every browser on iOS is Safari underneath, so this is not a
          // "try another browser" situation and must not read like one.
          "iPhones can't do this: Safari doesn't implement WebXR, and every " +
          "browser on iOS uses Safari's engine. Record a video instead — your " +
          "laptop will work out the camera positions."
        : "This browser doesn't support WebXR, so it can't report where the " +
          "camera is. Record a video instead — your laptop will work out the " +
          "camera positions.",
    };
  }

  if (facts.immersiveAr === false) {
    return {
      ...base,
      available: false,
      cameraAccessUnproven: false,
      // Naming the missing component, in the words the phone's own app store
      // uses, because unlike every other blocked reason here this is one the
      // reader can fix from where they are standing.
      blockedBecause:
        "This browser has WebXR but no AR session — on Android that usually " +
        "means Google Play Services for AR isn't installed. Record a video instead.",
    };
  }

  if (facts.immersiveAr === null) {
    return {
      ...base,
      available: false,
      cameraAccessUnproven: false,
      blockedBecause: "Still checking whether this phone can track its own position.",
    };
  }

  if (cameraAccess === "refused") {
    return {
      ...base,
      available: false,
      cameraAccessUnproven: false,
      blockedBecause:
        "This phone tracks its position but won't hand the camera image to the " +
        "page, so there'd be poses and no pictures. Record a video instead.",
    };
  }

  return {
    ...base,
    available: true,
    blockedBecause: null,
    cameraAccessUnproven: cameraAccess !== "granted",
  };
}

/**
 * Ask the platform. Client-only; returns the floor during SSR.
 *
 * Not cached, unlike `lib/captureSupport.ts`'s equivalent: `isSessionSupported`
 * can change WITHIN a page's lifetime, because installing Google Play Services
 * for AR does not require a reload of the browser. Caching it would pin a "no"
 * that stopped being true while someone was following our own advice about how
 * to fix it.
 */
export async function probeWebXr(): Promise<WebXrSupport> {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return UNKNOWN_WEBXR_SUPPORT;
  }

  const xr = (navigator as Navigator & { xr?: { isSessionSupported?(m: string): Promise<boolean> } })
    .xr;
  const facts: WebXrFacts = {
    hasXr: typeof xr !== "undefined" && xr !== null,
    secureContext: window.isSecureContext === true,
    immersiveAr: null,
    looksLikeIos: looksLikeIos(),
  };

  if (facts.hasXr && typeof xr?.isSessionSupported === "function") {
    try {
      facts.immersiveAr = await xr.isSessionSupported("immersive-ar");
    } catch {
      // A rejected promise is a real "no" here — the spec rejects rather than
      // resolving false for a mode the UA does not know at all.
      facts.immersiveAr = false;
    }
  } else if (facts.hasXr) {
    facts.immersiveAr = false;
  }

  return describeWebXrSupport(facts);
}

/** Wording only. See the note at the top of this file. */
function looksLikeIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent ?? "";
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS reports itself as a Mac; the touch points give it away. A desktop
  // Mac is not iOS and also has no WebXR, but it gets the generic sentence,
  // which is true there too.
  return (
    /Macintosh/i.test(ua) &&
    typeof navigator.maxTouchPoints === "number" &&
    navigator.maxTouchPoints > 1
  );
}
