"use client";

/**
 * "Ask Spark" — the design's chat panel, with the fake replaced by retrieval.
 *
 * The mockup answered every question with one hardcoded paragraph after a 900ms
 * setTimeout. Here each turn is routed:
 *   object question  → searchObjects() over the real object index, so the answer
 *                      carries a last-seen time, place, confidence and a nav pose
 *   transcript question → a precomputed momentQA answer over the real transcript
 *   no match         → say so, and offer queries that would work
 *
 * Answers are synchronous because the retrieval is local. No spinner theatre.
 */
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { beforeEnd, intoTrip, pct } from "@/lib/format";
import { searchObjects, suggestedQueries } from "@/lib/objectIndex";
import { intentFor, momentFor, type TripQAView } from "@/lib/tripQA";
import type { ObjectIndexEntry } from "@/lib/types";

interface Props {
  tripId: string;
  index: ObjectIndexEntry[];
  qa: TripQAView;
  durationSec: number;
  /** Focuses the moment on the map when an answer names one. */
  onFocusMoment?: (momentId: string) => void;
}

interface Turn {
  role: "you" | "spark";
  text: string;
  /** Deep link to the evidence — moment, optionally with an anchor. */
  link?: { href: string; label: string; momentId: string };
  detail?: string;
}

export function AskSpark({ tripId, index, qa, durationSec, onFocusMoment }: Props) {
  const suggestions = useMemo(() => suggestedQueries(index, 3), [index]);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([
    {
      role: "spark",
      text:
        `I've indexed ${qa.momentCount} moments from this trip — ` +
        `${qa.distinctLabelCount} distinct object labels and ${qa.transcriptLineCount} transcribed lines. ` +
        `Ask where something is, or what was covered in a conversation.`,
    },
  ]);
  const scroller = useRef<HTMLDivElement>(null);

  const ask = (raw: string) => {
    const query = raw.trim();
    if (!query) return;
    setInput("");
    setTurns((prev) => [...prev, { role: "you", text: query }, answer(query)]);
    // Scroll after paint; the new turn isn't measured yet.
    requestAnimationFrame(() => {
      const el = scroller.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  function answer(query: string): Turn {
    // Object lookup first: "where is my bottle" also matches the /talk/ intent on
    // the word "is", and the concrete answer is the more useful one.
    const hits = searchObjects(query, index, 1);
    if (hits.length && /\b(where|find|left|lost|locate|which)\b/i.test(query)) {
      return objectTurn(hits[0]);
    }

    const intent = intentFor(query);
    if (intent) {
      const moment = momentFor(query, qa, intent);
      if (moment) {
        return {
          role: "spark",
          text: moment.answers[intent],
          detail: `from “${moment.title}” · ${intoTrip(moment.tStart)}`,
          link: {
            href: `/trip/${tripId}/moment/${moment.momentId}`,
            label: "Open the moment",
            momentId: moment.momentId,
          },
        };
      }
    }

    // Object match without a "where" verb. Only accept a confident match here:
    // searchObjects' fuzzy tier is tuned for the ⌘K palette, where an approximate
    // suggestion is helpful, and it will happily read "purple" as "people" (two
    // edits). In a chat that unprompted guess reads as the assistant making things
    // up, so a bare fuzzy hit falls through to the honest no-match reply.
    if (hits.length && hits[0].matchedOn !== "fuzzy") return objectTurn(hits[0]);

    return {
      role: "spark",
      text:
        `Nothing in the index matches that. I can only answer from what was actually ` +
        `detected or transcribed on this trip — try ${suggestions
          .map((s) => `“${s}”`)
          .join(" or ")}.`,
    };
  }

  function objectTurn(hit: ReturnType<typeof searchObjects>[number]): Turn {
    const { entry, matchedOn } = hit;
    const best = entry.best;
    const nav = entry.navTarget;

    const via = matchedOn === "exact" ? "" : ` (matched on ${matchedOn})`;
    // intoTrip() already ends in "in" — "1h 5m in" — so no preposition here.
    const text =
      `${entry.label}${via} — last seen ${intoTrip(entry.lastSeenT)}, at ` +
      `${best.placeLabel}, ${beforeEnd(entry.lastSeenT, durationSec)}. ` +
      `Best look was ${pct(best.confidence)} confident across ${best.detectionCount} frames.`;

    return {
      role: "spark",
      text,
      detail: nav
        ? `I'd drive to (${nav.pos[0].toFixed(1)}, ${nav.pos[1].toFixed(1)}) m · heading ${Math.round(nav.heading)}°`
        : "No 3D position for this one, so I can't navigate to it.",
      link: {
        href: `/trip/${tripId}/moment/${best.momentId}?anchor=${best.trackId}`,
        label: "Show me in 3D",
        momentId: best.momentId,
      },
    };
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div ref={scroller} className="scrollbar-thin min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {turns.map((turn, i) => (
          <div key={i} className={turn.role === "you" ? "flex justify-end" : "flex justify-start"}>
            {turn.role === "you" ? (
              <p className="max-w-[85%] rounded-xl bg-machine-400 px-3 py-2 text-[12px] leading-relaxed text-ink-950">
                {turn.text}
              </p>
            ) : (
              <div className="max-w-[92%] rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 py-2">
                <p className="text-[12px] leading-relaxed text-fog-200">{turn.text}</p>
                {turn.detail && (
                  <p className="tnum mt-1.5 font-mono text-[10px] text-fog-400">{turn.detail}</p>
                )}
                {turn.link && (
                  <Link
                    href={turn.link.href}
                    onMouseEnter={() => onFocusMoment?.(turn.link!.momentId)}
                    className="mt-1.5 inline-block font-mono text-[10px] text-machine-400 hover:underline"
                  >
                    {turn.link.label} →
                  </Link>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {turns.length === 1 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => ask(s)}
              className="rounded-full border border-ink-700 px-2 py-1 text-left font-mono text-[10px] text-fog-400 transition-colors hover:border-machine-500/50 hover:text-machine-300"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="flex shrink-0 gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Where's my water bottle?"
          aria-label="Ask Spark about this trip"
          className="min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-white/[0.05] px-3 py-2 text-[12px] text-fog-100 outline-none transition-colors placeholder:text-fog-400 focus:border-machine-500/50"
        />
        <button
          type="submit"
          className="shrink-0 rounded-xl bg-machine-400 px-3 py-2 font-display text-[12px] font-semibold text-ink-950 transition-opacity hover:opacity-90"
          aria-label="Send"
        >
          →
        </button>
      </form>
    </div>
  );
}
