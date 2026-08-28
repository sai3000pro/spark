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
import { __resetStorageReality, canStoreUploads, storageReality } from "../lib/deployment";
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
import type { Detection, Moment } from "../lib/types";
import {
  MAX_DETECTIONS_PER_TRIP,
  MAX_TRIPS,
  __resetIngest,
  __simulateRestart as __simulateIngestRestart,
  getIngestedTrip,
  listIngestedTrips,
  recordDetections,
  recordMoment,
} from "../lib/ingest/store";
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
// ---------------------------------------------------------------------------
section("The rover feed survives a restart");
{
  __resetIngest();

  const det = (i: number, tripId = "trip_rover"): Detection => ({
    id: `det_${i}`,
    tripId,
    frameId: `f_${i}`,
    t: i,
    label: i % 2 === 0 ? "bottle" : "bench",
    confidence: 0.9,
    bbox: [0.1, 0.1, 0.2, 0.2],
    source: "onboard",
  });

  const first = recordDetections("trip_rover", [det(0), det(1), det(2)]);
  ok("a batch is stored", first.stored === 3 && first.held === 3);
  ok("...and nothing was trimmed", first.dropped === 0);

  recordDetections("trip_rover", [det(3)]);
  __simulateIngestRestart();

  const back = getIngestedTrip("trip_rover");
  ok("the trip survives a restart", back !== null);
  ok("...with every detection", back?.detections.length === 4);
  ok("...in order", back?.detections[0].id === "det_0" && back?.detections[3].id === "det_3");
  ok("...and its running total", back?.totalDetections === 4);

  // The cap, and the honesty about it. A silent trim would make `accepted` lie.
  __resetIngest();
  const big = Array.from({ length: MAX_DETECTIONS_PER_TRIP + 25 }, (_, i) => det(i));
  const capped = recordDetections("trip_big", big);
  ok("the per-trip cap bites", capped.held === MAX_DETECTIONS_PER_TRIP);
  ok("...and says how many it trimmed", capped.dropped === 25);
  ok("...while still reporting what was sent", capped.total === MAX_DETECTIONS_PER_TRIP + 25);
  ok(
    "...keeping the NEWEST, which is the window a moment came from",
    getIngestedTrip("trip_big")?.detections.at(-1)?.id === `det_${MAX_DETECTIONS_PER_TRIP + 24}`,
  );

  // Moments upsert rather than duplicate.
  __resetIngest();
  const moment = (id: string, title: string): Moment =>
    ({
      id,
      tripId: "trip_rover",
      title,
      tStart: 0,
      tEnd: 4,
      score: 1,
      objects: [],
      transcript: [],
      triggers: [],
      splat: { status: "none" },
    }) as unknown as Moment;

  recordMoment(moment("m_1", "first guess"));
  recordMoment(moment("m_1", "refined"));
  const after = getIngestedTrip("trip_rover");
  ok("a re-posted moment replaces rather than doubles", after?.moments.length === 1);
  ok("...with the newer content", after?.moments[0].title === "refined");

  __simulateIngestRestart();
  ok("moments survive a restart too", getIngestedTrip("trip_rover")?.moments.length === 1);

  // Eviction is a memory policy, not a delete.
  __resetIngest();
  for (let i = 0; i < MAX_TRIPS + 3; i++) recordDetections(`trip_${i}`, [det(0, `trip_${i}`)]);
  ok("trips are capped in memory", listIngestedTrips().length === MAX_TRIPS);
  __simulateIngestRestart();
  ok(
    "...but eviction did NOT delete the records from disk",
    listIngestedTrips().length === MAX_TRIPS + 3,
  );

  __resetIngest();
}

section("The deployment knows what it cannot do");
{
  /*
    The question this answers is the one a Vercel deploy fails on. Every store
    here writes a sidecar and the upload route streams into public/ — correct on
    a laptop, and on a serverless host the disk is per-invocation, so a write
    that SUCCEEDS is still gone by the next request. Storing a 200 MB splat
    there and reporting "ready" is the worst available outcome: the upload was
    spent and the answer was a lie.
  */
  __resetStorageReality();
  const here = storageReality();
  ok("this machine can write", here.writable);
  ok("...and is treated as durable", here.durable);
  ok("...so uploads are allowed", canStoreUploads());

  // What the same code says on a serverless host.
  const saved = process.env.VERCEL;
  process.env.VERCEL = "1";
  __resetStorageReality();
  const serverless = storageReality();
  ok("a serverless host is recognised", serverless.host === "serverless");
  ok(
    "...and is NOT durable even though the write succeeds",
    serverless.writable && !serverless.durable,
  );
  ok("...so uploads are refused there", !canStoreUploads());
  ok(
    "...with a reason naming what is actually missing",
    /object storage|database/i.test(serverless.reason),
  );
  ok(
    "...phrased for a person, not as an error code",
    serverless.reason.length > 40 && /[.]$/.test(serverless.reason.trim()),
  );

  if (saved === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = saved;
  __resetStorageReality();
  ok("the local answer comes back afterwards", canStoreUploads());
}

// NOT COVERED HERE: lib/push/registry.ts, and it is worth saying why rather
// than leaving a hole someone has to rediscover.
//
// That module was given the same durable treatment as the stores above -- a
// push token is a promise made in advance, and a reconstruction routinely
// outlasts the process that started it -- but it imports `server-only` on its
// first line, so requiring it under tsx throws before a single check runs.
//
// The guard is CORRECT: that module reaches Postgres with the service-role
// key, which is exactly what `server-only` exists to keep out of a browser
// bundle. Deleting it to make this file greener would trade a real safety
// boundary for a test, which is the wrong way round.
//
// So its persistence is verified by `npm run build` and by following the
// same shape as postedWalks (one record, whole-map, validated on the way in)
// which IS covered here -- and that is a weaker guarantee than the rest of
// this file provides. Stated plainly so nobody reads 56 green checks as
// covering it.

console.log(`\n${passed} ok, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("All invariants hold.");
