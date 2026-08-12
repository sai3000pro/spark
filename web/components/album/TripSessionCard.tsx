"use client";

/**
 * The trip session, at the top of the gallery.
 *
 * Three shapes: idle, recording, and the honest ending.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ABOUT THAT ENDING.
 *
 * When a session stops, no album appears — because nothing was captured. No robot
 * is connected, so the pipeline ran on zero real detections, and the card says so
 * in as many words.
 *
 * Fabricating an album on stop would be the exact lie syntheticCloud.ts's header
 * refuses ("It is NOT fake data dressed up as a capture"). The demo is stronger
 * for admitting it: every UI state here is real, and the seam is visibly waiting.
 * The moment a robot POSTs to /api/ingest/* with the session's id, `simulated`
 * flips to false and this copy never renders again.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { RecordControl } from "@/components/shell/RecordControl";
import { useLiveTrip } from "@/components/shell/LiveTripProvider";
import { compactNumber } from "@/lib/format";
import { elapsedLabel } from "@/lib/useActiveTrip";

/** How long the outcome stays on screen after a session is collected. */
const OUTCOME_LINGER_MS = 20_000;

export function TripSessionCard({ detectionsSoFar }: { detectionsSoFar: number }) {
  const { active, elapsedSec, error } = useLiveTrip();

  // The card has to outlive the session: once the server collects the trip,
  // `active` goes null, and without remembering it the card would vanish
  // mid-sentence rather than reporting what actually happened.
  //
  // This is React's documented "adjust state while rendering" pattern — compare
  // against the last value seen and correct during render, which costs no extra
  // commit and no effect.
  // Counters ride along so the outcome can report what the session actually
  // captured, rather than the session having to still exist to be described.
  const [seen, setSeen] = useState<{
    id: string;
    counters: { detections: number; candidates: number; moments: number };
  } | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  if (active && (seen?.id !== active.id || seen.counters !== active.counters)) {
    setSeen({ id: active.id, counters: active.counters });
  }

  const justEnded = !active && seen && dismissedId !== seen.id ? seen : null;

  useEffect(() => {
    if (!justEnded) return;
    const id = setTimeout(() => setDismissedId(justEnded.id), OUTCOME_LINGER_MS);
    return () => clearTimeout(id);
  }, [justEnded]);

  if (active?.status === "processing") {
    return (
      <Card tone="compute">
        <Eyebrow tone="compute" pulse>
          Building the album
        </Eyebrow>
        <p className="mt-2 text-[13px] leading-relaxed text-fog-300">
          Stage 3 would run here — reconstructing the splats, writing the summaries, picking the
          music.
        </p>
        <Counters counters={active.counters} frozen />
        <div className="mt-4">
          <RecordControl />
        </div>
      </Card>
    );
  }

  if (active) {
    return (
      <Card tone="signal">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Eyebrow tone="signal" pulse>
              Recording
            </Eyebrow>
            <p
              className="tnum mt-1 font-display text-3xl font-bold text-fog-100"
              suppressHydrationWarning
            >
              {elapsedLabel(elapsedSec)}
            </p>
          </div>
          <RecordControl />
        </div>

        {/* A CSS animation, so globals.css's prefers-reduced-motion block already
            neutralises it without any extra code here. */}
        <div className="relative mt-4 h-[2px] overflow-hidden rounded-full bg-white/[0.06]">
          <span className="absolute inset-y-0 w-1/3 animate-[scan_6s_linear_infinite] bg-gradient-to-r from-transparent via-machine-400/60 to-transparent" />
        </div>

        <Counters counters={active.counters} />
      </Card>
    );
  }

  if (justEnded) {
    return (
      <Card tone="warn">
        <Eyebrow tone="warn">Trip ended</Eyebrow>
        <p className="mt-2 font-display text-[15px] font-semibold text-fog-100">
          {justEnded.counters.moments > 0
            ? `${justEnded.counters.moments} moment${justEnded.counters.moments === 1 ? "" : "s"} kept.`
            : "Nothing was worth keeping."}
        </p>
        <p className="mt-1.5 max-w-[52ch] text-[13px] leading-relaxed text-fog-400">
          {justEnded.counters.moments > 0
            ? "Stage 3 builds the album from here — reconstruction, summaries, music."
            : `${compactNumber(justEnded.counters.detections)} detections came in and none of the windows scored high enough to promote. That is the scorer working, not failing.`}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link
            href="/detect"
            className="font-mono text-[11px] text-fog-400 transition-colors hover:text-machine-300"
          >
            Watch it decide →
          </Link>
        </div>
      </Card>
    );
  }

  // Idle is DEMOTED: no box, and no RecordControl.
  //
  // The hero's blob is now the primary way to start a journey, and the app bar
  // carries a sticky one that is always reachable. A third start button here
  // would make three primaries, which is zero primaries. And a boxed status
  // panel sitting on top of a dense photo grid is the dashboard-ification this
  // screen's own header comment calls the most reliable tell of generated UI.
  //
  // The live states below keep the full ringed card — there, the panel IS the
  // subject and stopping the trip has to be possible from the thing you read.
  return (
    // The copy here is the first thing a visitor reads below the fold, and it
    // used to be written for us rather than for them: "puts Spark in follow mode
    // and begins the stage-1 detection loop", under a link reading "see what that
    // loop emits". Both name internals — a mode, a numbered stage, a loop, an
    // emission — that mean nothing to anyone who has not read the pipeline.
    //
    // The NUMBER stays exactly as it was. It is the one honest, load-bearing fact
    // on the screen, and softening the language around it is not the same as
    // softening it.
    <Card tone="idle" bare>
      <Eyebrow tone="idle">No trip in progress</Eyebrow>
      <p className="mt-2 max-w-[52ch] text-[13px] leading-relaxed text-fog-400">
        Start one and Spark follows you, deciding on its own what is worth keeping. It has looked at{" "}
        {compactNumber(detectionsSoFar)} things so far.
      </p>
      {error && <p className="mt-2 text-[12px] text-fail-400">{error}</p>}
      <Link
        href="/detect"
        className="mt-3 inline-block font-mono text-[11px] text-fog-400 transition-colors hover:text-machine-300"
      >
        Watch it decide →
      </Link>
    </Card>
  );
}

type Tone = "idle" | "signal" | "compute" | "warn";

const RING: Record<Tone, string> = {
  idle: "ring-white/[0.06]",
  signal: "ring-signal-500/25",
  compute: "ring-compute-500/25",
  warn: "ring-warn-400/25",
};

function Card({
  tone,
  bare,
  children,
}: {
  tone: Tone;
  /** Idle only — a plain block instead of a panel. See the idle branch. */
  bare?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={bare ? "mb-8" : `surface mb-8 rounded-2xl p-5 ring-1 ${RING[tone]}`}>
      {children}
    </section>
  );
}

const EYEBROW_TONE: Record<Tone, string> = {
  idle: "text-fog-400",
  signal: "text-signal-400",
  compute: "text-compute-400",
  warn: "text-warn-400",
};

const DOT_TONE: Record<Tone, string> = {
  idle: "bg-fog-400",
  signal: "bg-signal-400",
  compute: "bg-compute-400",
  warn: "bg-warn-400",
};

function Eyebrow({
  tone,
  pulse,
  children,
}: {
  tone: Tone;
  pulse?: boolean;
  children: React.ReactNode;
}) {
  return (
    <p className={`eyebrow flex items-center gap-2 ${EYEBROW_TONE[tone]}`}>
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${DOT_TONE[tone]} ${pulse ? "animate-pulse" : ""}`}
      />
      {children}
    </p>
  );
}

/**
 * The three pipeline stages, in order. Showing them here quietly re-teaches the
 * model on a screen that is otherwise just photographs.
 */
function Counters({
  counters,
  frozen,
}: {
  counters: { detections: number; candidates: number; moments: number };
  frozen?: boolean;
}) {
  const rows = [
    { n: 1, label: "detections", value: counters.detections },
    { n: 2, label: "candidates", value: counters.candidates },
    { n: 3, label: "promoted", value: counters.moments },
  ];

  return (
    <dl className={`mt-4 grid grid-cols-3 gap-3 ${frozen ? "opacity-60" : ""}`}>
      {rows.map((row) => (
        <div key={row.label} className="surface-raised rounded-xl px-3 py-2.5">
          <dt className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fog-400">
            <span className="rounded border border-ink-600 px-1 text-machine-400">{row.n}</span>
            {row.label}
          </dt>
          <dd
            className="tnum mt-1 font-display text-xl font-bold text-machine-400"
            suppressHydrationWarning
          >
            {compactNumber(row.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
