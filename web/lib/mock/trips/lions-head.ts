/**
 * Lion's Head, Cape Town — 61 minutes up the spiral path.
 *
 * A "postcard" trip, and the southern-hemisphere pin on the globe.
 * See the authoring rules in lib/mock/buildTrip.ts.
 */
import { at, defaultSeeds, type MomentSpec, type TripSpec } from "../buildTrip";
import { SCENE_HUES } from "../placeholder";
import type { Vec2 } from "../../types";

const TRIP_ID = "trip_lions_head";
const DURATION_SEC = 3660; // 61 min

const PLACES = {
  start: [40, 520] as Vec2,
  contour: [220, 400] as Vec2,
  chains: [430, 230] as Vec2,
  summit: [560, 70] as Vec2,
  end: [545, 95] as Vec2,
};

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
    transcript: [
      [7, "Marcus", "Oh — okay. Okay, that's the whole bay."],
      [22, "Thandi", "Told you to wait for the corner."],
      [55, "You", "Hold on, let it catch up, it's got the good angle."],
      [84, "Marcus", "It does have the good angle."],
    ],
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
    transcript: [
      [8, "Thandi", "It cannot do this. There is no version where it does this."],
      [21, "Marcus", "Straps. We brought straps for exactly this."],
      [52, "You", "Nobody let go. Nobody let go!"],
      [88, "Thandi", "Never again. Beautiful. Never again."],
    ],
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
    transcript: [
      [14, "Marcus", "There it goes."],
      [40, "Thandi", "The mountain's gone completely pink."],
      [78, "You", "Don't say anything. Let it get all of this."],
      [108, "Marcus", "Worth the chain. Worth all of it."],
    ],
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
    origin: { lat: -33.935, lng: 18.389 },
  },
  start: PLACES.start,
  end: PLACES.end,
  moments: MOMENTS,
  seeds: defaultSeeds(TRIP_ID),
};
