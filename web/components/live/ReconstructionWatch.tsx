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
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

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

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    // Set here rather than at module scope so the clock starts when this
    // particular watch mounts, not when the bundle loaded.
    startedAt.current = Date.now();

    const tick = async () => {
      try {
        const res = await fetch(`/api/splat/jobs/${jobId}`, { cache: "no-store" });
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
      timer = setTimeout(() => void tick(), POLL_MS);
    };

    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [jobId]);

  const ready = job?.status === "ready";

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
              ? " · at KIRI, checking every few seconds"
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
