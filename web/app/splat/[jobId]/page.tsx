/**
 * One reconstruction, on its own, at a URL you can send someone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SPLAT NEEDED ITS OWN ROUTE
 *
 * Until now a reconstruction was only viewable if it had been ATTACHED to a
 * walk. `attachSplat` hangs a splat url on a moment, so the chain runs
 *
 *     clip → detector → moments → walk → attach → a moment you can open
 *
 * and every link in it has to hold. A clip nobody ran the detector over has no
 * moments; with no moments there is nothing to attach to; with nothing to attach
 * to there is no screen anywhere in this app that can show the file. So a
 * finished 144 MB capture — dispatched, paid for with a KIRI credit, downloaded
 * successfully and sitting on disk — was reachable by curl and by nothing else.
 * components/live/PendingReconstructions.tsx could at least tell you it existed;
 * it could not show it to you.
 *
 * This route breaks the file's visibility away from that chain entirely. The
 * .ply is the artefact. If it is on disk, it has a page.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FILE IS THE TRUTH, THE JOB RECORD IS COMMENTARY
 *
 * Readiness is derived by looking, exactly as lib/splatJobs.ts derives it — the
 * .ply existing IS the state, and there is no flag anywhere that could disagree
 * with it. Hence the order here: check for the file first, then ask whether a
 * job record happens to know anything about it.
 *
 * That order matters for a specific failure. A `.job.json` sidecar can be lost —
 * deleted, truncated, written by a build that no longer exists — while the
 * reconstruction it describes is perfectly intact. Gating this page on
 * `getSplatJob() !== null` would 404 a file that is right there, which is the
 * exact failure the sidecar was introduced to stop happening. So a splat with no
 * record still renders; it simply has less to say about where it came from.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MEASURED, NOT DEFAULTED
 *
 * The camera comes from measurePly(). This is not a nicety. KIRI normalises its
 * output into a ±50 box, and a default camera a few units from the origin stands
 * INSIDE that cloud looking at nothing — the splat loads, draws correctly, and
 * the page appears blank. See the header of lib/video/plyBounds.ts, which was
 * written after exactly that. Measuring costs a sampled read of a few tens of
 * thousands of vertices, which is nothing against the 144 MB the browser is
 * about to fetch anyway.
 */
import { existsSync, statSync } from "node:fs";

import Link from "next/link";
import { notFound } from "next/navigation";

import { StageClient } from "./StageClient";
import { compactNumber, formatBytes, shortDate } from "@/lib/format";
import { getSplatJob, storedSplatFor } from "@/lib/splatJobs";
import { CANVAS_BG } from "@/lib/theme";
import { measurePly } from "@/lib/video/plyBounds";
import type { SplatView } from "@/lib/types";

/**
 * Nothing about this page survives a build.
 *
 * The file it renders is dropped onto the disk of a running server by a GPU box
 * somewhere else, and the job record beside it lives in a `globalThis` map. A
 * cached answer here is a page that says a reconstruction does not exist when it
 * landed ten seconds ago.
 */
export const dynamic = "force-dynamic";

/**
 * Next 16 hands route params as a Promise. Declared explicitly rather than
 * reaching for the generated `PageProps<"/splat/[jobId]">`: those types are
 * emitted into .next/types by the dev server or the build, so a route that has
 * never been visited has no entry there and `tsc --noEmit` fails on a name it
 * cannot resolve. An explicit interface typechecks on a cold clone.
 */
interface Ctx {
  params: Promise<{ jobId: string }>;
}

/**
 * A job id, and nothing that could be a path.
 *
 * This string arrives from the URL and is about to be joined onto SPLAT_DIR, so
 * it gets a whitelist rather than a blacklist — `..` is the obvious attack and
 * the one everybody remembers, but so is an absolute path, a drive letter, and a
 * NUL. Ids minted by `createSplatJob` are `splat_<base36>`; the mock captures
 * checked into public/mock/splats use lowercase words and digits. Both fit here,
 * and nothing that reaches outside the directory does.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,120}$/;

/**
 * The stored splat for an id, or null if there isn't one to show.
 *
 * Any of the formats the upload gate takes, not `.ply` alone. This joined
 * `${jobId}.ply` directly, which was correct while `.ply` was the only thing
 * that could be stored and became a hole the moment it was not: `getSplatJob`
 * would report an uploaded `.spz` ready and hand out `/splat/<id>`, and this
 * page would `notFound()` on it. An upload that succeeds, says "ready", and
 * leads to a 404 is precisely the promise-we-cannot-keep this whole path was
 * built to avoid.
 *
 * `storedSplatFor` is the one place that spelling lives, so the page and the
 * store cannot drift. It only ever tries the known extensions against an id
 * this app minted, so the SAFE_ID fence above still does all the work it did.
 */
function resolveSplat(
  jobId: string,
): { file: string; url: string; name: string; bytes: number; landedAt: string } | null {
  if (!SAFE_ID.test(jobId)) return null;
  const found = storedSplatFor(jobId);
  if (!found) return null;
  const { path: file, filename } = found;
  if (!existsSync(file)) return null;
  try {
    const st = statSync(file);
    // mtime, not the job's createdAt. They answer different questions: the job
    // was created when somebody uploaded a clip, which can be days before the
    // reconstruction of it landed. "Collected" means the file arrived.
    return {
      file,
      url: `/mock/splats/${filename}`,
      name: filename,
      bytes: st.size,
      landedAt: new Date(st.mtimeMs).toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * How many gaussians, from whichever source actually knows.
 *
 * `measurePly` re-derives it on every load and is the better answer when it can
 * give one — it reads the file that is on disk right now. It only reads PLY
 * though, so for the other four formats the job record holds the only count
 * anybody ever took, at upload. Neither is authoritative alone; measured wins,
 * stored fills in, and 0 means nobody knows rather than "none".
 */
function countOf(
  measured: { pointCount: number } | null,
  job: { splatCount: number | null } | null,
): number {
  if (measured && measured.pointCount > 0) return measured.pointCount;
  return job?.splatCount && job.splatCount > 0 ? job.splatCount : 0;
}

export async function generateMetadata({ params }: Ctx) {
  const { jobId } = await params;
  return {
    title: `${jobId} · a reconstruction`,
    description: "A Gaussian splat, on its own, at a link.",
    // Someone's capture of someone's building. A link you can share is not the
    // same thing as a page that should turn up in a search for the address.
    robots: { index: false, follow: false },
  };
}

export default async function SplatPage({ params }: Ctx) {
  const { jobId } = await params;

  const ply = resolveSplat(jobId);
  // Honestly, and with no consolation screen. A 404 that renders "processing…"
  // for an id that was never real is a page that will spin forever.
  if (!ply) notFound();

  // May be null: see "the file is the truth" above. Never gates the render.
  const job = getSplatJob(jobId);
  const measured = measurePly(ply.file);

  /*
    A camera, one way or another.

    `measurePly` returns null for a file it cannot read confidently — a header
    it does not recognise, or a size that says the download was truncated. That
    is worth SAYING rather than hiding, because a half-written .ply is a real
    thing that happens when a collect is interrupted, and it explains a viewer
    that behaves strangely. The stage still gets pointed at the file; the reader
    just gets told the framing is a guess.
  */
  const view: SplatView = measured?.view ?? {
    cameraUp: [0, 1, 0],
    cameraPosition: [0, 1.6, 5],
    cameraLookAt: [0, 1, 0],
  };
  const span = measured
    ? Math.max(
        measured.max[0] - measured.min[0],
        measured.max[1] - measured.min[1],
        measured.max[2] - measured.min[2],
        0.001,
      )
    : 20;

  return (
    <main className="relative mx-auto w-full max-w-4xl flex-1 px-4 pb-16 pt-6 sm:px-6">
      {/* The journal's squared page, the same ground /live and the bench sit on. */}
      <div
        aria-hidden
        className="gridfield papergrain pointer-events-none absolute -inset-x-24 -inset-y-6"
      />

      <nav className="mb-5 flex flex-wrap items-center gap-2">
        <Link href="/live" className="pill-ghost px-3.5 py-2 text-[13px] text-ink">
          <span aria-hidden>←</span> Back to the clips
        </Link>
        {/* Only when there IS one. A reconstruction with no walk is the normal
            case on this page — it is most of the reason the page exists — and a
            dead link to a walk that was never built would be worse than silence. */}
        {job?.tripId && (
          <Link href={`/trip/${job.tripId}`} className="pill-ghost px-3.5 py-2 text-[13px] text-ink">
            Open the walk it belongs to
          </Link>
        )}
      </nav>

      <header className="rise-in mb-5 max-w-2xl">
        <span className="fnote text-[10.5px] text-moss">[ reconstruction · {jobId} ]</span>
        <h1 className="mt-2 break-words text-[30px] leading-[1.04] text-ink sm:text-[36px]">
          {job?.sourceName ?? "A capture with no record of its clip"}
        </h1>
        <p className="mt-2.5 text-[14px] leading-relaxed text-ink-soft">
          The file itself, framed off its own measured bounds. No moments, no
          object markers and no walk — this is the reconstruction on its own, which is
          how it is reachable before anything has been built out of it.
        </p>
      </header>

      {/* The journal's one dark surface. Painted here rather than by the canvas so
          the plate is already the right colour during the seconds before either
          engine has a context to clear. */}
      <section
        className="plate-vellum rise-in p-3 sm:p-4"
        style={{ "--i": 1 } as React.CSSProperties}
      >
        <div
          className="relative aspect-[16/10] w-full overflow-hidden rounded-[6px]"
          style={{ background: CANVAS_BG }}
        >
          <StageClient
            url={ply.url}
            view={view}
            span={span}
            bytes={ply.bytes}
            pointCount={countOf(measured, job)}
          />
        </div>
      </section>

      <section
        className="plate-vellum rise-in mt-5 p-5 sm:p-6"
        style={{ "--i": 2 } as React.CSSProperties}
      >
        <h2 className="text-[18px] leading-tight text-ink">What this file is</h2>

        <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          <Fact label="gaussians">
            {(() => {
              const n = countOf(measured, job);
              if (n > 0) return `${compactNumber(n)} (${n.toLocaleString("en-CA")})`;
              /*
                Two different unknowns, and they had one sentence between them.

                "the header did not parse" is true of a damaged PLY and false of
                every healthy .spz, .ksplat and .rad — none of which `measurePly`
                can read at all, because it walks raw float32 offsets. So a
                perfectly good 3.5-million-splat RAD reported that its header had
                failed, forty seconds after the upload gate parsed that header and
                counted every one of them.
              */
              return ply.name.endsWith(".ply")
                ? "unread — the header did not parse"
                : "not counted for this format";
            })()}
          </Fact>
          <Fact label="on disk">{formatBytes(ply.bytes)}</Fact>
          <Fact label="collected">{shortDate(ply.landedAt)}</Fact>
          <Fact label="source clip">
            {job
              ? `${job.sourceName} · ${formatBytes(job.sourceBytes)}`
              : "no job record — the sidecar is gone, the splat is not"}
          </Fact>
          <Fact label="uploaded">{job ? shortDate(job.createdAt) : "unknown"}</Fact>
          <Fact label="walk">
            {job?.tripId ?? "none built from it yet — run the detector over the clip"}
          </Fact>
          {measured && (
            <Fact label="measured extent">
              {/* The number the camera is derived from, printed because a splat
                  that frames oddly is nearly always a splat whose bounds are not
                  what anyone assumed. */}
              {span.toFixed(1)} units across · centred on{" "}
              {measured.centre.map((n) => n.toFixed(1)).join(", ")}
            </Fact>
          )}
          <Fact label="engine">
            <span className="text-ink-soft">named on the stage above — it is your choice, per device</span>
          </Fact>
        </dl>

        {!measured && (
          <p className="fnote mt-4 text-[10px] leading-relaxed text-clay">
            [ this file could not be measured · the framing above is a default, not a fit ·
            a truncated .ply from an interrupted collect looks exactly like this ]
          </p>
        )}

        <p className="fnote mt-4 text-[10px] leading-relaxed text-ink-faint">
          [ served from public/mock/splats/{ply.name} ·{" "}
          <a href={ply.url} download className="underline">
            take the file
          </a>{" "}
          ]
        </p>
      </section>
    </main>
  );
}

/** One row of the metadata list. Label in the specimen-tag voice, value in ink. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="fnote text-[9.5px] text-ink-faint">[ {label} ]</dt>
      <dd className="mt-0.5 break-words text-[13.5px] leading-relaxed text-ink">{children}</dd>
    </div>
  );
}
