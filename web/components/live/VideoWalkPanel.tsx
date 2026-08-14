"use client";

/**
 * Drop a video in, get a walk out.
 *
 * The whole product claim, run against footage you brought: sample the frames,
 * detect what is in them, link the boxes into tracks, and push the result
 * through the SAME `scoreCandidates` the authored walks use. Whatever survives
 * is a moment. Nothing about the finding is staged.
 *
 * Two independent errands leave this component, on purpose:
 *
 *   the walk     found here in the browser, posted to /api/upload/walk as
 *                detections, back in seconds, openable immediately.
 *   the splat    the video itself posted to /api/splat/jobs, which stores it and
 *                hands it to a reconstructor, back in minutes. The walk does not
 *                wait for it; every moment simply reads `processing` until it
 *                lands.
 *
 * The frames never leave the tab. The video does, and only if reconstruction is
 * asked for — the checkbox says so, and it is off by default.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CHECKBOX SAYS WHERE THE CLIP WENT, INCLUDING "NOWHERE".
 *
 * This panel used to tick the box, upload, keep the job id, and start a live
 * watcher on it — and the upload route dispatched nothing at all, so the watcher
 * sat on a queue that did not exist, reporting "waiting" and then "still working"
 * forever. The route now dispatches and reports where it went, and none of that
 * is worth anything if this side ignores the answer: an outcome with `ok: false`
 * or `target: null` means NOTHING is reconstructing this clip, and the one thing
 * that must not happen next is a progress indicator.
 *
 * So the watcher is started only when something is actually working, and a
 * refusal is printed in the server's own words with the retry still offered
 * beside it — the clip is on disk either way, which is what makes the retry a
 * button press rather than another walk around the building.
 */
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SaveToAlbum } from "@/components/album/SaveToAlbum";
import { SetPlace } from "@/components/live/SetPlace";
import { PhoneHandoffPanel } from "@/components/live/PhoneHandoffPanel";
import { ReconstructionWatch } from "@/components/live/ReconstructionWatch";
import { TryAnyway } from "@/components/live/TryAnyway";
import { DETECTOR_MODELS, formatBytes, type ProgressInfo } from "@/lib/detector";
import { WHISPER_APPROX_MB } from "@/lib/audio/transcribe";
import { DEFAULT_RECON_TARGET } from "@/lib/reconstruction/preference";
import { useReconTarget } from "@/lib/reconstruction/useReconTarget";
import type { ReconTarget } from "@/lib/reconstruction/targets";
import { buildWalkFromVideo, type BuiltWalk, type WalkPhase } from "@/lib/video/buildWalk";

type Phase = "idle" | WalkPhase | "done" | "error";

interface Found extends BuiltWalk {
  splatJobId: string | null;
}

/**
 * The part of the server's DispatchOutcome this panel reads.
 *
 * Declared structurally rather than imported from lib/reconstruction/dispatch,
 * which is a server module (it reads the filesystem) and whose outcome carries
 * fields — pre-flight measurements, KIRI handles — that are none of this
 * component's business. Same posture as TryAnyway.
 */
interface Handoff {
  ok: boolean;
  /** Where it actually went. Null means nowhere: stored, and idle. */
  target: ReconTarget | null;
  /** True when it went somewhere other than what was asked for. */
  degraded: boolean;
  note: string;
}

/**
 * What to call each destination in one line of a checkbox.
 *
 * KIRI names its price here, and that is the point of the map existing. The
 * server will never send a clip to KIRI unless it is asked to by name, so the
 * only way this box can spend a credit is a preference the reader set
 * themselves in the picker below — and a checkbox that quietly acts on a choice
 * made in a different control ten minutes ago should at minimum repeat it back.
 */
const TARGET_SHORT: Record<ReconTarget, string> = {
  browser: "this tab",
  "studio-live": "the studio on your laptop",
  "studio-batch": "the studio on your laptop",
  kiri: "KIRI · spends one credit",
};

export function VideoWalkPanel() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  /**
   * The destination this reader last chose, remembered between visits. The
   * checkbox has no picker of its own — it borrows the one from TryAnyway rather
   * than growing a second, disagreeing answer to the same question — so on a
   * first visit this is DEFAULT_RECON_TARGET, which is local and free.
   */
  const preferred = useReconTarget();

  const [modelId, setModelId] = useState(DETECTOR_MODELS[0].id);
  const [reconstruct, setReconstruct] = useState(false);
  const [transcribe, setTranscribe] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [step, setStep] = useState({ done: 0, total: 0 });
  const [file, setFile] = useState<File | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = phase !== "idle" && phase !== "done" && phase !== "error";

  /**
   * The job opened lazily by "try anyway", so pressing it twice does not upload
   * a 100 MB clip twice. A ref rather than state because nothing renders from
   * it — it exists only to make the second press cheap.
   */
  const lazyJobRef = useRef<string | null>(null);

  /**
   * The same id, as state, once something has actually dispatched it.
   *
   * The ref above exists to stop a second upload; this exists to render a
   * watcher. They are deliberately separate — a job that was opened but never
   * dispatched has nothing to watch yet.
   */
  const [watchJobId, setWatchJobId] = useState<string | null>(null);

  /**
   * What the server did with the clip the checkbox uploaded, if it uploaded one.
   *
   * Null means the box was never ticked. A value with `ok: false` is NOT an
   * error state — the upload succeeded and the clip is on disk; only the
   * dispatch went nowhere. Those two facts are rendered separately below,
   * because collapsing them is how the panel ends up either hiding a saved
   * recording or watching a queue that is empty.
   */
  const [handoff, setHandoff] = useState<Handoff | null>(null);

  /**
   * The job to point a watcher at, or null for "nothing is being reconstructed".
   *
   * Two ways in, and neither of them is "a job exists". The checkbox path
   * qualifies only once the server has said it handed the clip on; the
   * TryAnyway path reports its own outcome inline, so its id is taken at its
   * word here. The null case is the one that had no representation at all
   * before — a stored, undispatched clip — and it is now the difference between
   * a watcher and a sentence explaining why there is nothing to watch.
   */
  const inFlightJobId =
    watchJobId ?? (handoff?.ok && found?.splatJobId ? found.splatJobId : null);

  /**
   * The job whose clip the server holds, uploading it now if it does not.
   *
   * Unlike the phone path, this panel may never have sent the video at all —
   * leaving it in the tab is the entire point of the "also reconstruct" box
   * being off by default. So a change of mind afterwards costs one upload, and
   * only the first time.
   */
  const resolveJobId = useCallback(async (): Promise<string> => {
    const already = found?.splatJobId ?? lazyJobRef.current;
    if (already) return already;
    if (!file) {
      throw new Error("that video is no longer open in this tab — choose it again");
    }
    const form = new FormData();
    form.append("video", file);
    // Attach it to the walk that was just built, so the reconstruction lands on
    // the right trip rather than floating loose.
    if (found) form.append("tripId", found.tripId);
    /*
      DELIBERATELY the free local target, and NOT `preferred`.

      This path exists to get the bytes onto the server for TryAnyway, which is
      about to POST /api/splat/jobs/<id>/dispatch with the destination the
      reader actually pressed. Passing the remembered preference here would make
      that two dispatches of the same clip — harmless for the studio, which only
      queues, and a second spent credit if the remembered answer is KIRI. So
      this one asks for the destination that cannot cost anything, and the real
      choice is made once, by the button.
    */
    form.append("target", DEFAULT_RECON_TARGET);

    const res = await fetch("/api/splat/jobs", { method: "POST", body: form });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `the upload was refused (${res.status})`);
    }
    const id = ((await res.json()) as { job?: { id?: string } }).job?.id;
    if (!id) throw new Error("the server took the video but opened no job");
    lazyJobRef.current = id;
    return id;
  }, [file, found]);

  const run = useCallback(
    async (video: File) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);
      setFound(null);
      setHandoff(null);
      setWatchJobId(null);
      lazyJobRef.current = null;
      setFile(video);

      try {
        // The reconstruction leaves FIRST, if asked, so the long errand gets a
        // head start while the detector is still downloading. A reconstruction
        // that fails must never cost you the walk.
        let splatJobId: string | null = null;
        if (reconstruct) {
          const form = new FormData();
          form.append("video", video);
          // Named outright, because the server will only ever send a clip to a
          // paid destination that was asked for by name — an absent field falls
          // back to the local studio there, and that is the correct thing for it
          // to do. This is the reader's own remembered answer, echoed in the
          // checkbox label so it is not a surprise.
          form.append("target", preferred);

          const res = await fetch("/api/splat/jobs", { method: "POST", body: form });
          if (res.ok) {
            const body = (await res.json()) as {
              job?: { id?: string };
              reconstruction?: Handoff;
            };
            splatJobId = body.job?.id ?? null;
            // Straight through, unedited. The server phrased this for a person
            // and already knows things this tab does not — whether the studio
            // answered, what pre-flight measured, whether a credit was spent.
            setHandoff(body.reconstruction ?? null);
          } else {
            /*
              The upload itself was refused, so there is no job and no clip on
              the server — a different failure from "stored but not dispatched",
              and the only one where the video exists nowhere but this tab.

              Said out loud rather than logged. The console line this replaces
              meant the panel went on to render as though reconstruction had
              never been asked for, silently downgrading a ticked box into an
              unticked one. The walk still runs; `splatJobId` stays null, so the
              retry below is offered and will upload again from the file we
              still hold.
            */
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            setHandoff({
              ok: false,
              target: null,
              degraded: false,
              note:
                (body.error ?? `The upload was refused (${res.status}).`) +
                " The video is still open in this tab — you can send it again below.",
            });
          }
        }

        // The funnel itself is lib/video/buildWalk.ts, because a clip arriving
        // from the phone has to go through exactly the same one — otherwise the
        // two paths give different answers for the same footage and nobody can
        // say which is right. See components/live/CapturedWalk.tsx.
        const built = await buildWalkFromVideo({
          video,
          modelId,
          splatJobId,
          transcribe,
          signal: controller.signal,
          onProgress: (p) => {
            setPhase(p.phase);
            if (p.download !== undefined) setProgress(p.download);
            if (p.step) setStep(p.step);
          },
        });

        setFound({ ...built, splatJobId });
        setPhase("done");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setPhase("idle");
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      } finally {
        abortRef.current = null;
      }
    },
    [modelId, reconstruct, transcribe, preferred],
  );

  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("video/")) {
      setError(`that is ${f.type || "not a video"} — drop a video file`);
      setPhase("error");
      return;
    }
    void run(f);
  };

  return (
    <section className="plate-vellum rise-in relative p-5 sm:p-6" style={{ "--i": 3 } as React.CSSProperties}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="fnote text-[10px] text-ink-faint">[ 03 ]</span>
          <h2 className="mt-1 text-[20px] leading-tight text-ink">Or bring your own footage</h2>
          <p className="mt-1.5 max-w-prose text-[13.5px] leading-relaxed text-ink-soft">
            A video has a real timeline, so the scorer can do real work on it. The frames are read
            and detected in this tab — the file itself is only sent if you ask for a reconstruction.
          </p>
        </div>
        <span className="fnote chip chip-live text-[10px]">[ real pipeline ]</span>
      </header>

      {/* ── Options ────────────────────────────────────────────────────────── */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {DETECTOR_MODELS.map((m) => (
          <button
            key={m.id}
            type="button"
            disabled={busy}
            onClick={() => setModelId(m.id)}
            title={m.note}
            className={`pill-ghost px-3 py-1.5 text-[12.5px] disabled:opacity-50 ${
              modelId === m.id ? "bg-brass/20 text-ink" : "text-ink-soft"
            }`}
          >
            {m.label}
            <span className="fnote text-[9px] text-ink-faint">[ ~{m.approxMb}MB ]</span>
          </button>
        ))}

        {/* `w-full`, matching the transcribe row below. This used to be `ml-auto`,
            which parked it at the right edge of the model-chip row — correct when
            it was the only option, wrong the moment a second one appeared beneath
            it, because two peer checkboxes then hung off opposite margins. */}
        {/* The tooltip used to read "Reconstruction runs on the GPU box, not
            here" — a sentence about a machine this app had never contacted, on
            a route that dispatched nothing. It now names the destination the
            clip will actually be offered to, and admits that the destination
            can turn out to be unreachable, which is the outcome the panel
            below is written to report rather than hide. */}
        <label
          className={`fnote flex w-full cursor-pointer items-center gap-2 text-[10px] ${
            reconstruct ? "text-clay" : "text-ink-faint"
          }`}
          title={`Uploads the video to this app and hands it to ${TARGET_SHORT[preferred]}. If nothing is reachable the clip is still saved and you can send it somewhere else afterwards — it is never reconstructed without being asked.`}
        >
          <input
            type="checkbox"
            checked={reconstruct}
            disabled={busy}
            onChange={(e) => setReconstruct(e.target.checked)}
            className="accent-clay"
          />
          [ also reconstruct a splat · uploads the video · → {TARGET_SHORT[preferred]} ]
        </label>

        <label
          className={`fnote flex w-full cursor-pointer items-center gap-2 text-[10px] ${
            transcribe ? "text-lagoon" : "text-ink-faint"
          }`}
          title="Whisper runs in this tab, like the detector. The audio never leaves the machine."
        >
          <input
            type="checkbox"
            checked={transcribe}
            disabled={busy}
            onChange={(e) => setTranscribe(e.target.checked)}
            className="accent-lagoon"
          />
          [ listen too · unlocks the speech and laughter triggers · +{WHISPER_APPROX_MB}MB, stays
          in this tab ]
        </label>
      </div>

      {/* ── The drop target ────────────────────────────────────────────────── */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!busy) onFile(e.dataTransfer.files[0]);
        }}
        className="mt-4 rounded-[6px] p-6 text-center"
        style={{ boxShadow: "inset 0 0 0 1.5px rgb(120 120 108 / 0.35)" }}
      >
        {phase === "idle" || phase === "error" ? (
          <>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="pill-brass px-4 py-2 text-[13px]"
            >
              Choose a video
            </button>
            <p className="fnote mt-2.5 text-[9.5px] text-ink-faint">
              [ or drag one in · mp4, mov, webm ]
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="video/*"
              hidden
              onChange={(e) => onFile(e.target.files?.[0])}
            />

            {/* The footage is usually on the phone that shot it, and getting it
                onto a laptop first is AirDrop, a cable, or a cloud round trip —
                all of which are longer than pointing a camera at a square. The
                same handoff as section 02, but the phone lands on its video
                picker instead of a recorder. */}
            <div className="mt-4 border-t border-ink/10 pt-4">
              <p className="fnote mb-2 text-[9.5px] text-ink-faint">
                [ the video is on your phone? ]
              </p>
              <div className="mx-auto max-w-xs">
                <PhoneHandoffPanel intent="upload" label="Send one from my phone" />
              </div>
            </div>
          </>
        ) : (
          <Working
            phase={phase}
            step={step}
            progress={progress}
            fileName={file?.name}
            onCancel={() => abortRef.current?.abort()}
          />
        )}
      </div>

      {error && (
        <p className="fnote mt-3 text-[10px] text-clay">[ {error} ]</p>
      )}

      {/* ── What it found ──────────────────────────────────────────────────── */}
      {found && phase === "done" && (
        <div className="mt-4 rounded-[6px] bg-milk p-4" style={{ boxShadow: "var(--ring-ink)" }}>
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
            <Stat n={found.detections} label="detections" />
            <Stat n={found.candidates} label="candidates" />
            <Stat n={found.discarded} label="discarded" tone="faint" />
            <Stat n={found.moments} label="moments kept" tone="strong" />
          </div>

          <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
            {found.moments > 0 ? (
              <>
                The scorer kept {found.moments} {found.moments === 1 ? "window" : "windows"} out of{" "}
                {found.candidates}. Where they sit on the map comes from camera motion measured in
                the footage — how far the boxes travel between frames. The distance is a monocular
                estimate and the direction is not estimated at all, so read the line as
                distance-travelled, not as a shape.
              </>
            ) : (
              <>
                Nothing cleared the keep line. That is a real answer, not a failure: with no audio
                pass the speech triggers cannot fire at all, so a clip has to earn it on novelty,
                faces and dwell alone. Try footage where people stay in shot for a while, or where
                new things come into frame.
              </>
            )}
          </p>

          {/* The scorer's own words for the rejection. Without this the panel can
              say only "nothing cleared the line", which is the one sentence that
              does NOT distinguish a clip too short to reconstruct from a clip
              that scored 0.44 against a 0.62 bar — and those want opposite
              responses. Shown whenever anything was discarded, including runs
              that still kept something: a walk that kept one and threw four away
              is exactly when the threshold is worth looking at. */}
          {found.discardReasons.length > 0 && (
            <ul className="mt-2.5 space-y-1">
              {found.discardReasons.map((r) => (
                <li key={r} className="fnote text-[9.5px] leading-relaxed text-ink-faint">
                  [ discarded · {r} ]
                </li>
              ))}
            </ul>
          )}

          {/* A dropped file never reaches the server, so its metadata is never
              read — which makes typing the place the ONLY way this path can
              know one. */}
          <SetPlace tripId={found.tripId} />

          {/* Live, not a static line. This is the only thing that asks KIRI
              whether the job finished and pulls the splat down when it has —
              see components/live/ReconstructionWatch.tsx. The old note just
              told you where to copy a file by hand.

              Gated on the DISPATCH having succeeded, not on the job existing.
              A job id only proves the clip was stored; the watcher's states are
              "waiting" and "still working", so pointing it at a clip nobody
              picked up is a progress bar for a queue of one that no machine is
              reading. That was the bug. */}
          {inFlightJobId && <ReconstructionWatch jobId={inFlightJobId} href={found.href} />}

          {/* Stored, and going nowhere. Said plainly, in the server's own words
              — it knows whether the studio answered, whether a key is missing,
              whether pre-flight refused the clip, and it phrased all of those
              for a person already. The retry sits directly underneath: the
              bytes are on disk, so trying again is a button and not another
              walk around the building. */}
          {handoff && !handoff.ok && (
            <p className="fnote mt-3 text-[10px] leading-relaxed text-clay">
              [ nothing is reconstructing this yet · {handoff.note} ]
            </p>
          )}

          {/* Where it went, said even when it went exactly where it was asked
              to. The watcher above can report that a reconstruction is running
              but not WHICH machine is running it, and "queued for the studio on
              your laptop" versus "sent to KIRI" is the difference between
              waiting for a fan to spin up and having spent a credit. Degraded
              gets the same prefix TryAnyway uses, because being quietly moved to
              another destination is otherwise only ever noticed later, by
              someone wondering why their credits did not go down. */}
          {handoff?.ok && (
            <p className="fnote mt-2 text-[9.5px] leading-relaxed text-ink-faint">
              [ {handoff.degraded ? "sent elsewhere · " : ""}
              {handoff.note} ]
            </p>
          )}

          {/* Overrule the scorer, or pick up after a dispatch that found nothing
              running. Offered only when no reconstruction is actually in flight
              — a second copy of the same clip on the GPU box is not a second
              chance, it is the same errand run twice — and `resolveJobId`
              re-uses the job already opened above, so pressing this after a
              failed dispatch costs no second upload. */}
          {!inFlightJobId && (
            <TryAnyway
              onDispatched={setWatchJobId}
              resolveJobId={resolveJobId}
              prompt={
                handoff && !handoff.ok
                  ? "the clip is saved · send it somewhere that is running"
                  : found.moments > 0
                    ? "reconstruct this place too · sends the video"
                    : "the scorer kept nothing · build the place anyway · sends the video"
              }
            />
          )}

          {/* The same filing step the phone path gets, for the same reason: a
              walk on its own is a file, a walk in an album is a collection. */}
          {found.moments > 0 && <SaveToAlbum journeyId={found.tripId} />}

          {found.moments > 0 && (
            <button
              type="button"
              onClick={() => router.push(found.href)}
              className="pill-brass mt-4 px-4 py-2 text-[13px]"
            >
              Open the walk <span aria-hidden>→</span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Working({
  phase,
  step,
  progress,
  fileName,
  onCancel,
}: {
  phase: Phase;
  step: { done: number; total: number };
  progress: ProgressInfo | null;
  fileName?: string;
  onCancel: () => void;
}) {
  const pct = step.total ? Math.round((100 * step.done) / step.total) : 0;

  const line =
    phase === "loading-model"
      ? progress?.file
        ? `downloading ${progress.file} · ${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}`
        : "loading the detector"
      : phase === "sampling"
        ? `reading frames · ${step.done}/${step.total}`
        : phase === "detecting"
          ? `detecting · frame ${step.done} of ${step.total}`
          : "scoring the windows";

  return (
    <div className="mx-auto max-w-md">
      <p className="fnote text-[10px] text-ink-soft">[ {line} ]</p>
      {fileName && <p className="tag mt-1 truncate text-[12px] text-ink-faint">{fileName}</p>}

      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-ink/10">
        <div
          className="h-full rounded-full bg-clay transition-[width] duration-200"
          style={{ width: `${phase === "building" ? 100 : pct}%` }}
        />
      </div>

      {(phase === "sampling" || phase === "detecting") && (
        <button
          type="button"
          onClick={onCancel}
          className="fnote mt-3 text-[9.5px] text-ink-faint underline-offset-4 hover:text-ink hover:underline"
        >
          [ cancel ]
        </button>
      )}
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: "faint" | "strong" }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span
        className={`tnum text-[19px] leading-none ${
          tone === "strong" ? "text-clay" : tone === "faint" ? "text-ink-faint" : "text-ink"
        }`}
      >
        {n.toLocaleString()}
      </span>
      <span className="fnote text-[9.5px] text-ink-faint">{label}</span>
    </span>
  );
}
