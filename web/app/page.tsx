import { redirect } from "next/navigation";
import { Landing, type LandingMoment } from "@/components/home/Landing";
import { clockTime, compactNumber, distance, duration, tripDate } from "@/lib/format";
import { getTripView } from "@/lib/tripData";
import type { Vec2 } from "@/lib/types";

/**
 * The landing. Everything the cinema needs is composed here on the server —
 * the keep-log, the six moment cards, and the REAL route normalized into unit
 * space for the constellation — so the client ships zero raw telemetry.
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

  // ── Normalize the walk into unit space, aspect preserved ────────────────
  const pathPoints = trip.path.map((p) => p.pos);
  const allPoints = [...pathPoints, ...trip.moments.map((mo) => mo.placePos)];
  const xs = allPoints.map((p) => p[0]);
  const ys = allPoints.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const offX = (1 - (maxX - minX) / span) / 2;
  const offY = (1 - (maxY - minY) / span) / 2;
  const norm = ([x, y]: Vec2): [number, number] => [
    offX + (x - minX) / span,
    offY + (y - minY) / span,
  ];

  // The constellation needs shape, not survey precision — every 6th sample.
  const route = pathPoints.filter((_, i) => i % 6 === 0).map(norm);
  const pins = trip.moments.map((mo) => norm(mo.placePos));

  // ── The keep-log ────────────────────────────────────────────────────────
  const log = [
    { clock: clockTime(trip.startedAt, 0), line: "FOLLOW — WALK BEGINS" },
    ...trip.moments.map((mo) => ({
      clock: clockTime(trip.startedAt, mo.tStart),
      line: `KEEP — ${mo.title.toUpperCase()}`,
    })),
    {
      clock: clockTime(trip.startedAt, trip.durationSec),
      line: `HOME — ${trip.moments.length} KEPT, ${compactNumber(trip.stats.detectionCount)} SEEN`,
    },
  ];

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
      region={trip.region}
      stats={{
        distance: distance(trip.stats.distanceM),
        duration: duration(trip.stats.durationSec),
        detections: compactNumber(trip.stats.detectionCount),
        detectionsRaw: trip.stats.detectionCount,
        candidates: trip.stats.candidateCount,
        moments: trip.stats.momentCount,
        objects: trip.stats.distinctObjectCount,
      }}
      log={log}
      moments={moments}
      route={route}
      pins={pins}
    />
  );
}
