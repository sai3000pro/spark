import { redirect } from "next/navigation";
import { Landing, type LandingMoment } from "@/components/home/Landing";
import { clockTime, compactNumber, distance, duration, tripDate } from "@/lib/format";
import { getTripView } from "@/lib/tripData";

/**
 * The landing. Everything the page needs is composed here on the server — the
 * six moment cards and the day's honest numbers — so the client ships zero raw
 * telemetry.
 *
 * Old `/?m=` deep-links belong to the walk screen now and redirect there.
 */
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
  }));

  return (
    <Landing
      dateLabel={tripDate(trip.startedAt)}
      placeLabel={trip.placeLabel}
      stats={{
        distance: distance(trip.stats.distanceM),
        duration: duration(trip.stats.durationSec),
        detections: compactNumber(trip.stats.detectionCount),
        detectionsRaw: trip.stats.detectionCount,
        candidates: trip.stats.candidateCount,
        moments: trip.stats.momentCount,
        objects: trip.stats.distinctObjectCount,
      }}
      moments={moments}
    />
  );
}
