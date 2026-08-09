"use client";

/**
 * The walk on the REAL place, printed on the journal's paper.
 *
 * MapLibre renders the trip's actual vector tiles restyled into a cream survey
 * map (public/map/night-walk.json's sibling, field-notes.json — generated,
 * never hand-edited), and the robot's odometry is georeferenced onto them
 * through the trip's own calibration (`geo`, built in lib/geo.ts). The style's
 * tile source is planet-wide, so wherever the walk happened, it draws.
 * Everything ON the map speaks the landing's route-plate language:
 *
 *   · the walk is a dotted clay pen line over a soft brass highlighter bleed
 *   · kept moments are surveyor's markers — ink stem, ringed head, numbered
 *     in typewriter — that breathe a sonar ring while hot
 *   · trailheads are benchmark rings, the scale bar speaks fnote
 *   · fair-weather clouds drift over the whole thing (CloudLayer), above you
 *     when you zoom out, shadow-only when you zoom in
 *
 * During a replay the pen redraws the route up to the playhead while the full
 * walk waits underneath as a faint pencil trace; markers past the playhead
 * haven't "happened yet" and print hollow. The camera opens tilted (pitch 48)
 * so the park reads as a place, not a diagram.
 */
import { useCallback, useMemo, useRef } from "react";
import { setWorkerUrl } from "maplibre-gl";
import MapGL, { Layer, Marker, ScaleControl, Source, type MapRef } from "react-map-gl/maplibre";
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
import { BRASS, CLAY, PAPER, PINE, inkForMoment, type MomentInk } from "@/lib/theme";
import type { MomentSummary } from "@/lib/tripData";
import type { TrackPoint, Vec2 } from "@/lib/types";

interface Props {
  path: TrackPoint[];
  moments: MomentSummary[];
  /** This trip's map calibration — where its local metres land on Earth. */
  geo: GeoRef;
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

export function FieldMap({ path, moments, geo, activeId, reachedT, robotPos, onHover, onOpen }: Props) {
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

        {/* The kept moments — surveyor's markers flagging the kept minutes. */}
        {moments.map((m, i) => {
          const [lng, lat] = g.localToLngLat(m.placePos);
          return (
            <Marker key={m.id} longitude={lng} latitude={lat} anchor="bottom" style={{ zIndex: activeId === m.id ? 3 : 2 }}>
              <SurveyMarker
                index={i}
                ink={inkForMoment(i)}
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

        {/* The robot, re-walking its odometry. Projected once per frame, not twice. */}
        {robotPos && <RobotMarker at={g.localToLngLat(robotPos)} />}

        <ScaleControl position="bottom-left" maxWidth={110} unit="metric" />

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
 * A surveyor's marker — the landing's route-plate flag, planted on the real
 * park: contact shadow on the ground, a fine ink stem, and a ringed head
 * numbered in typewriter. Hot markers breathe a sonar ring; markers the
 * replay hasn't reached yet print hollow — not happened yet.
 */
function SurveyMarker({
  index,
  ink,
  title,
  hasMusic,
  active,
  unreached,
  onHover,
  onOpen,
}: {
  index: number;
  ink: MomentInk;
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
      aria-label={`Moment ${index + 1}: ${title}. Open the splat.`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      onClick={onOpen}
      className="relative block cursor-pointer"
      style={{
        transform: active ? "scale(1.14)" : "scale(1)",
        transformOrigin: "bottom center",
        transition: "transform 0.3s var(--ease-signature)",
      }}
    >
      {/* Ground contact — a soft ellipse straddling the anchor point. */}
      <span
        aria-hidden
        className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 rounded-full"
        style={{ width: 15, height: 5, background: "rgb(27 27 24 / 0.3)", filter: "blur(1.6px)" }}
      />

      <span className="flex flex-col items-center">
        {/* The ringed head. */}
        <span
          className="relative grid place-items-center rounded-full"
          style={{
            width: 25,
            height: 25,
            background: unreached ? "rgb(255 251 240 / 0.94)" : ink.deep,
            boxShadow: unreached
              ? `inset 0 0 0 1.5px ${ink.deep}, 0 1px 3px rgb(27 27 24 / 0.22)`
              : `0 0 0 2px rgb(255 251 240 / 0.95), 0 2px 5px rgb(27 27 24 / 0.28)`,
          }}
        >
          {active && (
            <span
              aria-hidden
              className="sonar absolute inset-0 rounded-full"
              style={{ boxShadow: `0 0 0 1.5px ${ink.deep}` }}
            />
          )}
          <span
            className="fnote relative text-[10px] leading-none"
            style={{ color: unreached ? ink.deep : PAPER, letterSpacing: "0.02em" }}
          >
            {index + 1}
          </span>
        </span>
        {/* The stem, planted at the anchor. */}
        <span
          aria-hidden
          className="block"
          style={{
            width: 1.5,
            height: 13,
            background: ink.deep,
            opacity: unreached ? 0.55 : 0.9,
          }}
        />
      </span>

      {/* Hover label — a vellum slip pinned over the park. */}
      {active && (
        <span
          className="pointer-events-none absolute bottom-[calc(100%+9px)] left-1/2 flex w-max -translate-x-1/2 items-baseline gap-2 rounded-[6px] px-2.5 py-1.5"
          style={{
            background: "var(--color-vellum)",
            boxShadow: "var(--ring-ink), 0 8px 24px rgb(27 27 24 / 0.22)",
            animation: "takeover 0.3s var(--ease-signature) both",
          }}
        >
          <span className="fnote text-[9px]" style={{ color: ink.deep }}>
            [ {String(index + 1).padStart(3, "0")} ]
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
          className="fnote rounded-[5px] px-1.5 py-0.5 text-[9px]"
          style={{ color: PINE, background: "rgb(255 251 240 / 0.88)", boxShadow: "var(--ring-ink)" }}
        >
          [ {label} ]
        </span>
      </span>
    </Marker>
  );
}

function RobotMarker({ at }: { at: [number, number] }) {
  return (
    <Marker longitude={at[0]} latitude={at[1]} anchor="center" style={{ zIndex: 4 }}>
      <RobotDot />
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
