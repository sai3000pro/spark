"use client";

/**
 * The globe plate — the pocket globe, opened to a full page of the journal.
 *
 * The Earth stippled in pine ink on the journal's paper, every kept walk
 * planted as the same swallow-tailed specimen banner the map flies, a dotted
 * brass expedition line linking them in the order they were walked. Clicking a
 * banner (or its gazetteer row) swings the camera to the pin, dives to the
 * surface while a paper wash rises, and lands in that walk's map view — the
 * current walk simply closes the plate (the map is already beneath); any other
 * walk navigates to /walk?trip=<id>.
 *
 * ACCESSIBILITY: the gazetteer rail IS the keyboard interface, exactly as the
 * retired GlobeExplorer established — a WebGL canvas is not keyboard-navigable
 * and fake focus targets are worse than none, so the pins carry no ARIA and
 * the canvas gets one summary label.
 */
import { useRouter } from "next/navigation";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  BrassBezel,
  PaperEarth,
  PaperSea,
  VoyageLine,
  usePaperCloud,
  useReducedMotion,
  useWebGLSupport,
} from "@/components/atlas/paperGlobe";
import { distance, duration, shortDate } from "@/lib/format";
import { formatGeo, geoToVec3 } from "@/lib/globe/geo";
import { inkForMoment, type MomentInk } from "@/lib/theme";
import type { GlobePin, GlobeView } from "@/lib/globeData";

/** Idle spin resumes this long after the user lets go of the sphere. */
const AUTOROTATE_RESUME_MS = 4000;

/** How long the paper wash takes to cover the dive before the landing fires. */
const WASH_MS = 420;

interface Props {
  view: GlobeView;
  /** The walk open beneath the plate — its pin breathes, and clicking it just closes. */
  currentTripId: string;
  onClose: () => void;
}

/** What a click is flying toward: the pin, and the specific walk to land in. */
interface Flight {
  key: string;
  tripId: string;
}

export function GlobeOverlay({ view, currentTripId, onClose }: Props) {
  const router = useRouter();
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [washing, setWashing] = useState(false);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const railFadeRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const landTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reducedMotion = useReducedMotion();
  const webgl = useWebGLSupport();
  const cloud = usePaperCloud(110_000);
  const fitDist = useFitDistance();

  /** Chronological — the expedition line hops the walks in the order they happened. */
  const stops = useMemo(
    () =>
      [...view.albums]
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
        .map((a) => a.origin),
    [view.albums],
  );

  const countries = useMemo(
    () => new Set(view.albums.map((a) => a.country)).size,
    [view.albums],
  );

  /** Pressed inks cycle by pin, the way moments cycle on the map. */
  const inkOf = useCallback(
    (key: string) => inkForMoment(view.pins.findIndex((p) => p.key === key)),
    [view.pins],
  );

  const land = useCallback(
    (tripId: string) => {
      if (tripId === currentTripId) onClose();
      else router.push(`/walk?trip=${tripId}`);
    },
    [currentTripId, onClose, router],
  );

  /** A banner or rail row was chosen: start the flight (or, reduced, just go). */
  const select = useCallback(
    (key: string, tripId: string) => {
      if (flight) return;
      setFlight({ key, tripId });
      if (reducedMotion) {
        setWashing(true);
        landTimer.current = setTimeout(() => land(tripId), 240);
      }
    },
    [flight, land, reducedMotion],
  );

  /** The flight reached its pin — raise the paper and step through it. */
  const onArrived = useCallback(() => {
    if (!flight || washing) return;
    setWashing(true);
    landTimer.current = setTimeout(() => land(flight.tripId), WASH_MS);
  }, [flight, land, washing]);

  useEffect(() => () => {
    if (landTimer.current) clearTimeout(landTimer.current);
  }, []);

  // Esc closes the plate — unless a landing is already in motion.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !flight) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flight, onClose]);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  // Roving focus: ↑/↓ walk the gazetteer, which lights the pins.
  const onRailKeyDown = (e: React.KeyboardEvent) => {
    const dir = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const rows = Array.from(
      railRef.current?.querySelectorAll<HTMLButtonElement>("button[data-pin]") ?? [],
    );
    const at = rows.findIndex((b) => b === document.activeElement);
    rows[Math.min(rows.length - 1, Math.max(0, at + dir))]?.focus();
  };

  const activeKey = hoveredKey ?? flight?.key ?? null;

  return (
    <div
      className="fixed inset-0 z-40 overflow-hidden bg-paper text-ink"
      role="dialog"
      aria-modal="true"
      aria-label="The globe — every walk on one sphere"
      style={{
        animation: "takeover 0.34s var(--ease-signature) both",
        transformOrigin: "88% 88%",
      }}
    >
      {/* The sphere's seat on the page — a soft contact shadow just under the
          limb, the same ground-contact ellipse the map's banners stand on. */}
      <div
        aria-hidden
        className="absolute left-1/2 hidden -translate-x-1/2 sm:block"
        style={{
          top: "82%",
          width: "52vmin",
          height: "9vmin",
          background: "radial-gradient(50% 50% at 50% 50%, rgb(27 27 24 / 0.16) 0%, rgb(27 27 24 / 0) 70%)",
        }}
      />

      <div
        className="absolute inset-0"
        role="img"
        aria-label={`Globe with ${view.albums.length} walks pinned across ${view.pins.length} places`}
      >
        {webgl && (
          <Canvas
            gl={{ antialias: true, alpha: true }}
            dpr={[1, 1.75]}
            // fov 38, not wider: planets photographed on a wide lens go cartoonish.
            camera={{ position: [0, 0.7, fitDist], fov: 38, near: 0.1, far: 40 }}
          >
            <PaperSea />
            <PaperEarth cloud={cloud} sizeBoost={1.35} />
            <BrassBezel />
            <VoyageLine stops={stops} />

            {view.pins.map((pin) => (
              <SpecimenPin
                key={pin.key}
                pin={pin}
                ink={inkOf(pin.key)}
                isHere={pin.albums.some((a) => a.id === currentTripId)}
                active={activeKey === pin.key}
                // A farther resting camera (portrait fit) shrinks the pins on
                // screen; growing the invisible target keeps them tappable.
                hitScale={fitDist / 4.15}
                onHover={setHoveredKey}
                onSelect={(tripId) => select(pin.key, tripId)}
              />
            ))}

            <PlateControls reducedMotion={reducedMotion} flying={!!flight} maxDist={fitDist + 0.8} />
            <FlightRig
              pins={view.pins}
              flight={flight}
              reducedMotion={reducedMotion}
              onArrived={onArrived}
            />
            <CameraReadout readoutRef={readoutRef} />
            <RailFade railRef={railFadeRef} />
          </Canvas>
        )}
      </div>

      {/* The page: tooth over the plate, soft ink shade at the edges — the same
          treatment that seats the map in the journal. */}
      <div className="papergrain pointer-events-none absolute inset-0" aria-hidden />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `linear-gradient(180deg, rgb(250 244 227 / 0.75) 0%, rgb(250 244 227 / 0) 15%, rgb(250 244 227 / 0) 72%, rgb(250 244 227 / 0.8) 100%),
            radial-gradient(120% 90% at 50% 50%, rgb(27 27 24 / 0) 62%, rgb(27 27 24 / 0.12) 100%)`,
        }}
      />

      {/* ── Chrome — vellum slips pinned over the plate ──────────────────── */}
      {/* No card: the plate's masthead is set straight into the page — the
          background IS paper, so the type needs nothing under it. */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start justify-between gap-3 p-5 sm:p-6">
        <div className="rise-in pointer-events-auto">
          <div className="flex items-baseline gap-2.5">
            <span className="font-display text-[26px] leading-none" style={{ fontWeight: 580 }}>
              Spark<span className="text-clay">.</span>
            </span>
            <span className="fnote text-[10px] text-ink-soft">[ the globe ]</span>
          </div>
          <p className="tag tnum mt-2 text-[13px] text-ink-soft">
            {view.albums.length} walks · {countries} countries · one sphere
          </p>
          <p className="fnote mt-1 text-[8.5px] text-ink-faint">
            [ every banner is a kept walk ]
          </p>
        </div>

        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="pill-ghost rise-in pointer-events-auto bg-vellum/80 px-3.5 py-2 text-[13px] text-ink"
          style={{ "--i": 1 } as React.CSSProperties}
        >
          Back to the map
          <kbd
            className="fnote rounded-[3px] px-1.5 py-0.5 text-[10px] text-ink-faint"
            style={{ boxShadow: "var(--ring-ink)" }}
          >
            esc
          </kbd>
        </button>
      </header>

      {/* ── The gazetteer — the journal's index of walks ─────────────────── */}
      {/* No card: the index is set straight into the page, haloed in milk the
          way the map's own labels are. It lives visually BEHIND the sphere —
          zooming in swells the limb over this side of the page, so RailFade
          dissolves it once the camera closes past reading distance. */}
      <aside
        className="rise-in pointer-events-none absolute bottom-20 left-4 top-28 z-10 hidden w-[290px] md:flex md:flex-col md:justify-center sm:left-5"
        style={{ "--i": 2 } as React.CSSProperties}
      >
        {/* RailFade writes opacity here, NOT on the aside — rise-in's fill-mode
            holds its final keyframe, which would override inline opacity. */}
        <div
          ref={railFadeRef}
          className="pointer-events-auto relative flex max-h-full flex-col"
          style={{
            textShadow:
              "0 0 5px rgb(255 251 240 / 0.95), 0 0 10px rgb(255 251 240 / 0.85), 0 0 18px rgb(255 251 240 / 0.7)",
          }}
        >
          <p className="fnote shrink-0 px-1 pb-2 text-[9px] text-ink-faint">
            [ gazetteer · newest first ]
          </p>
          <div
            ref={railRef}
            onKeyDown={onRailKeyDown}
            className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-0.5"
          >
            {view.pins.map((pin) =>
              pin.albums.map((album) => (
                <button
                  key={album.id}
                  type="button"
                  data-pin={pin.key}
                  aria-pressed={flight?.tripId === album.id}
                  onMouseEnter={() => setHoveredKey(pin.key)}
                  onMouseLeave={() => setHoveredKey(null)}
                  onFocus={() => setHoveredKey(pin.key)}
                  onBlur={() => setHoveredKey(null)}
                  onClick={() => select(pin.key, album.id)}
                  className="flex w-full items-center gap-2.5 rounded-[3px] px-2 py-1.5 text-left transition-colors"
                  style={{
                    background: activeKey === pin.key ? `${inkOf(pin.key).deep}14` : "transparent",
                  }}
                >
                  {/* A miniature of the pin's own banner — the rail and the
                      sphere are two renderings of one list. */}
                  <span
                    aria-hidden
                    className="h-[10px] w-[15px] shrink-0"
                    style={{
                      background: inkOf(pin.key).deep,
                      clipPath: "polygon(0 0, 100% 0, calc(100% - 4px) 50%, 100% 100%, 0 100%)",
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-semibold leading-tight text-ink">
                      {album.title}
                    </span>
                    <span className="tag tnum block truncate text-[10.5px] text-ink-faint">
                      {album.id === currentTripId && (
                        <span className="fnote mr-1 text-[8.5px] text-clay">[ here ]</span>
                      )}
                      {album.placeLabel} · {shortDate(album.startedAt)} · {distance(album.distanceM)}
                    </span>
                  </span>
                </button>
              )),
            )}
          </div>
        </div>
      </aside>

      {/* ── HUD footnotes ────────────────────────────────────────────────── */}
      {/* The instrument's readout, set straight into the page (left-16 clears
          the dev badge pinned in the corner). */}
      <span
        ref={readoutRef}
        className="fnote pointer-events-none absolute bottom-5 left-16 z-10 hidden text-[9px] text-ink-faint sm:block"
      />

      {/* The paper wash — the page rising to meet the dive. While it is up it
          also swallows the pointer, so a landing cannot be double-booked. */}
      <div
        aria-hidden
        // z-[35]: above the drei <Html> banners (zIndexRange caps at 30), or a
        // diving pin's flag would poke through the rising page.
        className={washing ? "absolute inset-0 z-[35]" : "pointer-events-none absolute inset-0 z-[35]"}
        style={{
          background: "var(--color-paper)",
          opacity: washing ? 1 : 0,
          transition: `opacity ${WASH_MS}ms var(--ease-signature)`,
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pins — the map's specimen banners, planted on the sphere
// ─────────────────────────────────────────────────────────────────────────────

/** The swallow-tail cut — identical to the map's SurveyMarker banner. */
const BANNER_CLIP = "polygon(0 0, 100% 0, calc(100% - 5px) 50%, 100% 100%, 0 100%)";

function SpecimenPin({
  pin,
  ink,
  isHere,
  active,
  hitScale,
  onHover,
  onSelect,
}: {
  pin: GlobePin;
  ink: MomentInk;
  /** This pin holds the walk currently open beneath the plate. */
  isHere: boolean;
  active: boolean;
  hitScale: number;
  onHover: (key: string | null) => void;
  onSelect: (tripId: string) => void;
}) {
  const labelRef = useRef<HTMLDivElement>(null);
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

  const count = pin.albums.length;
  const album = pin.albums[0];
  const flag = count > 1 ? `${count} walks` : shortDate(album.startedAt).toUpperCase();

  useFrame(({ camera }) => {
    // drei's <Html> is a DOM portal and does NOT depth-test, so a far-side
    // banner would float over the planet. Compute facing directly: both
    // vectors are unit and the globe is at the origin.
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
  });

  // Navigating away mid-hover must not leave the page stuck with a pointer cursor.
  useEffect(() => () => {
    document.body.style.cursor = "";
  }, []);

  return (
    <group quaternion={quaternion}>
      {/* The footprint ring — what makes a pin read as PLANTED on the surface
          rather than floating near it. Rings are single-sided; hence DoubleSide. */}
      <mesh position={[0, 1.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.013, 0.019, 40]} />
        <meshBasicMaterial color={ink.deep} transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>

      {/* The stem, planted at the origin. */}
      <mesh position={[0, 1.026, 0]}>
        <cylinderGeometry args={[0.0016, 0.0016, 0.052, 6]} />
        <meshBasicMaterial color={ink.deep} transparent opacity={0.8} />
      </mesh>

      {/* Invisible hit target. `visible={false}` would NOT work — three's
          raycaster skips invisible objects entirely. Raycasting also ignores
          depth, so the handlers gate on `facing`. */}
      <mesh
        position={[0, 1.045, 0]}
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
          onSelect(album.id);
        }}
      >
        <sphereGeometry args={[0.055 * hitScale, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* The banner — DOM, so it is EXACTLY the map's mark, hoisted to orbit.
          No distanceFactor: the flag holds its screen size at every camera
          distance, exactly as the map's banners hold theirs at every zoom —
          flying closer changes the ground, never the lettering. */}
      <Html
        center
        zIndexRange={active ? [30, 20] : [19, 10]}
        position={[0, 1.078, 0]}
      >
        <div ref={labelRef} className="pointer-events-none relative" style={{ transition: "opacity 0.2s linear" }}>
          <span
            aria-hidden
            className="absolute left-[-1px] top-1/2 block"
            style={{
              transform: active ? "translateY(-50%) rotate(0deg)" : "translateY(-50%) rotate(-2.5deg)",
              transformOrigin: "0% 50%",
              transition: "transform 0.3s var(--ease-signature)",
              filter: "drop-shadow(0 1.5px 2px rgb(27 27 24 / 0.28))",
            }}
          >
            <span
              className="relative flex h-[17px] items-center pl-[7px] pr-[12px]"
              style={{ background: ink.deep, clipPath: BANNER_CLIP }}
            >
              <span
                className="fnote relative whitespace-nowrap text-[8.5px] leading-none"
                style={{ color: "var(--color-milk)", letterSpacing: "0.08em" }}
              >
                {flag}
              </span>
            </span>
          </span>

          {/* The walk open beneath the plate breathes its sonar ring, exactly
              as its hot banner does on the map. */}
          {isHere && (
            <span
              aria-hidden
              className="sonar absolute left-[-1px] top-1/2 -translate-y-1/2 rounded-full"
              style={{ width: 13, height: 13, marginLeft: -6.5, boxShadow: `0 0 0 1.5px ${ink.deep}` }}
            />
          )}

          {/* Hover slip — a vellum slip pinned over the sphere. */}
          {active && (
            <span
              className="pointer-events-none absolute bottom-[calc(100%+10px)] left-0 flex w-max -translate-x-1/3 flex-col gap-0.5 rounded-[4px] px-2.5 py-1.5"
              style={{
                background: "var(--color-vellum)",
                boxShadow: "var(--ring-ink), 0 8px 24px rgb(27 27 24 / 0.22)",
                animation: "takeover 0.3s var(--ease-signature) both",
              }}
            >
              <span className="flex items-baseline gap-2">
                <span className="fnote text-[9px]" style={{ color: ink.deep }}>
                  [ {formatGeo(pin.origin)} ]
                </span>
              </span>
              {pin.albums.map((a) => (
                <span key={a.id} className="flex items-baseline gap-2">
                  <span className="text-[12px] font-semibold text-ink">{a.title}</span>
                  <span className="fnote text-[8.5px] text-ink-faint">
                    {a.placeLabel} · {duration(a.durationSec)}
                  </span>
                </span>
              ))}
              <span className="fnote text-[8.5px] text-ink-faint">
                {isHere ? "this walk · step back in" : "step into this walk"}
              </span>
            </span>
          )}
        </div>
      </Html>
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Camera
// ─────────────────────────────────────────────────────────────────────────────

function PlateControls({
  reducedMotion,
  flying,
  maxDist,
}: {
  reducedMotion: boolean;
  flying: boolean;
  maxDist: number;
}) {
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
      // Required: FlightRig reads useThree(s => s.controls).
      makeDefault
      enableDamping
      dampingFactor={0.08}
      // Panning a globe is always wrong — it slides the planet off-centre and
      // there is no way back except a reload.
      enablePan={false}
      minDistance={1.3}
      maxDistance={maxDist}
      rotateSpeed={0.55}
      zoomSpeed={0.7}
      autoRotate={spinning && !reducedMotion && !flying}
      autoRotateSpeed={0.3}
    />
  );
}

/**
 * Flies to a chosen pin, then dives.
 *
 * Interpolating camera POSITION linearly would cut a chord through the planet
 * whenever the target is on the far side; nlerping direction and lerping
 * distance separately keeps the camera on a shell outside the surface the
 * whole way. Once the approach settles, the goal drops to just above the
 * surface — the dive — and `onArrived` lets the overlay raise its paper wash.
 */
function FlightRig({
  pins,
  flight,
  reducedMotion,
  onArrived,
}: {
  pins: GlobePin[];
  flight: Flight | null;
  reducedMotion: boolean;
  onArrived: () => void;
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as
    | (THREE.EventDispatcher & { target: THREE.Vector3; update: () => void })
    | null;

  const goal = useRef<{ dir: THREE.Vector3; dist: number; diving: boolean } | null>(null);

  useEffect(() => {
    if (!flight) {
      goal.current = null;
      return;
    }
    const pin = pins.find((p) => p.key === flight.key);
    if (!pin) return;

    const [x, y, z] = geoToVec3(pin.origin);
    const target = new THREE.Vector3(x, y, z).normalize();

    // Antipodal guard. If the camera is exactly opposite the target, lerp()
    // hits the zero vector at t=0.5 and normalize() yields NaN, which poisons
    // the camera permanently.
    const current = camera.position.clone().normalize();
    if (current.dot(target) < -0.9999) {
      const nudge = Math.abs(target.y) < 0.9
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0);
      target.addScaledVector(nudge.cross(target).normalize(), 1e-3).normalize();
    }

    goal.current = { dir: target, dist: 1.7, diving: false };

    // Reduced motion skips the whole flight; the overlay is already washing.
    if (reducedMotion) {
      camera.position.copy(target).multiplyScalar(1.7);
      controls?.target.set(0, 0, 0);
      controls?.update();
      goal.current = null;
    }
  }, [flight, pins, camera, controls, reducedMotion]);

  useFrame(() => {
    const g = goal.current;
    if (!g || !controls) return;

    // nlerp on the direction: never passes through the origin, so the camera
    // never clips through the planet.
    const dir = camera.position.clone().normalize().lerp(g.dir, 0.08).normalize();
    const dist = THREE.MathUtils.lerp(camera.position.length(), g.dist, 0.08);
    camera.position.copy(dir).multiplyScalar(dist);
    controls.target.set(0, 0, 0);
    controls.update();

    const settled = camera.position.distanceTo(g.dir.clone().multiplyScalar(g.dist)) < 0.02;
    if (settled && !g.diving) {
      // The approach is done: drop the goal to just above the surface and let
      // the overlay raise the page to meet us.
      g.diving = true;
      g.dist = 1.12;
      onArrived();
    }
  });

  return null;
}

/**
 * How far back the camera must sit for the whole sphere (plus banner headroom)
 * to fit the viewport. The vertical fov is fixed at 38°, so on a portrait
 * phone the horizontal fov is the constraint — without this the limb runs off
 * both edges of the screen.
 */
function useFitDistance(): number {
  const compute = () => {
    if (typeof window === "undefined") return 4.15;
    const halfV = (38 / 2) * (Math.PI / 180);
    const aspect = window.innerWidth / window.innerHeight;
    const halfH = Math.atan(Math.tan(halfV) * aspect);
    // 1.42R of headroom: the sphere, its pins, and a breath of page around them.
    return Math.min(9, Math.max(4.15, 1.42 / Math.sin(Math.min(halfV, halfH))));
  };

  const [dist, setDist] = useState(compute);

  useEffect(() => {
    const onResize = () => setDist(compute());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return dist;
}

/** The gazetteer starts dissolving here… */
const RAIL_FADE_START = 3.6;
/** …and is fully gone (and unclickable) here. */
const RAIL_FADE_END = 3.0;

/**
 * The page under the sphere. The gazetteer is set straight into the paper, so
 * when the camera dives, the swelling limb should cover it the way a globe
 * covers the desk it sits on — this fades the rail out as the camera closes,
 * writing styles straight to the DOM (opacity changes every frame of a zoom;
 * setState would re-render the whole overlay at 60 Hz).
 */
function RailFade({ railRef }: { railRef: React.RefObject<HTMLElement | null> }) {
  useFrame(({ camera }) => {
    const el = railRef.current;
    if (!el) return;
    const t = THREE.MathUtils.clamp(
      (camera.position.length() - RAIL_FADE_END) / (RAIL_FADE_START - RAIL_FADE_END),
      0,
      1,
    );
    el.style.opacity = String(t);
    // pointer-events:none on the aside would not reach its pointer-events-auto
    // child, so hide the subtree outright once it is invisible.
    el.style.visibility = t < 0.04 ? "hidden" : "";
  });
  return null;
}

/**
 * The lat/lng the camera is over, written to the HUD as textContent at ~6 Hz.
 * Never setState — this changes every frame while the sphere turns.
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
      `[ ${Math.abs(lat).toFixed(1)}° ${lat >= 0 ? "N" : "S"} · ` +
      `${Math.abs(lng).toFixed(1)}° ${lng >= 0 ? "E" : "W"} · alt ${(r - 1).toFixed(2)}R ]`;
  });

  return null;
}
