"use client";

/**
 * The brand mark: the character itself, asleep until you do something.
 *
 * This replaces the four-point SparkMark in the app bar. A drawn glyph is a
 * logo; the robot dozing in the corner of the bar is the product introducing
 * itself, and it costs nothing extra — the frames are already fetched for the
 * hero.
 *
 * ── THE BEAT ────────────────────────────────────────────────────────────────
 *   asleep    the frame the server painted. Eyes shut, sitting down.
 *   waking    one drowsy in-between, ~260ms.
 *   awake     a smile, with a blink every several seconds so it stays alive.
 *   greeting  a wave, while the logo itself is hovered or focused.
 *
 * IT WAKES ON A DELIBERATE ACT — a scroll, a click, a key, or a hover on the
 * mark. Deliberately NOT on `pointermove`: the cursor crosses the window within
 * a few hundred milliseconds of load on most machines, so waking on movement
 * means nobody ever sees it asleep, and the sleeping state is the whole idea.
 *
 * ── TWO RULES INHERITED FROM THE HERO ───────────────────────────────────────
 * NEVER MIRROR A FRAME IN CSS. Several frames carry painted lettering and
 * `scale: -1 1` reverses it. Both facings ship as separate files; `blobSprite`
 * picks one. This mark faces RIGHT, toward the wordmark it sits beside.
 *
 * THE SERVER PAINTS `sleep-0`, and so does the first client render, so there is
 * no swap at hydration and no hole in the bar while a sprite is fetched.
 * `useReducedMotion` is only ever consulted to decide whether to START motion —
 * never to choose what to render — because its server snapshot is a claim.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { preload } from "react-dom";
import { BLOB_CELLS, blobSprite, type BlobFrame } from "@/lib/blobSprites";
import { useReducedMotion } from "@/lib/useReducedMotion";

type Phase = "asleep" | "waking" | "awake" | "greeting";

/** Which way it looks. It sits left of the wordmark, so it faces into it. */
const FACING = "right";

/** The drowsy in-between. Long enough to read at 26px, short enough to feel awake. */
const WAKE_MS = 260;
/** How long a blink lasts, and the window the next one is scheduled in. */
const BLINK_MS = 190;
const BLINK_MIN_MS = 4200;
const BLINK_SPREAD_MS = 5200;

const FRAME: Record<Phase, BlobFrame> = {
  asleep: "sleep-0",
  waking: "wake-1",
  awake: "smile",
  greeting: "wave",
};

/**
 * The acts that count as "you are here".
 *
 * `pointerdown` rather than `click` so a tap anywhere counts even if it lands on
 * nothing; `scroll` because on a landing page that is usually the first thing
 * anyone does.
 */
const WAKE_EVENTS = ["scroll", "pointerdown", "keydown", "wheel", "touchstart"] as const;

/**
 * `size` is the character's height in px, and 30 is close to the floor.
 *
 * The face is the whole drawing — two eyes and a mouth inside a 30px oval — and
 * at 26 the closed-eye sleeping pose degraded into a plain grey blob with no
 * readable expression, which is a worse logo than the spark it replaced. 30 in a
 * 60px bar leaves the cell 41px tall, still comfortably inside the row.
 */
export function BlobMark({ size = 30 }: { size?: number }) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("asleep");
  const [blinking, setBlinking] = useState(false);
  /** Hover is remembered separately so a blink cannot cancel a greeting. */
  const [near, setNear] = useState(false);
  const awoken = useRef(false);

  // ── Waking ────────────────────────────────────────────────────────────────
  // One listener set, removed the moment it fires. `once` on each would still
  // leave the other four armed for the life of the page.
  //
  // One implementation and one guard, shared by the window listeners and the
  // hover handler. `awoken` is a ref rather than state because nothing renders
  // from it — it exists only to make the first wake the only wake, and a second
  // render to record "already awake" would be a render for no reason.
  //
  // It is deliberately NOT the latest-ref pattern. Writing a ref during render
  // is what `react-hooks/refs` forbids, and the cost this avoids is imaginary:
  // the identity only changes when the reduced-motion preference does, which is
  // roughly never, and re-subscribing five passive listeners is free.
  const rouse = useCallback(() => {
    if (awoken.current) return;
    awoken.current = true;
    for (const f of ["wake-1", "smile", "wink", "wave"] as const) {
      preload(blobSprite(f, FACING), { as: "image" });
    }
    // Under reduced motion it is simply awake — the in-between is animation,
    // but which pose it holds is information and stays.
    setPhase(reduced ? "awake" : "waking");
  }, [reduced]);

  useEffect(() => {
    for (const e of WAKE_EVENTS) {
      window.addEventListener(e, rouse, { passive: true });
    }
    return () => {
      for (const e of WAKE_EVENTS) window.removeEventListener(e, rouse);
    };
  }, [rouse]);

  // The stir hands over to the smile on its own clock. Its own effect rather
  // than a timer inside `wake`, so it is cleaned up if the bar unmounts mid-beat.
  useEffect(() => {
    if (phase !== "waking") return;
    const t = setTimeout(() => setPhase("awake"), WAKE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // ── Blinking ──────────────────────────────────────────────────────────────
  // Only while it is plainly awake: blinking through a wave reads as a glitch,
  // and a sleeping blob has its eyes shut already.
  useEffect(() => {
    if (phase !== "awake" || reduced) return;
    // One handle, reassigned. The chain is shut/open/shut..., so at most one
    // timer is ever outstanding and the cleanup only has to cancel that one.
    let timer: ReturnType<typeof setTimeout>;
    // The interval is re-randomised each time rather than fixed — a blink on a
    // metronome is the tell that it is a loop and not a creature.
    const shut = () => {
      setBlinking(true);
      timer = setTimeout(open, BLINK_MS);
    };
    const open = () => {
      setBlinking(false);
      timer = setTimeout(shut, BLINK_MIN_MS + Math.random() * BLINK_SPREAD_MS);
    };
    timer = setTimeout(shut, BLINK_MIN_MS + Math.random() * BLINK_SPREAD_MS);
    return () => {
      clearTimeout(timer);
      setBlinking(false);
    };
  }, [phase, reduced]);

  // Hovering the mark greets you — but only once it is up, so a cursor that
  // lands on a sleeping robot wakes it first and waves after, rather than
  // snapping straight to a wave from a dead sleep.
  const enter = () => {
    setNear(true);
    rouse();
  };

  const showing: BlobFrame =
    near && phase === "awake" ? FRAME.greeting : blinking ? "wink" : FRAME[phase];

  const cell = BLOB_CELLS.base;

  return (
    <span
      className="blob-mark"
      data-phase={phase}
      data-near={near ? "" : undefined}
      // `size` is the CHARACTER's height, not the box's. The cell is taller than
      // the drawing (headroom for the Zzz and the "?"), so the box is inflated by
      // exactly the fraction of it that is character — the same arithmetic the
      // hero does, which is why the two are the same creature at two scales.
      style={
        {
          "--mark-body": `${size}px`,
          "--mark-body-h": cell.bodyH,
          "--mark-cell-ar": cell.cellAr,
          "--mark-foot-y": cell.footY,
        } as React.CSSProperties
      }
      onPointerEnter={enter}
      onPointerLeave={() => setNear(false)}
      onFocus={enter}
      onBlur={() => setNear(false)}
    >
      {/* A raw <img> for the same reason the hero's is one: these are encoded at
          a quality picked against the artwork, and next/image would re-encode
          them at 75 and throw that away. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={blobSprite(showing, FACING)}
        alt=""
        aria-hidden
        draggable={false}
        width={cell.width}
        height={cell.height}
        decoding="sync"
        fetchPriority="high"
        className="blob-mark__sprite"
      />
    </span>
  );
}
