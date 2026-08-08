"use client";

/**
 * The moments of one trip, as a photo grid sectioned by time of day.
 *
 * Sections are parts of day — Morning / Afternoon / Golden hour / Evening —
 * derived from the moment's actual wall-clock time, NOT fixed N-minute bins.
 * Arbitrary bins ("0–20 min", "20–40 min") read as machine output; parts of day
 * read as a photo library, and they happen to be true of the data: the Waterloo
 * walk runs 15:10–16:45 and splits honestly into Afternoon and Golden hour. A
 * 44-minute trip yields one section, which is the correct answer for a 44-minute
 * trip.
 */
import { MomentTile } from "@/components/trip/MomentTile";
import { clockTime, tripLocalHour } from "@/lib/format";
import type { MomentSummary } from "@/lib/tripData";

interface Props {
  moments: MomentSummary[];
  tripStartedAt: string;
  hoveredId: string | null;
  selectedId: string | null;
  /** Scrubber window in trip-relative seconds, or null for the whole trip. */
  window: [number, number] | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}

const PARTS = [
  { id: "morning", label: "Morning", until: 12 },
  { id: "afternoon", label: "Afternoon", until: 17 },
  { id: "golden", label: "Golden hour", until: 20 },
  { id: "evening", label: "Evening", until: 24 },
] as const;

export function MomentGrid({
  moments,
  tripStartedAt,
  hoveredId,
  selectedId,
  window,
  onHover,
  onSelect,
}: Props) {
  const sections = groupByPartOfDay(moments, tripStartedAt);
  const inWindow = (m: MomentSummary) =>
    !window || (m.tEnd >= window[0] && m.tStart <= window[1]);

  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <section key={section.id}>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="eyebrow">{section.label}</h3>
            <span className="tnum shrink-0 font-mono text-[11px] text-fog-400">
              {clockTime(tripStartedAt, section.moments[0].tStart)} –{" "}
              {clockTime(tripStartedAt, section.moments[section.moments.length - 1].tEnd)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 md:grid-cols-4">
            {section.moments.map((moment) => (
              <MomentTile
                key={moment.id}
                moment={moment}
                tripStartedAt={tripStartedAt}
                hovered={hoveredId === moment.id}
                selected={selectedId === moment.id}
                dimmed={!inWindow(moment)}
                onHover={onHover}
                onSelect={onSelect}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

interface Section {
  id: string;
  label: string;
  moments: MomentSummary[];
}

function groupByPartOfDay(moments: MomentSummary[], tripStartedAt: string): Section[] {
  const sections: Section[] = [];

  for (const moment of [...moments].sort((a, b) => a.tStart - b.tStart)) {
    // The TRIP's local hour, not the viewer's — otherwise a dawn walk in Kyoto
    // files itself under "Evening" for anyone reading it from North America.
    const hour = tripLocalHour(tripStartedAt, moment.tStart);
    const part = PARTS.find((p) => hour < p.until) ?? PARTS[PARTS.length - 1];

    const last = sections[sections.length - 1];
    if (last?.id === part.id) last.moments.push(moment);
    else sections.push({ id: part.id, label: part.label, moments: [moment] });
  }

  return sections;
}
