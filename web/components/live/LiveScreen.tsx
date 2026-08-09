"use client";

/**
 * The live screen's client half.
 *
 * It exists to own the LiveTripProvider. `/live` sits outside app/(app), which
 * is where the provider used to be mounted for the whole aurora subtree — and
 * the journal has no equivalent shell, because the journal's pages are mostly
 * one full-bleed surface with no persistent bar. So the page provides its own,
 * exactly as components/home/TickerBlob.tsx does for the landing's companion.
 *
 * The provider is what `useLiveTrip()` reads; without it RecordControl throws.
 */
import { LiveTripProvider, useLiveTrip } from "@/components/shell/LiveTripProvider";
import { RecordControl } from "@/components/shell/RecordControl";
import { VideoWalkPanel } from "@/components/live/VideoWalkPanel";
import type { ActiveTripSnapshot } from "@/lib/liveTrip";

export function LiveScreen({ initial }: { initial: ActiveTripSnapshot | null }) {
  return (
    <LiveTripProvider initial={initial}>
      <section
        className="plate-vellum rise-in relative p-5 sm:p-6"
        style={{ "--i": 1 } as React.CSSProperties}
      >
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <span className="fnote text-[10px] text-ink-faint">[ 01 ]</span>
            <h2 className="mt-1 text-[20px] leading-tight text-ink">Follow a walk live</h2>
            <p className="mt-1.5 max-w-prose text-[13.5px] leading-relaxed text-ink-soft">
              Opens a recording session and counts what comes in. The rover-follow behaviour is not
              implemented — nothing is driving the robot, and the counters below are extrapolated
              from the real pipeline&apos;s rates until hardware reports in.
            </p>
          </div>
          <RecordControl tone="field" />
        </header>

        <LiveCounters />
      </section>

      <VideoWalkPanel />
    </LiveTripProvider>
  );
}

/**
 * The three stages, live.
 *
 * Reads the same snapshot the app bar does. `simulated` is surfaced rather than
 * hidden: the moment /api/ingest/* reports real numbers the badge disappears on
 * its own, with no code change — that is the whole point of the seam in
 * lib/liveTrip.ts.
 *
 * A child of the provider rather than part of LiveScreen's own body, because a
 * component cannot consume a context it renders itself.
 */
function LiveCounters() {
  const { active } = useLiveTrip();

  if (!active) {
    return (
      <p className="fnote mt-4 text-[10px] text-ink-faint">
        [ nothing running · the counters appear once a session opens ]
      </p>
    );
  }

  const rows: Array<[string, number]> = [
    ["detections", active.counters.detections],
    ["candidates", active.counters.candidates],
    ["moments", active.counters.moments],
  ];

  return (
    <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2">
      {rows.map(([label, n]) => (
        <span key={label} className="flex items-baseline gap-1.5">
          <span className="tnum text-[19px] leading-none text-ink" suppressHydrationWarning>
            {n.toLocaleString()}
          </span>
          <span className="fnote text-[9.5px] text-ink-faint">{label}</span>
        </span>
      ))}
      {active.simulated && (
        <span className="fnote chip chip-synth ml-auto text-[9.5px]">
          [ extrapolated · no hardware reporting ]
        </span>
      )}
    </div>
  );
}
