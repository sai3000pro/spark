"use client";

/**
 * The walk screen is one surface: the real place, printed on the journal's page.
 *
 * Owns every piece of cross-cutting state — which pin is hot, where the
 * replay playhead is, which moment is expanded into its splat, and the ⌘K find
 * palette. The map, the day bar and the overlay are all views of the same
 * little store, which is what makes hovering a chip light a pin and
 * clicking a search result land inside the right splat.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Search } from "lucide-react";
import { FieldMap } from "@/components/atlas/FieldMap";
import { GlobeOverlay } from "@/components/atlas/GlobeOverlay";
import { PocketGlobe } from "@/components/atlas/PocketGlobe";
import { NavBrandSwitch } from "@/components/shell/NavBrandSwitch";
import { DayBar } from "@/components/atlas/DayBar";
import { FindPalette } from "@/components/find/FindPalette";
import { ReliveOverlay } from "@/components/relive/ReliveOverlay";
import { clockTime, distance, duration, tripDate } from "@/lib/format";
import { makeGeo } from "@/lib/geo";
import { formatGeo } from "@/lib/globe/geo";
import type { GlobeScope, GlobeScopes } from "@/lib/globeData";
import type { AtlasView, TripView } from "@/lib/tripData";
import type { Vec2 } from "@/lib/types";

/** A 95-minute walk replays in ~48 seconds. */
const REPLAY_SPEED = 120;

/** "Client or server?" never changes after hydration, so this store never fires. */
const NEVER_CHANGES = () => () => {};

interface Props extends AtlasView {
  initialMomentId?: string | null;
  initialAnchor?: string | null;
  /**
   * The posting three, now consumed.
   *
   * A walk reaches the shared globe only when its owner puts it there, and
   * these are the three facts that sentence needs: every sphere the plate can
   * show (`globe`), whether THIS walk is yours to post at all (`mine`), and
   * whether it is out there right now (`posted`). The plate carries both
   * controls — the scope toggle that chooses which sphere, and the post button
   * that decides whether this walk is on the world's one.
   *
   * Optional because the props arrive only from AtlasScreen; a caller that
   * renders the map without a globe gets a map without a door to one.
   */
  globe?: GlobeScopes;
  mine?: boolean;
  posted?: boolean;
}

export function AtlasApp({
  trip,
  moments,
  entries,
  navTargets,
  geo,
  initialMomentId,
  initialAnchor,
  globe,
  mine,
  posted,
}: Props) {
  const router = useRouter();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(
    initialMomentId && moments.some((m) => m.id === initialMomentId) ? initialMomentId : null,
  );
  const [anchor, setAnchor] = useState<string | null>(initialAnchor ?? null);
  const [findOpen, setFindOpen] = useState(false);

  // ── The globe plate ────────────────────────────────────────────────────
  const [globeOpen, setGlobeOpen] = useState(false);
  const [scope, setScope] = useState<GlobeScope>("world");
  /**
   * The plate's door is a WebGL instrument and `useWebGLSupport` can only
   * answer in the browser, so the pocket globe renders nothing on the server
   * and something on the client — a hydration mismatch if it went up in the
   * first pass. This is false through hydration and true after, which is the
   * same trick (and the same getServerSnapshot) paperGlobe's useReducedMotion
   * uses to read a browser-only fact without an effect.
   */
  const doorReady = useSyncExternalStore(NEVER_CHANGES, () => true, () => false);

  /**
   * Posting is a server fact and the button must never get ahead of it.
   *
   * `posted` arrives from AtlasScreen; this holds the answer the POST came back
   * with so the button flips the moment the server agrees, and `router.refresh()`
   * re-renders the spheres behind it so the pin actually appears or leaves. Null
   * until something is posted — the prop is the truth until then.
   */
  const [postedNow, setPostedNow] = useState<boolean | null>(null);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const isPosted = postedNow ?? !!posted;

  const post = useCallback(
    async (next: boolean) => {
      setPosting(true);
      setPostError(null);
      try {
        const res = await fetch(`/api/trips/${trip.id}/posted`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ posted: next }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          posted?: boolean;
          error?: string;
        };
        if (!res.ok || typeof body.posted !== "boolean") {
          setPostError(body.error ?? `The server said ${res.status}.`);
          return;
        }
        setPostedNow(body.posted);
        router.refresh();
      } catch (err) {
        setPostError(err instanceof Error ? err.message : String(err));
      } finally {
        setPosting(false);
      }
    },
    [router, trip.id],
  );

  /**
   * A scope that has emptied out falls back to the world.
   *
   * Withdrawing your last posted walk while looking at the `posted` sphere
   * would otherwise leave a bare Earth with no explanation. The world is never
   * empty — the seeded specs are other people's, and you cannot unpost those.
   */
  const activeScope: GlobeScope =
    globe && globe[scope].albums.length > 0 ? scope : "world";

  /** The door hints at the room: the same walks the plate would open on. */
  const doorStops = useMemo(
    () => globe?.[activeScope].albums.map((a) => a.origin) ?? [],
    [globe, activeScope],
  );

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

  /**
   * Wall-clock labels for the moments, one per moment and in their order — both
   * the map's pins and the day bar index straight into this by position.
   *
   * Derived HERE rather than at the two call sites so they cannot drift into
   * disagreeing about what time a moment happened, and computed once per trip
   * because `clockTime` builds a Date and a formatter on every call.
   */
  const clocks = useMemo(
    () => trip.moments.map((m) => clockTime(trip.startedAt, m.tStart)),
    [trip.moments, trip.startedAt],
  );

  return (
    <div className="relative h-dvh min-h-[480px] w-full overflow-hidden bg-paper text-ink">
      <FieldMap
        path={trip.path}
        moments={trip.moments}
        clocks={clocks}
        geo={geo}
        activeId={activeId}
        reachedT={playhead}
        robotPos={robotPos}
        onHover={setHoveredId}
        onOpen={(id) => open(id)}
      />

      {/* ── Floating chrome — vellum slips pinned over the page. ─────────── */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
        <div className="plate-vellum papergrain rise-in pointer-events-auto relative overflow-hidden px-4 py-3">
          <NavBrandSwitch tone="paper" />
          <p className="tag tnum mt-2.5 text-[12px] text-ink-soft">
            {tripDate(trip.startedAt)} · {trip.placeLabel}
          </p>
          <p className="tag tnum mt-0.5 text-[12px] text-ink-faint">
            {trip.stats.momentCount} moments · {distance(trip.stats.distanceM)} ·{" "}
            {duration(trip.stats.durationSec)}
          </p>
          <p className="fnote mt-2 text-[8.5px] text-ink-faint">
            {(() => {
              // formatGeo carries the hemisphere. The old inline template said
              // N/W unconditionally, which was fine while the only trip was in
              // Ontario and wrong for Cape Town and Kyoto.
              const [lng, lat] = makeGeo(geo).localToLngLat(trip.path[0].pos);
              return `[ ${formatGeo({ lat, lng })} ]`;
            })()}
          </p>
        </div>

        <div className="rise-in pointer-events-auto flex items-center gap-2" style={{ "--i": 2 } as React.CSSProperties}>
          <button
            type="button"
            onClick={() => setFindOpen(true)}
            className="pill-ghost bg-vellum/80 px-3.5 py-2 text-[13px] text-ink"
          >
            <Search size={14} strokeWidth={1.75} aria-hidden />
            <span className="hidden sm:inline">Where&apos;s my…</span>
            <kbd className="fnote rounded-[4px] px-1.5 py-0.5 text-[10px] text-ink-faint" style={{ boxShadow: "var(--ring-ink)" }}>
              ⌘K
            </kbd>
          </button>

          {/* .pill-ghost sets display, so `hidden` must live on a wrapper. */}
          <span className="hidden md:block">
            <Link href="/detect" className="pill-ghost bg-vellum/80 px-3.5 py-2 text-[13px] text-ink">
              Detector bench
            </Link>
          </span>

          {/* The plate's other door. The pocket globe below needs a corner the
              day bar is not already standing in, which only exists from lg up —
              so under that width the way in is a word instead of an instrument. */}
          {globe && (
            <span className="lg:hidden">
              <button
                type="button"
                onClick={() => setGlobeOpen(true)}
                className="pill-ghost bg-vellum/80 px-3.5 py-2 text-[13px] text-ink"
              >
                The globe
              </button>
            </span>
          )}

          <span className="hidden sm:block">
            <span
              className="chip chip-live fnote pointer-events-auto whitespace-nowrap py-2 text-[10px]"
              title="Follow mode. Mock telemetry — no robot is connected yet."
            >
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-moss" aria-hidden />
              [ following · 78% ]
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
          <span className="tag rounded-[6px] bg-vellum/85 px-3 py-1.5 text-[12px] text-ink-soft" style={{ boxShadow: "var(--ring-ink)" }}>
            Every pin is a kept moment — click one to step inside
          </span>
        </div>
      )}

      {/* ── The door to the plate ────────────────────────────────────────── */}
      {/* Bottom right, which is where GlobeOverlay's takeover grows from. Only
          at lg: below that the day bar's 3xl plate reaches into this corner. */}
      {globe && doorReady && !globeOpen && (
        <div
          className="rise-in pointer-events-none absolute bottom-5 right-5 z-20 hidden lg:block"
          style={{ "--i": 4 } as React.CSSProperties}
        >
          <PocketGlobe stops={doorStops} onOpen={() => setGlobeOpen(true)} />
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

      {/* ── The plate: the pocket globe, opened to a full page ───────────── */}
      {globe && globeOpen && (
        <GlobeOverlay
          scopes={globe}
          scope={activeScope}
          onScope={setScope}
          currentTripId={trip.id}
          standing={{ mine: !!mine, posted: isPosted, busy: posting, error: postError }}
          onPost={(next) => void post(next)}
          onClose={() => setGlobeOpen(false)}
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

