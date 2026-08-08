"use client";

/**
 * The takeover: a pin on the map expands into its Gaussian splat.
 *
 * Full-screen night plate in the moment's own drum ink, with the 3D
 * reconstruction filling the stage and the moment's evidence — what was seen,
 * what was said, what Spark queued up to play — riding beside it. Clicking an
 * object row flies the camera to its anchor in the splat; arriving from the
 * find palette does the same via `anchor`.
 */
import { useEffect, useState } from "react";
import { SplatViewer } from "@/components/relive/SplatViewer";
import { InkTag, KeyframeImg, LabelDot, Meter, NumberChip, SynthNote } from "@/components/system/ui";
import { clockTime, duration, timecode } from "@/lib/format";
import { CREAM_BRIGHT, inkForMoment } from "@/lib/theme";
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
      className="grained grained-heavy fixed inset-0 z-40 flex flex-col overflow-hidden bg-navy-deep"
      style={{ animation: "takeover 0.35s var(--ease-pop) both" }}
      role="dialog"
      aria-modal="true"
      aria-label={`Moment ${index + 1}: ${moment.title}`}
    >
      {/* A wash of the moment's own ink over the night. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(90% 70% at 18% 0%, ${ink.base}33 0%, transparent 55%), radial-gradient(70% 60% at 100% 100%, ${ink.base}22 0%, transparent 50%)`,
        }}
      />

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="relative z-10 flex flex-wrap items-start justify-between gap-3 px-4 pb-3 pt-4 sm:px-6">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="pop-in">
            <NumberChip n={index + 1} ink={ink} size="lg" />
          </span>
          <div className="min-w-0">
            <h2 className="pop-in font-display text-[26px] font-extrabold leading-[1.02] tracking-tight text-cream-bright sm:text-[34px]" style={{ "--i": 1 } as React.CSSProperties}>
              {moment.title}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <InkTag className="text-[10px]" color={ink.base}>
                {clockTime(tripStartedAt, moment.tStart)} · {duration(moment.tEnd - moment.tStart)}
              </InkTag>
              <InkTag className="text-[10px] text-cream-bright/60">{moment.place.label}</InkTag>
              {moment.people.length > 0 && (
                <InkTag className="text-[10px] text-cream-bright/60">
                  with {moment.people.join(" + ")}
                </InkTag>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Back to the map"
          className="group flex shrink-0 items-center gap-2 rounded-full border-[1.5px] border-cream-bright/40 px-4 py-2 text-[13px] font-bold text-cream-bright transition-all duration-200 ease-(--ease-pop) hover:border-cream-bright hover:scale-[1.04] active:scale-95"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Map
        </button>
      </header>

      {/* ── Stage + evidence ────────────────────────────────────────────── */}
      <div className="relative z-10 grid min-h-0 flex-1 grid-cols-1 gap-3 px-4 pb-3 sm:px-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="relative min-h-[300px] overflow-hidden rounded-[20px] border-[1.5px] border-cream-bright/25 rise-in" style={{ "--i": 1 } as React.CSSProperties}>
          <SplatViewer
            moment={moment}
            ink={ink}
            focusTrackId={focusTrackId}
            onSelectObject={setFocusTrackId}
          />
          {focused && (
            <div className="absolute bottom-3 left-3 flex items-center gap-2.5 rounded-[12px] border-[1.5px] border-ink/40 bg-cream-bright/95 px-3 py-2">
              <LabelDot label={focused.label} size={8} />
              <span className="text-[13px] font-bold text-ink">{focused.label}</span>
              <span className="tag text-[9px] text-ink-soft">
                {timecode(focused.firstSeenT)}–{timecode(focused.lastSeenT)}
              </span>
              {navTargets[focused.trackId] && (
                <span className="tag text-[9px]" style={{ color: TEAL_DEEP }}>
                  robot can drive here
                </span>
              )}
              <button
                type="button"
                onClick={() => setFocusTrackId(null)}
                className="tag ml-1 text-[9px] text-ink-faint hover:text-ink"
              >
                clear
              </button>
            </div>
          )}
        </div>

        <aside className="scrollbar-thin min-h-0 space-y-4 overflow-y-auto pr-1 rise-in" style={{ "--i": 2 } as React.CSSProperties}>
          <p className="text-[13.5px] leading-relaxed text-cream-bright/85">{moment.summary}</p>

          {/* Frames strip — the flat evidence behind the volume. */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {moment.keyframes.map((kf) => (
              <span key={kf.id} className="relative shrink-0 overflow-hidden rounded-[10px] border-[1.5px] border-cream-bright/25">
                <KeyframeImg keyframe={kf} alt={`Frame at ${timecode(kf.t)}`} className="h-16 w-24 object-cover" width={192} height={128} />
                {!kf.url && <SynthNote className="absolute bottom-1 left-1 scale-90" />}
              </span>
            ))}
          </div>

          <section>
            <SectionTag ink={ink.base}>seen here · {moment.objects.length}</SectionTag>
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
                      className={`flex w-full items-center justify-between gap-2 rounded-[10px] border-[1.5px] px-2.5 py-1.5 text-left transition-all duration-200 ease-(--ease-pop) ${
                        on
                          ? "border-cream-bright/70 bg-cream-bright/10"
                          : canPlace
                            ? "border-transparent hover:border-cream-bright/30"
                            : "border-transparent opacity-45"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <LabelDot label={o.label} />
                        <span className="truncate text-[13px] font-medium text-cream-bright">
                          {o.label}
                        </span>
                        {on && (
                          <InkTag className="text-[8.5px]" color={ink.base}>
                            in view
                          </InkTag>
                        )}
                      </span>
                      <Meter value={o.confidence} width={38} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {moment.transcript.length > 0 && (
            <section>
              <SectionTag ink={ink.base}>said here · {moment.transcript.length} lines</SectionTag>
              <ol className="mt-2 space-y-1.5">
                {moment.transcript.map((seg) => (
                  <li key={seg.id} className="flex gap-2.5">
                    <span className="tag tnum shrink-0 pt-px text-[9px]" style={{ color: ink.base }}>
                      {timecode(seg.t)}
                    </span>
                    <p className="min-w-0 text-[12.5px] leading-relaxed text-cream-bright/80">
                      <span className="tag mr-1.5 text-[9px] text-cream-bright/55">{seg.speaker}</span>
                      {seg.text}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section>
            <SectionTag ink={ink.base}>soundtrack</SectionTag>
            {moment.music ? (
              <div className="grained relative mt-2 overflow-hidden rounded-[14px] border-[1.5px] border-ink/50" style={{ background: ink.base }}>
                <div className="flex items-center gap-3 px-3.5 py-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-navy-deep/80">
                    <svg width="14" height="14" viewBox="0 0 20 20" fill={CREAM_BRIGHT} aria-hidden>
                      <path d="M5 3.5l13 6.5-13 6.5V3.5z" />
                    </svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <a
                      href={moment.music.spotifyUri}
                      title="Open in Spotify — mock URI until the playback SDK is wired up"
                      className="block truncate font-display text-[15px] font-bold leading-tight text-cream-bright hover:underline"
                    >
                      {moment.music.trackName}
                    </a>
                    <span className="tag text-[9.5px] text-cream-bright/75">
                      {moment.music.artist} · {moment.vibe.mood}
                    </span>
                  </div>
                </div>
                <p className="border-t-[1.5px] border-cream-bright/25 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-cream-bright/90">
                  <span className="tag text-[8.5px]">picked because — </span>
                  {moment.music.chosenBecause}
                </p>
              </div>
            ) : (
              <p className="mt-2 rounded-[14px] border-[1.5px] border-dashed border-cream-bright/30 px-3.5 py-3 text-[12px] leading-relaxed text-cream-bright/65">
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
        <span className="tag tnum text-[11px] text-cream-bright/60">
          {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
        </span>
        <StepButton dir={1} disabled={index === total - 1} onStep={onStep} />
      </footer>
    </div>
  );
}

const TEAL_DEEP = "#0f6b66";

function SectionTag({ children, ink }: { children: React.ReactNode; ink: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: ink }} aria-hidden />
      <span className="tag text-[10px] text-cream-bright/75">{children}</span>
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
      className="flex items-center gap-2 rounded-full border-[1.5px] border-cream-bright/40 px-4 py-2 text-[13px] font-bold text-cream-bright transition-all duration-200 ease-(--ease-pop) hover:border-cream-bright hover:scale-[1.04] active:scale-95 disabled:opacity-30 disabled:hover:scale-100"
    >
      {dir === -1 && <span aria-hidden>←</span>}
      {dir === -1 ? "Earlier" : "Later"}
      {dir === 1 && <span aria-hidden>→</span>}
    </button>
  );
}
