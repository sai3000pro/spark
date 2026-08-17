/**
 * Invariant checks over the journey layer.
 *
 *   npm run verify:journey
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS BEING PROTECTED
 *
 * lib/journey/clips.ts opens with one rule — MEASURED AND ASSUMED ARE NEVER THE
 * SAME FIELD — and every module under it is arranged around not breaking it. The
 * failures that rule exists to prevent are all silent: a pin extrapolated past
 * the last fix renders exactly like a satellite fix, a filename sort dressed up
 * as a chronology reads exactly like a clock, and an interpolated point folded
 * into `totalMetres` turns an estimate into a measurement without anybody
 * noticing. None of those throw, none of them look wrong on a screen, and none
 * of them can be caught by typechecking. So they are asserted here.
 *
 * Seven sections, and the split matters:
 *
 *   1. Ordering — which signal was used, and whether the route admits to it.
 *   2. Positions — the crux. Interpolate between, never past the ends.
 *   3. Legs, distance and warnings — the arithmetic and the nine warning codes,
 *      each of which is asserted to fire when it should AND to stay quiet when
 *      it should not. A warning that always fires is noise; one that never does
 *      is a check nobody wrote.
 *   4. Corrections — the layer over the route, and the four ways it composes.
 *   5. The container parser, off hand-built ISO-BMFF buffers.
 *   6. Edges — nothing, one, and fifty of the same thing.
 *   7. The journey store.
 *
 * Runs under tsx, NOT under Next. Nothing reachable from here may import next/*
 * or server-only — the same constraint verify-pipeline.ts works under, and the
 * reason lib/journey/route.ts and corrections.ts are pure.
 *
 * Deterministic by construction: fixed ISO timestamps, fixed coordinates, no
 * `Date.now()` and no `Math.random()` anywhere below. A failure here is
 * reproducible on any machine in any timezone.
 */
import {
  NO_CORRECTIONS,
  epochOf,
  metresApart,
  type ClipCorrection,
  type ClipFacts,
  type DerivedRoute,
  type RouteCorrections,
  type RouteWarning,
} from "../lib/journey/clips";
import { deriveRoute } from "../lib/journey/route";
import {
  addCorrection,
  applyCorrections,
  clearFor,
  correctionsFor,
  describeCorrection,
  parseCorrections,
} from "../lib/journey/corrections";
import { factsFromContainer } from "../lib/journey/clientMetadata";
import type { GeoPoint } from "../lib/types";

let failures = 0;
let skipped = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** A check that could not be run. Never prints `ok`, and says why out loud. */
function skip(label: string, why: string) {
  skipped++;
  console.log(`  skip ${label} — ${why}`);
}

function section(name: string) {
  console.log(`\n${name}`);
}

function heading(name: string) {
  console.log(`\n${"═".repeat(72)}\n${name}\n${"═".repeat(72)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures. Fixed strings and fixed coordinates, never a clock and never a die.
// ─────────────────────────────────────────────────────────────────────────────

const T0 = "2026-08-15T12:00:00.000Z";

/** `T0 + n seconds`, as an ISO string. Parses a literal; reads no clock. */
const plus = (iso: string, seconds: number): string =>
  new Date(Date.parse(iso) + seconds * 1000).toISOString();

const clip = (over: Partial<ClipFacts> & { id: string }): ClipFacts => ({
  name: `${over.id}.mov`,
  bytes: 64 * 1024,
  recordedAt: null,
  utcOffsetMin: null,
  location: null,
  altitudeM: null,
  device: null,
  durationSec: null,
  fileModifiedAt: null,
  ...over,
});

const COURTYARD: GeoPoint = { lat: 43.4643, lng: -80.5204 };
const FOUNTAIN: GeoPoint = { lat: 43.4652, lng: -80.5188 };

/**
 * A point `m` metres due north, on the same sphere `metresApart` uses.
 *
 * Written in terms of the same mean radius so a fixture can say "one kilometre"
 * and mean it to the millimetre; the radius itself is checked against published
 * values in section 3 rather than taken on trust.
 */
const north = (from: GeoPoint, m: number): GeoPoint => ({
  lat: from.lat + (m / 6_371_008.8) * (180 / Math.PI),
  lng: from.lng,
});

const ids = (r: DerivedRoute) => r.clips.map((c) => c.facts.id);
const names = (r: DerivedRoute) => r.clips.map((c) => c.facts.name);
const has = (r: DerivedRoute, code: RouteWarning["code"]) =>
  r.warnings.some((w) => w.code === code);
const warningOf = (r: DerivedRoute, code: RouteWarning["code"]) =>
  r.warnings.find((w) => w.code === code) ?? null;
const clipOf = (r: DerivedRoute, id: string) =>
  r.clips.find((c) => c.facts.id === id) ?? null;
const ledgerHas = (r: DerivedRoute, fragment: string) =>
  r.assumptions.some((a) => a.includes(fragment));

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a === "number") return Number.isNaN(a) && Number.isNaN(b as number);
  if (a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
      return false;
    }
  }
  return true;
}

/** Any NaN or Infinity anywhere in the tree. The shape of "we divided by zero". */
function hasNonFinite(v: unknown): boolean {
  if (typeof v === "number") return !Number.isFinite(v);
  if (v === null || typeof v !== "object") return false;
  return Object.values(v as Record<string, unknown>).some(hasNonFinite);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Ordering — and saying what it rests on
// ─────────────────────────────────────────────────────────────────────────────

function verifyOrdering() {
  heading("Ordering — and saying out loud what it rests on");

  section("Real capture times win, and are the only basis that is trusted");
  {
    // Handed to us out of order on purpose: the input order is a signal of last
    // resort, and a real timestamp must outrank it.
    const r = deriveRoute([
      clip({ id: "c", recordedAt: plus(T0, 120) }),
      clip({ id: "a", recordedAt: plus(T0, 0) }),
      clip({ id: "d", recordedAt: plus(T0, 180) }),
      clip({ id: "b", recordedAt: plus(T0, 60) }),
    ]);
    check("shuffled capture times come back in time order",
      deepEqual(ids(r), ["a", "b", "c", "d"]), ids(r).join(", "));
    check("...and the basis is the timestamps", r.orderedBy === "recorded-at", r.orderedBy);
    check("a fully timed pile raises no order warning", !has(r, "order-guessed"));
    check("...and writes no ordering apology into the ledger",
      !ledgerHas(r, "order comes from") && !ledgerHas(r, "order they were handed"),
      r.assumptions.join(" | "));
    check("timed counts every clip", r.timed === 4, `${r.timed}`);
  }

  section("mtime orders, and the route says it is a guess");
  {
    // THE case this warning exists for. Copying clips off a phone rewrites the
    // mtime to the time of the copy, so this order is plausible and routinely
    // wrong — and a plausible wrong order that says nothing is the failure.
    const r = deriveRoute([
      clip({ id: "m2", fileModifiedAt: plus(T0, 200) }),
      clip({ id: "m0", fileModifiedAt: plus(T0, 0) }),
      clip({ id: "m1", fileModifiedAt: plus(T0, 100) }),
    ]);
    check("mtimes on every clip order the route", deepEqual(ids(r), ["m0", "m1", "m2"]),
      ids(r).join(", "));
    check("...and the basis is file-modified", r.orderedBy === "file-modified", r.orderedBy);
    check("...and it is NOT silently claimed as recorded-at", r.orderedBy !== "recorded-at");
    const w = warningOf(r, "order-guessed");
    check("an order-guessed warning fires", w !== null);
    check("...at warn severity, about the route rather than a clip",
      w?.severity === "warn" && w.clipIds.length === 0, `${w?.severity}`);
    check("...and says why an mtime is not a capture time",
      (w?.message ?? "").includes("copying clips off a phone rewrites"), w?.message);
    check("the ledger repeats it in prose",
      ledgerHas(r, "the order comes from each file's last-modified date"),
      r.assumptions.join(" | "));
    check("no capture time anywhere is reported as none", r.timed === 0, `${r.timed}`);
    check("...and an mtime never becomes a recordedAt",
      r.clips.every((c) => c.recordedAt === null && c.recordedAtSource === "missing"));
  }

  section("Filenames sort as numbers, not as text");
  {
    const r = deriveRoute([
      clip({ id: "two", name: "IMG_2.mov" }),
      clip({ id: "ten", name: "IMG_10.mov" }),
      clip({ id: "one", name: "IMG_1.mov" }),
    ]);
    check("IMG_2 / IMG_10 / IMG_1 come back 1, 2, 10",
      deepEqual(names(r), ["IMG_1.mov", "IMG_2.mov", "IMG_10.mov"]), names(r).join(", "));
    check("...which is NOT the lexical order 1, 10, 2",
      !deepEqual(names(r), ["IMG_1.mov", "IMG_10.mov", "IMG_2.mov"]));
    check("...and the basis is filename", r.orderedBy === "filename", r.orderedBy);
    check("...still warned about, because a counter is not a clock",
      warningOf(r, "order-guessed")?.message.includes("camera's convention") === true);
  }

  section("Words are not a chronology");
  {
    // The `filenamesLookNumbered` guard. Sorting `beach` before `castle` is the
    // alphabet, and presenting the alphabet as an order of events is exactly the
    // confident-wrong-answer this module refuses to give.
    const r = deriveRoute([
      clip({ id: "castle", name: "castle.mov" }),
      clip({ id: "beach", name: "beach.mov" }),
    ]);
    check("names with no digits are left in the order they arrived",
      deepEqual(ids(r), ["castle", "beach"]), ids(r).join(", "));
    check("...and the basis is as-given, never filename",
      r.orderedBy === "as-given", r.orderedBy);
    const w = warningOf(r, "order-guessed");
    check("...raised as a BLOCKER, because the whole route is a guess",
      w?.severity === "blocker", `${w?.severity}`);
    check("...and the ledger says every number below inherits it",
      ledgerHas(r, "Every distance and duration below inherits that guess"),
      r.assumptions.join(" | "));
  }

  section("Mixed timed and untimed — anchored, not re-sorted");
  {
    // u0 arrives before any timed clip; u3 follows t2. The timed pair sorts by
    // its clocks, and each untimed clip travels with the clip it followed.
    const r = deriveRoute([
      clip({ id: "u0" }),
      clip({ id: "t1", recordedAt: plus(T0, 3600) }),
      clip({ id: "t2", recordedAt: plus(T0, 0) }),
      clip({ id: "u3" }),
    ]);
    check("the timed clips sort and drag their untimed followers with them",
      deepEqual(ids(r), ["u0", "t2", "u3", "t1"]), ids(r).join(", "));
    check("an untimed clip before the first timed one stays at the FRONT",
      ids(r)[0] === "u0", ids(r)[0]);
    check("...and the basis is still the timestamps", r.orderedBy === "recorded-at", r.orderedBy);
    const w = warningOf(r, "order-guessed");
    check("the untimed clips are named in the warning",
      deepEqual(w?.clipIds, ["u0", "u3"]), (w?.clipIds ?? []).join(", "));
    check("...and the ledger explains the anchoring",
      ledgerHas(r, "left directly after the timed clip it followed"),
      r.assumptions.join(" | "));
    check("timed counts only the clips that had a clock", r.timed === 2, `${r.timed}`);
  }

  section("Half a pile of timestamps still beats a full pile of mtimes");
  {
    const half = deriveRoute([
      clip({ id: "a", recordedAt: plus(T0, 60), fileModifiedAt: plus(T0, 900) }),
      clip({ id: "b", fileModifiedAt: plus(T0, 100) }),
    ]);
    check("one real time out of two wins over two mtimes",
      half.orderedBy === "recorded-at", half.orderedBy);

    // Below half, a complete set of mtimes orders every clip on ONE basis, which
    // beats a signal present on a minority.
    const thin = deriveRoute([
      clip({ id: "a", fileModifiedAt: plus(T0, 0) }),
      clip({ id: "b", recordedAt: plus(T0, 500), fileModifiedAt: plus(T0, 10) }),
      clip({ id: "c", fileModifiedAt: plus(T0, 20) }),
      clip({ id: "d", fileModifiedAt: plus(T0, 30) }),
    ]);
    check("one real time out of four loses to a complete set of mtimes",
      thin.orderedBy === "file-modified", thin.orderedBy);
  }

  section("An unreadable timestamp is untimed, not guessed at");
  {
    const r = deriveRoute([
      clip({ id: "good", recordedAt: plus(T0, 0) }),
      clip({ id: "junk", recordedAt: "last tuesday" }),
    ]);
    check("a timestamp we cannot parse does not travel onward as a string",
      clipOf(r, "junk")?.recordedAt === null, `${clipOf(r, "junk")?.recordedAt}`);
    check("...and is sourced 'missing', never 'measured'",
      clipOf(r, "junk")?.recordedAtSource === "missing");
    check("...and does not count as timed", r.timed === 1, `${r.timed}`);
    check("...and the ledger names the file it could not read",
      ledgerHas(r, "carried a capture time we could not read"), r.assumptions.join(" | "));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Positions — the crux
// ─────────────────────────────────────────────────────────────────────────────

function verifyPositions() {
  heading("Positions — interpolate between, never past the ends");

  const A: GeoPoint = { lat: 43.0, lng: -80.0 };
  const C: GeoPoint = { lat: 43.4, lng: -80.8 };

  section("A hole between two fixes is filled, and marked as filled");
  {
    // All three clocks known: 45 s into a 60 s gap is three quarters of the way,
    // not halfway. Someone who filmed at 12:00 and 12:01 and has an untimed clip
    // at 12:00:45 was much nearer the second fix.
    const r = deriveRoute([
      clip({ id: "a", location: A, recordedAt: plus(T0, 0) }),
      clip({ id: "b", recordedAt: plus(T0, 45) }),
      clip({ id: "c", location: C, recordedAt: plus(T0, 60) }),
    ]);
    const b = clipOf(r, "b");
    check("the middle clip is placed", b?.location !== null);
    check("...as 'inferred', never 'measured'", b?.locationSource === "inferred",
      `${b?.locationSource}`);
    check("...time-weighted at 75% of the way, not at the midpoint",
      Math.abs((b?.location?.lat ?? 0) - 43.3) < 1e-12 &&
        Math.abs((b?.location?.lng ?? 0) - -80.6) < 1e-12,
      `${b?.location?.lat}, ${b?.location?.lng}`);
    check("...and it does land BETWEEN the two fixes",
      (b?.location?.lat ?? 0) > A.lat && (b?.location?.lat ?? 0) < C.lat);
    check("located counts the two MEASURED fixes, not the filled-in one",
      r.located === 2, `${r.located}`);
    check("the ledger admits the straight line",
      ledgerHas(r, "placed on the straight line between the nearest located clips"),
      r.assumptions.join(" | "));
  }

  section("...and evenly spaced when the clocks are not all there");
  {
    const r = deriveRoute([
      clip({ id: "a", location: A, recordedAt: plus(T0, 0) }),
      clip({ id: "b" }),
      clip({ id: "c", location: C, recordedAt: plus(T0, 60) }),
    ]);
    const b = clipOf(r, "b");
    check("an untimed middle clip lands at the midpoint",
      Math.abs((b?.location?.lat ?? 0) - 43.2) < 1e-12 &&
        Math.abs((b?.location?.lng ?? 0) - -80.4) < 1e-12,
      `${b?.location?.lat}, ${b?.location?.lng}`);
    check("...still marked inferred", b?.locationSource === "inferred");

    // With no clock anywhere the ledger must not claim a time weighting.
    const noClocks = deriveRoute([
      clip({ id: "a", name: "IMG_1.mov", location: A }),
      clip({ id: "b", name: "IMG_2.mov" }),
      clip({ id: "c", name: "IMG_3.mov", location: C }),
    ]);
    check("with no timestamps at all the ledger says 'spaced evenly'",
      ledgerHas(noClocks, "spaced evenly between them"), noClocks.assumptions.join(" | "));
    check("...and does not claim a time weighting it did not do",
      !ledgerHas(noClocks, "weighted by how much time had passed"));
  }

  section("NO EXTRAPOLATION — the bug that puts a confident wrong pin on a map");
  {
    const r = deriveRoute([
      clip({ id: "before", recordedAt: plus(T0, 0) }),
      clip({ id: "a", location: A, recordedAt: plus(T0, 60) }),
      clip({ id: "c", location: C, recordedAt: plus(T0, 120) }),
      clip({ id: "after", recordedAt: plus(T0, 180) }),
    ]);
    const before = clipOf(r, "before");
    const after = clipOf(r, "after");
    check("a clip BEFORE the first fix stays null", before?.location === null,
      JSON.stringify(before?.location));
    check("...and is sourced 'missing'", before?.locationSource === "missing",
      `${before?.locationSource}`);
    check("a clip AFTER the last fix stays null", after?.location === null,
      JSON.stringify(after?.location));
    check("...and is sourced 'missing'", after?.locationSource === "missing",
      `${after?.locationSource}`);
    check("nothing was inferred at all here",
      r.clips.every((c) => c.locationSource !== "inferred"));
    check("origin is the first MEASURED fix, not the first row",
      r.origin?.lat === A.lat && r.origin?.lng === A.lng, JSON.stringify(r.origin));
    check("located counts 2 of 4", r.located === 2, `${r.located}`);
    check("timed counts all 4", r.timed === 4, `${r.timed}`);

    const w = warningOf(r, "partial-locations");
    check("partial-locations names exactly the two unplaced clips",
      deepEqual(w?.clipIds, ["before", "after"]), (w?.clipIds ?? []).join(", "));
    check("...and counts interpolated and unplaceable separately",
      w?.message ===
        "2 of 4 clips carry a location — 0 positions interpolated between fixes and 2 clips could not be placed at all",
      w?.message);
    check("the ledger refuses to guess past the ends, in words",
      ledgerHas(r, "We do not guess past the ends of the located stretch"),
      r.assumptions.join(" | "));

    // The legs across the two holes are absent, not zero and not estimated.
    check("a leg into a hole has no distance",
      clipOf(r, "a")?.legMetres === null && after?.legMetres === null);
    check("totalMetres is the one measured leg",
      Math.abs(r.totalMetres - metresApart(A, C)) < 1e-9, `${r.totalMetres}`);
    check("...and the ledger says how many legs it skipped",
      ledgerHas(r, "The total distance skips 2 legs"), r.assumptions.join(" | "));
  }

  section("An inferred endpoint never lends its length to the total");
  {
    const r = deriveRoute([
      clip({ id: "a", location: A, recordedAt: plus(T0, 0) }),
      clip({ id: "b", recordedAt: plus(T0, 30) }),
      clip({ id: "c", location: C, recordedAt: plus(T0, 60) }),
    ]);
    check("both legs touch the inferred point, so the total is zero",
      r.totalMetres === 0, `${r.totalMetres}`);
    check("...even though both legs have a drawn length",
      clipOf(r, "b")?.legMetres !== null && clipOf(r, "c")?.legMetres !== null);
    check("...and the ledger says 2 legs were skipped",
      ledgerHas(r, "The total distance skips 2 legs"), r.assumptions.join(" | "));
    check("...so the total is described as a floor",
      ledgerHas(r, "a floor rather than the length of the walk"));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Legs, distance and every warning code
// ─────────────────────────────────────────────────────────────────────────────

function verifyLegsAndWarnings() {
  heading("Legs, distance and the nine warnings");

  section("metresApart against published numbers");
  {
    // Three values nobody here gets to choose. Haversine on a sphere of mean
    // radius is a small, KNOWN amount off each of them, and 0.5% is comfortably
    // inside that while being far tighter than any coding error survives.
    //
    //  · The WGS84 meridian quadrant, pole to equator, is 10,001,965.729 m —
    //    the historical definition of the metre (NIMA TR8350.2, WGS84 derived
    //    geometric constants).
    //  · One degree of longitude at the equator is 2π·a/360 with a = 6,378,137 m
    //    (WGS84 semi-major axis) = 111,319.4908 m.
    //  · One arc-minute of latitude is the international nautical mile,
    //    1852 m exactly (BIPM/IHO, 1929 Monaco definition).
    const within = (got: number, want: number) => Math.abs(got - want) / want < 0.005;

    const quadrant = metresApart({ lat: 90, lng: 0 }, { lat: 0, lng: 0 });
    check("pole to equator is 10,001,965.7 m to within 0.5%",
      within(quadrant, 10_001_965.729), `${quadrant.toFixed(0)} m`);

    const degLng = metresApart({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    check("one degree of longitude at the equator is 111,319.5 m to within 0.5%",
      within(degLng, 111_319.4908), `${degLng.toFixed(1)} m`);

    const nauticalMile = metresApart({ lat: 0, lng: 0 }, { lat: 1 / 60, lng: 0 });
    check("one arc-minute of latitude is a nautical mile (1852 m) to within 0.5%",
      within(nauticalMile, 1852), `${nauticalMile.toFixed(2)} m`);

    check("distance is symmetric",
      metresApart(COURTYARD, FOUNTAIN) === metresApart(FOUNTAIN, COURTYARD));
    check("the fixture helper really does mean metres",
      Math.abs(metresApart(COURTYARD, north(COURTYARD, 1000)) - 1000) < 0.01,
      `${metresApart(COURTYARD, north(COURTYARD, 1000)).toFixed(4)} m`);
  }

  section("Identical positions are zero, not NaN and not Infinity");
  {
    const r = deriveRoute([
      clip({ id: "a", location: COURTYARD, recordedAt: plus(T0, 0) }),
      clip({ id: "b", location: { ...COURTYARD }, recordedAt: plus(T0, 60) }),
    ]);
    const b = clipOf(r, "b");
    check("legMetres is exactly 0", b?.legMetres === 0, `${b?.legMetres}`);
    check("legSpeedMps is exactly 0", b?.legSpeedMps === 0, `${b?.legSpeedMps}`);
    check("...not null", b?.legSpeedMps !== null);
    check("nothing in the route is NaN or Infinity", !hasNonFinite(r));
    check("standing still is not an implausible speed", !has(r, "implausible-speed"));
  }

  section("legSeconds is start-to-start, not start-to-previous-end");
  {
    // The first clip runs for ten minutes and the second starts ten minutes
    // after it. Measuring to the previous clip's END would give 0 seconds here
    // and a division by zero; a longer first clip would give a negative gap.
    const r = deriveRoute([
      clip({ id: "a", location: COURTYARD, recordedAt: plus(T0, 0), durationSec: 600 }),
      clip({ id: "b", location: FOUNTAIN, recordedAt: plus(T0, 600), durationSec: 30 }),
    ]);
    const b = clipOf(r, "b");
    check("a 10-minute gap after a 10-minute clip is 600 seconds",
      b?.legSeconds === 600, `${b?.legSeconds}`);
    check("...which is not the 0 that start-to-end would give", b?.legSeconds !== 0);
    check("...and the speed divides by it", b?.legSpeedMps !== null &&
      Math.abs((b?.legSpeedMps ?? 0) - (b?.legMetres ?? 0) / 600) < 1e-12);
    check("the first clip has no leg at all",
      clipOf(r, "a")?.legSeconds === null && clipOf(r, "a")?.legMetres === null);
  }

  section("implausible-speed");
  {
    const fast = deriveRoute([
      clip({ id: "a", location: COURTYARD, recordedAt: plus(T0, 0) }),
      clip({ id: "b", location: north(COURTYARD, 1000), recordedAt: plus(T0, 2) }),
    ]);
    const w = warningOf(fast, "implausible-speed");
    check("1 km in 2 s trips implausible-speed", w !== null);
    check("...and names BOTH clips", deepEqual(w?.clipIds, ["a", "b"]),
      (w?.clipIds ?? []).join(", "));
    check("...at warn severity, so it caveats rather than blocks",
      w?.severity === "warn", `${w?.severity}`);
    check("...and quotes the speed", (w?.message ?? "").includes("500 m/s"), w?.message);

    const walked = deriveRoute([
      clip({ id: "a", location: COURTYARD, recordedAt: plus(T0, 0) }),
      clip({ id: "b", location: north(COURTYARD, 1000), recordedAt: plus(T0, 1200) }),
    ]);
    check("1 km in 20 minutes does not", !has(walked, "implausible-speed"));
    check("...and is about walking pace",
      Math.abs((clipOf(walked, "b")?.legSpeedMps ?? 0) - 1000 / 1200) < 1e-9,
      `${clipOf(walked, "b")?.legSpeedMps}`);
  }

  section("same-timestamp");
  {
    const dup = deriveRoute([
      clip({ id: "a", name: "one.mov", recordedAt: "2026-08-15T12:00:00.100Z" }),
      clip({ id: "b", name: "two.mov", recordedAt: "2026-08-15T12:00:00.900Z" }),
    ]);
    const w = warningOf(dup, "same-timestamp");
    check("two clips inside the same second are flagged", w !== null);
    check("...naming both", deepEqual(w?.clipIds, ["a", "b"]), (w?.clipIds ?? []).join(", "));
    check("...in prose a person can read",
      (w?.message ?? "").includes("one.mov and two.mov claim the same second"), w?.message);

    const apart = deriveRoute([
      clip({ id: "a", recordedAt: plus(T0, 0) }),
      clip({ id: "b", recordedAt: plus(T0, 1) }),
    ]);
    check("one second apart is not the same second", !has(apart, "same-timestamp"));
  }

  section("long-gap");
  {
    const gap = deriveRoute([
      clip({ id: "a", name: "morning.mov", recordedAt: plus(T0, 0) }),
      clip({ id: "b", name: "evening.mov", recordedAt: plus(T0, 7200) }),
    ]);
    const w = warningOf(gap, "long-gap");
    check("two hours between clips is a break in the journey", w !== null);
    check("...as a note, not a warning — a break is normal",
      w?.severity === "note", `${w?.severity}`);
    check("...phrased with the duration", (w?.message ?? "").includes("2h 0m"), w?.message);

    const short = deriveRoute([
      clip({ id: "a", recordedAt: plus(T0, 0) }),
      clip({ id: "b", recordedAt: plus(T0, 1800) }),
    ]);
    check("half an hour is not a break", !has(short, "long-gap"));
  }

  section("mixed-devices");
  {
    const two = deriveRoute([
      clip({ id: "a", device: "Apple iPhone 15 Pro", recordedAt: plus(T0, 0) }),
      clip({ id: "b", device: "Google Pixel 9", recordedAt: plus(T0, 60) }),
    ]);
    const w = warningOf(two, "mixed-devices");
    check("two cameras are noticed", w !== null);
    check("...as a note, because two people filming is normal",
      w?.severity === "note", `${w?.severity}`);
    check("...naming both cameras",
      (w?.message ?? "").includes("Apple iPhone 15 Pro and Google Pixel 9"), w?.message);

    const one = deriveRoute([
      clip({ id: "a", device: "Apple iPhone 15 Pro", recordedAt: plus(T0, 0) }),
      clip({ id: "b", device: "Apple iPhone 15 Pro", recordedAt: plus(T0, 60) }),
      clip({ id: "c", recordedAt: plus(T0, 120) }),
    ]);
    check("one camera plus a clip that did not say is not 'mixed'",
      !has(one, "mixed-devices"));
  }

  section("single-clip");
  {
    const solo = deriveRoute([clip({ id: "only", location: COURTYARD, recordedAt: T0 })]);
    const w = warningOf(solo, "single-clip");
    check("one clip says so", w !== null);
    check("...naming itself", deepEqual(w?.clipIds, ["only"]));
    check("...as a note", w?.severity === "note", `${w?.severity}`);
    check("one clip has no order to guess, so no order warning",
      !has(solo, "order-guessed"));
    check("two clips are not a single clip",
      !has(deriveRoute([clip({ id: "a" }), clip({ id: "b" })]), "single-clip"));
  }

  section("no-timestamps / no-locations / partial-locations");
  {
    const blind = deriveRoute([
      clip({ id: "a", name: "IMG_1.mov", location: COURTYARD }),
      clip({ id: "b", name: "IMG_2.mov", location: FOUNTAIN }),
    ]);
    check("no clocks anywhere fires no-timestamps", has(blind, "no-timestamps"));
    check("...and totalSeconds is null rather than 0", blind.totalSeconds === null,
      `${blind.totalSeconds}`);
    check("...and no-locations does NOT fire", !has(blind, "no-locations"));
    check("...nor partial-locations, since both are located",
      !has(blind, "partial-locations"));

    const mapless = deriveRoute([
      clip({ id: "a", recordedAt: plus(T0, 0) }),
      clip({ id: "b", recordedAt: plus(T0, 60) }),
    ]);
    check("no fixes anywhere fires no-locations", has(mapless, "no-locations"));
    check("...as a BLOCKER — an order without a map",
      warningOf(mapless, "no-locations")?.severity === "blocker");
    check("...and no-timestamps does NOT fire", !has(mapless, "no-timestamps"));
    check("...and partial-locations does NOT fire (none is not some)",
      !has(mapless, "partial-locations"));
    check("...and totalMetres is 0 rather than an estimate", mapless.totalMetres === 0);

    const partial = deriveRoute([
      clip({ id: "a", location: COURTYARD, recordedAt: plus(T0, 0) }),
      clip({ id: "b", recordedAt: plus(T0, 30) }),
      clip({ id: "c", location: FOUNTAIN, recordedAt: plus(T0, 60) }),
    ]);
    check("some fixes fires partial-locations", has(partial, "partial-locations"));
    check("...and NOT no-locations", !has(partial, "no-locations"));
  }

  section("Warnings are sorted blocker → warn → note");
  {
    // One route carrying all three severities: no fix anywhere (blocker), a
    // filename ordering and no clocks (warn), and two cameras (note).
    const r = deriveRoute([
      clip({ id: "a", name: "IMG_1.mov", device: "Apple iPhone 15 Pro" }),
      clip({ id: "b", name: "IMG_2.mov", device: "Google Pixel 9" }),
      clip({ id: "c", name: "IMG_3.mov", device: "Apple iPhone 15 Pro" }),
    ]);
    const rank: Record<RouteWarning["severity"], number> = { blocker: 0, warn: 1, note: 2 };
    const seq = r.warnings.map((w) => rank[w.severity]);
    check("all three severities are present",
      new Set(seq).size === 3, r.warnings.map((w) => `${w.severity}:${w.code}`).join(", "));
    check("...and they run blocker first, note last",
      seq.every((v, i) => i === 0 || seq[i - 1] <= v), seq.join(","));
    check("the blocker is the missing map",
      r.warnings[0]?.code === "no-locations", r.warnings[0]?.code);
    check("the note is the second camera",
      r.warnings[r.warnings.length - 1]?.code === "mixed-devices",
      r.warnings[r.warnings.length - 1]?.code);
  }

  section("totalSeconds is min-to-max, so it can never run backwards");
  {
    // mtime order, with the two real timestamps running AGAINST it. First-to-last
    // in route order would be minus an hour.
    const clips = [0, 1, 2, 3, 4, 5].map((i) =>
      clip({ id: `m${i}`, fileModifiedAt: plus(T0, i * 10) }),
    );
    clips[1].recordedAt = plus(T0, 3600);
    clips[4].recordedAt = plus(T0, 0);

    const r = deriveRoute(clips);
    check("the order is the mtime order", r.orderedBy === "file-modified", r.orderedBy);
    check("...which puts the later timestamp first",
      ids(r).indexOf("m1") < ids(r).indexOf("m4"), ids(r).join(", "));
    check("totalSeconds is the positive span, not the signed difference",
      r.totalSeconds === 3600, `${r.totalSeconds}`);
    check("...and is never negative", (r.totalSeconds ?? 0) >= 0);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Corrections
// ─────────────────────────────────────────────────────────────────────────────

function verifyCorrections() {
  heading("Corrections — what the person who was there says");

  const base = (): ClipFacts[] => [
    clip({ id: "a", location: COURTYARD, recordedAt: plus(T0, 0) }),
    clip({ id: "b", recordedAt: plus(T0, 30) }),
    clip({ id: "c", location: FOUNTAIN, recordedAt: plus(T0, 60) }),
  ];

  section("No corrections is the identity");
  {
    const clips = base();
    check("applyCorrections with nothing deep-equals deriveRoute",
      deepEqual(applyCorrections(clips, NO_CORRECTIONS), deriveRoute(clips)));
    check("...on an empty selection too",
      deepEqual(applyCorrections([], NO_CORRECTIONS), deriveRoute([])));
    check("...and on a one-clip selection",
      deepEqual(
        applyCorrections([clip({ id: "only" })], NO_CORRECTIONS),
        deriveRoute([clip({ id: "only" })]),
      ));
    check("NO_CORRECTIONS was not mutated by any of that",
      NO_CORRECTIONS.edits.length === 0);
  }

  section("An order edit is a SPLICE, not a swap");
  {
    const clips = ["a", "b", "c", "d", "e"].map((id, i) =>
      clip({ id, recordedAt: plus(T0, i * 60) }),
    );
    const r = applyCorrections(clips, { edits: [{ kind: "order", clipId: "e", toIndex: 1 }] });
    check("moving e to position 1 closes everything else up",
      deepEqual(ids(r), ["a", "e", "b", "c", "d"]), ids(r).join(", "));
    check("...and is NOT a swap with b",
      !deepEqual(ids(r), ["a", "e", "c", "d", "b"]));
    check("indexes are renumbered over the whole list",
      r.clips.every((c, i) => c.index === i));
    check("the basis becomes 'corrected'", r.orderedBy === "corrected", r.orderedBy);

    // Splices compose in the order they were made — they do not commute.
    const two = applyCorrections(clips, {
      edits: [
        { kind: "order", clipId: "e", toIndex: 0 },
        { kind: "order", clipId: "a", toIndex: 4 },
      ],
    });
    check("two splices apply in the order they were made",
      deepEqual(ids(two), ["e", "b", "c", "d", "a"]), ids(two).join(", "));

    // A stale index from a list that has since shrunk lands at the end rather
    // than being rejected outright.
    const past = applyCorrections(clips, { edits: [{ kind: "order", clipId: "a", toIndex: 99 }] });
    check("an oversized index clamps to the end",
      deepEqual(ids(past), ["b", "c", "d", "e", "a"]), ids(past).join(", "));
    const negative = applyCorrections(clips, {
      edits: [{ kind: "order", clipId: "e", toIndex: -5 }],
    });
    check("a negative index clamps to the front",
      deepEqual(ids(negative), ["e", "a", "b", "c", "d"]), ids(negative).join(", "));
  }

  section("A hand-set order retires the guess it replaced");
  {
    // Ordered by filename, so deriveRoute raises order-guessed. The person then
    // says what the order is, and there is no longer a guess to caveat.
    const clips = [
      clip({ id: "a", name: "IMG_1.mov", location: COURTYARD }),
      clip({ id: "b", name: "IMG_2.mov", location: FOUNTAIN }),
      clip({ id: "c", name: "IMG_3.mov", location: COURTYARD }),
    ];
    const before = deriveRoute(clips);
    check("the derived route did warn about the order", has(before, "order-guessed"));

    const after = applyCorrections(clips, {
      edits: [{ kind: "order", clipId: "c", toIndex: 0 }],
    });
    check("after an order edit the basis is 'corrected'",
      after.orderedBy === "corrected", after.orderedBy);
    check("...and order-guessed is gone", !has(after, "order-guessed"));
    check("...and the ledger says the reader set it",
      ledgerHas(after, "where it belongs by hand"), after.assumptions.join(" | "));
    check("...and no longer claims nothing said what order they go in",
      !ledgerHas(after, "Nothing in these files said what order they go in"));
  }

  section("A corrected location survives the re-derive as 'corrected'");
  {
    // The easiest thing in this layer to lose: the correction goes in as a fact,
    // deriveRoute hands it back marked "measured", and the route silently stops
    // being able to say which pins the reader placed.
    const clips = base();
    const pinned: GeoPoint = { lat: 43.4700, lng: -80.5100 };
    const r = applyCorrections(clips, {
      edits: [{ kind: "location", clipId: "b", location: pinned }],
    });
    const b = clipOf(r, "b");
    check("the pin lands where the reader put it",
      b?.location?.lat === pinned.lat && b?.location?.lng === pinned.lng,
      JSON.stringify(b?.location));
    check("...and is sourced 'corrected', NOT 'measured'",
      b?.locationSource === "corrected", `${b?.locationSource}`);
    check("...and NOT 'inferred', which is what it was a moment ago",
      b?.locationSource !== "inferred");
    check("the facts still say what the file said — null",
      b?.facts.location === null, JSON.stringify(b?.facts.location));
    check("a corrected pin counts toward located",
      r.located === 3, `${r.located}`);
    check("...and its legs count toward the total",
      Math.abs(r.totalMetres - (metresApart(COURTYARD, pinned) + metresApart(pinned, FOUNTAIN))) <
        1e-9,
      `${r.totalMetres}`);
    check("the ledger says the reader placed it",
      ledgerHas(r, "You placed 1 clip yourself"), r.assumptions.join(" | "));

    const t = applyCorrections(clips, {
      edits: [{ kind: "time", clipId: "b", recordedAt: "2026-08-15T14:20:00-04:00" }],
    });
    check("a corrected time is sourced 'corrected' too",
      clipOf(t, "b")?.recordedAtSource === "corrected",
      `${clipOf(t, "b")?.recordedAtSource}`);
    check("...keeping the offset the reader typed",
      clipOf(t, "b")?.recordedAt === "2026-08-15T14:20:00-04:00",
      `${clipOf(t, "b")?.recordedAt}`);
  }

  section("A corrected pin clears the speed it was causing");
  {
    const clips = [
      clip({ id: "a", location: COURTYARD, recordedAt: plus(T0, 0) }),
      clip({ id: "b", location: north(COURTYARD, 1000), recordedAt: plus(T0, 2) }),
    ];
    check("the derived route flags the speed", has(deriveRoute(clips), "implausible-speed"));

    const fixed = applyCorrections(clips, {
      edits: [{ kind: "location", clipId: "b", location: north(COURTYARD, 3) }],
    });
    check("moving the pin somewhere plausible clears the warning",
      !has(fixed, "implausible-speed"),
      fixed.warnings.map((w) => w.code).join(", "));
    check("...and the leg is now the corrected distance",
      Math.abs((clipOf(fixed, "b")?.legMetres ?? 0) - 3) < 0.01,
      `${clipOf(fixed, "b")?.legMetres}`);
    check("...and the pin is still marked corrected",
      clipOf(fixed, "b")?.locationSource === "corrected");
  }

  section("An omitted clip is out of every number, and the legs bridge it");
  {
    const P1 = COURTYARD;
    const P2 = north(COURTYARD, 400);
    const P3 = north(COURTYARD, 900);
    const clips = [
      clip({ id: "a", location: P1, recordedAt: plus(T0, 0) }),
      clip({ id: "b", location: P2, recordedAt: plus(T0, 60), device: "Google Pixel 9" }),
      clip({ id: "c", location: P3, recordedAt: plus(T0, 120) }),
    ];
    const full = deriveRoute(clips);
    check("with all three in, the total is both legs",
      Math.abs(full.totalMetres - (metresApart(P1, P2) + metresApart(P2, P3))) < 1e-9,
      `${full.totalMetres}`);

    const r = applyCorrections(clips, {
      edits: [{ kind: "omit", clipId: "b", omitted: true }],
    });
    check("the omitted clip is still listed, so it can be put back",
      r.clips.length === 3 && clipOf(r, "b")?.omitted === true);
    check("THE BRIDGE: c's leg is measured from a, not through b",
      Math.abs((clipOf(r, "c")?.legMetres ?? 0) - metresApart(P1, P3)) < 1e-9,
      `${clipOf(r, "c")?.legMetres} vs ${metresApart(P1, P3)}`);
    check("...and that is shorter than the two legs it replaces",
      metresApart(P1, P3) < metresApart(P1, P2) + metresApart(P2, P3));
    check("totalMetres is the bridged distance",
      Math.abs(r.totalMetres - metresApart(P1, P3)) < 1e-9, `${r.totalMetres}`);
    check("the omitted clip carries no leg of its own",
      clipOf(r, "b")?.legMetres === null && clipOf(r, "b")?.legSeconds === null &&
        clipOf(r, "b")?.legSpeedMps === null);
    check("located counts the live clips only", r.located === 2, `${r.located}`);
    check("timed likewise", r.timed === 2, `${r.timed}`);
    check("totalSeconds spans the live clips", r.totalSeconds === 120, `${r.totalSeconds}`);
    check("...and c's legSeconds bridges too",
      clipOf(r, "c")?.legSeconds === 120, `${clipOf(r, "c")?.legSeconds}`);
    check("the ledger says a clip is left out",
      ledgerHas(r, "1 clip is left out of the journey"), r.assumptions.join(" | "));

    // Omitting every clip is legal and must not produce a route that claims a
    // journey it no longer has.
    const none = applyCorrections(clips, {
      edits: clips.map((c): ClipCorrection => ({ kind: "omit", clipId: c.id, omitted: true })),
    });
    check("omitting everything leaves nothing to measure",
      none.totalMetres === 0 && none.totalSeconds === null && none.located === 0,
      `${none.totalMetres} / ${none.totalSeconds} / ${none.located}`);
    check("...and says so in the ledger",
      ledgerHas(none, "Every clip is left out"), none.assumptions.join(" | "));
    check("...and all three rows are still there to put back",
      none.clips.length === 3 && none.clips.every((c) => c.omitted));
  }

  section("The ledger stays true after an edit");
  {
    // Two clips interpolated, one of them then pinned by hand. The line saying
    // "2 clips were placed on the straight line" is now false, and a false line
    // in the honesty ledger is worse than no line at all.
    const clips = [
      clip({ id: "a", location: COURTYARD, recordedAt: plus(T0, 0) }),
      clip({ id: "b", recordedAt: plus(T0, 20) }),
      clip({ id: "c", recordedAt: plus(T0, 40) }),
      clip({ id: "d", location: FOUNTAIN, recordedAt: plus(T0, 60) }),
    ];
    const before = deriveRoute(clips);
    check("the derived ledger claims 2 interpolated clips",
      ledgerHas(before, "2 clips had no location of their own"), before.assumptions.join(" | "));

    const one = applyCorrections(clips, {
      edits: [{ kind: "location", clipId: "b", location: north(COURTYARD, 50) }],
    });
    check("pinning one drops the claim to 1 clip",
      ledgerHas(one, "1 clip had no location of its own"), one.assumptions.join(" | "));
    check("...and the stale count of 2 is gone",
      !ledgerHas(one, "2 clips had no location of their own"));

    const both = applyCorrections(clips, {
      edits: [
        { kind: "location", clipId: "b", location: north(COURTYARD, 50) },
        { kind: "location", clipId: "c", location: north(COURTYARD, 100) },
      ],
    });
    check("pinning both removes the straight-line line entirely",
      !ledgerHas(both, "placed on the straight line between the nearest located clips"),
      both.assumptions.join(" | "));
    check("...and nothing is inferred any more",
      both.clips.every((c) => c.locationSource !== "inferred"));
    check("...and the ledger credits the reader for two pins",
      ledgerHas(both, "You placed 2 clips yourself"), both.assumptions.join(" | "));
    check("...and no longer says the total skipped legs it no longer skips",
      !ledgerHas(both, "The total distance skips"), both.assumptions.join(" | "));
  }

  section("Editing the set of corrections");
  {
    let c: RouteCorrections = NO_CORRECTIONS;
    // What a drag actually generates: one of these per animation frame, all
    // saying the same thing in the end.
    for (let i = 0; i < 50; i++) {
      c = addCorrection(c, {
        kind: "location",
        clipId: "b",
        location: { lat: 43 + i / 1000, lng: -80 },
      });
    }
    check("50 drags of one pin collapse to one edit", c.edits.length === 1, `${c.edits.length}`);
    check("...and the last one wins",
      c.edits[0].kind === "location" && c.edits[0].location.lat === 43.049,
      JSON.stringify(c.edits[0]));

    c = addCorrection(c, { kind: "time", clipId: "b", recordedAt: plus(T0, 10) });
    check("a different kind on the same clip is a separate edit", c.edits.length === 2);
    c = addCorrection(c, { kind: "location", clipId: "z", location: { lat: 1, lng: 2 } });
    check("...as is the same kind on a different clip", c.edits.length === 3);

    check("correctionsFor returns only that clip's, in the order made",
      correctionsFor(c, "b").length === 2 && correctionsFor(c, "b")[0].kind === "location");
    check("...and nothing for a clip nobody touched", correctionsFor(c, "nope").length === 0);

    const cleared = clearFor(c, "b");
    check("clearFor forgets everything about one clip", cleared.edits.length === 1);
    check("...and leaves the other clip's edit alone", cleared.edits[0].clipId === "z");
    check("...without mutating the set it was given", c.edits.length === 3);

    // The whole reason corrections are a layer: the reading was never touched,
    // so clearing restores it for free and EXACTLY.
    const clips = base();
    const edited = addCorrection(NO_CORRECTIONS, {
      kind: "location",
      clipId: "b",
      location: { lat: 43.47, lng: -80.51 },
    });
    check("the edit really does change the route",
      !deepEqual(applyCorrections(clips, edited), deriveRoute(clips)));
    check("clearFor restores the derived route exactly",
      deepEqual(applyCorrections(clips, clearFor(edited, "b")), deriveRoute(clips)));
  }

  section("describeCorrection reads as a sentence, in no particular timezone");
  {
    check("positions are 1-based for a person",
      describeCorrection({ kind: "order", clipId: "a", toIndex: 3 }) === "moved to position 4",
      describeCorrection({ kind: "order", clipId: "a", toIndex: 3 }));
    check("a pin is four decimals, not a whole double",
      describeCorrection({
        kind: "location",
        clipId: "a",
        location: { lat: 43.46431234, lng: -80.52049876 },
      }) === "placed at 43.4643, -80.5205");
    // Read off the string with a regex, never through a Date: a Date would
    // render this in the running machine's zone and give a different answer on
    // a laptop in Toronto than on a server in UTC.
    check("a time reads off the string, so the machine's zone cannot change it",
      describeCorrection({
        kind: "time",
        clipId: "a",
        recordedAt: "2026-08-15T14:20:00-04:00",
      }) === "time set to 14:20");
    check("omit reads both ways",
      describeCorrection({ kind: "omit", clipId: "a", omitted: true }) === "left out" &&
        describeCorrection({ kind: "omit", clipId: "a", omitted: false }) === "put back");
  }

  section("parseCorrections drops, never repairs");
  {
    const good: unknown[] = [
      { kind: "order", clipId: "a", toIndex: 3 },
      { kind: "location", clipId: "b", location: { lat: 43.4, lng: -80.5 } },
      { kind: "location", clipId: "c", location: { lat: 43.4, lng: -80.5 }, label: "the fountain" },
      { kind: "time", clipId: "d", recordedAt: "2026-08-15T14:20:00-04:00" },
      { kind: "omit", clipId: "e", omitted: true },
    ];
    const bad: Array<[string, unknown]> = [
      ["an unknown kind", { kind: "teleport", clipId: "a", toIndex: 0 }],
      ["a missing clipId", { kind: "omit", omitted: true }],
      ["an empty clipId", { kind: "omit", clipId: "", omitted: true }],
      ["latitude 91", { kind: "location", clipId: "a", location: { lat: 91, lng: 0 } }],
      ["longitude -181", { kind: "location", clipId: "a", location: { lat: 0, lng: -181 } }],
      ["a location that is not an object", { kind: "location", clipId: "a", location: "here" }],
      ["an unparseable recordedAt", { kind: "time", clipId: "a", recordedAt: "last tuesday" }],
      ["a non-integer toIndex", { kind: "order", clipId: "a", toIndex: 2.5 }],
      ["a NaN toIndex", { kind: "order", clipId: "a", toIndex: Number.NaN }],
      ['omitted: "true" as a string', { kind: "omit", clipId: "a", omitted: "true" }],
      ["a null entry", null],
      ["a bare string entry", "drop me"],
      ["a number entry", 42],
    ];

    for (const [label, item] of bad) {
      let threw = false;
      let kept = -1;
      try {
        kept = parseCorrections([item]).edits.length;
      } catch {
        threw = true;
      }
      check(`${label} is dropped without throwing`, !threw && kept === 0,
        threw ? "threw" : `kept ${kept}`);
    }

    // The one that matters most: one bad edit must not cost the reader the good
    // ones it arrived beside.
    const mixed = parseCorrections([...bad.map(([, v]) => v), ...good]);
    check("the valid edits survive alongside every invalid one",
      mixed.edits.length === good.length, `${mixed.edits.length} of ${good.length}`);
    check("...with their kinds intact",
      deepEqual(mixed.edits.map((e) => e.kind), ["order", "location", "location", "time", "omit"]),
      mixed.edits.map((e) => e.kind).join(", "));
    check("...and the optional label carried through",
      mixed.edits[2].kind === "location" && mixed.edits[2].label === "the fountain");
    check("...and nothing else from the wire riding along",
      deepEqual(mixed.edits[1], {
        kind: "location",
        clipId: "b",
        location: { lat: 43.4, lng: -80.5 },
      }), JSON.stringify(mixed.edits[1]));

    for (const [label, raw] of [
      ["a bare string", "corrections"],
      ["null", null],
      ["undefined", undefined],
      ["a number", 7],
      ["an object with no edits array", { nope: true }],
      ["an object whose edits is not an array", { edits: "nope" }],
    ] as Array<[string, unknown]>) {
      let threw = false;
      let out: RouteCorrections | null = null;
      try {
        out = parseCorrections(raw);
      } catch {
        threw = true;
      }
      check(`${label} parses to an empty set rather than throwing`,
        !threw && out !== null && out.edits.length === 0, threw ? "threw" : `${out?.edits.length}`);
    }

    check("the { edits: [...] } wrapper is accepted too",
      parseCorrections({ edits: good }).edits.length === good.length);
    check("a bare array is accepted too", parseCorrections(good).edits.length === good.length);

    // Round trip: what came off the wire has to actually work on a route.
    const clips = base();
    const parsed = parseCorrections([
      { kind: "location", clipId: "b", location: { lat: 43.47, lng: -80.51 } },
      { kind: "nonsense", clipId: "b" },
    ]);
    check("parsed corrections apply like any other",
      clipOf(applyCorrections(clips, parsed), "b")?.locationSource === "corrected");
  }

  section("Corrections naming clips that are not here");
  {
    const clips = base();
    const ghost = applyCorrections(clips, {
      edits: [
        { kind: "order", clipId: "not_a_clip", toIndex: 0 },
        { kind: "location", clipId: "not_a_clip", location: { lat: 1, lng: 2 } },
        { kind: "omit", clipId: "not_a_clip", omitted: true },
      ],
    });
    check("an edit for a clip that is not in the pile changes nothing",
      deepEqual(ids(ghost), ids(deriveRoute(clips))), ids(ghost).join(", "));
    check("...and does not claim the order was corrected",
      ghost.orderedBy === deriveRoute(clips).orderedBy, ghost.orderedBy);
    check("...and does not credit the reader with a pin they did not place",
      !ledgerHas(ghost, "You placed"), ghost.assumptions.join(" | "));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. The container parser
//
// Hand-built ISO-BMFF, byte by byte, because that is the only way to assert what
// the parser does with a header nobody would ship — a size field of zero, a box
// bigger than the file, a `moov` that stops mid-`mvhd`. Every one of those turns
// up in real damaged footage and none of them may throw or spin.
// ─────────────────────────────────────────────────────────────────────────────

const SEED = {
  id: "clip_0",
  name: "IMG_0001.MOV",
  bytes: 128 * 1024 * 1024,
  fileModifiedAt: "2020-01-01T00:00:00.000Z",
};

const enc = new TextEncoder();
const ascii = (s: string) => enc.encode(s);

function u16(v: number): Uint8Array {
  const a = new Uint8Array(2);
  new DataView(a.buffer).setUint16(0, v);
  return a;
}

function u32(v: number): Uint8Array {
  const a = new Uint8Array(4);
  new DataView(a.buffer).setUint32(0, v);
  return a;
}

function u64(v: number): Uint8Array {
  const a = new Uint8Array(8);
  const d = new DataView(a.buffer);
  d.setUint32(0, Math.floor(v / 2 ** 32));
  d.setUint32(4, Math.floor(v % 2 ** 32));
  return a;
}

const zeros = (n: number) => new Uint8Array(n);

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** `[uint32 size][4-char type][payload]`, with `size` counting the header. */
function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const body = concat(parts);
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i) & 0xff;
  out.set(body, 8);
  return out;
}

function bufferOf(u8: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(u8.length);
  new Uint8Array(ab).set(u8);
  return ab;
}

/** Seconds from 1904-01-01 UTC, which is what a `moov` timestamp counts. */
const MAC_EPOCH_OFFSET_SEC = 2_082_844_800;
const macTime = (iso: string) => Date.parse(iso) / 1000 + MAC_EPOCH_OFFSET_SEC;

/** `mvhd` v0: version+flags, creation, modification, timescale, duration — all 32-bit. */
const mvhd0 = (iso: string, timescale: number, duration: number) =>
  box("mvhd", u32(0), u32(macTime(iso)), u32(macTime(iso)), u32(timescale), u32(duration));

/** `mvhd` v1: the same fields with 64-bit times and duration. */
const mvhd1 = (iso: string, timescale: number, duration: number) =>
  box("mvhd", concat([Uint8Array.from([1, 0, 0, 0])]), u64(macTime(iso)), u64(macTime(iso)),
    u32(timescale), u64(duration));

/** `moov/udta/©xyz` — `[uint16 len][uint16 lang][text]`, not a bare string. */
const xyzBox = (text: string) =>
  box(`${String.fromCharCode(0xa9)}xyz`, u16(ascii(text).length), u16(0x55c4), ascii(text));

/** The `keys` full box: version+flags, count, then `[size]['mdta'][name]` records. */
const keysBox = (keys: string[]) =>
  box("keys", u32(0), u32(keys.length), ...keys.map((k) => box("mdta", ascii(k))));

/** One `ilst` entry, whose BOX TYPE is a 1-based big-endian index into `keys`. */
const ilstEntry = (index: number, value: string) =>
  box(
    String.fromCharCode((index >>> 24) & 0xff, (index >>> 16) & 0xff, (index >>> 8) & 0xff, index & 0xff),
    box("data", u32(1), u32(0), ascii(value)),
  );

const hdlrBox = () => box("hdlr", zeros(24));

function verifyContainer() {
  heading("Reading the container, off hand-built bytes");

  section("mvhd — the movie header");
  {
    const facts = factsFromContainer(
      bufferOf(box("moov", mvhd0("2026-08-15T18:42:11.000Z", 600, 6000))),
      SEED,
    );
    check("a v0 mvhd's 1904-epoch creation time reads as the right instant",
      facts.recordedAt === "2026-08-15T18:42:11.000Z", `${facts.recordedAt}`);
    check("...with no offset claimed, because mvhd carries none",
      facts.utcOffsetMin === null, `${facts.utcOffsetMin}`);
    check("...and duration is duration / timescale",
      facts.durationSec === 10, `${facts.durationSec}`);
    check("the seed's fields come through untouched",
      facts.id === SEED.id && facts.name === SEED.name && facts.bytes === SEED.bytes);

    const v1 = factsFromContainer(
      bufferOf(box("moov", mvhd1("1999-12-31T23:59:59.000Z", 1000, 45_000))),
      SEED,
    );
    check("a v1 (64-bit) mvhd reads too",
      v1.recordedAt === "1999-12-31T23:59:59.000Z", `${v1.recordedAt}`);
    check("...with its 64-bit duration", v1.durationSec === 45, `${v1.durationSec}`);

    // A zeroed header reads as 1904 and a garbage one as the year 60,000. Both
    // are "the file did not say", and neither may become a timestamp.
    const zeroed = factsFromContainer(bufferOf(box("moov", mvhd0("1904-01-01T00:00:00.000Z", 600, 600))), SEED);
    check("a zeroed creation time is not believed", zeroed.recordedAt === null,
      `${zeroed.recordedAt}`);
    check("...but the duration beside it still is", zeroed.durationSec === 1);

    const sentinel = factsFromContainer(
      bufferOf(box("moov", mvhd0("2026-08-15T18:42:11.000Z", 600, 0xffff_ffff))),
      SEED,
    );
    check("the 0xFFFFFFFF 'still recording' duration is not 49 days of footage",
      sentinel.durationSec === null, `${sentinel.durationSec}`);
  }

  section("moov/udta/©xyz — the QuickTime location tag");
  {
    const facts = factsFromContainer(
      bufferOf(box("moov", box("udta", xyzBox("+43.4643-080.5204+329.000/")))),
      SEED,
    );
    check("the ISO 6709 payload gives the right latitude",
      facts.location?.lat === 43.4643, `${facts.location?.lat}`);
    check("...and the right longitude", facts.location?.lng === -80.5204,
      `${facts.location?.lng}`);
    check("...and altitude off the third number", facts.altitudeM === 329,
      `${facts.altitudeM}`);
    check("a location-only container claims no capture time",
      facts.recordedAt === null, `${facts.recordedAt}`);

    // THE rule from ClipFacts: copying a clip off a phone rewrites the mtime, so
    // it is routinely hours wrong in a way that looks entirely plausible.
    check("recordedAt NEVER falls back to fileModifiedAt",
      facts.recordedAt !== SEED.fileModifiedAt && facts.recordedAt === null);
    check("...and fileModifiedAt is still carried, in its own field",
      facts.fileModifiedAt === SEED.fileModifiedAt, `${facts.fileModifiedAt}`);

    const noAlt = factsFromContainer(
      bufferOf(box("moov", box("udta", xyzBox("+43.4643-080.5204/")))),
      SEED,
    );
    check("a fix with no altitude leaves altitudeM null", noAlt.altitudeM === null,
      `${noAlt.altitudeM}`);
    check("...and still reads the position", noAlt.location?.lat === 43.4643);

    // Out of range means the string was not what we took it for. Clamping would
    // put a confident pin at the north pole.
    const impossible = factsFromContainer(
      bufferOf(box("moov", box("udta", xyzBox("+91.0000-080.5204+329.000/")))),
      SEED,
    );
    check("latitude 91 is rejected rather than clamped", impossible.location === null,
      JSON.stringify(impossible.location));
    check("...and no altitude is scraped out of a string that failed",
      impossible.altitudeM === null, `${impossible.altitudeM}`);

    const nullIsland = factsFromContainer(
      bufferOf(box("moov", box("udta", xyzBox("+00.0000+000.0000/")))),
      SEED,
    );
    check("null island is treated as absent", nullIsland.location === null);
  }

  section("moov/meta — Apple's keys/ilst indirection");
  {
    const keys = [
      "com.apple.quicktime.creationdate",
      "com.apple.quicktime.make",
      "com.apple.quicktime.model",
      "com.apple.quicktime.location.ISO6709",
    ];
    const meta = box(
      "meta",
      hdlrBox(),
      keysBox(keys),
      box(
        "ilst",
        ilstEntry(1, "2026-08-15T18:42:11-0400"),
        ilstEntry(2, "Apple"),
        ilstEntry(3, "iPhone 15 Pro"),
        ilstEntry(4, "+43.4643-080.5204+329.000/"),
      ),
    );
    const facts = factsFromContainer(bufferOf(box("moov", meta)), SEED);

    check("the 1-based index indirection resolves entry 1 to creationdate",
      facts.recordedAt === "2026-08-15T18:42:11-04:00", `${facts.recordedAt}`);
    check("...keeping the ±HHMM offset rather than normalising to UTC",
      (facts.recordedAt ?? "").endsWith("-04:00"));
    check("...and reporting it as minutes east of UTC",
      facts.utcOffsetMin === -240, `${facts.utcOffsetMin}`);
    check("...and it parses, which is what the inserted colon is for",
      epochOf(facts.recordedAt) === Date.parse("2026-08-15T22:42:11.000Z"),
      `${epochOf(facts.recordedAt)}`);
    check("make and model join into one device string",
      facts.device === "Apple iPhone 15 Pro", `${facts.device}`);
    check("the location tag reads through the same indirection",
      facts.location?.lat === 43.4643 && facts.location?.lng === -80.5204,
      JSON.stringify(facts.location));

    // `Z` says the time is UTC. It does NOT say the camera was in London, and
    // reporting 0 would put every UTC-only clip in a timezone somebody is in.
    const bareZ = factsFromContainer(
      bufferOf(box("moov", box("meta", hdlrBox(), keysBox([keys[0]]),
        box("ilst", ilstEntry(1, "2026-08-15T18:42:11Z"))))),
      SEED,
    );
    check("a bare Z keeps the instant", bareZ.recordedAt === "2026-08-15T18:42:11Z",
      `${bareZ.recordedAt}`);
    check("...and reports utcOffsetMin as null, not 0", bareZ.utcOffsetMin === null,
      `${bareZ.utcOffsetMin}`);

    // Apple's creationdate carries the offset; mvhd does not. So it wins.
    const both = factsFromContainer(
      bufferOf(box("moov",
        box("meta", hdlrBox(), keysBox([keys[0]]),
          box("ilst", ilstEntry(1, "2026-08-15T18:42:11-0400"))),
        mvhd0("2001-01-01T00:00:00.000Z", 600, 6000))),
      SEED,
    );
    check("creationdate outranks mvhd's offsetless stamp",
      both.recordedAt === "2026-08-15T18:42:11-04:00", `${both.recordedAt}`);
    check("...while mvhd still supplies the duration", both.durationSec === 10);

    // ISO/MP4 writes `meta` as a FULL box — four version/flag bytes before the
    // children — where QuickTime writes it plain. Guessing from the extension
    // would get one of the two wrong on every file.
    const fullBox = factsFromContainer(
      bufferOf(box("moov", box("meta", u32(0), hdlrBox(), keysBox([keys[0]]),
        box("ilst", ilstEntry(1, "2026-08-15T18:42:11Z"))))),
      SEED,
    );
    check("the full-box flavour of meta is detected rather than assumed",
      fullBox.recordedAt === "2026-08-15T18:42:11Z", `${fullBox.recordedAt}`);

    const orphan = factsFromContainer(
      bufferOf(box("moov", box("meta", hdlrBox(), keysBox([keys[0]]),
        box("ilst", ilstEntry(9, "2026-08-15T18:42:11Z"))))),
      SEED,
    );
    check("an ilst entry indexing past the keys list is ignored, not guessed",
      orphan.recordedAt === null, `${orphan.recordedAt}`);
  }

  section("Damaged, truncated and hostile buffers — empty facts, never a throw");
  {
    const empties: Array<[string, ArrayBuffer]> = [
      ["an empty buffer", new ArrayBuffer(0)],
      ["three bytes", bufferOf(Uint8Array.from([1, 2, 3]))],
      // Deterministic garbage, so a failure is reproducible.
      ["512 bytes of garbage", bufferOf(Uint8Array.from({ length: 512 }, (_, i) => (i * 31 + 7) & 0xff))],
      // A box declaring a size smaller than its own header. A naive walker
      // steps backwards or stands still on this one.
      ["a box whose size is 2", bufferOf(concat([u32(2), ascii("junk"), zeros(64)]))],
      // size === 1 escapes to a 64-bit largesize; a largesize of 0 is smaller
      // than the 16-byte header it just declared.
      ["a 64-bit box whose largesize is 0", bufferOf(concat([u32(1), ascii("junk"), u64(0), zeros(64)]))],
      // A largesize past the end of the universe.
      ["a 64-bit box larger than the file", bufferOf(concat([u32(1), ascii("junk"), u64(2 ** 48), zeros(64)]))],
      // 4096 empty boxes is MAX_BOXES exactly; a walker without a ceiling is
      // still going.
      ["5000 empty boxes", bufferOf(concat(Array.from({ length: 5000 }, () => box("free"))))],
      // A moov cut off mid-mvhd: findMoov's child check must reject it rather
      // than read a half-written header as a date.
      ["a moov truncated mid-mvhd", (() => {
        const full = box("moov", mvhd0("2026-08-15T18:42:11.000Z", 600, 6000));
        return bufferOf(full.slice(0, 14));
      })()],
    ];

    for (const [label, buf] of empties) {
      let threw = false;
      let facts: ClipFacts | null = null;
      try {
        facts = factsFromContainer(buf, SEED);
      } catch {
        threw = true;
      }
      const bare =
        facts !== null &&
        facts.recordedAt === null &&
        facts.location === null &&
        facts.durationSec === null &&
        facts.device === null &&
        facts.altitudeM === null;
      check(`${label} yields empty facts without throwing`, !threw && bare,
        threw ? "threw" : JSON.stringify(facts));
      check(`...and ${label} still carries fileModifiedAt`,
        facts?.fileModifiedAt === SEED.fileModifiedAt);
    }

    // A moov whose declared size runs past the window IS worth descending into —
    // that is the ordinary case for the tail read on phone footage.
    const overlong = concat([
      u32(4096),
      ascii("moov"),
      mvhd0("2026-08-15T18:42:11.000Z", 600, 6000),
    ]);
    const clipped = factsFromContainer(bufferOf(overlong), SEED);
    check("a moov declaring more bytes than the window still yields its mvhd",
      clipped.recordedAt === "2026-08-15T18:42:11.000Z", `${clipped.recordedAt}`);

    // A leading box with size 0 swallows the rest of the buffer, so the WALK can
    // never reach the moov. The scan is what finds it.
    const swallowed = concat([
      u32(0),
      ascii("free"),
      zeros(8),
      box("moov", mvhd0("2026-08-15T18:42:11.000Z", 600, 6000)),
    ]);
    const scanned = factsFromContainer(bufferOf(swallowed), SEED);
    check("a size-0 box hides the moov from the walk, and the scan finds it anyway",
      scanned.recordedAt === "2026-08-15T18:42:11.000Z", `${scanned.recordedAt}`);

    // A `moov` that is not a header: four bytes of coincidence inside a payload.
    const falsePositive = concat([
      box("mdat", ascii("....moov....nothing to see here....")),
      zeros(32),
    ]);
    const nothing = factsFromContainer(bufferOf(falsePositive), SEED);
    check("the letters 'moov' inside a payload are not mistaken for a header",
      nothing.recordedAt === null && nothing.durationSec === null,
      JSON.stringify(nothing));

    // Not ISO-BMFF at all. A half-parser for EBML would give confident wrong
    // answers on the one format nobody tests with.
    const webm = factsFromContainer(
      bufferOf(concat([Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]), zeros(256)])),
      SEED,
    );
    check("a Matroska/WebM header comes back empty rather than half-parsed",
      webm.recordedAt === null && webm.location === null && webm.durationSec === null);
  }

  section("The parser's output really is a ClipFacts the route can take");
  {
    const facts = factsFromContainer(
      bufferOf(box("moov",
        box("meta", hdlrBox(), keysBox(["com.apple.quicktime.creationdate"]),
          box("ilst", ilstEntry(1, "2026-08-15T18:42:11-0400"))),
        box("udta", xyzBox("+43.4643-080.5204+329.000/")),
        mvhd0("2026-08-15T18:42:11.000Z", 600, 6000))),
      { ...SEED, id: "read_0" },
    );
    const second = factsFromContainer(
      bufferOf(box("moov",
        box("meta", hdlrBox(), keysBox(["com.apple.quicktime.creationdate"]),
          box("ilst", ilstEntry(1, "2026-08-15T18:52:11-0400"))),
        box("udta", xyzBox("+43.4652-080.5188+330.000/")),
        mvhd0("2026-08-15T18:52:11.000Z", 600, 6000))),
      { ...SEED, id: "read_1", name: "IMG_0002.MOV" },
    );
    const r = deriveRoute([second, facts]);
    check("two parsed clips route by their own timestamps",
      deepEqual(ids(r), ["read_0", "read_1"]) && r.orderedBy === "recorded-at",
      `${ids(r).join(", ")} / ${r.orderedBy}`);
    check("...and their own fixes", r.located === 2 && r.totalMetres > 0,
      `${r.located} located, ${r.totalMetres.toFixed(1)} m`);
    check("...over the ten minutes between them", r.totalSeconds === 600, `${r.totalSeconds}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Edges
// ─────────────────────────────────────────────────────────────────────────────

function verifyEdges() {
  heading("Edges — nothing, one, and fifty of the same thing");

  section("An empty selection is no route, not a degenerate one");
  {
    const r = deriveRoute([]);
    check("no clips", r.clips.length === 0);
    check("no warnings — shouting at an empty room helps nobody",
      r.warnings.length === 0, r.warnings.map((w) => w.code).join(", "));
    check("no assumptions", r.assumptions.length === 0);
    check("totalMetres is 0 and totalSeconds is null, not 0",
      r.totalMetres === 0 && r.totalSeconds === null, `${r.totalMetres} / ${r.totalSeconds}`);
    check("origin is null", r.origin === null);
    check("located and timed are 0", r.located === 0 && r.timed === 0);
    check("the basis is as-given", r.orderedBy === "as-given", r.orderedBy);
  }

  section("One clip");
  {
    const r = deriveRoute([
      clip({ id: "only", location: COURTYARD, recordedAt: T0, device: "Apple iPhone 15 Pro" }),
    ]);
    check("it is placed from its own fix",
      clipOf(r, "only")?.locationSource === "measured");
    check("it has no leg", clipOf(r, "only")?.legMetres === null &&
      clipOf(r, "only")?.legSeconds === null);
    check("totalMetres is 0", r.totalMetres === 0);
    check("totalSeconds is null — one instant is not a duration",
      r.totalSeconds === null, `${r.totalSeconds}`);
    check("origin is its fix", r.origin?.lat === COURTYARD.lat);
    check("the only warning is single-clip",
      deepEqual(r.warnings.map((w) => w.code), ["single-clip"]),
      r.warnings.map((w) => w.code).join(", "));
    check("nothing is NaN", !hasNonFinite(r));
  }

  section("Fifty identical clips");
  {
    const clips = Array.from({ length: 50 }, (_, i) =>
      clip({
        id: `clip_${i}`,
        name: `clip_${i}.mov`,
        location: { ...COURTYARD },
        recordedAt: T0,
        device: "Apple iPhone 15 Pro",
      }),
    );
    const r = deriveRoute(clips);
    check("all fifty come back", r.clips.length === 50, `${r.clips.length}`);
    check("located and timed count all fifty", r.located === 50 && r.timed === 50);
    check("totalMetres is 0, because nobody moved", r.totalMetres === 0, `${r.totalMetres}`);
    check("totalSeconds is 0, not null — two clocks agreed",
      r.totalSeconds === 0, `${r.totalSeconds}`);
    check("every leg is exactly 0 metres",
      r.clips.slice(1).every((c) => c.legMetres === 0));
    check("every leg is 0 seconds, so no speed is computed",
      r.clips.slice(1).every((c) => c.legSeconds === 0 && c.legSpeedMps === null));
    check("nothing anywhere is NaN or Infinity", !hasNonFinite(r));
    check("no implausible speed is manufactured out of a zero gap",
      !has(r, "implausible-speed"));
    const same = r.warnings.filter((w) => w.code === "same-timestamp");
    check("exactly one same-timestamp warning, not fifty",
      same.length === 1, `${same.length}`);
    check("...naming all fifty clips", same[0]?.clipIds.length === 50,
      `${same[0]?.clipIds.length}`);
    check("...but naming only three of them in the sentence",
      (same[0]?.message ?? "").includes("and 48 others"), same[0]?.message);
    check("one camera is not mixed devices", !has(r, "mixed-devices"));
    check("fifty is not a single clip", !has(r, "single-clip"));
    check("nothing needed interpolating", !has(r, "partial-locations"));
  }

  section("Fifty identical clips, corrected");
  {
    const clips = Array.from({ length: 50 }, (_, i) =>
      clip({ id: `clip_${i}`, location: { ...COURTYARD }, recordedAt: T0 }),
    );
    const r = applyCorrections(clips, {
      edits: [{ kind: "order", clipId: "clip_49", toIndex: 0 }],
    });
    check("the splice moves exactly one row", ids(r)[0] === "clip_49" && ids(r)[1] === "clip_0",
      ids(r).slice(0, 3).join(", "));
    check("...and every index is renumbered", r.clips.every((c, i) => c.index === i));
    check("...and nothing became NaN", !hasNonFinite(r));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. The journey store
//
// Server-side, and it reaches lib/albums.ts for `normaliseTitle` — so it is
// imported dynamically and the section says so if the import will not run under
// tsx, rather than printing `ok` for checks that never happened.
// ─────────────────────────────────────────────────────────────────────────────

async function verifyStore() {
  heading("The journey store");

  let store: typeof import("../lib/journey/store");
  try {
    store = await import("../lib/journey/store");
  } catch (err) {
    skip("the whole journey store section", `it does not import under tsx — ${String(err)}`);
    return;
  }

  const { __resetJourneys, countLegs, createJourney, getJourney, isJourneyId, listJourneys,
    summariseJourney, MAX_JOURNEYS } = store;

  const route = deriveRoute([
    clip({ id: "a", location: COURTYARD, recordedAt: plus(T0, 0) }),
    clip({ id: "b", location: north(COURTYARD, 400), recordedAt: plus(T0, 60) }),
    clip({ id: "c", location: north(COURTYARD, 900), recordedAt: plus(T0, 120) }),
  ]);

  section("Creating one");
  {
    __resetJourneys();
    const j = createJourney({
      route,
      // Deliberately out of route order, and with one leg naming a clip the
      // route has never heard of.
      legs: [
        { clipId: "c", tripId: "trip_upload_c", splatJobId: null },
        { clipId: "ghost", tripId: "trip_upload_ghost", splatJobId: "splat_x" },
        { clipId: "a", tripId: null, splatJobId: "splat_a" },
      ],
      title: "  Autumn   in Waterloo  ",
    });

    check("the id carries its own provenance", isJourneyId(j.id), j.id);
    check("legs are re-sorted into route order",
      deepEqual(j.legs.map((l) => l.clipId), ["a", "b", "c"]),
      j.legs.map((l) => l.clipId).join(", "));
    check("a leg naming a clip the route does not contain is DROPPED",
      !j.legs.some((l) => l.clipId === "ghost"), j.legs.map((l) => l.clipId).join(", "));
    check("...so it cannot inflate the count either",
      countLegs(j).named === 1, `${countLegs(j).named}`);
    check("a route clip with no leg supplied gets honest nulls",
      j.legs[1].tripId === null && j.legs[1].splatJobId === null);
    check("tripId and splatJobId stay separately nullable",
      j.legs[0].tripId === null && j.legs[0].splatJobId === "splat_a");
    check("the title is normalised the way albums normalise theirs",
      j.title === "Autumn in Waterloo", `${j.title}`);
    check("countLegs adds up", (() => {
      const c = countLegs(j);
      return c.total === 3 && c.named + c.unnamed === c.total;
    })());
    check("it is readable back out", getJourney(j.id)?.id === j.id);
    check("an unknown id is null, not a throw", getJourney("journey_nope") === null);

    const s = summariseJourney(j);
    check("the summary counts every clip, omitted ones included", s.clips === 3, `${s.clips}`);
    check("...rounds the metres", s.totalMetres === Math.round(route.totalMetres),
      `${s.totalMetres}`);
    check("...and reports legs that NAME a walk, unverified",
      s.legsWithWalk === 1, `${s.legsWithWalk}`);

    const untitled = createJourney({ route, legs: [], title: "   " });
    check("a whitespace-only title is null, not an empty string",
      untitled.title === null, `${untitled.title}`);
    check("no title at all is null too", createJourney({ route, legs: [] }).title === null);
  }

  section("It is a cache, not a leak");
  {
    __resetJourneys();
    for (let i = 0; i < MAX_JOURNEYS + 5; i++) createJourney({ route, legs: [] });
    check(`it caps at MAX_JOURNEYS (${MAX_JOURNEYS})`,
      listJourneys().length === MAX_JOURNEYS, `${listJourneys().length}`);
    __resetJourneys();
    check("and the reset the scripts need actually empties it",
      listJourneys().length === 0, `${listJourneys().length}`);
  }

  section("It does not re-derive");
  {
    __resetJourneys();
    // The route is computed by the caller and stored verbatim. A later
    // correction is a NEW journey, not a mutation of this one.
    const corrected = applyCorrections(
      [
        clip({ id: "a", location: COURTYARD, recordedAt: plus(T0, 0) }),
        clip({ id: "b", location: north(COURTYARD, 400), recordedAt: plus(T0, 60) }),
        clip({ id: "c", location: north(COURTYARD, 900), recordedAt: plus(T0, 120) }),
      ],
      { edits: [{ kind: "omit", clipId: "b", omitted: true }] },
    );
    const j = createJourney({ route: corrected, legs: [] });
    check("the stored route is the one it was handed", deepEqual(j.route, corrected));
    check("...omissions and all", j.route.clips.some((c) => c.omitted));
    check("...and the summary counts the omitted row as a clip",
      summariseJourney(j).clips === 3, `${summariseJourney(j).clips}`);
    __resetJourneys();
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  verifyOrdering();
  verifyPositions();
  verifyLegsAndWarnings();
  verifyCorrections();
  verifyContainer();
  verifyEdges();
  await verifyStore();

  if (skipped > 0) {
    console.log(`\n${skipped} check(s) could not run and were skipped.`);
  }
  console.log(
    failures === 0
      ? "\nAll invariants hold.\n"
      : `\n${failures} check(s) failed.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
