"use client";

/**
 * Answers "where is my water bottle?" from the object index.
 *
 * The handoff at the bottom of each result is the actual demo: "Show me in 3D"
 * deep-links to the moment with `?anchor=<trackId>`, and the moment page focuses
 * that anchor inside the splat on mount. Search → 3D → the thing, in two clicks.
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Keyframe } from "@/components/Keyframe";
import { Chip, ConfidenceBar, LabelDot } from "@/components/ui";
import { beforeEnd, intoTrip, timecode } from "@/lib/format";
import { searchObjects, suggestedQueries } from "@/lib/objectIndex";
import type { ObjectIndexEntry, ObjectSearchResult } from "@/lib/types";

interface Props {
  entries: ObjectIndexEntry[];
  durationSec: number;
  tripId: string;
  onClose: () => void;
}

export function ObjectSearch({ entries, durationSec, tripId, onClose }: Props) {
  const [query, setQuery] = useState("");
  // The cursor is stored with the query it belongs to, so a new query resets it to
  // the top during render. An effect calling setSelected(0) would work but costs a
  // second render pass on every keystroke.
  const [cursor, setCursor] = useState({ query: "", index: 0 });
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchObjects(query, entries), [query, entries]);
  const suggestions = useMemo(() => suggestedQueries(entries), [entries]);

  const selected = cursor.query === query ? cursor.index : 0;
  const moveCursor = (next: (i: number) => number) =>
    setCursor({ query, index: next(selected) });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveCursor((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveCursor((i) => Math.max(0, i - 1));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink-950/75 px-4 pt-[8vh] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Where is my object"
      onClick={onClose}
    >
      <div
        className="surface-raised w-full max-w-2xl overflow-hidden rounded-xl shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-ink-700 px-4 py-3">
          <svg width="16" height="16" viewBox="0 0 14 14" aria-hidden className="shrink-0 text-fog-400">
            <circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M9.2 9.2 12.5 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Where is my water bottle?"
            className="w-full bg-transparent text-[15px] text-fog-100 outline-none placeholder:text-fog-400"
            aria-label="Ask where an object is"
          />
          <kbd className="hidden shrink-0 rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 font-mono text-[10px] text-fog-400 sm:inline">
            esc
          </kbd>
        </div>

        <div className="scrollbar-thin max-h-[62vh] overflow-y-auto">
          {!query.trim() ? (
            <div className="p-4">
              <p className="mb-2.5 text-[11px] uppercase tracking-[0.14em] text-fog-400">Try asking</p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setQuery(s)}
                    className="rounded-full border border-ink-700 px-3 py-1.5 text-[12px] text-fog-300 transition-colors hover:border-machine-500/60 hover:text-machine-300"
                  >
                    {s}
                  </button>
                ))}
              </div>
              <p className="mt-4 border-t border-ink-800 pt-3 text-[11px] leading-relaxed text-fog-400">
                Searching {entries.length} distinct objects the robot tracked across the trip. Matching
                is local and instant — everyday words are mapped onto the detector&apos;s COCO
                classes, so &ldquo;nalgene&rdquo; finds a <span className="font-mono">bottle</span>.
              </p>
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-[13px] text-fog-300">
                Nothing matching &ldquo;{query}&rdquo; was tracked on this trip.
              </p>
              <p className="mt-1.5 text-[11px] text-fog-400">
                The robot can only find things its detector had a class for.
              </p>
            </div>
          ) : (
            <ul>
              {results.map((r, i) => (
                <ResultRow
                  key={r.entry.label}
                  result={r}
                  tripId={tripId}
                  durationSec={durationSec}
                  active={i === selected}
                  onHover={() => moveCursor(() => i)}
                  onNavigate={onClose}
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
  tripId,
  durationSec,
  active,
  onHover,
  onNavigate,
}: {
  result: ObjectSearchResult;
  tripId: string;
  durationSec: number;
  active: boolean;
  onHover: () => void;
  onNavigate: () => void;
}) {
  const { entry, matchedOn } = result;
  const best = entry.best;
  const [showNav, setShowNav] = useState(false);

  return (
    <li
      onMouseEnter={onHover}
      className={`border-b border-ink-800 last:border-b-0 ${active ? "bg-ink-800/60" : ""}`}
    >
      <div className="flex gap-3 p-3">
        <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-ink-850">
          <Keyframe
            keyframe={best.thumbnail}
            alt={`${entry.label} seen at ${best.placeLabel}`}
            className="h-full w-full object-cover"
            width={240}
            height={160}
          />
          {/* The actual detection box, drawn where the model put it. */}
          <span
            className="pointer-events-none absolute border-[1.5px] border-machine-400"
            style={{
              left: `${best.bestBbox[0] * 100}%`,
              top: `${best.bestBbox[1] * 100}%`,
              width: `${best.bestBbox[2] * 100}%`,
              height: `${best.bestBbox[3] * 100}%`,
            }}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="flex items-center gap-1.5 text-[14px] font-semibold text-fog-100">
              <LabelDot label={entry.label} size={7} />
              {entry.label}
            </span>
            {matchedOn !== "exact" && (
              <Chip tone="machine" title={`matched on ${matchedOn}`}>
                {matchedOn}
              </Chip>
            )}
            <ConfidenceBar value={best.confidence} />
          </div>

          <p className="mt-1 text-[12px] leading-snug text-fog-200">
            Last seen <span className="text-fog-100">{intoTrip(entry.lastSeenT)}</span> at{" "}
            <span className="text-fog-100">{best.placeLabel}</span> —{" "}
            {beforeEnd(entry.lastSeenT, durationSec)}.
          </p>
          <p className="mt-0.5 text-[11px] text-fog-400">
            {entry.sightings.length === 1
              ? "Seen once"
              : `Seen in ${entry.sightings.length} moments`}
            {" · "}
            {best.detectionCount} frames
            {" · "}
            <span className="tnum font-mono">{timecode(best.lastSeenT)}</span>
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Link
              href={`/trip/${tripId}/moment/${best.momentId}?anchor=${best.trackId}`}
              onClick={onNavigate}
              className="rounded-md border border-memory-500/50 bg-memory-500/10 px-2.5 py-1 text-[11px] font-medium text-memory-300 transition-colors hover:bg-memory-500/20"
            >
              Show me in 3D →
            </Link>
            {entry.navTarget && (
              <button
                type="button"
                onClick={() => setShowNav((v) => !v)}
                className="rounded-md border border-signal-500/45 bg-signal-500/10 px-2.5 py-1 text-[11px] font-medium text-signal-400 transition-colors hover:bg-signal-500/20"
              >
                Send robot here
              </button>
            )}
          </div>

          {showNav && entry.navTarget && (
            <div className="mt-2 rounded-md border border-signal-500/30 bg-signal-500/5 p-2">
              <p className="text-[11px] text-signal-400">
                Nav goal queued — the robot would drive back to this spot.
              </p>
              <p className="tnum mt-1 font-mono text-[10px] text-fog-400">
                target ({entry.navTarget.pos[0].toFixed(1)}, {entry.navTarget.pos[1].toFixed(1)}) m ·
                heading {(entry.navTarget.heading * (180 / Math.PI)).toFixed(0)}° · rejoins the route
                at {timecode(entry.navTarget.approachFromT)}
              </p>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
