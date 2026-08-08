"use client";

/**
 * The moment, in 3D — the stage inside the takeover.
 *
 * Switches purely on `moment.splat`, which is the seam that lets the real
 * reconstruction land without touching this file:
 *
 *   ready + file present  → Spark SplatMesh (the real thing)
 *   anything else         → synthetic Gaussian cloud, badged honestly
 *
 * Object anchors are identical in every mode, so the find → "step inside" →
 * camera-fly handoff behaves the same whether or not a capture exists yet.
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { buildSyntheticCloud } from "@/lib/splat/syntheticCloud";
import { colorForLabel } from "@/lib/mock/labels";
import { compactNumber } from "@/lib/format";
import { CANVAS_BG, type RisoInk } from "@/lib/theme";
import type { Moment } from "@/lib/types";

interface Props {
  moment: Moment;
  ink: RisoInk;
  focusTrackId: string | null;
  onSelectObject: (trackId: string | null) => void;
}

type Mode = "checking" | "spark" | "synthetic";

export function SplatViewer({ moment, ink, focusTrackId, onSelectObject }: Props) {
  const [mode, setMode] = useState<Mode>(() =>
    moment.splat.status === "ready" && moment.splat.url ? "checking" : "synthetic",
  );

  // Probe for the asset instead of letting Spark fail: a 404 inside the
  // renderer is a worse failure than not starting it.
  useEffect(() => {
    if (mode !== "checking" || !moment.splat.url) return;
    let alive = true;
    fetch(moment.splat.url, { method: "HEAD" })
      .then((res) => alive && setMode(res.ok ? "spark" : "synthetic"))
      .catch(() => alive && setMode("synthetic"));
    return () => {
      alive = false;
    };
  }, [mode, moment.splat.url]);

  const cloud = useMemo(
    () =>
      buildSyntheticCloud({
        objects: moment.objects,
        center: moment.place.pos,
        hue: moment.keyframes[0]?.hue,
        seed: moment.id.length * 977 + moment.objects.length,
      }),
    [moment],
  );

  return (
    // Definite size from the parent; R3F refuses to initialise on a zero box.
    <div className="absolute inset-0">
      <Canvas
        // antialias off per Spark's guidance — costs a lot, buys nothing for splats.
        gl={{ antialias: false }}
        dpr={[1, 1.75]}
        camera={{ position: [0, 1.9, 5.6], fov: 52, near: 0.05, far: 260 }}
      >
        <color attach="background" args={[CANVAS_BG]} />
        <ambientLight intensity={0.6} />

        <Suspense fallback={null}>
          {mode === "spark" && moment.splat.url ? (
            <SparkSplat url={moment.splat.url} onFail={() => setMode("synthetic")} />
          ) : (
            <PointCloud cloud={cloud} />
          )}
        </Suspense>

        <Anchors anchors={cloud.anchors} focusTrackId={focusTrackId} onSelect={onSelectObject} />

        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          minDistance={1.2}
          maxDistance={26}
          maxPolarAngle={Math.PI * 0.495}
          target={[0, 0.8, 0]}
        />
        <CameraRig anchors={cloud.anchors} focusTrackId={focusTrackId} />
      </Canvas>

      {/* ── Chips over the stage ────────────────────────────────────────── */}
      <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap items-center gap-1.5">
        {mode === "spark" ? (
          <StageChip color={ink.base}>
            splat · {moment.splat.pointCount ? compactNumber(moment.splat.pointCount) : "?"} gaussians
          </StageChip>
        ) : (
          <StageChip>synthetic preview · {compactNumber(cloud.count)} pts</StageChip>
        )}
        {moment.splat.status === "processing" && <StageChip color="#b4a6e8">reconstructing</StageChip>}
        {moment.splat.status === "failed" && <StageChip color="#e8907f">reconstruction failed</StageChip>}
      </div>

      <p className="tag pointer-events-none absolute bottom-3 right-3 text-[9px] text-cream-bright/50">
        drag to orbit · scroll to zoom · click a dot to inspect
      </p>
    </div>
  );
}

function StageChip({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      className="tag rounded-full border-[1.5px] border-cream-bright/25 bg-navy-deep/70 px-2.5 py-1 text-[9px] backdrop-blur-sm"
      style={{ color: color ?? "rgba(253,248,236,0.7)" }}
    >
      {children}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * The stand-in cloud with a Gaussian falloff per point — which is quite
 * literally what a splat is, so the preview and the real thing read the same.
 * A custom shader because PointsMaterial has no per-point size attribute and
 * its texture falloff is linear rather than gaussian.
 */
const POINT_VERT = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  uniform float uScale;
  varying vec3 vColor;
  varying float vDepth;

  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_PointSize = max(1.0, aSize * uScale / max(0.001, vDepth));
    gl_Position = projectionMatrix * mv;
  }
`;

const POINT_FRAG = /* glsl */ `
  precision mediump float;
  uniform float uOpacity;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec3 uFogColor;
  varying vec3 vColor;
  varying float vDepth;

  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r2 = dot(d, d);
    if (r2 > 0.25) discard;
    float a = exp(-r2 * 11.0) * uOpacity;
    float fog = 1.0 - smoothstep(uFogNear, uFogFar, vDepth);
    gl_FragColor = vec4(mix(uFogColor, vColor, fog), a * fog);
  }
`;

function PointCloud({ cloud }: { cloud: ReturnType<typeof buildSyntheticCloud> }) {
  const { size, camera } = useThree();

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(cloud.positions, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(cloud.colors, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(cloud.sizes, 1));
    g.computeBoundingSphere();
    return g;
  }, [cloud]);

  const uniforms = useMemo(
    () => ({
      uScale: { value: 800 },
      // Low per-point alpha on purpose: a splat is many faint overlapping
      // gaussians accumulating into a surface. High alpha reads as confetti.
      uOpacity: { value: 0.5 },
      uFogNear: { value: 16 },
      uFogFar: { value: 44 },
      uFogColor: { value: new THREE.Color(CANVAS_BG) },
    }),
    [],
  );

  const fov = (camera as THREE.PerspectiveCamera).fov ?? 52;
  const pointScale = size.height / (2 * Math.tan((fov * Math.PI) / 360));

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        vertexShader={POINT_VERT}
        fragmentShader={POINT_FRAG}
        uniforms={uniforms}
        uniforms-uScale-value={pointScale}
        transparent
        depthWrite={false}
        blending={THREE.NormalBlending}
      />
    </points>
  );
}

/** The real splat path — lazily imported so the Spark bundle is only fetched when needed. */
function SparkSplat({ url, onFail }: { url: string; onFail: () => void }) {
  const { scene, gl } = useThree();
  const [object, setObject] = useState<THREE.Object3D | null>(null);

  useEffect(() => {
    let alive = true;
    let renderer: THREE.Object3D | null = null;

    (async () => {
      try {
        const { SparkRenderer, SplatMesh } = await import("@sparkjsdev/spark");
        if (!alive) return;

        const spark = new SparkRenderer({ renderer: gl as THREE.WebGLRenderer });
        renderer = spark as unknown as THREE.Object3D;
        scene.add(renderer);

        const splat = new SplatMesh({ url });
        await splat.initialized;
        if (!alive) return;

        // Captures come in with an arbitrary up-axis; +Y up matches our anchors.
        splat.rotation.set(Math.PI, 0, 0);
        setObject(splat as unknown as THREE.Object3D);
      } catch (err) {
        console.warn("[splat] Spark failed to load, falling back to point cloud:", err);
        if (alive) onFail();
      }
    })();

    return () => {
      alive = false;
      if (renderer) scene.remove(renderer);
    };
  }, [url, scene, gl, onFail]);

  return object ? <primitive object={object} /> : null;
}

// ─────────────────────────────────────────────────────────────────────────────

type Anchor = ReturnType<typeof buildSyntheticCloud>["anchors"][number];

function Anchors({
  anchors,
  focusTrackId,
  onSelect,
}: {
  anchors: Anchor[];
  focusTrackId: string | null;
  onSelect: (trackId: string | null) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <group>
      {anchors.map((a) => {
        const focused = focusTrackId === a.trackId;
        const active = focused || hovered === a.trackId;
        const color = colorForLabel(a.label);
        return (
          <group key={a.trackId} position={a.pos as unknown as [number, number, number]}>
            <mesh
              onPointerOver={(e) => {
                e.stopPropagation();
                setHovered(a.trackId);
                document.body.style.cursor = "pointer";
              }}
              onPointerOut={() => {
                setHovered(null);
                document.body.style.cursor = "";
              }}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(focused ? null : a.trackId);
              }}
            >
              <sphereGeometry args={[active ? 0.19 : 0.14, 16, 16]} />
              <meshBasicMaterial color={color} transparent opacity={active ? 1 : 0.8} />
            </mesh>

            {focused && (
              <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[0.4, 0.48, 32]} />
                <meshBasicMaterial color={color} transparent opacity={0.85} side={THREE.DoubleSide} />
              </mesh>
            )}

            {active && (
              <Html center distanceFactor={9} zIndexRange={[10, 0]}>
                <div className="pointer-events-none -translate-y-7 whitespace-nowrap rounded-[8px] border-[1.5px] border-ink/50 bg-cream-bright/95 px-2 py-1">
                  <span className="text-[11px] font-bold text-ink">{a.label}</span>
                  <span className="tag ml-1.5 text-[8.5px] text-ink-soft">
                    {Math.round(a.confidence * 100)}%
                  </span>
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

/** Flies the camera to a focused anchor. Drives the find → 3D handoff. */
function CameraRig({ anchors, focusTrackId }: { anchors: Anchor[]; focusTrackId: string | null }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as
    | (THREE.EventDispatcher & { target: THREE.Vector3; update: () => void })
    | null;

  const goal = useRef<{ target: THREE.Vector3; pos: THREE.Vector3 } | null>(null);

  useEffect(() => {
    if (!focusTrackId) return;
    const a = anchors.find((x) => x.trackId === focusTrackId);
    if (!a) return;

    const target = new THREE.Vector3(...(a.pos as [number, number, number]));
    const outward = new THREE.Vector3(target.x, 0, target.z);
    if (outward.lengthSq() < 0.01) outward.set(0, 0, 1);
    outward.normalize();

    goal.current = {
      target,
      pos: target.clone().add(outward.multiplyScalar(2.4)).add(new THREE.Vector3(0, 1.05, 0)),
    };
  }, [focusTrackId, anchors]);

  useFrame(() => {
    if (!goal.current || !controls) return;
    controls.target.lerp(goal.current.target, 0.075);
    camera.position.lerp(goal.current.pos, 0.075);
    controls.update();
    if (camera.position.distanceTo(goal.current.pos) < 0.03) goal.current = null;
  });

  return null;
}
