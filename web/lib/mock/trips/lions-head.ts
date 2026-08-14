/**
 * Lion's Head, Cape Town — 61 minutes up the spiral path.
 *
 * A "postcard" trip, and the southern-hemisphere pin on the globe.
 * See the authoring rules in lib/mock/buildTrip.ts.
 */
import { at, defaultSeeds, type MomentSpec, type TripSpec } from "../buildTrip";
import type { RouteSegment } from "../generateRoutePath";
import { SCENE_HUES } from "../placeholder";
import {
  CHAINS_TO_SUMMIT,
  CONTOUR_TO_CHAINS,
  START_TO_CONTOUR,
  SUMMIT_TO_END,
} from "./lions-head-route.gen";
import { makeLngLatToLocal } from "../../geo";
import type { Vec2 } from "../../types";

const TRIP_ID = "trip_lions_head";
const DURATION_SEC = 3660; // 61 min

/** Real [lat, lng] → local metres. The whole file authors in coordinates. */
const P = makeLngLatToLocal({ origin: { lat: -33.93691, lng: 18.3949 }, bearingDeg: 0 });

/** A baked leg (lions-head-route.gen.ts) → local-frame waypoints. */
const LEG = (pts: Array<[number, number]>): Vec2[] => pts.map(([lat, lng]) => P(lat, lng));

/** Real spots on the mountain, trailhead to summit. */
const PLACES = {
  start: P(-33.93691, 18.3949), // the trailhead off Signal Hill Rd
  contour: P(-33.93967, 18.39117), // the switchback where Camps Bay opens
  chains: P(-33.93615, 18.3902), // the chain section, upper east face
  summit: P(-33.93504, 18.38914), // Lion's Head peak
  end: P(-33.9352, 18.389), // the summit rocks, a step off the beacon
};

/* ── The route — the real spiral path, baked from OSM ───────────────────────
 *
 * The polylines live in lions-head-route.gen.ts (scripts/bake-routes.mjs):
 * the wide track that corkscrews up from Signal Hill Rd, the singletrack
 * around the west face, and the chain scramble to the summit plateau. Leg
 * speeds fall as the mountain steepens — 1.1 m/s on the lower track, ~0.7
 * hauling the robot up the chains.
 */
const ROUTE: RouteSegment[] = [
  { kind: "dwell", at: PLACES.start, fromT: 0, toT: 30, radiusM: 2.0 },

  // Up the track to the first switchback with the whole bay below.
  { kind: "walk", departT: 30, arriveT: 522, via: LEG(START_TO_CONTOUR) },
  { kind: "dwell", at: PLACES.contour, fromT: 522, toT: 807, radiusM: 2.6 },

  // Around the west face on the narrowing singletrack.
  { kind: "walk", departT: 807, arriveT: 1662, via: LEG(CONTOUR_TO_CHAINS) },
  // The moment, then the honest queue at the bottom of the chains.
  { kind: "dwell", at: PLACES.chains, fromT: 1662, toT: 2400, radiusM: 2.2 },

  // The scramble itself — forty kilos of robot, hand over hand.
  { kind: "walk", departT: 2400, arriveT: 2742, via: LEG(CHAINS_TO_SUMMIT) },
  { kind: "dwell", at: PLACES.summit, fromT: 2742, toT: 2898, radiusM: 2.4 },

  // Picking across the summit rocks to sit facing Table Mountain.
  { kind: "walk", departT: 2898, arriveT: 3000, via: LEG(SUMMIT_TO_END) },
  // Sunset. The whole reason for the climb.
  { kind: "dwell", at: PLACES.end, fromT: 3000, toT: 3660, radiusM: 2.6 },
];

const MOMENTS: MomentSpec[] = [
  {
    id: "m_lh_contour",
    tStart: 540,
    tEnd: 640,
    placeLabel: "The contour path, west side",
    placePos: PLACES.contour,
    hue: SCENE_HUES.field,
    title: "Halfway round and the whole bay opened up",
    summary:
      "The path wraps the mountain, so the view arrives all at once rather than gradually. Everyone stopped without discussing it.",
    people: ["Thandi", "Marcus"],
    speechAt: [[7, 3.1], [22, 2.7], [55, 4.2], [84, 2.3]],
    laughterAt: [27],
    keywords: [[55, "let it catch up"]],
    tracks: [
      { trackId: "t_lh_ct_thandi", label: "person", tStart: 540, tEnd: 640, worldPos: at(PLACES.contour, -1.4, 0.88, 0.9), peakConfidence: 0.94, hz: 2.4, baseDepthM: 2.7 },
      { trackId: "t_lh_ct_marcus", label: "person", tStart: 542, tEnd: 638, worldPos: at(PLACES.contour, 1.2, 0.9, 1.2), peakConfidence: 0.92, hz: 2.4, baseDepthM: 3.0 },
      { trackId: "t_lh_ct_bag", label: "backpack", tStart: 540, tEnd: 634, worldPos: at(PLACES.contour, -1.8, 0.34, 1.4), peakConfidence: 0.83, hz: 1.8, baseDepthM: 2.9 },
      { trackId: "t_lh_ct_bottle", label: "bottle", tStart: 556, tEnd: 626, worldPos: at(PLACES.contour, 0.6, 0.62, 0.8), peakConfidence: 0.8, hz: 2.2, baseDepthM: 1.6 },
      { trackId: "t_lh_ct_phone", label: "cell phone", tStart: 566, tEnd: 630, worldPos: at(PLACES.contour, 1.3, 1.3, 0.6), peakConfidence: 0.82, hz: 2.2, baseDepthM: 2.5 },
    ],
    splat: {
      status: "ready",
      url: "/mock/splats/m_lh_contour.spz",
      pointCount: 412_000,
      captureFrameCount: 214,
      bounds: { min: [-9, 0, -9], max: [9, 4, 9] },
    },
    music: {
      trackName: "Ndikhokhele",
      artist: "The Soil",
      spotifyUri: "spotify:track:0nJW01T7XtvILxQgC5J7Wh",
      chosenBecause: "a long stop with a view and low speech — it went for something with height in it",
    },
    vibe: { mood: "elated", energy: 0.41, tags: ["bay", "contour-path", "reveal", "wind"] },
  },

  {
    id: "m_lh_chains",
    tStart: 1680,
    tEnd: 1785,
    placeLabel: "The chain section",
    placePos: PLACES.chains,
    hue: SCENE_HUES.indoor,
    title: "Hauling forty kilos of robot up a chain",
    summary:
      "The scramble everyone warns you about, done twice — once for us and once for the thing that was supposed to be following us.",
    people: ["Thandi", "Marcus"],
    speechAt: [[8, 4.6], [21, 2.7], [52, 2.3], [88, 1.9]],
    laughterAt: [25, 92],
    keywords: [[21, "we brought straps"]],
    tracks: [
      { trackId: "t_lh_ch_thandi", label: "person", tStart: 1680, tEnd: 1785, worldPos: at(PLACES.chains, -0.9, 0.86, 0.7), peakConfidence: 0.95, hz: 2.8, baseDepthM: 1.8 },
      { trackId: "t_lh_ch_marcus", label: "person", tStart: 1680, tEnd: 1785, worldPos: at(PLACES.chains, 0.8, 0.9, 1.0), peakConfidence: 0.94, hz: 2.8, baseDepthM: 2.1 },
      { trackId: "t_lh_ch_bag", label: "backpack", tStart: 1680, tEnd: 1778, worldPos: at(PLACES.chains, -1.2, 0.36, 1.3), peakConfidence: 0.85, hz: 2, baseDepthM: 2.2 },
      { trackId: "t_lh_ch_rope", label: "handbag", tStart: 1692, tEnd: 1766, worldPos: at(PLACES.chains, 1.4, 0.5, 0.4), peakConfidence: 0.66, hz: 1.8, baseDepthM: 1.5, dropRate: 0.3 },
      { trackId: "t_lh_ch_bird", label: "bird", tStart: 1714, tEnd: 1762, worldPos: at(PLACES.chains, 6.2, 4.4, -8.0), peakConfidence: 0.61, hz: 1.8, baseDepthM: 14.0, dropRate: 0.32 },
    ],
    splat: {
      status: "ready",
      url: "/mock/splats/m_lh_chains.spz",
      pointCount: 254_000,
      captureFrameCount: 146,
      bounds: { min: [-4, 0, -4], max: [4, 5, 4] },
    },
    vibe: { mood: "frantic", energy: 0.88, tags: ["scramble", "chains", "hauling", "exposed"] },
  },

  {
    id: "m_lh_summit",
    tStart: 2760,
    tEnd: 2880,
    placeLabel: "The summit rocks",
    placePos: PLACES.summit,
    hue: SCENE_HUES.golden,
    title: "Table Mountain went pink and nobody spoke",
    summary:
      "The reason for the whole thing. Sunset from the top, the city on one side, the Atlantic on the other, and a very long silence.",
    people: ["Thandi", "Marcus"],
    speechAt: [[14, 1.6], [40, 1.9], [78, 3.5], [108, 2.7]],
    keywords: [
      [78, "let it get"],
      [108, "worth"],
    ],
    laughterAt: [112],
    tracks: [
      { trackId: "t_lh_sm_thandi", label: "person", tStart: 2760, tEnd: 2880, worldPos: at(PLACES.summit, -1.6, 0.88, -1.0), peakConfidence: 0.93, hz: 2.2, baseDepthM: 3.2 },
      { trackId: "t_lh_sm_marcus", label: "person", tStart: 2762, tEnd: 2878, worldPos: at(PLACES.summit, 0.8, 0.9, -1.3), peakConfidence: 0.91, hz: 2.2, baseDepthM: 3.6 },
      { trackId: "t_lh_sm_phone", label: "cell phone", tStart: 2782, tEnd: 2862, worldPos: at(PLACES.summit, -1.7, 1.32, -1.2), peakConfidence: 0.84, hz: 2.2, baseDepthM: 2.8 },
      { trackId: "t_lh_sm_bag", label: "backpack", tStart: 2760, tEnd: 2874, worldPos: at(PLACES.summit, 2.2, 0.28, 1.4), peakConfidence: 0.79, hz: 1.8, baseDepthM: 4.0 },
      { trackId: "t_lh_sm_cake", label: "sandwich", tStart: 2798, tEnd: 2854, worldPos: at(PLACES.summit, 0.2, 0.68, 1.0), peakConfidence: 0.64, hz: 1.8, baseDepthM: 1.4, dropRate: 0.26 },
    ],
    splat: {
      status: "ready",
      url: "/mock/splats/m_lh_summit.spz",
      pointCount: 468_000,
      captureFrameCount: 248,
      bounds: { min: [-10, 0, -10], max: [10, 4, 10] },
    },
    music: {
      trackName: "Pata Pata",
      artist: "Miriam Makeba",
      spotifyUri: "spotify:track:3FCto7hnn1shUyZL42YgfO",
      chosenBecause: "the longest dwell of the trip, almost no speech, and one laugh right at the end",
    },
    vibe: { mood: "awed", energy: 0.16, tags: ["summit", "sunset", "atlantic", "silence"] },
  },
];

export const lionsHead: TripSpec = {
  id: TRIP_ID,
  title: "Lion's Head at sunset",
  startedAt: "2026-02-17T17:25:00+02:00",
  durationSec: DURATION_SEC,
  place: {
    label: "Lion's Head",
    region: "Cape Town",
    country: "South Africa",
    // The authoring anchor: the Signal Hill Rd trailhead, where the walk
    // starts. The route is authored from real coordinates (bearing 0).
    origin: { lat: -33.93691, lng: 18.3949 },
  },
  start: PLACES.start,
  end: PLACES.end,
  route: ROUTE,
  sampleSec: 3,
  moments: MOMENTS,
  seeds: defaultSeeds(TRIP_ID),
};
