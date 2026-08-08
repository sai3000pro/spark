"use client";

/**
 * Start and stop a trip, from the toolbar.
 *
 * Colour follows the palette's existing meanings rather than inventing new ones:
 *
 *   idle       brand orange   — SOLID fill. This is the app's one primary action,
 *                               and a solid brand fill on a primary action is
 *                               exactly what globals.css permits brand orange to
 *                               be. It is the only state that is brand-coloured.
 *   recording  signal green   — the palette's "active / navigable", and the same
 *                               green as the follow dot
 *   confirming fail rose      — a destructive-ish confirm
 *   processing compute violet — the palette already means "still being computed"
 *                               here, and SplatStage's compute badge uses it for
 *                               exactly this
 *
 * The three live states stay on STATE colours, not brand: once a trip is running
 * the pill is reporting a condition, not offering the primary action.
 *
 * Confirm-on-stop is a two-step inline swap rather than window.confirm: a browser
 * dialog blocks the event loop, cannot be styled, and reads as defensive. This
 * reverts itself after 4s if ignored.
 */
import { useEffect, useState } from "react";
import { useLiveTrip } from "@/components/shell/LiveTripProvider";
import { elapsedLabel } from "@/lib/useActiveTrip";

const PILL = "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 font-mono text-[11px] transition-colors";

const CONFIRM_TIMEOUT_MS = 4000;

export function RecordControl({ compact = false }: { compact?: boolean }) {
  const { active, elapsedSec, pending, start, stop } = useLiveTrip();
  const [armed, setArmed] = useState(false);

  // Derived, not synced: if the trip ends some other way, the confirm state
  // simply stops applying rather than needing an effect to tear it down.
  const confirming = armed && active?.status === "recording";

  // Let an ignored confirm quietly undo itself.
  useEffect(() => {
    if (!confirming) return;
    const id = setTimeout(() => setArmed(false), CONFIRM_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [confirming]);

  if (active?.status === "processing") {
    return (
      <span className={`${PILL} border-compute-500/45 bg-compute-500/12 text-compute-400`}>
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-compute-400" />
        {compact ? "Processing" : `Processing… ${active.counters.moments} moments`}
      </span>
    );
  }

  if (active) {
    if (confirming) {
      return (
        <span className={`${PILL} border-fail-400/45 bg-fail-400/10 text-fail-400`}>
          <span className="hidden sm:inline">Stop trip?</span>
          <button
            type="button"
            onClick={() => {
              setArmed(false);
              void stop();
            }}
            disabled={pending}
            className="font-semibold underline-offset-2 hover:underline disabled:opacity-60"
          >
            Confirm
          </button>
          <span aria-hidden className="text-fog-400">
            ·
          </span>
          <button
            type="button"
            onClick={() => setArmed(false)}
            className="text-fog-400 transition-colors hover:text-fog-200"
          >
            Cancel
          </button>
        </span>
      );
    }

    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        aria-label={`Recording, ${elapsedLabel(elapsedSec)}. Stop trip`}
        className={`${PILL} border-signal-500/45 bg-signal-500/12 text-signal-400 hover:bg-signal-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/60`}
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal-400" />
        {/* Server and client can disagree by a second here — the server renders
            the snapshot's elapsed, the client its own live clock. */}
        <span className="tnum" suppressHydrationWarning>
          {elapsedLabel(elapsedSec)}
        </span>
        <span className="hidden sm:inline">· Stop</span>
      </button>
    );
  }

  // Idle is the app's one primary action, so it is the one place that takes a
  // SOLID brand fill. `bg-brand-400 text-ink-950` measures 9.41:1. The live
  // states below keep their state colours — see the header.
  return (
    <button
      type="button"
      onClick={() => void start()}
      disabled={pending}
      aria-label="Start a trip"
      title="Opens a recording session. The rover-follow behaviour is not implemented yet."
      className={`${PILL} border-transparent bg-brand-400 font-semibold text-ink-950 hover:bg-brand-300 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-ink-950/55" />
      <span className={compact ? "hidden sm:inline" : ""}>
        {pending ? "Starting…" : "Start a trip"}
      </span>
    </button>
  );
}
