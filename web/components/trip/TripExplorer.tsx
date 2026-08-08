"use client";

/**
 * The album screen. Opens on a photo grid; map, timeline and Ask Spark are
 * siblings of it.
 *
 * This component owns the one piece of cross-cutting state that makes every
 * panel read as views of ONE dataset rather than four widgets: which moment the
 * cursor is on. The moment grid, the map pins, the timeline lanes and the detail
 * panel all highlight together, and the time scrubber dims all of them at once.
 *
 * That is also why the grid was added here rather than as its own screen — it
 * becomes a fourth consumer of `hoveredId` / `selectedId` and gets the shared
 * highlighting for free.
 *
 * Tabs drive the MAIN pane, not the rail: the pipeline timeline is a full-width
 * three-lane chart and would be unreadable squeezed into a 288px sidebar. Map and
 * Ask both keep the map on screen, which is what lets an Ask answer light up a
 * pin.
 *
 * Heights are definite rather than viewport-relative: this tree also renders
 * inside the 390×844 phone frame, where vh units would measure the wrong box.
 */
import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AskSpark } from "@/components/trip/AskSpark";
import { MomentGrid } from "@/components/trip/MomentGrid";
import { MomentPanel } from "@/components/trip/MomentPanel";
import { TimeScrubber } from "@/components/trip/TimeScrubber";
import { TripMap } from "@/components/trip/TripMap";
import { TripTabs, type TripTab } from "@/components/trip/TripTabs";
import { PipelineTimeline } from "@/components/timeline/PipelineTimeline";
import { clockTime, duration } from "@/lib/format";
import type { TripView } from "@/lib/tripData";
import type { TripQAView } from "@/lib/tripQA";
import type { ObjectIndexEntry } from "@/lib/types";

interface Props {
  trip: TripView;
  index: ObjectIndexEntry[];
  qa: TripQAView;
  initialTab: TripTab;
}

export function TripExplorer({ trip, index, qa, initialTab }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const [tab, setTab] = useState<TripTab>(initialTab);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [window, setWindow] = useState<[number, number] | null>(null);

  const selected = useMemo(
    () => trip.moments.find((m) => m.id === selectedId) ?? null,
    [trip.moments, selectedId],
  );

  /** Moments outside the scrubber window — dimmed on the map, not removed. */
  const dimmedIds = useMemo(() => {
    if (!window) return undefined;
    const out = new Set<string>();
    for (const m of trip.moments) {
      if (m.tEnd < window[0] || m.tStart > window[1]) out.add(m.id);
    }
    return out;
  }, [trip.moments, window]);

  const toggleSelect = (id: string) => setSelectedId((prev) => (prev === id ? null : id));

  const changeTab = (next: TripTab) => {
    setTab(next);
    // URL-as-state, like ?anchor= and ?chrome=off — the tab is shareable and the
    // back button works. `replace` so tabbing around doesn't stack history.
    router.replace(next === "moments" ? pathname : `${pathname}?tab=${next}`, { scroll: false });
  };

  const panel = selected ? (
    <MomentPanel
      moment={selected}
      tripId={trip.id}
      tripStartedAt={trip.startedAt}
      onClose={() => setSelectedId(null)}
    />
  ) : null;

  const scrubber = (
    <TimeScrubber
      bins={trip.detectionBins}
      moments={trip.moments}
      durationSec={trip.durationSec}
      tripStartedAt={trip.startedAt}
      window={window}
      onChange={setWindow}
    />
  );

  return (
    <div className="space-y-4">
      <TripTabs tab={tab} onChange={changeTab} />

      {/* The timeline chart carries this information at full size already, so a
          scrubber above it would be the same data twice. */}
      {tab !== "timeline" && scrubber}

      {tab === "moments" ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <MomentGrid
            moments={trip.moments}
            tripStartedAt={trip.startedAt}
            hoveredId={hoveredId}
            selectedId={selectedId}
            window={window}
            onHover={setHoveredId}
            onSelect={toggleSelect}
          />
          {/* Docks as a column on wide screens; MomentPanel already handles the
              bottom-sheet treatment below md on its own. */}
          {selected && <div className="lg:sticky lg:top-20 lg:self-start">{panel}</div>}
        </div>
      ) : tab === "timeline" ? (
        <div className="space-y-3">
          <div className="surface scrollbar-thin overflow-x-auto rounded-2xl p-3">
            <PipelineTimeline
              bins={trip.detectionBins}
              candidates={trip.candidates}
              moments={trip.moments}
              durationSec={trip.durationSec}
              detectionCount={trip.stats.detectionCount}
              activeMomentId={hoveredId}
              onHoverMoment={setHoveredId}
              onSelectMoment={toggleSelect}
            />
          </div>
          {/* Below the chart rather than floating: over the map a panel covers
              decoration, but over the timeline it would cover the last two moment
              markers, which is data. */}
          {panel}
        </div>
      ) : (
        <div className="flex flex-col gap-4 md:h-[min(620px,max(440px,calc(100dvh-16rem)))] md:flex-row">
          <div className="surface flex shrink-0 flex-col gap-3 rounded-2xl p-3 md:w-72 md:overflow-hidden">
            {tab === "ask" ? (
              <AskSpark
                tripId={trip.id}
                index={index}
                qa={qa}
                durationSec={trip.durationSec}
                onFocusMoment={setHoveredId}
              />
            ) : (
              <MomentList
                trip={trip}
                hoveredId={hoveredId}
                selectedId={selectedId}
                dimmedIds={dimmedIds}
                onHover={setHoveredId}
                onSelect={toggleSelect}
              />
            )}
          </div>

          <div className="relative min-w-0 flex-1">
            <TripMap
              path={trip.path}
              moments={trip.moments}
              activeMomentId={hoveredId}
              selectedMomentId={selectedId}
              dimmedMomentIds={dimmedIds}
              onHoverMoment={setHoveredId}
              onSelectMoment={toggleSelect}
              className="h-[340px] w-full sm:h-[420px] md:h-full"
            />

            {selected && (
              <div className="absolute inset-x-0 bottom-0 md:inset-x-auto md:bottom-auto md:right-4 md:top-4 md:w-80">
                {panel}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MomentList({
  trip,
  hoveredId,
  selectedId,
  dimmedIds,
  onHover,
  onSelect,
}: {
  trip: TripView;
  hoveredId: string | null;
  selectedId: string | null;
  dimmedIds?: Set<string>;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="scrollbar-thin min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
      <p className="eyebrow sticky top-0 z-10 bg-ink-900 pb-1.5">
        {trip.moments.length} moments
      </p>
      {trip.moments.map((m, i) => {
        const on = selectedId === m.id || hoveredId === m.id;
        return (
          <button
            key={m.id}
            type="button"
            onMouseEnter={() => onHover(m.id)}
            onMouseLeave={() => onHover(null)}
            onClick={() => onSelect(m.id)}
            aria-pressed={selectedId === m.id}
            className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
              on
                ? "border-machine-400/20 bg-machine-400/[0.08]"
                : "border-white/[0.05] bg-white/[0.02] hover:border-white/10"
            } ${dimmedIds?.has(m.id) ? "opacity-40" : ""}`}
          >
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: m.hasMusic ? "var(--color-memory-400)" : "var(--color-machine-400)" }}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-[13px] font-medium text-fog-100">
                {i + 1}. {m.title}
              </span>
              <span className="tnum block truncate font-mono text-[11px] text-fog-400">
                {clockTime(trip.startedAt, m.tStart)} · {duration(m.tEnd - m.tStart)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
