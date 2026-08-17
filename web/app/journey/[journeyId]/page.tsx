/**
 * Several clips, in the order they were walked.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A JOURNEY HAS A PAGE OF ITS OWN
 *
 * `/trip/<id>` renders ONE walk built from ONE clip. That is the right screen
 * for the thing it shows and the wrong one for an afternoon: someone who filmed
 * the courtyard, walked to the fountain, and filmed that has two walks and no
 * screen anywhere that says they were the same outing. The route between them —
 * which is most of what actually happened — had nowhere to live.
 *
 * So this page is the route. Each leg links out to the walk built from that
 * clip, where the moments are; what this page owns is the ORDER, the distances
 * between the clips, and — the part that matters more than either — the ledger
 * of how much of that was read off the files and how much was worked out.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT RENDERS THE DOUBT, NOT JUST THE ANSWER
 *
 * A route drawn from clip metadata is a first draft. On real footage some clips
 * have a GPS fix and some do not, some have a capture time and some have been
 * through a messaging app that stripped it, and the order can come from nothing
 * better than the numbers in the filenames.
 *
 * Every one of those is on this page, in the words `deriveRoute` chose. The
 * warnings and the assumptions are not a debug panel to be tucked into a
 * `<details>` — they are the difference between a map you can trust and a map
 * that looks identical and is wrong. `lib/journey/clips.ts` states the rule this
 * page exists to honour: measured and assumed are never the same field.
 *
 * A `RoutedClip` whose `locationSource` is `inferred` therefore never renders
 * like one that was `measured`, and one that is `missing` says so rather than
 * quietly not appearing.
 */
import Link from "next/link";
import { notFound } from "next/navigation";

import { getJourney } from "@/lib/journey/store";
import { distance, formatBytes, shortDate } from "@/lib/format";
import { IMPLAUSIBLE_MPS } from "@/lib/journey/clips";
import type { ClipSource, RoutedClip, RouteWarning } from "@/lib/journey/clips";

/**
 * The store is a `globalThis` map that a POST filled in seconds ago. Anything
 * cached here is a page insisting a journey does not exist when it does.
 */
export const dynamic = "force-dynamic";

/**
 * Next 16 hands route params as a Promise. Declared explicitly rather than via
 * the generated `PageProps<"/journey/[journeyId]">` for the same reason
 * app/splat/[jobId]/page.tsx does it: those types are emitted into .next/types
 * by the dev server, so a route nobody has visited has no entry and
 * `tsc --noEmit` fails on a cold clone.
 */
interface Ctx {
  params: Promise<{ journeyId: string }>;
}

export async function generateMetadata({ params }: Ctx) {
  const { journeyId } = await params;
  return {
    title: `${journeyId} · a journey`,
    description: "Several clips, in the order they were walked.",
    // Someone's afternoon, with coordinates on it. A link you can send is not
    // the same thing as a page that should be indexed against the address.
    robots: { index: false, follow: false },
  };
}

export default async function JourneyPage({ params }: Ctx) {
  const { journeyId } = await params;

  const journey = getJourney(journeyId);
  // No consolation screen. The store is in memory, so the overwhelmingly common
  // reason for a miss is that the server restarted — and a page that spins on
  // "loading your journey" for a record that no longer exists is worse than a
  // 404 that sends you back to build it again.
  if (!journey) notFound();

  const { route, legs } = journey;
  const shown = route.clips;
  const kept = shown.filter((c) => !c.omitted);

  // Legs are keyed by clip id rather than by index: a correction can reorder the
  // route after the legs were recorded, and matching on position would then hang
  // the wrong walk off the wrong clip.
  const legFor = new Map(legs.map((l) => [l.clipId, l]));

  return (
    <main className="relative mx-auto w-full max-w-4xl flex-1 px-4 pb-16 pt-6 sm:px-6">
      <div
        aria-hidden
        className="gridfield papergrain pointer-events-none absolute -inset-x-24 -inset-y-6"
      />

      <nav className="mb-5 flex flex-wrap items-center gap-2">
        <Link href="/live" className="pill-ghost px-3.5 py-2 text-[13px] text-ink">
          <span aria-hidden>←</span> Back to the clips
        </Link>
      </nav>

      <header className="rise-in mb-5 max-w-2xl">
        <span className="fnote text-[10.5px] text-moss">[ journey · {journey.id} ]</span>
        <h1 className="mt-2 break-words text-[30px] leading-[1.04] text-ink sm:text-[36px]">
          {journey.title ?? `${kept.length} clips, in order`}
        </h1>
        <p className="mt-2.5 text-[14px] leading-relaxed text-ink-soft">
          The order and the shape of this route were read off the video files
          themselves — when each was filmed and, where the camera recorded one,
          where. Everything below says which of the two it is.
        </p>
      </header>

      {/* ── The numbers, with their honest denominators ────────────────────── */}
      <section
        className="plate-vellum rise-in p-5 sm:p-6"
        style={{ "--i": 1 } as React.CSSProperties}
      >
        <div className="flex flex-wrap items-baseline gap-x-7 gap-y-2">
          <Stat n={kept.length} label="clips" />
          <Stat n={distance(route.totalMetres)} label="measured legs" />
          <Stat
            n={route.totalSeconds === null ? "—" : formatSpan(route.totalSeconds)}
            label="end to end"
            tone={route.totalSeconds === null ? "faint" : undefined}
          />
          {/* Deliberately `n of N` rather than a percentage. "67% located" reads
              as a quality score; "2 of 3 clips had a fix" is a fact somebody can
              act on by going and pinning the third. */}
          <Stat n={`${route.located} of ${kept.length}`} label="had a location" tone="faint" />
          <Stat n={`${route.timed} of ${kept.length}`} label="had a time" tone="faint" />
        </div>

        <p className="fnote mt-3 text-[9.5px] leading-relaxed text-ink-faint">
          [ ordered by {ORDER_BASIS[route.orderedBy]} ]
        </p>

        {/* Legs that cross a positional hole are skipped rather than estimated,
            so this total is a floor and saying otherwise would overstate it. */}
        {route.located < kept.length && (
          <p className="fnote mt-1 text-[9.5px] leading-relaxed text-ink-faint">
            [ the distance counts only the legs with a known point at both ends · it is a floor, not
            the length of the walk ]
          </p>
        )}
      </section>

      {/* ── What we are unsure about ───────────────────────────────────────── */}
      {route.warnings.length > 0 && (
        <section
          className="plate-vellum rise-in mt-5 p-5 sm:p-6"
          style={{ "--i": 2 } as React.CSSProperties}
        >
          <h2 className="text-[18px] leading-tight text-ink">Worth a look</h2>
          <ul className="mt-3 space-y-1.5">
            {route.warnings.map((w, i) => (
              <li key={`${w.code}-${i}`} className={`fnote text-[10px] leading-relaxed ${TONE[w.severity]}`}>
                [ {w.message} ]
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── The route ──────────────────────────────────────────────────────── */}
      <section
        className="plate-vellum rise-in mt-5 p-5 sm:p-6"
        style={{ "--i": 3 } as React.CSSProperties}
      >
        <h2 className="text-[18px] leading-tight text-ink">The clips, in order</h2>

        <ol className="mt-4 space-y-0">
          {shown.map((clip) => (
            <ClipLeg
              key={clip.facts.id}
              clip={clip}
              tripId={legFor.get(clip.facts.id)?.tripId ?? null}
              splatJobId={legFor.get(clip.facts.id)?.splatJobId ?? null}
            />
          ))}
        </ol>
      </section>

      {/* ── The ledger ─────────────────────────────────────────────────────── */}
      <section
        className="plate-vellum rise-in mt-5 p-5 sm:p-6"
        style={{ "--i": 4 } as React.CSSProperties}
      >
        <h2 className="text-[18px] leading-tight text-ink">
          {route.assumptions.length === 0 ? "Nothing was assumed" : "What was assumed"}
        </h2>

        {route.assumptions.length === 0 ? (
          <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-ink-soft">
            Every clip carried its own time and its own fix, so the order and every point on this
            route came off the files. That is rarer than it sounds — most sharing paths strip the
            metadata block on the way through.
          </p>
        ) : (
          <>
            <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-ink-soft">
              In the order it was taken. Each line is a step where the files did not say and
              something was worked out instead.
            </p>
            <ul className="mt-3 space-y-1.5">
              {route.assumptions.map((a, i) => (
                <li key={i} className="fnote text-[10px] leading-relaxed text-ink-faint">
                  [ {a} ]
                </li>
              ))}
            </ul>
          </>
        )}

        <p className="fnote mt-4 text-[10px] leading-relaxed text-ink-faint">
          [ built {shortDate(journey.createdAt)} · held in memory on this server · a restart forgets
          it ]
        </p>
      </section>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * One clip and the leg that reached it.
 *
 * The leg is drawn ABOVE the clip rather than below, because a leg belongs to
 * the gap it crosses and the reader is travelling downwards — so the walk from
 * clip 2 to clip 3 sits between them, where it happened.
 */
function ClipLeg({
  clip,
  tripId,
  splatJobId,
}: {
  clip: RoutedClip;
  tripId: string | null;
  splatJobId: string | null;
}) {
  const { facts } = clip;

  return (
    <li className={clip.omitted ? "opacity-45" : undefined}>
      {/* The gap. Only drawn when something about it is actually known — an
          empty rule between two clips would imply a leg we measured and found
          to be nothing, which is not the same as not knowing. */}
      {clip.index > 0 && (clip.legMetres !== null || clip.legSeconds !== null) && (
        <div className="flex items-center gap-2 py-2 pl-[26px]">
          <span aria-hidden className="h-6 w-px bg-ink/15" />
          <span className="fnote text-[9.5px] text-ink-faint">
            {clip.legMetres !== null ? distance(clip.legMetres) : "distance unknown"}
            {clip.legSeconds !== null ? ` · ${formatSpan(clip.legSeconds)}` : ""}
            {/* Called out only when it is the number that should make somebody
                look. A plausible walking pace is not information. */}
            {clip.legSpeedMps !== null && clip.legSpeedMps > IMPLAUSIBLE_MPS ? (
              <span className="text-clay">
                {" "}
                · {Math.round(clip.legSpeedMps)} m/s — too fast to have been walked
              </span>
            ) : null}
          </span>
        </div>
      )}

      <div className="flex gap-3 rounded-[6px] bg-milk p-3.5" style={{ boxShadow: "var(--ring-ink)" }}>
        <span className="tnum mt-0.5 w-[18px] shrink-0 text-[13px] leading-none text-ink-faint">
          {clip.index + 1}
        </span>

        <div className="min-w-0 flex-1">
          <p
            className={`truncate text-[13.5px] leading-tight text-ink ${
              clip.omitted ? "line-through" : ""
            }`}
          >
            {facts.name}
          </p>

          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
            <Field
              label="filmed"
              source={clip.recordedAtSource}
              value={clip.recordedAt ? shortDate(clip.recordedAt) : null}
            />
            <Field
              label="place"
              source={clip.locationSource}
              value={
                clip.location
                  ? `${clip.location.lat.toFixed(4)}, ${clip.location.lng.toFixed(4)}`
                  : null
              }
            />
            {facts.device && <Field label="shot on" source="measured" value={facts.device} />}
            <Field
              label="length"
              source={facts.durationSec === null ? "missing" : "measured"}
              value={facts.durationSec === null ? null : formatSpan(facts.durationSec)}
            />
            <Field label="size" source="measured" value={formatBytes(facts.bytes)} />
          </div>

          {clip.omitted && (
            <p className="fnote mt-1.5 text-[9.5px] text-ink-faint">[ left out of the route ]</p>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            {/* Only when there IS one. A clip whose detector run failed still
                belongs on the route — it was part of the afternoon — and a dead
                link to a walk that was never built is worse than its absence. */}
            {tripId ? (
              <Link href={`/trip/${tripId}`} className="pill-ghost px-3 py-1 text-[12px] text-ink">
                Open the walk
              </Link>
            ) : (
              <span className="fnote self-center text-[9.5px] text-ink-faint">
                [ no walk was built from this clip ]
              </span>
            )}
            {splatJobId && (
              <Link
                href={`/splat/${splatJobId}`}
                className="pill-ghost px-3 py-1 text-[12px] text-ink"
              >
                Its reconstruction
              </Link>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

/**
 * One fact, wearing its provenance.
 *
 * The `source` is the entire reason this component exists rather than a plain
 * string: an interpolated coordinate and a GPS fix are both "43.6406, -79.4019"
 * and must not read the same. Measured is ink, corrected is named as the
 * reader's own, inferred is faint and labelled, missing says so in words instead
 * of rendering an empty space that looks like a layout bug.
 */
function Field({
  label,
  source,
  value,
}: {
  label: string;
  source: ClipSource;
  value: string | null;
}) {
  const missing = source === "missing" || value === null;

  return (
    <span className="flex items-baseline gap-1.5">
      <span className="fnote text-[9px] text-ink-faint">{label}</span>
      <span
        className={`text-[12px] leading-none ${
          missing ? "text-ink-faint italic" : source === "inferred" ? "text-ink-faint" : "text-ink"
        }`}
      >
        {missing ? "not in the file" : value}
      </span>
      {source === "inferred" && !missing && (
        <span className="fnote text-[9px] text-clay">[ worked out ]</span>
      )}
      {source === "corrected" && (
        <span className="fnote text-[9px] text-moss">[ you set this ]</span>
      )}
    </span>
  );
}

function Stat({
  n,
  label,
  tone,
}: {
  n: number | string;
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
        {typeof n === "number" ? n.toLocaleString() : n}
      </span>
      <span className="fnote text-[9.5px] text-ink-faint">{label}</span>
    </span>
  );
}

/**
 * What the order actually rests on, in words.
 *
 * `file-modified` and `filename` are the two that matter here: both produce a
 * confident-looking sequence from something that is a convention rather than a
 * record, and the reader has to know which one they are looking at before they
 * decide whether to trust it.
 */
const ORDER_BASIS: Record<string, string> = {
  "recorded-at": "when each clip was filmed",
  "file-modified": "the files' modified times — which copying off a phone rewrites, so this order is plausible rather than known",
  filename: "the numbers in the filenames — a convention, not a record",
  "as-given": "nothing but the order they were handed over in",
  corrected: "the order you put them in",
};

const TONE: Record<RouteWarning["severity"], string> = {
  blocker: "text-clay",
  warn: "text-clay/80",
  note: "text-ink-faint",
};

/** Seconds as something readable. Not a duration library for four call sites. */
function formatSpan(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
