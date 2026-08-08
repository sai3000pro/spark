/**
 * Invariant checks over the mock trip.
 *
 * The whole pitch rests on the three timeline lanes agreeing with each other:
 * every promoted moment traces back to a candidate, and every candidate traces
 * back to detections inside its window. If that breaks, the demo is a lie — so
 * it gets asserted rather than eyeballed.
 *
 *   npm run verify
 */
import { buildTrip } from "../lib/mock/trip-waterloo-park";
import { buildObjectIndex, searchObjects } from "../lib/objectIndex";
import { computeTripStats, PIPELINE_CONFIG } from "../lib/pipeline";

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

const { trip, distanceM } = buildTrip();
const stats = computeTripStats(trip, distanceM);
const index = buildObjectIndex(trip.moments, trip.path);

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

console.log(
  failures === 0
    ? "\nAll invariants hold.\n"
    : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
