"use client";

/**
 * The robot's telemetry, in the corner of the app bar.
 *
 * The follow pill is DRIVEN now. It used to render "Follow" with a pulsing dot
 * unconditionally, which was a standing lie: no robot is connected and nothing is
 * following anyone. It now says Idle, without animation, until a trip is actually
 * recording — and the tooltip still admits the telemetry is mock.
 *
 * Hidden below lg: at phone width the items that matter are the brand, the view
 * switch, the record control, search and identity. Battery is not one of them.
 */
import { useLiveTrip } from "@/components/shell/LiveTripProvider";

/** No robot is connected. When one is, these come off the wire. */
const MOCK_TELEMETRY = { batteryPercent: 78 } as const;

export function TelemetryPills() {
  const { active, elapsedSec } = useLiveTrip();
  const following = active?.status === "recording" || active?.status === "starting";

  // Drains while a trip runs. Mock, but it makes the live state feel alive rather
  // than being a number frozen at 78 forever.
  const battery = following
    ? Math.max(12, MOCK_TELEMETRY.batteryPercent - Math.floor(elapsedSec / 480))
    : MOCK_TELEMETRY.batteryPercent;

  return (
    <div className="hidden shrink-0 items-center gap-2 lg:flex">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] ${
          following
            ? "border-machine-400/25 bg-machine-400/10 text-machine-400"
            : "border-white/[0.07] text-fog-400"
        }`}
        title="Mock telemetry — no robot is connected yet."
      >
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            following ? "animate-pulse bg-signal-400" : "bg-fog-400"
          }`}
        />
        {following ? "Follow" : "Idle"}
      </span>
      <Battery percent={battery} />
    </div>
  );
}

function Battery({ percent }: { percent: number }) {
  return (
    <span className="tnum flex items-center gap-1 font-mono text-[11px] text-fog-400">
      <svg width="16" height="10" viewBox="0 0 16 10" fill="none" aria-hidden>
        <rect x="0.5" y="0.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeOpacity="0.5" />
        <rect x="14" y="3" width="1.5" height="4" rx="0.5" fill="currentColor" fillOpacity="0.4" />
        <rect
          x="2"
          y="2"
          width={Math.max(1, (percent / 100) * 10)}
          height="6"
          rx="0.5"
          fill="currentColor"
          fillOpacity="0.55"
        />
      </svg>
      <span suppressHydrationWarning>{percent}%</span>
    </span>
  );
}
