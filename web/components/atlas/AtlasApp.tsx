"use client";

/**
 * The walk screen is one surface: the real park at night.
 *
 * Owns every piece of cross-cutting state — which marker is hot, where the
 * replay playhead is, which moment is expanded into its splat, and the ⌘K find
 * palette. The map, the day bar and the overlay are all views of the same
 * little store, which is what makes hovering a chip light a marker and
 * clicking a search result land inside the right splat.
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { NightMap } from "@/components/atlas/NightMap";
import { DayBar } from "@/components/atlas/DayBar";
import { FindPalette } from "@/components/find/FindPalette";
import { ReliveOverlay } from "@/components/relive/ReliveOverlay";
import { distance, duration, tripDate } from "@/lib/format";
import { EMBER, GOLD } from "@/lib/theme";
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
    <div className="relative h-dvh min-h-[480px] w-full overflow-hidden bg-night text-starlight">
      <NightMap
        path={trip.path}
        moments={trip.moments}
        activeId={activeId}
        reachedT={playhead}
        robotPos={robotPos}
        onHover={setHoveredId}
        onOpen={(id) => open(id)}
      />

      {/* ── Floating chrome. The header is the app's ONE frosted element. ── */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
        <div
          className="rise-in pointer-events-auto rounded-[14px] px-4 py-3"
          style={{
            background: "rgb(23 20 50 / 0.72)",
            backdropFilter: "blur(14px) saturate(1.15)",
            WebkitBackdropFilter: "blur(14px) saturate(1.15)",
            boxShadow: "var(--ring), var(--shadow-plate)",
          }}
        >
          <Link href="/" className="flex items-center gap-2.5" aria-label="Back to the landing">
            <SparkGlyph />
            <span
              className="font-display text-[20px] font-extrabold leading-none tracking-tight"
              style={{ fontVariationSettings: '"wdth" 125' }}
            >
              SPARK
            </span>
            <span className="tag mt-0.5 text-[9px] text-faint">the walk</span>
          </Link>
          <p className="tag mt-2 text-[10px] text-moth">
            [ {tripDate(trip.startedAt)} · {trip.placeLabel} ]
          </p>
          <p className="tag tnum mt-1.5 text-[10px] text-faint">
            <span className="text-gold">{trip.stats.momentCount} splats</span>
            {" · "}
            <span className="text-moth">{distance(trip.stats.distanceM)}</span>
            {" · "}
            <span className="text-moth">{duration(trip.stats.durationSec)}</span>
          </p>
        </div>

        <div className="rise-in pointer-events-auto flex items-center gap-2" style={{ "--i": 2 } as React.CSSProperties}>
          <button
            type="button"
            onClick={() => setFindOpen(true)}
            className="btn-ghost bg-plate/90 px-3.5 py-2 text-[13px]"
          >
            <Search size={14} strokeWidth={1.5} aria-hidden />
            <span className="hidden sm:inline">Where&apos;s my…</span>
            <kbd className="tag rounded-[6px] px-1.5 py-0.5 text-[9px] text-faint" style={{ boxShadow: "var(--ring)" }}>
              ⌘K
            </kbd>
          </button>

          {/* .btn-ghost sets display, so `hidden` must live on a wrapper. */}
          <span className="hidden md:block">
            <Link href="/detect" className="btn-ghost bg-plate/90 px-3.5 py-2 text-[13px]">
              Detector bench
            </Link>
          </span>

          <span className="hidden sm:block">
            <span
              className="chip chip-live tag pointer-events-auto whitespace-nowrap bg-plate/90 py-2 text-[10px]"
              title="Follow mode. Mock telemetry — no robot is connected yet."
            >
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-aurora" aria-hidden />
              [ follow · 78% ]
            </span>
          </span>
        </div>
      </header>

      {/* Hint — only until something has been touched. */}
      {playhead === null && !openId && !hoveredId && (
        <div
          className="rise-in pointer-events-none absolute left-1/2 top-20 z-10 hidden -translate-x-1/2 sm:block"
          style={{ "--i": 6 } as React.CSSProperties}
        >
          <span className="tag rounded-full bg-night/70 px-3.5 py-1.5 text-[10px] text-moth" style={{ boxShadow: "var(--ring)" }}>
            every light is a kept moment — click one to step inside
          </span>
        </div>
      )}

      <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-4 sm:p-5">
        <div className="rise-in mx-auto max-w-3xl" style={{ "--i": 3 } as React.CSSProperties}>
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

      {/* ── The takeover: a marker expands into its splat ────────────────── */}
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

/** The brand glyph: a four-point spark, now a light. */
function SparkGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M12 1.5 L14 9.5 L22.5 12 L14 14.5 L12 22.5 L10 14.5 L1.5 12 L10 9.5 Z" fill={EMBER} />
      <circle cx="12" cy="12" r="2.4" fill={GOLD} />
    </svg>
  );
}
