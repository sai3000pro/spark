"use client";

/**
 * The desk globe's shared 3D vocabulary — used by both the pocket globe in the
 * map's corner and the full globe plate.
 *
 * A re-inking of the retired dark globe (components/globe/GlobeStage.tsx) for
 * the journal: the ocean is the page (a MILK occluder sphere with a soft ink
 * fresnel so the limb reads round on cream), the land is an engraver's stipple
 * in PINE, the instrument marks are brass. Same custom `<points>` machinery and
 * gaussian falloff as the splat stage — the globe is still made of points,
 * because Spark perceives the world as points.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import * as THREE from "three";
import { geoToVec3 } from "@/lib/globe/geo";
import { buildPaperCloud, voyageArcPoints, type PaperCloud } from "@/lib/globe/paperCloud";
import { BRASS_DEEP, INK, MILK } from "@/lib/theme";
import type { GeoPoint } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Land
// ─────────────────────────────────────────────────────────────────────────────

const LAND_VERT = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aShore;
  uniform float uScale;
  varying vec3 vColor;
  varying float vShore;

  void main() {
    vColor = aColor;
    vShore = aShore;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = max(1.0, aSize * uScale / max(0.001, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

/* Flat pressed ink — no lighting. A printed plate has one light: the reader's. */
const LAND_FRAG = /* glsl */ `
  precision mediump float;
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vShore;

  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r2 = dot(d, d);
    if (r2 > 0.25) discard;
    // The splat stage's gaussian falloff — the shared shape of the app's 3D.
    float a = exp(-r2 * 11.0);
    // Interiors sit back like a light stipple; coastlines press hard.
    float press = mix(0.52, 1.0, vShore);
    gl_FragColor = vec4(vColor, a * uOpacity * press);
  }
`;

export function PaperEarth({
  cloud,
  opacity = 0.95,
  sizeBoost = 1,
}: {
  cloud: PaperCloud;
  opacity?: number;
  /**
   * Point sizes are world-space and projected, so on a 92 px pocket canvas the
   * stipple lands sub-pixel and the continents vanish. The pocket passes ~3 to
   * print the same plate at a readable weight.
   */
  sizeBoost?: number;
}) {
  const { size, camera } = useThree();

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(cloud.positions, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(cloud.colors, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(cloud.sizes, 1));
    g.setAttribute("aShore", new THREE.BufferAttribute(cloud.shore, 1));
    g.computeBoundingSphere();
    return g;
  }, [cloud]);

  // Initial values only — both are kept current through the uniforms-* props.
  const uniforms = useMemo(
    () => ({ uScale: { value: 800 }, uOpacity: { value: 0.95 } }),
    [],
  );

  const fov = (camera as THREE.PerspectiveCamera).fov ?? 38;
  const pointScale = (size.height / (2 * Math.tan((fov * Math.PI) / 360))) * sizeBoost;

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <points geometry={geometry} frustumCulled={false} renderOrder={1}>
      <shaderMaterial
        vertexShader={LAND_VERT}
        fragmentShader={LAND_FRAG}
        uniforms={uniforms}
        uniforms-uScale-value={pointScale}
        uniforms-uOpacity-value={opacity}
        transparent
        depthWrite={false}
      />
    </points>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The page's ocean: an occluder sphere plus an ink rim
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The occluder does two jobs at once: its opacity hides the far hemisphere
 * (depth-testing away every far-side point and mark for free), and its fresnel
 * term shades the limb in ink so the sphere reads round on cream — the
 * engraver's trick of darkening a plate's edges instead of lighting them.
 */
export function PaperSea() {
  const uniforms = useMemo(
    () => ({
      uSea: { value: new THREE.Color(MILK) },
      uInk: { value: new THREE.Color(INK) },
    }),
    [],
  );

  return (
    <mesh renderOrder={0}>
      <sphereGeometry args={[0.995, 64, 48]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={/* glsl */ `
          varying vec3 vNormal;
          varying vec3 vView;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vView = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }
        `}
        fragmentShader={/* glsl */ `
          precision mediump float;
          uniform vec3 uSea;
          uniform vec3 uInk;
          varying vec3 vNormal;
          varying vec3 vView;
          void main() {
            float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.2);
            gl_FragColor = vec4(mix(uSea, uInk, rim * 0.45), 1.0);
          }
        `}
      />
    </mesh>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Instrument bezel: an equator and 24 ticks, in brass
// ─────────────────────────────────────────────────────────────────────────────

export function BrassBezel() {
  const ticks = useMemo(() => {
    const positions = new Float32Array(24 * 3);
    for (let i = 0; i < 24; i++) {
      const [x, y, z] = geoToVec3({ lat: 0, lng: i * 15 }, 1.006);
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, []);

  useEffect(() => () => ticks.dispose(), [ticks]);

  return (
    <group renderOrder={1}>
      {/* A torus, NOT a line: THREE.Line's `linewidth` is silently ignored on
          every platform, so a <line> would render as a 1px hairline forever. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.002, 0.0016, 3, 220]} />
        <meshBasicMaterial color={BRASS_DEEP} transparent opacity={0.5} />
      </mesh>

      {/* One draw call for all 24 ticks rather than 24 meshes. */}
      <points geometry={ticks}>
        <pointsMaterial color={BRASS_DEEP} size={2.25} sizeAttenuation={false} transparent opacity={0.6} />
      </points>
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The expedition line: dotted brass arcs linking the walks in order
// ─────────────────────────────────────────────────────────────────────────────

export function VoyageLine({ stops }: { stops: GeoPoint[] }) {
  const geometry = useMemo(() => {
    const legs = [];
    let total = 0;
    for (let i = 0; i + 1 < stops.length; i++) {
      const pts = voyageArcPoints(stops[i], stops[i + 1]);
      legs.push(pts);
      total += pts.length;
    }
    const all = new Float32Array(total);
    let at = 0;
    for (const leg of legs) {
      all.set(leg, at);
      at += leg.length;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(all, 3));
    return g;
  }, [stops]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  if (stops.length < 2) return null;

  return (
    <points geometry={geometry} renderOrder={1}>
      {/* The arc sampler spaces dots ~1.2° apart, so a plain point cloud IS the
          dotted line — the same dotted-pen stroke the map draws routes with. */}
      <pointsMaterial color={BRASS_DEEP} size={2.4} sizeAttenuation={false} transparent opacity={0.5} />
    </points>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hooks shared by the pocket and the plate
// ─────────────────────────────────────────────────────────────────────────────

/** One cloud per fidelity per process — both canvases want identical results. */
const cloudMemo = new Map<number, PaperCloud>();

export function usePaperCloud(samples: number): PaperCloud {
  return useMemo(() => {
    let cloud = cloudMemo.get(samples);
    if (!cloud) {
      cloud = buildPaperCloud({ samples });
      cloudMemo.set(samples, cloud);
    }
    return cloud;
  }, [samples]);
}

/**
 * globals.css neutralises CSS animation under prefers-reduced-motion, but WebGL
 * is invisible to CSS — the preference has to be read explicitly.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/** Ask before rendering, never fail — the splat stage's probe idiom. */
export function useWebGLSupport(): boolean {
  const [supported] = useState(() => {
    if (typeof document === "undefined") return false;
    try {
      const canvas = document.createElement("canvas");
      return !!(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
    } catch {
      return false;
    }
  });

  return supported;
}

/** A slow idle turn — the pocket globe's whole behaviour, the plate's resting state. */
export function IdleSpin({
  speed = 0.05,
  paused,
}: {
  speed?: number;
  paused: boolean;
}) {
  const invalidate = useThree((s) => s.invalidate);
  useFrame(({ scene }, delta) => {
    if (paused) return;
    scene.rotation.y += speed * delta;
    invalidate();
  });
  return null;
}
