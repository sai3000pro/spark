"use client";

/**
 * Drop several clips in, get the route you walked out.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CLAIM
 *
 * One clip is a walk; several clips are a journey. You filmed the courtyard,
 * stopped, walked to the fountain, filmed that, walked on — and the gaps are as
 * much a part of the route as the footage. Every phone already stamps each file
 * with when and roughly where it was shot, so the order and the shape of that
 * path do not have to be typed in: they can be read out of the containers and
 * then shown to the person who was actually there, who is the only one able to
 * say where it went wrong.
 *
 * So this panel reads, derives, and then argues with itself in public. The route
 * arrives with its ordering basis named, its located/timed counts against N, and
 * every assumption printed in full underneath. Every row can be moved, re-timed,
 * re-placed or dropped, and every correction can be reset, because the readings
 * are never overwritten — only overruled. See lib/journey/clips.ts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT REFUSES TO CLAIM
 *
 * Not that the first draft is right. `deriveRoute` is expected to be wrong about
 * at least one clip in a real pile, and a route ordered off filenames or a
 * filesystem mtime says exactly that in the sentence above the list rather than
 * presenting a guess with the same confidence as a GPS fix.
 *
 * Not that a position it worked out is a position it measured. `locationSource`
 * and `recordedAtSource` reach the screen on every row, in four different
 * sentences and three tones, because a dot inferred from the clips either side
 * of it renders identically to a dot from a satellite unless something forces
 * them apart.
 *
 * Not that anything has been uploaded before it has. Reading the metadata is a
 * `File.slice()` of a few kilobytes per clip in this tab; nothing is sent
 * anywhere until "Build the journey" is pressed, and that is the whole privacy
 * property of this path. It is also stated as exactly that and no more — the
 * clips stay in the tab UNTIL that button, not forever.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO PROGRESS BAR FOR WORK THAT IS NOT HAPPENING
 *
 * This codebase has shipped that bug — a watcher spinning on a queue nothing had
 * been dispatched to, reporting "still working" forever (see the header of
 * components/live/VideoWalkPanel.tsx). The rule it left behind is obeyed here in
 * two places. A clip whose walk throws is recorded as failed and named at the
 * end, and the build carries on with the rest: losing a nine-clip journey to one
 * corrupt file is the wrong trade, and reporting nine successes when eight
 * happened is the wrong lie. And the journey link appears only after the POST
 * has come back 201 — if it fails, the failure is what gets printed, in the
 * server's own words, with the walks that DID get built still named so the work
 * is not silently thrown away.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { ClipBuildStatus } from "@/components/journey/ClipRow";
import { RouteEditor } from "@/components/journey/RouteEditor";
import {
  NO_CORRECTIONS,
  type ClipCorrection,
  type ClipFacts,
  type DerivedRoute,
  type RouteCorrections,
} from "@/lib/journey/clips";
import { readAllClipFacts } from "@/lib/journey/clientMetadata";
import {
  addCorrection,
  applyCorrections,
  clearFor,
  correctionsFor,
  describeCorrection,
} from "@/lib/journey/corrections";
import { DETECTOR_MODELS } from "@/lib/detector";
import { formatBytes } from "@/lib/format";
import { buildWalkFromVideo, describeProgress } from "@/lib/video/buildWalk";

/** A clip that did not become a walk, kept by name so it can be said out loud. */
interface Failure {
  name: string;
  message: string;
}

/** What the server said when it filed the journey. Only ever set on a 201. */
interface Filed {
  journeyId: string;
  href: string;
  note: string;
}

type Phase = "idle" | "reading" | "ready" | "building" | "filing" | "done";

export function MultiVideoPanel() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  /**
   * The actual `File` objects, keyed by the clip id the metadata reader minted.
   *
   * A ref rather than state because nothing renders from it: the rows render
   * from `ClipFacts`, and this exists only so that at build time — potentially
   * several minutes and a dozen corrections later — each clip in route order can
   * find its own bytes. A `File` handle is also the one thing in here that can
   * go stale underneath us (the file moved, the drive ejected), which is why the
   * build treats a missing entry as a per-clip failure rather than a crash.
   */
  const filesRef = useRef<Map<string, File>>(new Map());

  const [facts, setFacts] = useState<ClipFacts[]>([]);
  const [corrections, setCorrections] = useState<RouteCorrections>(NO_CORRECTIONS);
  const [phase, setPhase] = useState<Phase>("idle");
  const [title, setTitle] = useState("");

  /** Files dropped that were not video. Counted rather than silently dropped. */
  const [ignored, setIgnored] = useState<string[]>([]);

  const [readProgress, setReadProgress] = useState({ done: 0, total: 0 });
  const [buildAt, setBuildAt] = useState<{ index: number; total: number; name: string } | null>(
    null,
  );
  const [statuses, setStatuses] = useState<Record<string, ClipBuildStatus>>({});
  const [failures, setFailures] = useState<Failure[]>([]);
  const [built, setBuilt] = useState(0);
  const [filed, setFiled] = useState<Filed | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = phase === "reading" || phase === "building" || phase === "filing";

  /**
   * The route, re-derived from the readings and the corrections on every render
   * that changes either.
   *
   * Deliberately NOT stored: a derived route held in state is a second answer to
   * "what order are these in" that drifts from the first one the moment a
   * correction lands. Same reasoning as lib/uploadedTrips.ts gives about derived
   * state generally.
   */
  const route: DerivedRoute | null = useMemo(
    () => (facts.length ? applyCorrections(facts, corrections) : null),
    [facts, corrections],
  );

  // ── Choosing the clips ───────────────────────────────────────────────────

  /**
   * Read the metadata of a fresh selection, in this tab.
   *
   * A selection REPLACES the previous one rather than adding to it. Appending
   * would mean a second set of clip ids minted by a second call to the reader,
   * with no guarantee they do not collide with the first set's — and a collision
   * there silently attaches one clip's corrections to another clip's footage.
   * The footnote under the button says so, because a control that quietly throws
   * away the eight files you dropped a minute ago is worse than one that warns.
   */
  const take = useCallback(async (dropped: File[]) => {
    const videos = dropped.filter((f) => f.type.startsWith("video/"));
    const rejected = dropped.filter((f) => !f.type.startsWith("video/"));
    setIgnored(rejected.map((f) => f.name));

    if (!videos.length) {
      setError(
        rejected.length
          ? `none of those ${rejected.length} files is a video — this reads mp4, mov and webm`
          : "no files came through — try choosing them with the button",
      );
      return;
    }

    // A new pile is a new journey: old corrections point at clip ids that no
    // longer exist, and old build results describe footage nobody can see now.
    setError(null);
    setCorrections(NO_CORRECTIONS);
    setStatuses({});
    setFailures([]);
    setBuilt(0);
    setFiled(null);
    setFacts([]);
    filesRef.current = new Map();

    setPhase("reading");
    setReadProgress({ done: 0, total: videos.length });
    try {
      const read = await readAllClipFacts(videos, (done, total) =>
        setReadProgress({ done, total }),
      );

      /*
        Pair each reading back to the file it came from.

        `readAllClipFacts` returns one `ClipFacts` per input file in the order it
        was given them, so index is the pairing. It is checked rather than
        assumed: if the lengths ever disagree, fall back to matching on name and
        size, and leave anything still unmatched out of the map — a clip with no
        file will refuse to build and say why, which is a great deal better than
        one clip's row building a different clip's footage.
      */
      const map = new Map<string, File>();
      if (read.length === videos.length) {
        read.forEach((f, i) => map.set(f.id, videos[i]));
      } else {
        for (const f of read) {
          const match = videos.find((v) => v.name === f.name && v.size === f.bytes);
          if (match) map.set(f.id, match);
        }
      }
      filesRef.current = map;

      setFacts(read);
      setPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("idle");
    }
  }, []);

  const onEdit = useCallback((edit: ClipCorrection) => {
    setCorrections((c) => addCorrection(c, edit));
  }, []);

  const onReset = useCallback((clipId: string) => {
    setCorrections((c) => clearFor(c, clipId));
  }, []);

  const editsFor = useCallback(
    (clipId: string) => correctionsFor(corrections, clipId).map(describeCorrection),
    [corrections],
  );

  const statusFor = useCallback((clipId: string) => statuses[clipId], [statuses]);

  // ── Building it ──────────────────────────────────────────────────────────

  /**
   * Every non-omitted clip through `buildWalkFromVideo`, in route order, then
   * one POST that files the lot as a journey.
   *
   * The loop is sequential and not `Promise.all`: each walk loads a detector and
   * decodes frames in this tab, and nine of those at once is a tab that stops
   * responding and a progress display that cannot say which clip it is on.
   *
   * One clip failing is NOT the end of the journey. Corrupt file, a clip shorter
   * than the scorer's window, a detector that found nothing above the threshold —
   * all of those are ordinary and none of them is a reason to throw away the
   * eight walks that did build. They are collected and named at the end instead.
   */
  const build = useCallback(async () => {
    if (!route) return;
    const ordered = route.clips.filter((c) => !c.omitted);
    if (!ordered.length) {
      setError("every clip is left out — put at least one back to build a journey");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setFiled(null);
    setFailures([]);
    setBuilt(0);
    const waiting: Record<string, ClipBuildStatus> = {};
    for (const c of ordered) waiting[c.facts.id] = { state: "waiting" };
    setStatuses(waiting);
    setPhase("building");

    const walked: Failure[] = [];
    const tripIds = new Map<string, string>();

    for (let i = 0; i < ordered.length; i++) {
      const clip = ordered[i];
      const id = clip.facts.id;
      const file = filesRef.current.get(id);
      setBuildAt({ index: i, total: ordered.length, name: clip.facts.name });

      if (!file) {
        // The handle went stale, or the pairing above could not find it. Either
        // way there are no bytes to run a detector over, and saying so is the
        // only honest option.
        walked.push({ name: clip.facts.name, message: "that file is no longer open in this tab" });
        setStatuses((s) => ({
          ...s,
          [id]: { state: "failed", message: "no longer open in this tab" },
        }));
        continue;
      }

      setStatuses((s) => ({ ...s, [id]: { state: "building", line: "starting" } }));
      try {
        const walk = await buildWalkFromVideo({
          video: file,
          modelId: DETECTOR_MODELS[0].id,
          signal: controller.signal,
          // The same words the phone path uses for the same stage, so two
          // routes through the same pipeline do not describe it differently.
          onProgress: (p) =>
            setStatuses((s) => ({ ...s, [id]: { state: "building", line: describeProgress(p) } })),
        });
        tripIds.set(id, walk.tripId);
        setBuilt((n) => n + 1);
        setStatuses((s) => ({ ...s, [id]: { state: "built", tripId: walk.tripId } }));
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // Cancelling is not a failure and it is not a partial success either:
          // nothing is filed, and the rows keep whatever state they reached so
          // the walks already built are still visible.
          setBuildAt(null);
          setPhase("ready");
          setError(`stopped after ${i} of ${ordered.length} clips — nothing was filed`);
          abortRef.current = null;
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        walked.push({ name: clip.facts.name, message });
        setStatuses((s) => ({ ...s, [id]: { state: "failed", message } }));
      }
    }

    setFailures(walked);
    setBuildAt(null);

    if (tripIds.size === 0) {
      // Nothing to file. A journey of zero walks is not a journey, and posting
      // one so the panel can show a link would be exactly the lie this file's
      // header is about.
      setPhase("ready");
      setError(
        `none of the ${ordered.length} clips built — the reasons are on the rows above, and the files are still open in this tab`,
      );
      abortRef.current = null;
      return;
    }

    // ── Filing it ──────────────────────────────────────────────────────────
    /*
      ALL the facts go up, including the omitted clips', along with the whole
      correction list. The server re-derives with the same `applyCorrections`,
      so sending the same two inputs is what makes its route identical to the one
      on this screen — dropping the omitted clips here would leave their `omit`
      corrections dangling and quietly change the answer.

      `tripId` is attached only where a walk actually got built. A clip that
      failed still happened and still shapes the route, so it travels as a
      position with no footage rather than being erased.
    */
    setPhase("filing");
    try {
      const res = await fetch("/api/journey", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clips: facts.map((f) => {
            const tripId = tripIds.get(f.id);
            return tripId ? { facts: f, tripId } : { facts: f };
          }),
          corrections,
          title: title.trim() || undefined,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        // The walks exist — they were built and filed as trips by
        // /api/upload/walk — so this is a failure to assemble them into a
        // journey, not a failure of the whole afternoon. Said as that.
        setError(
          (body.error ?? `the journey could not be filed (${res.status})`) +
            ` · ${tripIds.size} ${tripIds.size === 1 ? "walk was" : "walks were"} still built and saved`,
        );
        setPhase("ready");
        return;
      }

      const body = (await res.json()) as { journeyId: string; href: string; note: string };
      setFiled(body);
      setPhase("done");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("stopped before the journey was filed — the walks that built are still saved");
        setPhase("ready");
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
      setPhase("ready");
    } finally {
      abortRef.current = null;
    }
  }, [route, facts, corrections, title]);

  const keptCount = route ? route.clips.filter((c) => !c.omitted).length : 0;

  return (
    <section
      className="plate-vellum rise-in relative p-5 sm:p-6"
      style={{ "--i": 4 } as React.CSSProperties}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="fnote text-[10px] text-ink-faint">[ 04 ]</span>
          <h2 className="mt-1 text-[20px] leading-tight text-ink">Or bring a whole afternoon</h2>
          <p className="mt-1.5 max-w-prose text-[13.5px] leading-relaxed text-ink-soft">
            Several clips from the same walk are a journey, and your phone already wrote down when
            and where it shot each one. Drop them all in and the order and the route are worked out
            from the files themselves — then shown to you, with the guesses labelled as guesses, so
            you can fix the ones it got wrong.
          </p>
        </div>
        <span className="fnote chip text-[10px]">[ read in this tab ]</span>
      </header>

      {/* ── The drop target ────────────────────────────────────────────────── */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (busy) return;
          // ALL of them. `files[0]` is the single-clip panel's job; this one
          // exists precisely because a journey is more than one file.
          void take(Array.from(e.dataTransfer.files));
        }}
        className="mt-4 rounded-[6px] p-6 text-center"
        style={{ boxShadow: "inset 0 0 0 1.5px rgb(120 120 108 / 0.35)" }}
      >
        {phase === "reading" ? (
          <div className="mx-auto max-w-md">
            <p className="fnote text-[10px] text-ink-soft">
              [ reading the tags · {readProgress.done} of {readProgress.total} ]
            </p>
            <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-ink/10">
              <div
                className="h-full rounded-full bg-clay transition-[width] duration-200"
                style={{
                  width: `${readProgress.total ? Math.round((100 * readProgress.done) / readProgress.total) : 0}%`,
                }}
              />
            </div>
            <p className="fnote mt-2 text-[9px] leading-relaxed text-ink-faint">
              [ a few kilobytes off the front of each file · nothing is being uploaded ]
            </p>
          </div>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="pill-brass px-4 py-2 text-[13px] disabled:opacity-50"
            >
              Choose several videos
            </button>
            <p className="fnote mt-2.5 text-[9.5px] leading-relaxed text-ink-faint">
              [ or drag them all in at once · mp4, mov, webm · choosing again replaces the set ]
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="video/*"
              multiple
              hidden
              aria-label="choose several videos to build a journey from"
              onChange={(e) => {
                if (e.target.files) void take(Array.from(e.target.files));
                // Cleared so re-choosing the same files fires `change` again.
                e.target.value = "";
              }}
            />
          </>
        )}
      </div>

      {/* Files that were not video, named rather than counted away. Someone who
          dragged a folder in wants to know which four things were skipped. */}
      {ignored.length > 0 && (
        <p className="fnote mt-3 text-[10px] leading-relaxed text-ink-faint">
          [ skipped {ignored.length} {ignored.length === 1 ? "file that was not a video" : "files that were not videos"} ·{" "}
          {ignored.slice(0, 4).join(", ")}
          {ignored.length > 4 ? ` and ${ignored.length - 4} more` : ""} ]
        </p>
      )}

      {error && <p className="fnote mt-3 text-[10px] leading-relaxed text-clay">[ {error} ]</p>}

      {/* ── Where the clips are right now ──────────────────────────────────── */}
      {route && (
        <>
          <p className="mt-4 text-[13px] leading-relaxed text-ink-soft">
            {facts.length} {facts.length === 1 ? "clip" : "clips"} ·{" "}
            {formatBytes(facts.reduce((n, f) => n + f.bytes, 0))} · read in this tab. Nothing has
            been uploaded. The clips stay on this machine until you press{" "}
            <span className="text-ink">Build the journey</span> below — that step sends each one to
            be turned into a walk.
          </p>

          <RouteEditor
            route={route}
            editsFor={editsFor}
            statusFor={statusFor}
            disabled={busy}
            onEdit={onEdit}
            onReset={onReset}
          />

          {/* ── The button that sends them ───────────────────────────────── */}
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="journey-title" className="fnote block text-[9px] text-ink-faint">
                name this journey · optional
              </label>
              <input
                id="journey-title"
                type="text"
                value={title}
                disabled={busy}
                placeholder="Sunday, the long way round"
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-[16rem] rounded-[4px] bg-milk px-2 py-1.5 text-[12.5px] text-ink disabled:opacity-40"
                style={{ boxShadow: "var(--ring-ink)" }}
              />
            </div>

            {phase !== "building" && phase !== "filing" ? (
              <button
                type="button"
                disabled={keptCount === 0 || phase === "reading"}
                onClick={() => void build()}
                className="pill-brass px-4 py-2 text-[13px] disabled:opacity-50"
              >
                Build the journey <span aria-hidden>·</span> {keptCount}{" "}
                {keptCount === 1 ? "clip" : "clips"}
              </button>
            ) : (
              <div className="min-w-[16rem]">
                {/* Only ever shown while a clip is genuinely in the pipeline —
                    `buildAt` is set immediately before each clip's turn and
                    cleared the moment the loop ends. */}
                <p className="fnote text-[10px] leading-relaxed text-ink-soft">
                  [{" "}
                  {phase === "filing"
                    ? "filing the journey…"
                    : buildAt
                      ? `clip ${buildAt.index + 1} of ${buildAt.total} · ${buildAt.name}`
                      : "starting"}{" "}
                  ]
                </p>
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  className="fnote mt-2 text-[9.5px] text-ink-faint underline-offset-4 hover:text-ink hover:underline"
                >
                  [ cancel ]
                </button>
              </div>
            )}
          </div>

          {/* ── What actually happened ────────────────────────────────────── */}
          {failures.length > 0 && (
            <div className="mt-3">
              <p className="fnote text-[10px] leading-relaxed text-clay">
                [ {built} of {built + failures.length} clips became walks ·{" "}
                {failures.length === 1 ? "one did not" : `${failures.length} did not`} ]
              </p>
              <ul className="mt-1 space-y-1">
                {failures.map((f) => (
                  <li key={f.name} className="fnote text-[9.5px] leading-relaxed text-ink-faint">
                    [ {f.name} · {f.message} ]
                  </li>
                ))}
              </ul>
              <p className="fnote mt-1 text-[9px] leading-relaxed text-ink-faint">
                [ those clips are still in the journey as positions on the route · they just have no
                footage attached ]
              </p>
            </div>
          )}

          {/* The link exists only because the server answered 201 and named the
              journey. Every other outcome above ends in a sentence, not a link. */}
          {phase === "done" && filed && (
            <div
              className="mt-4 rounded-[6px] bg-milk p-4"
              style={{ boxShadow: "var(--ring-ink)" }}
            >
              <p className="text-[13px] leading-relaxed text-ink-soft">{filed.note}</p>
              <button
                type="button"
                onClick={() => router.push(filed.href)}
                className="pill-brass mt-3 px-4 py-2 text-[13px]"
              >
                Open the journey <span aria-hidden>→</span>
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
