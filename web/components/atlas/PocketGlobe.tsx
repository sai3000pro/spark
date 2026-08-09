"use client";

/**
 * The pocket globe — a brass-ringed terrestrial globe the size of a compass,
 * pinned in the map's corner. It idles at a slow turn with every walk's origin
 * dotted in clay; clicking it opens the full globe plate (GlobeOverlay).
 *
 * Deliberately mute: no labels, no interaction inside the canvas, one coarse
 * point cloud. It is a door, not a screen — the plate does the talking.
 */
import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import {
  BrassBezel,
  IdleSpin,
  PaperEarth,
  PaperSea,
  usePaperCloud,
  useReducedMotion,
  useWebGLSupport,
} from "@/components/atlas/paperGlobe";
import { geoToVec3 } from "@/lib/globe/geo";
import { BRASS, CLAY, PAPER } from "@/lib/theme";
import type { GeoPoint } from "@/lib/types";

/** ~20k sphere samples → ~6k land points: dense enough that the continents
    read as shapes even at 100 px. */
const POCKET_SAMPLES = 20_000;

interface Props {
  /** Every walk's origin — drawn as clay dots so the door hints at its room. */
  stops: GeoPoint[];
  onOpen: () => void;
}

export function PocketGlobe({ stops, onOpen }: Props) {
  const webgl = useWebGLSupport();
  const reducedMotion = useReducedMotion();
  const cloud = usePaperCloud(POCKET_SAMPLES);

  // The door is decoration until it opens — without WebGL there is no room
  // behind it, so it simply does not render.
  if (!webgl) return null;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open the globe — every walk on one sphere"
      className="group pointer-events-auto block"
    >
      <span
        // The bezel hugs the sphere: a hairline of ink, a thin band of brass,
        // nothing else — the camera sits close enough that the limb meets the
        // ring on every side, so no paper shows inside it.
        className="relative block h-[92px] w-[92px] overflow-hidden rounded-full transition-transform duration-300 group-hover:scale-[1.045]"
        style={{
          background: PAPER,
          boxShadow: `inset 0 0 0 1px rgb(27 27 24 / 0.22), 0 0 0 2px ${BRASS}, 0 0 0 2.75px rgb(27 27 24 / 0.2), 0 10px 26px rgb(27 27 24 / 0.28)`,
          transitionTimingFunction: "var(--ease-signature)",
        }}
      >
        <Canvas
          frameloop="demand"
          gl={{ antialias: true }}
          dpr={[1, 1.5]}
          camera={{ position: [0, 0.35, 2.7], fov: 38, near: 0.1, far: 20 }}
          style={{ pointerEvents: "none" }}
        >
          <color attach="background" args={[PAPER]} />
          <PaperSea />
          <PaperEarth cloud={cloud} sizeBoost={2.4} />
          <BrassBezel />
          <StopDots stops={stops} />
          <IdleSpin speed={0.14} paused={reducedMotion} />
        </Canvas>

        {/* The glass over the instrument: a soft paper sheen, so the inset
            canvas sits IN the bezel rather than on it. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(90% 90% at 32% 26%, rgb(255 251 240 / 0.5) 0%, rgb(255 251 240 / 0) 42%), radial-gradient(120% 120% at 50% 50%, rgb(27 27 24 / 0) 58%, rgb(27 27 24 / 0.16) 100%)",
          }}
        />
      </span>
    </button>
  );
}

/** Every walk, as a clay dot pressed on the little sphere. */
function StopDots({ stops }: { stops: GeoPoint[] }) {
  const geometry = useMemo(() => {
    const positions = new Float32Array(stops.length * 3);
    stops.forEach((stop, i) => {
      const [x, y, z] = geoToVec3(stop, 1.01);
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, [stops]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <points geometry={geometry} renderOrder={2}>
      <pointsMaterial color={CLAY} size={4.5} sizeAttenuation={false} />
    </points>
  );
}
