"use client";

/**
 * The takeover: a light-marker on the map expands into its Gaussian splat.
 *
 * Stepping into the pool of the moment's light: a near-black night ground
 * under star grain, the moment's own ink glowing at the edges, and the
 * evidence — what was seen, what was said, what Spark queued up to play —
 * riding beside the 3D stage on hairline-ringed plates. Clicking an object
 * row flies the camera to its anchor in the splat; arriving from the find
 * palette does the same via `anchor`.
 */
import { useEffect, useState } from "react";
import { SplatViewer } from "@/components/relive/SplatViewer";
import {
  InkTag,
  KeyframeImg,
  LabelDot,
  Meter,
  NumberChip,
  PlayGlyph,
  SynthNote,
} from "@/components/system/ui";
import { clockTime, duration, timecode } from "@/lib/format";
import { inkForMoment, type MomentInk } from "@/lib/theme";
import type { Moment, Vec2 } from "@/lib/types";

interface Props {
  moment: Moment;
  index: number;
  total: number;
  tripStartedAt: string;
  navTargets: Record<string, { pos: Vec2; heading: number }>;
  /** Track to focus on open — the find-palette → 3D handoff. */
  anchor: string | null;
  onClose: () => void;
  /** Step to the previous (-1) or next (+1) moment without leaving the night. */
  onStep: (dir: -1 | 1) => void;
}

export function ReliveOverlay({
  moment,
  index,
  total,
  tripStartedAt,
  navTargets,
  anchor,
  onClose,
  onStep,
}: Props) {
  const ink = inkForMoment(index);
  // The anchor (find → 3D handoff) is the initial focus; a click overrides it.
  // Keying the override by (moment, anchor) means a fresh moment or a fresh
  // anchor re-seeds cleanly during render, without an effect.
  const seedKey = `${moment.id}:${anchor ?? ""}`;
  const [override, setOverride] = useState<{ key: string; trackId: string | null } | null>(null);
  const focusTrackId = override?.key === seedKey ? override.trackId : anchor;
  const setFocusTrackId = (trackId: string | null) => setOverride({ key: seedKey, trackId });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onStep(-1);
      if (e.key === "ArrowRight") onStep(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onStep]);

  const focused = moment.objects.find((o) => o.trackId === focusTrackId) ?? null;

  return (
    <div
      className="starfield fixed inset-0 z-40 flex flex-col overflow-hidden bg-night"
      style={{ animation: "takeover 0.8s var(--ease-reveal) both" }}
      role="dialog"
      aria-modal="true"
      aria-label={`Moment ${index + 1}: ${moment.title}`}
    >
      {/* The pool of this moment's light — its ink washed over the night. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(90% 70% at 18% 0%, ${ink.glow} 0%, transparent 55%), radial-gradient(70% 60% at 100% 100%, ${ink.glow} 0%, transparent 50%)`,
        }}
      />

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="relative z-10 flex flex-wrap items-start justify-between gap-3 px-4 pb-3 pt-4 sm:px-6">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="rise-in">
            <NumberChip n={index + 1} ink={ink} size="lg" />
          </span>
          <div className="min-w-0">
            <h2
              className="rise-in text-[26px] leading-[1.02] text-starlight sm:text-[34px]"
              style={{ "--i": 1 } as React.CSSProperties}
            >
              {moment.title}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <InkTag className="text-[12px]" color={ink.base}>
                {clockTime(tripStartedAt, moment.tStart)} · {duration(moment.tEnd - moment.tStart)}
              </InkTag>
              <InkTag className="text-[12px] text-moth">{moment.place.label}</InkTag>
              {moment.people.length > 0 && (
                <InkTag className="text-[12px] text-moth">
                  with {moment.people.join(" and ")}
                </InkTag>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Back to the map"
          className="btn-ghost shrink-0 px-4 py-2 text-[13px]"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Map
        </button>
      </header>

      {/* ── Stage + evidence ────────────────────────────────────────────── */}
      <div className="relative z-10 grid min-h-0 flex-1 grid-cols-1 gap-3 px-4 pb-3 sm:px-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div
          className="rise-in relative min-h-[300px] overflow-hidden rounded-[10px]"
          style={{ "--i": 1, boxShadow: "var(--ring)" } as React.CSSProperties}
        >
          <SplatViewer
            moment={moment}
            ink={ink}
            focusTrackId={focusTrackId}
            onSelectObject={setFocusTrackId}
          />
          {focused && (
            <div className="plate absolute bottom-3 left-3 flex items-center gap-2.5 px-3 py-2">
              <LabelDot label={focused.label} size={8} />
              <span className="text-[13px] font-bold text-starlight">{focused.label}</span>
              <span className="tag text-[11px] text-moth">
                {timecode(focused.firstSeenT)}–{timecode(focused.lastSeenT)}
              </span>
              {navTargets[focused.trackId] && (
                <span className="tag text-[11px] text-aurora">robot can drive here</span>
              )}
              <button
                type="button"
                onClick={() => setFocusTrackId(null)}
                className="tag ml-1 text-[11px] text-faint transition-colors duration-300 ease-(--ease-signature) hover:text-starlight"
              >
                clear
              </button>
            </div>
          )}
        </div>

        <aside
          className="rise-in scrollbar-thin min-h-0 space-y-4 overflow-y-auto pr-1"
          style={{ "--i": 2 } as React.CSSProperties}
        >
          <p className="text-[13.5px] leading-relaxed text-starlight">{moment.summary}</p>

          {/* Frames strip — the flat evidence behind the volume. One provenance
              note for the whole strip; a chip per 96px thumb swallows the image. */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {moment.keyframes.map((kf) => (
              <span
                key={kf.id}
                className="relative shrink-0 overflow-hidden rounded-[8px]"
                style={{ boxShadow: "var(--ring)" }}
              >
                <KeyframeImg keyframe={kf} alt={`Frame at ${timecode(kf.t)}`} className="h-16 w-24 object-cover" width={192} height={128} />
              </span>
            ))}
          </div>
          {moment.keyframes.some((kf) => !kf.url) && <SynthNote />}

          <section>
            <SectionTag ink={ink}>seen here · {moment.objects.length}</SectionTag>
            <ul className="mt-2 space-y-1">
              {moment.objects.map((o) => {
                const canPlace = !!o.worldPos;
                const on = focusTrackId === o.trackId;
                return (
                  <li key={o.trackId}>
                    <button
                      type="button"
                      disabled={!canPlace}
                      onClick={() => setFocusTrackId(on ? null : o.trackId)}
                      title={canPlace ? `Fly to the ${o.label}` : "No depth for this track — can't be placed in 3D"}
                      className={`flex w-full items-center justify-between gap-2 rounded-[8px] px-2.5 py-1.5 text-left transition-[background-color,box-shadow] duration-300 ease-(--ease-signature) ${
                        on
                          ? "bg-haze shadow-[var(--ring)]"
                          : canPlace
                            ? "hover:bg-haze/60"
                            : "opacity-45"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <LabelDot label={o.label} />
                        <span className="truncate text-[13px] font-medium text-starlight">
                          {o.label}
                        </span>
                        {on && (
                          <InkTag className="text-[11px]" color={ink.base}>
                            in view
                          </InkTag>
                        )}
                      </span>
                      <Meter value={o.confidence} ink={ink} width={38} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {moment.transcript.length > 0 && (
            <section>
              <SectionTag ink={ink}>said here · {moment.transcript.length} lines</SectionTag>
              <ol className="mt-2 space-y-1.5">
                {moment.transcript.map((seg) => (
                  <li key={seg.id} className="flex gap-2.5">
                    <span className="tag tnum shrink-0 pt-px text-[11px]" style={{ color: ink.base }}>
                      {timecode(seg.t)}
                    </span>
                    <p className="min-w-0 text-[12.5px] leading-relaxed text-moth">
                      <span className="tag mr-1.5 text-[11px] text-faint">{seg.speaker}</span>
                      {seg.text}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section>
            <SectionTag ink={ink}>soundtrack</SectionTag>
            {moment.music ? (
              <div className="plate relative mt-2 overflow-hidden">
                {/* The track glows in the moment's ink — atmosphere, not chrome. */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background: `radial-gradient(120% 130% at 0% 0%, ${ink.glow} 0%, transparent 70%)`,
                  }}
                />
                <div className="relative flex items-center gap-3 px-3.5 py-3">
                  <PlayGlyph size={36} ink={ink.base} />
                  <div className="min-w-0 flex-1">
                    <a
                      href={moment.music.spotifyUri}
                      title="Open in Spotify — mock URI until the playback SDK is wired up"
                      className="block truncate text-[14px] font-semibold leading-tight text-starlight hover:underline"
                    >
                      {moment.music.trackName}
                    </a>
                    <span className="tag text-[11px] text-moth">
                      {moment.music.artist} · {moment.vibe.mood}
                    </span>
                  </div>
                </div>
                <p className="relative border-t border-starlight/15 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-moth">
                  <span className="tag text-[11px] text-faint">Picked because: </span>
                  {moment.music.chosenBecause}
                </p>
              </div>
            ) : (
              <p className="mt-2 rounded-[10px] border border-dashed border-starlight/25 px-3.5 py-3 text-[12px] leading-relaxed text-moth">
                No track — energy was low and the window short, so the picker stayed quiet rather
                than scoring a two-minute stop for fries.
              </p>
            )}
          </section>
        </aside>
      </div>

      {/* ── Footer transport ────────────────────────────────────────────── */}
      <footer className="relative z-10 flex items-center justify-between gap-3 px-4 pb-4 pt-1 sm:px-6">
        <StepButton dir={-1} disabled={index === 0} onStep={onStep} />
        <span className="tag tnum text-[12px] text-moth">
          {index + 1} of {total}
        </span>
        <StepButton dir={1} disabled={index === total - 1} onStep={onStep} />
      </footer>
    </div>
  );
}

function SectionTag({ children, ink }: { children: React.ReactNode; ink: MomentInk }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="h-2 w-2 rounded-full"
        style={{ background: ink.base }}
        aria-hidden
      />
      <span className="tag text-[12px] font-semibold text-moth">{children}</span>
    </div>
  );
}

function StepButton({
  dir,
  disabled,
  onStep,
}: {
  dir: -1 | 1;
  disabled: boolean;
  onStep: (dir: -1 | 1) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onStep(dir)}
      aria-label={dir === -1 ? "Previous moment" : "Next moment"}
      className="btn-ghost px-4 py-2 text-[13px] disabled:opacity-30"
    >
      {dir === -1 && <span aria-hidden>←</span>}
      {dir === -1 ? "Earlier" : "Later"}
      {dir === 1 && <span aria-hidden>→</span>}
    </button>
  );
}
