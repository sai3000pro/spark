"use client";

/**
 * The whole app is one screen: the atlas.
 *
 * Owns every piece of cross-cutting state — which pin is hot, where the replay
 * playhead is, which moment is expanded into its splat, and the ⌘K find
 * palette. The map, the day bar and the overlay are all views of the same
 * little store, which is what makes hovering a chip light a pin and clicking
 * a search result land inside the right splat.
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AtlasMap } from "@/components/atlas/AtlasMap";
import { DayBar } from "@/components/atlas/DayBar";
import { FindPalette } from "@/components/find/FindPalette";
import { ReliveOverlay } from "@/components/relive/ReliveOverlay";
import { InkTag } from "@/components/system/ui";
import { distance, duration, tripDate } from "@/lib/format";
import { CORAL, TEAL, VIOLET } from "@/lib/theme";
import type { TripView } from "@/lib/tripData";
import type { Moment, ObjectIndexEntry, Vec2 } from "@/lib/types";

/** A 95-minute walk replays in ~48 seconds. */
const REPLAY_SPEED = 120;

export interface NavTargetMap {
  [momentId: string]: { [trackId: string]: { pos: Vec2; heading: number } };
}

interface Props {
  trip: TripView;
  /** Full moments — transcript, objects, keyframes, splat refs. */
  moments: Moment[];
  entries: ObjectIndexEntry[];
  navTargets: NavTargetMap;
  initialMomentId?: string | null;
  initialAnchor?: string | null;
}

export function AtlasApp({
  trip,
  moments,
  entries,
  navTargets,
  initialMomentId,
  initialAnchor,
}: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(
    initialMomentId && moments.some((m) => m.id === initialMomentId) ? initialMomentId : null,
  );
  const [anchor, setAnchor] = useState<string | null>(initialAnchor ?? null);
  const [findOpen, setFindOpen] = useState(false);

  // ── The replay ─────────────────────────────────────────────────────────
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  // The loop reads its own position from a ref so each rAF frame advances from
  // the real previous value without a setState-in-effect cascade.
  const playheadRef = useRef(0);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const next = Math.min(trip.durationSec, playheadRef.current + dt * REPLAY_SPEED);
      playheadRef.current = next;
      setPlayhead(next);
      if (next >= trip.durationSec) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, trip.durationSec]);

  // ⌘K opens the find palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setFindOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const robotPos = useMemo(
    () => (playhead === null ? null : posAt(trip.path, playhead)),
    [trip.path, playhead],
  );

  // The moment whose window the playhead is inside — the replay's own highlight.
  const replayMoment = useMemo(
    () =>
      playhead === null
        ? null
        : (trip.moments.find((m) => playhead >= m.tStart && playhead <= m.tEnd) ?? null),
    [trip.moments, playhead],
  );

  const activeId = hoveredId ?? replayMoment?.id ?? null;

  const openIndex = moments.findIndex((m) => m.id === openId);
  const openMoment = openIndex >= 0 ? moments[openIndex] : null;

  const open = (id: string, withAnchor: string | null = null) => {
    setAnchor(withAnchor);
    setOpenId(id);
    setPlaying(false);
  };

  return (
    <div className="relative h-dvh min-h-[480px] w-full overflow-hidden bg-cream">
      <AtlasMap
        path={trip.path}
        moments={trip.moments}
        activeId={activeId}
        reachedT={playhead}
        robotPos={robotPos}
        onHover={setHoveredId}
        onOpen={(id) => open(id)}
      />

      {/* ── Floating chrome ─────────────────────────────────────────────── */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
        <div className="riso-card grained relative pointer-events-auto rounded-[20px] px-4 py-3 shadow-lg shadow-ink/10 pop-in">
          <div className="flex items-center gap-2.5">
            <SparkGlyph />
            <h1 className="font-display text-[22px] font-extrabold leading-none tracking-tight text-ink">
              SPARK
            </h1>
            <InkTag className="mt-0.5 text-[9px] text-ink-faint">atlas of the day</InkTag>
          </div>
          <p className="tag mt-2 text-[10px] text-ink-soft">
            {tripDate(trip.startedAt)} · {trip.placeLabel}
          </p>
          <div className="mt-1.5 flex items-center gap-3">
            <InkTag color={CORAL.deep} className="text-[10px]">
              {trip.stats.momentCount} splats
            </InkTag>
            <InkTag color={TEAL.deep} className="text-[10px]">
              {distance(trip.stats.distanceM)}
            </InkTag>
            <InkTag color={VIOLET.deep} className="text-[10px]">
              {duration(trip.stats.durationSec)}
            </InkTag>
          </div>
        </div>

        <div className="pointer-events-auto flex items-center gap-2 pop-in" style={{ "--i": 2 } as React.CSSProperties}>
          <button
            type="button"
            onClick={() => setFindOpen(true)}
            className="riso-card flex items-center gap-2 rounded-full px-3.5 py-2 text-[13px] font-bold text-ink shadow-md shadow-ink/10 transition-transform duration-200 ease-(--ease-pop) hover:scale-[1.04] active:scale-95"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
              <circle cx="6" cy="6" r="4.1" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M9.4 9.4 12.8 12.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span className="hidden sm:inline">Where&apos;s my…</span>
            <kbd className="tag rounded-[6px] border-[1.5px] border-ink/30 bg-cream px-1.5 py-0.5 text-[9px]">
              ⌘K
            </kbd>
          </button>

          <Link
            href="/detect"
            className="riso-card hidden items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-bold text-ink shadow-md shadow-ink/10 transition-transform duration-200 ease-(--ease-pop) hover:scale-[1.04] active:scale-95 md:flex"
          >
            Detector bench
          </Link>

          <span
            className="riso-card tag flex items-center gap-2 rounded-full px-3 py-2.5 text-[10px] text-ink-soft shadow-md shadow-ink/10"
            title="Follow mode. Mock telemetry — no robot is connected yet."
          >
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-teal" />
            follow · 78%
          </span>
        </div>
      </header>

      {/* Hint sticker — only until something has been touched. */}
      {playhead === null && !openId && !hoveredId && (
        <div className="pointer-events-none absolute left-1/2 top-20 z-10 hidden -translate-x-1/2 rise-in sm:block" style={{ "--i": 6 } as React.CSSProperties}>
          <span className="tag rounded-full border-[1.5px] border-ink/30 bg-cream-bright/85 px-3.5 py-1.5 text-[10px] text-ink-soft backdrop-blur-sm">
            every sticker is a 3D moment — click one to step inside
          </span>
        </div>
      )}

      <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-4 sm:p-5">
        <div className="mx-auto max-w-3xl rise-in" style={{ "--i": 3 } as React.CSSProperties}>
          <DayBar
            durationSec={trip.durationSec}
            playhead={playhead}
            playing={playing}
            moments={trip.moments}
            activeId={activeId}
            replaySpeed={REPLAY_SPEED}
            onPlayToggle={() => {
              if (!playing && (playhead === null || playhead >= trip.durationSec)) {
                playheadRef.current = 0;
                setPlayhead(0);
              }
              setPlaying((v) => !v);
            }}
            onScrub={(t) => {
              setPlaying(false);
              playheadRef.current = t;
              setPlayhead(t);
            }}
            onHover={setHoveredId}
            onOpen={(id) => open(id)}
          />
        </div>
      </footer>

      {/* ── The takeover: a pin expands into its splat ──────────────────── */}
      {openMoment && (
        <ReliveOverlay
          moment={openMoment}
          index={openIndex}
          total={moments.length}
          tripStartedAt={trip.startedAt}
          navTargets={navTargets[openMoment.id] ?? {}}
          anchor={anchor}
          onClose={() => {
            setOpenId(null);
            setAnchor(null);
          }}
          onStep={(dir) => {
            const next = openIndex + dir;
            if (next >= 0 && next < moments.length) open(moments[next].id);
          }}
        />
      )}

      {findOpen && (
        <FindPalette
          entries={entries}
          durationSec={trip.durationSec}
          onClose={() => setFindOpen(false)}
          onStepInside={(momentId, trackId) => {
            setFindOpen(false);
            open(momentId, trackId);
          }}
        />
      )}
    </div>
  );
}

/** Linear interpolation along the odometry — where the robot was at time t. */
function posAt(path: TripView["path"], t: number): Vec2 {
  if (t <= path[0].t) return path[0].pos;
  const last = path[path.length - 1];
  if (t >= last.t) return last.pos;
  let lo = 0;
  let hi = path.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = path[lo];
  const b = path[hi];
  const f = (t - a.t) / (b.t - a.t || 1);
  return [a.pos[0] + (b.pos[0] - a.pos[0]) * f, a.pos[1] + (b.pos[1] - a.pos[1]) * f];
}

/** The brand glyph: a chunky four-point spark. */
function SparkGlyph({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 1.5 L14 9.5 L22.5 12 L14 14.5 L12 22.5 L10 14.5 L1.5 12 L10 9.5 Z"
        fill="#ef5b3c"
        stroke="#232038"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.6" fill="#f4b841" stroke="#232038" strokeWidth="1.2" />
    </svg>
  );
}
