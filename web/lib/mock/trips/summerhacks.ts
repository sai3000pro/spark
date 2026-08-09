/**
 * SummerHacks at Stackt Market, Toronto — 58 minutes in a shipping-container
 * yard turned hackathon venue.
 *
 * The trip that carries the ONE real reconstruction in the whole app: the build
 * room's `splat.url` points at a genuine 1.8M-gaussian capture committed under
 * public/mock/splats, so opening that moment renders an actual room rather than
 * the synthetic stand-in every other trip falls back to. The other two moments
 * are authored the same way the postcard trips are, which is deliberate — the
 * gallery should show the honest mix of ready, real and still-reconstructing.
 *
 * See the authoring rules in lib/mock/buildTrip.ts before editing. The ones that
 * bite here: laughter in every moment, two person tracks spanning each window,
 * and novel objects drawn from labels the ambient generator does not already
 * use — laptop, cell phone, dining table and book are all safe, bench/chair/cup/
 * backpack are not. No bottle anywhere in this trip: rule 6.
 */
import { at, defaultSeeds, type MomentSpec, type TripSpec } from "../buildTrip";
import type { RouteSegment } from "../generateRoutePath";
import { SCENE_HUES } from "../placeholder";
import {
  BUILD_ROOM_TO_DEMO,
  COURTYARD_TO_BUILD_ROOM,
  DEMO_TO_END,
  START_TO_COURTYARD,
} from "./summerhacks-route.gen";
import { makeLngLatToLocal } from "../../geo";
import type { Vec2 } from "../../types";

const TRIP_ID = "trip_summerhacks";
const DURATION_SEC = 3480; // 58 min

/** Real [lat, lng] → yard-local metres. The whole file authors in coordinates. */
const P = makeLngLatToLocal({ origin: { lat: 43.64058, lng: -79.4019 }, bearingDeg: 0 });

/** A baked leg (summerhacks-route.gen.ts) → local-frame waypoints. */
const LEG = (pts: Array<[number, number]>): Vec2[] => pts.map(([lat, lng]) => P(lat, lng));

/** Real spots in the STACKT yard, read off the containers themselves. */
const PLACES = {
  start: P(43.64058, -79.4019), // the Front St gate
  courtyard: P(43.64085, -79.40235), // the container courtyard, mid-yard
  buildRoom: P(43.6411, -79.40218), // the build-room container, east aisle
  demo: P(43.64135, -79.40248), // the demo tables, north end
  end: P(43.64142, -79.40232), // the north gate
};

/* ── The route — hand-read off the yard's aisles ────────────────────────────
 *
 * The legs live in summerhacks-route.gen.ts. The STACKT yard is private
 * ground no mapper has drawn, so these are hand-read waypoints threading the
 * lanes between the container stacks (see scripts/bake-routes.mjs) — never
 * through a container. The long dwells are the honest shape of a hackathon:
 * a day parked in one room, three short walks.
 */
const ROUTE: RouteSegment[] = [
  // Arriving, finding the gate, gawking at the stacks.
  { kind: "dwell", at: PLACES.start, fromT: 0, toT: 168, radiusM: 2.0 },

  // In through the yard to the badge table.
  { kind: "walk", departT: 168, arriveT: 232, via: LEG(START_TO_COURTYARD) },
  { kind: "dwell", at: PLACES.courtyard, fromT: 232, toT: 1480, radiusM: 3.0 },

  // Badges done, coffee found: into the build room.
  { kind: "walk", departT: 1480, arriveT: 1532, via: LEG(COURTYARD_TO_BUILD_ROOM) },
  { kind: "dwell", at: PLACES.buildRoom, fromT: 1532, toT: 2820, radiusM: 2.2 },

  // Up the aisle to the demo tables at the north end.
  { kind: "walk", departT: 2820, arriveT: 2874, via: LEG(BUILD_ROOM_TO_DEMO) },
  { kind: "dwell", at: PLACES.demo, fromT: 2874, toT: 3420, radiusM: 2.6 },

  // Out the north gate.
  { kind: "walk", departT: 3420, arriveT: 3438, via: LEG(DEMO_TO_END) },
  { kind: "dwell", at: PLACES.end, fromT: 3438, toT: 3480, radiusM: 1.8 },
];

const MOMENTS: MomentSpec[] = [
  {
    id: "m_sh_courtyard",
    tStart: 240,
    tEnd: 342,
    placeLabel: "The container courtyard",
    placePos: PLACES.courtyard,
    hue: SCENE_HUES.golden,
    title: "Signing in between the shipping containers",
    summary:
      "The yard at the front of Stackt, stacked two containers high and painted every colour, where the badge table had been set up in the sun.",
    people: ["Priya", "Marcus"],
    transcript: [
      [6, "Marcus", "It's a hackathon inside a shipping container. Of course it is."],
      [18, "Priya", "Wait, is our room the one with the roll-up door?"],
      [41, "You", "Look at this place, it's all containers stacked up."],
      [72, "Marcus", "Badges first. Then coffee. Then panic."],
    ],
    laughterAt: [24, 78],
    keywords: [
      [41, "look at this"],
      [72, "badges first"],
    ],
    tracks: [
      { trackId: "t_sh_cy_priya", label: "person", tStart: 240, tEnd: 342, worldPos: at(PLACES.courtyard, -1.3, 0.88, 0.9), peakConfidence: 0.94, hz: 2.4, baseDepthM: 2.5 },
      { trackId: "t_sh_cy_marcus", label: "person", tStart: 241, tEnd: 341, worldPos: at(PLACES.courtyard, 1.2, 0.9, 1.1), peakConfidence: 0.92, hz: 2.4, baseDepthM: 2.9 },
      { trackId: "t_sh_cy_phone", label: "cell phone", tStart: 252, tEnd: 330, worldPos: at(PLACES.courtyard, -1.4, 1.28, 0.5), peakConfidence: 0.85, hz: 2.2, baseDepthM: 2.2 },
      { trackId: "t_sh_cy_table", label: "dining table", tStart: 240, tEnd: 342, worldPos: at(PLACES.courtyard, 0.2, 0.4, 2.3), peakConfidence: 0.86, hz: 1.8, baseDepthM: 3.4 },
      { trackId: "t_sh_cy_book", label: "book", tStart: 246, tEnd: 318, worldPos: at(PLACES.courtyard, 0.9, 0.78, 2.0), peakConfidence: 0.7, hz: 1.8, baseDepthM: 3.1 },
    ],
    splat: {
      status: "ready",
      url: "/mock/splats/m_sh_courtyard.spz",
      pointCount: 361_000,
      captureFrameCount: 192,
      bounds: { min: [-8, 0, -8], max: [8, 5, 8] },
    },
    music: {
      trackName: "Two Weeks",
      artist: "Grizzly Bear",
      spotifyUri: "spotify:track:0wSA6BAVBFhKAHyLGCPgOI",
      chosenBecause: "a bright open-air arrival with two laughs in it — it went for something that builds",
    },
    vibe: { mood: "expectant", energy: 0.51, tags: ["arrival", "containers", "badges", "morning"] },
  },

  {
    id: "m_sh_build_room",
    tStart: 1620,
    tEnd: 1725,
    placeLabel: "The build room",
    placePos: PLACES.buildRoom,
    hue: SCENE_HUES.indoor,
    title: "Four hours in and the room has stopped talking",
    summary:
      "The container we were given, mid-build: laptops open on the long table, cables everywhere, and the particular quiet of everyone being deep in something at once.",
    people: ["Priya", "Marcus"],
    transcript: [
      [5, "Priya", "Okay, it compiles. Nobody touch anything."],
      [22, "Marcus", "Say that again in an hour."],
      [58, "You", "Capture this, the whole room's heads-down right now."],
      [91, "Priya", "That's the demo. That right there is the demo."],
    ],
    laughterAt: [29],
    keywords: [
      [58, "capture this"],
      [91, "that's the demo"],
    ],
    tracks: [
      { trackId: "t_sh_br_priya", label: "person", tStart: 1620, tEnd: 1725, worldPos: at(PLACES.buildRoom, -1.5, 0.86, 0.7), peakConfidence: 0.95, hz: 2.6, baseDepthM: 2.1 },
      { trackId: "t_sh_br_marcus", label: "person", tStart: 1621, tEnd: 1724, worldPos: at(PLACES.buildRoom, 1.4, 0.88, 0.9), peakConfidence: 0.93, hz: 2.6, baseDepthM: 2.4 },
      { trackId: "t_sh_br_laptop", label: "laptop", tStart: 1620, tEnd: 1725, worldPos: at(PLACES.buildRoom, -1.2, 0.76, -0.4), peakConfidence: 0.91, hz: 2.6, baseDepthM: 1.2 },
      { trackId: "t_sh_br_laptop2", label: "laptop", tStart: 1626, tEnd: 1720, worldPos: at(PLACES.buildRoom, 1.1, 0.76, -0.3), peakConfidence: 0.87, hz: 2.4, baseDepthM: 1.5 },
      { trackId: "t_sh_br_table", label: "dining table", tStart: 1620, tEnd: 1725, worldPos: at(PLACES.buildRoom, 0, 0.42, -0.2), peakConfidence: 0.89, hz: 1.8, baseDepthM: 1.6 },
      { trackId: "t_sh_br_phone", label: "cell phone", tStart: 1638, tEnd: 1712, worldPos: at(PLACES.buildRoom, 0.4, 0.8, 0.6), peakConfidence: 0.82, hz: 2.2, baseDepthM: 1.1 },
    ],
    splat: {
      // THE REAL ONE. 1,797,380 gaussians, binary little-endian INRIA layout,
      // DC-only (no SH rest terms). ~96 MiB, so it streams in progressively.
      status: "ready",
      url: "/mock/splats/summerhacks_build_room.ply",
      pointCount: 1_797_380,
      captureFrameCount: 412,
      bounds: { min: [-6, 0, -6], max: [6, 3, 6] },
      // Measured off the file, not guessed: the capture spans x[-10.6, 8.5],
      // y[-1.67, 1.58], z[-11.1, 6.6] and is y-UP despite the INRIA layout, so
      // it needs no scene rotation. This stands you back from the long painted
      // wall with the doorway at the right of frame.
      view: {
        cameraUp: [0, 1, 0],
        cameraPosition: [0, 1.1, 10.5],
        cameraLookAt: [-0.5, -0.1, -2],
        alphaRemovalThreshold: 5,
      },
    },
    music: {
      trackName: "An Ending (Ascent)",
      artist: "Brian Eno",
      spotifyUri: "spotify:track:2XU0oxnq2qxCpomAAuJY8K",
      chosenBecause: "ninety seconds of near-silence with one laugh in it — it refused to score the room loudly",
    },
    vibe: { mood: "absorbed", energy: 0.19, tags: ["indoor", "heads-down", "laptops", "build"] },
  },

  {
    id: "m_sh_demo",
    tStart: 2880,
    tEnd: 2976,
    placeLabel: "Demo table, north end",
    placePos: PLACES.demo,
    hue: SCENE_HUES.dusk,
    title: "Explaining it for the fourth time and finally getting it right",
    summary:
      "The demo tables at the north end, where the pitch stopped being a script somewhere around the third judge and started being a conversation.",
    people: ["Priya", "Marcus"],
    transcript: [
      [8, "Priya", "So it decides what was worth keeping. We don't tell it."],
      [27, "Marcus", "Show them the part where it picks the music."],
      [63, "You", "This is the bit I want on video."],
      [84, "Priya", "Fourth time's the charm, apparently."],
    ],
    laughterAt: [33, 88],
    keywords: [
      [27, "show them"],
      [63, "on video"],
    ],
    tracks: [
      { trackId: "t_sh_dm_priya", label: "person", tStart: 2880, tEnd: 2976, worldPos: at(PLACES.demo, -1.6, 0.88, 0.8), peakConfidence: 0.94, hz: 2.6, baseDepthM: 2.3 },
      { trackId: "t_sh_dm_marcus", label: "person", tStart: 2881, tEnd: 2975, worldPos: at(PLACES.demo, 1.0, 0.9, 1.0), peakConfidence: 0.92, hz: 2.6, baseDepthM: 2.6 },
      { trackId: "t_sh_dm_laptop", label: "laptop", tStart: 2880, tEnd: 2976, worldPos: at(PLACES.demo, -0.3, 0.78, -0.5), peakConfidence: 0.9, hz: 2.4, baseDepthM: 1.3 },
      { trackId: "t_sh_dm_table", label: "dining table", tStart: 2880, tEnd: 2976, worldPos: at(PLACES.demo, 0, 0.44, -0.3), peakConfidence: 0.85, hz: 1.8, baseDepthM: 1.7 },
      { trackId: "t_sh_dm_phone", label: "cell phone", tStart: 2892, tEnd: 2964, worldPos: at(PLACES.demo, 1.2, 1.24, 0.7), peakConfidence: 0.83, hz: 2.2, baseDepthM: 2.0 },
    ],
    splat: {
      status: "processing",
      captureFrameCount: 338,
      note: "338 frames queued — four people moving through a small frame takes longer to converge than a still room.",
    },
    music: {
      trackName: "Gold Lion",
      artist: "Yeah Yeah Yeahs",
      spotifyUri: "spotify:track:2gDLDpCUDvmwMdlKMFqzOU",
      chosenBecause: "two laughs and the highest speech energy of the day — it stopped being careful",
    },
    vibe: { mood: "wired", energy: 0.74, tags: ["demo", "judges", "pitch", "late-afternoon"] },
  },
];

export const summerhacks: TripSpec = {
  id: TRIP_ID,
  title: "Hacking at SummerHacks",
  startedAt: "2026-08-08T10:20:00-04:00",
  durationSec: DURATION_SEC,
  place: {
    label: "Stackt Market",
    region: "Toronto, ON",
    country: "Canada",
    // The authoring anchor: the yard's Front St gate at 28 Bathurst St. The
    // route is authored from real coordinates (bearing 0), so the pin and the
    // walk want exactly this point and no calibration nudge exists to make.
    origin: { lat: 43.64058, lng: -79.4019 },
  },
  start: PLACES.start,
  end: PLACES.end,
  route: ROUTE,
  sampleSec: 3,
  moments: MOMENTS,
  seeds: defaultSeeds(TRIP_ID),
};
