"use client";

/**
 * Earth, as a point cloud.
 *
 * A near-mirror of components/splat/SplatStage.tsx by design — same custom
 * `<points>` shader with a per-point size attribute and gaussian falloff, same
 * `dpr` clamp, same CameraRig lerp idiom. The planet is rendered with the same
 * machinery as a moment's reconstruction, which is what makes the app's two 3D
 * screens read as one system.
 *
 * Two deliberate deviations from SplatStage:
 *
 *   1. `antialias: true` here. Splats have no hard silhouettes, so SplatStage
 *      turns AA off and loses nothing. A planet's limb and the equator ring do
 *      have hard edges, and jaggies on a planet limb are the single most
 *      "unfinished" artifact this app could ship. At ~14k points the cost is nil.
 *   2. Depth testing stays ON for the land points, because the opaque occluder
 *      sphere just inside the surface is what hides the far side. That one mesh
 *      replaces all manual back-face culling for every mesh on the globe.
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { geoToVec3 } from "@/lib/geo";
import { buildGlobeCloud, buildStarField } from "@/lib/globe/globePoints";
import { CANVAS_BG, INK, MACHINE, MEMORY, STATE } from "@/lib/theme";
import type { GlobePin } from "@/lib/globeData";

interface Props {
  pins: GlobePin[];
  hoveredKey: string | null;
  selectedKey: string | null;
  reducedMotion: boolean;
  onHover: (key: string | null) => void;
  onSelect: (key: string) => void;
  /** Written ~6×/s with the camera's sub-point, as textContent — never state. */
  readoutRef: React.RefObject<HTMLSpanElement | null>;
}

/** Idle spin resumes this long after the user stops interacting. */
const AUTOROTATE_RESUME_MS = 4000;

export function GlobeStage({
  pins,
  hoveredKey,
  selectedKey,
  reducedMotion,
  onHover,
  onSelect,
  readoutRef,
}: Props) {
  const cloud = useMemo(() => buildGlobeCloud(), []);
  const stars = useMemo(() => buildStarField(), []);

  // Cursor state is set on document.body by the pins; make sure navigating away
  // mid-hover cannot leave the whole page stuck with a pointer cursor.
  useEffect(() => {
    return () => {
      document.body.style.cursor = "";
    };
  }, []);

  return (
    <Canvas
      // See the header: a planet limb needs AA, a splat does not.
      gl={{ antialias: true }}
      dpr={[1, 1.75]}
      // fov 38, not the 52 SplatStage uses: planets photographed on a wide lens
      // look wrong, and the limb curvature goes cartoonish.
      camera={{ position: [0, 0.55, 3.1], fov: 38, near: 0.1, far: 200 }}
    >
      <color attach="background" args={[CANVAS_BG]} />

      <Stars stars={stars} />

      {/* The occluder. Just inside the surface, opaque, background-coloured — it
          is what depth-tests away everything on the far side, for free. */}
      <mesh renderOrder={0}>
        <sphereGeometry args={[0.985, 64, 48]} />
        <meshBasicMaterial color={INK[950]} />
      </mesh>

      <LandPoints cloud={cloud} reducedMotion={reducedMotion} />
      <Bezel />

      <Pins
        pins={pins}
        hoveredKey={hoveredKey}
        selectedKey={selectedKey}
        reducedMotion={reducedMotion}
        onHover={onHover}
        onSelect={onSelect}
      />

      <Atmosphere />

      <Controls reducedMotion={reducedMotion} flying={!!selectedKey} />
      <GlobeRig pins={pins} selectedKey={selectedKey} reducedMotion={reducedMotion} />
      <CameraReadout readoutRef={readoutRef} />
    </Canvas>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Land
// ─────────────────────────────────────────────────────────────────────────────

const LAND_VERT = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aInland;
  uniform float uScale;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying float vInland;

  void main() {
    vColor = aColor;
    // On a unit sphere the position IS the normal — no normal attribute needed.
    vNormal = normalize(position);
    vInland = aInland;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = max(1.0, aSize * uScale / max(0.001, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

const LAND_FRAG = /* glsl */ `
  precision mediump float;
  uniform vec3 uLightDir;
  uniform vec3 uNight;
  uniform float uOpacity;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying float vInland;

  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r2 = dot(d, d);
    if (r2 > 0.25) discard;
    // The same gaussian falloff as the splat stage — that shared shape is why the
    // two 3D screens feel related.
    float a = exp(-r2 * 11.0);

    float lam = 0.42 + 0.58 * smoothstep(-0.25, 0.75, dot(vNormal, uLightDir));
    // The dark side keeps a faint machine-teal cast so it reads as instrumented
    // rather than dead.
    vec3 rgb = mix(uNight, vColor * lam, lam);
    // Interiors sit back; coastlines carry the read.
    float fade = mix(1.0, 0.55, vInland);

    gl_FragColor = vec4(rgb, a * uOpacity * fade);
  }
`;

function LandPoints({
  cloud,
  reducedMotion,
}: {
  cloud: ReturnType<typeof buildGlobeCloud>;
  reducedMotion: boolean;
}) {
  const { size, camera } = useThree();

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(cloud.positions, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(cloud.colors, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(cloud.sizes, 1));
    g.setAttribute("aInland", new THREE.BufferAttribute(cloud.inland, 1));
    g.computeBoundingSphere();
    return g;
  }, [cloud]);

  const uniforms = useMemo(
    () => ({
      uScale: { value: 800 },
      uLightDir: { value: new THREE.Vector3(1, 0.35, 0.6).normalize() },
      // Derived from MACHINE[600], not a new palette token.
      uNight: { value: new THREE.Color(MACHINE[600]).multiplyScalar(0.35) },
      // Higher than SplatStage's 0.5: these are cartographic marks read
      // individually, not overlapping gaussians accumulating into a volume.
      uOpacity: { value: 0.92 },
    }),
    [],
  );

  // Precess the terminator by writing the uniform directly. Never a React prop —
  // that would re-render the tree 60 times a second.
  useFrame((_, delta) => {
    if (reducedMotion) return;
    const dir = uniforms.uLightDir.value;
    const a = 0.06 * delta;
    const x = dir.x * Math.cos(a) - dir.z * Math.sin(a);
    const z = dir.x * Math.sin(a) + dir.z * Math.cos(a);
    dir.set(x, dir.y, z).normalize();
  });

  const fov = (camera as THREE.PerspectiveCamera).fov ?? 38;
  const pointScale = size.height / (2 * Math.tan((fov * Math.PI) / 360));

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <points geometry={geometry} frustumCulled={false} renderOrder={1}>
      <shaderMaterial
        vertexShader={LAND_VERT}
        fragmentShader={LAND_FRAG}
        uniforms={uniforms}
        uniforms-uScale-value={pointScale}
        transparent
        depthWrite={false}
      />
    </points>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Instrument bezel: an equator and 24 ticks. Not a wireframe globe.
// ─────────────────────────────────────────────────────────────────────────────

function Bezel() {
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
        <meshBasicMaterial color={INK[500]} transparent opacity={0.5} />
      </mesh>

      {/* One draw call for all 24 ticks rather than 24 meshes. */}
      <points geometry={ticks}>
        <pointsMaterial color={MACHINE[600]} size={2.5} sizeAttenuation={false} transparent opacity={0.75} />
      </points>
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Stars({ stars }: { stars: ReturnType<typeof buildStarField> }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(stars.positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(stars.colors, 3));
    return g;
  }, [stars]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <points geometry={geometry} frustumCulled={false} renderOrder={-1}>
      {/* sizeAttenuation off: stars are at a fixed 60 units and should read as
          pixels, not as objects that grow when you zoom. */}
      <pointsMaterial size={1.6} sizeAttenuation={false} vertexColors transparent opacity={0.75} depthWrite={false} />
    </points>
  );
}

/**
 * The rim. Static intensity — a pulsing atmosphere is the most reliable tell of
 * a WebGL demo, and this one is meant to look like an instrument.
 */
function Atmosphere() {
  const uniforms = useMemo(
    () => ({ uColor: { value: new THREE.Color(MACHINE[500]) } }),
    [],
  );

  return (
    <mesh renderOrder={2}>
      <sphereGeometry args={[1.14, 48, 32]} />
      <shaderMaterial
        uniforms={uniforms}
        side={THREE.BackSide}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
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
          uniform vec3 uColor;
          varying vec3 vNormal;
          varying vec3 vView;
          void main() {
            float f = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 3.2);
            gl_FragColor = vec4(uColor * f * 0.55, f * 0.55);
          }
        `}
      />
    </mesh>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pins
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Amber, not teal.
 *
 * globals.css splits the palette: cool = what the robot PERCEIVED, warm = what is
 * REMEMBERED. An album is a finished memory, so the pins are memory amber and the
 * teal on this screen belongs only to the apparatus — atmosphere rim, bezel
 * ticks, HUD chrome. The rule for the globe reads:
 *
 *     Teal is the instrument. Amber is the memory.
 *
 * Note this operates one level ABOVE MomentPin, where teal = a moment and amber =
 * a moment with music. That distinction lives inside a single trip; this one is
 * between trips. Not an inconsistency — a different altitude.
 */
function Pins({
  pins,
  hoveredKey,
  selectedKey,
  reducedMotion,
  onHover,
  onSelect,
}: {
  pins: GlobePin[];
  hoveredKey: string | null;
  selectedKey: string | null;
  reducedMotion: boolean;
  onHover: (key: string | null) => void;
  onSelect: (key: string) => void;
}) {
  return (
    <group renderOrder={1}>
      {pins.map((pin) => (
        <Pin
          key={pin.key}
          pin={pin}
          active={hoveredKey === pin.key || selectedKey === pin.key}
          labelled={hoveredKey === pin.key || selectedKey === pin.key}
          reducedMotion={reducedMotion}
          onHover={onHover}
          onSelect={onSelect}
        />
      ))}
    </group>
  );
}

function Pin({
  pin,
  active,
  labelled,
  reducedMotion,
  onHover,
  onSelect,
}: {
  pin: GlobePin;
  active: boolean;
  labelled: boolean;
  reducedMotion: boolean;
  onHover: (key: string | null) => void;
  onSelect: (key: string) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  /** Whether the pin is on the near side. Read by handlers; never state. */
  const facing = useRef(true);

  const dir = useMemo(() => {
    const [x, y, z] = geoToVec3(pin.origin);
    return new THREE.Vector3(x, y, z);
  }, [pin.origin]);

  const quaternion = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir),
    [dir],
  );

  const color = MEMORY[400];
  const haloColor = MEMORY[300];
  const count = pin.albums.length;
  const tipRadius = (active ? 0.021 : 0.017) + 0.004 * Math.min(3, count - 1);

  useFrame(({ camera, clock }) => {
    // drei's <Html> is a DOM portal and does NOT depth-test, so a far-side label
    // would float over the planet. <Html occlude> raycasts every frame and is
    // flaky, so compute facing directly: both vectors are unit and the globe is
    // at the origin.
    const camDir = camera.position.clone().normalize();
    const isFacing = dir.dot(camDir) > 0.12;
    facing.current = isFacing;

    // Written straight to the DOM node — a setState here would re-render every
    // pin 60 times a second.
    const el = labelRef.current;
    if (el) {
      el.style.opacity = isFacing ? "1" : "0";
      el.style.pointerEvents = isFacing ? "auto" : "none";
    }

    if (haloRef.current) {
      if (reducedMotion) {
        haloRef.current.scale.setScalar(1);
        return;
      }
      // 2.0s, matching MomentPin's SMIL pulse exactly — a deliberate echo across
      // two different rendering technologies.
      const t = (clock.elapsedTime % 2) / 2;
      const material = haloRef.current.material as THREE.Material;
      if (active) {
        haloRef.current.scale.setScalar(1 + t * 1.6);
        material.opacity = 0.45 * (1 - t);
      } else {
        haloRef.current.scale.setScalar(1);
        material.opacity = 0.22;
      }
    }
  });

  return (
    <group ref={groupRef} quaternion={quaternion}>
      {/* The footprint ring is the whole trick — it makes a pin read as PLANTED
          on the surface rather than floating near it. Rings are single-sided by
          default, hence DoubleSide. */}
      <mesh position={[0, 1.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.019, 0.026, 40]} />
        <meshBasicMaterial color={color} transparent opacity={0.65} side={THREE.DoubleSide} />
      </mesh>

      <mesh ref={haloRef} position={[0, 1.0005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.03, 0.058, 40]} />
        <meshBasicMaterial
          color={haloColor}
          transparent
          opacity={0.22}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <mesh position={[0, 1.0275, 0]}>
        <cylinderGeometry args={[0.0018, 0.0018, 0.055, 6]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} />
      </mesh>

      <mesh position={[0, 1.055, 0]}>
        <sphereGeometry args={[tipRadius, 14, 14]} />
        <meshBasicMaterial color={active ? haloColor : color} />
      </mesh>

      {/* Invisible hit target. `visible={false}` would NOT work — three's raycaster
          skips invisible objects entirely. Raycasting also ignores depth, so the
          handlers gate on `facing` or a far-side pin would still be clickable. */}
      <mesh
        position={[0, 1.05, 0]}
        onPointerOver={(e) => {
          if (!facing.current) return;
          e.stopPropagation();
          onHover(pin.key);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          onHover(null);
          document.body.style.cursor = "";
        }}
        onClick={(e) => {
          if (!facing.current) return;
          e.stopPropagation();
          onSelect(pin.key);
        }}
      >
        <sphereGeometry args={[0.045, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Only the hovered or selected pin gets text, exactly as SplatStage's
          Anchors does. The side rail is the label surface for everything else —
          a globe covered in permanent tooltips is unreadable. */}
      {labelled && (
        <Html center distanceFactor={2.6} zIndexRange={[10, 0]} position={[0, 1.09, 0]}>
          <div
            ref={labelRef}
            className="pointer-events-none -translate-y-7 whitespace-nowrap rounded-md border border-ink-600 bg-ink-950/92 px-2 py-1 text-[11px] backdrop-blur-sm"
          >
            <span className="font-medium text-fog-100">
              {count === 1 ? pin.albums[0].title : `${count} albums`}
            </span>
            <span className="tnum ml-1.5 font-mono text-[10px] text-fog-400">
              {pin.albums[0].placeLabel}, {pin.albums[0].country}
            </span>
          </div>
        </Html>
      )}
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Camera
// ─────────────────────────────────────────────────────────────────────────────

function Controls({ reducedMotion, flying }: { reducedMotion: boolean; flying: boolean }) {
  const [spinning, setSpinning] = useState(!reducedMotion);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onDown = () => {
      setSpinning(false);
      if (timer.current) clearTimeout(timer.current);
    };
    const onUp = () => {
      if (reducedMotion) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setSpinning(true), AUTOROTATE_RESUME_MS);
    };

    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [reducedMotion]);

  return (
    <OrbitControls
      // Required: GlobeRig reads useThree(s => s.controls).
      makeDefault
      enableDamping
      dampingFactor={0.08}
      // Panning a globe is always wrong — it slides the planet off-centre and
      // there is no way back except a reload.
      enablePan={false}
      minDistance={1.35}
      maxDistance={6.5}
      rotateSpeed={0.55}
      zoomSpeed={0.7}
      autoRotate={spinning && !reducedMotion && !flying}
      autoRotateSpeed={0.35}
    />
  );
}

/**
 * Flies to a selected pin.
 *
 * Reuses SplatStage's CameraRig structure with one essential change: lerping the
 * camera POSITION linearly cuts a chord straight through the planet whenever the
 * target is on the far side. Interpolating direction and distance separately
 * keeps the camera on a shell outside the surface the whole way.
 */
function GlobeRig({
  pins,
  selectedKey,
  reducedMotion,
}: {
  pins: GlobePin[];
  selectedKey: string | null;
  reducedMotion: boolean;
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as
    | (THREE.EventDispatcher & { target: THREE.Vector3; update: () => void })
    | null;

  const goal = useRef<{ dir: THREE.Vector3; dist: number } | null>(null);

  useEffect(() => {
    if (!selectedKey) return;
    const pin = pins.find((p) => p.key === selectedKey);
    if (!pin) return;

    const [x, y, z] = geoToVec3(pin.origin);
    const target = new THREE.Vector3(x, y, z).normalize();

    // Antipodal guard. If the camera is exactly opposite the target, lerp() hits
    // the zero vector at t=0.5 and normalize() yields NaN, which poisons the
    // camera permanently. This happens the first time anyone clicks a pin on the
    // other side of the world, so it is not theoretical.
    const current = camera.position.clone().normalize();
    if (current.dot(target) < -0.9999) {
      const nudge = Math.abs(target.y) < 0.9
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0);
      target.addScaledVector(nudge.cross(target).normalize(), 1e-3).normalize();
    }

    goal.current = { dir: target, dist: 1.9 };

    if (reducedMotion) {
      camera.position.copy(target).multiplyScalar(1.9);
      controls?.target.set(0, 0, 0);
      controls?.update();
      goal.current = null;
    }
  }, [selectedKey, pins, camera, controls, reducedMotion]);

  useFrame(() => {
    const g = goal.current;
    if (!g || !controls) return;

    // nlerp on the direction: never passes through the origin, so the camera
    // never clips through the planet.
    const dir = camera.position.clone().normalize().lerp(g.dir, 0.075).normalize();
    const dist = THREE.MathUtils.lerp(camera.position.length(), g.dist, 0.075);
    camera.position.copy(dir).multiplyScalar(dist);
    controls.target.set(0, 0, 0);
    controls.update();

    if (camera.position.distanceTo(g.dir.clone().multiplyScalar(g.dist)) < 0.01) {
      goal.current = null;
    }
  });

  return null;
}

/**
 * The lat/lng the camera is over, written to the HUD as textContent at ~6 Hz.
 *
 * Never setState: this changes every frame while the globe spins, and a state
 * update per frame would re-render the whole explorer 60 times a second.
 */
function CameraReadout({ readoutRef }: { readoutRef: React.RefObject<HTMLSpanElement | null> }) {
  const since = useRef(0);

  useFrame(({ camera }, delta) => {
    since.current += delta;
    if (since.current < 1 / 6) return;
    since.current = 0;

    const el = readoutRef.current;
    if (!el) return;

    const p = camera.position;
    const r = p.length() || 1;
    const lat = (Math.asin(THREE.MathUtils.clamp(p.y / r, -1, 1)) * 180) / Math.PI;
    const lng = (Math.atan2(p.x, p.z) * 180) / Math.PI;

    el.textContent =
      `${Math.abs(lat).toFixed(1)}° ${lat >= 0 ? "N" : "S"} · ` +
      `${Math.abs(lng).toFixed(1)}° ${lng >= 0 ? "E" : "W"} · alt ${(r - 1).toFixed(2)}R`;
  });

  return null;
}

export const GLOBE_ACCENT = { pin: MEMORY[400], live: STATE.signal } as const;
