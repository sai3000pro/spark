"use client";

/**
 * "Where's my water bottle?" — the find palette.
 *
 * Searches the object index the robot built during the walk. The button on
 * every result is the actual demo: "Step into the splat" opens the moment's
 * takeover with the camera flying to that object's anchor. Find → 3D → the
 * thing, in two clicks.
 *
 * Visually it is the journal held up to the light: one vellum slip over a
 * deep pine wash, results speaking the typewriter [ TAG ] voice, and the
 * active row's label picked out in reverse video (`.selected-block`).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { InkTag, KeyframeImg, LabelDot, Meter, inkButtonClass } from "@/components/system/ui";
import { beforeEnd, intoTrip, timecode } from "@/lib/format";
import { searchObjects, suggestedQueries } from "@/lib/objectIndex";
import type { ObjectIndexEntry, ObjectSearchResult } from "@/lib/types";

interface Props {
  entries: ObjectIndexEntry[];
  durationSec: number;
  onClose: () => void;
  onStepInside: (momentId: string, trackId: string) => void;
}

export function FindPalette({ entries, durationSec, onClose, onStepInside }: Props) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  // New query → the spotlight returns to the top result. Reset-during-render
  // (React's sanctioned derived-state pattern) instead of an effect, so there
  // is no flash of a stale selection on the new result list.
  const [lastQuery, setLastQuery] = useState(query);
  if (lastQuery !== query) {
    setLastQuery(query);
    setActiveIdx(0);
  }
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

  // Arrow/Enter live on the input so a focused row button never double-fires.
  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!results.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const r = results[activeIdx];
      if (r) onStepInside(r.entry.best.momentId, r.entry.best.trackId);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-pine/55 px-4 pt-[9vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Where is my object"
      onClick={onClose}
    >
      <div
        className="plate-vellum papergrain relative w-full max-w-2xl overflow-hidden text-ink"
        style={{ animation: "takeover 0.3s var(--ease-signature) both" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-ink/10 px-4 py-3.5">
          <svg width="18" height="18" viewBox="0 0 14 14" aria-hidden className="shrink-0 text-clay">
            <circle cx="6" cy="6" r="4.1" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M9.4 9.4 12.8 12.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Where's my water bottle?"
            className="w-full bg-transparent text-[17px] font-semibold text-ink outline-none placeholder:text-ink-faint"
            aria-label="Ask where an object is"
          />
          <kbd
            className="fnote hidden shrink-0 rounded-[4px] px-1.5 py-0.5 text-[10px] text-ink-faint sm:inline"
            style={{ boxShadow: "var(--ring-ink)" }}
          >
            esc
          </kbd>
        </div>

        <div className="scrollbar-thin max-h-[60vh] overflow-y-auto">
          {!query.trim() ? (
            <div className="p-4">
              <span className="fnote text-[10.5px] text-ink-faint">[ try asking ]</span>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setQuery(s)}
                    className="rounded-[6px] bg-paper px-3 py-1.5 text-[12.5px] font-medium text-ink transition-colors duration-300 ease-(--ease-signature) hover:bg-brass/30"
                    style={{ boxShadow: "var(--ring-ink)" }}
                  >
                    “{s}”
                  </button>
                ))}
              </div>
              <p className="mt-4 border-t border-dashed border-ink/15 pt-3 text-[12px] leading-relaxed text-ink-soft">
                Searching {entries.length} distinct objects the robot tracked today. Matching is
                local and instant — everyday words map onto the detector&apos;s COCO classes, so
                &ldquo;nalgene&rdquo; finds a bottle.
              </p>
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-9 text-center">
              <p className="text-[15px] font-bold text-ink">
                Nothing matching &ldquo;{query}&rdquo; was tracked today.
              </p>
              <p className="mt-1.5 text-[11.5px] text-ink-soft">
                The robot can only find things its detector had a class for.
              </p>
            </div>
          ) : (
            <ul>
              {results.map((r, i) => (
                <ResultRow
                  key={r.entry.label}
                  result={r}
                  durationSec={durationSec}
                  active={i === activeIdx}
                  onActivate={() => setActiveIdx(i)}
                  onStepInside={onStepInside}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-ink/10 px-4 py-2">
          <span className="fnote text-[10px] text-ink-faint">↑↓ move</span>
          <span className="fnote text-[10px] text-ink-faint">↵ step inside</span>
          <span className="fnote tnum ml-auto text-[10px] text-ink-faint">
            [ {entries.length} objects indexed ]
          </span>
        </div>
      </div>
    </div>
  );
}

function ResultRow({
  result,
  durationSec,
  active,
  onActivate,
  onStepInside,
}: {
  result: ObjectSearchResult;
  durationSec: number;
  active: boolean;
  onActivate: () => void;
  onStepInside: (momentId: string, trackId: string) => void;
}) {
  const { entry, matchedOn } = result;
  const best = entry.best;
  const [showNav, setShowNav] = useState(false);
  const ref = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <li
      ref={ref}
      onMouseEnter={onActivate}
      className={`border-b border-ink/10 last:border-b-0 ${active ? "bg-paper" : ""}`}
    >
      <div className="flex gap-3.5 p-3.5">
        <div
          className="relative h-[72px] w-[104px] shrink-0 overflow-hidden rounded-[8px]"
          style={{ boxShadow: "var(--ring-ink), 0 2px 6px rgb(27 27 24 / 0.12)" }}
        >
          <KeyframeImg
            keyframe={best.thumbnail}
            alt={`${entry.label} seen at ${best.placeLabel}`}
            className="h-full w-full object-cover"
            width={240}
            height={160}
          />
          {/* The actual detection box, drawn where the model put it. */}
          <span
            className="pointer-events-none absolute border-2 border-milk mix-blend-difference"
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
            <span
              className={`flex items-center gap-1.5 text-[15px] font-bold ${
                active ? "selected-block px-1.5 py-0.5" : "text-ink"
              }`}
            >
              <LabelDot label={entry.label} size={8} />
              {entry.label}
            </span>
            <span className="fnote chip tnum text-[9.5px]">
              {entry.sightings.length} sighting{entry.sightings.length === 1 ? "" : "s"}
            </span>
            {matchedOn !== "exact" && (
              <InkTag className="text-[11px] text-ink-faint" title={`matched on ${matchedOn}`}>
                ≈ {matchedOn}
              </InkTag>
            )}
            <Meter value={best.confidence} />
          </div>

          <p className="tag tnum mt-1.5 text-[11.5px] text-ink-soft">
            Last seen {intoTrip(entry.lastSeenT)} · {best.placeLabel} ·{" "}
            {beforeEnd(entry.lastSeenT, durationSec)}
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
                className="pill-ghost px-3.5 py-1.5 text-[12px] text-ink"
              >
                Send robot here
              </button>
            )}
          </div>

          {showNav && entry.navTarget && (
            <div
              className="mt-2 rounded-[8px] px-3 py-2"
              style={{
                background: "rgb(125 119 48 / 0.12)",
                boxShadow: "0 0 0 1px rgb(125 119 48 / 0.35)",
              }}
            >
              <p className="fnote text-[10px] text-moss">[ nav goal queued ]</p>
              {/* `pos` is where the robot STANDS, offset back from the object
                  along the direction its best look came from — not the object's
                  own coordinates, which is what this used to show. */}
              <p className="mt-0.5 text-[12px] leading-snug text-ink-soft">
                The robot would drive here and turn to face it
                {entry.navTarget.distanceM !== undefined
                  ? ` from ${entry.navTarget.distanceM.toFixed(1)} m back`
                  : ""}
                .
              </p>
              {entry.navTarget.why && (
                <p className="mt-1 text-[11px] leading-snug text-ink-soft">
                  {entry.navTarget.why}
                </p>
              )}
              <p className="fnote tnum mt-1 text-[10px] text-ink-faint">
                Stand at ({entry.navTarget.pos[0].toFixed(1)}, {entry.navTarget.pos[1].toFixed(1)}) m ·
                heading {entry.navTarget.heading.toFixed(0)}° · best look at{" "}
                {timecode(entry.navTarget.approachFromT)}
              </p>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
