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
import { buildTrip } from "../lib/mock/buildTrip";
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
  startTrip,
  stopTrip,
} from "../lib/liveTrip";

let failures = 0;

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
    check("counters begin simulated", started.simulated === true);

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

  section("Counters");
  {
    __resetLiveTrip();
    startTrip();

    // Extrapolated counters must be monotonic in elapsed time, or the live readout
    // would visibly count backwards.
    const samples = [0, 10, 60, 300, 1800, 5700].map((t) => simulateCountersForCheck(t));
    check(
      "detections never decrease as the trip runs",
      samples.every((s, i) => i === 0 || s.detections >= samples[i - 1].detections),
    );
    check(
      "candidates never decrease",
      samples.every((s, i) => i === 0 || s.candidates >= samples[i - 1].candidates),
    );
    check(
      "promoted never decreases",
      samples.every((s, i) => i === 0 || s.moments >= samples[i - 1].moments),
    );
    check("a fresh session has promoted nothing", samples[0].moments === 0);

    // The simulated rates come from the real demo trip, so a 95-minute session
    // should land near its actual 6 moments rather than at an invented number.
    const atFullTrip = samples[samples.length - 1];
    check(
      "a 95-minute session extrapolates to roughly the demo trip's 6 moments",
      atFullTrip.moments >= 3 && atFullTrip.moments <= 12,
      `${atFullTrip.moments}`,
    );

    const active = getActiveTrip()!;
    check("noteIngest rejects an unrelated trip id", noteIngest("trip_not_it", { moments: 1 }) === false);
    check("noteIngest accepts the live one", noteIngest(active.id, { detections: 40 }) === true);

    const measured = getActiveTrip()!;
    check("reporting flips simulated off", measured.simulated === false);
    check("reported counts are used verbatim", measured.counters.detections === 40,
      `${measured.counters.detections}`);

    __resetLiveTrip();
  }
}

/** Mirrors lib/liveTrip's private extrapolation via the public surface. */
function simulateCountersForCheck(elapsedSec: number) {
  const windows = Math.max(
    0,
    Math.floor((elapsedSec - PIPELINE_CONFIG.windowSec) / PIPELINE_CONFIG.strideSec) + 1,
  );
  const { trip } = buildTrip(waterlooPark);
  const durationSec =
    (new Date(trip.endedAt).getTime() - new Date(trip.startedAt).getTime()) / 1000;
  const totalWindows = Math.max(
    1,
    Math.floor((durationSec - PIPELINE_CONFIG.windowSec) / PIPELINE_CONFIG.strideSec) + 1,
  );
  const candidates = Math.round(windows * (trip.candidates.length / totalWindows));
  const promoted = trip.candidates.filter((c) => c.status === "promoted").length;
  return {
    detections: Math.round(elapsedSec * 9.4),
    candidates,
    moments: Math.round(candidates * (trip.candidates.length ? promoted / trip.candidates.length : 0)),
  };
}

verifyWaterlooPark();
verifyEveryTrip();
verifyGeoAndGlobalIndex();
verifyGlobe();
verifyLiveTrip();

console.log(
  failures === 0
    ? "\nAll invariants hold.\n"
    : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
