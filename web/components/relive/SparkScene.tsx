"use client";

/**
 * The real capture, rendered by Spark 2.1 — inside the app's own R3F canvas.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A CHILD AND GS3DStage IS A SUBTREE
 *
 * Spark runs on the bundled three (0.185, peer range >=0.180), which is the
 * same three React Three Fiber is driving. So it can simply be added to the
 * scene that already exists — and that means the object markers, the orbit
 * controls, the hover labels and the camera flight are the SAME code that the
 * synthetic preview uses, not a second implementation of them.
 *
 * mkkellogg cannot do that. It needs three 0.160.1 from a CDN, a second and
 * mutually unrecognisable copy of every class, and therefore its own canvas and
 * its own rebuilt copy of all of the above (components/relive/GS3DStage.tsx).
 * That difference is the entire reason this file is 90 lines and that one is
 * 330 — worth knowing before anyone decides they look duplicated.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ORIENTATION
 *
 * `quaternion.set(1, 0, 0, 0)` is a 180° turn about X, and it is not a fudge:
 * splat files are written Y-down (the convention the original INRIA code and
 * every trainer downstream of it inherited) while three is Y-up. Spark hands
 * over the file's own frame and expects the caller to say which way up it goes;
 * mkkellogg applies the same flip internally, which is why its stage does not
 * appear to need one. `view.sceneRotationDeg` composes ON TOP of this.
 */
import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { SplatView } from "@/lib/types";

interface Props {
  url: string;
  view?: SplatView;
  /** Download percentage, for the stage's chip. Spark draws no UI of its own. */
  onProgress: (percent: number) => void;
  /** The splats are in and drawing. */
  onReady: () => void;
  /** Anything went wrong — the caller falls back to the synthetic cloud. */
  onFail: () => void;
}

export function SparkScene({ url, view, onProgress, onReady, onFail }: Props) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    let cancelled = false;
    // Held outside the async body so the cleanup can reach them whether it runs
    // before or after the load resolves.
    let spark: import("@sparkjsdev/spark").SparkRenderer | null = null;
    let mesh: import("@sparkjsdev/spark").SplatMesh | null = null;

    (async () => {
      try {
        // Dynamic, because Spark reaches for WebGL and a WASM sort at module
        // scope and this component renders on a page that server-renders.
        const { SparkRenderer, SplatMesh } = await import("@sparkjsdev/spark");
        if (cancelled) return;

        spark = new SparkRenderer({ renderer: gl });
        scene.add(spark);

        mesh = new SplatMesh({
          url,
          onProgress: (e: ProgressEvent) => {
            if (cancelled) return;
            // Not every server sends a length. Reporting a made-up percentage is
            // worse than reporting none — the chip says "loading" either way.
            if (e.lengthComputable && e.total > 0) {
              onProgress(Math.min(100, (e.loaded / e.total) * 100));
            }
          },
        });

        // File frame → three frame, then this capture's own framing on top.
        mesh.quaternion.set(1, 0, 0, 0);
        if (view?.sceneRotationDeg) {
          const [rx, ry, rz] = view.sceneRotationDeg;
          mesh.quaternion.multiply(
            new THREE.Quaternion().setFromEuler(
              new THREE.Euler((rx * Math.PI) / 180, (ry * Math.PI) / 180, (rz * Math.PI) / 180),
            ),
          );
        }
        if (view?.scenePosition) mesh.position.set(...view.scenePosition);
        if (view?.sceneScale) mesh.scale.setScalar(view.sceneScale);

        scene.add(mesh);

        // Resolves when the file is parsed and the splats are uploaded — the
        // download hitting 100% is not this, same distinction the other stage
        // draws.
        await mesh.initialized;
        if (cancelled) return;
        onProgress(100);
        onReady();
      } catch (err) {
        console.warn("[splat] spark failed to load, falling back:", err);
        if (!cancelled) onFail();
      }
    })();

    return () => {
      cancelled = true;
      if (mesh) {
        scene.remove(mesh);
        mesh.dispose();
      }
      if (spark) {
        scene.remove(spark);
        spark.dispose();
      }
    };
    // The handlers are stable callbacks from the caller; re-running this effect
    // would re-download the capture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, view, gl, scene]);

  return null;
}
