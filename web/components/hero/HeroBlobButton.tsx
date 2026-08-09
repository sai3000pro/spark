"use client";

/**
 * The companion, and the app's primary action.
 *
 * The robot IS the button. That is the whole idea: the thing you are being asked
 * to send out into the world is the thing you click, rather than a pill floating
 * somewhere near it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS ASLEEP UNTIL YOU NOTICE IT.
 *
 * The invitation is not on screen by default. The blob is asleep, you come near,
 * it stirs, and only THEN does it ask. Spending the whole offer up front is what
 * made the previous version feel like a banner rather than a character. Leave,
 * and it nods off again.
 *
 * Every beat is a different drawing now, not the same drawing dimmed — the pose
 * set (lib/blobSprites.ts) has an actual sleeping blob with painted Zzz and an
 * actual asking one with a question mark. That is why this file replaced a CSS
 * sprite-sheet animation with an <img> whose src changes.
 *
 * ONE RULE ABOUT FACING, AND IT IS NOT NEGOTIABLE: never mirror the sprite in
 * CSS. `sleep` and `question` carry painted lettering, and `scale: -1 1` turns
 * the Zzz into three backwards z's. Both facings exist as separate files with
 * the lettering composited the right way round; `blobSprite(pose, facing)` picks
 * one. There is no transform that can substitute.
 *
 * YOU CAN ALSO PICK IT UP AND THROW IT. Drag past a few pixels and it comes off
 * the ground; let go and it flies, bounces, lands, and walks back to its spot.
 * This is play — nothing in the app is reachable only by flinging the blob, and
 * it is deliberately NOT keyboard-operable for that reason. What is keyboard
 * operable is everything that matters: focus produces the same wake-and-ask beat
 * as hover, and Enter starts the trip.
 *
 * Two element types, deliberately:
 *
 *   idle / pending / error   <button>  — it starts a trip
 *   recording / processing   <a>       — it goes to the live trip
 *
 * Stopping a trip from the hero would be a surprise, and the app already has one
 * canonical stop in RecordControl. And a control that navigates has to be a
 * link, not a button. A live trip is not draggable: the character is out working.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { preload } from "react-dom";
import { useRouter } from "next/navigation";
import { useLiveTrip } from "@/components/shell/LiveTripProvider";
import { elapsedLabel } from "@/lib/useActiveTrip";
import {
  BLOB_SPRITE,
  blobSprite,
  type BlobFacing,
  type BlobPose,
} from "@/lib/blobSprites";
import {
  airFraction,
  clamp,
  releaseVelocity,
  stepBallistic,
  stepWalk,
  tumble,
  type Env,
  type Motion,
  type Sample,
} from "@/lib/blobPhysics";
import { useReducedMotion } from "@/lib/useReducedMotion";

type BlobState = "idle" | "pending" | "recording" | "processing" | "error";

/**
 * Where the character is in its own little life, independent of the trip's
 * state. The two are orthogonal on purpose: `state` is what the SERVER thinks is
 * happening, `phase` is what the character is doing about it.
 */
type Phase =
  | "asleep"
  | "waking"
  | "asking"
  | "grabbed"
  | "flying"
  | "landing"
  | "walking"
  | "crouching"
  | "launched";

/**
 * Which way it looks at rest. The blob is anchored right of centre on the plate,
 * so it faces left — into the frame and toward the headline, rather than off the
 * edge of the picture.
 */
const REST_FACING: BlobFacing = "left";

/** How long the blob keeps the invitation open after your cursor leaves. */
const SLEEP_AFTER_MS = 6000;
/** It stirs first, then asks — the prompt lands after the reaction reads. */
const WAKE_TO_PROMPT_MS = 450;
/** Anticipation before the leap. Short: any longer and it reads as hesitation. */
const CROUCH_MS = 140;
/** The squash on touchdown. */
const LAND_MS = 220;
/** If the server never answers, come back down rather than hang in the air. */
const LAUNCH_TIMEOUT_MS = 6000;

/** Hold this long on a touch screen to pick the blob up instead of scrolling. */
const LONG_PRESS_MS = 250;
/** Past this, a mouse gesture is a drag and not a click. */
const DRAG_THRESHOLD_PX = 6;
/** Move further than this before the long press fires and you meant to scroll. */
const TOUCH_SLOP_PX = 10;
/** Below this release speed there is no flight — it just walks back. */
const MIN_FLING_PXS = 120;
/** A flick of the wrist should not put it into orbit. */
const MAX_FLING_PXS = 2600;
/** Upward launch speed, in character-heights per second. */
const LEAP_V = 5;
/** How far it may be thrown, as fractions of the plate box. */
const ROAM = { left: 0.18, right: 0.3, ceiling: 0.55 };
/** One walk frame per this much ground covered, in character-heights. */
const WALK_STRIDE = 0.28;

const WALK_CYCLE = [
  "walk-1",
  "walk-2",
  "walk-3",
  "walk-4",
] as const satisfies readonly BlobPose[];

/** Poses fetched when it first stirs — the wake beat covers the round trip. */
const WARM_WAKE: BlobPose[] = ["stand", "question"];
/** Poses fetched on first touch — the long press and the drag cover these. */
const WARM_PLAY: BlobPose[] = [
  "surprised",
  "crouch",
  "hop",
  "hover",
  ...WALK_CYCLE,
];

interface Grab {
  id: number;
  x0: number;
  y0: number;
  /** Where the blob already was when the gesture started. */
  ox: number;
  oy: number;
  engaged: boolean;
  pointerType: string;
}

export function HeroBlobButton() {
  const { active, elapsedSec, pending, error, start } = useLiveTrip();
  const router = useRouter();
  const reduced = useReducedMotion();

  const [phase, setPhase] = useState<Phase>("asleep");
  const [facing, setFacing] = useState<BlobFacing>(REST_FACING);
  const [walkFrame, setWalkFrame] = useState(0);
  /**
   * Why it is in the air, which is not the same question as whether it is.
   *
   * A LEAP is the blob launching itself off the lit path, and `hop` — which is
   * drawn with the path's glow under its feet — is exactly that picture. A THROW
   * is the blob being hurled through the sky by you, where that same painted
   * glow follows it up into the air and reads as a light with nothing to shine
   * on. Thrown, it is simply startled.
   */
  const [flight, setFlight] = useState<"leap" | "throw">("throw");

  const rootRef = useRef<HTMLButtonElement | null>(null);
  const motion = useRef<Motion>({ x: 0, y: 0, vx: 0, vy: 0, hold: false });
  const grab = useRef<Grab | null>(null);
  const samples = useRef<Sample[]>([]);
  /** The last gesture was a throw, so the click it produces is not a click. */
  const dragged = useRef(false);
  /** What kind of pointer last touched it — a hybrid laptop has both. */
  const pointerKind = useRef<string>("mouse");

  const promptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sleepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const warmedWake = useRef(false);
  const warmedPlay = useRef(false);
  const prefetched = useRef(false);

  const state: BlobState = pending
    ? "pending"
    : active?.status === "processing"
      ? "processing"
      : active
        ? "recording"
        : error
          ? "error"
          : "idle";

  /**
   * A launch that came back with an error is, as far as the character is
   * concerned, back to asking — so it is DERIVED rather than written back into
   * state. Storing it would mean an effect that watches for failure and undoes
   * itself, which is a second source of truth for the same fact the error
   * already is.
   */
  const shownPhase: Phase = phase === "launched" && error ? "asking" : phase;

  // Off the ground: not grabbable, and — mid-launch — a reason to stay a
  // <button> even once the trip is live, so the character is not swapped out
  // from under its own hop. The handoff effect navigates a frame later anyway.
  const airborne =
    shownPhase === "crouching" ||
    shownPhase === "flying" ||
    shownPhase === "launched";
  const isLive = (state === "recording" || state === "processing") && !airborne;

  /** On its feet at home — so the offsets should be back at zero. */
  const grounded =
    shownPhase === "asleep" ||
    shownPhase === "waking" ||
    shownPhase === "asking";

  const clearTimer = (
    t: React.RefObject<ReturnType<typeof setTimeout> | null>,
  ) => {
    if (t.current) {
      clearTimeout(t.current);
      t.current = null;
    }
  };

  /**
   * The offsets live on the PLATE BOX, not on the blob.
   *
   * They inherit from there to the blob and to its sibling `.hero-glow`, so the
   * pool of light on the path travels with the character instead of staying
   * pinned to the anchor while the blob sails away from it. A custom property on
   * the blob itself could never reach a sibling.
   *
   * Writing the DOM directly rather than through state: this runs every frame,
   * and a re-render per frame to move one element is the thing rAF exists to
   * avoid.
   */
  const paint = useCallback(
    (x: number, y: number, air: number, spin: number) => {
      const el = rootRef.current;
      const box = el?.parentElement;
      if (!el || !box) return;
      box.style.setProperty("--blob-dx", `${x.toFixed(1)}px`);
      box.style.setProperty("--blob-dy", `${y.toFixed(1)}px`);
      box.style.setProperty("--blob-air", air.toFixed(3));
      el.style.rotate = spin === 0 ? "" : `${spin.toFixed(1)}deg`;
    },
    [],
  );

  const snapHome = useCallback(() => {
    motion.current = { x: 0, y: 0, vx: 0, vy: 0, hold: false };
    paint(0, 0, 0, 0);
  }, [paint]);

  /** The box the blob may be thrown around in, and the yardstick for the physics. */
  const bounds = useCallback((): Env | null => {
    const el = rootRef.current;
    const box = el?.parentElement;
    if (!el || !box) return null;
    const plate = box.getBoundingClientRect();
    return {
      // The CELL is taller than the character; the physics wants the character.
      unit: el.getBoundingClientRect().height * BLOB_SPRITE.bodyH,
      minX: -ROAM.left * plate.width,
      maxX: ROAM.right * plate.width,
      ceiling: -ROAM.ceiling * plate.height,
    };
  }, []);

  const warmWake = useCallback(() => {
    if (warmedWake.current) return;
    warmedWake.current = true;
    for (const pose of WARM_WAKE)
      preload(blobSprite(pose, REST_FACING), { as: "image" });
    if (!prefetched.current) {
      prefetched.current = true;
      router.prefetch("/live");
    }
  }, [router]);

  const warmPlay = useCallback(() => {
    if (warmedPlay.current) return;
    warmedPlay.current = true;
    // Both facings: which way it walks home is not known until it is thrown.
    for (const pose of WARM_PLAY) {
      preload(blobSprite(pose, "left"), { as: "image" });
      preload(blobSprite(pose, "right"), { as: "image" });
    }
  }, []);

  const rouse = useCallback(() => {
    clearTimer(sleepTimer);
    warmWake();
    // Only a sleeping blob can be woken. Anything else — mid-throw, walking
    // home, already asking — is left to finish what it is doing.
    if (phase !== "asleep") return;
    setPhase("waking");
    promptTimer.current = setTimeout(
      () => setPhase("asking"),
      WAKE_TO_PROMPT_MS,
    );
  }, [phase, warmWake]);

  const settle = useCallback(() => {
    clearTimer(sleepTimer);
    sleepTimer.current = setTimeout(() => {
      clearTimer(promptTimer);
      // Six seconds later, so the phase is read HERE rather than captured when
      // your cursor left. An updater, not a read of state, because that is the
      // only way to see the phase as of the moment the nap actually lands.
      setPhase((p) => (p === "waking" || p === "asking" ? "asleep" : p));
    }, SLEEP_AFTER_MS);
  }, []);

  // Timers, the rAF and the offsets are the things that must not outlive the
  // component. The offsets especially: they live on a PARENT that survives this
  // element being swapped for the live <a>, and a blob that was mid-throw when a
  // trip started would leave the ground glow stranded off to one side forever.
  useEffect(
    () => () => {
      clearTimer(promptTimer);
      clearTimer(sleepTimer);
      clearTimer(phaseTimer);
      clearTimer(pressTimer);
      const box = rootRef.current?.parentElement;
      if (box) {
        box.style.removeProperty("--blob-dx");
        box.style.removeProperty("--blob-dy");
        box.style.removeProperty("--blob-air");
      }
    },
    [],
  );

  // ── The physics loop ───────────────────────────────────────────────────────
  // One rAF, owned by the phase that needs it, mutating refs and writing the DOM
  // directly. It calls setState only at transitions and at ≤12 Hz for the walk
  // frame — never per frame.
  useEffect(() => {
    if (phase !== "flying" && phase !== "walking") return;
    const env = bounds();
    if (!env) return;

    let raf = 0;
    let last = performance.now();
    let stride = 0;

    const frame = (now: number) => {
      // Clamped: a backgrounded tab hands back a dt of several seconds, which
      // would teleport the blob through the floor on the first frame back.
      const dt = Math.min(1 / 30, (now - last) / 1000);
      last = now;
      const m = motion.current;

      if (phase === "flying") {
        const result = stepBallistic(m, dt, env);
        paint(m.x, m.y, airFraction(m, env), tumble(m, env));
        if (result === "apex") {
          setPhase("launched");
          return;
        }
        if (result === "landed") {
          paint(m.x, 0, 0, 0);
          setPhase("landing");
          return;
        }
      } else {
        setFacing(m.x > 0 ? "left" : "right");
        const { moved, arrived } = stepWalk(m, dt, env);
        stride += moved;
        if (stride >= WALK_STRIDE * env.unit) {
          stride -= WALK_STRIDE * env.unit;
          setWalkFrame((f) => (f + 1) % WALK_CYCLE.length);
        }
        paint(m.x, 0, 0, 0);
        if (arrived) {
          snapHome();
          setFacing(REST_FACING);
          // If you are still hovering it when it gets back, it picks the
          // conversation up where it left off rather than falling asleep in
          // front of you.
          const over = rootRef.current?.matches(":hover") ?? false;
          setPhase(over ? "asking" : "asleep");
          return;
        }
      }
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [phase, bounds, paint, snapHome]);

  // Touchdown: a beat of squash, then it picks itself up and walks back.
  useEffect(() => {
    if (phase !== "landing") return;
    phaseTimer.current = setTimeout(() => setPhase("walking"), LAND_MS);
    return () => clearTimer(phaseTimer);
  }, [phase]);

  // Standing at home again, so the offsets belong at zero. This is the one place
  // that has to be true however it got there: the end of a walk home, a release
  // under reduced motion, or a launch that failed at the top of its arc.
  useEffect(() => {
    if (grounded) snapHome();
  }, [grounded, snapHome]);

  // ── The handoff ────────────────────────────────────────────────────────────
  // `start()` never rejects — it catches and sets `error` — so this waits on
  // STATE rather than on a promise, and re-runs when the trip or the error
  // arrives. While it waits, the label already reads "Setting off…" under a
  // hovering robot, which is the right picture at any network speed.
  //
  // A FAILED LAUNCH IS DERIVED, NOT STORED (see `shownPhase` below), so there is
  // no state to write back here — an effect whose job is "navigate" should not
  // also be an effect whose job is "undo".
  useEffect(() => {
    if (phase !== "launched" || error) return;
    if (active) {
      router.push("/live");
      return;
    }
    // The server never answered. Come back down rather than hang in the air.
    phaseTimer.current = setTimeout(
      () => setPhase("asking"),
      LAUNCH_TIMEOUT_MS,
    );
    return () => clearTimer(phaseTimer);
  }, [phase, active, error, router]);

  // ── Blocking the scroll, but only once it is actually holding the blob ──────
  // `touch-action` is latched at touchstart, so flipping it when the long press
  // fires is too late. A non-passive native listener is the only thing that can
  // stop the page moving mid-drag — React's onTouchMove is passive and its
  // preventDefault is a no-op. Safe because the long press requires the finger
  // to have been still for 250ms, so no scroll is in flight by then.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const block = (e: TouchEvent) => {
      if (grab.current?.engaged) e.preventDefault();
    };
    el.addEventListener("touchmove", block, { passive: false });
    return () => el.removeEventListener("touchmove", block);
  }, [isLive]);

  const engage = useCallback(() => {
    const g = grab.current;
    if (!g || g.engaged) return;
    g.engaged = true;
    dragged.current = true;
    clearTimer(pressTimer);
    clearTimer(promptTimer);
    clearTimer(sleepTimer);
    setPhase("grabbed");
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    pointerKind.current = e.pointerType;
    // Every gesture starts innocent. A drag that ends in `pointercancel` never
    // produces a click to consume the flag, and a stale one would swallow the
    // NEXT genuine click — the blob would silently refuse to start a trip once.
    dragged.current = false;
    warmPlay();
    // In the air it is not yours to grab — catching it mid-hop would leave the
    // launch waiting on a trip it can no longer hand off to.
    if (airborne) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    grab.current = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      ox: motion.current.x,
      oy: motion.current.y,
      engaged: false,
      pointerType: e.pointerType,
    };
    samples.current = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }];
    if (e.pointerType !== "mouse") {
      pressTimer.current = setTimeout(engage, LONG_PRESS_MS);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const g = grab.current;
    if (!g || g.id !== e.pointerId) return;

    samples.current.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
    if (samples.current.length > 6) samples.current.shift();

    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;

    if (!g.engaged) {
      const far = Math.hypot(dx, dy);
      if (g.pointerType === "mouse") {
        if (far > DRAG_THRESHOLD_PX) engage();
        else return;
      } else {
        // Moved before the long press fired: you meant to scroll the page.
        if (far > TOUCH_SLOP_PX) {
          clearTimer(pressTimer);
          if (rootRef.current?.hasPointerCapture(e.pointerId)) {
            rootRef.current.releasePointerCapture(e.pointerId);
          }
          grab.current = null;
        }
        return;
      }
    }

    const env = bounds();
    if (!env) return;
    const m = motion.current;
    m.x = clamp(g.ox + dx, env.minX, env.maxX);
    m.y = clamp(g.oy + dy, env.ceiling, 0);
    paint(m.x, m.y, airFraction(m, env), 0);
  };

  /**
   * One exit for every way a gesture can end.
   *
   * `lostpointercapture` is in there for a reason that is easy to miss: if
   * `pending` flips true mid-gesture React sets `disabled` on the button, the
   * element stops receiving pointer events, and without this the drag would die
   * with the blob stranded wherever it happened to be.
   */
  const release = () => {
    const g = grab.current;
    if (!g) return;
    clearTimer(pressTimer);
    grab.current = null;
    if (!g.engaged) return; // A click. onClick has it.

    const trail = samples.current;
    samples.current = [];
    const env = bounds();
    if (!env) return;

    // Direct manipulation survives reduced motion — the blob followed your
    // finger and that is not decoration. What is skipped is the SIMULATION: it
    // returns to its spot instead of flying and walking there.
    if (reduced) {
      snapHome();
      setPhase("asking");
      return;
    }

    const v = releaseVelocity(trail);
    const m = motion.current;
    m.vx = clamp(v.vx, -MAX_FLING_PXS, MAX_FLING_PXS);
    m.vy = clamp(v.vy, -MAX_FLING_PXS, MAX_FLING_PXS);
    m.hold = false;
    setFlight("throw");
    // Put down gently while already on the ground: no flight, just a walk back.
    setPhase(Math.hypot(m.vx, m.vy) < MIN_FLING_PXS && m.y >= 0 ? "walking" : "flying");
  };

  const launch = () => {
    clearTimer(promptTimer);
    clearTimer(sleepTimer);
    // The network call goes out NOW, in parallel with the anticipation — the
    // animation is cover for the round trip, not a thing that delays it.
    void start();
    setFlight("leap");
    setPhase("crouching");
    phaseTimer.current = setTimeout(() => {
      const env = bounds();
      if (!env || reduced) {
        setPhase("launched");
        return;
      }
      motion.current = {
        x: motion.current.x,
        y: 0,
        vx: 0,
        vy: -LEAP_V * env.unit,
        hold: true,
      };
      setPhase("flying");
    }, CROUCH_MS);
  };

  const onClick = () => {
    // The gesture that just ended was a throw. Throwing the robot is not a
    // request to send it out into the world.
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    if (state !== "idle" && state !== "error") return;
    // A touch screen has no hover to give, so the first tap IS the hover: it
    // wakes the blob and lets it ask. Only the second one sends it out. A
    // character that launched on first contact would never get to ask.
    if (pointerKind.current !== "mouse" && shownPhase !== "asking") {
      rouse();
      return;
    }
    launch();
  };

  /** The drawing to show. A pure function of the trip, the phase and the frame. */
  const pose: BlobPose =
    shownPhase === "grabbed"
      ? "surprised"
      : shownPhase === "crouching" || shownPhase === "landing"
        ? "crouch"
        : shownPhase === "flying"
          ? flight === "leap"
            ? "hop"
            : "surprised"
          : shownPhase === "launched"
            ? "hover"
            : shownPhase === "walking"
              ? WALK_CYCLE[walkFrame]
              : state === "pending"
                ? "hover"
                : state === "recording"
                  ? "hover"
                  : state === "processing"
                    ? "smile"
                    : state === "error"
                      ? "surprised"
                      : shownPhase === "asking"
                        ? "question"
                        : shownPhase === "waking"
                          ? "stand"
                          : "sleep";

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
  const showLabel =
    isLive ||
    state === "pending" ||
    state === "error" ||
    shownPhase === "asking";

  const inner = (
    <>
      <span
        className="hero-blob__label"
        data-shown={showLabel ? "" : undefined}
        aria-hidden
      >
        {state === "recording" && (
          <span className="hero-blob__dot hero-blob__dot--live" />
        )}
        {state === "processing" && (
          <span className="hero-blob__dot hero-blob__dot--work" />
        )}
        {/* Server and client legitimately disagree by up to a second on the very
            first paint: the server renders the snapshot's elapsed and the client
            its own live clock. Same idiom as RecordControl. */}
        <span suppressHydrationWarning>{label}</span>
      </span>

      {/* A raw <img> for the same reason the plate is one: these are encoded at a
          quality chosen against the artwork (the eyes are two amber discs and
          they are the whole face), and next/image would re-encode them at 75 and
          throw that away. It also has to be in the server HTML — a CSS
          background from an inline custom property is not discovered until style
          resolution, and the character would be a hole in the scene until then. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="hero-blob__sprite"
        src={blobSprite(pose, facing)}
        alt=""
        aria-hidden
        draggable={false}
        width={BLOB_SPRITE.width}
        height={BLOB_SPRITE.height}
        decoding="sync"
        fetchPriority="high"
      />
      <span className="hero-blob__fly hero-blob__fly--a" aria-hidden />
      <span className="hero-blob__fly hero-blob__fly--b" aria-hidden />
      <span className="hero-blob__fly hero-blob__fly--c" aria-hidden />
    </>
  );

  // The cell's geometry comes from the generated module, so the CSS can never
  // drift from where the artwork actually is. `bodyH` is the one that matters:
  // the cell is taller than the blob (headroom for the Zzz and the "?", room for
  // the hover glow), so the CSS has to inflate the box by exactly the fraction
  // of it that is character.
  const style = {
    "--sprite-cell-ar": BLOB_SPRITE.cellAr,
    "--sprite-foot-y": BLOB_SPRITE.footY,
    "--sprite-body-h": BLOB_SPRITE.bodyH,
    "--sprite-body-w": BLOB_SPRITE.bodyW,
  } as React.CSSProperties;

  if (isLive) {
    return (
      <a
        href="/live"
        data-state={state}
        style={style}
        className="hero-blob"
        aria-label={
          state === "recording"
            ? `Trip in progress, ${elapsedLabel(elapsedSec)}. Open the live trip`
            : "Building the album. Open the live trip"
        }
      >
        {inner}
      </a>
    );
  }

  return (
    <button
      ref={rootRef}
      type="button"
      data-state={state}
      data-phase={shownPhase}
      style={style}
      className="hero-blob"
      disabled={state === "pending"}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onPointerEnter={rouse}
      onPointerLeave={settle}
      onFocus={rouse}
      onBlur={settle}
      // The visible label comes and goes, so it is marked aria-hidden and the
      // accessible name lives here permanently — a control whose name appears
      // only on hover is nameless to a screen reader. It carries the error too:
      // otherwise a failed trip is announced nowhere at all.
      aria-label={
        state === "pending"
          ? "Setting off"
          : state === "error"
            ? `Could not start a trip: ${error ?? "something went wrong"}`
            : "Start a new journey"
      }
      title="Opens a recording session. The rover-follow behaviour is not implemented yet."
    >
      {inner}
    </button>
  );
}
