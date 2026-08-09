/**
 * STACKT Market & the waterfront — the flagship walk. 105 minutes from the
 * container market at Bathurst & Front, down over the rail bridge to Fort
 * York, across Garrison Common, through Coronation Park, east along the
 * Martin Goodman Trail past the Canada Malting silos, up through CityPlace to
 * the red canoe at Canoe Landing, and home to the market for food-hall hour.
 *
 * This is the trip the walk screen shows, so it is authored DEEP:
 *
 *   · the route is street-following — waypoints below are real coordinates
 *     read off Bathurst St, Fort York Blvd, the park paths and the waterfront
 *     trail, converted to the robot's local frame by lngLatToLocal. The
 *     odometry generator (generateRoutePath) traces them with layered wander
 *     and sensor jitter at a 3-second cadence, so the drawn walk weaves along
 *     real roads and cuts across real grass instead of flying straight lines
 *     between pins.
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
const DURATION_SEC = 6300; // 105 min
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
  // Kickoff at the market (moment 1 lives in this dwell).
  { kind: "dwell", at: PLACES.courtyard, fromT: 0, toT: 283, radiusM: 3.2 },

  // Down Bathurst's sidewalk, over the rail bridge, the signalled crossing at
  // Fort York Blvd, and the fort's own paths up to the western ramparts.
  { kind: "walk", departT: 283, arriveT: 972, via: LEG(COURTYARD_TO_RAMPARTS) },
  { kind: "dwell", at: PLACES.ramparts, fromT: 972, toT: 1123, radiusM: 2.6 },

  // Out the west gate onto Garrison Common's lawn.
  { kind: "walk", departT: 1123, arriveT: 1382, via: LEG(RAMPARTS_TO_COMMON) },
  { kind: "dwell", at: PLACES.common, fromT: 1382, toT: 1533, radiusM: 3.6 },

  // Strachan's sidewalk south, the Lake Shore crossing, into Coronation Park.
  { kind: "walk", departT: 1533, arriveT: 2202, via: LEG(COMMON_TO_MAPLES) },
  { kind: "dwell", at: PLACES.maples, fromT: 2202, toT: 2363, radiusM: 2.6 },

  // Down to the water: Remembrance Drive and the Martin Goodman Trail past
  // the yacht club, up Stadium Road to the silos at Bathurst Quay.
  { kind: "walk", departT: 2363, arriveT: 3342, via: LEG(MAPLES_TO_SILOS) },
  { kind: "dwell", at: PLACES.silos, fromT: 3342, toT: 3498, radiusM: 2.2 },

  // Queens Quay, then Dan Leckie Way north through CityPlace to Canoe Landing.
  { kind: "walk", departT: 3498, arriveT: 4482, via: LEG(SILOS_TO_CANOE) },
  { kind: "dwell", at: PLACES.canoe, fromT: 4482, toT: 4653, radiusM: 2.4 },

  // A slow grass lap of the field, then home: Fort York Blvd's sidewalk west,
  // Bathurst north over the bridge, into the courtyard for food-hall hour.
  { kind: "walk", departT: 4653, arriveT: 5900, via: LEG(CANOE_TO_COURTYARD) },
  { kind: "dwell", at: PLACES.courtyard, fromT: 5900, toT: 6300, radiusM: 3.4 },
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
      "Laptops open on a picnic table between two shipping containers, the demo plan argued out loud, and the robot doing slow circles like it already knew it was the demo.",
    people: ["Jess", "Ravi"],
    transcript: [
      [4, "Ravi", "Okay. Route check. Fort, park, water, canoe, back here for food."],
      [12, "Jess", "And it just… follows? The whole way?"],
      [18, "You", "A metre behind. Watch."],
      [39, "Jess", "It's doing laps of the table. It's showing off."],
      [61, "Ravi", "If it keeps the sunset bit I'll forgive the laps."],
      [87, "You", "It decides, not me. That's the whole point."],
    ],
    laughterAt: [42, 90],
    keywords: [[39, "look at"]],
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
    id: "m_st_ramparts",
    tStart: 990,
    tEnd: 1105,
    placeLabel: "Fort York ramparts",
    placePos: PLACES.ramparts,
    hue: SCENE_HUES.park,
    title: "Cannons at closing time",
    summary:
      "The fort was ten minutes from closing, so the whole 1813 garrison belonged to three people and a robot. Ravi read the plaque voice-first; the cannon did not return fire.",
    people: ["Jess", "Ravi"],
    transcript: [
      [7, "Ravi", "‘The battle lasted six hours.’ We've been walking for twelve minutes."],
      [21, "Jess", "It's scanning the cannon. It thinks the cannon is a person."],
      [38, "You", "It knows it's not a person. It thinks it's interesting."],
      [66, "Ravi", "The robot and I disagree about the cannon."],
      [92, "Jess", "Two hundred years of history and you two are fighting about a tube."],
    ],
    laughterAt: [24, 95],
    keywords: [[21, "look at"]],
    tracks: [
      { trackId: "t_st_rp_jess", label: "person", tStart: 990, tEnd: 1105, worldPos: at(PLACES.ramparts, -1.8, 0.9, 0.6), peakConfidence: 0.94, hz: 2.6, baseDepthM: 2.8 },
      { trackId: "t_st_rp_ravi", label: "person", tStart: 990, tEnd: 1105, worldPos: at(PLACES.ramparts, 1.4, 0.9, -0.8), peakConfidence: 0.92, hz: 2.6, baseDepthM: 3.2 },
      { trackId: "t_st_rp_book", label: "book", tStart: 998, tEnd: 1080, worldPos: at(PLACES.ramparts, 1.2, 1.05, -0.6), peakConfidence: 0.74, hz: 1.8, baseDepthM: 3.0, dropRate: 0.22 },
      { trackId: "t_st_rp_bench", label: "bench", tStart: 990, tEnd: 1105, worldPos: at(PLACES.ramparts, -3.4, 0.42, 2.2), peakConfidence: 0.79, hz: 1.6, baseDepthM: 5.1 },
      { trackId: "t_st_rp_bird", label: "bird", tStart: 1012, tEnd: 1064, worldPos: at(PLACES.ramparts, 2.8, 2.4, -3.5), peakConfidence: 0.62, hz: 1.8, baseDepthM: 9.4, dropRate: 0.3 },
    ],
    splat: {
      status: "ready",
      url: "/mock/splats/m_st_ramparts.spz",
      pointCount: 388_000,
      captureFrameCount: 204,
      bounds: { min: [-9, 0, -9], max: [9, 6, 9] },
    },
    vibe: { mood: "wry", energy: 0.44, tags: ["fort", "history", "cannons", "empty"] },
  },

  {
    id: "m_st_common",
    tStart: 1400,
    tEnd: 1515,
    placeLabel: "Garrison Common lawn",
    placePos: PLACES.common,
    hue: SCENE_HUES.field,
    title: "A very good dog intercepts the frisbee",
    summary:
      "Someone else's whippet decided our frisbee game had a fielding gap and closed it at forty kilometres an hour. Its owner apologized. Nobody wanted the apology.",
    people: ["Jess", "Ravi", "the whippet's owner"],
    transcript: [
      [5, "Jess", "Okay, gentle one to start—"],
      [9, "Ravi", "DOG. Incoming. Dog dog dog."],
      [15, "You", "It caught it. Out of the air. Are you seeing this?"],
      [33, "the whippet's owner", "Sorry — she does this — Pesto, DROP."],
      [52, "Jess", "Pesto keeps the frisbee. I've decided. It's hers now."],
      [84, "Ravi", "The robot got the whole catch. Frame perfect. I checked."],
    ],
    laughterAt: [17, 55, 88],
    keywords: [[15, "are you seeing this"]],
    tracks: [
      { trackId: "t_st_cm_jess", label: "person", tStart: 1400, tEnd: 1515, worldPos: at(PLACES.common, -2.6, 0.9, 1.2), peakConfidence: 0.95, hz: 2.8, baseDepthM: 3.4 },
      { trackId: "t_st_cm_ravi", label: "person", tStart: 1400, tEnd: 1515, worldPos: at(PLACES.common, 3.1, 0.9, -1.4), peakConfidence: 0.93, hz: 2.8, baseDepthM: 4.2 },
      { trackId: "t_st_cm_owner", label: "person", tStart: 1418, tEnd: 1498, worldPos: at(PLACES.common, 5.4, 0.9, 2.8), peakConfidence: 0.84, hz: 2.2, baseDepthM: 6.8 },
      { trackId: "t_st_cm_dog", label: "dog", tStart: 1406, tEnd: 1508, worldPos: at(PLACES.common, 1.8, 0.4, 0.6), peakConfidence: 0.9, hz: 3.0, baseDepthM: 4.0 },
      { trackId: "t_st_cm_frisbee", label: "frisbee", tStart: 1402, tEnd: 1510, worldPos: at(PLACES.common, 0.6, 1.3, -0.8), peakConfidence: 0.76, hz: 3.2, baseDepthM: 5.0, dropRate: 0.3 },
      { trackId: "t_st_cm_bag", label: "backpack", tStart: 1400, tEnd: 1512, worldPos: at(PLACES.common, -3.8, 0.28, 2.4), peakConfidence: 0.8, hz: 1.6, baseDepthM: 4.6 },
    ],
    splat: {
      status: "ready",
      url: "/mock/splats/m_st_common.spz",
      pointCount: 431_000,
      captureFrameCount: 236,
      bounds: { min: [-10, 0, -10], max: [10, 5, 10] },
    },
    music: {
      trackName: "Walking On A Dream",
      artist: "Empire of the Sun",
      spotifyUri: "spotify:track:2fXKyAyPrEa24c6PJyqznV",
      chosenBecause: "a dog at full sprint on open grass, three bursts of laughter — the chorus was already happening",
    },
    vibe: { mood: "delighted", energy: 0.88, tags: ["frisbee", "dog", "lawn", "interception"] },
  },

  {
    id: "m_st_maples",
    tStart: 2220,
    tEnd: 2345,
    placeLabel: "Coronation Park maples",
    placePos: PLACES.maples,
    hue: SCENE_HUES.park,
    title: "The geese hold Coronation Park",
    summary:
      "Forty Canada geese between us and the water, entirely unbothered. We ate under the 1937 maples and negotiated passage. A water bottle was left on the bench as tribute.",
    people: ["Jess", "Ravi"],
    transcript: [
      [6, "Ravi", "That is not a flock. That is a garrison."],
      [19, "Jess", "They're not moving. They know they don't have to move."],
      [41, "You", "The robot's giving them two metres. Smart."],
      [70, "Jess", "These trees went in for the coronation. Nineteen thirty-seven."],
      [104, "Ravi", "Wait — whose bottle is that on the bench? Did we—"],
    ],
    laughterAt: [22, 74],
    keywords: [
      [6, "look at"],
      [104, "whose bottle"],
    ],
    tracks: [
      { trackId: "t_st_mp_jess", label: "person", tStart: 2220, tEnd: 2345, worldPos: at(PLACES.maples, -1.6, 0.9, 0.8), peakConfidence: 0.94, hz: 2.6, baseDepthM: 2.9 },
      { trackId: "t_st_mp_ravi", label: "person", tStart: 2220, tEnd: 2345, worldPos: at(PLACES.maples, 1.9, 0.9, 0.2), peakConfidence: 0.93, hz: 2.6, baseDepthM: 3.3 },
      { trackId: "t_st_mp_goose1", label: "bird", tStart: 2224, tEnd: 2340, worldPos: at(PLACES.maples, 4.2, 0.3, -3.8), peakConfidence: 0.81, hz: 2.6, baseDepthM: 6.8 },
      { trackId: "t_st_mp_goose2", label: "bird", tStart: 2228, tEnd: 2338, worldPos: at(PLACES.maples, 5.6, 0.3, -2.9), peakConfidence: 0.77, hz: 2.4, baseDepthM: 7.9 },
      { trackId: "t_st_mp_goose3", label: "bird", tStart: 2236, tEnd: 2332, worldPos: at(PLACES.maples, 3.4, 0.3, -5.1), peakConfidence: 0.72, hz: 2.2, baseDepthM: 8.6, dropRate: 0.2 },
      { trackId: "t_st_mp_goose4", label: "bird", tStart: 2249, tEnd: 2320, worldPos: at(PLACES.maples, 6.8, 0.3, -4.4), peakConfidence: 0.65, hz: 2, baseDepthM: 10.2, dropRate: 0.28 },
      { trackId: "t_st_mp_bench", label: "bench", tStart: 2220, tEnd: 2345, worldPos: at(PLACES.maples, -2.8, 0.42, 1.9), peakConfidence: 0.82, hz: 1.8, baseDepthM: 3.6 },
      // The tribute. Last seen here — the "where's my bottle" answer for this
      // trip. Authored ≤0.85 so Waterloo's snack-bar hero keeps the crown.
      { trackId: "t_st_mp_bottle", label: "bottle", tStart: 2238, tEnd: 2345, worldPos: at(PLACES.maples, -2.6, 0.58, 1.7), peakConfidence: 0.84, hz: 2.2, baseDepthM: 3.4 },
      { trackId: "t_st_mp_sandwich", label: "sandwich", tStart: 2244, tEnd: 2310, worldPos: at(PLACES.maples, -1.2, 0.55, 1.2), peakConfidence: 0.73, hz: 1.8, baseDepthM: 2.8, dropRate: 0.24 },
    ],
    splat: {
      status: "ready",
      url: "/mock/splats/m_st_maples.spz",
      pointCount: 402_000,
      captureFrameCount: 218,
      bounds: { min: [-9, 0, -9], max: [9, 6, 9] },
    },
    vibe: { mood: "amused truce", energy: 0.5, tags: ["geese", "maples", "picnic", "waterfront"] },
  },

  {
    id: "m_st_silos",
    tStart: 3360,
    tEnd: 3480,
    placeLabel: "Canada Malting silos",
    placePos: PLACES.silos,
    hue: SCENE_HUES.water,
    title: "Sails past the silos",
    summary:
      "The 1928 silos on one side, the island airport on the other, and a Wednesday-night race fleet threading between — a dozen sails heeled over in the channel wind.",
    people: ["Jess", "Ravi"],
    transcript: [
      [8, "Jess", "Okay, the ruin-and-sailboats combination is unfair."],
      [24, "Ravi", "They're racing. Look, they all turned at once."],
      [47, "You", "That one's going to cut inside — watch, watch—"],
      [79, "Jess", "The little one won the corner. David and Goliath rules."],
      [102, "Ravi", "A plane, a fleet, and a hundred-year-old silo. One frame."],
    ],
    laughterAt: [50],
    keywords: [
      [24, "look at"],
      [102, "one frame"],
    ],
    tracks: [
      { trackId: "t_st_sl_jess", label: "person", tStart: 3360, tEnd: 3480, worldPos: at(PLACES.silos, -1.4, 0.9, 0.7), peakConfidence: 0.94, hz: 2.6, baseDepthM: 2.7 },
      { trackId: "t_st_sl_ravi", label: "person", tStart: 3360, tEnd: 3480, worldPos: at(PLACES.silos, 1.6, 0.9, 0.3), peakConfidence: 0.92, hz: 2.6, baseDepthM: 3.0 },
      { trackId: "t_st_sl_boat1", label: "boat", tStart: 3366, tEnd: 3474, worldPos: at(PLACES.silos, 6.5, 0.8, -14.0), peakConfidence: 0.83, hz: 2.2, baseDepthM: 22.0 },
      { trackId: "t_st_sl_boat2", label: "boat", tStart: 3372, tEnd: 3468, worldPos: at(PLACES.silos, 11.2, 0.8, -18.5), peakConfidence: 0.78, hz: 2, baseDepthM: 30.5, dropRate: 0.2 },
      { trackId: "t_st_sl_boat3", label: "boat", tStart: 3390, tEnd: 3460, worldPos: at(PLACES.silos, 2.8, 0.7, -20.2), peakConfidence: 0.69, hz: 1.8, baseDepthM: 34.8, dropRate: 0.3 },
      { trackId: "t_st_sl_gull", label: "bird", tStart: 3396, tEnd: 3441, worldPos: at(PLACES.silos, -3.1, 4.2, -6.4), peakConfidence: 0.6, hz: 1.6, baseDepthM: 11.0, dropRate: 0.34 },
      { trackId: "t_st_sl_bike", label: "bicycle", tStart: 3428, tEnd: 3452, worldPos: at(PLACES.silos, -4.8, 0.6, 2.2), peakConfidence: 0.8, hz: 2.4, baseDepthM: 5.2 },
    ],
    splat: {
      status: "processing",
      note: "Large scene — water surfaces reconstruct last.",
      captureFrameCount: 246,
    },
    music: {
      trackName: "Pink + White",
      artist: "Frank Ocean",
      spotifyUri: "spotify:track:3xKsf9qdS1CyvXSMEid6g8",
      chosenBecause: "low sun on open water and nobody talking much — it matched the light, not the fleet",
    },
    vibe: { mood: "wind-quiet", energy: 0.38, tags: ["sailboats", "silos", "channel", "island airport"] },
  },

  {
    id: "m_st_canoe",
    tStart: 4500,
    tEnd: 4635,
    placeLabel: "The red canoe, Canoe Landing",
    placePos: PLACES.canoe,
    hue: SCENE_HUES.golden,
    title: "Golden hour in the giant canoe",
    summary:
      "A nine-metre red canoe beached on a hill over the Gardiner, stern pointed at the skyline. We climbed in as the light went brass; a pickup soccer game supplied the soundtrack.",
    people: ["Jess", "Ravi"],
    transcript: [
      [6, "Jess", "We're allowed in it, right? Everyone gets in it?"],
      [13, "Ravi", "It's a canoe on a hill over a highway. It exists to be gotten into."],
      [31, "You", "Robot's holding the bow angle. It's framing us with the towers."],
      [63, "Jess", "The light. Look at the light on the glass."],
      [96, "Ravi", "Demo's over. This is the product. This, right here."],
      [121, "You", "Remember this one. Keep this one."],
    ],
    // Chained close enough to merge into ONE long candidate window — golden
    // hour giggles, not three separate blips the scorer would split.
    laughterAt: [16, 40, 66, 92, 118],
    keywords: [
      [31, "framing us"],
      [63, "look at"],
      [121, "remember this"],
    ],
    tracks: [
      { trackId: "t_st_cn_jess", label: "person", tStart: 4500, tEnd: 4635, worldPos: at(PLACES.canoe, -1.2, 1.1, 0.4), peakConfidence: 0.95, hz: 2.8, baseDepthM: 2.4 },
      { trackId: "t_st_cn_ravi", label: "person", tStart: 4500, tEnd: 4635, worldPos: at(PLACES.canoe, 1.4, 1.1, 0.1), peakConfidence: 0.94, hz: 2.8, baseDepthM: 2.8 },
      { trackId: "t_st_cn_phone", label: "cell phone", tStart: 4512, tEnd: 4620, worldPos: at(PLACES.canoe, -1.3, 1.5, 0.3), peakConfidence: 0.86, hz: 2.4, baseDepthM: 2.3 },
      { trackId: "t_st_cn_ball", label: "sports ball", tStart: 4506, tEnd: 4628, worldPos: at(PLACES.canoe, 8.4, 0.2, 6.6), peakConfidence: 0.7, hz: 2.6, baseDepthM: 12.4, dropRate: 0.26 },
      { trackId: "t_st_cn_player1", label: "person", tStart: 4504, tEnd: 4630, worldPos: at(PLACES.canoe, 9.8, 0.9, 7.4), peakConfidence: 0.78, hz: 2, baseDepthM: 14.0, dropRate: 0.2 },
      { trackId: "t_st_cn_player2", label: "person", tStart: 4508, tEnd: 4626, worldPos: at(PLACES.canoe, 11.6, 0.9, 5.8), peakConfidence: 0.74, hz: 2, baseDepthM: 15.8, dropRate: 0.24 },
      { trackId: "t_st_cn_skate", label: "skateboard", tStart: 4548, tEnd: 4590, worldPos: at(PLACES.canoe, -5.6, 0.15, 3.8), peakConfidence: 0.72, hz: 2.2, baseDepthM: 7.2, dropRate: 0.28 },
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
  // The Bathurst bridge: cyclists commuting home over the rail corridor.
  { trackId: "t_sl_bike1", label: "bicycle", tStart: 396, tEnd: 420, worldPos: at(P(43.6396, -79.40134), 2.2, 0.6, -3.0), peakConfidence: 0.83, hz: 2.4, baseDepthM: 4.8 },
  { trackId: "t_sl_bike2", label: "bicycle", tStart: 462, tEnd: 480, worldPos: at(P(43.6392, -79.40109), -2.6, 0.6, 2.1), peakConfidence: 0.79, hz: 2.2, baseDepthM: 5.6, dropRate: 0.2 },
  { trackId: "t_sl_rider1", label: "person", tStart: 396, tEnd: 420, worldPos: at(P(43.6396, -79.40134), 2.2, 1.1, -3.0), peakConfidence: 0.8, hz: 2.2, baseDepthM: 4.8 },
  // Fort York Blvd berm: dog walkers under the wall.
  { trackId: "t_sl_dog1", label: "dog", tStart: 700, tEnd: 738, worldPos: at(P(43.63892, -79.4028), 3.4, 0.4, -1.8), peakConfidence: 0.76, hz: 2.2, baseDepthM: 6.2, dropRate: 0.22 },
  { trackId: "t_sl_walker1", label: "person", tStart: 698, tEnd: 742, worldPos: at(P(43.63892, -79.4028), 4.1, 0.9, -2.2), peakConfidence: 0.81, hz: 2, baseDepthM: 6.8 },
  // Garrison Common after the frisbee: kite in the evening thermals.
  { trackId: "t_sl_kite1", label: "kite", tStart: 1560, tEnd: 1640, worldPos: at(PLACES.common, -18.0, 12.0, -10.0), peakConfidence: 0.66, hz: 1.6, baseDepthM: 26.0, dropRate: 0.3 },
  { trackId: "t_sl_kiteflyer", label: "person", tStart: 1556, tEnd: 1648, worldPos: at(PLACES.common, -14.5, 0.9, -6.2), peakConfidence: 0.77, hz: 1.8, baseDepthM: 18.0 },
  // Lake Shore at Strachan: rush-hour metal while we wait for the light.
  { trackId: "t_sl_car1", label: "car", tStart: 2064, tEnd: 2086, worldPos: at(P(43.6362, -79.4104), -4.0, 0.7, 3.2), peakConfidence: 0.87, hz: 2.6, baseDepthM: 7.0 },
  { trackId: "t_sl_car2", label: "car", tStart: 2090, tEnd: 2108, worldPos: at(P(43.6362, -79.4104), 5.2, 0.7, 3.6), peakConfidence: 0.84, hz: 2.4, baseDepthM: 8.4, dropRate: 0.2 },
  { trackId: "t_sl_bus1", label: "bus", tStart: 2118, tEnd: 2136, worldPos: at(P(43.6362, -79.4104), -7.6, 1.5, 4.0), peakConfidence: 0.82, hz: 1.8, baseDepthM: 10.2 },
  // The Martin Goodman Trail: runners and gulls all the way east.
  { trackId: "t_sl_runner1", label: "person", tStart: 2470, tEnd: 2500, worldPos: at(P(43.63385, -79.40595), 1.8, 0.9, -1.2), peakConfidence: 0.85, hz: 2.4, baseDepthM: 3.8 },
  { trackId: "t_sl_runner2", label: "person", tStart: 2740, tEnd: 2768, worldPos: at(P(43.6336, -79.4043), -2.0, 0.9, 1.4), peakConfidence: 0.83, hz: 2.4, baseDepthM: 4.2 },
  { trackId: "t_sl_runner3", label: "person", tStart: 3080, tEnd: 3106, worldPos: at(P(43.63345, -79.4025), 2.4, 0.9, -0.8), peakConfidence: 0.8, hz: 2.2, baseDepthM: 4.6, dropRate: 0.2 },
  { trackId: "t_sl_gull1", label: "bird", tStart: 2550, tEnd: 2604, worldPos: at(P(43.63385, -79.40595), -6.0, 3.8, -8.0), peakConfidence: 0.62, hz: 1.6, baseDepthM: 14.0, dropRate: 0.32 },
  { trackId: "t_sl_gull2", label: "bird", tStart: 2880, tEnd: 2926, worldPos: at(P(43.6335, -79.4034), -4.2, 3.2, -9.6), peakConfidence: 0.6, hz: 1.6, baseDepthM: 15.5, dropRate: 0.34 },
  { trackId: "t_sl_dog2", label: "dog", tStart: 2952, tEnd: 2988, worldPos: at(P(43.6335, -79.4034), 3.0, 0.4, 1.8), peakConfidence: 0.74, hz: 2, baseDepthM: 5.4, dropRate: 0.24 },
  // After the silos: the race fleet's stragglers, still tacking home.
  { trackId: "t_sl_boat4", label: "boat", tStart: 3620, tEnd: 3680, worldPos: at(P(43.6356, -79.3988), 10.0, 0.8, -24.0), peakConfidence: 0.71, hz: 1.8, baseDepthM: 36.0, dropRate: 0.28 },
  // CityPlace: scooter kids and an off-leash goldendoodle on the Fort York Blvd green.
  { trackId: "t_sl_skate2", label: "skateboard", tStart: 4160, tEnd: 4196, worldPos: at(P(43.63912, -79.3979), -2.8, 0.15, 1.6), peakConfidence: 0.75, hz: 2.2, baseDepthM: 5.0, dropRate: 0.26 },
  { trackId: "t_sl_skater2", label: "person", tStart: 4158, tEnd: 4200, worldPos: at(P(43.63912, -79.3979), -2.8, 0.9, 1.6), peakConfidence: 0.82, hz: 2.2, baseDepthM: 5.0 },
  { trackId: "t_sl_dog3", label: "dog", tStart: 4300, tEnd: 4340, worldPos: at(P(43.63922, -79.397), 3.6, 0.45, -2.0), peakConfidence: 0.78, hz: 2.2, baseDepthM: 5.8, dropRate: 0.2 },
  // The walk home: dusk streetcar over the bridge, patio crowd back at Front.
  { trackId: "t_sl_streetcar2", label: "bus", tStart: 5610, tEnd: 5630, worldPos: at(P(43.6396, -79.40134), 3.0, 1.6, -4.0), peakConfidence: 0.84, hz: 1.8, baseDepthM: 8.0, dropRate: 0.2 },
  { trackId: "t_sl_patio1", label: "person", tStart: 5760, tEnd: 5860, worldPos: at(P(43.64055, -79.40193), -4.4, 0.9, -2.6), peakConfidence: 0.79, hz: 1.8, baseDepthM: 7.2, dropRate: 0.22 },
  { trackId: "t_sl_patio2", label: "person", tStart: 5780, tEnd: 5872, worldPos: at(P(43.64055, -79.40193), -5.8, 0.9, -3.1), peakConfidence: 0.75, hz: 1.8, baseDepthM: 8.0, dropRate: 0.26 },
  { trackId: "t_sl_umbrella1", label: "umbrella", tStart: 5764, tEnd: 5868, worldPos: at(P(43.64055, -79.40193), -5.1, 2.1, -2.9), peakConfidence: 0.7, hz: 1.4, baseDepthM: 7.6, dropRate: 0.3 },
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
