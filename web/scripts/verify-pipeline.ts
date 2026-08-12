/**
 * Invariant checks over the mock trips.
 *
 * The whole pitch rests on the three timeline lanes agreeing with each other:
 * every promoted moment traces back to a candidate, and every candidate traces
 * back to detections inside its window. If that breaks, the demo is a lie — so
 * it gets asserted rather than eyeballed.
 *
 *   npm run verify
 *
 * Three sections, and the split matters:
 *
 *   1. Waterloo Park — the deep trip, with a dozen specific facts asserted about
 *      it (6 moments, the water bottle's last sighting, the discard histogram).
 *      This is the guardrail on TRIGGER_WEIGHTS. Do not soften it, and do not
 *      let its trip-specific assertions leak into the all-trips loop.
 *   2. Every trip — structural invariants only, so a new trip whose moment
 *      silently failed to promote gets caught the moment it is added.
 *   3. Geo + the merged cross-trip index.
 *
 * Runs under tsx, NOT under Next. Nothing reachable from here may import next/*
 * or server-only — see the header of lib/pipeline.ts.
 */
import { buildTrip, type TripSpec } from "../lib/mock/buildTrip";
import { dropContained, fuseBoxes, type Box, type ScoredBox } from "../lib/detect/boxes";
import { assignTracks } from "../lib/detect/track";
import { mapPassBoxes, passCountFor, planPasses, QUALITY_PRESETS } from "../lib/detect/tta";
import { bestViewpoint, scoreView } from "../lib/detect/viewQuality";
import { collapseToSightings } from "../lib/pipeline";
import type { Detection, TrackPoint } from "../lib/types";
import { makeGeo, type GeoRef } from "../lib/geo";
import { TRIP_SPECS } from "../lib/mock/trips";
import { waterlooPark } from "../lib/mock/trips/waterloo-park";
import { LABEL_FAMILIES } from "../lib/mock/labels";
import { buildObjectIndex, mergeObjectIndexes, searchObjects } from "../lib/objectIndex";
import { computeTripStats, PIPELINE_CONFIG } from "../lib/pipeline";
import { formatGeo, geoToLocal, geoToVec3, haversineM, localToGeo, vec3ToGeo } from "../lib/globe/geo";
import { coastCells, getLandMask, isLand } from "../lib/globe/mask";
import { buildGlobeCloud, buildStarField } from "../lib/globe/globePoints";
import { clusterByProximity } from "../lib/globeData";
import {
  TripConflictError,
  __resetLiveTrip,
  getActiveTrip,
  noteIngest,
  openTripForIngest,
  startTrip,
  stopTrip,
} from "../lib/liveTrip";
import {
  BucketCoverage,
  bearingOfPixel,
  cameraDirection,
  colorRamp,
  focalFor,
  metresBetween,
  popcount,
  projectToScreen,
  surfaceAzimuthBucket,
  type Projection,
  type Vec3,
} from "../lib/coverage";
import { PointTracker, toGray } from "../lib/tracking";
import { intrinsicsFor, transformFromRotation } from "../lib/liveRecon";
import { budgetFor, REFERENCE_SCORE, tierFor } from "../lib/gpu";
import {
  __resetAlbums,
  addToAlbum,
  albumForJourney,
  createAlbum,
  deleteAlbum,
  forgetJourney,
  getAlbum,
  listAlbums,
  MAX_TITLE,
} from "../lib/albums";

let failures = 0;

/** Mirrors lib/tripData.ts getGeoRefFor. Inlined so this script stays off the data layer. */
const geoRefFor = (spec: TripSpec): GeoRef => ({
  origin: spec.place.mapOrigin ?? spec.place.origin,
  bearingDeg: spec.place.bearingDeg ?? 0,
});

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(name: string) {
  console.log(`\n${name}`);
}

function heading(name: string) {
  console.log(`\n${"═".repeat(72)}\n${name}\n${"═".repeat(72)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Waterloo Park — the deep trip
// ─────────────────────────────────────────────────────────────────────────────

function verifyWaterlooPark() {
  heading("Waterloo Park — the deep trip");

  const { trip, distanceM } = buildTrip(waterlooPark);
  const stats = computeTripStats(trip, distanceM);
  const index = buildObjectIndex(trip.moments, trip.path, trip);

  section("Trip shape");
  check("6 moments promoted", trip.moments.length === 6, `got ${trip.moments.length}`);
  check("detections generated", trip.detections.length > 1500, `got ${trip.detections.length}`);
  check("candidates found", trip.candidates.length > 6, `got ${trip.candidates.length}`);
  check("path sampled", trip.path.length > 300, `got ${trip.path.length}`);
  check(
    "distance is plausible for a 95-min walk",
    distanceM > 800 && distanceM < 6000,
    `${distanceM.toFixed(0)}m`,
  );

  section("Lane 1 → 2: every candidate is backed by detections in its window");
  {
    const byId = new Map(trip.detections.map((d) => [d.id, d]));
    let bad = 0;
    let empty = 0;
    for (const c of trip.candidates) {
      if (!c.detectionIds.length) empty++;
      for (const id of c.detectionIds) {
        const d = byId.get(id);
        if (!d || d.t < c.tStart - 0.01 || d.t > c.tEnd + 0.01) bad++;
      }
    }
    check("all candidate detectionIds resolve and fall inside the window", bad === 0, `${bad} bad refs`);
    check("no candidate is empty", empty === 0, `${empty} empty`);
  }

  section("Lane 2 → 3: every moment traces to a promoted candidate");
  {
    const byId = new Map(trip.candidates.map((c) => [c.id, c]));
    let bad = 0;
    for (const m of trip.moments) {
      const c = byId.get(m.candidateId);
      if (!c || c.status !== "promoted") bad++;
      else if (m.tStart !== c.tStart || m.tEnd !== c.tEnd) bad++;
    }
    check("moment spans equal their candidate spans", bad === 0, `${bad} mismatched`);
    check(
      "promoted count equals moment count",
      trip.candidates.filter((c) => c.status === "promoted").length === trip.moments.length,
    );
    check("no candidate left pending", trip.candidates.every((c) => c.status !== "pending"));
    check(
      "every discarded candidate explains itself",
      trip.candidates.filter((c) => c.status === "discarded").every((c) => !!c.discardReason),
    );
  }

  section("Moment contents");
  {
    let noObjects = 0;
    let noKeyframes = 0;
    let badSighting = 0;
    for (const m of trip.moments) {
      if (!m.objects.length) noObjects++;
      if (m.keyframes.length !== PIPELINE_CONFIG.keyframesPerMoment) noKeyframes++;
      const kfIds = new Set(m.keyframes.map((k) => k.id));
      for (const o of m.objects) {
        if (!kfIds.has(o.keyframeId)) badSighting++;
        if (o.firstSeenT < m.tStart - 0.01 || o.lastSeenT > m.tEnd + 0.01) badSighting++;
        if (o.confidence <= 0 || o.confidence > 1) badSighting++;
      }
    }
    check("every moment has objects", noObjects === 0, `${noObjects} without`);
    check("every moment has its keyframes", noKeyframes === 0, `${noKeyframes} wrong`);
    check("sightings reference a real keyframe and stay in span", badSighting === 0, `${badSighting} bad`);
    check("every moment has a transcript", trip.moments.every((m) => m.transcript.length > 0));
  }

  section("Splat status coverage (all three states must exist)");
  {
    const statuses = trip.moments.map((m) => m.splat.status);
    check("at least one ready", statuses.includes("ready"));
    check("exactly one processing", statuses.filter((s) => s === "processing").length === 1);
    check("exactly one failed", statuses.filter((s) => s === "failed").length === 1);
    check(
      "ready moments carry a url",
      trip.moments.filter((m) => m.splat.status === "ready").every((m) => !!m.splat.url),
    );
    check(
      "non-ready moments explain themselves",
      trip.moments.filter((m) => m.splat.status !== "ready").every((m) => !!m.splat.note),
    );
  }

  section('Object index / "where is my X?"');
  {
    check("index is non-empty", index.length > 5, `got ${index.length}`);
    check(
      "every entry's best sighting is one of its sightings",
      index.every((e) => e.sightings.includes(e.best)),
    );
    check(
      "entries with worldPos get a nav target",
      index.filter((e) => e.best.worldPos).every((e) => !!e.navTarget),
    );

    // Regression: navTarget.heading was raw atan2 radians while the UI rendered it
    // with a "°" suffix, so every object reported a bearing between -3° and 3°.
    const headings = index.map((e) => e.navTarget?.heading).filter((h): h is number => h !== undefined);
    check(
      "nav headings are degrees in 0–360",
      headings.every((h) => h >= 0 && h < 360),
      `out of range: ${headings.filter((h) => h < 0 || h >= 360).join(", ")}`,
    );
    check(
      "nav headings actually vary (not all collapsed near zero)",
      Math.max(...headings) - Math.min(...headings) > 45,
      `spread only ${(Math.max(...headings) - Math.min(...headings)).toFixed(1)}°`,
    );

    // Regression: a chat answer must not invent an object from a fuzzy near-miss
    // ("purple" is two edits from "people").
    check(
      "gibberish only ever matches fuzzily, never exactly",
      searchObjects("purple elephant xyzzy", index).every((r) => r.matchedOn === "fuzzy"),
    );

    const bottle = searchObjects("where is my water bottle", index);
    check("'where is my water bottle' resolves to bottle", bottle[0]?.entry.label === "bottle",
      `got ${bottle[0]?.entry.label ?? "nothing"}`);

    // "water bottle" contains the literal label, so it matches exactly. A real
    // alias is a word that shares no substring with the COCO class.
    const nalgene = searchObjects("where's my nalgene", index);
    check("alias path works ('nalgene' → bottle)", nalgene[0]?.entry.label === "bottle",
      `got ${nalgene[0]?.entry.label ?? "nothing"}`);
    check("...and reports matchedOn: alias", nalgene[0]?.matchedOn === "alias",
      `got ${nalgene[0]?.matchedOn}`);

    const bottleEntry = index.find((e) => e.label === "bottle");
    check(
      "bottle's best sighting is the snack bar table (the hero case)",
      bottleEntry?.best.momentId === "m_snack_bar_table",
      `got ${bottleEntry?.best.momentId}`,
    );
    check(
      "bottle is never seen after the snack bar",
      (bottleEntry?.lastSeenT ?? 0) < 3915,
      `lastSeenT ${bottleEntry?.lastSeenT}`,
    );

    for (const [q, expected] of [
      ["where is my phone", "cell phone"],
      ["where did I leave my bag", "backpack"],
      ["ducks", "bird"],
      ["bike", "bicycle"],
      ["coffee", "cup"],
      ["frisbee", "frisbee"],
    ] as const) {
      const r = searchObjects(q, index);
      check(`"${q}" → ${expected}`, r[0]?.entry.label === expected, `got ${r[0]?.entry.label ?? "nothing"}`);
    }

    check("gibberish returns nothing", searchObjects("zzzqqq", index).length === 0);
    check("empty query returns nothing", searchObjects("where is my", index).length === 0);
  }

  section("Stats");
  console.log(
    `  ${stats.momentCount} moments · ${stats.candidateCount} candidates · ` +
      `${stats.detectionCount} detections · ${stats.distinctObjectCount} distinct labels · ` +
      `${stats.splatsReady} splats ready · ${(stats.distanceM / 1000).toFixed(2)} km · ` +
      `${(stats.durationSec / 60).toFixed(0)} min`,
  );
  check("duration matches the authored 95 minutes", Math.abs(stats.durationSec - 5700) < 1);

  section("Candidate breakdown");
  {
    const promoted = trip.candidates.filter((c) => c.status === "promoted");
    const discarded = trip.candidates.filter((c) => c.status === "discarded");
    console.log(`  promoted ${promoted.length} · discarded ${discarded.length}`);
    const reasons = new Map<string, number>();
    for (const c of discarded) {
      const key = c.discardReason!.replace(/[\d.]+/g, "N");
      reasons.set(key, (reasons.get(key) ?? 0) + 1);
    }
    for (const [reason, n] of [...reasons].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(3)} × ${reason}`);
    }
    check("more than one distinct discard reason", reasons.size > 1, `${reasons.size}`);
    check(
      "promoted candidates all clear the promote threshold",
      promoted.every((c) => c.score >= PIPELINE_CONFIG.promoteThreshold),
      promoted.map((c) => c.score.toFixed(2)).join(", "),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Every trip — structural invariants only
// ─────────────────────────────────────────────────────────────────────────────

function verifyEveryTrip() {
  heading(`Every trip (${TRIP_SPECS.length}) — structural invariants`);

  const knownLabels = new Set<string>(Object.values(LABEL_FAMILIES).flat());

  section("Authored moments all survived the pipeline");
  for (const spec of TRIP_SPECS) {
    const { trip } = buildTrip(spec);
    // THE check that catches a light trip whose moment failed to clear
    // promoteThreshold and got dropped with only a console warning.
    check(
      `${spec.id}: ${trip.moments.length}/${spec.moments.length} moments promoted`,
      trip.moments.length === spec.moments.length,
      "see the authoring rules at the top of lib/mock/buildTrip.ts",
    );
  }

  section("Lane integrity across all trips");
  {
    let spanMismatch = 0;
    let pending = 0;
    let unexplained = 0;
    let badRefs = 0;
    for (const spec of TRIP_SPECS) {
      const { trip } = buildTrip(spec);
      const byCand = new Map(trip.candidates.map((c) => [c.id, c]));
      const byDet = new Map(trip.detections.map((d) => [d.id, d]));
      for (const m of trip.moments) {
        const c = byCand.get(m.candidateId);
        if (!c || c.status !== "promoted" || m.tStart !== c.tStart || m.tEnd !== c.tEnd) spanMismatch++;
      }
      for (const c of trip.candidates) {
        if (c.status === "pending") pending++;
        if (c.status === "discarded" && !c.discardReason) unexplained++;
        for (const id of c.detectionIds) {
          const d = byDet.get(id);
          if (!d || d.t < c.tStart - 0.01 || d.t > c.tEnd + 0.01) badRefs++;
        }
      }
    }
    check("every moment matches its promoted candidate's span", spanMismatch === 0, `${spanMismatch} bad`);
    check("no candidate left pending anywhere", pending === 0, `${pending} pending`);
    check("every discarded candidate explains itself", unexplained === 0, `${unexplained} silent`);
    check("all candidate detection refs resolve in-window", badRefs === 0, `${badRefs} bad refs`);
  }

  section("Moment contents across all trips");
  {
    let noObjects = 0;
    let noKeyframes = 0;
    let noTranscript = 0;
    let badSighting = 0;
    for (const spec of TRIP_SPECS) {
      for (const m of buildTrip(spec).trip.moments) {
        if (!m.objects.length) noObjects++;
        if (m.keyframes.length !== PIPELINE_CONFIG.keyframesPerMoment) noKeyframes++;
        if (!m.transcript.length) noTranscript++;
        const kfIds = new Set(m.keyframes.map((k) => k.id));
        for (const o of m.objects) {
          if (!kfIds.has(o.keyframeId)) badSighting++;
          if (o.firstSeenT < m.tStart - 0.01 || o.lastSeenT > m.tEnd + 0.01) badSighting++;
        }
      }
    }
    check("every moment has objects", noObjects === 0, `${noObjects} without`);
    check("every moment has its keyframes", noKeyframes === 0, `${noKeyframes} wrong`);
    check("every moment has a transcript", noTranscript === 0, `${noTranscript} without`);
    check("sightings reference a real keyframe and stay in span", badSighting === 0, `${badSighting} bad`);
  }

  section("Splat honesty");
  {
    let readyNoUrl = 0;
    let unreadyNoNote = 0;
    const statuses: Record<string, number> = {};
    for (const spec of TRIP_SPECS) {
      for (const m of buildTrip(spec).trip.moments) {
        statuses[m.splat.status] = (statuses[m.splat.status] ?? 0) + 1;
        if (m.splat.status === "ready" && !m.splat.url) readyNoUrl++;
        if (m.splat.status !== "ready" && !m.splat.note) unreadyNoNote++;
      }
    }
    console.log(`  ${Object.entries(statuses).map(([s, n]) => `${n} ${s}`).join(" · ")}`);
    check("ready moments carry a url", readyNoUrl === 0, `${readyNoUrl} without`);
    check("non-ready moments explain themselves", unreadyNoNote === 0, `${unreadyNoNote} silent`);
    check("the gallery shows more than one splat state", Object.keys(statuses).length > 1);
  }

  section("Label vocabulary");
  {
    // A label outside LABEL_FAMILIES silently colours as "furniture" via familyOf,
    // and the timeline's validated categorical palette starts lying about what a
    // colour means. Authoring rule 4.
    const unknown = new Set<string>();
    for (const spec of TRIP_SPECS) {
      for (const d of buildTrip(spec).trip.detections) {
        if (!knownLabels.has(d.label)) unknown.add(d.label);
      }
    }
    check(
      "every detection label resolves to a real family",
      unknown.size === 0,
      `unknown: ${[...unknown].join(", ")}`,
    );
  }

  section("Trip identity");
  {
    const ids = TRIP_SPECS.map((s) => s.id);
    check("trip ids are unique", new Set(ids).size === ids.length);
    const origins = TRIP_SPECS.map((s) => `${s.place.origin.lat},${s.place.origin.lng}`);
    check("trip origins are unique", new Set(origins).size === origins.length);
    check(
      "every trip names a country",
      TRIP_SPECS.every((s) => s.place.country.length > 1),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Geo + the merged cross-trip index
// ─────────────────────────────────────────────────────────────────────────────

function verifyGeoAndGlobalIndex() {
  heading("Geo + the merged cross-trip index");

  section("Local ↔ geo");
  {
    const origin = waterlooPark.place.origin;
    const atOrigin = localToGeo(origin, [0, 0]);
    check(
      "the local origin maps back to the trip origin",
      Math.abs(atOrigin.lat - origin.lat) < 1e-9 && Math.abs(atOrigin.lng - origin.lng) < 1e-9,
      formatGeo(atOrigin),
    );

    let worstM = 0;
    for (const east of [-800, -100, 0, 250, 900]) {
      for (const south of [-800, -100, 0, 250, 900]) {
        const back = geoToLocal(origin, localToGeo(origin, [east, south]));
        worstM = Math.max(worstM, Math.hypot(back[0] - east, back[1] - south));
      }
    }
    check("local → geo → local round-trips within 0.5 m over a 1 km spread", worstM < 0.5,
      `worst ${worstM.toExponential(2)} m`);

    // +x is east and +z is south, so a moment further along +z must be further
    // SOUTH — i.e. lower latitude. Getting this backwards flips every map.
    const south = localToGeo(origin, [0, 500]);
    const east = localToGeo(origin, [500, 0]);
    check("+z (south) lowers latitude", south.lat < origin.lat, `${south.lat} vs ${origin.lat}`);
    check("+x (east) raises longitude", east.lng > origin.lng, `${east.lng} vs ${origin.lng}`);
  }

  section("Map georeference");
  {
    // lib/geo.ts is the MAP transform — rotated, and with different metre-per-
    // degree constants from lib/globe/geo.ts above. It used to be a pair of
    // module-level constants pinned to Waterloo Park; these literals were
    // captured from that version, and they are the guard that making it
    // per-trip did not move the walk by a single float.
    const g = makeGeo(geoRefFor(waterlooPark));
    const frozen: Array<[[number, number], [number, number]]> = [
      [[0, 0], [-80.5372, 43.4672]],
      [[500, 0], [-80.53107153685042, 43.466570678907516]],
      [[0, 500], [-80.53806129932649, 43.4627221477529]],
      [[350, 240], [-80.533323499472, 43.464610106156655]],
    ];
    let drifted = 0;
    for (const [local, want] of frozen) {
      const got = g.localToLngLat(local);
      if (got[0] !== want[0] || got[1] !== want[1]) drifted++;
    }
    check("Waterloo Park's map transform is bit-identical to the pre-refactor one",
      drifted === 0, `${drifted}/${frozen.length} moved`);

    check(
      "the map calibration is NOT the globe pin (they do different jobs)",
      waterlooPark.place.mapOrigin !== undefined &&
        waterlooPark.place.mapOrigin.lat !== waterlooPark.place.origin.lat,
    );

    // A trip with no authored calibration must still land somewhere real, or its
    // walk silently draws in the Gulf of Guinea.
    let unusable = 0;
    for (const spec of TRIP_SPECS) {
      const ref = geoRefFor(spec);
      const [lng, lat] = makeGeo(ref).localToLngLat([0, 0]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) unusable++;
    }
    check("every trip resolves a usable map georeference", unusable === 0, `${unusable} bad`);
  }

  section("Sphere projection");
  {
    let worst = 0;
    for (let i = 0; i < 400; i++) {
      // Deterministic lattice rather than random, so a failure is reproducible.
      const lat = -84 + (168 * (i % 20)) / 19;
      const lng = -180 + (360 * Math.floor(i / 20)) / 19;
      const back = vec3ToGeo(geoToVec3({ lat, lng }));
      const dLng = Math.abs(((back.lng - lng + 540) % 360) - 180);
      worst = Math.max(worst, Math.abs(back.lat - lat), dLng);
    }
    check("geo → vec3 → geo round-trips within 1e-9 over 400 samples", worst < 1e-9,
      `worst ${worst.toExponential(2)}°`);

    // Named orientations. A mirrored globe passes a round-trip test but fails these.
    const gulfOfGuinea = geoToVec3({ lat: 0, lng: 0 });
    check("lng 0 points at +Z", gulfOfGuinea[2] > 0.999 && Math.abs(gulfOfGuinea[0]) < 1e-9);
    const indianOcean = geoToVec3({ lat: 0, lng: 90 });
    check("lng +90 points at +X", indianOcean[0] > 0.999);
    check("the north pole points at +Y", geoToVec3({ lat: 90, lng: 0 })[1] > 0.999);
  }

  section("Trip origins on the globe");
  {
    check(
      "every origin is inside the usable latitude band",
      TRIP_SPECS.every((s) => Math.abs(s.place.origin.lat) < 85),
    );
    check(
      "every origin is a real longitude",
      TRIP_SPECS.every((s) => Math.abs(s.place.origin.lng) <= 180),
    );

    // The globe clusters pins within 220 km. Without two trips in one metro area
    // that code path never renders, so it is asserted rather than hoped for.
    let closestKm = Infinity;
    for (let i = 0; i < TRIP_SPECS.length; i++) {
      for (let j = i + 1; j < TRIP_SPECS.length; j++) {
        closestKm = Math.min(
          closestKm,
          haversineM(TRIP_SPECS[i].place.origin, TRIP_SPECS[j].place.origin) / 1000,
        );
      }
    }
    check("at least two trips share a metro area (globe clustering)", closestKm < 220,
      `closest pair ${closestKm.toFixed(0)} km apart`);
  }

  section("Merged index");
  {
    const merged = mergeObjectIndexes(
      TRIP_SPECS.map((spec) => {
        const { trip } = buildTrip(spec);
        return buildObjectIndex(trip.moments, trip.path, trip);
      }),
    );

    check("merged index is non-empty", merged.length > 5, `got ${merged.length}`);
    check(
      "every merged entry's best sighting is one of its sightings",
      merged.every((e) => e.sightings.includes(e.best)),
    );
    check(
      "every sighting carries its trip and an absolute clock",
      merged.every((e) =>
        e.sightings.every((s) => !!s.tripId && !!s.tripTitle && !Number.isNaN(Date.parse(s.lastSeenAt))),
      ),
    );
    check(
      "merged labels are unique",
      new Set(merged.map((e) => e.label)).size === merged.length,
    );

    const perTripTotal = TRIP_SPECS.reduce((n, spec) => {
      const { trip } = buildTrip(spec);
      return n + buildObjectIndex(trip.moments, trip.path, trip).reduce((k, e) => k + e.sightings.length, 0);
    }, 0);
    const mergedTotal = merged.reduce((n, e) => n + e.sightings.length, 0);
    check("merging loses no sightings", mergedTotal === perTripTotal, `${mergedTotal} vs ${perTripTotal}`);

    // Authoring rule 6: a louder bottle in another trip would quietly steal the
    // hero case out from under the demo.
    const bottle = searchObjects("where's my nalgene", merged);
    check("cross-trip search still resolves 'nalgene' → bottle", bottle[0]?.entry.label === "bottle",
      `got ${bottle[0]?.entry.label ?? "nothing"}`);
    check(
      "the hero water bottle is still Waterloo Park's snack bar table",
      bottle[0]?.entry.best.tripId === waterlooPark.id &&
        bottle[0]?.entry.best.momentId === "m_snack_bar_table",
      `got ${bottle[0]?.entry.best.tripId} / ${bottle[0]?.entry.best.momentId}`,
    );

    const multiTrip = merged.filter((e) => new Set(e.sightings.map((s) => s.tripId)).size > 1);
    check("some labels genuinely span trips", multiTrip.length > 3, `${multiTrip.length} do`);
    console.log(
      `  ${merged.length} labels · ${mergedTotal} sightings · ${multiTrip.length} span more than one trip`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. The globe
// ─────────────────────────────────────────────────────────────────────────────

function verifyGlobe() {
  heading("Globe");

  section("Land mask");
  {
    const mask = getLandMask();
    check("decodes to 512×256", mask.w === 512 && mask.h === 256, `${mask.w}×${mask.h}`);

    // Equirectangular cells shrink toward the poles, so a raw cell count
    // over-weights Antarctica and lands near 0.33. Weight by cos(lat) to recover
    // real surface area, which should sit near Earth's actual 0.292.
    let landArea = 0;
    let totalArea = 0;
    for (let y = 0; y < mask.h; y++) {
      const lat = 90 - (y + 0.5) * (180 / mask.h);
      const weight = Math.cos((lat * Math.PI) / 180);
      for (let x = 0; x < mask.w; x++) {
        totalArea += weight;
        if (mask.land[y * mask.w + x]) landArea += weight;
      }
    }
    const areaFraction = landArea / totalArea;
    check(
      "land is 27–31% of surface area (Earth is 29.2%)",
      areaFraction > 0.27 && areaFraction < 0.31,
      areaFraction.toFixed(4),
    );

    // Named spot checks. A mirrored or upside-down globe passes every round-trip
    // test ever written and fails these immediately.
    check("central Africa is land", isLand(mask, 0, 20));
    check("the mid-Pacific is not", !isLand(mask, 0, -140));
    check("Antarctica is land", isLand(mask, -75, 0));
    check("the Arctic ocean is not", !isLand(mask, 88, 0));
    check("central Australia is land", isLand(mask, -25, 133));
    check("the south Atlantic is not", !isLand(mask, -30, -20));

    check(
      "longitude wraps rather than clamping",
      isLand(mask, 0, 20) === isLand(mask, 0, 380),
    );

    // The whole point of the coast field: interiors must actually be far from the
    // sea, and a small island must not be.
    check("the Sahara reads as deep inland", coastCells(mask, 23, 13) > 4, `${coastCells(mask, 23, 13)} cells`);
    check("open ocean reads as zero", coastCells(mask, 0, -140) === 0);
  }

  section("Point cloud");
  {
    const cloud = buildGlobeCloud();
    check("keeps 12k–16k land points", cloud.count > 12_000 && cloud.count < 16_000, `${cloud.count}`);
    check(
      "every array is the right length",
      cloud.positions.length === cloud.count * 3 &&
        cloud.colors.length === cloud.count * 3 &&
        cloud.sizes.length === cloud.count &&
        cloud.inland.length === cloud.count,
    );
    check("no NaNs in positions", !Array.from(cloud.positions).some(Number.isNaN));
    check(
      "every point sits on the unit sphere",
      (() => {
        for (let i = 0; i < cloud.count; i++) {
          const r = Math.hypot(
            cloud.positions[i * 3],
            cloud.positions[i * 3 + 1],
            cloud.positions[i * 3 + 2],
          );
          if (Math.abs(r - 1) > 1e-5) return false;
        }
        return true;
      })(),
    );
    check("inland factor stays in 0..1", Array.from(cloud.inland).every((v) => v >= 0 && v <= 1));

    const stars = buildStarField();
    check("star field is populated", stars.count === 900, `${stars.count}`);
    {
      let minR = Infinity;
      for (let i = 0; i < stars.count; i++) {
        minR = Math.min(
          minR,
          Math.hypot(stars.positions[i * 3], stars.positions[i * 3 + 1], stars.positions[i * 3 + 2]),
        );
      }
      // Every star must sit outside maxDistance (6.5) or the camera could fly
      // through the star field, which looks like a rendering bug.
      check("every star is far outside the camera's range", minR > 50, `closest ${minR.toFixed(1)}`);
    }
  }

  section("Pin clustering");
  {
    const albums = TRIP_SPECS.map((s) => ({ id: s.id, origin: s.place.origin }));
    const clusters = clusterByProximity(albums, 220);

    check(
      "clustering preserves every album",
      clusters.reduce((n, c) => n + c.items.length, 0) === albums.length,
    );
    check("it actually collapses the metro pair", clusters.length < albums.length,
      `${clusters.length} pins for ${albums.length} albums`);
    check(
      "re-clustering the pins changes nothing (idempotent)",
      clusterByProximity(clusters.map((c) => ({ origin: c.origin })), 220).length === clusters.length,
    );
    console.log(`  ${albums.length} albums → ${clusters.length} pins`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. The live trip
// ─────────────────────────────────────────────────────────────────────────────

function verifyLiveTrip() {
  heading("Live trip");

  section("Session lifecycle");
  {
    __resetLiveTrip();
    check("nothing is active to begin with", getActiveTrip() === null);

    const started = startTrip({ placeLabel: "Test park" });
    check("starting yields a session", !!started.id, started.id);
    check("it reports recording or starting", ["starting", "recording"].includes(started.status),
      started.status);
    check("it is honest about not being persisted", started.persisted === false);
    check("counters begin at zero, not extrapolated",
      started.counters.detections === 0 &&
      started.counters.candidates === 0 &&
      started.counters.moments === 0);

    let conflicted = false;
    try {
      startTrip();
    } catch (err) {
      conflicted = err instanceof TripConflictError;
    }
    check("starting twice conflicts rather than clobbering", conflicted);

    const stopped = stopTrip(started.id);
    check("stopping moves it to processing", stopped.status === "processing", stopped.status);
    check("the session is still readable while processing", getActiveTrip() !== null);

    let mismatch = false;
    try {
      __resetLiveTrip();
      startTrip();
      stopTrip("trip_live_someone_elses_id");
    } catch (err) {
      mismatch = err instanceof TripConflictError;
    }
    check("a stale tab cannot stop the wrong session", mismatch);

    __resetLiveTrip();
    let noTrip = false;
    try {
      stopTrip();
    } catch (err) {
      noTrip = err instanceof TripConflictError;
    }
    check("stopping nothing conflicts rather than throwing", noTrip);
  }

  // Counters used to be EXTRAPOLATED from elapsed time whenever nothing was
  // reporting, and this section asserted that the extrapolation was monotonic
  // and landed near the demo trip's real numbers. All of that is gone: a
  // session cannot exist unless hardware opened it, so the only counters are
  // measured ones. What is asserted now is that nothing invents a number.
  section("Counters are measured, or they are zero");
  {
    __resetLiveTrip();
    startTrip();

    const fresh = getActiveTrip()!;
    check("an unreported session counts nothing",
      fresh.counters.detections === 0 && fresh.counters.moments === 0);

    check("noteIngest rejects an unrelated trip id", noteIngest("trip_not_it", { moments: 1 }) === false);
    check("noteIngest accepts the live one", noteIngest(fresh.id, { detections: 40 }) === true);

    const measured = getActiveTrip()!;
    check("reported counts are used verbatim", measured.counters.detections === 40,
      `${measured.counters.detections}`);
    check("counters do not drift with elapsed time",
      getActiveTrip()!.counters.detections === 40);

    __resetLiveTrip();
  }

  // The rover brings its own session up. This is what makes "connect a rover
  // and it starts working" literal rather than aspirational — no UI, no
  // /api/trip/start, just a batch arriving.
  section("Ingest opens the session");
  {
    __resetLiveTrip();
    check("nothing is running", getActiveTrip() === null);

    const opened = openTripForIngest("trip_rover_alpha");
    check("a first batch opens a session", opened === true);
    const live = getActiveTrip();
    check("the session adopts the rover's own trip id", live?.id === "trip_rover_alpha", live?.id);
    check("so the very same batch attaches",
      noteIngest("trip_rover_alpha", { detections: 12 }) === true);
    check("and the counters are its own", getActiveTrip()!.counters.detections === 12);

    check("a second batch from the same rover is a no-op",
      openTripForIngest("trip_rover_alpha") === true);
    check("a different rover does not steal the session",
      openTripForIngest("trip_rover_beta") === false);
    check("the original session is untouched", getActiveTrip()!.id === "trip_rover_alpha");

    __resetLiveTrip();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Detection quality — fusion, tiling, tracking, best angle
//
// These are the parts that make stage 1 trustworthy, and every one of them is a
// pure function precisely so it can be asserted here rather than eyeballed in a
// browser against a photo of a car park.
// ─────────────────────────────────────────────────────────────────────────────

function verifyDetectionQuality() {
  heading("Detection quality");

  const box = (x0: number, y0: number, x1: number, y1: number): Box => ({ x0, y0, x1, y1 });

  section("Box fusion");
  {
    // The core claim: several passes seeing the same thing produce ONE box, and
    // the fused coordinates sit between the members rather than copying a winner.
    const passes: ScoredBox[][] = [
      [{ label: "bottle", score: 0.8, box: box(0.2, 0.2, 0.3, 0.4) }],
      [{ label: "bottle", score: 0.7, box: box(0.22, 0.21, 0.32, 0.42) }],
      [{ label: "bottle", score: 0.75, box: box(0.21, 0.19, 0.31, 0.41) }],
    ];
    const fused = fuseBoxes(passes, { passCount: 3 });
    check("three agreeing passes collapse to one box", fused.length === 1, `${fused.length}`);
    check("support counts every contributing pass", fused[0]?.support === 3, `${fused[0]?.support}`);
    check("full agreement reads as 1", Math.abs((fused[0]?.agreement ?? 0) - 1) < 1e-9);
    check(
      "the fused box is a consensus, not a copy of the best member",
      fused[0].box.x0 > 0.2 && fused[0].box.x0 < 0.22,
      `x0 ${fused[0].box.x0.toFixed(4)}`,
    );
    check(
      "full agreement leaves the score alone",
      Math.abs(fused[0].score - fused[0].rawScore) < 1e-9,
      `${fused[0].score.toFixed(3)} vs raw ${fused[0].rawScore.toFixed(3)}`,
    );
  }

  section("Agreement demotes the flicker (the whole point)");
  {
    // A real object every pass finds, and a hallucination one pass found with a
    // HIGHER raw score. Before fusion the hallucination outranks the real object;
    // after it, it must not — and it must fall under a sane threshold.
    const real = { label: "bench", score: 0.72, box: box(0.4, 0.4, 0.6, 0.55) };
    const ghost = { label: "dog", score: 0.86, box: box(0.05, 0.7, 0.15, 0.8) };
    const passes: ScoredBox[][] = [
      [real, ghost],
      [{ ...real, score: 0.7 }],
      [{ ...real, score: 0.74 }],
      [{ ...real, score: 0.71 }],
      [{ ...real, score: 0.69 }],
      [{ ...real, score: 0.73 }],
    ];
    const fused = fuseBoxes(passes, { passCount: 6 });
    const bench = fused.find((f) => f.label === "bench");
    const dog = fused.find((f) => f.label === "dog");

    check("the one-pass ghost is not dropped outright", !!dog);
    check("...but it is demoted below the consistent detection",
      (dog?.score ?? 1) < (bench?.score ?? 0),
      `ghost ${dog?.score.toFixed(3)} vs real ${bench?.score.toFixed(3)}`);
    check(
      "...even though its RAW score was higher",
      (dog?.rawScore ?? 0) > (bench?.rawScore ?? 1),
      `raw ghost ${dog?.rawScore.toFixed(3)} vs raw real ${bench?.rawScore.toFixed(3)}`,
    );
    check("...and it lands under a 0.5 threshold", (dog?.score ?? 1) < 0.5,
      `${dog?.score.toFixed(3)}`);
    check("the real detection stays above it", (bench?.score ?? 0) > 0.5,
      `${bench?.score.toFixed(3)}`);
  }

  section("Fusion keeps distinct objects distinct");
  {
    const passes: ScoredBox[][] = [
      [
        { label: "person", score: 0.9, box: box(0.3, 0.1, 0.6, 0.9) },
        { label: "bottle", score: 0.7, box: box(0.4, 0.4, 0.45, 0.55) },
      ],
      [
        { label: "person", score: 0.88, box: box(0.31, 0.11, 0.61, 0.91) },
        { label: "bottle", score: 0.72, box: box(0.4, 0.41, 0.45, 0.56) },
      ],
    ];
    const fused = dropContained(fuseBoxes(passes, { passCount: 2 }));
    check("a bottle held by a person survives as its own object", fused.length === 2,
      `${fused.length}: ${fused.map((f) => f.label).join(", ")}`);

    // The nested-duplicate case dropContained exists for: half a person, found by
    // a tile, sitting entirely inside the whole person.
    const withFragment = dropContained([
      { label: "person", score: 0.9, box: box(0.3, 0.1, 0.6, 0.9) },
      { label: "person", score: 0.8, box: box(0.32, 0.12, 0.58, 0.5) },
    ]);
    check("a nested same-label fragment is absorbed", withFragment.length === 1,
      `${withFragment.length}`);
    check("...and the survivor is the whole object, not the fragment",
      withFragment[0].box.y1 > 0.8, `y1 ${withFragment[0].box.y1}`);
  }

  section("Pass planning");
  {
    check("fast is a single look", planPasses(QUALITY_PRESETS.fast).length === 1);
    check("balanced is flip + 2×2", planPasses(QUALITY_PRESETS.balanced).length === 6,
      `${planPasses(QUALITY_PRESETS.balanced).length}`);
    check("thorough is flip + 3×3", planPasses(QUALITY_PRESETS.thorough).length === 11,
      `${planPasses(QUALITY_PRESETS.thorough).length}`);
    check(
      "passCountFor agrees with the plan for every preset",
      (["fast", "balanced", "thorough"] as const).every(
        (q) => passCountFor(QUALITY_PRESETS[q]) === planPasses(QUALITY_PRESETS[q]).length,
      ),
    );

    // Tiles that do not cover the frame would create blind spots — an object
    // could sit in a gap and be found only by the full-frame pass it is too
    // small for, which is the exact failure tiling exists to fix.
    for (const q of ["balanced", "thorough"] as const) {
      const tiles = planPasses(QUALITY_PRESETS[q]).filter((p) => !p.full);
      const corners: Array<[number, number]> = [
        [0.01, 0.01], [0.99, 0.01], [0.01, 0.99], [0.99, 0.99], [0.5, 0.5],
      ];
      const covered = corners.every(([x, y]) =>
        tiles.some((t) => x >= t.crop.x0 && x <= t.crop.x1 && y >= t.crop.y0 && y <= t.crop.y1),
      );
      check(`${q} tiles cover the whole frame`, covered);
      check(
        `${q} tiles stay inside the frame`,
        tiles.every((t) => t.crop.x0 >= -1e-9 && t.crop.y0 >= -1e-9 && t.crop.x1 <= 1 + 1e-9 && t.crop.y1 <= 1 + 1e-9),
      );
    }
  }

  section("Mapping pass boxes back to the frame");
  {
    const [full, flip] = planPasses(QUALITY_PRESETS.balanced);
    const b: ScoredBox = { label: "cup", score: 0.8, box: box(0.1, 0.3, 0.2, 0.5) };

    const asIs = mapPassBoxes(full, [b])[0];
    check("an unflipped full-frame box is unchanged",
      Math.abs(asIs.box.x0 - 0.1) < 1e-9 && Math.abs(asIs.box.x1 - 0.2) < 1e-9);

    const mirrored = mapPassBoxes(flip, [b])[0];
    check("a flipped box mirrors about the vertical centre line",
      Math.abs(mirrored.box.x0 - 0.8) < 1e-9 && Math.abs(mirrored.box.x1 - 0.9) < 1e-9,
      `got ${mirrored.box.x0.toFixed(3)}–${mirrored.box.x1.toFixed(3)}`);
    check("flipping twice is the identity",
      Math.abs(mapPassBoxes(flip, [mirrored])[0].box.x0 - 0.1) < 1e-9);
    check("a flip leaves y alone",
      Math.abs(mirrored.box.y0 - 0.3) < 1e-9 && Math.abs(mirrored.box.y1 - 0.5) < 1e-9);

    // Truncation. The bottom-right tile's LEFT edge is a cut through the frame;
    // its RIGHT edge is the frame's own edge. A box against the first is half an
    // object and must go; a box against the second is a real object at the edge
    // of the photo and must stay.
    const tiles = planPasses(QUALITY_PRESETS.balanced).filter((p) => !p.full);
    const bottomRight = tiles[tiles.length - 1];
    check("the last tile is the bottom-right one",
      bottomRight.crop.x1 > 0.99 && bottomRight.crop.y1 > 0.99);

    const againstCut = mapPassBoxes(bottomRight, [
      { label: "person", score: 0.9, box: box(0.0, 0.4, 0.3, 0.8) },
    ]);
    check("a box cut by an interior tile seam is dropped", againstCut.length === 0,
      `kept ${againstCut.length}`);

    const againstFrame = mapPassBoxes(bottomRight, [
      { label: "person", score: 0.9, box: box(0.6, 0.4, 1.0, 0.8) },
    ]);
    check("a box against the frame's own edge is kept", againstFrame.length === 1);
  }

  section("Temporal tracking");
  {
    // One object drifting steadily across 10 frames.
    const drifting: Detection[] = Array.from({ length: 10 }, (_, k) => ({
      id: `d${k}`,
      tripId: "t",
      frameId: `f${k}`,
      t: k * 0.1,
      label: "bottle",
      confidence: 0.8,
      bbox: [0.3 + k * 0.005, 0.4, 0.08, 0.16],
      source: "onboard" as const,
    }));
    const tracked = assignTracks(drifting);
    check("a drifting object keeps one track", new Set(tracked.map((d) => d.trackId)).size === 1,
      `${new Set(tracked.map((d) => d.trackId)).size} tracks`);
    check("no detections are lost", tracked.length === 10, `${tracked.length}`);
    check("every detection comes out with a trackId", tracked.every((d) => !!d.trackId));

    // Two objects far apart must never merge, however long they run.
    const twoObjects: Detection[] = [];
    for (let k = 0; k < 8; k++) {
      twoObjects.push(
        { id: `l${k}`, tripId: "t", frameId: `f${k}`, t: k * 0.1, label: "bottle",
          confidence: 0.8, bbox: [0.1, 0.4, 0.08, 0.16], source: "onboard" },
        { id: `r${k}`, tripId: "t", frameId: `f${k}`, t: k * 0.1, label: "bottle",
          confidence: 0.8, bbox: [0.7, 0.4, 0.08, 0.16], source: "onboard" },
      );
    }
    check("two separated same-label objects stay two tracks",
      new Set(assignTracks(twoObjects).map((d) => d.trackId)).size === 2,
      `${new Set(assignTracks(twoObjects).map((d) => d.trackId)).size}`);

    // Flicker suppression — the cheapest false-positive filter there is.
    const flicker: Detection[] = [
      ...drifting,
      { id: "x0", tripId: "t", frameId: "f0", t: 0, label: "dog",
        confidence: 0.9, bbox: [0.8, 0.8, 0.1, 0.1], source: "onboard" },
      { id: "x1", tripId: "t", frameId: "f1", t: 0.1, label: "dog",
        confidence: 0.9, bbox: [0.8, 0.8, 0.1, 0.1], source: "onboard" },
    ];
    const filtered = assignTracks(flicker, { minHits: 3 });
    check("a two-frame flicker is dropped even at high confidence",
      filtered.every((d) => d.label !== "dog"),
      `${filtered.filter((d) => d.label === "dog").length} survived`);
    check("...and the real track is untouched",
      filtered.filter((d) => d.label === "bottle").length === 10);

    // THE REGRESSION THIS FIXES. Detections used to arrive with a unique trackId
    // each, so every track had one hit and collapseToSightings — which needs
    // three — could never produce a single sighting from live output.
    const keyframes = [
      { id: "kf0", t: 0.2, placeholderSeed: 1, width: 640, height: 400 },
      { id: "kf1", t: 0.7, placeholderSeed: 2, width: 640, height: 400 },
    ];
    check("tracked detections actually collapse into a sighting",
      collapseToSightings(tracked, keyframes).length === 1,
      `${collapseToSightings(tracked, keyframes).length}`);
    check("untracked detections do not (the old behaviour)",
      collapseToSightings(drifting.map((d, i) => ({ ...d, trackId: `one_per_det_${i}` })), keyframes)
        .length === 0);
  }

  section("Best angle");
  {
    // A well-framed subject vs a bigger, more confident, clipped one. Confidence
    // alone picks the second; view quality must pick the first.
    const wellFramed = scoreView([0.35, 0.3, 0.3, 0.45], "person", 0.72, 0);
    const clippedCloseUp = scoreView([0.0, 0.0, 0.7, 1.0], "person", 0.97, 0);
    check(
      "a clean mid-frame look beats a clipped, closer, MORE confident one",
      wellFramed.score > clippedCloseUp.score,
      `${wellFramed.score.toFixed(3)} vs ${clippedCloseUp.score.toFixed(3)}`,
    );
    check("...and the clipped one is diagnosed as clipped",
      clippedCloseUp.weakest === "wholeness", clippedCloseUp.weakest);
    check("...naming the edges it is cut at",
      clippedCloseUp.critique.includes("left") && clippedCloseUp.critique.includes("top"),
      clippedCloseUp.critique);

    check("every term stays in 0..1", (Object.values(wellFramed.terms) as number[])
      .every((v) => v >= 0 && v <= 1));
    check("the score stays in 0..1", wellFramed.score >= 0 && wellFramed.score <= 1);

    // Symmetry in log space: half the ideal area and twice it score alike.
    const half = scoreView([0.4, 0.4, 0.3, 0.3], "frisbee", 0.8, 0).terms.framing;
    const double = scoreView([0.25, 0.25, 0.6, 0.6], "frisbee", 0.8, 0).terms.framing;
    check("framing is symmetric about the ideal in log space",
      Math.abs(half - double) < 0.12, `${half.toFixed(3)} vs ${double.toFixed(3)}`);

    // A tiny speck carries no detail and must not win on being well-centred.
    const speck = scoreView([0.49, 0.49, 0.02, 0.02], "bottle", 0.9, 0);
    check("a distant speck scores below a properly framed subject",
      speck.score < wellFramed.score, `${speck.score.toFixed(3)}`);
    check("...and says the robot is too far away",
      speck.critique.includes("too far away"), speck.critique);

    // The class-shape prior: a bottle three times wider than tall is not a view
    // of a bottle worth keeping.
    const uprightBottle = scoreView([0.45, 0.4, 0.05, 0.14], "bottle", 0.8, 0).terms.aspect;
    const flatBottle = scoreView([0.4, 0.45, 0.2, 0.05], "bottle", 0.8, 0).terms.aspect;
    check("an upright bottle beats a flat one on silhouette",
      uprightBottle > flatBottle, `${uprightBottle.toFixed(3)} vs ${flatBottle.toFixed(3)}`);

    // Motion blur, straight from odometry — no pixels involved.
    const movingPath: TrackPoint[] = [{ t: 0, pos: [0, 0], heading: 0, speed: 1.6 }];
    const stillPath: TrackPoint[] = [{ t: 0, pos: [0, 0], heading: 0, speed: 0 }];
    check("a look taken at speed loses to the same look taken stopped",
      scoreView([0.35, 0.3, 0.3, 0.45], "person", 0.72, 0, { path: stillPath }).score >
        scoreView([0.35, 0.3, 0.3, 0.45], "person", 0.72, 0, { path: movingPath }).score);
  }

  section("The pose the robot drives to");
  {
    const view = scoreView([0.35, 0.3, 0.3, 0.45], "person", 0.8, 0);
    const vp = bestViewpoint({
      objectPos: [10, 0],
      observerPos: [0, 0],
      t: 42,
      view,
      bbox: [0.35, 0.3, 0.3, 0.45],
      depthM: 4,
    });

    const standoff = Math.hypot(vp.pos[0] - 10, vp.pos[1] - 0);
    check("the pose stands OFF the object rather than on it", standoff > 1,
      `${standoff.toFixed(2)} m away`);
    check("...at the reported distance", Math.abs(standoff - vp.distanceM) < 0.02,
      `${standoff.toFixed(2)} vs ${vp.distanceM}`);
    check("...on the side the good look came from", vp.pos[0] < 10,
      `x ${vp.pos[0]}`);

    // The heading must actually face the object from where it puts you.
    const bearing =
      ((Math.atan2(10 - vp.pos[0], 0 - vp.pos[1]) * 180) / Math.PI + 360) % 360;
    check("the heading faces the object from that pose",
      Math.abs(((bearing - vp.heading + 540) % 360) - 180) < 1,
      `bearing ${bearing.toFixed(1)}° vs heading ${vp.heading}°`);
    check("heading is a degree bearing in 0–360", vp.heading >= 0 && vp.heading < 360);
    check("it carries the time of the look it reproduces", vp.approachFromT === 42);
    check("it explains itself", vp.why.length > 10, vp.why);

    // Degenerate input must not produce NaN and steer the robot nowhere.
    const degenerate = bestViewpoint({
      objectPos: [3, 3], observerPos: [3, 3], t: 0, view, bbox: [0.35, 0.3, 0.3, 0.45],
    });
    check("a robot standing on the object still yields a finite pose",
      Number.isFinite(degenerate.pos[0]) && Number.isFinite(degenerate.pos[1]) &&
        Number.isFinite(degenerate.heading));
  }

  section("Best angle, on the real trip");
  {
    const { trip } = buildTrip(waterlooPark);
    const scored = trip.moments.flatMap((m) => m.objects);
    check("every sighting carries a view score", scored.every((o) => o.viewScore !== undefined));
    check("view scores are in 0..1",
      scored.every((o) => (o.viewScore ?? -1) >= 0 && (o.viewScore ?? 2) <= 1));
    check("every sighting records when its best look happened",
      scored.every((o) => o.bestT !== undefined));
    check("the best look falls inside the sighting's own span",
      scored.every((o) => (o.bestT ?? -1) >= o.firstSeenT - 0.01 && (o.bestT ?? -1) <= o.lastSeenT + 0.01));

    // The point of the change: the best VIEW is frequently not the most
    // confident frame. If these never disagreed, the scoring would be redundant.
    const index = buildObjectIndex(trip.moments, trip.path, trip);
    const withNav = index.filter((e) => e.navTarget);
    check("nav targets carry a standoff distance",
      withNav.every((e) => (e.navTarget?.distanceM ?? 0) > 0));
    check("nav targets never park the robot inside the object",
      withNav.every((e) => (e.navTarget?.distanceM ?? 0) >= 1.2));
    check("nav targets explain themselves", withNav.every((e) => !!e.navTarget?.why));
    check("nav targets carry the view score they reproduce",
      withNav.every((e) => e.navTarget?.viewScore !== undefined));
  }
}

/**
 * Capture coverage — the browser port of the iOS scan feedback.
 *
 * The load-bearing claim is that this measures the SAME thing the native app
 * measures (distinct azimuths a surface has been seen from) rather than a proxy
 * for it. The two assertions that prove it are "pan in place gains exactly one
 * bucket" and "orbit gains all twelve" — if those ever diverge, the overlay has
 * gone back to rewarding attention instead of parallax, which is the bug this
 * whole module was written to kill.
 *
 * lib/coverage.ts and lib/tracking.ts are DOM-free precisely so this can run
 * here, with no browser and no camera.
 */
function verifyCoverage() {
  const W = 192;
  const H = 144;
  const proj: Projection = {
    focal: focalFor(W, H, W, H),
    width: W,
    height: H,
    screenAngle: 0,
  };
  const unit = (v: Vec3): Vec3 => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const towards = (from: Vec3, to: Vec3): Vec3 =>
    unit([to[0] - from[0], to[1] - from[1], to[2] - from[2]]);
  /** Camera at `from` looking at `to`, upright, no roll. See cameraDirection. */
  const lookAt = (from: Vec3, to: Vec3) => {
    const d = towards(from, to);
    const yaw = (Math.atan2(d[0], d[1]) * 180) / Math.PI;
    // cameraDirection yields yaw = −alpha for an upright phone, so this aims it.
    return cameraDirection(-yaw, 90, 0)!;
  };
  /** Bucket a world point as seen from a camera pose, or null if out of frame. */
  const bucketOf = (R: Parameters<typeof projectToScreen>[0], dir: Vec3) => {
    const px = projectToScreen(R, dir, proj);
    if (!px || px.x < 0 || px.x >= W || px.y < 0 || px.y >= H) return null;
    const b = bearingOfPixel(R, px.x, px.y, proj);
    return b ? surfaceAzimuthBucket(b.azDeg) : null;
  };

  section("Coverage — the maths that replaces LiDAR");
  {
    // The inverse is new code and everything downstream trusts it.
    const look = cameraDirection(37, 74, 21)!;
    const d = unit([0.3, 0.9, 0.15]);
    const px = projectToScreen(look.R, d, proj)!;
    const back = bearingOfPixel(look.R, px.x, px.y, proj)!;
    const az = (Math.atan2(d[0], d[1]) * 180) / Math.PI;
    const el = (Math.asin(d[2]) * 180) / Math.PI;
    check(
      "bearingOfPixel inverts projectToScreen",
      Math.abs(((back.azDeg - az + 540) % 360) - 180) < 0.01 &&
        Math.abs(back.elDeg - el) < 0.01,
      `${back.azDeg.toFixed(2)}/${((az % 360) + 360) % 360} · ${back.elDeg.toFixed(2)}/${el.toFixed(2)}`,
    );

    // iOS buckets surface → camera, the reverse of the ray we cast.
    check("a ray due north buckets as seen-from-the-south", surfaceAzimuthBucket(0) === 6);
    check("a ray due south buckets as seen-from-the-north", surfaceAzimuthBucket(180) === 0);
  }

  section("Coverage — pan versus orbit, the whole point");
  {
    // Camera pinned at the origin, sweeping. A fixed surface keeps a fixed
    // bearing from a fixed camera, so no amount of turning adds an angle.
    const pan = new BucketCoverage();
    const P: Vec3 = [3, 4, 0.5];
    let panSamples = 0;
    for (let a = 0; a < 360; a += 3) {
      const look = cameraDirection(a, 90, 0)!;
      const b = bucketOf(look.R, unit(P));
      if (b === null) continue;
      panSamples++;
      pan.observe(1, b);
    }
    check("panning actually sees the point", panSamples > 5, `${panSamples} samples`);
    check("pan in place gains exactly ONE bucket", popcount(pan.mask(1)) === 1,
      `${popcount(pan.mask(1))} buckets`);
    check("pan in place greens nothing", pan.fraction === 0);

    // Same surface, camera walking a circle round it.
    const orbit = new BucketCoverage();
    const target: Vec3 = [0, 0, 0];
    for (let t = 0; t < 360; t += 5) {
      const r = (t * Math.PI) / 180;
      const C: Vec3 = [3 * Math.sin(r), 3 * Math.cos(r), 0];
      const look = lookAt(C, target);
      const b = bucketOf(look.R, towards(C, target));
      if (b !== null) orbit.observe(1, b);
    }
    check("orbiting gains all TWELVE buckets", popcount(orbit.mask(1)) === 12,
      `${popcount(orbit.mask(1))} buckets`);
    check("orbiting greens it", orbit.fraction === 1);

    // Walking straight at something barely changes its bearing; things passing
    // at the side sweep through many. Both are correct, and the second is why
    // side-stepping is the advice the UI gives on a walk.
    const walk = new BucketCoverage();
    const ahead: Vec3 = [0, 30, 0];
    const beside: Vec3 = [3, 7, 0];
    for (let y = 0; y <= 12; y += 0.25) {
      const C: Vec3 = [0, y, 0];
      const look = cameraDirection(0, 90, 0)!; // facing north the whole way
      const a = bucketOf(look.R, towards(C, ahead));
      if (a !== null) walk.observe(1, a);
      const s = bucketOf(look.R, towards(C, beside));
      if (s !== null) walk.observe(2, s);
    }
    check("walking straight at a thing leaves it red", walk.level(1) < 1,
      `${popcount(walk.mask(1))} buckets`);
    check("things passing at the side gain more angles",
      popcount(walk.mask(2)) > popcount(walk.mask(1)),
      `${popcount(walk.mask(2))} vs ${popcount(walk.mask(1))}`);
  }

  section("Coverage — the accumulator, ported from KeyframeCoverage");
  {
    const c = new BucketCoverage();
    let crossings = 0;
    for (let b = 0; b < 12; b++) if (c.observe(9, b)) crossings++;
    check("the crossing edge fires exactly once", crossings === 1);
    check("five of twelve is green", c.level(9) === 1);

    const partial = new BucketCoverage();
    for (const b of [0, 3, 6]) partial.observe(7, b);
    check("three of twelve is not green", partial.level(7) === 3 / 5);
    check("fraction counts only what was observed", partial.cellCount === 1 && partial.fraction === 0);
    check("unionMask is the angle budget", popcount(partial.unionMask) === 3);

    // Banking a dead track into a direction, then seeding a new one from it.
    const memory = new BucketCoverage();
    memory.merge(42, partial.mask(7));
    const revived = new BucketCoverage();
    revived.merge(1, memory.mask(42));
    check("a revisited direction does not start from zero", popcount(revived.mask(1)) === 3);

    // Ported verbatim from CaptureView.swift:350.
    check("colorRamp: 0 is red", JSON.stringify(colorRamp(0)) === JSON.stringify({ r: 255, g: 0, b: 0 }));
    check("colorRamp: 0.5 is yellow", JSON.stringify(colorRamp(0.5)) === JSON.stringify({ r: 255, g: 255, b: 0 }));
    check("colorRamp: 1 is green", JSON.stringify(colorRamp(1)) === JSON.stringify({ r: 0, g: 255, b: 0 }));

    // Waterloo to Toronto, ~93 km.
    const d = metresBetween({ lat: 43.4643, lng: -80.5204 }, { lat: 43.6532, lng: -79.3832 });
    check("metresBetween is right to a per cent", d > 92_000 && d < 95_000, `${Math.round(d)} m`);
  }

  section("Coverage — the tracker that replaces depth");
  {
    const W2 = 96;
    const H2 = 96;
    // Deterministic texture: a seeded LCG, so a failure here is reproducible.
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const noise = new Uint8ClampedArray(W2 * H2 * 4);
    for (let i = 0; i < W2 * H2; i++) {
      const v = Math.floor(rnd() * 256);
      noise[i * 4] = noise[i * 4 + 1] = noise[i * 4 + 2] = v;
      noise[i * 4 + 3] = 255;
    }
    const shifted = (dx: number, dy: number) => {
      const out = new Uint8ClampedArray(W2 * H2 * 4);
      for (let y = 0; y < H2; y++) {
        for (let x = 0; x < W2; x++) {
          const sx = Math.min(W2 - 1, Math.max(0, x - dx));
          const sy = Math.min(H2 - 1, Math.max(0, y - dy));
          const o = (y * W2 + x) * 4;
          const i = (sy * W2 + sx) * 4;
          out[o] = noise[i];
          out[o + 1] = noise[i + 1];
          out[o + 2] = noise[i + 2];
          out[o + 3] = 255;
        }
      }
      return out;
    };

    const t = new PointTracker();
    const first = t.update(toGray(noise, W2, H2));
    check("the tracker seeds points on texture", first.points.length > 20,
      `${first.points.length} points`);

    const was = new Map(first.points.map((p) => [p.id, { x: p.x, y: p.y }]));
    const DX = 3;
    const DY = -2;
    const next = t.update(toGray(shifted(DX, DY), W2, H2));
    const moved = next.points
      .map((p) => ({ p, w: was.get(p.id) }))
      .filter((m): m is { p: typeof m.p; w: { x: number; y: number } } => !!m.w);
    check("most points survive a small shift", moved.length > first.points.length * 0.6,
      `${moved.length} of ${first.points.length}`);
    check("the recovered shift is the real one",
      moved.length > 0 && moved.every((m) => m.p.x - m.w.x === DX && m.p.y - m.w.y === DY),
      `${moved.filter((m) => m.p.x - m.w.x === DX && m.p.y - m.w.y === DY).length}/${moved.length} exact`);
    check("median flow reports the displacement",
      Math.abs(next.medianFlow - Math.hypot(DX, DY)) < 0.6,
      `${next.medianFlow.toFixed(2)} vs ${Math.hypot(DX, DY).toFixed(2)}`);

    // A featureless frame must produce no points at all, or the overlay would
    // paint confident colour over blank sky.
    const flat = new PointTracker();
    const blank = new Uint8ClampedArray(W2 * H2 * 4).fill(255);
    flat.update(toGray(blank, W2, H2));
    const flatUpd = flat.update(toGray(blank, W2, H2));
    check("a featureless frame seeds nothing", flatUpd.points.length === 0,
      `${flatUpd.points.length} points`);

    // An unrelated frame is not a match, and must be dropped rather than
    // silently reported as enormous motion.
    const cut = new PointTracker();
    cut.update(toGray(noise, W2, H2));
    seed = 999;
    const other = new Uint8ClampedArray(W2 * H2 * 4);
    for (let i = 0; i < W2 * H2; i++) {
      const v = Math.floor(rnd() * 256);
      other[i * 4] = other[i * 4 + 1] = other[i * 4 + 2] = v;
      other[i * 4 + 3] = 255;
    }
    const cutUpd = cut.update(toGray(other, W2, H2));
    check("an unrelated frame loses its tracks", cutUpd.lost.length > 0,
      `${cutUpd.lost.length} dropped`);
  }

  // What the browser puts on the wire for live reconstruction. The socket half
  // needs a running capture server, but these two decide whether a studio gets
  // a usable frame or a confident lie — so they are asserted here.
  section("Live reconstruction — the frame metadata");
  {
    const T = transformFromRotation([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    check("the camera transform is 4×4", T.length === 4 && T.every((r) => r.length === 4));
    check("the real rotation is carried through", T[0][0] === 1 && T[2][2] === 9);
    // The one that matters. A browser cannot know where the camera IS, and a
    // plausible-looking translation would train a confident, wrong scene — so
    // it must be exactly zero and flagged, never guessed.
    check("translation is zero, never invented",
      T[0][3] === 0 && T[1][3] === 0 && T[2][3] === 0 && T[3][3] === 1);

    const K = intrinsicsFor(640, 480);
    check("intrinsics centre on the image", K[0][2] === 320 && K[1][2] === 240);
    check("square pixels", K[0][0] === K[1][1]);
    check("focal is plausible for a phone lens", K[0][0] > 300 && K[0][0] < 1200,
      K[0][0].toFixed(1));

    // Portrait frames must not get a focal derived from the short side.
    const portrait = intrinsicsFor(480, 640);
    check("focal comes off the long side either way", portrait[0][0] === K[0][0]);
  }

  // What decides whether a machine is offered in-browser reconstruction. The
  // probe itself needs a GPU, but the policy is pure — and the policy is where
  // the damage happens, because it is what tells someone their machine cannot
  // do a thing it can.
  section("GPU tiering — capability gates, speed only budgets");
  {
    const capable = {
      software: false,
      computeVerified: true,
      float32Blendable: true,
      maxStorageBindingBytes: 2 * 1024 * 1024 * 1024,
    };

    // The reference machine: an Intel Iris Xe, integrated, no dedicated VRAM.
    // It must be OFFERED. Refusing it was the original bug.
    check("the reference integrated GPU is offered",
      tierFor({ ...capable, score: REFERENCE_SCORE }) === "weak");

    // THE REGRESSION GUARD. That same machine measured 15,884 and 58,356 on
    // consecutive runs under load. Neither may be refused — a thermal dip is
    // not a hardware limitation.
    for (const observed of [15_884, 58_356, 88_012, 109_565]) {
      check(`a ${observed} reading is still offered`,
        tierFor({ ...capable, score: observed }) !== "none");
    }
    check("even an absurdly slow reading is offered, just smaller",
      tierFor({ ...capable, score: 1 }) === "weak");

    // Capability, by contrast, IS allowed to say no.
    check("a software rasteriser is refused",
      tierFor({ ...capable, software: true, score: 1e9 }) === "none");
    check("a driver that failed the arithmetic is refused",
      tierFor({ ...capable, computeVerified: false, score: 1e9 }) === "none");
    check("no float32 blending is refused",
      tierFor({ ...capable, float32Blendable: false, score: 1e9 }) === "none");
    check("too small a storage buffer is refused",
      tierFor({ ...capable, maxStorageBindingBytes: 64 * 1024 * 1024, score: 1e9 }) === "none");

    // Faster hardware earns a bigger budget, monotonically.
    const tiers = [1e3, 3e5, 1e6].map((s) => tierFor({ ...capable, score: s }));
    check("faster hardware tiers up", JSON.stringify(tiers) === '["weak","modest","strong"]',
      tiers.join(","));
    const budgets = tiers.map((t) => budgetFor(t));
    check("budgets grow with the tier",
      budgets[0].totalSteps < budgets[1].totalSteps &&
      budgets[1].totalSteps < budgets[2].totalSteps);
    check("a refused machine gets a zero budget",
      budgetFor("none").totalSteps === 0 && budgetFor("none").maxSplats === 0);
    check("every offered tier can actually hold splats",
      budgets.every((b) => b.maxSplats > 0 && b.maxResolution > 0));
  }

  // Filing a walk under an album is the step that turns captures into a
  // collection, and the globe groups by it — so a mistake here is a pin in the
  // wrong place or a count that overstates what is behind it.
  section("Albums");
  {
    __resetAlbums();
    check("nothing is filed to begin with", listAlbums().length === 0);

    const made = createAlbum({ title: "  Autumn   in Waterloo  ", journeyId: "trip_a" });
    check("an album is created", made.ok === true);
    if (!made.ok) return;
    check("the title is trimmed and collapsed", made.album.title === "Autumn in Waterloo",
      JSON.stringify(made.album.title));
    check("its first walk is filed with it", made.album.journeyIds.length === 1);
    check("the first walk becomes the cover", made.album.coverJourneyId === "trip_a");

    check("whitespace alone is not a title",
      createAlbum({ title: "   " }).ok === false);
    check("a title is capped", (() => {
      const long = createAlbum({ title: "x".repeat(500) });
      return long.ok && long.album.title.length === MAX_TITLE;
    })());

    // Newest first, so the album reads as a stack rather than a queue.
    addToAlbum(made.album.id, "trip_b");
    check("later walks go on top",
      JSON.stringify(getAlbum(made.album.id)!.journeyIds) === '["trip_b","trip_a"]');
    check("the cover does not move on its own",
      getAlbum(made.album.id)!.coverJourneyId === "trip_a");

    check("adding the same walk twice does not duplicate it", (() => {
      addToAlbum(made.album.id, "trip_b");
      return getAlbum(made.album.id)!.journeyIds.length === 2;
    })());

    // A walk lives in one album, and re-filing MOVES it rather than erroring.
    const second = createAlbum({ title: "Winter" });
    check("a second album is created", second.ok === true);
    if (!second.ok) return;
    addToAlbum(second.album.id, "trip_b");
    check("re-filing moves rather than copies",
      getAlbum(made.album.id)!.journeyIds.length === 1 &&
      getAlbum(second.album.id)!.journeyIds.length === 1);
    check("the lookup follows the move",
      albumForJourney("trip_b")?.id === second.album.id);

    // The hazard: uploadedTrips evicts past MAX_WALKS, and an album naming a
    // dead walk would pin the globe to nothing.
    forgetJourney("trip_a");
    check("an evicted walk is forgotten by its album",
      getAlbum(made.album.id)!.journeyIds.length === 0);
    check("and the album survives it", !!getAlbum(made.album.id));
    check("the cover falls back rather than dangling",
      getAlbum(made.album.id)!.coverJourneyId === null);

    check("deleting an album releases its walks", (() => {
      deleteAlbum(second.album.id);
      return albumForJourney("trip_b") === null && getAlbum(second.album.id) === null;
    })());

    __resetAlbums();
  }
}

verifyWaterlooPark();
verifyEveryTrip();
verifyGeoAndGlobalIndex();
verifyGlobe();
verifyLiveTrip();
verifyDetectionQuality();
verifyCoverage();

console.log(
  failures === 0
    ? "\nAll invariants hold.\n"
    : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
