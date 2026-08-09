"use client";

/**
 * The companion, and the app's primary action.
 *
 * The robot IS the button. That is the whole idea: the thing you are being asked
 * to send out into the world is the thing you click, rather than a pill floating
 * somewhere near it.
 *
 * Two element types, deliberately:
 *
 *   idle / pending / error   <button>  — it starts a trip
 *   recording / processing   <a>       — it jumps to the live session card
 *
 * Stopping a trip from the hero would be a surprise, and the app already has one
 * canonical stop in RecordControl. A second one would be the kind of duplicated
 * primary this codebase keeps arguing against. And a control that navigates has
 * to be a link, not a button.
 *
 * The walk cycle is a CSS steps() animation over a packed sprite sheet: one
 * composited background-position change per frame, no rAF, no JS timers, and
 * therefore no exposure to the react-hooks purity/effect rules at all.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveTrip } from "@/components/shell/LiveTripProvider";
import { elapsedLabel } from "@/lib/useActiveTrip";
import { WALK } from "@/lib/heroAssets";

type BlobState = "idle" | "pending" | "recording" | "processing" | "error";

/** How long the blob keeps the invitation open after your cursor leaves. */
const SLEEP_AFTER_MS = 6000;
/** It walks first, then asks — the prompt lands after the movement reads. */
const WAKE_TO_PROMPT_MS = 450;

export function HeroBlobButton() {
  const { active, elapsedSec, pending, error, start } = useLiveTrip();

  /**
   * resting → waking → awake, and back to resting 6s after you leave.
   *
   * The invitation is not on screen by default: the blob is asleep, you notice
   * it, it reacts, and only then does it ask. Spending the whole offer up front
   * is what made the previous version feel like a banner rather than a
   * character.
   */
  const [wake, setWake] = useState<"resting" | "waking" | "awake">("resting");
  const promptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sleepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rouse = useCallback(() => {
    if (sleepTimer.current) {
      clearTimeout(sleepTimer.current);
      sleepTimer.current = null;
    }
    // Already awake or on the way — re-entering just cancels the nap.
    setWake((w) => {
      if (w !== "resting") return w;
      promptTimer.current = setTimeout(() => setWake("awake"), WAKE_TO_PROMPT_MS);
      return "waking";
    });
  }, []);

  const settle = useCallback(() => {
    if (sleepTimer.current) clearTimeout(sleepTimer.current);
    sleepTimer.current = setTimeout(() => {
      if (promptTimer.current) {
        clearTimeout(promptTimer.current);
        promptTimer.current = null;
      }
      setWake("resting");
    }, SLEEP_AFTER_MS);
  }, []);

  // Timers are the one thing that must not outlive the component.
  useEffect(
    () => () => {
      if (promptTimer.current) clearTimeout(promptTimer.current);
      if (sleepTimer.current) clearTimeout(sleepTimer.current);
    },
    [],
  );

  const state: BlobState = pending
    ? "pending"
    : active?.status === "processing"
      ? "processing"
      : active
        ? "recording"
        : error
          ? "error"
          : "idle";

  const isLive = state === "recording" || state === "processing";

  const label =
    state === "pending"
      ? "Setting off…"
      : state === "recording"
        ? `Following you · ${elapsedLabel(elapsedSec)}`
        : state === "processing"
          ? "Building the album…"
          : state === "error"
            ? (error ?? "Something went wrong")
            : "Start a new journey";

  // A live trip is a state worth announcing whether or not you are looking at
  // the blob, so it overrides the sleep cycle.
  const showLabel = isLive || state === "pending" || state === "error" || wake === "awake";

  const inner = (
    <>
      <span className="hero-blob__label" data-shown={showLabel ? "" : undefined} aria-hidden>
        {state === "recording" && <span className="hero-blob__dot hero-blob__dot--live" />}
        {state === "processing" && <span className="hero-blob__dot hero-blob__dot--work" />}
        {/* Server and client legitimately disagree by up to a second on the very
            first paint: the server renders the snapshot's elapsed and the client
            its own live clock. Same idiom as RecordControl. */}
        <span suppressHydrationWarning>{label}</span>
      </span>

      <span className="hero-blob__sprite" aria-hidden />
      <span className="hero-blob__fly hero-blob__fly--a" aria-hidden />
      <span className="hero-blob__fly hero-blob__fly--b" aria-hidden />
      <span className="hero-blob__fly hero-blob__fly--c" aria-hidden />
    </>
  );

  // The sprite sheet's geometry comes from the generated module, so the CSS can
  // never drift from where the artwork actually is.
  const style = {
    "--walk-src": `url(${WALK.src})`,
    "--walk-frames": WALK.frames,
    "--walk-step": `${100 / (WALK.frames - 1)}%`,
    "--idle-frame": WALK.idleFrame,
    "--cell-ar": WALK.cellAr,
  } as React.CSSProperties;

  if (isLive) {
    return (
      <a
        href="#session"
        data-state={state}
        style={style}
        className="hero-blob"
        aria-label={
          state === "recording"
            ? `Trip in progress, ${elapsedLabel(elapsedSec)}. Jump to the live session`
            : "Building the album. Jump to the live session"
        }
      >
        {inner}
      </a>
    );
  }

  return (
    <button
      type="button"
      data-state={state}
      data-wake={wake}
      style={style}
      className="hero-blob"
      disabled={state === "pending"}
      onClick={() => void start()}
      onPointerEnter={rouse}
      onPointerLeave={settle}
      onFocus={rouse}
      onBlur={settle}
      // The visible label comes and goes, so it is marked aria-hidden and the
      // accessible name lives here permanently — a control whose name appears
      // only on hover is nameless to a screen reader.
      aria-label="Start a new journey"
      title="Opens a recording session. The rover-follow behaviour is not implemented yet."
    >
      {inner}
    </button>
  );
}
