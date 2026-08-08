"use client";

/**
 * The trip map, drawn from robot odometry rather than map tiles.
 *
 * Two reasons this is not Leaflet: the robot navigates in its own local metric
 * frame (not lat/lng), and a hackathon demo should not depend on a tile server
 * being reachable. Swapping in MapLibre later means keeping the `{ path, moments }`
 * props and replacing the internals.
 *
 * The dwell segments are drawn brighter because they are load-bearing: where the
 * robot stopped is exactly where the `dwell` trigger fired, so this view and the
 * pipeline timeline are showing two faces of the same signal.
 *
 * The terrain backdrop fills the whole pane while the odometry drawing is centred
 * within it at a fixed aspect — so the map reads as a surface the path sits on,
 * and 50 m stays 50 m in both axes at any container width.
 */
import { useMemo } from "react";
import { MomentPin, MomentPinHalo } from "@/components/trip/MomentPin";
import { PIPELINE_CONFIG } from "@/lib/pipeline";
import { FOG, INK, MACHINE, STATE } from "@/lib/theme";
import type { MomentSummary } from "@/lib/tripData";
import type { TrackPoint, Vec2 } from "@/lib/types";

interface Props {
  path: TrackPoint[];
  moments: MomentSummary[];
  activeMomentId?: string | null;
  onHoverMoment?: (id: string | null) => void;
  onSelectMoment?: (id: string) => void;
  /** Optional extra marker — used by object search to show "the robot would go here". */
  navMarker?: { pos: Vec2; label: string } | null;
  /** Highlighted without being selected — the sidebar list hovering a moment. */
  selectedMomentId?: string | null;
  /**
   * Moments outside the time scrubber's window, faded rather than removed.
   *
   * Deliberately a dim-set instead of a filtered `moments` array: filtering would
   * make the map re-fit its bounds and jump on every frame of a scrubber drag.
   */
  dimmedMomentIds?: Set<string>;
  className?: string;
}

const PAD = 40;

export function TripMap({
  path,
  moments,
  activeMomentId,
  onHoverMoment,
  onSelectMoment,
  navMarker,
  selectedMomentId,
  dimmedMomentIds,
  className = "",
}: Props) {
  const geo = useMemo(() => {
    const xs = [...path.map((p) => p.pos[0]), ...moments.map((m) => m.placePos[0])];
    const ys = [...path.map((p) => p.pos[1]), ...moments.map((m) => m.placePos[1])];
    if (navMarker) {
      xs.push(navMarker.pos[0]);
      ys.push(navMarker.pos[1]);
    }
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const w = maxX - minX || 1;
    const h = maxY - minY || 1;

    // Fixed drawing box; scale uniformly so 10 m looks like 10 m in both axes.
    const boxW = 960;
    const boxH = Math.min(430, Math.max(280, Math.round((boxW * h) / w)));
    const scale = Math.min((boxW - PAD * 2) / w, (boxH - PAD * 2) / h);
    const offX = (boxW - w * scale) / 2;
    const offY = (boxH - h * scale) / 2;

    const project = (p: Vec2): Vec2 => [
      offX + (p[0] - minX) * scale,
      offY + (p[1] - minY) * scale,
    ];

    // Split the path into moving vs dwelling runs.
    const runs: Array<{ dwelling: boolean; pts: Vec2[] }> = [];
    for (const pt of path) {
      const dwelling = pt.speed < PIPELINE_CONFIG.dwellSpeedMps;
      const last = runs[runs.length - 1];
      const xy = project(pt.pos);
      if (last && last.dwelling === dwelling) last.pts.push(xy);
      else {
        // Bridge the gap so the line never visibly breaks at a state change.
        const seed = last ? [last.pts[last.pts.length - 1], xy] : [xy];
        runs.push({ dwelling, pts: seed });
      }
    }

    return { boxW, boxH, project, runs, scale };
  }, [path, moments, navMarker]);

  const toPoints = (pts: Vec2[]) =>
    pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const start = geo.project(path[0].pos);
  const end = geo.project(path[path.length - 1].pos);

  return (
    <div className={`relative overflow-hidden rounded-2xl ${className}`}>
      <TerrainBackdrop />

      <div className="absolute inset-0 flex items-center">
        <svg
          viewBox={`0 0 ${geo.boxW} ${geo.boxH}`}
          className="block h-auto w-full"
          role="img"
          aria-label={`Robot path through the trip with ${moments.length} captured moments marked`}
        >
          {/* Glows first, under the path — see the note in MomentPin. */}
          {moments.map((m) => (
            <MomentPinHalo
              key={`halo-${m.id}`}
              x={geo.project(m.placePos)[0]}
              y={geo.project(m.placePos)[1]}
              hasMusic={m.hasMusic}
              selected={selectedMomentId === m.id || activeMomentId === m.id}
            />
          ))}

          {/* Odometry. Moving = thin and dim; dwelling = thicker and lit, because
              a stop is what the dwell trigger keys on. */}
          {geo.runs.map((run, i) =>
            run.pts.length < 2 ? null : (
              <polyline
                key={i}
                points={toPoints(run.pts)}
                fill="none"
                stroke={run.dwelling ? MACHINE[400] : INK[500]}
                strokeWidth={run.dwelling ? 5 : 2.5}
                strokeOpacity={run.dwelling ? 0.9 : 1}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ),
          )}

          {/* It's a loop, so these two land almost on top of each other — push the
              labels to opposite sides so they never collide. */}
          <MapEndpoint x={start[0]} y={start[1]} label="start" side="below" />
          <MapEndpoint x={end[0]} y={end[1]} label="end" side="above" />

          {moments.map((m, i) => (
            <MomentPin
              key={m.id}
              x={geo.project(m.placePos)[0]}
              y={geo.project(m.placePos)[1]}
              index={i}
              label={m.title}
              hasMusic={m.hasMusic}
              dimmed={dimmedMomentIds?.has(m.id)}
              selected={selectedMomentId === m.id || activeMomentId === m.id}
              recent={i === moments.length - 1}
              onHover={(hovering) => onHoverMoment?.(hovering ? m.id : null)}
              onSelect={() => onSelectMoment?.(m.id)}
            />
          ))}

          {navMarker &&
            (() => {
              const [nx, ny] = geo.project(navMarker.pos);
              return <NavMarker x={nx} y={ny} label={navMarker.label} />;
            })()}

          <ScaleBar scale={geo.scale} y={geo.boxH - 18} />
        </svg>
      </div>

      <MapLegend />
    </div>
  );
}

/**
 * The design's "dark satellite" treatment: layered radial washes for terrain, a
 * coordinate grid, and faint contour lines. Purely decorative — it carries no
 * data, which is why it is separated from the SVG that does.
 */
function TerrainBackdrop() {
  return (
    <div
      className="grid-bg absolute inset-0"
      style={{
        background: `
          radial-gradient(ellipse 80% 60% at 30% 60%, rgba(20,60,54,0.55) 0%, transparent 60%),
          radial-gradient(ellipse 60% 70% at 70% 30%, rgba(20,30,60,0.5) 0%, transparent 50%),
          linear-gradient(160deg, #0c1a18 0%, #0b1420 42%, #0e0d1a 72%, #110b16 100%)
        `,
      }}
    >
      <svg
        className="absolute inset-0 h-full w-full opacity-[0.13]"
        viewBox="0 0 400 300"
        preserveAspectRatio="none"
        aria-hidden
      >
        <g fill="none" stroke={MACHINE[400]}>
          <path d="M0 150 Q100 100 200 140 T400 130" strokeWidth="1" strokeOpacity="0.9" />
          <path d="M0 180 Q80 140 180 165 T400 155" strokeWidth="1" strokeOpacity="0.7" />
          <path d="M0 120 Q120 80 220 115 T400 108" strokeWidth="0.5" strokeOpacity="0.5" />
          <path d="M50 0 Q80 80 60 160 T80 300" strokeWidth="0.5" strokeOpacity="0.4" />
          <path d="M200 0 Q230 100 210 200 T230 300" strokeWidth="0.5" strokeOpacity="0.4" />
        </g>
      </svg>
    </div>
  );
}

/** Drawn inside the SVG so 50 m is genuinely 50 m at any container width. */
function ScaleBar({ scale, y }: { scale: number; y: number }) {
  const w = 50 * scale;
  return (
    <g transform={`translate(${PAD}, ${y})`} className="select-none">
      <path
        d={`M0 -5 L0 0 L${w.toFixed(1)} 0 L${w.toFixed(1)} -5`}
        fill="none"
        stroke={FOG[400]}
        strokeWidth={1.5}
      />
      <text x={w / 2} y={-9} textAnchor="middle" fontSize={11} fill={FOG[400]} className="font-mono">
        50 m
      </text>
    </g>
  );
}

function MapEndpoint({
  x,
  y,
  label,
  side,
}: {
  x: number;
  y: number;
  label: string;
  side: "above" | "below";
}) {
  return (
    <g className="select-none">
      <circle cx={x} cy={y} r={4} fill={FOG[300]} fillOpacity={0.7} />
      <text
        x={x + 9}
        y={y + (side === "above" ? -8 : 15)}
        fontSize={12}
        fill={FOG[400]}
        className="font-mono"
      >
        {label}
      </text>
    </g>
  );
}

/** Where the robot would drive to, from an object-search result. */
function NavMarker({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <g className="select-none">
      <circle
        cx={x}
        cy={y}
        r={20}
        fill="none"
        stroke={STATE.signal}
        strokeWidth={2}
        strokeDasharray="4 4"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from={`0 ${x} ${y}`}
          to={`360 ${x} ${y}`}
          dur="9s"
          repeatCount="indefinite"
        />
      </circle>
      <circle cx={x} cy={y} r={5} fill={STATE.signal} />
      <text x={x} y={y - 28} textAnchor="middle" fontSize={13} fill={STATE.signal}>
        {label}
      </text>
    </g>
  );
}

function MapLegend() {
  return (
    <div className="glass pointer-events-none absolute right-3 top-3 space-y-1.5 rounded-xl px-3 py-2">
      <LegendRow swatch={<span className="h-2.5 w-2.5 rounded-full bg-machine-400" />} label="Moment" />
      <LegendRow
        swatch={<span className="h-2.5 w-2.5 rounded-full bg-memory-400" />}
        label="+ Music"
      />
      <LegendRow
        swatch={<span className="h-[4px] w-4 rounded-full bg-machine-400 opacity-90" />}
        label="Stopped"
      />
      <LegendRow
        swatch={<span className="h-[3px] w-4 rounded-full bg-ink-500" />}
        label="Walking"
      />
    </div>
  );
}

function LegendRow({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {swatch}
      <span className="font-mono text-[10px] text-fog-400">{label}</span>
    </div>
  );
}
