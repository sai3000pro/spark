/**
 * SummerHacks at STACKT, then the long way to the canoe — the flagship day.
 * Two and a half hours: a hackathon in the container market at Bathurst &
 * Front, and then, when it is over, a walk down over the rail bridge to Fort
 * York, across Garrison Common, through Coronation Park, east along the Martin
 * Goodman Trail past the Canada Malting silos, up through CityPlace to the red
 * canoe at Canoe Landing, and home to the market for food-hall hour.
 *
 * THE SHAPE IS TWO HALVES, AND IT IS THAT WAY BECAUSE OF THE PHOTOGRAPHS.
 * Five real Gaussian-splat captures exist for this app, and all five are the
 * hackathon — see the note on the first moment. So five of the six kept moments
 * happen in the yard, in one long opening dwell, and the walk carries the sixth.
 * `HACK_END` and `SHIFT` below are what hold the two halves apart.
 *
 * This is the trip the walk screen shows, so it is authored DEEP:
 *
 *   · the route is street-following — waypoints below are real coordinates
 *     read off Bathurst St, Fort York Blvd, the park paths and the waterfront
 *     trail, converted to the robot's local frame by lngLatToLocal. The
 *     odometry generator (generateRoutePath) traces them with layered wander
 *     and sensor jitter at a 3-second cadence, so the drawn walk weaves along
 *     real roads and cuts across real grass instead of flying straight lines
 *     between pins. None of that changed when the hackathon was added in front
 *     of it: every leg keeps its exact duration and simply starts later.
 *   · six kept moments, each earning promotion through the real scorer, plus
 *     a page of authored street life (streetcars, runners, dogs, sailboats,
 *     gulls) that thickens the detection stream and gives stage 2 more
 *     candidates to honestly reject.
 *
 * See the authoring rules in lib/mock/buildTrip.ts before editing.
 */
import { at, defaultSeeds, type MomentSpec, type TripSpec } from "../buildTrip";
import type { TrackSpec } from "../generateDetections";
import type { RouteSegment } from "../generateRoutePath";
import { SCENE_HUES } from "../placeholder";
import {
  CANOE_TO_COURTYARD,
  COMMON_TO_MAPLES,
  COURTYARD_TO_RAMPARTS,
  MAPLES_TO_SILOS,
  RAMPARTS_TO_COMMON,
  SILOS_TO_CANOE,
} from "./stackt-route.gen";
import { lngLatToLocal } from "../../geo";
import type { Vec2 } from "../../types";

const TRIP_ID = "trip_stackt_market";

/* ── THE DAY IS A HACKATHON, THEN A WALK ────────────────────────────────────
 *
 * The recording opens with the robot parked at STACKT for the hackathon — five
 * of the six kept moments happen there, and they are the five the real captures
 * belong to (see MOMENTS below). Only when that is over does the walk to the red
 * canoe begin, which is why the last moment lands at golden hour.
 *
 * The walk itself is UNCHANGED: same baked OSM legs, same leg durations, same
 * places, same 5.16 km. It simply starts later. Rather than re-typing every
 * downstream timestamp — which is how a route quietly stops matching its own
 * dwells — the original numbers stay written down and slide by one constant.
 * `900 + SHIFT` is auditable against the old file in a way that `3217` is not.
 */
/** The hackathon runs from the top of the recording to here. */
const HACK_END = 2600;
/** The opening dwell was 283 s long; everything after it moves by the difference. */
const SHIFT = HACK_END - 283; // +2317

const DURATION_SEC = 6300 + SHIFT; // 8617 — 2h 24m
const STARTED_AT = "2026-08-08T18:10:00-04:00";

/** Real [lat, lng] → robot-local metres. The whole file authors in coordinates. */
const P = (lat: number, lng: number): Vec2 => lngLatToLocal(lat, lng);

/** A baked leg (stackt-route.gen.ts) → local-frame waypoints. */
const LEG = (pts: Array<[number, number]>): Vec2[] => pts.map(([lat, lng]) => P(lat, lng));

/* ── The named spots ────────────────────────────────────────────────────── */
const PLACES = {
  courtyard: P(43.64085, -79.40235), // STACKT's container courtyard, mid-block
  ramparts: P(43.6389, -79.40645), // Fort York's western ramparts
  common: P(43.6397, -79.40815), // Garrison Common, open lawn
  maples: P(43.6348, -79.4074), // Coronation Park, under the big maples
  silos: P(43.6349, -79.3987), // Canada Malting silos, beside Ireland Park
  canoe: P(43.63918, -79.39565), // the red canoe, Canoe Landing
};

/* ── The route — every leg SNAPPED to real pedestrian ways ──────────────────
 *
 * The polylines live in stackt-route.gen.ts, baked from OpenStreetMap
 * foot-way data: sidewalks along Bathurst and Strachan, the signalled
 * crossings at Fort York Blvd and Lake Shore, the fort's paths, Remembrance
 * Drive and the Martin Goodman Trail along the water, Dan Leckie Way through
 * CityPlace, and a grass lap of Canoe Landing's field. The robot never walks
 * through a building, across the rail corridor, or down a traffic lane —
 * because the ways it follows are the ones a person can actually walk.
 */
const ROUTE: RouteSegment[] = [
  // THE HACKATHON. Five of the six kept moments live in this one long dwell —
  // the robot sat in the yard and recorded, which is what actually happened.
  { kind: "dwell", at: PLACES.courtyard, fromT: 0, toT: HACK_END, radiusM: 3.2 },

  // Down Bathurst's sidewalk, over the rail bridge, the signalled crossing at
  // Fort York Blvd, and the fort's own paths up to the western ramparts.
  { kind: "walk", departT: 283 + SHIFT, arriveT: 972 + SHIFT, via: LEG(COURTYARD_TO_RAMPARTS) },
  { kind: "dwell", at: PLACES.ramparts, fromT: 972 + SHIFT, toT: 1123 + SHIFT, radiusM: 2.6 },

  // Out the west gate onto Garrison Common's lawn.
  { kind: "walk", departT: 1123 + SHIFT, arriveT: 1382 + SHIFT, via: LEG(RAMPARTS_TO_COMMON) },
  { kind: "dwell", at: PLACES.common, fromT: 1382 + SHIFT, toT: 1533 + SHIFT, radiusM: 3.6 },

  // Strachan's sidewalk south, the Lake Shore crossing, into Coronation Park.
  { kind: "walk", departT: 1533 + SHIFT, arriveT: 2202 + SHIFT, via: LEG(COMMON_TO_MAPLES) },
  { kind: "dwell", at: PLACES.maples, fromT: 2202 + SHIFT, toT: 2363 + SHIFT, radiusM: 2.6 },

  // Down to the water: Remembrance Drive and the Martin Goodman Trail past
  // the yacht club, up Stadium Road to the silos at Bathurst Quay.
  { kind: "walk", departT: 2363 + SHIFT, arriveT: 3342 + SHIFT, via: LEG(MAPLES_TO_SILOS) },
  { kind: "dwell", at: PLACES.silos, fromT: 3342 + SHIFT, toT: 3498 + SHIFT, radiusM: 2.2 },

  // Queens Quay, then Dan Leckie Way north through CityPlace to Canoe Landing.
  { kind: "walk", departT: 3498 + SHIFT, arriveT: 4482 + SHIFT, via: LEG(SILOS_TO_CANOE) },
  { kind: "dwell", at: PLACES.canoe, fromT: 4482 + SHIFT, toT: 4653 + SHIFT, radiusM: 2.4 },

  // A slow grass lap of the field, then home: Fort York Blvd's sidewalk west,
  // Bathurst north over the bridge, into the courtyard for food-hall hour.
  { kind: "walk", departT: 4653 + SHIFT, arriveT: 5900 + SHIFT, via: LEG(CANOE_TO_COURTYARD) },
  { kind: "dwell", at: PLACES.courtyard, fromT: 5900 + SHIFT, toT: 6300 + SHIFT, radiusM: 3.4 },
];

/* ── The six kept moments ───────────────────────────────────────────────── */

const MOMENTS: MomentSpec[] = [
  {
    id: "m_st_courtyard",
    tStart: 150,
    tEnd: 265,
    placeLabel: "STACKT container courtyard",
    placePos: PLACES.courtyard,
    hue: SCENE_HUES.indoor,
    title: "Kickoff at the container market",
    summary:
      "The whole intake down on the turf with their laptops open, nobody an hour into anything yet, and the robot doing slow laps of the row like it already knew it was the demo.",
    people: ["Jess", "Ravi"],
    speechAt: [[4, 4.2], [12, 2.7], [18, 1.6], [39, 3.5], [61, 3.8], [87, 3.1]],
    laughterAt: [42, 90],
    keywords: [[39, "look at"]],
    /*
      ── THE REAL FRAMES, AND WHY THE DAY IS SHAPED THIS WAY ───────────────────
      Cut from the viewer screenshots in design/ by
      scripts/build-capture-frames.ts. All five are from ONE indoor hackathon —
      people on turf with laptops, long blue tables, a meal, a raw point cloud —
      so the first five moments of this trip are that hackathon, and the walk to
      the canoe starts afterwards. Each frame sits on a moment that describes it.

      An earlier pass spread these five across the ORIGINAL waterfront moments,
      which put a photograph of people at blue tables under "A very good dog
      intercepts the frisbee". Do not do that again: if a capture has no moment
      that honestly describes it, it keeps its procedural stand-in. Moment six is
      exactly that case — five frames, six moments.
    */
    frames: ["/mock/frames/sh-courtyard.webp"],
    tracks: [
      { trackId: "t_st_cy_jess", label: "person", tStart: 150, tEnd: 265, worldPos: at(PLACES.courtyard, -1.5, 0.88, 0.9), peakConfidence: 0.95, hz: 2.8, baseDepthM: 2.6 },
      { trackId: "t_st_cy_ravi", label: "person", tStart: 150, tEnd: 265, worldPos: at(PLACES.courtyard, 1.7, 0.9, 0.4), peakConfidence: 0.93, hz: 2.8, baseDepthM: 3.1 },
      { trackId: "t_st_cy_table", label: "dining table", tStart: 150, tEnd: 265, worldPos: at(PLACES.courtyard, 0.2, 0.4, 1.6), peakConfidence: 0.84, hz: 1.8, baseDepthM: 2.9 },
      { trackId: "t_st_cy_laptop", label: "laptop", tStart: 156, tEnd: 258, worldPos: at(PLACES.courtyard, -0.4, 0.52, 1.5), peakConfidence: 0.88, hz: 2.4, baseDepthM: 2.7 },
      { trackId: "t_st_cy_cup1", label: "cup", tStart: 152, tEnd: 262, worldPos: at(PLACES.courtyard, 0.8, 0.5, 1.4), peakConfidence: 0.77, hz: 2, baseDepthM: 2.8 },
      { trackId: "t_st_cy_cup2", label: "cup", tStart: 170, tEnd: 250, worldPos: at(PLACES.courtyard, -1.1, 0.5, 1.7), peakConfidence: 0.71, hz: 1.8, baseDepthM: 3.0, dropRate: 0.2 },
      { trackId: "t_st_cy_bag", label: "backpack", tStart: 150, tEnd: 265, worldPos: at(PLACES.courtyard, 2.3, 0.3, 1.1), peakConfidence: 0.82, hz: 1.8, baseDepthM: 3.4 },
    ],
    splat: {
      status: "ready",
      url: "/mock/splats/m_st_courtyard.spz",
      pointCount: 412_000,
      captureFrameCount: 224,
      bounds: { min: [-8, 0, -8], max: [8, 5, 8] },
    },
    vibe: { mood: "keyed-up", energy: 0.72, tags: ["hackathon", "containers", "kickoff", "coffee"] },
  },

  {
    id: "m_st_tables",
    tStart: 620,
    tEnd: 740,
    placeLabel: "The long tables",
    placePos: PLACES.courtyard,
    hue: SCENE_HUES.indoor,
    title: "The long tables fill up",
    summary:
      "Somebody found the long tables and ten minutes later there were no seats left. From up here it read like a floor plan nobody had agreed on.",
    people: ["Jess", "Ravi"],
    speechAt: [[6, 3.8], [19, 3.5], [44, 4.2], [71, 3.5], [96, 3.1]],
    laughterAt: [48, 100],
    keywords: [[44, "look at"]],
    frames: ["/mock/frames/sh-build-room.webp"],
    tracks: [
      { trackId: "t_st_tb_jess", label: "person", tStart: 620, tEnd: 740, worldPos: at(PLACES.courtyard, -2.2, 0.88, 1.4), peakConfidence: 0.94, hz: 2.6, baseDepthM: 3.2 },
      { trackId: "t_st_tb_ravi", label: "person", tStart: 620, tEnd: 740, worldPos: at(PLACES.courtyard, 2.6, 0.9, -0.6), peakConfidence: 0.92, hz: 2.6, baseDepthM: 3.8 },
      { trackId: "t_st_tb_table1", label: "dining table", tStart: 620, tEnd: 740, worldPos: at(PLACES.courtyard, 0.4, 0.4, 2.1), peakConfidence: 0.89, hz: 1.8, baseDepthM: 3.4 },
      { trackId: "t_st_tb_table2", label: "dining table", tStart: 624, tEnd: 736, worldPos: at(PLACES.courtyard, 4.8, 0.4, 3.6), peakConfidence: 0.8, hz: 1.6, baseDepthM: 6.9, dropRate: 0.2 },
      { trackId: "t_st_tb_laptop1", label: "laptop", tStart: 628, tEnd: 738, worldPos: at(PLACES.courtyard, -0.8, 0.52, 1.9), peakConfidence: 0.87, hz: 2.4, baseDepthM: 3.1 },
      { trackId: "t_st_tb_laptop2", label: "laptop", tStart: 640, tEnd: 730, worldPos: at(PLACES.courtyard, 3.9, 0.52, 3.2), peakConfidence: 0.76, hz: 2.2, baseDepthM: 6.4, dropRate: 0.22 },
      { trackId: "t_st_tb_chair", label: "chair", tStart: 620, tEnd: 740, worldPos: at(PLACES.courtyard, 1.6, 0.45, 2.6), peakConfidence: 0.83, hz: 1.8, baseDepthM: 4.0 },
      { trackId: "t_st_tb_bag", label: "backpack", tStart: 620, tEnd: 740, worldPos: at(PLACES.courtyard, -3.1, 0.28, 2.8), peakConfidence: 0.81, hz: 1.6, baseDepthM: 4.4 },
    ],
    splat: {
      status: "ready",
      url: "/mock/splats/m_st_tables.spz",
      pointCount: 388_000,
      captureFrameCount: 204,
      bounds: { min: [-9, 0, -9], max: [9, 6, 9] },
    },
    vibe: { mood: "gathering", energy: 0.58, tags: ["hackathon", "tables", "filling up", "overhead"] },
  },

  {
    id: "m_st_headsdown",
    tStart: 1180,
    tEnd: 1300,
    placeLabel: "The long tables, north end",
    placePos: PLACES.courtyard,
    hue: SCENE_HUES.indoor,
    title: "The room stops talking",
    summary:
      "It had been loud for an hour and then it wasn't — just fans, keys, and one person who had very clearly just found the bug.",
    people: ["Jess", "Ravi"],
    speechAt: [[5, 3.5], [23, 2.3], [47, 3.5], [78, 1.9], [103, 2.3]],
    laughterAt: [82],
    keywords: [[47, "look at"]],
    frames: ["/mock/frames/sh-build-room-close.webp"],
    tracks: [
      { trackId: "t_st_hd_jess", label: "person", tStart: 1180, tEnd: 1300, worldPos: at(PLACES.courtyard, -1.4, 0.88, 0.8), peakConfidence: 0.95, hz: 2.8, baseDepthM: 2.2 },
      { trackId: "t_st_hd_ravi", label: "person", tStart: 1186, tEnd: 1296, worldPos: at(PLACES.courtyard, 2.8, 0.9, 3.4), peakConfidence: 0.88, hz: 2.4, baseDepthM: 5.6, dropRate: 0.2 },
      { trackId: "t_st_hd_laptop", label: "laptop", tStart: 1180, tEnd: 1300, worldPos: at(PLACES.courtyard, -1.2, 0.55, 0.2), peakConfidence: 0.93, hz: 2.6, baseDepthM: 1.6 },
      { trackId: "t_st_hd_table", label: "dining table", tStart: 1180, tEnd: 1300, worldPos: at(PLACES.courtyard, 0, 0.42, 0.6), peakConfidence: 0.9, hz: 1.8, baseDepthM: 1.9 },
      { trackId: "t_st_hd_cup", label: "cup", tStart: 1192, tEnd: 1288, worldPos: at(PLACES.courtyard, 0.9, 0.52, 0.4), peakConfidence: 0.79, hz: 2, baseDepthM: 1.8 },
      { trackId: "t_st_hd_phone", label: "cell phone", tStart: 1204, tEnd: 1274, worldPos: at(PLACES.courtyard, -0.5, 0.5, 1.1), peakConfidence: 0.8, hz: 2.2, baseDepthM: 2.0, dropRate: 0.22 },
      { trackId: "t_st_hd_chair", label: "chair", tStart: 1180, tEnd: 1300, worldPos: at(PLACES.courtyard, 1.9, 0.45, 1.8), peakConfidence: 0.82, hz: 1.8, baseDepthM: 3.1 },
    ],
    splat: {
      status: "ready",
      url: "/mock/splats/m_st_headsdown.spz",
      pointCount: 431_000,
      captureFrameCount: 236,
      bounds: { min: [-10, 0, -10], max: [10, 5, 10] },
    },
    music: {
      trackName: "An Ending (Ascent)",
      artist: "Brian Eno",
      spotifyUri: "spotify:track:2XU0oxnq2qxCpomAAuJY8K",
      chosenBecause: "two minutes of near-silence with one laugh in it — it refused to score the room loudly",
    },
    vibe: { mood: "absorbed", energy: 0.21, tags: ["heads-down", "quiet", "laptops", "focus"] },
  },

  {
    id: "m_st_dinner",
    tStart: 1760,
    tEnd: 1880,
    placeLabel: "The food containers",
    placePos: PLACES.courtyard,
    hue: SCENE_HUES.golden,
    title: "Dinner out of a container window",
    summary:
      "Rice and eggs and far too many small bowls, eaten standing up at a table meant for laptops. Somebody's water bottle stayed behind on it.",
    people: ["Jess", "Ravi"],
    speechAt: [[8, 1.6], [17, 2.7], [35, 1.9], [59, 3.1], [88, 3.5], [106, 3.1]],
    laughterAt: [21, 40],
    keywords: [
      [59, "look at"],
      [106, "whose bottle"],
    ],
    frames: ["/mock/frames/sh-courtyard-meal.webp"],
    tracks: [
      { trackId: "t_st_dn_jess", label: "person", tStart: 1760, tEnd: 1880, worldPos: at(PLACES.courtyard, -1.6, 0.9, 0.8), peakConfidence: 0.94, hz: 2.6, baseDepthM: 2.4 },
      { trackId: "t_st_dn_ravi", label: "person", tStart: 1760, tEnd: 1880, worldPos: at(PLACES.courtyard, 1.9, 0.9, 0.2), peakConfidence: 0.93, hz: 2.6, baseDepthM: 2.8 },
      { trackId: "t_st_dn_table", label: "dining table", tStart: 1760, tEnd: 1880, worldPos: at(PLACES.courtyard, 0, 0.42, 0.9), peakConfidence: 0.91, hz: 1.8, baseDepthM: 1.9 },
      { trackId: "t_st_dn_bowl1", label: "bowl", tStart: 1764, tEnd: 1876, worldPos: at(PLACES.courtyard, 0.3, 0.52, 0.7), peakConfidence: 0.86, hz: 2.2, baseDepthM: 1.7 },
      { trackId: "t_st_dn_bowl2", label: "bowl", tStart: 1768, tEnd: 1870, worldPos: at(PLACES.courtyard, -0.4, 0.52, 1.0), peakConfidence: 0.8, hz: 2, baseDepthM: 1.8, dropRate: 0.2 },
      { trackId: "t_st_dn_spoon", label: "spoon", tStart: 1772, tEnd: 1848, worldPos: at(PLACES.courtyard, 0.8, 0.5, 0.6), peakConfidence: 0.7, hz: 1.8, baseDepthM: 1.6, dropRate: 0.26 },
      { trackId: "t_st_dn_cup", label: "cup", tStart: 1760, tEnd: 1880, worldPos: at(PLACES.courtyard, -1.0, 0.52, 0.5), peakConfidence: 0.78, hz: 2, baseDepthM: 1.8 },
      // The one left behind — this trip's "where is my bottle" answer, kept
      // through the re-theme. Authored ≤0.85 so Waterloo's snack-bar hero keeps
      // the crown.
      { trackId: "t_st_dn_bottle", label: "bottle", tStart: 1778, tEnd: 1880, worldPos: at(PLACES.courtyard, 1.2, 0.58, 1.3), peakConfidence: 0.84, hz: 2.2, baseDepthM: 2.1 },
    ],
    splat: {
      status: "ready",
      url: "/mock/splats/m_st_dinner.spz",
      pointCount: 402_000,
      captureFrameCount: 218,
      bounds: { min: [-9, 0, -9], max: [9, 6, 9] },
    },
    vibe: { mood: "unclenched", energy: 0.5, tags: ["food", "break", "containers", "evening"] },
  },

  {
    id: "m_st_demo",
    tStart: 2330,
    tEnd: 2450,
    placeLabel: "The demo table",
    placePos: PLACES.courtyard,
    hue: SCENE_HUES.dusk,
    title: "The demo table, still reconstructing",
    summary:
      "Two of us at the end of the table walking a judge through it for the fourth time. Four people moving through a small frame is the hardest thing to rebuild, so this one is still coming in.",
    people: ["Jess", "Ravi"],
    speechAt: [[7, 2.7], [22, 3.8], [51, 4.6], [83, 2.7]],
    laughterAt: [87],
    keywords: [[51, "look at"]],
    // The best pairing in the set, and the reason this moment is where it is:
    // the frame is a raw point cloud floating in black — sparse, floaters
    // everywhere, nowhere near converged — and this moment's splat status is
    // "processing". The picture and the status say the same thing.
    frames: ["/mock/frames/sh-demo-cloud.webp"],
    tracks: [
      { trackId: "t_st_dm_jess", label: "person", tStart: 2330, tEnd: 2450, worldPos: at(PLACES.courtyard, -1.6, 0.88, 0.8), peakConfidence: 0.94, hz: 2.6, baseDepthM: 2.3 },
      { trackId: "t_st_dm_ravi", label: "person", tStart: 2330, tEnd: 2450, worldPos: at(PLACES.courtyard, 1.0, 0.9, 1.0), peakConfidence: 0.92, hz: 2.6, baseDepthM: 2.6 },
      { trackId: "t_st_dm_judge", label: "person", tStart: 2348, tEnd: 2436, worldPos: at(PLACES.courtyard, 2.6, 0.9, 2.2), peakConfidence: 0.85, hz: 2.2, baseDepthM: 4.1, dropRate: 0.2 },
      { trackId: "t_st_dm_laptop", label: "laptop", tStart: 2330, tEnd: 2450, worldPos: at(PLACES.courtyard, -0.3, 0.55, -0.5), peakConfidence: 0.9, hz: 2.4, baseDepthM: 1.3 },
      { trackId: "t_st_dm_table", label: "dining table", tStart: 2330, tEnd: 2450, worldPos: at(PLACES.courtyard, 0, 0.44, -0.3), peakConfidence: 0.87, hz: 1.8, baseDepthM: 1.7 },
      { trackId: "t_st_dm_phone", label: "cell phone", tStart: 2342, tEnd: 2414, worldPos: at(PLACES.courtyard, 1.2, 1.24, 0.7), peakConfidence: 0.83, hz: 2.2, baseDepthM: 2.0 },
      { trackId: "t_st_dm_chair", label: "chair", tStart: 2330, tEnd: 2450, worldPos: at(PLACES.courtyard, -2.2, 0.45, 1.4), peakConfidence: 0.79, hz: 1.8, baseDepthM: 2.9 },
    ],
    splat: {
      status: "processing",
      note: "338 frames queued — four people moving through a small frame takes longer to converge than a still room.",
      captureFrameCount: 338,
    },
    music: {
      trackName: "Gold Lion",
      artist: "Yeah Yeah Yeahs",
      spotifyUri: "spotify:track:2gDLDpCUDvmwMdlKMFqzOU",
      chosenBecause: "the highest speech energy of the day with one laugh at the end of it — it stopped being careful",
    },
    vibe: { mood: "wired", energy: 0.71, tags: ["demo", "judges", "pitch", "table"] },
  },

  {
    id: "m_st_canoe",
    // The only moment on the walk, so it slides with the rest of it. The
    // hackathon runs first and this lands around 8 PM — which is when golden
    // hour in Toronto in August actually is.
    tStart: 4500 + SHIFT,
    tEnd: 4635 + SHIFT,
    placeLabel: "The red canoe, Canoe Landing",
    placePos: PLACES.canoe,
    hue: SCENE_HUES.golden,
    title: "Golden hour in the giant canoe",
    summary:
      "A nine-metre red canoe beached on a hill over the Gardiner, stern pointed at the skyline. We climbed in as the light went brass; a pickup soccer game supplied the soundtrack.",
    people: ["Jess", "Ravi"],
    speechAt: [[6, 3.5], [13, 5.8], [31, 4.2], [63, 3.5], [96, 3.5], [121, 2.3]],
    // Chained close enough to merge into ONE long candidate window — golden
    // hour giggles, not three separate blips the scorer would split.
    laughterAt: [16, 40, 66, 92, 118],
    keywords: [
      [31, "framing us"],
      [63, "look at"],
      [121, "remember this"],
    ],
    // NO FRAME. There are five captures and six moments, and all five are from
    // indoors — a red canoe on a hill at golden hour is the one thing none of
    // them can honestly be. It keeps its procedural stand-in.
    tracks: [
      { trackId: "t_st_cn_jess", label: "person", tStart: 4500 + SHIFT, tEnd: 4635 + SHIFT, worldPos: at(PLACES.canoe, -1.2, 1.1, 0.4), peakConfidence: 0.95, hz: 2.8, baseDepthM: 2.4 },
      { trackId: "t_st_cn_ravi", label: "person", tStart: 4500 + SHIFT, tEnd: 4635 + SHIFT, worldPos: at(PLACES.canoe, 1.4, 1.1, 0.1), peakConfidence: 0.94, hz: 2.8, baseDepthM: 2.8 },
      { trackId: "t_st_cn_phone", label: "cell phone", tStart: 4512 + SHIFT, tEnd: 4620 + SHIFT, worldPos: at(PLACES.canoe, -1.3, 1.5, 0.3), peakConfidence: 0.86, hz: 2.4, baseDepthM: 2.3 },
      { trackId: "t_st_cn_ball", label: "sports ball", tStart: 4506 + SHIFT, tEnd: 4628 + SHIFT, worldPos: at(PLACES.canoe, 8.4, 0.2, 6.6), peakConfidence: 0.7, hz: 2.6, baseDepthM: 12.4, dropRate: 0.26 },
      { trackId: "t_st_cn_player1", label: "person", tStart: 4504 + SHIFT, tEnd: 4630 + SHIFT, worldPos: at(PLACES.canoe, 9.8, 0.9, 7.4), peakConfidence: 0.78, hz: 2, baseDepthM: 14.0, dropRate: 0.2 },
      { trackId: "t_st_cn_player2", label: "person", tStart: 4508 + SHIFT, tEnd: 4626 + SHIFT, worldPos: at(PLACES.canoe, 11.6, 0.9, 5.8), peakConfidence: 0.74, hz: 2, baseDepthM: 15.8, dropRate: 0.24 },
      { trackId: "t_st_cn_skate", label: "skateboard", tStart: 4548 + SHIFT, tEnd: 4590 + SHIFT, worldPos: at(PLACES.canoe, -5.6, 0.15, 3.8), peakConfidence: 0.72, hz: 2.2, baseDepthM: 7.2, dropRate: 0.28 },
    ],
    splat: {
      status: "ready",
      url: "/mock/splats/m_st_canoe.spz",
      pointCount: 468_000,
      captureFrameCount: 252,
      bounds: { min: [-10, 0, -10], max: [10, 6, 10] },
    },
    music: {
      trackName: "Myth",
      artist: "Beach House",
      spotifyUri: "spotify:track:30Ux5PZ0PkPMdUlLtBkezX",
      chosenBecause: "golden hour, a skyline, and 'keep this one' said out loud — it went with the swell",
    },
    vibe: { mood: "golden", energy: 0.62, tags: ["canoe", "skyline", "golden hour", "soccer"] },
  },
];

/* ── Street life — the city thickening the detection stream ─────────────────
 *
 * None of these are moments. They are what the cameras actually see on a
 * ninety-minute city walk: streetcars and gulls, runners and race fleets,
 * dogs that are not Pesto. Some of them will fire candidates; stage 2 will
 * weigh them and mostly throw them out, which is exactly the honesty the
 * crossed-out pages exist to show. Positions sit near where the path is at
 * their timestamp, so every sighting is geographically true.
 */
const STREET_LIFE: TrackSpec[] = [
  // Front & Bathurst while we're still at the table: the 511 streetcar and traffic.
  { trackId: "t_sl_streetcar1", label: "bus", tStart: 84, tEnd: 102, worldPos: at(PLACES.courtyard, 26, 1.6, 14), peakConfidence: 0.85, hz: 1.8, baseDepthM: 30.0, dropRate: 0.2 },
  { trackId: "t_sl_truck1", label: "truck", tStart: 210, tEnd: 228, worldPos: at(PLACES.courtyard, 30, 1.4, 18), peakConfidence: 0.78, hz: 1.6, baseDepthM: 34.0, dropRate: 0.24 },
  // ── EVERYTHING BELOW HERE IS ON THE WALK, SO IT CARRIES `+ SHIFT` ──────────
  // The two above do not: they are Front & Bathurst seen from the table, during
  // the hackathon, and they are the only street life the robot can see while it
  // is parked in the yard. Every other sighting is positioned where the path is
  // at its timestamp, so a track that kept its old `t` would fire while the
  // robot was still indoors — a gull over a room full of laptops.
  // The Bathurst bridge: cyclists commuting home over the rail corridor.
  { trackId: "t_sl_bike1", label: "bicycle", tStart: 396 + SHIFT, tEnd: 420 + SHIFT, worldPos: at(P(43.6396, -79.40134), 2.2, 0.6, -3.0), peakConfidence: 0.83, hz: 2.4, baseDepthM: 4.8 },
  { trackId: "t_sl_bike2", label: "bicycle", tStart: 462 + SHIFT, tEnd: 480 + SHIFT, worldPos: at(P(43.6392, -79.40109), -2.6, 0.6, 2.1), peakConfidence: 0.79, hz: 2.2, baseDepthM: 5.6, dropRate: 0.2 },
  { trackId: "t_sl_rider1", label: "person", tStart: 396 + SHIFT, tEnd: 420 + SHIFT, worldPos: at(P(43.6396, -79.40134), 2.2, 1.1, -3.0), peakConfidence: 0.8, hz: 2.2, baseDepthM: 4.8 },
  // Fort York Blvd berm: dog walkers under the wall.
  { trackId: "t_sl_dog1", label: "dog", tStart: 700 + SHIFT, tEnd: 738 + SHIFT, worldPos: at(P(43.63892, -79.4028), 3.4, 0.4, -1.8), peakConfidence: 0.76, hz: 2.2, baseDepthM: 6.2, dropRate: 0.22 },
  { trackId: "t_sl_walker1", label: "person", tStart: 698 + SHIFT, tEnd: 742 + SHIFT, worldPos: at(P(43.63892, -79.4028), 4.1, 0.9, -2.2), peakConfidence: 0.81, hz: 2, baseDepthM: 6.8 },
  // Garrison Common on the way past: kite in the evening thermals.
  { trackId: "t_sl_kite1", label: "kite", tStart: 1560 + SHIFT, tEnd: 1640 + SHIFT, worldPos: at(PLACES.common, -18.0, 12.0, -10.0), peakConfidence: 0.66, hz: 1.6, baseDepthM: 26.0, dropRate: 0.3 },
  { trackId: "t_sl_kiteflyer", label: "person", tStart: 1556 + SHIFT, tEnd: 1648 + SHIFT, worldPos: at(PLACES.common, -14.5, 0.9, -6.2), peakConfidence: 0.77, hz: 1.8, baseDepthM: 18.0 },
  // Lake Shore at Strachan: rush-hour metal while we wait for the light.
  { trackId: "t_sl_car1", label: "car", tStart: 2064 + SHIFT, tEnd: 2086 + SHIFT, worldPos: at(P(43.6362, -79.4104), -4.0, 0.7, 3.2), peakConfidence: 0.87, hz: 2.6, baseDepthM: 7.0 },
  { trackId: "t_sl_car2", label: "car", tStart: 2090 + SHIFT, tEnd: 2108 + SHIFT, worldPos: at(P(43.6362, -79.4104), 5.2, 0.7, 3.6), peakConfidence: 0.84, hz: 2.4, baseDepthM: 8.4, dropRate: 0.2 },
  { trackId: "t_sl_bus1", label: "bus", tStart: 2118 + SHIFT, tEnd: 2136 + SHIFT, worldPos: at(P(43.6362, -79.4104), -7.6, 1.5, 4.0), peakConfidence: 0.82, hz: 1.8, baseDepthM: 10.2 },
  // The Martin Goodman Trail: runners and gulls all the way east.
  { trackId: "t_sl_runner1", label: "person", tStart: 2470 + SHIFT, tEnd: 2500 + SHIFT, worldPos: at(P(43.63385, -79.40595), 1.8, 0.9, -1.2), peakConfidence: 0.85, hz: 2.4, baseDepthM: 3.8 },
  { trackId: "t_sl_runner2", label: "person", tStart: 2740 + SHIFT, tEnd: 2768 + SHIFT, worldPos: at(P(43.6336, -79.4043), -2.0, 0.9, 1.4), peakConfidence: 0.83, hz: 2.4, baseDepthM: 4.2 },
  { trackId: "t_sl_runner3", label: "person", tStart: 3080 + SHIFT, tEnd: 3106 + SHIFT, worldPos: at(P(43.63345, -79.4025), 2.4, 0.9, -0.8), peakConfidence: 0.8, hz: 2.2, baseDepthM: 4.6, dropRate: 0.2 },
  { trackId: "t_sl_gull1", label: "bird", tStart: 2550 + SHIFT, tEnd: 2604 + SHIFT, worldPos: at(P(43.63385, -79.40595), -6.0, 3.8, -8.0), peakConfidence: 0.62, hz: 1.6, baseDepthM: 14.0, dropRate: 0.32 },
  { trackId: "t_sl_gull2", label: "bird", tStart: 2880 + SHIFT, tEnd: 2926 + SHIFT, worldPos: at(P(43.6335, -79.4034), -4.2, 3.2, -9.6), peakConfidence: 0.6, hz: 1.6, baseDepthM: 15.5, dropRate: 0.34 },
  { trackId: "t_sl_dog2", label: "dog", tStart: 2952 + SHIFT, tEnd: 2988 + SHIFT, worldPos: at(P(43.6335, -79.4034), 3.0, 0.4, 1.8), peakConfidence: 0.74, hz: 2, baseDepthM: 5.4, dropRate: 0.24 },
  // After the silos: the race fleet's stragglers, still tacking home.
  { trackId: "t_sl_boat4", label: "boat", tStart: 3620 + SHIFT, tEnd: 3680 + SHIFT, worldPos: at(P(43.6356, -79.3988), 10.0, 0.8, -24.0), peakConfidence: 0.71, hz: 1.8, baseDepthM: 36.0, dropRate: 0.28 },
  // CityPlace: scooter kids and an off-leash goldendoodle on the Fort York Blvd green.
  { trackId: "t_sl_skate2", label: "skateboard", tStart: 4160 + SHIFT, tEnd: 4196 + SHIFT, worldPos: at(P(43.63912, -79.3979), -2.8, 0.15, 1.6), peakConfidence: 0.75, hz: 2.2, baseDepthM: 5.0, dropRate: 0.26 },
  { trackId: "t_sl_skater2", label: "person", tStart: 4158 + SHIFT, tEnd: 4200 + SHIFT, worldPos: at(P(43.63912, -79.3979), -2.8, 0.9, 1.6), peakConfidence: 0.82, hz: 2.2, baseDepthM: 5.0 },
  { trackId: "t_sl_dog3", label: "dog", tStart: 4300 + SHIFT, tEnd: 4340 + SHIFT, worldPos: at(P(43.63922, -79.397), 3.6, 0.45, -2.0), peakConfidence: 0.78, hz: 2.2, baseDepthM: 5.8, dropRate: 0.2 },
  // The walk home: dusk streetcar over the bridge, patio crowd back at Front.
  { trackId: "t_sl_streetcar2", label: "bus", tStart: 5610 + SHIFT, tEnd: 5630 + SHIFT, worldPos: at(P(43.6396, -79.40134), 3.0, 1.6, -4.0), peakConfidence: 0.84, hz: 1.8, baseDepthM: 8.0, dropRate: 0.2 },
  { trackId: "t_sl_patio1", label: "person", tStart: 5760 + SHIFT, tEnd: 5860 + SHIFT, worldPos: at(P(43.64055, -79.40193), -4.4, 0.9, -2.6), peakConfidence: 0.79, hz: 1.8, baseDepthM: 7.2, dropRate: 0.22 },
  { trackId: "t_sl_patio2", label: "person", tStart: 5780 + SHIFT, tEnd: 5872 + SHIFT, worldPos: at(P(43.64055, -79.40193), -5.8, 0.9, -3.1), peakConfidence: 0.75, hz: 1.8, baseDepthM: 8.0, dropRate: 0.26 },
  { trackId: "t_sl_umbrella1", label: "umbrella", tStart: 5764 + SHIFT, tEnd: 5868 + SHIFT, worldPos: at(P(43.64055, -79.40193), -5.1, 2.1, -2.9), peakConfidence: 0.7, hz: 1.4, baseDepthM: 7.6, dropRate: 0.3 },
];

/* ── The spec ───────────────────────────────────────────────────────────── */

export const stacktMarket: TripSpec = {
  id: TRIP_ID,
  title: "STACKT to the red canoe",
  startedAt: STARTED_AT,
  durationSec: DURATION_SEC,
  place: {
    label: "STACKT Market & the waterfront",
    region: "Toronto, ON",
    country: "Canada",
    origin: { lat: 43.6408, lng: -79.4022 },
  },
  start: PLACES.courtyard,
  end: PLACES.courtyard,
  route: ROUTE,
  sampleSec: 3,
  moments: MOMENTS,
  extraTracks: STREET_LIFE,
  seeds: defaultSeeds(TRIP_ID),
};
