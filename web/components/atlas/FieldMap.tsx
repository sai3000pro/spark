"use client";

/**
 * The walk on the REAL park, printed on the journal's paper.
 *
 * MapLibre renders actual Waterloo Park vector tiles restyled into a cream
 * survey map (public/map/night-walk.json's sibling, field-notes.json —
 * generated, never hand-edited), and the robot's odometry is georeferenced
 * onto it (lib/geo.ts). Everything drawn ON the map speaks the landing's
 * route-plate language:
 *
 *   · the walk is a dotted clay pen line over a soft brass highlighter bleed
 *   · kept moments are specimen banners — an ink stem planted at the spot with
 *     a small swallow-tailed flag flying its wall clock in typewriter, pressed
 *     in the journal's own ink — that breathe a sonar ring while hot
 *   · trailheads are benchmark rings, the scale bar speaks fnote
 *   · fair-weather clouds drift over the whole thing (CloudLayer), above you
 *     when you zoom out, shadow-only when you zoom in
 *
 * During a replay the pen redraws the route up to the playhead while the full
 * walk waits underneath as a faint pencil trace; markers past the playhead
 * haven't "happened yet" and print hollow. The camera opens tilted (pitch 48)
 * so the park reads as a place, not a diagram.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { setWorkerUrl } from "maplibre-gl";
import MapGL, { Layer, Marker, ScaleControl, Source, useMap, type MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

// MapLibre v6 ships its tile worker as a separate module that Turbopack's
// `new Worker(new URL(...))` handling misses — without this the style never
// finishes loading and not a single tile is requested. The worker files are
// copied into public/map-lib by scripts/copy-maplibre-worker.mjs (predev/prebuild).
if (typeof window !== "undefined") {
  setWorkerUrl("/map-lib/maplibre-gl-worker.mjs");
}
import { CloudLayer } from "@/components/atlas/CloudLayer";
import { makeGeo, type GeoRef } from "@/lib/geo";
import { BRASS, CLAY, PINE, inkForMoment, type MomentInk } from "@/lib/theme";
import type { MomentSummary } from "@/lib/tripData";
import type { TrackPoint, Vec2 } from "@/lib/types";

interface Props {
  /** This trip's map calibration — where its local metres land on Earth. */
  geo: GeoRef;
  /**
   * The trip's title block — milk-haloed lettering that leans back with the
   * map camera's pitch (level lines, no bearing roll), not a floating card.
   */
  plate?: React.ReactNode;
  path: TrackPoint[];
  moments: MomentSummary[];
  /** Wall-clock labels ("19:42"), aligned with `moments` — the banners fly them. */
  clocks: string[];
  activeId: string | null;
  /** Playhead time — markers after it haven't "happened yet" during a replay. */
  reachedT: number | null;
  robotPos: Vec2 | null;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
}

const line = (coords: [number, number][]) =>
  ({
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: coords },
  }) as const;

export function FieldMap({ geo, plate, path, moments, clocks, activeId, reachedT, robotPos, onHover, onOpen }: Props) {
  const mapRef = useRef<MapRef>(null);

  // Precomputed once per trip — the path is 350+ points and re-projects on every
  // replay frame. makeGeo memoizes by value, so an equal ref returns the same one.
  const g = useMemo(() => makeGeo(geo), [geo]);

  const routeCoords = useMemo(() => path.map((p) => g.localToLngLat(p.pos)), [g, path]);
  const bounds = useMemo(
    () => g.tripBounds([...path.map((p) => p.pos), ...moments.map((m) => m.placePos)]),
    [g, path, moments],
  );

  /** The replayed portion — the route the pen has re-drawn so far. */
  const reachedCoords = useMemo(() => {
    if (reachedT === null) return routeCoords;
    const out: [number, number][] = [];
    for (let i = 0; i < path.length && path[i].t <= reachedT; i++) out.push(routeCoords[i]);
    return out;
  }, [path, routeCoords, reachedT]);

  const fit = useCallback(() => {
    mapRef.current?.fitBounds(bounds, {
      padding: { top: 130, bottom: 170, left: 70, right: 70 },
      pitch: 48,
      bearing: -14,
      duration: 0,
    });
  }, [bounds]);

  const center = useMemo<[number, number]>(
    () => [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2],
    [bounds],
  );

  return (
    <div className="absolute inset-0 overflow-hidden bg-paper">
      <MapGL
        ref={mapRef}
        mapStyle="/map/field-notes.json"
        initialViewState={{ longitude: center[0], latitude: center[1], zoom: 15.4, pitch: 48, bearing: -14 }}
        onLoad={fit}
        onResize={fit}
        minZoom={13.5}
        maxZoom={18.5}
        attributionControl={{ compact: true }}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      >
        {/* The full walk — a faint dotted pencil trace waiting to be re-drawn. */}
        <Source id="route-all" type="geojson" data={line(routeCoords)}>
          <Layer
            id="route-trace"
            type="line"
            paint={{
              "line-color": PINE,
              "line-width": 1.8,
              "line-opacity": reachedT === null ? 0 : 0.32,
              "line-dasharray": [0.1, 2.6],
            }}
            layout={{ "line-cap": "round", "line-join": "round" }}
          />
        </Source>

        {/* The kept route: a dotted clay pen line over a brass highlighter
            bleed — the same stroke the journal uses to mark a keeper. */}
        <Source id="route-lit" type="geojson" data={line(reachedCoords)}>
          <Layer
            id="route-marker"
            type="line"
            paint={{ "line-color": BRASS, "line-width": 15, "line-blur": 5, "line-opacity": 0.5 }}
            layout={{ "line-cap": "round", "line-join": "round" }}
          />
          <Layer
            id="route-pen"
            type="line"
            paint={{
              "line-color": CLAY,
              "line-width": 2.8,
              "line-opacity": 0.95,
              "line-dasharray": [0.1, 1.9],
            }}
            layout={{ "line-cap": "round", "line-join": "round" }}
          />
        </Source>

        {/* Trailheads — benchmark rings, the cartographer's ⌖. */}
        <TrailheadMarker at={routeCoords[0]} label="Start" />
        <TrailheadMarker at={routeCoords[routeCoords.length - 1]} label="End" hollow />

        {/* The kept moments — specimen banners planted where the minutes were kept. */}
        {moments.map((m, i) => {
          const [lng, lat] = g.localToLngLat(m.placePos);
          return (
            <Marker key={m.id} longitude={lng} latitude={lat} anchor="bottom" style={{ zIndex: activeId === m.id ? 3 : 2 }}>
              <SurveyMarker
                index={i}
                ink={inkForMoment(i)}
                clock={clocks[i] ?? ""}
                title={m.title}
                hasMusic={m.hasMusic}
                active={activeId === m.id}
                unreached={reachedT !== null && m.tStart > reachedT}
                onHover={(h) => onHover(h ? m.id : null)}
                onOpen={() => onOpen(m.id)}
              />
            </Marker>
          );
        })}

        {/* The robot, re-walking its odometry. */}
        {robotPos && (
          <Marker longitude={g.localToLngLat(robotPos)[0]} latitude={g.localToLngLat(robotPos)[1]} anchor="center" style={{ zIndex: 4 }}>
            <RobotDot />
          </Marker>
        )}

        <ScaleControl position="bottom-left" maxWidth={110} unit="metric" />

        {/* The trip's title block, leaning back with the ground. */}
        {plate && <GroundPlate>{plate}</GroundPlate>}

        {/* The weather — world-anchored, pointer-transparent, over everything
            on the page the way weather is. */}
        <CloudLayer />
      </MapGL>

      {/* The page: paper tooth over the tiles, then a soft ink shade at the
          edges so the map sits IN the journal instead of ending at the glass. */}
      <div className="papergrain pointer-events-none absolute inset-0" aria-hidden />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `linear-gradient(180deg, rgb(250 244 227 / 0.75) 0%, rgb(250 244 227 / 0) 15%, rgb(250 244 227 / 0) 72%, rgb(250 244 227 / 0.8) 100%),
            radial-gradient(120% 90% at 50% 50%, rgb(27 27 24 / 0) 62%, rgb(27 27 24 / 0.12) 100%)`,
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Marks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lettering lying back with the ground, lines level with the screen.
 *
 * The block is pinned to the screen's top-left and leans back with the map
 * camera's pitch (rotateX), so it sits in the same plane as the park below —
 * but it deliberately does NOT turn with the bearing: a rotateZ tips the
 * text's right side down, and level lines read better than faithful ones
 * (tried both ways; the roll was rejected). The transform writes straight to
 * the node on every map move; a setState here would re-render the app at pan
 * speed.
 */
function GroundPlate({ children }: { children: React.ReactNode }) {
  const { current: map } = useMap();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!map) return;
    const apply = () => {
      const el = ref.current;
      if (!el) return;
      // 0.82: full pitch lays the type too flat to read at a glance — the
      // lettering leans with the ground rather than gluing itself to it.
      const lean = Math.min(52, map.getPitch() * 0.82);
      el.style.transform = `rotateX(${lean}deg)`;
    };
    apply();
    map.on("move", apply);
    return () => {
      map.off("move", apply);
    };
  }, [map]);

  return (
    <div
      className="pointer-events-none absolute left-4 top-4 z-10 sm:left-6 sm:top-5"
      style={{ perspective: "900px" }}
    >
      <div
        ref={ref}
        className="pointer-events-auto"
        style={{ transformOrigin: "50% 100%" }}
      >
        {children}
      </div>
    </div>
  );
}

/** The swallow-tail cut on the banner's fly end. */
const BANNER_CLIP = "polygon(0 0, 100% 0, calc(100% - 5px) 50%, 100% 100%, 0 100%)";

/**
 * A specimen banner — the naturalist's flag planted where a minute was kept:
 * contact shadow on the ground, a fine ink stem, and a small swallow-tailed
 * banner flying the moment's wall clock in typewriter, pressed in the
 * journal's own ink. Hot banners straighten, lift and breathe a sonar ring;
 * banners the replay hasn't reached yet print hollow — not happened yet.
 */
function SurveyMarker({
  index,
  ink,
  clock,
  title,
  hasMusic,
  active,
  unreached,
  onHover,
  onOpen,
}: {
  index: number;
  ink: MomentInk;
  clock: string;
  title: string;
  hasMusic: boolean;
  active: boolean;
  unreached: boolean;
  onHover: (h: boolean) => void;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Moment ${index + 1}, ${clock}: ${title}. Open the splat.`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      onClick={onOpen}
      className="relative block h-[40px] w-[3px] cursor-pointer"
      style={{
        transform: active ? "translateY(-3px)" : "translateY(0)",
        transformOrigin: "bottom center",
        transition: "transform 0.3s var(--ease-signature)",
      }}
    >
      {/* Ground contact — a soft ellipse straddling the anchor point. */}
      <span
        aria-hidden
        className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 rounded-full"
        style={{ width: 14, height: 5, background: "rgb(27 27 24 / 0.28)", filter: "blur(1.6px)" }}
      />

      {/* The stem, planted at the anchor. */}
      <span
        aria-hidden
        className="absolute bottom-0 left-1/2 w-[1.5px] -translate-x-1/2"
        style={{ height: 40, background: unreached ? `${ink.deep}8c` : ink.deep }}
      />

      {/* The banner, hoisted at the top of the stem. A wisp of a lean at rest;
          it straightens when hot, the way a flag catches wind. */}
      <span
        aria-hidden
        className="absolute left-[0.5px] top-0 block"
        style={{
          transform: active ? "rotate(0deg)" : "rotate(-2.5deg)",
          transformOrigin: "0% 50%",
          transition: "transform 0.3s var(--ease-signature)",
          filter: unreached ? "none" : "drop-shadow(0 1.5px 2px rgb(27 27 24 / 0.28))",
        }}
      >
        <span
          className="relative flex h-[17px] items-center pl-[7px] pr-[11px]"
          style={{ background: ink.deep, clipPath: BANNER_CLIP }}
        >
          {/* Hollow print for not-yet-reached banners: a vellum inlay. */}
          {unreached && (
            <span
              aria-hidden
              className="absolute inset-[1.4px]"
              style={{ background: "var(--color-vellum)", clipPath: BANNER_CLIP }}
            />
          )}
          <span
            className="fnote relative text-[8.5px] leading-none"
            style={{ color: unreached ? ink.deep : "var(--color-milk)", letterSpacing: "0.08em" }}
          >
            {clock}
          </span>
        </span>
      </span>

      {/* The sonar breath, rippling from the hoist while hot. */}
      {active && (
        <span
          aria-hidden
          className="sonar absolute left-1/2 top-[2px] rounded-full"
          style={{ width: 13, height: 13, marginLeft: -6.5, boxShadow: `0 0 0 1.5px ${ink.deep}` }}
        />
      )}

      {/* Hover label — a vellum slip pinned over the park. */}
      {active && (
        <span
          className="pointer-events-none absolute bottom-[calc(100%+9px)] left-1/2 flex w-max -translate-x-1/2 items-baseline gap-2 rounded-[4px] px-2.5 py-1.5"
          style={{
            background: "var(--color-vellum)",
            boxShadow: "var(--ring-ink), 0 8px 24px rgb(27 27 24 / 0.22)",
            animation: "takeover 0.3s var(--ease-signature) both",
          }}
        >
          <span className="fnote text-[9px]" style={{ color: ink.deep }}>
            [ {clock} ]
          </span>
          <span className="text-[12px] font-semibold text-ink">{title}</span>
          <span className="fnote text-[8.5px] text-ink-faint">
            {hasMusic ? "scored · step inside" : "step inside"}
          </span>
        </span>
      )}
    </button>
  );
}

/** A benchmark ring — the cartographer's mark for a measured point. */
function TrailheadMarker({ at, label, hollow }: { at: [number, number]; label: string; hollow?: boolean }) {
  // Start stacks its label above the ring, End below — the two trailheads sit
  // metres apart and their labels collide otherwise.
  return (
    <Marker longitude={at[0]} latitude={at[1]} anchor="center" offset={hollow ? [0, 14] : [0, -14]} style={{ zIndex: 1 }}>
      <span className={`pointer-events-none flex items-center gap-1.5 ${hollow ? "flex-col" : "flex-col-reverse"}`}>
        <span
          aria-hidden
          className="grid place-items-center rounded-full"
          style={{
            width: 13,
            height: 13,
            boxShadow: `inset 0 0 0 1.5px ${PINE}, 0 0 0 2px rgb(255 251 240 / 0.85)`,
            background: "rgb(255 251 240 / 0.55)",
          }}
        >
          {!hollow && <span className="block rounded-full" style={{ width: 4.5, height: 4.5, background: PINE }} />}
        </span>
        <span
          className="fnote rounded-[3px] px-1.5 py-0.5 text-[9px]"
          style={{ color: PINE, background: "rgb(255 251 240 / 0.88)", boxShadow: "var(--ring-ink)" }}
        >
          [ {label} ]
        </span>
      </span>
    </Marker>
  );
}

/** The robot re-walking the path — the pen's nib moving across the page. */
function RobotDot() {
  return (
    <span className="pointer-events-none relative grid place-items-center" style={{ width: 40, height: 40 }}>
      <span
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{
          background: "radial-gradient(circle, rgb(207 94 50 / 0.3) 0%, rgb(0 0 0 / 0) 70%)",
          animation: "glow-breathe 1.4s ease-in-out infinite",
        }}
      />
      <span
        className="relative block rounded-full"
        style={{
          width: 13,
          height: 13,
          background: CLAY,
          boxShadow: "0 0 0 2.5px rgb(255 251 240 / 0.95), 0 0 0 3.5px rgb(207 94 50 / 0.5)",
        }}
      />
    </span>
  );
}
