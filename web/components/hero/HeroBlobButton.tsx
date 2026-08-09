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
  BLOB_CLIPS,
  blobCell,
  blobSprite,
  type BlobClipName,
  type BlobFacing,
  type BlobFrame,
} from "@/lib/blobSprites";
import {
  airFraction,
  clamp,
  isLastDescent,
  releaseVelocity,
  stepBallistic,
  stepWalk,
  timeToGround,
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
/**
 * How long it stands at its anchor after walking home before it starts nodding
 * off — measured from ARRIVAL, so the stirring and the question both happen
 * inside it. Deliberately its own number rather than the hover timeout: getting
 * back to your spot after being thrown across the scene earns a beat to stand
 * there, whether or not anyone is looking.
 */
const ANCHOR_PAUSE_MS = 5000;
/*
 * There is no wake-to-prompt constant any more. The offer arrives when the WAKE
 * CLIP ENDS — its last drawing IS the asking one — so the label can no longer
 * land before the character has finished stirring, which two independent clocks
 * that merely happened to be about the same length allowed.
 */
/** Anticipation before the leap: the jump clip's first two drawings. */
const CROUCH_MS = (2 / BLOB_CLIPS.jump.fps) * 1000;
/** The squash on touchdown. */
const LAND_MS = 220;
/**
 * How long before impact it starts bracing, in ms.
 *
 * Long enough to read as anticipation, short enough that it is not holding the
 * pose through half the descent. It only ever fires on the LAST fall — see
 * `isLastDescent` — so a bouncing throw keeps its shocked face until the hop
 * that finally settles it.
 */
const BRACE_LEAD_MS = 130;
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
/**
 * Ground covered by one full gait cycle, in character-heights.
 *
 * The stride is DERIVED from this and the clip's own length, so adding frames to
 * the artwork makes the walk smoother without changing how far a step carries
 * you. The constant this replaces hardcoded four frames and, at walking speed,
 * ran the cycle at 3.2 fps — four near-identical drawings that slowly is what
 * "there's no walk animation" meant.
 */
const WALK_CYCLE_UNITS = 0.72;
/**
 * How far the body rises at the top of each step, in character-heights.
 *
 * THIS IS WHAT MAKES EIGHT DRAWINGS LOOK SMOOTH. A sprite walk is a handful of
 * stills, and between them nothing moves but the character's x — so the eye
 * reads the cuts. A continuous bob, computed from the sub-frame position within
 * the stride, means the blob is never actually still: the drawings step, the
 * body flows. Two rises per cycle, one per footfall.
 */
const WALK_BOB = 0.035;
/** A skid is a shorter, faster scrabble than a walk. */
const SKID_CYCLE_UNITS = 0.8;
/** Vertical speed below which the arc reads as weightless, in heights/s. */
const APEX_VY = 1.2;
/*
 * There is no brace lookahead any more. It anticipated the ground with the
 * jump sheet's landing drawing, which is a LEAP's drawing — on a throw it read
 * as the blob deciding to land rather than being dropped. The touchdown beat
 * still uses it, from its own phase and its own cell; the descent is just a
 * shocked face. `timeToGround` stays in lib/blobPhysics.ts for it.
 */

/** Frames fetched when it first stirs — the wake beat covers the round trip. */
const WARM_WAKE: BlobFrame[] = [...BLOB_CLIPS.wake.frames];
/** Frames fetched on first touch — the long press and the drag cover these. */
const WARM_PLAY: BlobFrame[] = [...BLOB_CLIPS.jump.frames, "surprised", "idle"];
/** Frames fetched once a drag is really under way — the flight covers these. */
const WARM_WALK: BlobFrame[] = [...BLOB_CLIPS.walk.frames];

/**
 * WHAT THE CHARACTER IS DOING, AS A FRAME SEQUENCE.
 *
 * Two kinds, and the difference is the whole design:
 *
 *   TIMED    a clock advances the frame — sleeping, waking, crouching, landing.
 *            One shared timer, cleared with the rest.
 *   PHYSICS  no clock at all. The frame is chosen inside the rAF that is already
 *            running, from velocity or distance covered. That is why a fall that
 *            lasts 250 ms and one that bounces for 1.5 s are both right, and why
 *            frames can never advance while the character is standing still.
 *
 * A one-shot is NEVER cancelled by a hover-out, only by a gesture or unmount —
 * a character whose reaction snaps backwards when your cursor twitches reads as
 * broken in a way a still image never does.
 */
interface Sequence {
  frames: readonly BlobFrame[];
  /** ms per frame. Absent means the physics loop picks the frame. */
  frameMs?: number;
  loop?: boolean;
  /** Start here rather than at 0. */
  from?: number;
  /** Play the frames backwards — the nod-off is the wake, reversed. */
  reverse?: boolean;
  /** Where a one-shot goes when it finishes. Data, so the driver's deps stay primitive. */
  then?: Phase;
}

const clipMs = (c: BlobClipName) => 1000 / BLOB_CLIPS[c].fps;

const SEQUENCES = {
  /**
   * z, zz, zzz, big zzz, then nothing.
   *
   * The ORDER AND THE REST FRAME BELONG TO THE PIPELINE, which knows what is
   * drawn on each frame; this used to re-cut them here as well, and the two
   * corrections cancelled into a loop that never showed the single z at all.
   */
  sleep: {
    frames: BLOB_CLIPS.sleep.frames,
    frameMs: clipMs("sleep"),
    loop: true,
    from: BLOB_CLIPS.sleep.rest,
  },
  "nod-off": {
    frames: BLOB_CLIPS.wake.frames,
    frameMs: 220,
    reverse: true,
    then: "asleep",
  },
  wake: { frames: BLOB_CLIPS.wake.frames, frameMs: clipMs("wake"), then: "asking" },
  // The wake clip's LAST drawing is the asking one, so this holds the same file
  // the clip ended on: no swap, no flicker, no second fetch.
  ask: { frames: [BLOB_CLIPS.wake.frames[BLOB_CLIPS.wake.frames.length - 1]] },
  held: { frames: ["surprised"] },
  crouch: { frames: BLOB_CLIPS.jump.frames.slice(0, 2), frameMs: clipMs("jump") },
  /**
   * LEAPING. The drawn jump — lift-off, apex flare — for the launch only, which
   * is the thing it was drawn for.
   */
  air: { frames: BLOB_CLIPS.jump.frames },
  /**
   * THROWN. One shocked face for the whole arc, bounces included.
   *
   * Not the jump drawings: a blob you hurled across the scene is not leaping,
   * and lighting the apex flare every time it bounces reads as the character
   * doing it on purpose. The landing is still the drawn touchdown — that beat
   * has its own phase and its own cell.
   */
  tossed: { frames: ["surprised"] },
  /** Scrabbling along the ground after a flat fling. */
  skid: { frames: BLOB_CLIPS.walk.frames },
  walk: { frames: BLOB_CLIPS.walk.frames },
  wait: { frames: [BLOB_CLIPS.jump.frames[2]] },
  working: { frames: ["smile"] },
  oops: { frames: ["surprised"] },
} as const satisfies Record<string, Sequence>;

type SequenceName = keyof typeof SEQUENCES;

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
  /**
   * Why it is in the air, which decides WHICH DRAWINGS the arc is made of.
   *
   * A LEAP is the character launching itself, and the jump sheet was drawn for
   * exactly that — crouch, lift-off, flare. A THROW is you hurling it across the
   * scene, where those same drawings read as the blob doing it deliberately; it
   * just looks shocked instead. They are also drawn in different CELLS, so this
   * is not a cosmetic choice: mixing them mid-arc resizes the character.
   */
  const [flight, setFlight] = useState<"leap" | "throw">("throw");

  const rootRef = useRef<HTMLButtonElement | null>(null);
  /**
   * Lives on the <img> itself, not on the root, so it survives the
   * <button>-to-<a> swap when a trip goes live.
   */
  const spriteRef = useRef<HTMLImageElement | null>(null);
  /** Last URL written imperatively, so an unchanged frame costs nothing. */
  const lastSrc = useRef("");
  /** Cursor into the running sequence. */
  const cursor = useRef(0);
  const clipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Gates the nod-off, so a cold load does not play a reverse-wake on hydration. */
  const wasAwake = useRef(false);
  const motion = useRef<Motion>({ x: 0, y: 0, vx: 0, vy: 0, hold: false });
  const grab = useRef<Grab | null>(null);
  const samples = useRef<Sample[]>([]);
  /** The last gesture was a throw, so the click it produces is not a click. */
  const dragged = useRef(false);
  /** What kind of pointer last touched it — a hybrid laptop has both. */
  const pointerKind = useRef<string>("mouse");

  const sleepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const warmedWake = useRef(false);
  const warmedPlay = useRef(false);
  const warmedWalk = useRef(false);
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

  /**
   * Nodding off rather than simply asleep — the wake clip in reverse. Only after
   * it was actually awake: without the guard every cold load plays a
   * reverse-wake at hydration, which is worse than the hard cut it replaces.
   */
  const [nodding, setNodding] = useState(false);
  /**
   * Scrabbling along the ground rather than falling through the air.
   *
   * It is its own state and not just a branch inside the physics loop because
   * the two are drawn in DIFFERENT CELLS — the airborne frames come from the
   * jump sheet, the scrabble borrows the walk cycle — and the cell is a React
   * prop. Swapping the image without swapping the cell stretches the drawing to
   * fill a box built for the apex flare, which is what "it got really big as it
   * was dropping" was.
   */
  const [skidding, setSkidding] = useState(false);
  const skidRef = useRef(false);
  /**
   * Bracing for a landing it can already see coming.
   *
   * State and not just an imperative frame, for the same reason `skidding` is:
   * the touchdown drawing lives in the JUMP cell and everything else in a throw
   * lives in the base one, so React has to re-poster or the drawing and the box
   * underneath it disagree and the character changes size in mid-air.
   */
  const [bracing, setBracing] = useState(false);
  const braceRef = useRef(false);

  /** On its feet at home — so the offsets should be back at zero. */
  const grounded =
    shownPhase === "asleep" ||
    shownPhase === "waking" ||
    shownPhase === "asking";

  /**
   * WHICH SEQUENCE, as a pure function of the trip and the phase.
   *
   * React decides this; the driver decides which frame within it. That split is
   * the whole re-render defence — see the poster below.
   */
  const seqName: SequenceName =
    shownPhase === "grabbed"
      ? "held"
      : shownPhase === "crouching"
        ? "crouch"
        : shownPhase === "flying"
          ? skidding
            ? "skid"
            : // Bracing borrows the jump clip because that is where the drawn
              // touchdown lives — the same clip `landing` posters from, so the
              // brace runs straight into the landing beat with no swap at all.
              bracing || flight === "leap"
              ? "air"
              : "tossed"
          : shownPhase === "landing"
            ? "air"
          : shownPhase === "launched"
            ? "wait"
            : shownPhase === "walking"
              ? "walk"
              : state === "pending" || state === "recording"
                ? "wait"
                : state === "processing"
                  ? "working"
                  : state === "error"
                    ? "oops"
                    : shownPhase === "asking"
                      ? "ask"
                      : shownPhase === "waking"
                        ? "wake"
                        : nodding
                          ? "nod-off"
                          : "sleep";

  const seq: Sequence = SEQUENCES[seqName];
  /**
   * THE POSTER — the only frame React ever writes.
   *
   * While a sequence runs this prop is CONSTANT, so React emits no `src` write
   * and the driver's imperative frames survive every re-render. Which matters
   * more than it sounds: a live trip re-renders this component once a second as
   * `elapsedSec` ticks, and with `src` derived from a frame index every clip
   * would restart on every tick.
   *
   * The landing beat posters on the touchdown drawing rather than the clip's
   * first frame, because it is a single held frame out of the middle of a clip.
   */
  const poster: BlobFrame =
    shownPhase === "landing" || (shownPhase === "flying" && bracing)
      ? seq.frames[seq.frames.length - 1]
      : seq.frames[seq.from ?? (seq.reverse ? seq.frames.length - 1 : 0)];
  const cell = blobCell(poster);

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
      // The CELL is taller than the character and the two cells are taller by
      // different amounts, so the fraction is read back off the element rather
      // than assumed — during a jump this element is the big cell.
      unit:
        el.getBoundingClientRect().height *
        (parseFloat(getComputedStyle(el).getPropertyValue("--sprite-body-h")) || 1),
      minX: -ROAM.left * plate.width,
      maxX: ROAM.right * plate.width,
      ceiling: -ROAM.ceiling * plate.height,
    };
  }, []);

  /**
   * Fetch AND decode. `preload` only fills the HTTP cache; the first time an
   * undecoded image is painted the compositor still has to do the work, which
   * lands as a hitch on the opening frame of a clip. Decoding ahead of time
   * moves that cost into the idle moment before the beat.
   */
  const warm = useCallback((frames: readonly BlobFrame[], facings: readonly BlobFacing[]) => {
    for (const frame of frames) {
      for (const face of facings) {
        const url = blobSprite(frame, face);
        preload(url, { as: "image" });
        const img = new Image();
        img.src = url;
        void img.decode?.().catch(() => {});
      }
    }
  }, []);

  const warmWake = useCallback(() => {
    if (warmedWake.current) return;
    warmedWake.current = true;
    warm(WARM_WAKE, [REST_FACING]);
    if (!prefetched.current) {
      prefetched.current = true;
      router.prefetch("/live");
    }
  }, [router, warm]);

  const warmPlay = useCallback(() => {
    if (warmedPlay.current) return;
    warmedPlay.current = true;
    // Both facings: which way it walks home is not known until it is thrown.
    warm(WARM_PLAY, ["left", "right"]);
  }, [warm]);

  const rouse = useCallback(() => {
    clearTimer(sleepTimer);
    warmWake();
    // Only a sleeping blob can be woken. Anything else — mid-throw, walking
    // home, already asking — is left to finish what it is doing.
    if (phase !== "asleep") return;
    setNodding(false);
    wasAwake.current = true;
    // No timer: the wake clip ENDS in `asking`, so the offer arrives exactly
    // when the character has finished stirring rather than on a second clock
    // that merely happened to be about the same length.
    setPhase("waking");
  }, [phase, warmWake]);

  /**
   * Nod off after a pause, whatever the reason for the pause.
   *
   * The delay is a parameter because the two cases are genuinely different
   * lengths: how long an offer stays open after your cursor leaves is a
   * different question from how long the character stands at its spot after
   * walking home.
   */
  const napAfter = useCallback((delayMs: number) => {
    clearTimer(sleepTimer);
    sleepTimer.current = setTimeout(() => {
      // The phase is read HERE rather than captured when the timer was set. An
      // updater, not a read of state, because that is the only way to see the
      // phase as of the moment the nap actually lands.
      setNodding(wasAwake.current);
      setPhase((p) => (p === "waking" || p === "asking" ? "asleep" : p));
    }, delayMs);
  }, []);

  // Bound with no arguments on purpose: React hands an event to a handler, and
  // it would arrive as the delay.
  const settle = useCallback(() => napAfter(SLEEP_AFTER_MS), [napAfter]);

  // Timers, the rAF and the offsets are the things that must not outlive the
  // component. The offsets especially: they live on a PARENT that survives this
  // element being swapped for the live <a>, and a blob that was mid-throw when a
  // trip started would leave the ground glow stranded off to one side forever.
  useEffect(
    () => () => {
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

  // ── Writing one frame ──────────────────────────────────────────────────────
  // Imperative, like `paint`. React owns which SEQUENCE is running; the driver
  // owns which frame within it. See the poster `src` below for why that split is
  // what keeps a live trip's 1 Hz clock from restarting every clip.
  const showFrame = useCallback(
    (frame: BlobFrame, face: BlobFacing) => {
      /*
        THE BOX MOVES WITH THE DRAWING, IN THE SAME BREATH.

        The element is a CELL and the sprite fills it with `object-fit: contain`,
        so the character's size on screen is decided by the cell geometry the box
        is currently wearing — not by the drawing. Show a jump-cell drawing in a
        base-cell box and the character renders at 0.4608/0.7264 = 63% of itself;
        the other way round, 158%. That is the "randomly resizing".

        It used to be possible because these four came from React (via the
        poster) while the `src` came from here. Every frame the driver drew from
        a different cell than the poster's was a mismatch until React caught up —
        at least one painted frame, and the brace crosses exactly that seam:
        `tossed` is base-cell and the drawn touchdown is jump-cell.

        Written BEFORE the unchanged-url early return, on purpose. The physics
        clips call this every animation frame, so the geometry is re-asserted
        ~60x a second and a stale React render cannot leave the box wrong for
        longer than a frame. Cheap: these are four string writes to the same
        element, and the browser coalesces them into the one style recalc it was
        already doing for `src`.
      */
      const el = rootRef.current;
      if (el) {
        const c = blobCell(frame);
        el.style.setProperty("--sprite-cell-ar", String(c.cellAr));
        el.style.setProperty("--sprite-foot-y", String(c.footY));
        el.style.setProperty("--sprite-body-h", String(c.bodyH));
        el.style.setProperty("--sprite-body-w", String(c.bodyW));
      }

      const url = blobSprite(frame, face);
      if (url === lastSrc.current) return;
      lastSrc.current = url;
      if (spriteRef.current) spriteRef.current.src = url;
    },
    [],
  );

  // ── The clip driver ────────────────────────────────────────────────────────
  // Timed sequences only. Physics sequences arm no timer at all — their frames
  // come from the rAF below — which is what makes "frames advancing while the
  // character is standing still" impossible rather than merely unlikely.
  //
  // Deps are primitive strings, and SEQUENCES is frozen at module level, so
  // nothing here is reconstructed per render and no clip restarts on one.
  useEffect(() => {
    const s = SEQUENCES[seqName] as Sequence;
    const n = s.frames.length;
    const at = (i: number) => s.frames[s.reverse ? n - 1 - i : i];

    // A PHYSICS SEQUENCE IS NOT THE DRIVER'S TO PAINT. React has already
    // rendered the right frame for the phase, and the rAF loop takes it from
    // there; writing frame 0 here as well stamps the wrong drawing over it.
    //
    // That is not hypothetical: the jump clip's frame 0 is the curious blob with
    // a question mark over its head, and `landing` runs no rAF loop — so
    // touchdown showed the character asking a question for the whole beat before
    // it walked home. All the driver does here is re-sync its "last written"
    // guard to what React put in the element, so a later frame is not swallowed
    // as a duplicate.
    if (!s.frameMs) {
      lastSrc.current = spriteRef.current?.getAttribute("src") ?? "";
      return;
    }

    cursor.current = s.from ?? 0;
    showFrame(at(cursor.current), facing);

    // Reduced motion keeps every POSE — a drawing is not a translation across
    // the screen — but stops the ambient loop. `sleep` holds the frame the
    // server already painted, so there is no swap at all.
    if (reduced && s.loop) return;

    const tick = () => {
      cursor.current++;
      if (cursor.current >= n) {
        if (s.loop) cursor.current = 0;
        else {
          // A one-shot hands over and stops. Clearing `nodding` here is what
          // lets the nod-off give way to the sleep LOOP: its `then` is "asleep",
          // which is the phase it is already in, so the phase alone would never
          // change and the character would hold its last frame for ever.
          setNodding(false);
          if (s.then) setPhase(s.then);
          return;
        }
      }
      showFrame(at(cursor.current), facing);
      clipTimer.current = setTimeout(tick, s.frameMs);
    };
    clipTimer.current = setTimeout(tick, s.frameMs);
    return () => clearTimer(clipTimer);
  }, [seqName, facing, reduced, showFrame]);

  // ── The physics loop ───────────────────────────────────────────────────────
  // One rAF, owned by the phase that needs it, mutating refs and writing the DOM
  // directly. It calls setState only at transitions — never per frame.
  useEffect(() => {
    if (phase !== "flying" && phase !== "walking") return;
    const env = bounds();
    if (!env) return;

    const air = SEQUENCES.air.frames;
    const skid = SEQUENCES.skid.frames;
    const walk = SEQUENCES.walk.frames;
    let raf = 0;
    let last = performance.now();
    let travelled = 0;

    const frame = (now: number) => {
      // Clamped: a backgrounded tab hands back a dt of several seconds, which
      // would teleport the blob through the floor on the first frame back.
      const dt = Math.min(1 / 30, (now - last) / 1000);
      last = now;
      const m = motion.current;

      if (phase === "flying") {
        const result = stepBallistic(m, dt, env);
        paint(m.x, m.y, airFraction(m, env), tumble(m, env));

        // THE FRAME COMES FROM THE MOTION. A clock cannot do this: the flight is
        // as long as the throw was hard, and the moment of impact is not known
        // until it is nearly here — which is exactly when the character needs to
        // start bracing for it.
        const v = m.vy / env.unit;
        // Sliding, not merely touching. During a bounce sequence the blob is on
        // the ground for a single frame at a time, and testing `y >= 0` alone
        // flickered between the shocked face and the scrabble on every hop.
        // `stepBallistic` reports a real bounce distinctly, so a frame that is
        // grounded and NOT a bounce is a genuine skid.
        const onGround = m.y >= 0 && result !== "bounce" && Math.abs(m.vx) > 0;
        if (onGround !== skidRef.current) {
          skidRef.current = onGround;
          setSkidding(onGround); // once per transition — the cell has to follow
        }
        // THE BRACE, AND IT HAS TO BE EARLY TO BE WORTH ANYTHING. The touchdown
        // drawing used to appear only once `stepBallistic` reported `landed` —
        // i.e. after the last bounce had already happened — so the beat it was
        // drawn for was over before it was shown. Predicting the final descent
        // instead puts it on screen during the fall it belongs to.
        const brace =
          !onGround && isLastDescent(m, env) && timeToGround(m, env) * 1000 <= BRACE_LEAD_MS;
        if (brace !== braceRef.current) {
          braceRef.current = brace;
          setBracing(brace); // once per transition — the cell has to follow
        }

        if (onGround) {
          // Scrabbling along the ground: the walk cycle, driven by ground
          // covered. This is the beat the old version showed one static drawing
          // for, while the blob slid several hundred pixels.
          travelled += Math.abs(m.vx) * dt;
          const step = (SKID_CYCLE_UNITS * env.unit) / skid.length;
          if (travelled >= step) travelled -= step;
          showFrame(skid[Math.floor(travelled / step) % skid.length], facing);
        } else if (brace) {
          // The drawn touchdown, held through the last of the fall.
          showFrame(air[air.length - 1], facing);
        } else if (flight === "throw") {
          // Thrown: one shocked face for the whole arc, bounces and all. It must
          // also be the frame the SEQUENCE posters, or the cell underneath does
          // not match the drawing on top of it and the character resizes in
          // mid-air.
          showFrame("surprised", facing);
        } else if (v < -APEX_VY) {
          showFrame(air[2], facing); // leaping, on the way up
        } else if (Math.abs(v) <= APEX_VY) {
          showFrame(air[3], facing); // weightless at the top, flare and all
        } else {
          showFrame(air[2], facing);
        }

        if (result === "apex") {
          setPhase("launched");
          return;
        }
        if (result === "landed") {
          paint(m.x, 0, 0, 0);
          skidRef.current = false;
          setSkidding(false);
          // Cleared, not carried: `landing` posters the same touchdown drawing
          // from the same cell, so dropping the flag here changes nothing on
          // screen — it just stops a stale brace surviving into the next throw.
          braceRef.current = false;
          setBracing(false);
          setPhase("landing");
          return;
        }
      } else {
        const { moved, arrived } = stepWalk(m, dt, env);
        // Cadence locked to DISTANCE, not to time: that is what stops it
        // moon-walking when the last step home is shorter than the others.
        travelled += moved;
        const cycle = WALK_CYCLE_UNITS * env.unit;
        const step = cycle / walk.length;
        showFrame(walk[Math.floor(travelled / step) % walk.length], facing);
        // Continuous between the drawings — see WALK_BOB.
        const bob = -WALK_BOB * env.unit * Math.abs(Math.sin((Math.PI * 2 * travelled) / cycle));
        paint(m.x, bob, 0, 0);
        if (arrived) {
          snapHome(); // clears the bob as well as the offset
          showFrame(walk[0], REST_FACING); // both feet planted, not mid-stride
          setFacing(REST_FACING);
          // HOME, AND ONLY NOW DOES IT ASK. Being carried across the scene is
          // not a reason to want to ask you something, so the question is held
          // back through the grab, the flight and the walk; arriving is what
          // earns it. The wake clip settles it down and ends on the asking
          // drawing, so the offer comes out of a beat rather than appearing.
          wasAwake.current = true;
          setNodding(false);
          setPhase("waking");
          // And it does not stand there asking for ever: after ANCHOR_PAUSE_MS
          // it nods off and the sleep loop takes over.
          napAfter(ANCHOR_PAUSE_MS);
          return;
        }
      }
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [phase, facing, flight, bounds, paint, snapHome, showFrame, napAfter]);

  // Touchdown: a beat on the drawn landing, then it picks itself up and walks.
  useEffect(() => {
    if (phase !== "landing") return;
    phaseTimer.current = setTimeout(() => {
      // Face the way it is about to travel. `stepWalk` always moves toward home
      // and never overshoots, so this is fixed for the whole walk and needs no
      // per-frame state — the old version set it 60 times a second.
      setFacing(motion.current.x > 0 ? "left" : "right");
      setPhase("walking");
    }, LAND_MS);
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
    // The facing it walks home in is not known until it is released, which is far
    // too late to fetch. A drag has a whole flight of cover, so warm both.
    if (!warmedWalk.current) {
      warmedWalk.current = true;
      warm(WARM_WALK, ["left", "right"]);
    }
    clearTimer(pressTimer);
    clearTimer(sleepTimer);
    setPhase("grabbed");
  }, [warm]);

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

  const label =
    state === "pending"
      ? "Setting off…"
      : state === "recording"
        ? `Following you · ${elapsedLabel(elapsedSec)}`
        : state === "processing"
          ? "Building the album…"
          : state === "error"
            ? (error ?? "Something went wrong")
            // "Trip", not "journey". The app bar's green pill says "Start a
            // trip?" forty pixels above this, the API route is /api/trip/start,
            // and the library counts trips — a third word for the same act made
            // one page read as three products.
            : "Start a trip";

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
        ref={spriteRef}
        className="hero-blob__sprite"
        src={blobSprite(poster, facing)}
        alt=""
        aria-hidden
        draggable={false}
        width={cell.width}
        height={cell.height}
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
  // Written from the CELL THE CURRENT FRAME IS DRAWN IN. The jump needs a bigger
  // box than everything else — its apex flare is 2.8x the body's half-width — and
  // these four fractions are what make swapping to it invisible: the character
  // stays the same height and its feet stay on the same line.
  const style = {
    "--sprite-cell-ar": cell.cellAr,
    "--sprite-foot-y": cell.footY,
    "--sprite-body-h": cell.bodyH,
    "--sprite-body-w": cell.bodyW,
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
            : "Start a trip"
      }
      // NO `title`. It carried "the rover-follow behaviour is not implemented
      // yet", which the browser showed as a native tooltip on the hero's primary
      // action — a landing page apologising for itself, in the one place a
      // visitor is most likely to hover. The caveat is real and it is kept: the
      // footer states it, and TripSessionCard states it again the moment a trip
      // actually ends. Neither of those ambushes the button.
    >
      {inner}
    </button>
  );
}
