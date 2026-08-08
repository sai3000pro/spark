"use client";

/**
 * The trip screen: a persistent map with a tabbed rail beside it.
 *
 * Holds the one piece of cross-cutting state that makes the panels read as three
 * views of one dataset rather than three widgets: which moment the cursor is on.
 * Map pins, the moment list, the timeline lanes and the panel all highlight
 * together.
 *
 * The tab drives the MAIN pane, not the rail — the pipeline timeline is a
 * full-width three-lane chart and would be unreadable squeezed into a 288px
 * sidebar. So Map and Ask both keep the map on screen (which is what lets an Ask
 * answer light up a pin), and Timeline takes the pane over.
 *
 * Heights are definite rather than viewport-relative: this whole tree also renders
 * inside the 390×844 phone frame, where vh units would measure the wrong box.
 */
import { useMemo, useState } from "react";
import { AskSpark } from "@/components/trip/AskSpark";
import { MomentPanel } from "@/components/trip/MomentPanel";
import { TripMap } from "@/components/trip/TripMap";
import { PipelineTimeline } from "@/components/timeline/PipelineTimeline";
import { clockTime, duration } from "@/lib/format";
import type { TripView } from "@/lib/tripData";
import type { TripQAView } from "@/lib/tripQA";
import type { ObjectIndexEntry } from "@/lib/types";

type Tab = "map" | "timeline" | "ask";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "map", label: "Map" },
  { id: "timeline", label: "Timeline" },
  { id: "ask", label: "Ask Spark" },
];

interface Props {
  trip: TripView;
  index: ObjectIndexEntry[];
  qa: TripQAView;
}

export function TripExplorer({ trip, index, qa }: Props) {
  const [tab, setTab] = useState<Tab>("map");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = useMemo(
    () => trip.moments.find((m) => m.id === selectedId) ?? null,
    [trip.moments, selectedId],
  );

  const toggleSelect = (id: string) => setSelectedId((prev) => (prev === id ? null : id));

  const panel = selected ? (
    <MomentPanel
      moment={selected}
      tripId={trip.id}
      tripStartedAt={trip.startedAt}
      onClose={() => setSelectedId(null)}
    />
  ) : null;

  return (
    // Height is capped to the viewport so the Ask Spark input never lands below
    // the fold, with a floor so the map never gets squashed. Safe to use dvh here
    // even though the phone preview is a nested render: that render happens inside
    // an iframe with its own viewport, and at 362px wide this md: rule is inert.
    <div className="flex flex-col gap-4 md:h-[min(620px,max(440px,calc(100dvh-11rem)))] md:flex-row">
      {/* ── Rail ─────────────────────────────────────────────────────────── */}
      <div className="surface flex shrink-0 flex-col gap-3 rounded-2xl p-3 md:w-72 md:overflow-hidden">
        <div
          className="flex shrink-0 gap-1 rounded-xl bg-ink-800 p-1"
          role="tablist"
          aria-label="Trip views"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 rounded-lg border py-1.5 font-display text-[12px] font-medium transition-colors ${
                tab === t.id
                  ? "border-machine-400/15 bg-ink-900 text-machine-400"
                  : "border-transparent text-fog-400 hover:text-fog-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "ask" ? (
          <AskSpark
            tripId={trip.id}
            index={index}
            qa={qa}
            durationSec={trip.durationSec}
            onFocusMoment={setHoveredId}
          />
        ) : tab === "timeline" ? (
          <TimelineRail trip={trip} />
        ) : (
          <MomentList
            trip={trip}
            hoveredId={hoveredId}
            selectedId={selectedId}
            onHover={setHoveredId}
            onSelect={toggleSelect}
          />
        )}
      </div>

      {/* ── Main pane ────────────────────────────────────────────────────── */}
      {tab === "timeline" ? (
        // The panel sits BELOW the chart here rather than floating: over the map
        // it covers decoration, but over the timeline it would cover the last two
        // moment markers, which is data.
        <div className="scrollbar-thin flex min-w-0 flex-1 flex-col gap-3 md:overflow-y-auto">
          <div className="surface scrollbar-thin shrink-0 overflow-x-auto rounded-2xl p-3">
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
          {panel}
        </div>
      ) : (
        <div className="relative min-w-0 flex-1">
          <TripMap
            path={trip.path}
            moments={trip.moments}
            activeMomentId={hoveredId}
            selectedMomentId={selectedId}
            onHoverMoment={setHoveredId}
            onSelectMoment={toggleSelect}
            className="h-[340px] w-full sm:h-[420px] md:h-full"
          />

          {/* Floats over the map on desktop, docks to the bottom of the pane on
              mobile — same component, as in the design. */}
          {selected && (
            <div className="absolute inset-x-0 bottom-0 md:inset-x-auto md:bottom-auto md:right-4 md:top-4 md:w-80">
              {panel}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MomentList({
  trip,
  hoveredId,
  selectedId,
  onHover,
  onSelect,
}: {
  trip: TripView;
  hoveredId: string | null;
  selectedId: string | null;
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
            }`}
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

/** Legend and counts for the timeline, so the chart itself carries less chrome. */
function TimelineRail({ trip }: { trip: TripView }) {
  const promoted = trip.candidates.filter((c) => c.status === "promoted").length;
  const discarded = trip.candidates.filter((c) => c.status === "discarded").length;

  return (
    <div className="scrollbar-thin min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5">
      <p className="eyebrow">Stage 1 → 2 → 3</p>
      <p className="text-[12px] leading-relaxed text-fog-300">
        Detections in, moments out. Discarded windows are kept on the chart so the scoring can be
        checked rather than trusted.
      </p>

      <dl className="space-y-2">
        <Row n={1} label="detections" value={trip.stats.detectionCount.toLocaleString()} />
        <Row n={2} label="candidates scored" value={String(trip.candidates.length)} />
        <Row n={2} label="→ discarded" value={String(discarded)} dim />
        <Row n={3} label="→ promoted" value={String(promoted)} />
      </dl>

      <p className="border-t border-ink-800 pt-2.5 text-[11px] leading-relaxed text-fog-400">
        Hover any candidate window to see which triggers fired, and for the rejects, the reason it
        was dropped.
      </p>
    </div>
  );
}

function Row({
  n,
  label,
  value,
  dim,
}: {
  n: 1 | 2 | 3;
  label: string;
  value: string;
  dim?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="flex items-center gap-1.5 font-mono text-[11px] text-fog-400">
        <span className="rounded border border-ink-600 px-1 text-machine-400">{n}</span>
        {label}
      </dt>
      <dd className={`tnum font-mono text-[12px] ${dim ? "text-fog-400" : "text-fog-100"}`}>
        {value}
      </dd>
    </div>
  );
}
