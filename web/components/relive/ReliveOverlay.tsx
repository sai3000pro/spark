"use client";

/**
 * The takeover: a pin on the map expands into its Gaussian splat.
 *
 * Turning to the moment's page in the journal: cream paper with real tooth,
 * the moment's pressed ink stamped through the tags, and the evidence — what
 * was seen, what was said, what Spark queued up to play — written beside the
 * 3D stage. The stage itself is the journal's one dark surface: a pine plate
 * under star grain, because the walk happened after sunset and the capture
 * keeps that light. Clicking an object row flies the camera to its anchor in
 * the splat; arriving from the find palette does the same via `anchor`.
 */
import { useEffect, useState } from "react";
import { SplatViewer } from "@/components/relive/SplatViewer";
import {
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
  /** Step to the previous (-1) or next (+1) moment without leaving the page. */
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
      className="papergrain fixed inset-0 z-40 flex flex-col overflow-hidden bg-paper text-ink"
      style={{ animation: "takeover 0.8s var(--ease-reveal) both" }}
      role="dialog"
      aria-modal="true"
      aria-label={`Moment ${index + 1}: ${moment.title}`}
    >
      {/* The moment's pressed ink, washed into the page corners. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(90% 70% at 18% 0%, ${ink.wash} 0%, transparent 55%), radial-gradient(70% 60% at 100% 100%, ${ink.wash} 0%, transparent 50%)`,
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
              className="rise-in text-[26px] leading-[1.02] text-ink sm:text-[34px]"
              style={{ "--i": 1 } as React.CSSProperties}
            >
              {moment.title}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="fnote text-[10.5px]" style={{ color: ink.deep }}>
                [ {clockTime(tripStartedAt, moment.tStart)} · {duration(moment.tEnd - moment.tStart)} ]
              </span>
              <span className="fnote text-[10.5px] text-ink-faint">[ {moment.place.label} ]</span>
              {moment.people.length > 0 && (
                <span className="fnote text-[10.5px] text-ink-faint">
                  [ with {moment.people.join(" and ")} ]
                </span>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Back to the map"
          className="pill-ghost shrink-0 px-4 py-2 text-[13px] text-ink"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Map
        </button>
      </header>

      {/* ── Stage + evidence ────────────────────────────────────────────── */}
      <div className="relative z-10 grid min-h-0 flex-1 grid-cols-1 gap-4 px-4 pb-3 sm:px-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div
          className="plate-pine starfield rise-in relative min-h-[300px] overflow-hidden rounded-[14px]"
          style={{ "--i": 1 } as React.CSSProperties}
        >
          <SplatViewer
            moment={moment}
            ink={ink}
            focusTrackId={focusTrackId}
            onSelectObject={setFocusTrackId}
          />
          {focused && (
            <div className="plate-vellum absolute bottom-3 left-3 flex items-center gap-2.5 px-3 py-2 text-ink">
              <LabelDot label={focused.label} size={8} />
              <span className="text-[13px] font-bold">{focused.label}</span>
              <span className="fnote text-[10px] text-ink-faint">
                {timecode(focused.firstSeenT)}–{timecode(focused.lastSeenT)}
              </span>
              {navTargets[focused.trackId] && (
                <span className="fnote text-[10px] text-moss">[ robot can drive here ]</span>
              )}
              <button
                type="button"
                onClick={() => setFocusTrackId(null)}
                className="tag ml-1 text-[11px] text-ink-faint transition-colors duration-300 ease-(--ease-signature) hover:text-ink"
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
          <p className="text-[13.5px] leading-relaxed text-ink">{moment.summary}</p>

          {/* Frames strip — the flat evidence behind the volume. One provenance
              note for the whole strip; a chip per 96px thumb swallows the image. */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {moment.keyframes.map((kf) => (
              <span
                key={kf.id}
                className="relative shrink-0 overflow-hidden rounded-[8px]"
                style={{ boxShadow: "var(--ring-ink), 0 2px 6px rgb(27 27 24 / 0.12)" }}
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
                          ? "bg-vellum shadow-[var(--ring-ink)]"
                          : canPlace
                            ? "hover:bg-ink/5"
                            : "opacity-45"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <LabelDot label={o.label} />
                        <span className="truncate text-[13px] font-medium text-ink">
                          {o.label}
                        </span>
                        {on && (
                          <span className="fnote text-[10px]" style={{ color: ink.deep }}>
                            [ in view ]
                          </span>
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
              {/* The lines land on the notebook's ruled feint — 28px leading so
                  the writing sits on the rules. */}
              <ol className="ruled mt-2">
                {moment.transcript.map((seg) => (
                  <li key={seg.id} className="flex gap-2.5 leading-[28px]">
                    <span className="fnote shrink-0 text-[10px] leading-[28px]" style={{ color: ink.deep }}>
                      {timecode(seg.t)}
                    </span>
                    <p className="min-w-0 text-[12.5px] text-ink-soft">
                      <span className="fnote mr-1.5 text-[10px] text-ink-faint">{seg.speaker}</span>
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
              <div className="plate-vellum relative mt-2.5">
                {/* A strip of tape holds the ticket onto the page. */}
                <span className="tape -top-2 left-6 -rotate-3" aria-hidden />
                <div className="relative flex items-center gap-3 px-3.5 py-3">
                  <PlayGlyph size={36} ink={ink.deep} />
                  <div className="min-w-0 flex-1">
                    <a
                      href={moment.music.spotifyUri}
                      title="Open in Spotify — mock URI until the playback SDK is wired up"
                      className="block truncate text-[14px] font-semibold leading-tight text-ink hover:underline"
                    >
                      {moment.music.trackName}
                    </a>
                    <span className="tag text-[11px] text-ink-soft">
                      {moment.music.artist} · {moment.vibe.mood}
                    </span>
                  </div>
                </div>
                <p className="relative border-t border-ink/10 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-ink-soft">
                  <span className="fnote text-[10px] text-ink-faint">[ picked because ] </span>
                  {moment.music.chosenBecause}
                </p>
              </div>
            ) : (
              <p className="mt-2 rounded-[10px] border border-dashed border-ink/25 px-3.5 py-3 text-[12px] leading-relaxed text-ink-soft">
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
        <span className="fnote text-[10.5px] text-ink-faint">
          [ {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")} ]
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
        style={{ background: ink.deep }}
        aria-hidden
      />
      <span className="fnote text-[10.5px] text-ink-soft">{children}</span>
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
      className="pill-ghost px-4 py-2 text-[13px] text-ink disabled:opacity-30"
    >
      {dir === -1 && <span aria-hidden>←</span>}
      {dir === -1 ? "Earlier" : "Later"}
      {dir === 1 && <span aria-hidden>→</span>}
    </button>
  );
}
