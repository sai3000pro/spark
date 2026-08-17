"use client";

/**
 * The first draft of a route, printed with all of its workings shown.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS A DRAFT, AND IT SAYS SO FOUR WAYS
 *
 * `deriveRoute` is expected to be wrong about at least one clip in a real pile.
 * That is fine — being wrong is cheap here, because the person reading this was
 * there. What is not fine is being wrong quietly, so four separate things on
 * this screen exist purely to stop that:
 *
 *   the basis      `orderedBy`, said in words, so nobody has to guess whether
 *                  the order came from real capture timestamps or from the
 *                  numbers a camera happened to put in the filenames.
 *   the counts     `located` and `timed` against N. A route drawn from three
 *                  fixes out of nine is a very different object from one drawn
 *                  from nine, and the denominator is the only thing that says so.
 *   the warnings   every one of them, in the order the deriver returned, with a
 *                  blocker looking nothing like a note.
 *   the assumptions  verbatim. Never truncated, never summarised, never behind
 *                  a "show more". They are the ledger of every leap taken on
 *                  the reader's behalf, and an unread ledger is not a ledger.
 *
 * An empty `assumptions` array is worth showing off rather than hiding: it
 * means the route is measured end to end, which on real footage is rare.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS COMPONENT DOES NOT DO
 *
 * It does not hold the corrections and it does not derive anything. It is given
 * a `DerivedRoute` and hands `ClipCorrection`s back upward, so there is exactly
 * one place — MultiVideoPanel — where the correction list lives and exactly one
 * function that turns it into a route. Two copies of that state would be two
 * answers to "what order are these in", which is the one question this whole
 * path exists to answer once.
 */
import type { ClipCorrection, DerivedRoute, OrderBasis, RouteWarning } from "@/lib/journey/clips";
import { distance, duration } from "@/lib/format";

import { ClipRow, type ClipBuildStatus } from "./ClipRow";

interface Props {
  route: DerivedRoute;
  /** `describeCorrection` lines for one clip. Asked per row so the panel keeps the corrections. */
  editsFor: (clipId: string) => string[];
  /** Build state per clip, once a build has been attempted. */
  statusFor?: (clipId: string) => ClipBuildStatus | undefined;
  /** True while the pipeline is running — corrections cannot move under it. */
  disabled: boolean;
  onEdit: (edit: ClipCorrection) => void;
  onReset: (clipId: string) => void;
}

/**
 * What put the clips in this order, in a sentence rather than a token.
 *
 * The distinction that matters most is between the first entry and the other
 * three: only `recorded-at` is a fact about when the footage was filmed. The
 * rest are conventions and fallbacks that happen to produce an ordering, and
 * each one names its own failure mode here so the reader knows what to go and
 * check rather than being told to trust it.
 */
const ORDER_WORDS: Record<OrderBasis, string> = {
  "recorded-at":
    "ordered by the capture time written into each file — the only basis here that is actually about when you filmed",
  "file-modified":
    "ordered by each file's last-modified date, because none of them carried a capture time. Copying a clip off a phone rewrites that date, so this order is plausible and quite possibly wrong",
  filename:
    "ordered by the numbers in the filenames — IMG_0041 before IMG_0042. That is a camera's counting convention, not a record of when anything was filmed",
  "as-given":
    "left in the order you handed them over, because nothing in the files said anything about time",
  corrected: "in the order you put them",
};

const SEVERITY_TONE: Record<RouteWarning["severity"], string> = {
  blocker: "text-clay",
  warn: "text-clay",
  note: "text-ink-faint",
};

export function RouteEditor({ route, editsFor, statusFor, disabled, onEdit, onReset }: Props) {
  const total = route.clips.length;
  const kept = route.clips.filter((c) => !c.omitted).length;

  return (
    <div className="mt-4 rounded-[6px] bg-milk p-4" style={{ boxShadow: "var(--ring-ink)" }}>
      {/* ── The shape of the journey ───────────────────────────────────────── */}
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
        <Stat value={distance(route.totalMetres)} label="walked, of the legs we can measure" />
        <Stat
          value={route.totalSeconds !== null ? duration(route.totalSeconds) : "unknown"}
          label="start to finish"
          tone={route.totalSeconds === null ? "faint" : undefined}
        />
        <Stat
          value={`${route.located} of ${total}`}
          label="clips with a real fix"
          tone={route.located === total ? "strong" : undefined}
        />
        <Stat
          value={`${route.timed} of ${total}`}
          label="clips with a real timestamp"
          tone={route.timed === total ? "strong" : undefined}
        />
      </div>

      <p className="mt-2.5 text-[13px] leading-relaxed text-ink-soft">
        {kept === total
          ? `${total} ${total === 1 ? "clip" : "clips"}, ${ORDER_WORDS[route.orderedBy]}.`
          : `${kept} of ${total} clips in the journey, ${ORDER_WORDS[route.orderedBy]}.`}{" "}
        Distances skip any leg where one end has no position — a gap is left as a gap rather than
        estimated across.
      </p>

      {/* ── Everything that is wrong with it ───────────────────────────────── */}
      {route.warnings.length > 0 && (
        <ul className="mt-3 space-y-1">
          {route.warnings.map((w, i) => (
            <li
              key={`${w.code}-${i}`}
              className={`fnote text-[9.5px] leading-relaxed ${SEVERITY_TONE[w.severity]} ${
                // A blocker means the route is a guess end to end, so it gets a
                // box of its own rather than being the fourth grey line in a
                // list of grey lines. Severity orders this list; it gates nothing.
                w.severity === "blocker" ? "rounded-[4px] px-2 py-1.5" : ""
              }`}
              style={
                w.severity === "blocker" ? { boxShadow: "inset 0 0 0 1.5px rgb(160 82 45 / 0.4)" } : undefined
              }
            >
              [ {w.severity === "blocker" ? "the whole route is a guess · " : ""}
              {w.severity === "warn" ? "worth a look · " : ""}
              {w.message} ]
            </li>
          ))}
        </ul>
      )}

      {/* ── The ledger ─────────────────────────────────────────────────────── */}
      <div className="mt-3 border-t border-ink/10 pt-3">
        <p className="fnote text-[9px] text-ink-faint">
          [ {route.assumptions.length === 0 ? "assumptions: none" : "what was assumed to draw this"} ]
        </p>
        {route.assumptions.length === 0 ? (
          <p className="mt-1 text-[12.5px] leading-relaxed text-moss">
            Nothing here was inferred — every clip carried its own time and place, which is rare
            enough on real footage to be worth saying.
          </p>
        ) : (
          <ul className="mt-1 space-y-1">
            {route.assumptions.map((a, i) => (
              // Verbatim, in order, all of them. Paraphrasing an assumption is
              // how it stops being one.
              <li key={`${a}-${i}`} className="fnote text-[9.5px] leading-relaxed text-ink-faint">
                [ {a} ]
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── The clips themselves ───────────────────────────────────────────── */}
      <ol className="mt-3 space-y-2">
        {route.clips.map((clip) => (
          <ClipRow
            key={clip.facts.id}
            clip={clip}
            total={total}
            edits={editsFor(clip.facts.id)}
            status={statusFor?.(clip.facts.id)}
            disabled={disabled}
            onEdit={onEdit}
            onReset={onReset}
          />
        ))}
      </ol>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * The same stat chip VideoWalkPanel uses, taking a string rather than a number
 * — "3 of 9" and "1.24 km" are both stats and neither is an integer.
 */
function Stat({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone?: "faint" | "strong";
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span
        className={`tnum text-[19px] leading-none ${
          tone === "strong" ? "text-clay" : tone === "faint" ? "text-ink-faint" : "text-ink"
        }`}
      >
        {value}
      </span>
      <span className="fnote text-[9.5px] text-ink-faint">{label}</span>
    </span>
  );
}
