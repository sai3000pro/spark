"use client";

/**
 * The splat, on its own, with nothing else in the scene.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT SplatViewer
 *
 * It is not a second renderer, and deliberately so — the two engines are still
 * SparkScene and GS3DStage, exactly the components components/relive/SplatViewer.tsx
 * drives. What is missing here is everything that belongs to a MOMENT: object
 * anchors, hover labels, the camera flight that lands you in front of a found
 * cup, and the synthetic stand-in cloud.
 *
 * None of those can exist on this page, because none of them come from the .ply.
 * They come from the detector having been run over the source clip and a walk
 * having been built out of it — and the whole reason this route exists is the
 * reconstruction that HAS NOT had that done to it. Faking a synthetic cloud here
 * would be worse than useless: on a page whose entire subject is one file, a
 * stand-in that quietly replaces it would be a page that lies about the one fact
 * it is for. So a failure here says it failed and offers the raw file instead.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO CONSENT GATE, UNLIKE THE MOMENT VIEWER
 *
 * SplatViewer asks before it fetches anything over 12 MB, because there the
 * capture is a page asset — you opened a moment to read about a moment, and the
 * 96 MB download was a side effect of that. Here the download IS the page. A
 * reader who navigated to /splat/<id> asked for this file by name; putting a
 * "load it?" button in front of it would be asking someone to confirm the thing
 * they just clicked. What they are owed instead is an honest, moving progress
 * readout, which is below — a 144 MB fetch with no feedback reads as hung.
 */
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useCallback, useMemo, useState } from "react";

import { GS3DStage } from "@/components/relive/GS3DStage";
import { SparkScene } from "@/components/relive/SparkScene";
import { compactNumber, formatBytes } from "@/lib/format";
import {
  RENDERER_INFO,
  canOpen,
  formatOf,
  rendererFor,
  type SplatRenderer,
} from "@/lib/splat/renderer";
import { setSplatRenderer, useSplatRenderer } from "@/lib/splat/useSplatRenderer";
import { CANVAS_BG } from "@/lib/theme";
import type { CloudResult } from "@/lib/splat/syntheticCloud";
import type { SplatView } from "@/lib/types";

/**
 * Module scope, not an inline `[]`.
 *
 * GS3DStage lists `anchors` in the dependency array of the effect that builds
 * its viewer, and a fresh array literal every render would tear down and rebuild
 * a multi-hundred-megabyte splat scene on every state change on this page —
 * including the progress ticks. One frozen empty array can never do that.
 */
const NO_ANCHORS: CloudResult["anchors"] = [];

/** There is nothing to select: this page has no objects, only the cloud. */
const NO_SELECTION = () => {};

interface Props {
  /** `/mock/splats/<jobId>.ply`, served straight off disk by Next. */
  url: string;
  /** Measured by lib/video/plyBounds.ts. Never a default — see the note there. */
  view: SplatView;
  /**
   * Widest trimmed extent of the cloud, in file units.
   *
   * Every distance on this page is derived from it rather than hardcoded, which
   * is the difference between a viewer that frames one capture and a viewer that
   * frames any of them. A KIRI room arrives normalised into a ±50 box, roughly
   * a hundred units across; the hand-framed capture in lib/mock/trips is about
   * eighteen. Constants that suit either one are badly wrong for the other —
   * SplatViewer's `maxDistance={26}` would pin you deep inside the KIRI cloud,
   * unable to back out far enough to see it, and a `far` of 260 would clip the
   * back half of the room away.
   */
  span: number;
  /** Bytes on disk, so the wait can be named rather than merely spun at. */
  bytes: number;
  /** Gaussians, from the PLY header. 0 when the file could not be measured. */
  pointCount: number;
}

export function SplatStage({ url, view, span, bytes, pointCount }: Props) {
  const preference = useSplatRenderer();
  // The preference, unless it cannot open this file — the same resolution the
  // moment viewer uses, so a reader's choice means the same thing on both pages.
  const engine = rendererFor(preference, url);

  // Stamped with the engine that produced them, on the same reasoning as
  // SplatViewer: switching renderer restarts the download, and a percentage left
  // over from the previous engine would show a fresh load already at 90%.
  const [load, setLoad] = useState({ key: "", progress: 0, ready: false });
  // Which engine gave up, not merely that one did — the failure copy names it,
  // because "it failed" and "Spark failed, try the other one" are different
  // amounts of help.
  const [failed, setFailed] = useState<SplatRenderer | null>(null);

  const progress = load.key === engine ? load.progress : 0;
  const ready = load.key === engine ? load.ready : false;
  // Stamped for the same reason: switching to the other engine after a failure
  // has to actually try it. Compared rather than cleared, so no effect is needed
  // and there is no window where a dead stage is still showing as loading.
  const isFailed = failed === engine;

  const onProgress = useCallback(
    (percent: number) =>
      setLoad((prev) =>
        prev.key === engine
          ? { ...prev, progress: percent }
          : { key: engine, progress: percent, ready: false },
      ),
    [engine],
  );
  const onReady = useCallback(() => setLoad({ key: engine, progress: 100, ready: true }), [engine]);
  const onFail = useCallback(() => setFailed(engine), [engine]);

  /*
    Clip planes and orbit limits, sized off the measured cloud.

    `far` has to clear the camera's own standing distance with room to spare —
    plyBounds puts the camera 1.25 spans back, so anything under ~2.5 spans
    clips the subject itself, and the slack above that is what lets someone pull
    out to look at the whole thing. `near` stays a thousandth of a span so the
    depth buffer keeps its precision where the splats actually are.

    maxPolarAngle is deliberately NOT clamped, which is the one place this
    differs from the moment stage. That clamp keeps you above the floor of a
    room — a good rule when you know there is a floor. A reconstruction arriving
    here has no such promise: it may be an object on a table, a facade, or a
    cloud that came out of the solver upside down, and refusing to let someone
    orbit underneath it is refusing to let them find out.
  */
  const camera = useMemo(
    () => ({
      position: (view.cameraPosition ?? [0, 1.6, 5]) as [number, number, number],
      fov: 52,
      near: Math.max(0.01, span / 1000),
      far: Math.max(400, span * 12),
    }),
    [view.cameraPosition, span],
  );
  const target = (view.cameraLookAt ?? [0, 0, 0]) as [number, number, number];

  const loading = !isFailed && !ready;

  return (
    <div className="absolute inset-0">
      {isFailed ? (
        <StageFailure url={url} engine={engine} />
      ) : engine === "gs3d" ? (
        <GS3DStage
          url={url}
          view={view}
          anchors={NO_ANCHORS}
          focusTrackId={null}
          onSelectObject={NO_SELECTION}
          onProgress={onProgress}
          onReady={onReady}
          onFail={onFail}
        />
      ) : (
        <Canvas
          // antialias off, matching the moment stage: it costs a lot and buys
          // nothing for a cloud of gaussians, and Spark asks for it off.
          gl={{ antialias: false }}
          dpr={[1, 1.75]}
          camera={camera}
        >
          <color attach="background" args={[CANVAS_BG]} />
          <SparkScene url={url} view={view} onProgress={onProgress} onReady={onReady} onFail={onFail} />
          <OrbitControls
            makeDefault
            enableDamping
            dampingFactor={0.08}
            minDistance={Math.max(0.05, span * 0.02)}
            maxDistance={span * 6}
            target={target}
          />
        </Canvas>
      )}

      {/* ── The wait, named ──────────────────────────────────────────────────
             Two phases, kept separate. The download finishing is not the scene
             appearing: a 144 MB PLY spends a further stretch being parsed and
             uploaded to the GPU, and a bar that sits at 100% through all of it
             is the exact shape of "this has hung". */}
      {loading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          <div
            className="flex w-full max-w-[20rem] flex-col gap-2 rounded-[6px] bg-vellum/95 px-4 py-3"
            style={{ boxShadow: "var(--ring-ink), 0 6px 20px rgb(6 10 11 / 0.45)" }}
          >
            <p className="text-[13px] leading-relaxed text-ink">
              {progress < 100
                ? `Fetching the capture — ${formatBytes(bytes)}.`
                : "Building the scene."}
            </p>

            <div className="h-[3px] w-full overflow-hidden rounded-full bg-ink/10">
              <div
                className="h-full bg-ink/55 transition-[width] duration-200 ease-out"
                style={{ width: `${Math.max(2, Math.round(progress))}%` }}
              />
            </div>

            <p className="fnote text-[9.5px] leading-relaxed text-ink-faint">
              [{" "}
              {progress < 100
                ? `${Math.round(progress)}% · this is a large file, and it is coming down whole`
                : "downloaded · the splats appear as they are sorted"}{" "}
              ]
            </p>
          </div>
        </div>
      )}

      {/* ── Which engine actually drew, and the choice ──────────────────── */}
      <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap items-center gap-1.5">
        <span className="fnote chip chip-plate text-[9.5px]">
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--color-brass)" }}
          />
          [ {pointCount > 0 ? `${compactNumber(pointCount)} gaussians` : "gaussian count unread"} ·{" "}
          {RENDERER_INFO[engine].label.toLowerCase()} ]
        </span>
      </div>

      <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-end justify-between gap-3">
        <EngineChoice engine={engine} preference={preference} url={url} />
        <p className="fnote shrink-0 text-right text-[9px] text-mist">
          drag to orbit · scroll to zoom
        </p>
      </div>
    </div>
  );
}

/**
 * The engine switch, same two buttons the moment viewer offers.
 *
 * Worth having here more than anywhere: this page is where somebody comes when a
 * capture looks wrong, and "try the other renderer" is the single most useful
 * thing they can do about it without leaving. Neither button is ever disabled —
 * choosing an engine that cannot open THIS file is still a valid preference for
 * every other one, and `rendererFor` keeps this file rendering regardless.
 */
function EngineChoice({
  engine,
  preference,
  url,
}: {
  engine: SplatRenderer;
  preference: SplatRenderer;
  url: string;
}) {
  const format = formatOf(url);

  return (
    <div className="pointer-events-auto flex min-w-0 flex-col items-start gap-1">
      <div className="flex items-center gap-1">
        {(["spark", "gs3d"] as const).map((id) => {
          const info = RENDERER_INFO[id];
          const opens = canOpen(id, url);
          const on = engine === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setSplatRenderer(id)}
              title={
                opens
                  ? `${info.library} — ${info.note}`
                  : `${info.library} cannot open ${format ?? "this format"}. ` +
                    `Choosing it still applies everywhere it can.`
              }
              className={`fnote chip chip-plate text-[9.5px] ${
                on ? "text-ink" : "text-ink-faint"
              } ${opens ? "" : "line-through decoration-ink-faint/60"}`}
            >
              {on && (
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: "var(--color-brass)" }}
                />
              )}
              {info.label.toLowerCase()}
            </button>
          );
        })}
      </div>
      {engine !== preference && (
        <p className="fnote max-w-[15rem] text-[9px] leading-relaxed text-mist">
          {RENDERER_INFO[preference].label.toLowerCase()} cannot read{" "}
          {format ? `.${format}` : "this format"} — drawn with{" "}
          {RENDERER_INFO[engine].label.toLowerCase()}. Your choice still stands elsewhere.
        </p>
      )}
    </div>
  );
}

/**
 * The renderer gave up.
 *
 * It says so, names the engine, and hands over the file — because the file is
 * the artefact and a browser that cannot draw it can still save it. The other
 * engine is one click away in the bar below, which is genuinely the fix about
 * half the time: they fail on different things.
 */
function StageFailure({ url, engine }: { url: string; engine: SplatRenderer }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <div className="flex max-w-[22rem] flex-col items-center gap-2 text-center">
        <p className="text-[13.5px] leading-relaxed text-milk">
          {RENDERER_INFO[engine].label} could not draw this capture.
        </p>
        <p className="fnote text-[10px] leading-relaxed text-mist">
          [ the file itself is fine and still on disk · try the other engine below, or take it with
          you ]
        </p>
        <a href={url} download className="pill-brass mt-1 px-3 py-1.5 text-[12.5px]">
          Download the .ply
        </a>
      </div>
    </div>
  );
}
