"use client";

/**
 * The moment, in 3D.
 *
 * Switches purely on `moment.splat.status`, which is the seam that lets the real
 * reconstruction land without touching this file:
 *
 *   ready + file present  → Spark SplatMesh (the real thing)
 *   ready + file missing  → synthetic cloud, badged honestly
 *   processing / failed   → synthetic cloud + the reason
 *
 * Object anchors are identical in every mode, so the search → "show me in 3D" →
 * camera-fly handoff behaves the same whether or not a capture exists yet.
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { buildSyntheticCloud } from "@/lib/splat/syntheticCloud";
import { colorForLabel } from "@/lib/mock/labels";
import { compactNumber, pct } from "@/lib/format";
import { CANVAS_BG } from "@/lib/theme";
import type { Moment } from "@/lib/types";

interface Props {
  moment: Moment;
  focusTrackId?: string | null;
  onSelectObject?: (trackId: string | null) => void;
  className?: string;
}

type Mode = "checking" | "spark" | "synthetic";

export function SplatStage({ moment, focusTrackId, onSelectObject, className = "" }: Props) {
  const [mode, setMode] = useState<Mode>(() =>
    moment.splat.status === "ready" && moment.splat.url ? "checking" : "synthetic",
  );


  // Probe for the asset instead of letting Spark fail: tonight no .spz files
  // exist, and a 404 inside the renderer is a worse failure than not starting it.
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
    // Definite height, not an aspect-ratio box: R3F refuses to initialise its
    // root until it measures a non-zero size, so the container should have one
    // from the first layout pass.
    <div className={`surface relative overflow-hidden rounded-2xl bg-ink-950 ${className}`}>
      <Canvas
        // antialias off per Spark's guidance — it costs a lot and buys nothing for splats.
        gl={{ antialias: false }}
        dpr={[1, 1.75]}
        // Objects sit within ~4 m of the centre, so start close enough to read them.
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

        <Anchors
          anchors={cloud.anchors}
          focusTrackId={focusTrackId}
          onSelect={onSelectObject}
        />

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

      <StageOverlay moment={moment} mode={mode} pointCount={cloud.count} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Renders the stand-in cloud with a Gaussian falloff per point — which is quite
 * literally what a splat is, so the preview and the real thing read the same way.
 *
 * A custom shader rather than PointsMaterial for two reasons: PointsMaterial has
 * no per-point size attribute (so the cloud's size variation would be thrown
 * away), and its texture-based falloff is a linear ramp rather than a gaussian.
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
    // Perspective-correct point size: world-space radius → pixels.
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
    // Gaussian, normalized so the sprite edge lands at ~0.
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

  // Stable uniform object — recreating it would rebuild the shader program.
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

  // Keep point size stable in pixels across viewport and fov changes. Computed
  // during render and applied by R3F via the `uniforms-uScale-value` prop, rather
  // than mutating a memoized material inside an effect.
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
        // Overlapping soft blobs must not punch depth holes in each other, or the
        // cloud looks like confetti instead of a volume.
        depthWrite={false}
        blending={THREE.NormalBlending}
      />
    </points>
  );
}

/**
 * The real splat path. Lazily imported so the ~large Spark bundle is only fetched
 * when there is actually a reconstruction to show.
 */
function SparkSplat({ url, onFail }: { url: string; onFail: () => void }) {
  const { scene, gl } = useThree();
  const [object, setObject] = useState<THREE.Object3D | null>(null);

  useEffect(() => {
    let alive = true;
    let mesh: THREE.Object3D | null = null;
    let renderer: THREE.Object3D | null = null;

    (async () => {
      try {
        const { SparkRenderer, SplatMesh } = await import("@sparkjsdev/spark");
        if (!alive) return;

        // Spark needs its renderer in the scene to do sorting work outside the loop.
        const spark = new SparkRenderer({ renderer: gl as THREE.WebGLRenderer });
        renderer = spark as unknown as THREE.Object3D;
        scene.add(renderer);

        const splat = new SplatMesh({ url });
        await splat.initialized;
        if (!alive) return;

        // Captures come in with an arbitrary up-axis; +Y up matches our anchors.
        splat.rotation.set(Math.PI, 0, 0);
        mesh = splat as unknown as THREE.Object3D;
        setObject(mesh);
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
  focusTrackId?: string | null;
  onSelect?: (trackId: string | null) => void;
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
                onSelect?.(focused ? null : a.trackId);
              }}
            >
              {/* Sized to be a real click target, not a decorative dot. */}
              <sphereGeometry args={[active ? 0.19 : 0.14, 16, 16]} />
              <meshBasicMaterial color={color} transparent opacity={active ? 1 : 0.78} />
            </mesh>

            {/* A ring makes a focused anchor findable even when it is behind a cluster. */}
            {focused && (
              <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[0.4, 0.48, 32]} />
                <meshBasicMaterial color={color} transparent opacity={0.8} side={THREE.DoubleSide} />
              </mesh>
            )}

            {active && (
              <Html center distanceFactor={9} zIndexRange={[10, 0]}>
                <div className="pointer-events-none -translate-y-7 whitespace-nowrap rounded-md border border-ink-600 bg-ink-950/92 px-2 py-1 text-[11px] backdrop-blur-sm">
                  <span className="font-medium text-fog-100">{a.label}</span>
                  <span className="tnum ml-1.5 font-mono text-[10px] text-fog-400">
                    {pct(a.confidence)}
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

/** Flies the camera to a focused anchor. Drives the search → 3D handoff. */
function CameraRig({
  anchors,
  focusTrackId,
}: {
  anchors: Anchor[];
  focusTrackId?: string | null;
}) {
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
    // Approach from outside the scene so the object is between camera and centre.
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

// ─────────────────────────────────────────────────────────────────────────────

function StageOverlay({
  moment,
  mode,
  pointCount,
}: {
  moment: Moment;
  mode: Mode;
  pointCount: number;
}) {
  const { splat } = moment;
  const isReal = mode === "spark";

  return (
    <>
      <div className="pointer-events-none absolute left-3 top-3 flex flex-col items-start gap-1.5">
        {isReal ? (
          <Badge tone="signal">
            reconstruction · {splat.pointCount ? compactNumber(splat.pointCount) : "?"} splats
          </Badge>
        ) : (
          <Badge tone="warn" title="Derived from the moment's detected object positions, not a capture.">
            synthetic preview · {compactNumber(pointCount)} points
          </Badge>
        )}
        {!isReal && splat.status === "ready" && (
          <Badge tone="neutral">capture not uploaded yet</Badge>
        )}
        {splat.status === "processing" && <Badge tone="compute">reconstructing</Badge>}
        {splat.status === "failed" && <Badge tone="fail">reconstruction failed</Badge>}
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3">
        <p className="max-w-md text-[10px] leading-snug text-fog-400">
          {!isReal && splat.note
            ? splat.note
            : "Drag to orbit · scroll to zoom · click a marker to inspect an object"}
        </p>
        <span className="shrink-0 font-mono text-[10px] text-fog-400">
          {moment.objects.filter((o) => o.worldPos).length} anchors
        </span>
      </div>
    </>
  );
}

function Badge({
  children,
  tone,
  title,
}: {
  children: React.ReactNode;
  tone: "signal" | "compute" | "warn" | "fail" | "neutral";
  title?: string;
}) {
  const tones = {
    signal: "border-signal-500/45 bg-signal-500/12 text-signal-400",
    compute: "border-compute-500/45 bg-compute-500/12 text-compute-400",
    warn: "border-warn-400/45 bg-warn-400/12 text-warn-400",
    fail: "border-fail-400/45 bg-fail-400/12 text-fail-400",
    neutral: "border-ink-600 bg-ink-950/80 text-fog-400",
  };
  return (
    <span
      title={title}
      className={`rounded-full border px-2 py-0.5 font-mono text-[10px] backdrop-blur-sm ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
