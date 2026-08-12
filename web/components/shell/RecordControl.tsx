"use client";

/**
 * The trip, from the toolbar. Report and stop — starting is hardware's job.
 *
 * Colour follows the palette's existing meanings rather than inventing new ones:
 *
 *   idle       fog            — a muted STATUS. No rover, no session, no action.
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

/**
 * The same control, in the journal's voice.
 *
 * Two tones rather than two components, because the STATE MACHINE is the hard
 * part — confirm-on-stop, the 4s revert, processing, the pending guard — and it
 * has exactly one correct implementation. Only the paint differs:
 *
 *   aurora  the app bar's navy chrome (fog / machine / signal / compute)
 *   field   cream paper (moss / clay / brass), sharp corners, .fnote lettering
 *
 * The semantics are held constant across both: recording is the "measured, live"
 * ink, a destructive confirm is the crossing-out ink, and processing is the
 * still-being-computed ink. Only the hex changes.
 */
export type RecordTone = "aurora" | "field";

const FIELD_PILL =
  "inline-flex shrink-0 items-center gap-2 rounded-[3px] px-3 py-1.5 text-[12px] transition-colors";

const CONFIRM_TIMEOUT_MS = 4000;

export function RecordControl({
  compact = false,
  tone = "aurora",
}: {
  compact?: boolean;
  tone?: RecordTone;
}) {
  const { active, elapsedSec, pending, stop } = useLiveTrip();
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

  const field = tone === "field";

  if (active?.status === "processing") {
    return field ? (
      <span className={`${FIELD_PILL} fnote chip text-[10.5px] text-lagoon`}>
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-lagoon" />
        [ {compact ? "processing" : `processing · ${active.counters.moments} moments`} ]
      </span>
    ) : (
      <span className={`${PILL} border-compute-500/45 bg-compute-500/12 text-compute-400`}>
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-compute-400" />
        {compact ? "Processing" : `Processing… ${active.counters.moments} moments`}
      </span>
    );
  }

  if (active) {
    if (confirming) {
      return field ? (
        <span className={`${FIELD_PILL} fnote chip chip-synth text-[10.5px]`}>
          <span className="hidden sm:inline">[ stop the trip? ]</span>
          <button
            type="button"
            onClick={() => {
              setArmed(false);
              void stop();
            }}
            disabled={pending}
            className="font-semibold text-clay underline-offset-2 hover:underline disabled:opacity-60"
          >
            Confirm
          </button>
          <span aria-hidden className="text-ink-faint">
            ·
          </span>
          <button
            type="button"
            onClick={() => setArmed(false)}
            className="text-ink-faint transition-colors hover:text-ink"
          >
            Cancel
          </button>
        </span>
      ) : (
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

    const stopLabel = `Recording, ${elapsedLabel(elapsedSec)}. Stop trip`;

    return field ? (
      <button
        type="button"
        onClick={() => setArmed(true)}
        aria-label={stopLabel}
        className={`${FIELD_PILL} fnote chip chip-live text-[10.5px] hover:bg-vellum`}
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-moss" />
        {/* Server and client can disagree by a second here — the server renders
            the snapshot's elapsed, the client its own live clock. */}
        <span className="tnum" suppressHydrationWarning>
          [ recording · {elapsedLabel(elapsedSec)} ]
        </span>
        <span className="hidden text-ink-soft sm:inline">· stop</span>
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setArmed(true)}
        aria-label={stopLabel}
        className={`${PILL} border-signal-500/45 bg-signal-500/12 text-signal-400 hover:bg-signal-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/60`}
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal-400" />
        <span className="tnum" suppressHydrationWarning>
          {elapsedLabel(elapsedSec)}
        </span>
        <span className="hidden sm:inline">· Stop</span>
      </button>
    );
  }

  // ── Idle: a STATUS, not an action ──────────────────────────────────────────
  //
  // This used to be the app's one primary action — a solid green "Start a trip?"
  // that opened a session and filled the toolbar with a live clock and counters
  // extrapolated from elapsed time. Nothing was driving any of it, because
  // nobody has a rover.
  //
  // So the control reports a condition instead. A session now opens only when
  // hardware POSTs to /api/ingest/* (see openTripForIngest in lib/liveTrip.ts),
  // and at that instant every branch above this one starts working on its own —
  // clock, counters, stop — with no code change here.
  //
  // Deliberately still rendered. The rover is a real part of the product's
  // shape, and an absent control reads as "this does not exist" rather than
  // "this is not plugged in". Matches RoverGate on /live.
  if (field) {
    return (
      <span
        className={`${FIELD_PILL} fnote text-[10.5px] text-ink-faint opacity-60`}
        aria-disabled="true"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-ink/25" />
        [ no rover connected ]
      </span>
    );
  }

  return (
    <span
      className={`${PILL} border-fog-700/40 bg-fog-900/40 text-fog-400`}
      aria-disabled="true"
      title="A trip opens by itself when a rover starts reporting."
    >
      <span className="h-1.5 w-1.5 rounded-full bg-fog-600" />
      <span className={compact ? "hidden sm:inline" : ""}>No rover connected</span>
    </span>
  );
}
