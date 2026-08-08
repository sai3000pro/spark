"use client";

/**
 * The walk on the REAL park.
 *
 * MapLibre renders actual Waterloo Park vector tiles restyled into twilight
 * (public/map/night-walk.json — generated, never hand-edited), and the robot's
 * odometry is georeferenced onto it (lib/geo.ts). The walk draws as a ribbon
 * of light — a wide ember glow under a crisp gold core — and every kept moment
 * is a numbered light-marker that expands into its splat.
 *
 * During a replay the ribbon fills gold up to the playhead while the full
 * route waits underneath as a faint trace; markers past the playhead haven't
 * "happened yet" and print as outlines. The camera opens tilted (pitch 48) so
 * the park reads as a place, not a diagram.
 */
import { useCallback, useMemo, useRef } from "react";
import { setWorkerUrl } from "maplibre-gl";
import MapGL, { Layer, Marker, Source, type MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

// MapLibre v6 ships its tile worker as a separate module that Turbopack's
// `new Worker(new URL(...))` handling misses — without this the style never
// finishes loading and not a single tile is requested. The worker files are
// copied into public/map-lib by scripts/copy-maplibre-worker.mjs (predev/prebuild).
if (typeof window !== "undefined") {
  setWorkerUrl("/map-lib/maplibre-gl-worker.mjs");
}
import { localToLngLat, tripBounds } from "@/lib/geo";
import { EMBER, GOLD, NIGHT, STARLIGHT, inkForMoment, type MomentInk } from "@/lib/theme";
import type { MomentSummary } from "@/lib/tripData";
import type { TrackPoint, Vec2 } from "@/lib/types";

interface Props {
  path: TrackPoint[];
  moments: MomentSummary[];
  activeId: string | null;
  /** Playhead time — pins after it haven't "happened yet" during a replay. */
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

export function NightMap({ path, moments, activeId, reachedT, robotPos, onHover, onOpen }: Props) {
  const mapRef = useRef<MapRef>(null);

  const routeCoords = useMemo(() => path.map((p) => localToLngLat(p.pos)), [path]);
  const bounds = useMemo(
    () => tripBounds([...path.map((p) => p.pos), ...moments.map((m) => m.placePos)]),
    [path, moments],
  );

  /** The replayed portion — the light the robot has re-earned so far. */
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
    <div className="absolute inset-0 overflow-hidden bg-night">
      <MapGL
        ref={mapRef}
        mapStyle="/map/night-walk.json"
        initialViewState={{ longitude: center[0], latitude: center[1], zoom: 15.4, pitch: 48, bearing: -14 }}
        onLoad={fit}
        onResize={fit}
        minZoom={13.5}
        maxZoom={18.5}
        attributionControl={{ compact: true }}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      >
        {/* The full walk — a faint trace waiting to be re-earned. */}
        <Source id="route-all" type="geojson" data={line(routeCoords)}>
          <Layer
            id="route-trace"
            type="line"
            paint={{
              "line-color": EMBER,
              "line-width": 2,
              "line-opacity": reachedT === null ? 0 : 0.25,
            }}
            layout={{ "line-cap": "round", "line-join": "round" }}
          />
        </Source>

        {/* The ribbon of light: wide ember glow under a crisp gold core. */}
        <Source id="route-lit" type="geojson" data={line(reachedCoords)}>
          <Layer
            id="route-glow"
            type="line"
            paint={{ "line-color": EMBER, "line-width": 13, "line-blur": 9, "line-opacity": 0.5 }}
            layout={{ "line-cap": "round", "line-join": "round" }}
          />
          <Layer
            id="route-core"
            type="line"
            paint={{ "line-color": GOLD, "line-width": 2.4, "line-opacity": 0.95 }}
            layout={{ "line-cap": "round", "line-join": "round" }}
          />
        </Source>

        {/* Trailheads. */}
        <TrailheadMarker at={routeCoords[0]} label="Start" />
        <TrailheadMarker at={routeCoords[routeCoords.length - 1]} label="End" hollow />

        {/* The kept moments — numbered pins on the park. */}
        {moments.map((m, i) => {
          const [lng, lat] = localToLngLat(m.placePos);
          return (
            <Marker key={m.id} longitude={lng} latitude={lat} anchor="bottom" style={{ zIndex: activeId === m.id ? 3 : 2 }}>
              <PinMarker
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

        {/* The robot, re-walking its odometry. */}
        {robotPos && (
          <Marker longitude={localToLngLat(robotPos)[0]} latitude={localToLngLat(robotPos)[1]} anchor="center" style={{ zIndex: 4 }}>
            <RobotDot />
          </Marker>
        )}
      </MapGL>

      {/* The night air: grain + vignette over the tiles, under the chrome. */}
      <div className="starfield pointer-events-none absolute inset-0" aria-hidden />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `linear-gradient(180deg, rgb(15 13 35 / 0.6) 0%, rgb(15 13 35 / 0) 16%, rgb(15 13 35 / 0) 70%, rgb(15 13 35 / 0.72) 100%),
            radial-gradient(120% 90% at 50% 50%, rgb(15 13 35 / 0) 58%, rgb(15 13 35 / 0.42) 100%)`,
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Marks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A map pin in the classic teardrop shape — the moment's ink, a dark number,
 * a hairline night outline so it separates from any tile underneath. Dimmed
 * to an outline while unreached during a replay — not happened yet.
 */
function PinMarker({
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
      className="relative block"
      style={{
        transform: active ? "scale(1.12)" : "scale(1)",
        transformOrigin: "bottom center",
        transition: "transform 0.3s var(--ease-signature)",
      }}
    >
      <svg
        width={30}
        height={40}
        viewBox="0 0 30 40"
        aria-hidden
        style={{
          display: "block",
          filter: active
            ? `drop-shadow(0 2px 3px rgb(6 5 18 / 0.55)) drop-shadow(0 0 10px ${ink.glow})`
            : "drop-shadow(0 2px 3px rgb(6 5 18 / 0.55))",
        }}
      >
        <path
          d="M15 1.5c-7.32 0-13 5.72-13 12.8 0 4.9 3.05 9.5 6.1 13.06 2.35 2.74 4.9 5.62 6.9 10.14 2-4.52 4.55-7.4 6.9-10.14 3.05-3.56 6.1-8.16 6.1-13.06 0-7.08-5.68-12.8-13-12.8Z"
          fill={unreached ? NIGHT : ink.base}
          stroke={unreached ? ink.base : "rgb(15 13 35 / 0.75)"}
          strokeWidth={1.5}
          opacity={unreached ? 0.85 : 1}
        />
        <text
          x={15}
          y={19.5}
          textAnchor="middle"
          fontSize={12.5}
          fontWeight={650}
          fontFamily="var(--font-sans)"
          fill={unreached ? ink.base : NIGHT}
        >
          {index + 1}
        </text>
      </svg>

      {/* Hover label — a small plate floating over the park. */}
      {active && (
        <span
          className="tag pointer-events-none absolute bottom-[46px] left-1/2 w-max -translate-x-1/2 rounded-[6px] px-2.5 py-1.5 text-[11.5px] font-semibold"
          style={{
            background: "rgb(31 27 64 / 0.96)",
            color: STARLIGHT,
            boxShadow: "var(--ring), 0 8px 24px rgb(6 5 18 / 0.6)",
            animation: "takeover 0.3s var(--ease-signature) both",
          }}
        >
          {title}
          <span className="ml-1.5 font-medium text-faint">
            {hasMusic ? "· scored · step inside" : "· step inside"}
          </span>
        </span>
      )}
    </button>
  );
}

function TrailheadMarker({ at, label, hollow }: { at: [number, number]; label: string; hollow?: boolean }) {
  // Start stacks its label above the dot, End below — the two trailheads sit
  // metres apart and their labels collide otherwise.
  return (
    <Marker longitude={at[0]} latitude={at[1]} anchor="center" offset={hollow ? [0, 14] : [0, -14]} style={{ zIndex: 1 }}>
      <span className={`pointer-events-none flex items-center gap-1.5 ${hollow ? "flex-col" : "flex-col-reverse"}`}>
        <span
          aria-hidden
          className="block rounded-full"
          style={{
            width: 9,
            height: 9,
            background: hollow ? NIGHT : GOLD,
            boxShadow: hollow ? `0 0 0 2px ${GOLD}` : "0 0 0 1.5px rgb(15 13 35 / 0.7)",
          }}
        />
        <span
          className="tag rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold"
          style={{ color: GOLD, background: "rgb(15 13 35 / 0.75)" }}
        >
          {label}
        </span>
      </span>
    </Marker>
  );
}

/** The robot re-walking the path — a warm light moving through the dark. */
function RobotDot() {
  return (
    <span className="pointer-events-none relative grid place-items-center" style={{ width: 40, height: 40 }}>
      <span
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{
          background: "radial-gradient(circle, rgb(255 196 107 / 0.35) 0%, rgb(0 0 0 / 0) 70%)",
          animation: "glow-breathe 1.4s ease-in-out infinite",
        }}
      />
      <span
        className="relative block rounded-full"
        style={{
          width: 14,
          height: 14,
          background: GOLD,
          boxShadow: "0 0 0 2.5px rgb(15 13 35 / 0.9), 0 0 0 4px rgb(255 196 107 / 0.5)",
        }}
      />
    </span>
  );
}
