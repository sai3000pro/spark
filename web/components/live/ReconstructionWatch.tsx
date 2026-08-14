"use client";

/**
 * Watches one reconstruction until it lands, then hangs it on the walk.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY POLLING IS THE FEATURE, NOT THE IMPLEMENTATION DETAIL
 *
 * `GET /api/splat/jobs/<id>` is the only thing that asks KIRI whether a job has
 * finished and downloads the result when it has — see lib/reconstruction/collect.ts,
 * which is deliberately driven by a read rather than by a worker so there is no
 * cron and no timer on the server to leak.
 *
 * Nothing in the app called that route. So a clip could be submitted, a credit
 * spent, the reconstruction succeed — and the .ply would never be fetched,
 * because nobody ever asked. It would then sit at KIRI until its download
 * window closed (KIRI_STATUS.expired) and be lost. Paid for, finished, gone.
 * This component is what closes that.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE REQUEST AT A TIME, AND IT STOPS
 *
 * A recursive timeout rather than setInterval: a slow poll must not stack a
 * second request on top of the first, and the download that happens inside a
 * successful poll is a whole splat coming over the wire. It stops the moment
 * the job is ready — there is nothing left to learn — and on unmount.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RTDB CHANNEL SITS BESIDE THE POLL, NOT INSTEAD OF IT
 *
 * `useJobProgress` adds a live channel when Firebase is configured, and adds
 * exactly nothing when it is not — which is how this app runs today. It is
 * deliberately additive:
 *
 *   · the poll is never slowed or skipped because a frame arrived. A frame is a
 *     hint (lib/firebase/progress.ts is emphatic), and the poll is also the only
 *     thing that collects the .ply from KIRI. Trusting a `ready` frame and
 *     stopping would strand the artifact at KIRI until its window closed.
 *   · a terminal frame instead pulls the NEXT poll forward to now, so the answer
 *     lands in the same second rather than up to five later.
 *   · the channel id rides along on the poll's query string, because that is the
 *     only way the server knows where to publish. First poll goes without it,
 *     every poll after that carries it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { useJobProgress } from "@/lib/firebase/useJobProgress";
import { isTerminal } from "@/lib/firebase/progress";

/** Slow enough to be free, fast enough that nobody wonders if it is stuck. */
const POLL_MS = 5_000;

/**
 * Long enough for a real KIRI reconstruction, which is minutes not seconds.
 *
 * Giving up is not losing anything: the job record is on disk, so reopening
 * this page — or any other read of that route — resumes exactly where this
 * left off. The cap exists so a forgotten tab is not polling all night.
 */
const GIVE_UP_MS = 30 * 60_000;

interface Job {
  id: string;
  status: "queued" | "processing" | "ready" | "failed";
  url: string | null;
  tripId: string | null;
  note: string;
  kiriSerialize: string | null;
}

interface Props {
  jobId: string;
  /** Where to send someone once the splat is attached to their walk. */
  href?: string;
}

export function ReconstructionWatch({ jobId, href }: Props) {
  const [job, setJob] = useState<Job | null>(null);
  /** KIRI's own sentence, when the server had one to pass on. */
  const [note, setNote] = useState<string | null>(null);
  const [attached, setAttached] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const startedAt = useRef<number | null>(null);

  const { frame, channel } = useJobProgress(jobId);

  /*
    The channel in a ref, not a dependency.

    It resolves asynchronously, a second or two after mount. Putting it in the
    effect's dependency list would tear down and rebuild the whole poll — and
    restart the give-up clock — the moment anonymous sign-in returned. A ref lets
    the running loop pick it up on its next tick instead.
  */
  const channelRef = useRef<string | null>(null);
  useEffect(() => {
    channelRef.current = channel;
  }, [channel]);

  /** Pull the next poll forward to now. Set by the effect below. */
  const pokeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    // Guards the early poke against landing on top of a request already in
    // flight — the thing the recursive-timeout shape exists to prevent.
    let inFlight = false;
    // Set here rather than at module scope so the clock starts when this
    // particular watch mounts, not when the bundle loaded.
    startedAt.current = Date.now();

    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const suffix = channelRef.current ? `?channel=${encodeURIComponent(channelRef.current)}` : "";
        const res = await fetch(`/api/splat/jobs/${jobId}${suffix}`, { cache: "no-store" });
        if (!alive) return;
        if (res.ok) {
          const body = (await res.json()) as { job: Job; kiri?: string };
          if (!alive) return;
          setJob(body.job);
          if (body.kiri) setNote(body.kiri);

          if (body.job.status === "ready") {
            // The splat is here. Point every moment in the walk at it — the
            // same POST the manual path uses, so there is one way this happens.
            if (body.job.tripId) {
              const done = await fetch(`/api/splat/jobs/${jobId}`, { method: "POST" });
              if (alive && done.ok) setAttached(true);
            }
            return; // Stop. Nothing further to learn.
          }
        }
      } catch {
        // A dropped poll is not a failure — the next one asks again.
      }

      if (!alive) return;
      if (startedAt.current !== null && Date.now() - startedAt.current > GIVE_UP_MS) {
        setGaveUp(true);
        return;
      }
      /*
        Cleared only on the path that schedules another poll. Every `return`
        above it is a deliberate stop — ready, unmounted, given up — and leaving
        the flag set on those is what keeps a late `poke()` from restarting a
        loop that has finished.
      */
      inFlight = false;
      timer = setTimeout(() => void tick(), POLL_MS);
    };

    pokeRef.current = () => {
      clearTimeout(timer);
      void tick();
    };

    void tick();
    return () => {
      alive = false;
      pokeRef.current = null;
      clearTimeout(timer);
    };
  }, [jobId]);

  const poke = useCallback(() => pokeRef.current?.(), []);

  /*
    A terminal frame is a reason to ask, never an answer.

    lib/firebase/progress.ts: "a `ready` frame is never trusted on its own — it
    prompts a re-read". So this does not set any state a reader can see; it
    pulls the authoritative poll forward, and that poll is what collects the
    .ply, attaches it, and decides whether the job is really done.

    Runs only when a frame actually arrives, which — with no Firebase
    configured — is never, so this effect is inert on the current deployment.
  */
  useEffect(() => {
    if (frame && isTerminal(frame.status)) poke();
  }, [frame, poke]);

  const ready = job?.status === "ready";
  /*
    Only claimed once a frame has been RECEIVED, not merely once a channel
    exists. A channel with the RTDB rules undeployed reads as permission-denied
    and would otherwise have this line promising something that never arrives.
  */
  const live = frame !== null;

  return (
    <div className="mt-2 flex flex-col gap-1">
      <p className={`fnote text-[9.5px] leading-relaxed ${ready ? "text-lagoon" : "text-ink-faint"}`}>
        [ reconstruction {jobId}
        {ready
          ? attached
            ? " · landed · every moment now points at it"
            : " · landed"
          : gaveUp
            ? " · still working · reopen this page to keep watching"
            : job?.kiriSerialize
              ? live
                ? " · at KIRI, following it live"
                : " · at KIRI, checking every few seconds"
              : " · waiting"}{" "}
        ]
      </p>

      {/* KIRI's own words, when there are any — "no credits left", "could not
          reconstruct this clip". Far more use than a spinner. */}
      {note && !ready && (
        <p className="fnote text-[9.5px] leading-relaxed text-clay">[ {note} ]</p>
      )}

      {ready && href && (
        <Link href={href} className="pill-brass mt-1 self-start px-3 py-1.5 text-[12.5px]">
          Open the walk <span aria-hidden>→</span>
        </Link>
      )}
    </div>
  );
}
