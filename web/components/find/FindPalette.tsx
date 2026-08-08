"use client";

/**
 * "Where's my water bottle?" — the find palette.
 *
 * Searches the object index the robot built during the walk. The button on
 * every result is the actual demo: "Step into the splat" opens the moment's
 * takeover with the camera flying to that object's anchor. Find → 3D → the
 * thing, in two clicks.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { InkTag, KeyframeImg, LabelDot, Meter, inkButtonClass } from "@/components/system/ui";
import { beforeEnd, intoTrip, timecode } from "@/lib/format";
import { searchObjects, suggestedQueries } from "@/lib/objectIndex";
import { MOMENT_INKS, TEAL } from "@/lib/theme";
import type { ObjectIndexEntry, ObjectSearchResult } from "@/lib/types";

interface Props {
  entries: ObjectIndexEntry[];
  durationSec: number;
  onClose: () => void;
  onStepInside: (momentId: string, trackId: string) => void;
}

export function FindPalette({ entries, durationSec, onClose, onStepInside }: Props) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchObjects(query, entries), [query, entries]);
  const suggestions = useMemo(() => suggestedQueries(entries), [entries]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-navy-deep/50 px-4 pt-[9vh] backdrop-blur-[3px]"
      role="dialog"
      aria-modal="true"
      aria-label="Where is my object"
      onClick={onClose}
    >
      <div
        className="riso-card grained relative w-full max-w-2xl overflow-hidden rounded-[22px] shadow-2xl shadow-navy-deep/40"
        style={{ animation: "pop-in 0.3s var(--ease-pop) both" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b-[1.5px] border-ink/30 px-4 py-3.5">
          <svg width="18" height="18" viewBox="0 0 14 14" aria-hidden className="shrink-0 text-ink">
            <circle cx="6" cy="6" r="4.1" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M9.4 9.4 12.8 12.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Where's my water bottle?"
            className="w-full bg-transparent font-display text-[17px] font-bold text-ink outline-none placeholder:text-ink-faint"
            aria-label="Ask where an object is"
          />
          <kbd className="tag hidden shrink-0 rounded-[6px] border-[1.5px] border-ink/30 px-1.5 py-0.5 text-[9px] text-ink-soft sm:inline">
            esc
          </kbd>
        </div>

        <div className="scrollbar-thin max-h-[60vh] overflow-y-auto">
          {!query.trim() ? (
            <div className="p-4">
              <InkTag className="text-[10px] text-ink-faint">try asking</InkTag>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {suggestions.map((s, i) => {
                  const ink = MOMENT_INKS[i % MOMENT_INKS.length];
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setQuery(s)}
                      className="rounded-full border-[1.5px] px-3 py-1.5 text-[12.5px] font-bold transition-transform duration-200 ease-(--ease-pop) hover:scale-[1.05] active:scale-95"
                      style={{ borderColor: ink.base, color: ink.deep, background: `${ink.soft}66` }}
                    >
                      “{s}”
                    </button>
                  );
                })}
              </div>
              <p className="mt-4 border-t-[1.5px] border-dashed border-ink/25 pt-3 text-[11.5px] leading-relaxed text-ink-soft">
                Searching {entries.length} distinct objects the robot tracked today. Matching is
                local and instant — everyday words map onto the detector&apos;s COCO classes, so
                &ldquo;nalgene&rdquo; finds a <span className="font-mono">bottle</span>.
              </p>
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-9 text-center">
              <p className="font-display text-[15px] font-bold text-ink">
                Nothing matching &ldquo;{query}&rdquo; was tracked today.
              </p>
              <p className="mt-1.5 text-[11.5px] text-ink-soft">
                The robot can only find things its detector had a class for.
              </p>
            </div>
          ) : (
            <ul>
              {results.map((r) => (
                <ResultRow
                  key={r.entry.label}
                  result={r}
                  durationSec={durationSec}
                  onStepInside={onStepInside}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultRow({
  result,
  durationSec,
  onStepInside,
}: {
  result: ObjectSearchResult;
  durationSec: number;
  onStepInside: (momentId: string, trackId: string) => void;
}) {
  const { entry, matchedOn } = result;
  const best = entry.best;
  const [showNav, setShowNav] = useState(false);

  return (
    <li className="border-b-[1.5px] border-ink/15 last:border-b-0">
      <div className="flex gap-3.5 p-3.5">
        <div className="relative h-[72px] w-[104px] shrink-0 overflow-hidden rounded-[12px] border-[1.5px] border-ink/40">
          <KeyframeImg
            keyframe={best.thumbnail}
            alt={`${entry.label} seen at ${best.placeLabel}`}
            className="h-full w-full object-cover"
            width={240}
            height={160}
          />
          {/* The actual detection box, drawn where the model put it. */}
          <span
            className="pointer-events-none absolute rounded-[3px] border-2 border-cream-bright mix-blend-difference"
            style={{
              left: `${best.bestBbox[0] * 100}%`,
              top: `${best.bestBbox[1] * 100}%`,
              width: `${best.bestBbox[2] * 100}%`,
              height: `${best.bestBbox[3] * 100}%`,
            }}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="flex items-center gap-1.5 font-display text-[15px] font-bold text-ink">
              <LabelDot label={entry.label} size={8} />
              {entry.label}
            </span>
            {matchedOn !== "exact" && (
              <InkTag className="text-[9px] text-ink-faint" title={`matched on ${matchedOn}`}>
                ≈ {matchedOn}
              </InkTag>
            )}
            <Meter value={best.confidence} />
          </div>

          <p className="mt-1 text-[12.5px] leading-snug text-ink-soft">
            Last seen <span className="font-bold text-ink">{intoTrip(entry.lastSeenT)}</span> at{" "}
            <span className="font-bold text-ink">{best.placeLabel}</span> —{" "}
            {beforeEnd(entry.lastSeenT, durationSec)}.
          </p>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onStepInside(best.momentId, best.trackId)}
              className={inkButtonClass("px-4 py-1.5 text-[12.5px]")}
            >
              Step into the splat →
            </button>
            {entry.navTarget && (
              <button
                type="button"
                onClick={() => setShowNav((v) => !v)}
                className="rounded-full border-[1.5px] px-3.5 py-1.5 text-[12px] font-bold transition-transform duration-200 ease-(--ease-pop) hover:scale-[1.04] active:scale-95"
                style={{ borderColor: TEAL.base, color: TEAL.deep }}
              >
                Send robot here
              </button>
            )}
          </div>

          {showNav && entry.navTarget && (
            <div
              className="mt-2 rounded-[10px] border-[1.5px] px-3 py-2"
              style={{ borderColor: TEAL.base, background: `${TEAL.soft}55` }}
            >
              <p className="text-[11.5px] font-bold" style={{ color: TEAL.deep }}>
                Nav goal queued — the robot would drive back to this spot.
              </p>
              <p className="tag tnum mt-0.5 text-[9px] text-ink-soft">
                target ({entry.navTarget.pos[0].toFixed(1)}, {entry.navTarget.pos[1].toFixed(1)}) m ·
                heading {entry.navTarget.heading.toFixed(0)}° · rejoins at{" "}
                {timecode(entry.navTarget.approachFromT)}
              </p>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
