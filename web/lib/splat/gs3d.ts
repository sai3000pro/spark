/**
 * Loads the Gaussian splat renderer — @mkkellogg/gaussian-splats-3d 0.4.7 —
 * from a CDN at runtime, pinned to three 0.160.1.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THING TO KNOW BEFORE TOUCHING ANY OF THIS
 *
 * This module pulls in a SECOND, ISOLATED three.js. The app bundles three 0.185
 * for React Three Fiber (the synthetic cloud, the globe); the URLs below resolve
 * three 0.160.1 inside esm.sh's own module graph. They are two different
 * realities: a Vector3 / Mesh / Scene from one is NOT an instance of the other's
 * classes, and mixing them fails in ways that look like "sometimes it renders".
 *
 * So: everything built for the splat stage — anchors, raycaster, vectors — must
 * be constructed from the `THREE` this module returns, never from the bundled
 * `three` import. That isolation is also why components/relive/GS3DStage.tsx
 * drives a standalone `Viewer` with its own canvas rather than mkkellogg's
 * `DropInViewer`, which would have to share a scene with R3F.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * esm.sh rewrites the library's bare `three` specifier to the pinned version, so
 * no <script type="importmap"> is needed — the one URL brings both halves. Its
 * response body is literally an import of three@0.160.1 followed by a re-export
 * of the library built against it.
 *
 * Swapping to a self-hosted copy = change the two URLs and nothing else.
 */

/**
 * Type-only. The bundler erases this entirely, so it does NOT pull the bundled
 * three into anything — it just spares us hand-writing Vector3/Scene/Raycaster.
 * The parts of the API this file touches are unchanged between 0.160 and 0.185;
 * the RUNTIME objects always come from the CDN instance described above.
 */
import type * as ThreeTypes from "three";

const THREE_VERSION = "0.160.1";
const GS3D_VERSION = "0.4.7";

const GS3D_URL = `https://esm.sh/@mkkellogg/gaussian-splats-3d@${GS3D_VERSION}?deps=three@${THREE_VERSION}`;
const THREE_URL = `https://esm.sh/three@${THREE_VERSION}`;

export type ThreeModule = typeof ThreeTypes;

// ─────────────────────────────────────────────────────────────────────────────
// The library's surface.
//
// The package ships no .d.ts and we are deliberately not installing it, so this
// covers exactly what GS3DStage uses. Anything missing here is genuinely unused
// rather than merely untyped — extend this instead of casting at a call site.
// Every option name below was checked against the 0.4.7 bundle.
// ─────────────────────────────────────────────────────────────────────────────

export interface SplatSceneOptions {
  /** Streams the file in, so first paint doesn't wait for the whole download. */
  progressiveLoad?: boolean;
  /** 0–255. Drops near-invisible splats — real memory savings on a big capture. */
  splatAlphaRemovalThreshold?: number;
  position?: [number, number, number];
  /** Quaternion [x, y, z, w] — NOT euler angles. */
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  showLoadingUI?: boolean;
  onProgress?: (percent: number, message: string, stage: number) => void;
}

export interface ViewerOptions {
  rootElement: HTMLElement;
  /** Our own scene of extra objects (the anchors), rendered with the splats. */
  threeScene?: ThreeTypes.Scene;
  selfDrivenMode?: boolean;
  useBuiltInControls?: boolean;
  /**
   * Defaults to TRUE in 0.4.7, and that path needs COOP/COEP cross-origin
   * isolation. This app sets no such headers — leave it false, or the Viewer
   * throws on construct with a SharedArrayBuffer error.
   */
  sharedMemoryForWorkers?: boolean;
  gpuAcceleratedSort?: boolean;
  dynamicScene?: boolean;
  showLoadingUI?: boolean;
  ignoreDevicePixelRatio?: boolean;
  cameraUp?: [number, number, number];
  initialCameraPosition?: [number, number, number];
  initialCameraLookAt?: [number, number, number];
}

/** The built-in OrbitControls, as much of it as the camera rig needs. */
export interface GS3DControls {
  target: ThreeTypes.Vector3;
  enabled: boolean;
  update(): void;
}

export interface GS3DViewer {
  camera: ThreeTypes.PerspectiveCamera;
  controls: GS3DControls;
  renderer: ThreeTypes.WebGLRenderer;
  addSplatScene(url: string, options?: SplatSceneOptions): Promise<void>;
  start(): void;
  stop(): void;
  dispose(): Promise<void>;
}

export interface ViewerConstructor {
  new (options: ViewerOptions): GS3DViewer;
}

export interface GS3D {
  Viewer: ViewerConstructor;
  THREE: ThreeModule;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bundler-opaque dynamic import.
 *
 * Both webpack and Turbopack try to resolve a literal `import()` specifier at
 * build time, and these are CDN URLs that have to stay runtime fetches. The
 * magic comments are the supported opt-out in each.
 */
const importFromCDN = (url: string): Promise<Record<string, unknown>> =>
  import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url);

/** One fetch per session, shared by every viewer instance. */
let pending: Promise<GS3D> | null = null;

export function loadGS3D(): Promise<GS3D> {
  pending ??= (async () => {
    const [gs, three] = await Promise.all([importFromCDN(GS3D_URL), importFromCDN(THREE_URL)]);
    const Viewer = gs.Viewer as ViewerConstructor | undefined;
    if (!Viewer) {
      throw new Error(`gaussian-splats-3d ${GS3D_VERSION} loaded without a Viewer export`);
    }
    return { Viewer, THREE: three as unknown as ThreeModule };
  })().catch((err) => {
    // Never cache a failure — a flaky CDN shouldn't poison the whole session.
    pending = null;
    throw err;
  });
  return pending;
}

/** Shown in the stage's provenance chip, so the renderer in use is never a guess. */
export const GS3D_SOURCE = {
  library: `@mkkellogg/gaussian-splats-3d@${GS3D_VERSION}`,
  three: `three@${THREE_VERSION}`,
  url: GS3D_URL,
} as const;
