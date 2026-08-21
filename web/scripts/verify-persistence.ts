/**
 * Does a journey survive a server restart?
 *
 * The question is not academic. A journey hands out `/journey/<id>`, and until
 * lib/persist.ts landed that link 404'd after any restart or redeploy — the
 * store was a bare `globalThis` singleton. So the assertion that matters here
 * is not "persist() wrote a file", it is "the link still resolves on the other
 * side of a process boundary".
 *
 * `__simulateRestart()` exists for exactly this and does the only honest
 * version of it: clear what the process holds, leave the disk alone, ask again.
 * Testing against `__resetJourneys` would wipe both halves and pass happily
 * against a store that never wrote anything.
 *
 *     npx tsx scripts/verify-persistence.ts
 */
import {
  __resetJourneys,
  __simulateRestart,
  createJourney,
  getJourney,
  listJourneys,
  MAX_JOURNEYS,
} from "../lib/journey/store";
import { __wipeStore, forget, hydrate, persist, persistedCount, storeDir } from "../lib/persist";
import { deriveRoute } from "../lib/journey/route";
import { emptyFacts, type ClipFacts } from "../lib/journey/clips";
import {
  __resetUploadedTrips,
  __simulateRestart as __simulateWalkRestart,
  attachSplat,
  createUploadedWalk,
  getUploadedWalk,
  setWalkPlace,
} from "../lib/uploadedTrips";
import type { Detection } from "../lib/types";
import {
  __resetAlbums,
  __simulateRestart as __simulateAlbumRestart,
  addToAlbum,
  albumForJourney,
  createAlbum,
  deleteAlbum,
  getAlbum,
  removeFromAlbum,
  renameAlbum,
} from "../lib/albums";
import {
  __resetPostedWalks,
  __simulateRestart as __simulatePostedRestart,
  isWalkPosted,
  setWalkPosted,
} from "../lib/postedWalks";
import { TRIP_ID } from "../lib/tripData";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

let passed = 0;
const failures: string[] = [];

function ok(label: string, condition: boolean): void {
  if (condition) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

/** A route over n clips, with real timestamps so the order is measured. */
function routeOf(n: number, seed = 0) {
  const clips: ClipFacts[] = [];
  for (let i = 0; i < n; i++) {
    const f = emptyFacts(`clip_${seed}_${i}`, `IMG_${i}.mov`, 1000 + i);
    f.recordedAt = new Date(Date.UTC(2026, 0, 1, 12, i)).toISOString();
    f.location = { lat: 43.64 + i * 0.001, lng: -79.4 + i * 0.001 };
    clips.push(f);
  }
  return deriveRoute(clips);
}

// ─────────────────────────────────────────────────────────────────────────────
section("A journey outlives the process that made it");

__resetJourneys();

const made = createJourney({ route: routeOf(3), legs: [], title: "Harbourfront" });
ok("a new journey is readable immediately", getJourney(made.id)?.id === made.id);
ok("and it reached disk", persistedCount("journeys") === 1);

__simulateRestart();

const revived = getJourney(made.id);
ok("THE LINK STILL RESOLVES AFTER A RESTART", revived !== null);
ok("with its title intact", revived?.title === "Harbourfront");
ok("with its route intact", revived?.route.clips.length === 3);
ok(
  "and its derived distance intact",
  Math.round(revived?.route.totalMetres ?? -1) === Math.round(made.route.totalMetres),
);
ok("legs survive too", revived?.legs.length === 3);
ok("and it is listed, not merely fetchable by id", listJourneys().some((j) => j.id === made.id));

// ─────────────────────────────────────────────────────────────────────────────
section("What must NOT come back");

__resetJourneys();
ok("a reset clears disk as well as memory", persistedCount("journeys") === 0);
__simulateRestart();
ok("so nothing is resurrected", listJourneys().length === 0);

// A sidecar we cannot vouch for is dropped rather than served: it would be
// reachable at /journey/<id>, and a page rendering a route nobody validated is
// worse than a 404.
mkdirSync(storeDir("journeys"), { recursive: true });
writeFileSync(path.join(storeDir("journeys"), "journey_junk.json"), "{ not json", "utf8");
writeFileSync(
  path.join(storeDir("journeys"), "journey_partial.json"),
  JSON.stringify({ id: "journey_partial", createdAt: "2026-01-01T00:00:00.000Z" }),
  "utf8",
);
writeFileSync(
  path.join(storeDir("journeys"), "journey_badid.json"),
  JSON.stringify({ id: "not_a_journey", createdAt: "2026-01-01T00:00:00.000Z", route: { clips: [] }, legs: [], title: null }),
  "utf8",
);
__simulateRestart();
ok("unparseable JSON is skipped, not fatal", listJourneys().length === 0);
ok("a record missing its route is dropped", getJourney("journey_partial") === null);
ok("an id that is not a journey id is dropped", getJourney("not_a_journey") === null);

__resetJourneys();

// ─────────────────────────────────────────────────────────────────────────────
section("The cap still means something across a restart");

__resetJourneys();
const ids: string[] = [];
for (let i = 0; i < MAX_JOURNEYS + 3; i++) {
  ids.push(createJourney({ route: routeOf(2, i), legs: [], title: `walk ${i}` }).id);
}
ok(`memory holds at most ${MAX_JOURNEYS}`, listJourneys().length === MAX_JOURNEYS);
ok("and disk was evicted in step, not left to grow", persistedCount("journeys") === MAX_JOURNEYS);

__simulateRestart();
ok("after a restart the cap is still honoured", listJourneys().length === MAX_JOURNEYS);
ok("the oldest is gone", getJourney(ids[0]) === null);
ok("the newest survived", getJourney(ids[ids.length - 1]) !== null);

const order = listJourneys();
ok(
  "and they come back newest-first, as before",
  order.every((j, i) => i === 0 || order[i - 1].createdAt >= j.createdAt),
);

__resetJourneys();

// ─────────────────────────────────────────────────────────────────────────────
section("A walk, and the mutations that land after it was created");

__resetUploadedTrips();

// Enough detections, densely enough clustered, that the scorer promotes at
// least one moment — a walk with no moments has nothing to attach a splat to.
const detections: Detection[] = [];
for (let f = 0; f < 40; f++) {
  for (const label of ["person", "bench", "tree", "dog"]) {
    detections.push({
      id: `det_${f}_${label}`,
      tripId: "pending",
      frameId: `frame_${f}`,
      t: f * 0.5,
      label,
      confidence: 0.9,
      bbox: [0.1, 0.1, 0.3, 0.3],
      trackId: `track_${label}`,
      source: "onboard",
    });
  }
}

const walk = createUploadedWalk({
  detections,
  durationSec: 20,
  sourceName: "harbour.mov",
  placeLabel: "Harbourfront",
});
ok("a new walk is readable immediately", getUploadedWalk(walk.id) !== null);

// The two mutations that happen LATER, and that a create-time-only sidecar
// would silently forget: a place set by geocoding, and a splat that finished
// reconstructing minutes after the walk was built.
setWalkPlace(walk.id, { origin: { lat: 43.6386, lng: -79.3819 }, label: "Queens Quay" });
const attached = attachSplat(walk.id, "/mock/splats/test.ply", 12345);

__simulateWalkRestart();

const back = getUploadedWalk(walk.id);
ok("THE WALK SURVIVES A RESTART", back !== null);
ok("its source name is intact", back?.sourceName === "harbour.mov");
ok("its moments survive", (back?.built.trip.moments.length ?? 0) > 0);
ok(
  "the place set AFTER create survives",
  back?.built.trip.place.origin?.lat === 43.6386 && back?.built.trip.place.label === "Queens Quay",
);
ok("and originMeasured stayed true", back?.built.trip.place.originMeasured === true);
if (attached) {
  ok(
    "the splat attached AFTER create survives",
    back?.built.trip.moments.some((m) => m.splat?.url === "/mock/splats/test.ply") ?? false,
  );
  ok(
    "with its measured point count",
    back?.built.trip.moments.some((m) => m.splat?.pointCount === 12345) ?? false,
  );
}

__resetUploadedTrips();
ok("resetting walks clears disk too", persistedCount("walks") === 0);

// ─────────────────────────────────────────────────────────────────────────────
section("An album, its derived index, and what deleting one has to mean");

__resetAlbums();

const created = createAlbum({ title: "  Autumn   walks  " });
ok("createAlbum normalises the title", created.ok && created.album.title === "Autumn walks");
const albumId = created.ok ? created.album.id : "";

addToAlbum(albumId, "trip_upload_a");
addToAlbum(albumId, "trip_upload_b");

__simulateAlbumRestart();

const backAlbum = getAlbum(albumId);
ok("THE ALBUM SURVIVES A RESTART", backAlbum !== null);
ok("with its title", backAlbum?.title === "Autumn walks");
ok("with both walks filed under it", backAlbum?.journeyIds.length === 2);
ok("and its cover still set", backAlbum?.coverJourneyId !== null);

// byJourney is derived and deliberately NOT persisted — a second copy of the
// same fact could come back disagreeing with the first. So the real assertion
// is that it was REBUILT, not that it was stored.
ok(
  "the derived journey index is rebuilt, not persisted",
  albumForJourney("trip_upload_a")?.id === albumId,
);
ok("for every member, not just the first", albumForJourney("trip_upload_b")?.id === albumId);
ok("and not for a walk in no album", albumForJourney("trip_upload_nowhere") === null);

// Renames and removals land after create; a create-time-only sidecar forgets them.
renameAlbum(albumId, "Winter walks");
removeFromAlbum(albumId, "trip_upload_a");
__simulateAlbumRestart();
ok("a rename survives", getAlbum(albumId)?.title === "Winter walks");
ok("a removal survives", getAlbum(albumId)?.journeyIds.includes("trip_upload_a") === false);
ok("the removed walk is unindexed too", albumForJourney("trip_upload_a") === null);
ok(
  "and the cover moved off the walk that left",
  getAlbum(albumId)?.coverJourneyId === "trip_upload_b",
);

// The one that would be worst to get wrong.
deleteAlbum(albumId);
__simulateAlbumRestart();
ok("DELETE MEANS DELETE — no resurrection at the next restart", getAlbum(albumId) === null);
ok("and nothing is left on disk", persistedCount("albums") === 0);

__resetAlbums();

// ─────────────────────────────────────────────────────────────────────────────
section("Unposting a walk is a privacy choice, so it has to stick");

__resetPostedWalks();

// An uploaded walk defaults to NOT posted, so the meaningful override in that
// direction is posting one; for a seeded walk it is taking one down.
setWalkPosted("trip_upload_zzz", true);
setWalkPosted(TRIP_ID, false);

__simulatePostedRestart();

ok("a walk posted on purpose stays posted", isWalkPosted("trip_upload_zzz") === true);
ok("A WALK TAKEN DOWN STAYS DOWN", isWalkPosted(TRIP_ID) === false);
ok(
  "a walk nobody chose for still follows the default rule",
  isWalkPosted("trip_upload_never_touched") === false,
);

// `false` is a real stored value, not an absence. A persistence layer that
// round-trips it as "missing" would silently republish it.
__resetPostedWalks();
setWalkPosted(TRIP_ID, false);
__simulatePostedRestart();
ok("false survives as false, not as absent", isWalkPosted(TRIP_ID) === false);

__resetPostedWalks();

// ─────────────────────────────────────────────────────────────────────────────
section("persist.ts itself");

__wipeStore("__probe");
ok("a store nobody wrote to reports zero", persistedCount("__probe") === 0);
ok("and leaves no directory behind", !existsSync(storeDir("__probe")));

ok("a normal id writes", persist("__probe", "abc-123_XYZ", { v: 1 }));
ok("and reads back", hydrate<{ v: number }>("__probe", (r) => r as { v: number })[0]?.v === 1);

// Ids reach the filesystem. A store name is ours, but an id can come from a
// request body, so traversal is refused rather than sanitised — a "cleaned"
// id would silently address a different record than the caller named.
ok("a traversal id is refused", !persist("__probe", "../../etc/passwd", { v: 2 }));
ok("an absolute-ish id is refused", !persist("__probe", "C:/Windows/win", { v: 3 }));
ok("an empty id is refused", !persist("__probe", "", { v: 4 }));
ok("refusing did not write anything extra", persistedCount("__probe") === 1);
ok("forget removes it", forget("__probe", "abc-123_XYZ") && persistedCount("__probe") === 0);
ok("forgetting what is not there is not an error", forget("__probe", "abc-123_XYZ"));

__wipeStore("__probe");

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${passed} ok, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("All invariants hold.");
