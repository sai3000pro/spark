"use client";

/**
 * The moment, in 3D — the stage inside the takeover.
 *
 * Switches purely on `moment.splat`, which is the seam that lets a real
 * reconstruction land without touching the rest of the app:
 *
 *   ready + file present  → a real engine (Spark, or mkkellogg — see below)
 *   anything else         → synthetic Gaussian cloud, badged honestly
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO ENGINES, AND WHY THE TREE LOOKS ASYMMETRIC
 *
 * Spark runs on the bundled three 0.185, so it mounts INSIDE this file's own
 * Canvas as one more child — sharing the anchors, the orbit controls and the
 * camera rig with the synthetic preview. mkkellogg needs an isolated CDN three
 * 0.160.1 whose objects are not instances of the bundled classes, so it takes
 * over as its own subtree with its own canvas and its own copy of all of that
 * (lib/splat/gs3d.ts, components/relive/GS3DStage.tsx).
 *
 * Which one runs is the reader's preference (lib/splat/renderer.ts), overridden
 * only when the preferred engine cannot read the file — mkkellogg cannot open
 * SPZ. The chip names whichever actually drew, never the preference.
 *
 * Object anchors are identical in all three modes, so the find → "step inside"
 * → camera-fly handoff behaves the same whether or not a capture exists yet.
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GS3DStage } from "@/components/relive/GS3DStage";
import { SparkScene } from "@/components/relive/SparkScene";
import { buildSyntheticCloud } from "@/lib/splat/syntheticCloud";
import {
  RENDERER_INFO,
  canOpen,
  formatOf,
  rendererFor,
  type SplatRenderer,
} from "@/lib/splat/renderer";
import { setSplatRenderer, useSplatRenderer } from "@/lib/splat/useSplatRenderer";
import { colorForLabel } from "@/lib/mock/labels";
import { compactNumber } from "@/lib/format";
import { CANVAS_BG, type MomentInk } from "@/lib/theme";
import type { Moment } from "@/lib/types";

interface Props {
  moment: Moment;
  /** The moment's ink — reserved for data accents; provenance chips keep their own semantics. */
  ink: MomentInk;
  focusTrackId: string | null;
  onSelectObject: (trackId: string | null) => void;
}

type Mode = "checking" | "real" | "synthetic";

export function SplatViewer({ moment, focusTrackId, onSelectObject }: Props) {
  const [mode, setMode] = useState<Mode>(() =>
    moment.splat.status === "ready" && moment.splat.url ? "checking" : "synthetic",
  );
  const preference = useSplatRenderer();

  // Two numbers, because a big capture has two slow phases and conflating them
  // parks the chip at "100%" for minutes: `progress` is the download, `ready` is
  // the scene actually drawing.
  //
  // Stamped with WHICH load they describe, so switching engine or moment does
  // not need an effect to clear them — a stale stamp simply reads as zero. The
  // effect version of this was a cascading render on every switch.
  const [load, setLoad] = useState({ key: "", progress: 0, ready: false });

  // Probe for the asset instead of letting the renderer fail: a 404 deep inside
  // a splat loader is a worse failure than never starting it.
  useEffect(() => {
    if (mode !== "checking" || !moment.splat.url) return;
    let alive = true;
    fetch(moment.splat.url, { method: "HEAD" })
      .then((res) => alive && setMode(res.ok ? "real" : "synthetic"))
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

  // Which engine will actually draw. `rendererFor` is what makes the preference
  // safe to hold: choosing mkkellogg and then opening an SPZ quietly uses Spark
  // rather than failing.
  const engine = moment.splat.url ? rendererFor(preference, moment.splat.url) : null;
  const useReal = mode === "real" && Boolean(moment.splat.url) && engine !== null;

  // One load = one engine on one file. Both numbers below are read through it.
  const loadKey = `${engine ?? ""}:${moment.splat.url ?? ""}`;
  const progress = load.key === loadKey ? load.progress : 0;
  const ready = load.key === loadKey ? load.ready : false;

  // Stable across renders so a hover never re-mounts the splat scene.
  const fallBack = useCallback(() => setMode("synthetic"), []);
  const onProgress = useCallback(
    (percent: number) =>
      setLoad((prev) =>
        prev.key === loadKey
          ? { ...prev, progress: percent }
          : { key: loadKey, progress: percent, ready: false },
      ),
    [loadKey],
  );
  const markReady = useCallback(
    () => setLoad({ key: loadKey, progress: 100, ready: true }),
    [loadKey],
  );

  const loading = useReal && !ready;

  return (
    // Definite size from the parent; neither renderer initialises on a zero box.
    <div className="absolute inset-0">
      {useReal && engine === "gs3d" && moment.splat.url ? (
        <GS3DStage
          url={moment.splat.url}
          view={moment.splat.view}
          anchors={cloud.anchors}
          focusTrackId={focusTrackId}
          onSelectObject={onSelectObject}
          onProgress={onProgress}
          onReady={markReady}
          onFail={fallBack}
        />
      ) : (
        <Canvas
          // antialias off — costs a lot, buys nothing for a point/splat cloud,
          // and Spark asks for it off explicitly.
          gl={{ antialias: false }}
          dpr={[1, 1.75]}
          camera={{ position: [0, 1.9, 5.6], fov: 52, near: 0.05, far: 260 }}
        >
          <color attach="background" args={[CANVAS_BG]} />
          <ambientLight intensity={0.6} />

          {/* The real capture and the stand-in are alternatives, but everything
              around them — markers, controls, camera flight — is shared, which
              is the whole benefit of Spark being on the bundled three. */}
          {useReal && engine === "spark" && moment.splat.url ? (
            <SparkScene
              url={moment.splat.url}
              view={moment.splat.view}
              onProgress={onProgress}
              onReady={markReady}
              onFail={fallBack}
            />
          ) : (
            <Suspense fallback={null}>
              <PointCloud cloud={cloud} />
            </Suspense>
          )}

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
      )}

      {/* ── Provenance chips over the stage ─────────────────────────────── */}
      <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap items-center gap-1.5">
        {useReal && engine ? (
          <StageChip variant="live">
            [ splat · {moment.splat.pointCount ? compactNumber(moment.splat.pointCount) : "?"} gaussians ·{" "}
            {RENDERER_INFO[engine].label.toLowerCase()} ]
          </StageChip>
        ) : (
          <StageChip variant="synth">[ synthetic preview · {compactNumber(cloud.count)} pts ]</StageChip>
        )}
        {loading &&
          (progress < 100 ? (
            <StageChip>[ loading · {Math.round(progress)}% ]</StageChip>
          ) : (
            // The download is in; the renderer is still turning it into a scene.
            // Splats keep appearing underneath while this shows.
            <StageChip>[ building the scene ]</StageChip>
          ))}
        {moment.splat.status === "processing" && <StageChip>[ reconstructing ]</StageChip>}
        {moment.splat.status === "failed" && <StageChip variant="synth">[ reconstruction failed ]</StageChip>}
      </div>

      {/* ── The bottom bar: the engine on the left, how to drive on the right
             ──────────────────────────────────────────────────────────────────
             One flex row rather than two independently-positioned absolutes.
             Positioned separately they overlapped the moment both were showing
             — the hint is long and right-aligned, so it ran straight under the
             toggle at every stage width worth having. */}
      <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-end justify-between gap-3">
        {useReal && engine ? (
          <RendererToggle
            engine={engine}
            preference={preference}
            url={moment.splat.url ?? ""}
            onChoose={setSplatRenderer}
          />
        ) : (
          <span />
        )}
        <p className="fnote shrink-0 text-right text-[9px] text-mist">
          drag to orbit · scroll to zoom · click a dot to inspect
        </p>
      </div>
    </div>
  );
}

/**
 * Two buttons, bottom-left, only while a real capture is on screen — there is
 * nothing to choose between while the stand-in is showing.
 *
 * The copy is careful about one thing above all: an engine that cannot open a
 * file is a FORMAT limit, and compression is a STORAGE limit. Neither costs
 * anyone detail they cannot get back — the full-detail PLY is theirs to keep,
 * it simply counts against their quota (lib/storage/reclaim.ts is the only
 * thing in the app that ever trades one for the other, and it shows both
 * renders first). Nothing here may imply otherwise.
 */
function RendererToggle({
  engine,
  preference,
  url,
  onChoose,
}: {
  engine: SplatRenderer;
  preference: SplatRenderer;
  url: string;
  onChoose: (r: SplatRenderer) => void;
}) {
  const overridden = engine !== preference;
  const format = formatOf(url);

  return (
    // Re-enables pointer events the bottom bar switches off, so the hint next
    // to it stays click-through.
    <div className="pointer-events-auto flex min-w-0 flex-col items-start gap-1">
      <div className="flex items-center gap-1">
        {(["spark", "gs3d"] as const).map((id) => {
          const info = RENDERER_INFO[id];
          const opens = canOpen(id, url);
          const on = engine === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChoose(id)}
              // Never disabled: picking it is still a valid preference for every
              // other capture, and `rendererFor` keeps this one rendering.
              title={
                opens
                  ? `${info.library} — ${info.note}`
                  : `${info.library} cannot open ${format ?? "this format"}. ` +
                    `Choosing it still applies everywhere it can.`
              }
              className={`fnote chip chip-plate text-[9.5px] ${
                on ? "text-ink" : "text-ink-faint"
              } ${opens ? "" : "line-through decoration-ink-faint/60"}`}
            >
              {on && (
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: "var(--color-brass)" }}
                />
              )}
              {info.label.toLowerCase()}
            </button>
          );
        })}
      </div>
      {overridden && (
        <p className="fnote max-w-[15rem] text-[9px] leading-relaxed text-mist">
          {RENDERER_INFO[preference].label.toLowerCase()} cannot read{" "}
          {format ? `.${format}` : "this format"} — drawn with{" "}
          {RENDERER_INFO[engine].label.toLowerCase()}. Your choice still stands elsewhere.
        </p>
      )}
    </div>
  );
}

function StageChip({
  children,
  variant,
}: {
  children: React.ReactNode;
  /** Three semantics, not colors: neutral metadata · live = measured · synth = stand-in/attention. */
  variant?: "live" | "synth";
}) {
  // Milk text carries the words on the pine plate; the semantic ink rides
  // beside them as a dot, never as the only carrier.
  const dot =
    variant === "live" ? "var(--color-brass)" : variant === "synth" ? "var(--color-clay)" : null;
  return (
    <span className="fnote chip chip-plate text-[9.5px]">
      {dot && <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />}
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
                <div
                  className="pointer-events-none -translate-y-7 whitespace-nowrap rounded-[6px] bg-vellum/95 px-2 py-1"
                  style={{ boxShadow: "var(--ring-ink), 0 4px 12px rgb(6 10 11 / 0.4)" }}
                >
                  <span className="text-[11px] font-bold text-ink">{a.label}</span>
                  <span className="fnote tnum ml-1.5 text-[9px] text-ink-faint">
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
