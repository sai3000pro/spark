"use client";

/**
 * A moment on the map. This is an SVG `<g>`, not a positioned div.
 *
 * The design draws pins as DOM elements over the map, which would mean measuring
 * the letterboxed SVG with a ResizeObserver to convert projected coordinates into
 * CSS percentages. That fails in a backgrounded tab — no rAF, so no observer
 * callback, so no pins — so the pulse is SMIL instead and the pin lives in the
 * same coordinate space as the path it sits on.
 *
 * Teal = a moment, amber = a moment with a track picked, as in the design's legend.
 * The index number is always inside the dot because it is what ties a pin to the
 * numbered sidebar list, and music additionally gets a ♪ badge so the amber is not
 * the only thing carrying that fact.
 *
 * The halo is a separate export (`MomentPinHalo`) so the map can paint every glow
 * BENEATH the odometry path. Drawn above it, the glow washes out the bright dwell
 * segment running into the pin, and that segment is the whole point — it is where
 * the robot stopped, which is what the dwell trigger fired on.
 */
import { INK, MACHINE, MEMORY } from "@/lib/theme";

const colorFor = (hasMusic: boolean) => (hasMusic ? MEMORY[400] : MACHINE[400]);
const radiusFor = (selected: boolean) => (selected ? 11 : 9);

export function MomentPinHalo({
  x,
  y,
  hasMusic,
  selected,
}: {
  x: number;
  y: number;
  hasMusic: boolean;
  selected: boolean;
}) {
  return (
    <circle
      cx={x}
      cy={y}
      r={radiusFor(selected) * 3.2}
      fill={colorFor(hasMusic)}
      opacity={selected ? 0.17 : 0.09}
    />
  );
}

interface Props {
  x: number;
  y: number;
  index: number;
  label: string;
  hasMusic: boolean;
  selected: boolean;
  /** Outside the time scrubber's window. Faded, but still hoverable and clickable. */
  dimmed?: boolean;
  /** The last moment of the trip pulses even when unselected, as in the design. */
  recent?: boolean;
  onHover?: (hovering: boolean) => void;
  onSelect?: () => void;
}

export function MomentPin({
  x,
  y,
  index,
  label,
  hasMusic,
  selected,
  dimmed,
  recent,
  onHover,
  onSelect,
}: Props) {
  const color = colorFor(hasMusic);
  const r = radiusFor(selected);

  return (
    <g
      className="cursor-pointer transition-opacity duration-200"
      opacity={dimmed ? 0.25 : 1}
      role="button"
      tabIndex={0}
      aria-label={`Moment ${index + 1}: ${label}${hasMusic ? ", has music" : ""}`}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.();
        }
      }}
    >
      {(selected || recent) && (
        <circle cx={x} cy={y} r={r} fill="none" stroke={color} strokeWidth={1.5}>
          <animate attributeName="r" values={`${r};${r * 2.8}`} dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.5;0" dur="2s" repeatCount="indefinite" />
        </circle>
      )}

      <circle
        cx={x}
        cy={y}
        r={r}
        fill={color}
        stroke="rgba(255,255,255,0.9)"
        strokeWidth={selected ? 2.5 : 1.5}
      />

      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={selected ? 11 : 10}
        fontWeight={700}
        fill={INK[950]}
        className="pointer-events-none select-none font-mono"
      >
        {index + 1}
      </text>

      {hasMusic && (
        <g className="pointer-events-none select-none">
          <circle
            cx={x + r * 0.82}
            cy={y - r * 0.82}
            r={5.2}
            fill={MEMORY[300]}
            stroke={INK[950]}
            strokeWidth={1.2}
          />
          <text
            x={x + r * 0.82}
            y={y - r * 0.82 + 0.4}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={7}
            fill={INK[950]}
          >
            ♪
          </text>
        </g>
      )}

      {selected && (
        <g className="pointer-events-none">
          <rect
            x={x - Math.max(32, label.length * 3.4)}
            y={y - r - 27}
            width={Math.max(64, label.length * 6.8)}
            height={19}
            rx={6}
            fill="rgba(9,9,14,0.95)"
            stroke="rgba(255,255,255,0.12)"
          />
          <text
            x={x}
            y={y - r - 17.2}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={11}
            fill="#e8e6f0"
            className="select-none"
          >
            {label}
          </text>
        </g>
      )}
    </g>
  );
}
