"use client";

/**
 * Every clip on this machine that has not become a splat yet.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS SURFACE HAS TO EXIST
 *
 * Until now a reconstruction was only reachable from the panel that started it.
 * Close the tab, restart the dev server, come back tomorrow — and the clip was
 * still on disk, the job still real, and there was no screen in the app that
 * could see it. The only way back was curl.
 *
 * That is the difference between a demo and a tool. A capture is minutes of
 * walking around a building; a reconstruction is minutes more and, on KIRI, a
 * credit. Neither should be reachable only from the tab that happened to be
 * open at the time.
 *
 * It also gives the collector somewhere to run. `GET /api/splat/jobs/<id>` is
 * what asks KIRI whether a job finished and downloads the result — see
 * lib/reconstruction/collect.ts — so a job nobody is watching is a job whose
 * splat never lands. Opening this page is enough to resume every one of them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UNFINISHED, OR FINISHED WITH NOWHERE TO GO
 *
 * A reconstruction that landed and got attached already lives in its walk, and
 * listing it again here would be a second place to look for the same thing —
 * the album is the right one. So those drop off.
 *
 * But a splat whose job has no walk is a different animal. `attachSplat` needs
 * moments to hang a url on, and a clip nobody ran the detector over has none —
 * so the file sits on disk, downloaded and paid for, addressable by nothing.
 * Those stay listed, with the detector offered right there, because the most
 * expensive artefact in the system is the one you must never lose track of.
 *
 * Renders nothing at all when there is nothing outstanding.
 */
import Link from "next/link";
import { useEffect, useState } from "react";

import { CapturedWalk } from "@/components/live/CapturedWalk";
import { NotifyWhenDone } from "@/components/live/NotifyWhenDone";
import { ReconstructionWatch } from "@/components/live/ReconstructionWatch";
import { TryAnyway } from "@/components/live/TryAnyway";
import { formatBytes } from "@/lib/format";

interface Job {
  id: string;
  createdAt: string;
  sourceName: string;
  sourceBytes: number;
  tripId: string | null;
  status: "queued" | "processing" | "ready" | "failed";
  kiriSerialize: string | null;
}

export function PendingReconstructions() {
  const [jobs, setJobs] = useState<Job[] | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/splat/jobs", { cache: "no-store" });
        if (!alive || !res.ok) return;
        const body = (await res.json()) as { jobs: Job[] };
        /*
          Unfinished, OR finished with nowhere to go.

          A splat that has landed but whose job has no walk is INVISIBLE
          otherwise: `attachSplat` needs moments to hang it on, this list used
          to hide anything `ready`, and there is no other screen that shows a
          reconstruction on its own. A 144 MB capture that KIRI produced and we
          successfully downloaded would sit on disk unreachable — the most
          expensive possible thing to lose track of.
        */
        if (alive) {
          setJobs(body.jobs.filter((j) => j.status !== "ready" || !j.tripId));
        }
      } catch {
        // Nothing to show is the same outcome as failing to ask. Stay silent
        // rather than putting an error on a page about something else.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!jobs || jobs.length === 0) return null;

  return (
    <section
      className="plate-vellum rise-in relative mt-5 p-5 sm:p-6"
      style={{ "--i": 4 } as React.CSSProperties}
    >
      <header>
        <span className="fnote text-[10px] text-ink-faint">[ 04 ]</span>
        <h2 className="mt-1 text-[20px] leading-tight text-ink">Clips still to finish</h2>
        <p className="mt-1.5 max-w-prose text-[13.5px] leading-relaxed text-ink-soft">
          Footage this machine still holds. Pick a destination and it goes from here — the video
          is already on disk, so nothing has to be recorded or uploaded again. A clip with a
          finished splat but no walk needs the detector run over it before there is a moment to
          open it from.
        </p>

        {/* Offered HERE and only here: this panel exists because something is
            still finishing, which is the one moment "tell me when it's done" is
            an answer to a question the reader already has. It renders itself
            away when Firebase is not configured, when the browser cannot do
            push, and permanently once it has asked once. */}
        <NotifyWhenDone />
      </header>

      <ul className="mt-4 flex flex-col gap-4">
        {jobs.map((job) => (
          <li
            key={job.id}
            className="rounded-[6px] bg-milk p-4"
            style={{ boxShadow: "var(--ring-ink)" }}
          >
            <p className="fnote text-[10px] leading-relaxed text-ink-faint">
              [ {job.sourceName} · {formatBytes(job.sourceBytes)}
              {job.tripId ? ` · ${job.tripId}` : " · no walk built from it yet"} ]
            </p>

            {job.status === "ready" && !job.tripId ? (
              /*
                The splat is HERE and has nowhere to live. Running the detector
                is what mints a walk and calls `linkJobToTrip`, after which the
                watcher attaches the reconstruction on its next poll — the same
                path a phone capture takes, which is why this is the same
                component rather than a second one.
              */
              <>
                <p className="fnote mt-2 text-[9.5px] leading-relaxed text-lagoon">
                  [ the reconstruction is here · look at it now, or build a walk so there is a
                  moment to open it from ]
                </p>

                {/*
                  SEEING IT AND FILING IT ARE TWO DIFFERENT THINGS.

                  This used to offer only the detector, which is the right way to
                  give a splat a home but is minutes of work and a walk you may
                  not want — and until it finished there was no screen in the app
                  that could show you the file at all. "Where's the new splat
                  though?" is the question this link answers, and it answers it
                  in one click, off the .ply alone.

                  It does not replace the walk below. `/splat/<id>` is the file:
                  no moments, no anchors, no map. The detector is still what
                  turns a capture into something you can find a cup inside.
                */}
                <Link
                  href={`/splat/${job.id}`}
                  className="pill-brass mt-2.5 inline-flex px-3 py-1.5 text-[12.5px]"
                >
                  View the splat
                </Link>

                <CapturedWalk jobId={job.id} sourceName={job.sourceName} />
              </>
            ) : (
              <>
                {/* Resumes the poll for anything already at KIRI, and is a no-op
                    for a clip that has never been dispatched. */}
                <ReconstructionWatch
                  jobId={job.id}
                  href={job.tripId ? `/walk?trip=${job.tripId}` : undefined}
                />

                {/* No `onDispatched` needed: the watch above is already mounted
                    for this job and will pick the result up either way. */}
                <TryAnyway
                  resolveJobId={async () => job.id}
                  prompt="send this one to be reconstructed"
                />
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
