"use client";

/**
 * The globe, flattened — for browsers with no WebGL.
 *
 * Not an apology screen. It samples the SAME land mask, renders with the same
 * dot-matrix idea, and uses the same pin language as TripMap's SVG. It renders on
 * the server, costs ~90 lines, and it is also what saves this screen if the
 * browser has run out of WebGL contexts (which the phone-preview iframe can
 * genuinely cause, since it opens a second one).
 */
import { useMemo } from "react";
import { getLandMask, isLand } from "@/lib/globe/mask";
import { FOG, INK, MEMORY } from "@/lib/theme";
import type { GlobePin } from "@/lib/globeData";

const COLS = 180;
const ROWS = 90;

interface Props {
  pins: GlobePin[];
  hoveredKey: string | null;
  selectedKey: string | null;
  onHover: (key: string | null) => void;
  onSelect: (key: string) => void;
}

export function GlobeFlat({ pins, hoveredKey, selectedKey, onHover, onSelect }: Props) {
  const dots = useMemo(() => {
    const mask = getLandMask();
    const out: Array<[number, number]> = [];
    for (let row = 0; row < ROWS; row++) {
      const lat = 90 - ((row + 0.5) / ROWS) * 180;
      for (let col = 0; col < COLS; col++) {
        const lng = -180 + ((col + 0.5) / COLS) * 360;
        if (isLand(mask, lat, lng)) out.push([col, row]);
      }
    }
    return out;
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl bg-ink-950">
      <svg
        viewBox={`0 0 ${COLS} ${ROWS}`}
        className="h-full w-full"
        role="img"
        aria-label={`Flat world map with ${pins.length} places marked`}
      >
        <rect width={COLS} height={ROWS} fill={INK[950]} />

        {dots.map(([col, row], i) => (
          <circle key={i} cx={col + 0.5} cy={row + 0.5} r={0.34} fill={FOG[400]} opacity={0.5} />
        ))}

        {/* Equator, same INK[500] hairline as the 3D bezel. */}
        <line x1={0} y1={ROWS / 2} x2={COLS} y2={ROWS / 2} stroke={INK[500]} strokeWidth={0.2} />

        {pins.map((pin) => {
          const x = ((pin.origin.lng + 180) / 360) * COLS;
          const y = ((90 - pin.origin.lat) / 180) * ROWS;
          const on = hoveredKey === pin.key || selectedKey === pin.key;
          return (
            <g
              key={pin.key}
              className="cursor-pointer"
              role="button"
              tabIndex={0}
              aria-label={`${pin.albums.length} album${pin.albums.length === 1 ? "" : "s"} at ${pin.albums[0].placeLabel}`}
              onMouseEnter={() => onHover(pin.key)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onSelect(pin.key)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(pin.key);
                }
              }}
            >
              <circle cx={x} cy={y} r={on ? 3.2 : 2.2} fill={MEMORY[300]} opacity={on ? 0.3 : 0.16} />
              <circle
                cx={x}
                cy={y}
                r={on ? 1.5 : 1.15}
                fill={MEMORY[400]}
                stroke={INK[950]}
                strokeWidth={0.3}
              />
            </g>
          );
        })}
      </svg>

      <span className="pointer-events-none absolute bottom-2 right-3 font-mono text-[10px] text-fog-400">
        WebGL unavailable — flat projection
      </span>
    </div>
  );
}
