"use client";

/**
 * The walk screen is one surface: the real park, printed on the journal's page.
 *
 * Owns every piece of cross-cutting state — which pin is hot, where the
 * replay playhead is, which moment is expanded into its splat, and the ⌘K find
 * palette. The map, the day bar and the overlay are all views of the same
 * little store, which is what makes hovering a chip light a pin and
 * clicking a search result land inside the right splat.
 */
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { FieldMap } from "@/components/atlas/FieldMap";
import { DayBar } from "@/components/atlas/DayBar";
import { LedgerOverlay } from "@/components/atlas/LedgerOverlay";
import { FindPalette } from "@/components/find/FindPalette";
import { ReliveOverlay } from "@/components/relive/ReliveOverlay";
import { clockShort, distance, duration, tripDate } from "@/lib/format";
import { makeGeo } from "@/lib/geo";
import { formatGeo } from "@/lib/globe/geo";
import type { GlobeView } from "@/lib/globeData";
import type { AtlasView, TripView } from "@/lib/tripData";
import type { Vec2 } from "@/lib/types";

// The globes are WebGL and mean nothing to the server — loaded lazily so the
// map is interactive before three.js ever crosses the wire.
const PocketGlobe = dynamic(
  () => import("@/components/atlas/PocketGlobe").then((m) => m.PocketGlobe),
  { ssr: false },
);
const GlobeOverlay = dynamic(
  () => import("@/components/atlas/GlobeOverlay").then((m) => m.GlobeOverlay),
  { ssr: false },
);

/** A 95-minute walk replays in ~48 seconds. */
const REPLAY_SPEED = 120;

interface Props extends AtlasView {
  /** Every walk pinned on the Earth — what the pocket globe opens into. */
  globe: GlobeView;
  initialMomentId?: string | null;
  initialAnchor?: string | null;
}

export function AtlasApp({
  trip,
  moments,
  entries,
  navTargets,
  geo,
  globe,
  ledger,
  initialMomentId,
  initialAnchor,
}: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(
    initialMomentId && moments.some((m) => m.id === initialMomentId) ? initialMomentId : null,
  );
  const [anchor, setAnchor] = useState<string | null>(initialAnchor ?? null);
  const [findOpen, setFindOpen] = useState(false);
  const [globeOpen, setGlobeOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);

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

  // The banners fly each moment's wall clock — computed once, in trip time.
  const clocks = useMemo(
    () => trip.moments.map((m) => clockShort(trip.startedAt, m.tStart)),
    [trip.moments, trip.startedAt],
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
    <div className="relative h-dvh min-h-[480px] w-full overflow-hidden bg-paper text-ink">
      <FieldMap
        geo={geo}
        plate={
          // No card: the title block is survey lettering laid on the ground,
          // haloed in milk the way the map's own labels are.
          <div
            className="rise-in"
            style={{
              textShadow:
                "0 0 5px rgb(255 251 240 / 0.95), 0 0 10px rgb(255 251 240 / 0.85), 0 0 18px rgb(255 251 240 / 0.7)",
            }}
          >
            <Link href="/" className="flex items-baseline gap-2.5" aria-label="Back to the landing">
              <span className="font-display text-[24px] leading-none" style={{ fontWeight: 580 }}>
                Spark<span className="text-clay">.</span>
              </span>
              <span className="fnote text-[10px] text-ink-soft">[ the walk ]</span>
            </Link>
            <p className="tag tnum mt-1.5 text-[12.5px] text-ink">
              {tripDate(trip.startedAt)} · {trip.placeLabel}
            </p>
            {/* The summary IS the door: clicking the day's totals opens the
                full ledger, the way clicking a banner opens its splat. */}
            <button
              type="button"
              onClick={() => {
                setPlaying(false);
                setLedgerOpen(true);
              }}
              aria-label="Open the walk's ledger — the full dashboard of this walk"
              className="group block text-left"
            >
              <p className="tag tnum mt-0.5 text-[12px] text-ink-soft">
                {trip.stats.momentCount} moments · {distance(trip.stats.distanceM)} ·{" "}
                {duration(trip.stats.durationSec)}
              </p>
              <p className="tag tnum mt-0.5 text-[12px] text-ink-soft">
                {ledger.company.people.length} companions · {ledger.company.laughT.length} laughs ·{" "}
                {trip.stats.distinctObjectCount} kinds of thing
              </p>
              <p className="fnote mt-1 text-[8.5px] text-ink-faint transition-colors duration-300 group-hover:text-clay">
                [ open the ledger ]
              </p>
            </button>
            <p className="fnote mt-1.5 text-[8.5px] text-ink-soft">
              {(() => {
                const [lng, lat] = makeGeo(geo).localToLngLat(trip.path[0].pos);
                return `[ ${formatGeo({ lat, lng })} ]`;
              })()}
            </p>
          </div>
        }
        path={trip.path}
        moments={trip.moments}
        clocks={clocks}
        activeId={activeId}
        reachedT={playhead}
        robotPos={robotPos}
        onHover={setHoveredId}
        onOpen={(id) => open(id)}
      />

      {/* ── Floating chrome ──────────────────────────────────────────────── */}
      <header className="pointer-events-none absolute right-0 top-0 z-20 p-4 sm:p-5">
        <div className="rise-in pointer-events-auto flex items-center gap-2" style={{ "--i": 2 } as React.CSSProperties}>
          <button
            type="button"
            onClick={() => setFindOpen(true)}
            className="pill-ghost bg-vellum/80 px-3.5 py-2 text-[13px] text-ink"
          >
            <Search size={14} strokeWidth={1.75} aria-hidden />
            <span className="hidden sm:inline">Where&apos;s my…</span>
            <kbd className="fnote rounded-[3px] px-1.5 py-0.5 text-[10px] text-ink-faint" style={{ boxShadow: "var(--ring-ink)" }}>
              ⌘K
            </kbd>
          </button>

          {/* .pill-ghost sets display, so `hidden` must live on a wrapper. */}
          <span className="hidden md:block">
            <Link href="/detect" className="pill-ghost bg-vellum/80 px-3.5 py-2 text-[13px] text-ink">
              Detector bench
            </Link>
          </span>
        </div>
      </header>

      {/* ── The pocket globe — the door to the plate, tucked in the corner.
             It clears the day bar on narrow screens and settles into the true
             corner once the viewport is wide enough to spare it. ──────────── */}
      {!openMoment && !globeOpen && (
        <div
          className="rise-in pointer-events-none absolute bottom-28 right-4 z-20 lg:bottom-4 lg:right-4"
          style={{ "--i": 5 } as React.CSSProperties}
        >
          <PocketGlobe
            stops={globe.pins.map((p) => p.origin)}
            onOpen={() => {
              setPlaying(false);
              setGlobeOpen(true);
            }}
          />
        </div>
      )}

      <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-4 sm:p-5">
        <div className="rise-in mx-auto max-w-3xl" style={{ "--i": 3 } as React.CSSProperties}>
          <DayBar
            durationSec={trip.durationSec}
            playhead={playhead}
            playing={playing}
            moments={trip.moments}
            clocks={clocks}
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

      {/* ── The globe plate: the pocket globe, opened to a full page ─────── */}
      {globeOpen && (
        <GlobeOverlay
          view={globe}
          currentTripId={trip.id}
          onClose={() => setGlobeOpen(false)}
        />
      )}

      {/* ── The ledger: the plate's summary, opened to a full page ───────── */}
      {ledgerOpen && (
        <LedgerOverlay
          trip={trip}
          ledger={ledger}
          onClose={() => setLedgerOpen(false)}
          onOpenMoment={(id) => {
            setLedgerOpen(false);
            open(id);
          }}
        />
      )}

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

