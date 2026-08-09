"use client";

/**
 * Start and stop a trip, from the toolbar.
 *
 * Colour follows the palette's existing meanings rather than inventing new ones:
 *
 *   idle       machine green  — SOLID fill, dark text. The one primary action.
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

  if (field) {
    // The journal's primary action is the brass pill — the same one the landing
    // uses to open a walk. Idle is the only state that gets a filled control.
    return (
      <button
        type="button"
        onClick={() => void start()}
        disabled={pending}
        aria-label="Start a trip?"
        title="Opens a recording session. The rover-follow behaviour is not implemented yet."
        className="pill-brass px-4 py-2 text-[13px] disabled:opacity-60"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-ink/55" />
        {pending ? "Starting…" : "Start a trip?"}
      </button>
    );
  }

  // Idle is the app's one primary action, so it is the one place that takes a
  // SOLID fill. `bg-machine-400 text-ink-950` measures 10.9:1 — a shade better
  // than the brand orange it replaces, and it now matches the green already
  // carrying the active view pill, the focus rings and the device toggle, so the
  // chrome reads as one system instead of two accents. The live states below
  // keep their own state colours; see the header.
  //
  // This is a deliberate exception to the "brand orange is the primary action"
  // rule in globals.css — the rule's real job is that orange never becomes a
  // category, and it still never does.
  return (
    <button
      type="button"
      onClick={() => void start()}
      disabled={pending}
      // The accessible name matches the visible label exactly, question mark and
      // all: a speech-input user says what they can see.
      aria-label="Start a trip?"
      title="Opens a recording session. The rover-follow behaviour is not implemented yet."
      className={`${PILL} border-transparent bg-machine-400 font-semibold text-ink-950 hover:bg-machine-300 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-machine-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-ink-950/55" />
      <span className={compact ? "hidden sm:inline" : ""}>
        {pending ? "Starting…" : "Start a trip?"}
      </span>
    </button>
  );
}
