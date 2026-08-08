"use client";

/**
 * Filter the album by time.
 *
 * Deliberately NOT a generic range slider: the track is the Timeline tab's own
 * detection-density data at a tenth of the height, drawn with the same validated
 * `densityColor` ramp. That is what makes the Moments tab and the Timeline tab
 * feel like two views of one dataset rather than two widgets that happen to share
 * a page.
 *
 * Controlled — TripExplorer owns `window` alongside hoveredId/selectedId, so the
 * grid, the map and the panel all react to a drag together.
 *
 * ~90 lines of pointer events and no drag library. `setPointerCapture` is what
 * makes a drag survive the cursor leaving the element, which is the only genuinely
 * fiddly part.
 */
import { useRef, useState } from "react";
import { clockTime } from "@/lib/format";
import { densityColor } from "@/lib/mock/labels";
import type { DetectionBin } from "@/lib/pipeline";
import type { MomentSummary } from "@/lib/tripData";

interface Props {
  bins: DetectionBin[];
  moments: MomentSummary[];
  durationSec: number;
  tripStartedAt: string;
  window: [number, number] | null;
  onChange: (window: [number, number] | null) => void;
}

type DragKind = "start" | "end" | "middle";

/** Arrow keys move by a minute — a useful step on a 40–95 minute trip. */
const KEY_STEP_SEC = 60;

/**
 * Where along the track a pointer is, in trip seconds.
 *
 * Takes the ELEMENT rather than the ref, and lives at module scope rather than in
 * a useCallback, so that handlers below can stay plain function references. The
 * react-hooks/refs rule flags a ref captured by a closure that JSX invokes during
 * render, which is exactly what `onPointerDown={makeHandler("start")}` would be.
 */
function secondsAt(track: HTMLElement | null, clientX: number, durationSec: number): number {
  const rect = track?.getBoundingClientRect();
  if (!rect || rect.width === 0) return 0;
  const ratio = (clientX - rect.left) / rect.width;
  return Math.min(durationSec, Math.max(0, ratio * durationSec));
}

/** Which control a pointer/key event came from, read off the DOM node. */
const kindOf = (el: HTMLElement): DragKind | null =>
  (el.dataset.drag as DragKind | undefined) ?? null;

export function TimeScrubber({
  bins,
  moments,
  durationSec,
  tripStartedAt,
  window,
  onChange,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: DragKind; grabSec: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const [start, end] = window ?? [0, durationSec];
  const filtered = !!window;
  const maxCount = Math.max(1, ...bins.map((b) => b.count));

  // Keep a minimum span so the handles can never cross or stack.
  const minSpan = Math.max(30, durationSec * 0.02);

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    const kind = kindOf(e.currentTarget);
    if (!kind) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind, grabSec: secondsAt(trackRef.current, e.clientX, durationSec) };
    setDragging(true);
    if (!window) onChange([0, durationSec]);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state) return;

    const at = secondsAt(trackRef.current, e.clientX, durationSec);

    if (state.kind === "start") {
      onChange([Math.min(at, end - minSpan), end]);
    } else if (state.kind === "end") {
      onChange([start, Math.max(at, start + minSpan)]);
    } else {
      const delta = at - state.grabSec;
      const span = end - start;
      const nextStart = Math.min(Math.max(0, start + delta), durationSec - span);
      drag.current = { ...state, grabSec: at };
      onChange([nextStart, nextStart + span]);
    }
  };

  const endDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    drag.current = null;
    setDragging(false);
  };

  const onHandleKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      onChange(null);
      return;
    }
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    if (kindOf(e.currentTarget) === "start") {
      onChange([Math.min(Math.max(0, start + dir * KEY_STEP_SEC), end - minSpan), end]);
    } else {
      onChange([start, Math.max(Math.min(durationSec, end + dir * KEY_STEP_SEC), start + minSpan)]);
    }
  };

  const pct = (t: number) => `${(t / durationSec) * 100}%`;
  const visible = moments.filter((m) => m.tEnd >= start && m.tStart <= end).length;

  return (
    <div className="surface rounded-2xl px-3 py-2.5">
      <div
        ref={trackRef}
        className="relative h-10 w-full cursor-pointer touch-none select-none"
        onDoubleClick={() => onChange(null)}
      >
        {/* Detection density — the Timeline tab's lane 1, shrunk. */}
        <svg
          viewBox={`0 0 ${bins.length} 100`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          aria-hidden
        >
          {bins.map((bin, i) => {
            const h = (bin.count / maxCount) * 100;
            return (
              <rect
                key={i}
                x={i}
                y={100 - h}
                width={1}
                height={h}
                fill={densityColor(bin.count, maxCount)}
                opacity={0.55}
              />
            );
          })}
        </svg>

        {/* Everything outside the window, veiled. */}
        {filtered && (
          <>
            <div
              className="absolute inset-y-0 left-0 bg-ink-950/70"
              style={{ width: pct(start) }}
              aria-hidden
            />
            <div
              className="absolute inset-y-0 right-0 bg-ink-950/70"
              style={{ width: `${((durationSec - end) / durationSec) * 100}%` }}
              aria-hidden
            />
          </>
        )}

        {/* One tick per moment. Amber if it has music — same meaning as everywhere. */}
        {moments.map((m) => (
          <button
            key={m.id}
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={(e) => {
              e.stopPropagation();
              // Snap a window around this moment, with a little air either side.
              const pad = Math.max(90, (m.tEnd - m.tStart) * 1.5);
              onChange([Math.max(0, m.tStart - pad), Math.min(durationSec, m.tEnd + pad)]);
            }}
            className="absolute top-0 h-full w-2 -translate-x-1/2"
            style={{ left: pct(m.tStart) }}
          >
            <span
              className="absolute inset-y-1 left-1/2 w-[2px] -translate-x-1/2 rounded-full"
              style={{
                background: m.hasMusic ? "var(--color-memory-400)" : "var(--color-machine-400)",
              }}
            />
          </button>
        ))}

        {/* Draggable middle. Only exists once a window does. */}
        {filtered && (
          <div
            data-drag="middle"
            className="absolute inset-y-0 cursor-grab active:cursor-grabbing"
            style={{ left: pct(start), width: pct(end - start) }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            aria-hidden
          />
        )}

        <Handle
          kind="start"
          position={pct(start)}
          label="Window start"
          value={start}
          max={durationSec}
          text={clockTime(tripStartedAt, start)}
          dragging={dragging}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onKeyDown={onHandleKey}
        />
        <Handle
          kind="end"
          position={pct(end)}
          label="Window end"
          value={end}
          max={durationSec}
          text={clockTime(tripStartedAt, end)}
          dragging={dragging}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onKeyDown={onHandleKey}
        />
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-3">
        <span className="tnum font-mono text-[11px] text-fog-400">
          {clockTime(tripStartedAt, start)}
        </span>

        {filtered ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="font-mono text-[11px] text-machine-400 transition-colors hover:text-machine-300"
          >
            {visible} of {moments.length} moments · show all
          </button>
        ) : (
          <span className="font-mono text-[11px] text-fog-400">
            drag to filter by time
          </span>
        )}

        <span className="tnum font-mono text-[11px] text-fog-400">
          {clockTime(tripStartedAt, end)}
        </span>
      </div>
    </div>
  );
}

function Handle({
  kind,
  position,
  label,
  value,
  max,
  text,
  dragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onKeyDown,
}: {
  kind: DragKind;
  position: string;
  label: string;
  value: number;
  max: number;
  text: string;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
}) {
  return (
    <div
      data-drag={kind}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      aria-valuetext={text}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      // No transition while dragging, or the handle lags the cursor.
      className={`absolute inset-y-0 z-10 w-3 -translate-x-1/2 cursor-ew-resize touch-none focus-visible:outline-none ${
        dragging ? "" : "transition-[left] duration-150 ease-out-soft"
      }`}
      style={{ left: position }}
    >
      <span className="absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-fog-200 shadow-[0_0_0_1px_rgba(9,9,14,0.8)]" />
    </div>
  );
}
