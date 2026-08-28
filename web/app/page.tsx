import { redirect } from "next/navigation";
import {
  Landing,
  type LandingDiscard,
  type LandingMoment,
} from "@/components/home/Landing";
import { clockTime, compactNumber, distance, duration, tripDate } from "@/lib/format";
import { listCaptures } from "@/lib/library";
import { getActiveTrip } from "@/lib/liveTrip";
import { LABEL_FAMILIES } from "@/lib/mock/labels";
import { describeTrigger } from "@/lib/triggers";
import { getTripView } from "@/lib/tripData";

/**
 * The landing. Everything the page needs is composed here on the server — the
 * intro storm's noticed words, the six moment cards, the discarded candidates,
 * the day's honest numbers and the reader's own shelf — so the client ships
 * zero raw telemetry.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO SOURCES, AND WHICH ONE IS ALLOWED TO CLAIM WHAT
 *
 * `getTripView()` is the flagship AUTHORED walk, and it feeds sections I–VII:
 * the sieve, the three instruments, the six kept moments and every candidate
 * they beat. That is a demo and the page now says so — see the hero's fnote in
 * components/home/Landing.tsx for the argument for keeping it rather than
 * deleting it.
 *
 * `listCaptures()` is what this person actually has, and it feeds section VIII
 * alone. That section used to be `listAllTrips()` — nine authored walks under
 * the heading "every album the robot has pressed" — which meant a first-time
 * reader with an empty machine was shown a library of somebody's walks through
 * Lisbon, Kyoto and Cape Town as their own. The two sources never mix now, and
 * an empty result is rendered as empty rather than backfilled from the demo.
 *
 * Old `/?m=` deep-links belong to the walk screen now and redirect there.
 */

/**
 * The shelf reads globalThis stores and the filesystem — uploaded walks,
 * albums, journeys and whatever .ply files are on disk — none of which exist at
 * build time. Prerendering this page would freeze somebody's shelf at "empty"
 * forever, which is the one wrong answer it must never cache. Same reason
 * app/trip/[tripId] and app/live carry it.
 */
export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const m = first(sp.m);
  if (m) {
    const anchor = first(sp.anchor);
    redirect(`/walk?m=${m}${anchor ? `&anchor=${anchor}` : ""}`);
  }

  const trip = getTripView();

  const moments: LandingMoment[] = trip.moments.map((mo) => ({
    id: mo.id,
    title: mo.title,
    summary: mo.summary,
    clock: clockTime(trip.startedAt, mo.tStart),
    length: duration(mo.tEnd - mo.tStart),
    place: mo.placeLabel,
    mood: mo.vibe.mood,
    hasMusic: mo.hasMusic,
    seed: mo.thumbnailSeed,
    hue: mo.thumbnailHue,
    url: mo.thumbnailUrl,
    // The sieve circles one of these per moment, so the circled word is
    // something the robot really detected in that minute.
    topLabels: mo.topLabels,
  }));

  // The intro storm — everything the cameras and mics noticed, as words. Real
  // detection vocabulary first (what the moments were actually "of"), then the
  // wider COCO families it watches for, then what the audio layer heard.
  const noticed = [
    ...new Set([
      ...trip.moments.flatMap((mo) => mo.topLabels),
      ...Object.values(LABEL_FAMILIES).flat(),
      "laughter",
      "voices",
      "golden light",
      "footsteps",
      "wind in the trees",
      "a name it knows",
      "still water",
      "gravel underfoot",
    ]),
  ];

  const discards: LandingDiscard[] = trip.candidates
    .filter((c) => c.status === "discarded")
    .slice(0, 6)
    .map((c) => ({
      id: c.id,
      clock: clockTime(trip.startedAt, c.tStart),
      length: duration(c.tEnd - c.tStart),
      trigger: c.triggers[0] ? describeTrigger(c.triggers[0]) : "quiet stretch",
      reason: c.discardReason ?? "scored below the keep line",
      score: c.score,
    }));

  return (
    <Landing
      dateLabel={tripDate(trip.startedAt)}
      placeLabel={trip.placeLabel}
      coordsLabel={`${Math.abs(trip.origin.lat).toFixed(4)}° ${trip.origin.lat >= 0 ? "N" : "S"}, ${Math.abs(trip.origin.lng).toFixed(4)}° ${trip.origin.lng >= 0 ? "E" : "W"}`}
      stats={{
        distance: distance(trip.stats.distanceM),
        duration: duration(trip.stats.durationSec),
        detections: compactNumber(trip.stats.detectionCount),
        detectionsRaw: trip.stats.detectionCount,
        candidates: trip.stats.candidateCount,
        moments: trip.stats.momentCount,
        objects: trip.stats.distinctObjectCount,
      }}
      noticed={noticed}
      moments={moments}
      discards={discards}
      // The reader's own shelf. Derived by looking at the four stores every
      // time — there is no "has captures" flag anywhere, and an empty array is
      // a state the shelf renders, not a case to fall back from.
      captures={listCaptures()}
      // Read here rather than polled on the client so the companion on the
      // ticker paints the right state on the very first frame.
      activeTrip={getActiveTrip()}
    />
  );
}
