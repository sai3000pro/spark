"use client";

/**
 * The atlas: the whole day as a full-screen risograph park map.
 *
 * Drawn from robot odometry rather than map tiles — the robot navigates in its
 * own local metric frame, and a demo should not depend on a tile server. The
 * terrain is printed FROM the data: each moment's placeLabel stamps a themed
 * landmark (water → a lake, lookout → contour rings, snack bar → a kiosk), so
 * the illustration is a caricature of the real walk, not wallpaper.
 *
 * The map measures its container and re-projects on resize, so the walk always
 * fills the screen edge-to-edge at true aspect (10 m is 10 m in both axes).
 *
 * Splat pins are the point of the whole app: big numbered stickers, one drum
 * ink each. Click one and the moment expands into its Gaussian splat.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { makeRng, rngRange } from "@/lib/mock/rng";
import {
  CORAL,
  CREAM_BRIGHT,
  INK,
  INK_FAINT,
  MUSTARD,
  ROSE,
  SKY,
  TEAL,
  VIOLET,
  inkForMoment,
  type RisoInk,
} from "@/lib/theme";
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

export function AtlasMap({ path, moments, activeId, reachedT, robotPos, onHover, onOpen }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1280, h: 800 });

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => {
    const pad = Math.max(64, Math.min(size.w, size.h) * 0.14);
    const xs = [...path.map((p) => p.pos[0]), ...moments.map((m) => m.placePos[0])];
    const ys = [...path.map((p) => p.pos[1]), ...moments.map((m) => m.placePos[1])];
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const w = maxX - minX || 1;
    const h = maxY - minY || 1;
    const scale = Math.min((size.w - pad * 2) / w, (size.h - pad * 2) / h);
    const offX = (size.w - w * scale) / 2;
    const offY = (size.h - h * scale) / 2;

    const project = (p: Vec2): Vec2 => [offX + (p[0] - minX) * scale, offY + (p[1] - minY) * scale];
    const route = path
      .map((p, i) => `${i === 0 ? "M" : "L"}${project(p.pos)[0].toFixed(1)} ${project(p.pos)[1].toFixed(1)}`)
      .join("");

    return { project, route, scale };
  }, [path, moments, size]);

  const start = geo.project(path[0].pos);
  const end = geo.project(path[path.length - 1].pos);

  return (
    <div ref={wrap} className="grained grained-heavy absolute inset-0 overflow-hidden bg-cream">
      <svg width={size.w} height={size.h} className="absolute inset-0" role="img"
        aria-label={`Map of the day's walk with ${moments.length} captured moments pinned`}
      >
        <Terrain size={size} moments={moments} project={geo.project} scale={geo.scale} />

        {/* The walk: cream casing under an ink line that draws itself. */}
        <path
          d={geo.route}
          fill="none"
          stroke={CREAM_BRIGHT}
          strokeWidth={11}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.85}
        />
        <path
          d={geo.route}
          fill="none"
          stroke={INK}
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={1}
          pathLength={1}
          style={{ animation: "draw-route 2.6s var(--ease-swift) 0.15s both" }}
        />

        <Flag x={start[0]} y={start[1]} label="START" />
        <Flag x={end[0]} y={end[1]} label="END" hollow />

        {moments.map((m, i) => {
          const [x, y] = geo.project(m.placePos);
          return (
            <SplatPin
              key={m.id}
              x={x}
              y={y}
              index={i}
              ink={inkForMoment(i)}
              title={m.title}
              hasMusic={m.hasMusic}
              active={activeId === m.id}
              unreached={reachedT !== null && m.tStart > reachedT}
              onHover={(h) => onHover(h ? m.id : null)}
              onOpen={() => onOpen(m.id)}
            />
          );
        })}

        {robotPos && <Robot xy={geo.project(robotPos)} />}

        <ScaleBar scale={geo.scale} x={24} y={size.h - 26} />
        <NorthArrow x={size.w - 46} y={size.h - 60} />
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Terrain — landmarks stamped from the moments' own placeLabels.
// ─────────────────────────────────────────────────────────────────────────────

function Terrain({
  size,
  moments,
  project,
  scale,
}: {
  size: { w: number; h: number };
  moments: MomentSummary[];
  project: (p: Vec2) => Vec2;
  scale: number;
}) {
  const decor = useMemo(() => {
    const r = makeRng(77);
    // Meadow blobs scattered around the frame so the cream never feels empty.
    const meadows = Array.from({ length: 7 }, () => ({
      x: rngRange(r, -0.05, 1.05) * size.w,
      y: rngRange(r, -0.05, 1.05) * size.h,
      rx: rngRange(r, 70, 190),
      ry: rngRange(r, 50, 130),
      rot: rngRange(r, -30, 30),
      fill: [TEAL.soft, MUSTARD.soft, SKY.soft][Math.floor(rngRange(r, 0, 2.99))],
    }));
    // Tree dots in little clusters.
    const trees: Array<{ x: number; y: number; r: number; fill: string }> = [];
    for (let c = 0; c < 9; c++) {
      const cx = rngRange(r, 0.04, 0.96) * size.w;
      const cy = rngRange(r, 0.04, 0.96) * size.h;
      const n = Math.round(rngRange(r, 2, 5));
      for (let i = 0; i < n; i++) {
        trees.push({
          x: cx + rngRange(r, -46, 46),
          y: cy + rngRange(r, -34, 34),
          r: rngRange(r, 6, 15),
          fill: Math.floor(rngRange(r, 0, 1.99)) === 0 ? TEAL.base : TEAL.deep,
        });
      }
    }
    return { meadows, trees };
  }, [size]);

  return (
    <g>
      {decor.meadows.map((m, i) => (
        <ellipse
          key={`m${i}`}
          cx={m.x}
          cy={m.y}
          rx={m.rx}
          ry={m.ry}
          fill={m.fill}
          opacity={0.5}
          transform={`rotate(${m.rot} ${m.x} ${m.y})`}
        />
      ))}

      {moments.map((m, i) => (
        <Landmark key={m.id} label={m.placeLabel} xy={project(m.placePos)} scale={scale} seed={i} />
      ))}

      {decor.trees.map((t, i) => (
        <circle key={`t${i}`} cx={t.x} cy={t.y} r={t.r} fill={t.fill} opacity={0.55} />
      ))}
    </g>
  );
}

/** One landmark, themed off the words in the place label. */
function Landmark({
  label,
  xy: [x, y],
  scale,
  seed,
}: {
  label: string;
  xy: Vec2;
  scale: number;
  seed: number;
}) {
  const l = label.toLowerCase();
  const r = makeRng(seed * 131 + 7);
  const u = Math.max(26, scale * 14); // landmark unit, keeps stamps proportionate

  if (/(water|lake|shore|pond|river)/.test(l)) {
    // A lake with squiggle waves.
    return (
      <g>
        <ellipse cx={x - u * 0.5} cy={y + u * 0.55} rx={u * 2.4} ry={u * 1.5} fill={SKY.base} opacity={0.8} />
        <ellipse cx={x - u * 0.5} cy={y + u * 0.55} rx={u * 1.7} ry={u * 1.0} fill={SKY.soft} opacity={0.85} />
        {[0.15, 0.55, 0.95].map((dy, i) => (
          <path
            key={i}
            d={`M${x - u * 1.5} ${y + u * dy} q ${u * 0.35} ${-u * 0.22} ${u * 0.7} 0 t ${u * 0.7} 0`}
            fill="none"
            stroke={SKY.deep}
            strokeWidth={2.5}
            strokeLinecap="round"
            opacity={0.75}
          />
        ))}
      </g>
    );
  }
  if (/(green|lawn|field|frisbee|open)/.test(l)) {
    return (
      <g>
        <ellipse cx={x + u * 0.4} cy={y + u * 0.4} rx={u * 2.1} ry={u * 1.3} fill={TEAL.soft} opacity={0.9} />
        {Array.from({ length: 5 }, (_, i) => (
          <path
            key={i}
            d={`M${x + rngRange(r, -u * 1.4, u * 1.6)} ${y + rngRange(r, -u * 0.3, u * 1.1)} l 5 -9 l 5 9`}
            fill="none"
            stroke={TEAL.deep}
            strokeWidth={2}
            strokeLinecap="round"
            opacity={0.7}
          />
        ))}
      </g>
    );
  }
  if (/(bench|bandstand|stage)/.test(l)) {
    return (
      <g>
        <circle cx={x + u * 0.6} cy={y + u * 0.5} r={u * 1.15} fill={MUSTARD.soft} opacity={0.9} />
        <circle cx={x + u * 0.6} cy={y + u * 0.5} r={u * 0.55} fill="none" stroke={MUSTARD.deep} strokeWidth={2.5} strokeDasharray="1 7" strokeLinecap="round" />
        <circle cx={x + u * 0.6} cy={y + u * 0.5} r={u * 0.18} fill={MUSTARD.base} stroke={INK} strokeWidth={1.5} />
      </g>
    );
  }
  if (/(pavilion|steps|plaza)/.test(l)) {
    return (
      <g transform={`rotate(-8 ${x} ${y})`}>
        <rect x={x - u * 1.3} y={y + u * 0.15} width={u * 2.1} height={u * 1.35} rx={u * 0.28} fill={ROSE.soft} opacity={0.92} />
        {[0.42, 0.72, 1.02].map((dy, i) => (
          <line key={i} x1={x - u * 1.0} y1={y + u * dy} x2={x + u * 0.5} y2={y + u * dy} stroke={ROSE.deep} strokeWidth={2.5} strokeLinecap="round" opacity={0.7} />
        ))}
      </g>
    );
  }
  if (/(snack|fries|picnic|food|bar)/.test(l)) {
    return (
      <g transform={`rotate(6 ${x} ${y})`}>
        <rect x={x + u * 0.25} y={y - u * 1.4} width={u * 1.2} height={u * 1.1} rx={u * 0.2} fill={CORAL.soft} opacity={0.95} />
        <path d={`M${x + u * 0.15} ${y - u * 1.42} h ${u * 1.4} l ${-u * 0.18} ${-u * 0.42} h ${-u * 1.04} z`} fill={CORAL.base} stroke={INK} strokeWidth={1.5} />
        <circle cx={x + u * 0.85} cy={y - u * 0.85} r={u * 0.14} fill={CORAL.deep} />
      </g>
    );
  }
  if (/(hill|lookout|summit|view)/.test(l)) {
    return (
      <g>
        {[1.9, 1.4, 0.9, 0.45].map((k, i) => (
          <ellipse
            key={i}
            cx={x - u * 0.4}
            cy={y - u * 0.35}
            rx={u * k}
            ry={u * k * 0.62}
            fill={i === 3 ? VIOLET.soft : "none"}
            stroke={VIOLET.base}
            strokeWidth={2.5}
            opacity={0.55 + i * 0.12}
          />
        ))}
      </g>
    );
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Marks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A splat pin: the numbered sticker you click to step into the moment.
 * Unreached pins (during a replay) print as outlines — not happened yet.
 */
function SplatPin({
  x,
  y,
  index,
  ink,
  title,
  hasMusic,
  active,
  unreached,
  onHover,
  onOpen,
}: {
  x: number;
  y: number;
  index: number;
  ink: RisoInk;
  title: string;
  hasMusic: boolean;
  active: boolean;
  unreached: boolean;
  onHover: (h: boolean) => void;
  onOpen: () => void;
}) {
  const R = 19;
  const labelW = Math.max(120, title.length * 8.2 + 66);

  return (
    <g
      className="cursor-pointer"
      role="button"
      tabIndex={0}
      aria-label={`Moment ${index + 1}: ${title}. Open the splat.`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      {active && !unreached && (
        <circle cx={x} cy={y} r={R} fill="none" stroke={ink.base} strokeWidth={2.5}>
          <animate attributeName="r" values={`${R};${R * 2.4}`} dur="1.6s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.6;0" dur="1.6s" repeatCount="indefinite" />
        </circle>
      )}

      <g
        style={{
          transformBox: "fill-box",
          transformOrigin: "center",
          transform: active ? "scale(1.16)" : unreached ? "scale(0.82)" : "scale(1)",
          transition: "transform 0.25s var(--ease-pop)",
        }}
      >
        <circle cx={x} cy={y} r={R + 3.5} fill={CREAM_BRIGHT} stroke={INK} strokeWidth={1.5} />
        <circle
          cx={x}
          cy={y}
          r={R - 1.5}
          fill={unreached ? CREAM_BRIGHT : ink.base}
          stroke={unreached ? ink.base : INK}
          strokeWidth={unreached ? 2.5 : 1.5}
        />
        <text
          x={x}
          y={y + 0.5}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={14}
          fontWeight={700}
          fontFamily="var(--font-mono)"
          fill={unreached ? ink.deep : CREAM_BRIGHT}
          className="pointer-events-none select-none"
        >
          {String(index + 1).padStart(2, "0")}
        </text>

        {hasMusic && !unreached && (
          <g className="pointer-events-none">
            <circle cx={x + R * 0.85} cy={y - R * 0.85} r={7.5} fill={INK} stroke={CREAM_BRIGHT} strokeWidth={1.5} />
            <text x={x + R * 0.85} y={y - R * 0.85 + 0.5} textAnchor="middle" dominantBaseline="central" fontSize={8.5} fill={MUSTARD.base}>
              ♪
            </text>
          </g>
        )}
      </g>

      {active && (
        <g className="pointer-events-none" style={{ animation: "pop-in 0.3s var(--ease-pop) both" }}>
          <rect x={x - labelW / 2} y={y - R - 46} width={labelW} height={34} rx={10} fill={CREAM_BRIGHT} stroke={INK} strokeWidth={1.5} />
          <text x={x} y={y - R - 33} textAnchor="middle" fontSize={12.5} fontWeight={700} fontFamily="var(--font-display)" fill={INK} className="select-none">
            {title}
          </text>
          <text x={x} y={y - R - 19} textAnchor="middle" fontSize={8.5} fontFamily="var(--font-mono)" letterSpacing={1} fill={INK_FAINT} className="select-none">
            CLICK TO STEP INSIDE
          </text>
        </g>
      )}
    </g>
  );
}

/** The robot, re-walking its path during a replay. */
function Robot({ xy: [x, y] }: { xy: Vec2 }) {
  return (
    <g className="pointer-events-none">
      <circle cx={x} cy={y} r={17} fill={MUSTARD.base} opacity={0.28} />
      <circle cx={x} cy={y} r={14} fill="none" stroke={INK} strokeWidth={2} strokeDasharray="4 5">
        <animateTransform attributeName="transform" type="rotate" from={`0 ${x} ${y}`} to={`360 ${x} ${y}`} dur="5s" repeatCount="indefinite" />
      </circle>
      <circle cx={x} cy={y} r={7.5} fill={INK} stroke={CREAM_BRIGHT} strokeWidth={2} />
      <path
        d={`M${x} ${y - 4.4} L${x + 1.2} ${y - 1.2} L${x + 4.4} ${y} L${x + 1.2} ${y + 1.2} L${x} ${y + 4.4} L${x - 1.2} ${y + 1.2} L${x - 4.4} ${y} L${x - 1.2} ${y - 1.2} Z`}
        fill={MUSTARD.base}
      />
    </g>
  );
}

function Flag({ x, y, label, hollow }: { x: number; y: number; label: string; hollow?: boolean }) {
  return (
    <g className="select-none pointer-events-none">
      <line x1={x} y1={y} x2={x} y2={y - 22} stroke={INK} strokeWidth={2.5} strokeLinecap="round" />
      <path
        d={`M${x} ${y - 22} h 16 l -5 5 l 5 5 h -16 z`}
        fill={hollow ? CREAM_BRIGHT : INK}
        stroke={INK}
        strokeWidth={1.5}
      />
      <circle cx={x} cy={y} r={4} fill={INK} />
      <text x={x + 22} y={y - 10} fontSize={9} fontFamily="var(--font-mono)" fontWeight={700} letterSpacing={1.5} fill={INK_FAINT}>
        {label}
      </text>
    </g>
  );
}

/** Genuinely 50 m at any screen size, since it lives in projected units. */
function ScaleBar({ scale, x, y }: { scale: number; x: number; y: number }) {
  const w = 50 * scale;
  return (
    <g className="select-none pointer-events-none">
      <path d={`M${x} ${y - 5} L${x} ${y} L${x + w} ${y} L${x + w} ${y - 5}`} fill="none" stroke={INK_FAINT} strokeWidth={2} />
      <text x={x + w / 2} y={y - 10} textAnchor="middle" fontSize={10} fontWeight={700} fontFamily="var(--font-mono)" fill={INK_FAINT}>
        50 M
      </text>
    </g>
  );
}

function NorthArrow({ x, y }: { x: number; y: number }) {
  return (
    <g className="select-none pointer-events-none">
      <circle cx={x} cy={y} r={17} fill={CREAM_BRIGHT} stroke={INK} strokeWidth={1.5} />
      <path d={`M${x} ${y - 11} L${x + 5} ${y + 3} L${x} ${y} L${x - 5} ${y + 3} Z`} fill={CORAL.base} stroke={INK} strokeWidth={1} />
      <text x={x} y={y + 11} textAnchor="middle" fontSize={8} fontWeight={700} fontFamily="var(--font-mono)" fill={INK}>
        N
      </text>
    </g>
  );
}
