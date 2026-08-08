"use client";

/**
 * Moment detail. Owns the two pieces of shared state that make the panels feel
 * like one thing: the selected object (chips ↔ splat anchors) and the cited
 * transcript lines (Q&A → transcript).
 *
 * `?anchor=<trackId>` arrives from object search and seeds the selection, which
 * makes the camera fly to it on mount. That is the search → 3D handoff, and it is
 * why this is a route rather than the modal the design uses — a modal has no
 * address to deep-link to.
 *
 * Note what is NOT here: no effect syncing the anchor param into state, and no
 * effect syncing the keyframe to the selected object. Both are derived during
 * render instead (see `selectedTrackId` and `keyframeIndex`), because a setState
 * inside an effect costs a second render pass and the React Compiler flags it.
 */
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Keyframe, SyntheticBadge } from "@/components/Keyframe";
import { MomentQA } from "@/components/moment/MomentQA";
import { NowPlaying } from "@/components/moment/NowPlaying";
import { ObjectChips } from "@/components/moment/ObjectChips";
import { TranscriptPanel } from "@/components/moment/TranscriptPanel";
import { SectionHeading, SplatStatusChip, StageTag } from "@/components/ui";
import { clockTime, compactNumber, duration, timecode } from "@/lib/format";
import type { MomentView } from "@/lib/tripData";

// The 3D stage pulls in three.js — keep it out of the initial page payload and
// off the server entirely (it needs canvas + WebGL).
const SplatStage = dynamic(
  () => import("@/components/splat/SplatStage").then((m) => m.SplatStage),
  {
    ssr: false,
    loading: () => (
      <div className="surface grid h-[380px] place-items-center rounded-2xl bg-ink-950 sm:h-[460px] lg:h-[520px]">
        <span className="font-mono text-[11px] text-fog-400">loading reconstruction…</span>
      </div>
    ),
  },
);

export function MomentDetail({ view }: { view: MomentView }) {
  const { moment, tripId, tripTitle, tripStartedAt, prev, next, navTargets } = view;
  const anchorParam = useSearchParams().get("anchor");

  // The deep link is the initial selection; a click overrides it. Keying the
  // override by param means a client-side nav to another anchor re-seeds cleanly
  // without an effect.
  const [override, setOverride] = useState<{ from: string | null; trackId: string | null } | null>(
    null,
  );
  const selectedTrackId = override?.from === anchorParam ? override.trackId : anchorParam;
  const setSelectedTrackId = (trackId: string | null) =>
    setOverride({ from: anchorParam, trackId });

  const [citedIds, setCitedIds] = useState<string[]>([]);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [seekIndex, setSeekIndex] = useState<number | null>(null);

  const selectedObject = useMemo(
    () => moment.objects.find((o) => o.trackId === selectedTrackId) ?? null,
    [moment.objects, selectedTrackId],
  );

  // Selecting an object jumps the strip to the frame it looked best in; an
  // explicit click on a thumb (seekIndex) wins over that.
  const objectFrameIndex = selectedObject
    ? moment.keyframes.findIndex((k) => k.id === selectedObject.keyframeId)
    : -1;
  const keyframeIndex = seekIndex ?? (objectFrameIndex >= 0 ? objectFrameIndex : 0);
  const activeKeyframe = moment.keyframes[keyframeIndex];

  const seek = (t: number, segmentId: string) => {
    setActiveSegmentId(segmentId);
    setSeekIndex(
      moment.keyframes.reduce(
        (best, k, i) => (Math.abs(k.t - t) < Math.abs(moment.keyframes[best].t - t) ? i : best),
        0,
      ),
    );
  };

  const selectObject = (trackId: string | null) => {
    setSelectedTrackId(trackId);
    setSeekIndex(null); // let the new object choose the frame
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
        <div className="min-w-0 max-w-2xl">
          <p className="eyebrow">
            <Link href={`/trip/${tripId}`} className="transition-colors hover:text-fog-200">
              {tripTitle}
            </Link>
            <span className="mx-1.5 text-ink-500">/</span>
            <span className="tnum">{timecode(moment.tStart)}</span>
          </p>
          <h1 className="mt-1.5 font-display text-2xl font-bold leading-tight text-fog-100">
            {moment.title}
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-fog-300">{moment.summary}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-[11px] text-fog-400">
            <span>{moment.place.label}</span>
            <span className="text-ink-500">·</span>
            <span className="tnum">
              {clockTime(tripStartedAt, moment.tStart)} · {duration(moment.tEnd - moment.tStart)}
            </span>
            {moment.people.length > 0 && (
              <>
                <span className="text-ink-500">·</span>
                <span>with {moment.people.join(", ")}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col items-start gap-2 sm:items-end">
          <SplatStatusChip status={moment.splat.status} />
          <StageTag n={3} name={`from ${moment.candidateId}`} />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        {/* ── Left: the 3D stage and the frames ─────────────────────────── */}
        <div className="space-y-4">
          {/* No badge or nav-hint overlay here on purpose: SplatStage already draws
              both, and its copy is more honest — it names which mode you are
              looking at ("synthetic preview · 24k points" vs "reconstruction · N
              splats") rather than labelling everything a Gaussian splat. */}
          <SplatStage
            moment={moment}
            focusTrackId={selectedTrackId}
            onSelectObject={selectObject}
            className="h-[380px] sm:h-[460px] lg:h-[520px]"
          />

          {selectedObject && (
            <div className="surface flex flex-wrap items-center justify-between gap-3 rounded-xl px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[13px] text-fog-100">
                  Focused on <span className="font-semibold">{selectedObject.label}</span>
                </p>
                <p className="tnum mt-0.5 font-mono text-[10px] text-fog-400">
                  track {selectedObject.trackId} · {selectedObject.detectionCount} frames ·{" "}
                  {timecode(selectedObject.firstSeenT)}–{timecode(selectedObject.lastSeenT)}
                  {selectedObject.worldPos &&
                    ` · (${selectedObject.worldPos[0].toFixed(1)}, ${selectedObject.worldPos[2].toFixed(1)}) m`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => selectObject(null)}
                className="shrink-0 rounded-md border border-ink-700 px-2 py-1 text-[11px] text-fog-300 transition-colors hover:border-ink-600 hover:text-fog-100"
              >
                clear
              </button>
            </div>
          )}

          <section>
            <SectionHeading hint="The frames stage 3 pulled for this moment. Click one to inspect it.">
              Frames
            </SectionHeading>

            <div className="relative overflow-hidden rounded-2xl bg-ink-850">
              <Keyframe
                keyframe={activeKeyframe}
                alt={`Frame at ${timecode(activeKeyframe.t)}`}
                className="aspect-[16/10] w-full object-cover"
                width={960}
                height={600}
              />
              {/* The detection box on this frame, if the selected object was in it. */}
              {selectedObject && selectedObject.keyframeId === activeKeyframe.id && (
                <span
                  className="pointer-events-none absolute border-2 border-machine-400"
                  style={{
                    left: `${selectedObject.bestBbox[0] * 100}%`,
                    top: `${selectedObject.bestBbox[1] * 100}%`,
                    width: `${selectedObject.bestBbox[2] * 100}%`,
                    height: `${selectedObject.bestBbox[3] * 100}%`,
                  }}
                >
                  <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-machine-400 px-1 font-mono text-[10px] text-ink-950">
                    {selectedObject.label} {selectedObject.confidence.toFixed(2)}
                  </span>
                </span>
              )}
              <div className="absolute left-2 top-2 flex items-center gap-1.5">
                <span className="glass tnum rounded px-1.5 py-0.5 font-mono text-[10px] text-fog-300">
                  {timecode(activeKeyframe.t)}
                </span>
                {!activeKeyframe.url && <SyntheticBadge />}
              </div>
            </div>

            {/* Scrolls in its own container: 4 thumbs exceed a phone's width, and
                the page body must never scroll horizontally. */}
            <div className="scrollbar-thin mt-2 flex gap-2 overflow-x-auto pb-1">
              {moment.keyframes.map((kf, i) => (
                <button
                  key={kf.id}
                  type="button"
                  onClick={() => setSeekIndex(i)}
                  className={`relative shrink-0 overflow-hidden rounded-lg border transition-all ${
                    i === keyframeIndex
                      ? "border-machine-400"
                      : "border-ink-700 opacity-60 hover:opacity-100"
                  }`}
                  aria-label={`Frame at ${timecode(kf.t)}`}
                >
                  <Keyframe
                    keyframe={kf}
                    alt=""
                    className="h-14 w-24 object-cover"
                    width={192}
                    height={112}
                  />
                </button>
              ))}
            </div>
          </section>

          <CaptureFacts view={view} />
        </div>

        {/* ── Right: the machine layer and the human layer ──────────────── */}
        <div className="space-y-6">
          <section>
            <SectionHeading
              hint={`${moment.objects.length} tracked`}
              right={<StageTag n={1} name="detections" />}
            >
              Objects
            </SectionHeading>
            <ObjectChips
              objects={moment.objects}
              selectedTrackId={selectedTrackId}
              onSelect={selectObject}
              navTargets={navTargets}
            />
          </section>

          <section>
            <SectionHeading hint="Templated answers, real citations.">Ask about it</SectionHeading>
            <MomentQA moment={moment} onCite={setCitedIds} />
          </section>

          <section>
            <SectionHeading hint={`${moment.transcript.length} lines`}>Transcript</SectionHeading>
            <TranscriptPanel
              transcript={moment.transcript}
              highlightIds={citedIds}
              activeSegmentId={activeSegmentId}
              onSeek={seek}
            />
          </section>

          <section>
            <SectionHeading>Soundtrack</SectionHeading>
            <NowPlaying music={moment.music} vibe={moment.vibe} />
          </section>
        </div>
      </div>

      <nav className="flex items-center justify-between gap-4 border-t border-ink-800 pt-4">
        {prev ? <NavLink href={`/trip/${tripId}/moment/${prev.id}`} dir="prev" title={prev.title} /> : <span />}
        {next ? <NavLink href={`/trip/${tripId}/moment/${next.id}`} dir="next" title={next.title} /> : <span />}
      </nav>
    </div>
  );
}

/**
 * The design's 2×2 metadata grid. The mockup hardcodes "4K · 3DGS" for every
 * moment; these are read off the Moment, so a `processing` or `failed`
 * reconstruction says so rather than claiming a resolution it doesn't have.
 */
function CaptureFacts({ view }: { view: MomentView }) {
  const { moment } = view;
  const { splat } = moment;

  const reconstruction =
    splat.status === "ready"
      ? splat.pointCount
        ? `${compactNumber(splat.pointCount)} splats`
        : "ready"
      : splat.status === "processing"
        ? "still reconstructing"
        : "failed to converge";

  const facts: Array<{ label: string; value: string }> = [
    { label: "Duration", value: duration(moment.tEnd - moment.tStart) },
    {
      label: "Capture frames",
      value: splat.captureFrameCount ? String(splat.captureFrameCount) : "—",
    },
    { label: "Reconstruction", value: reconstruction },
    { label: "Objects placed", value: `${moment.objects.filter((o) => o.worldPos).length}/${moment.objects.length}` },
  ];

  return (
    <dl className="grid grid-cols-2 gap-2">
      {facts.map((f) => (
        <div key={f.label} className="rounded-xl border border-white/[0.05] bg-white/[0.03] px-3 py-2.5">
          <dt className="font-mono text-[10px] text-fog-400">{f.label}</dt>
          <dd className="tnum mt-0.5 truncate font-display text-[13px] font-medium text-fog-100">
            {f.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function NavLink({ href, dir, title }: { href: string; dir: "prev" | "next"; title: string }) {
  return (
    <Link
      href={href}
      className={`group min-w-0 max-w-[45%] ${dir === "next" ? "text-right" : ""}`}
    >
      <span className="eyebrow block text-[10px]">
        {dir === "prev" ? "← earlier" : "later →"}
      </span>
      <span className="mt-0.5 block truncate text-[13px] text-fog-200 transition-colors group-hover:text-fog-100">
        {title}
      </span>
    </Link>
  );
}
