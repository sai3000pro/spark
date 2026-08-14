/**
 * Higashiyama, Kyoto — 74 minutes through the temple district at first light.
 *
 * A "postcard" trip. See the authoring rules in lib/mock/buildTrip.ts.
 */
import { at, defaultSeeds, type MomentSpec, type TripSpec } from "../buildTrip";
import type { RouteSegment } from "../generateRoutePath";
import { SCENE_HUES } from "../placeholder";
import {
  BAMBOO_TO_END,
  GATE_TO_BAMBOO,
  LANE_TO_GATE,
  START_TO_LANE,
} from "./higashiyama-route.gen";
import { makeLngLatToLocal } from "../../geo";
import type { Vec2 } from "../../types";

const TRIP_ID = "trip_higashiyama";
const DURATION_SEC = 4440; // 74 min

/** Real [lat, lng] → local metres. The whole file authors in coordinates. */
const P = makeLngLatToLocal({ origin: { lat: 35.00095, lng: 135.77867 }, bearingDeg: 0 });

/** A baked leg (higashiyama-route.gen.ts) → local-frame waypoints. */
const LEG = (pts: Array<[number, number]>): Vec2[] => pts.map(([lat, lng]) => P(lat, lng));

/** Real spots in the temple district, in walking order. */
const PLACES = {
  start: P(35.00095, 135.77867), // Ishibe-kōji lane
  lane: P(34.9987, 135.7808), // Ninenzaka, before the shops open
  gate: P(34.9949, 135.7846), // Kiyomizu-dera's vermilion Niōmon
  bamboo: P(34.9996, 135.7805), // the bamboo cut by Kōdai-ji
  end: P(35.0008, 135.7801), // Nene-no-Michi
};

/* ── The route — every leg SNAPPED to the district's real lanes ─────────────
 *
 * The polylines live in higashiyama-route.gen.ts, baked from OpenStreetMap
 * foot-way data by scripts/bake-routes.mjs: Ishibe-kōji's flagstones,
 * Ninenzaka and Sannenzaka's steps, the climb up Kiyomizu-zaka to the gate,
 * and the lanes back down past Kōdai-ji. Dawn pace — every leg is an amble,
 * and nothing cuts through a temple wall.
 */
const ROUTE: RouteSegment[] = [
  // Standing in Ishibe-kōji while the light comes up.
  { kind: "dwell", at: PLACES.start, fromT: 0, toT: 80, radiusM: 2.2 },

  // Down the flagstones to an empty Ninenzaka.
  { kind: "walk", departT: 80, arriveT: 602, via: LEG(START_TO_LANE) },
  // The moment, then photographing the whole street before anyone comes.
  { kind: "dwell", at: PLACES.lane, fromT: 602, toT: 1300, radiusM: 2.6 },

  // Up Sannenzaka and Kiyomizu-zaka to the vermilion gate.
  { kind: "walk", departT: 1300, arriveT: 2122, via: LEG(LANE_TO_GATE) },
  { kind: "dwell", at: PLACES.gate, fromT: 2122, toT: 2266, radiusM: 2.4 },

  // The long drift back down through the lanes to the bamboo by Kōdai-ji.
  { kind: "walk", departT: 2266, arriveT: 3542, via: LEG(GATE_TO_BAMBOO) },
  { kind: "dwell", at: PLACES.bamboo, fromT: 3542, toT: 3683, radiusM: 2.2 },

  // Out to Nene-no-Michi for tea.
  { kind: "walk", departT: 3683, arriveT: 3980, via: LEG(BAMBOO_TO_END) },
  { kind: "dwell", at: PLACES.end, fromT: 3980, toT: 4440, radiusM: 2.6 },
];

const MOMENTS: MomentSpec[] = [
  {
    id: "m_hg_lane",
    tStart: 620,
    tEnd: 715,
    placeLabel: "Ninenzaka, before the shops open",
    placePos: PLACES.lane,
    hue: SCENE_HUES.indoor,
    title: "The whole street to ourselves",
    summary:
      "Six in the morning on a stone lane that is impassable by ten. Wooden shopfronts, nobody in them, and one very committed cat.",
    people: ["Haruka", "Ben"],
    speechAt: [[5, 3.5], [18, 2.7], [44, 3.5], [72, 1.9]],
    laughterAt: [22, 76],
    keywords: [[44, "get this"]],
    tracks: [
      { trackId: "t_hg_ln_haruka", label: "person", tStart: 620, tEnd: 715, worldPos: at(PLACES.lane, -1.3, 0.86, 1.0), peakConfidence: 0.94, hz: 2.4, baseDepthM: 2.6 },
      { trackId: "t_hg_ln_ben", label: "person", tStart: 622, tEnd: 713, worldPos: at(PLACES.lane, 1.1, 0.9, 1.3), peakConfidence: 0.92, hz: 2.4, baseDepthM: 2.9 },
      { trackId: "t_hg_ln_cat", label: "cat", tStart: 640, tEnd: 700, worldPos: at(PLACES.lane, 2.8, 0.26, -1.6), peakConfidence: 0.83, hz: 2.4, baseDepthM: 4.1, dropRate: 0.22 },
      { trackId: "t_hg_ln_plant", label: "potted plant", tStart: 620, tEnd: 715, worldPos: at(PLACES.lane, -2.6, 0.5, -0.4), peakConfidence: 0.78, hz: 1.6, baseDepthM: 3.4 },
      { trackId: "t_hg_ln_umbrella", label: "umbrella", tStart: 628, tEnd: 706, worldPos: at(PLACES.lane, 0.4, 0.95, 0.6), peakConfidence: 0.75, hz: 2, baseDepthM: 1.9 },
    ],
    splat: {
      status: "ready",
      url: "/mock/splats/m_hg_lane.spz",
      pointCount: 386_000,
      captureFrameCount: 202,
      bounds: { min: [-6, 0, -6], max: [6, 4.5, 6] },
    },
    music: {
      trackName: "Merry Christmas Mr. Lawrence",
      artist: "Ryuichi Sakamoto",
      spotifyUri: "spotify:track:2Xb4rZWkkGgZuVLoIeGtCU",
      chosenBecause: "an empty street at dawn with two voices in it — anything louder would have been wrong",
    },
    vibe: { mood: "hushed", energy: 0.19, tags: ["dawn", "stone-lane", "empty", "wooden-fronts"] },
  },

  {
    id: "m_hg_gate",
    tStart: 2140,
    tEnd: 2248,
    placeLabel: "Under the vermilion gate",
    placePos: PLACES.gate,
    hue: SCENE_HUES.golden,
    title: "Counting gates until we stopped counting",
    summary:
      "The tunnel of torii, where the light strobes as you walk and every photo looks the same and you take forty anyway.",
    people: ["Haruka", "Ben"],
    speechAt: [[9, 3.1], [24, 1.6], [58, 2.7], [92, 1.9]],
    laughterAt: [63, 96],
    keywords: [[58, "lost count"]],
    tracks: [
      { trackId: "t_hg_gt_haruka", label: "person", tStart: 2140, tEnd: 2248, worldPos: at(PLACES.gate, -1.0, 0.86, 0.6), peakConfidence: 0.95, hz: 2.6, baseDepthM: 2.2 },
      { trackId: "t_hg_gt_ben", label: "person", tStart: 2140, tEnd: 2248, worldPos: at(PLACES.gate, 0.9, 0.9, 1.4), peakConfidence: 0.93, hz: 2.6, baseDepthM: 2.8 },
      { trackId: "t_hg_gt_phone", label: "cell phone", tStart: 2152, tEnd: 2236, worldPos: at(PLACES.gate, -1.1, 1.3, 0.2), peakConfidence: 0.86, hz: 2.4, baseDepthM: 1.8 },
      { trackId: "t_hg_gt_bag", label: "backpack", tStart: 2140, tEnd: 2244, worldPos: at(PLACES.gate, 1.2, 0.3, 1.9), peakConfidence: 0.8, hz: 1.8, baseDepthM: 3.0 },
      { trackId: "t_hg_gt_book", label: "book", tStart: 2168, tEnd: 2222, worldPos: at(PLACES.gate, -1.8, 0.78, 1.1), peakConfidence: 0.68, hz: 1.8, baseDepthM: 2.4, dropRate: 0.26 },
    ],
    splat: {
      status: "ready",
      url: "/mock/splats/m_hg_gate.spz",
      pointCount: 441_000,
      captureFrameCount: 236,
      bounds: { min: [-4, 0, -12], max: [4, 5, 12] },
    },
    music: {
      trackName: "Kiara",
      artist: "Bonobo",
      spotifyUri: "spotify:track:0Q0LxKGE1PgqAcVCcXeLmA",
      chosenBecause: "a repeating structure you walk through at a steady pace — it matched the cadence",
    },
    vibe: { mood: "rhythmic", energy: 0.44, tags: ["torii", "repetition", "strobing-light", "walking"] },
  },

  {
    id: "m_hg_bamboo",
    tStart: 3560,
    tEnd: 3665,
    placeLabel: "The bamboo cut",
    placePos: PLACES.bamboo,
    hue: SCENE_HUES.park,
    title: "It sounded like weather",
    summary:
      "Thirty metres of bamboo moving in wind you cannot feel at ground level. The audio track is better than the video and everyone knew it.",
    people: ["Haruka", "Ben"],
    speechAt: [[11, 2.7], [30, 4.2], [68, 3.5], [96, 2.3]],
    laughterAt: [15],
    keywords: [
      [68, "let it get this"],
      [96, "for the album"],
    ],
    tracks: [
      { trackId: "t_hg_bm_haruka", label: "person", tStart: 3560, tEnd: 3665, worldPos: at(PLACES.bamboo, -1.5, 0.86, 0.9), peakConfidence: 0.92, hz: 2.2, baseDepthM: 3.0 },
      { trackId: "t_hg_bm_ben", label: "person", tStart: 3562, tEnd: 3663, worldPos: at(PLACES.bamboo, 1.3, 0.9, 1.2), peakConfidence: 0.9, hz: 2.2, baseDepthM: 3.3 },
      { trackId: "t_hg_bm_bench", label: "bench", tStart: 3560, tEnd: 3665, worldPos: at(PLACES.bamboo, -3.0, 0.44, 2.0), peakConfidence: 0.81, hz: 1.6, baseDepthM: 4.6 },
      { trackId: "t_hg_bm_bottle", label: "bottle", tStart: 3572, tEnd: 3648, worldPos: at(PLACES.bamboo, -2.8, 0.6, 1.6), peakConfidence: 0.76, hz: 2, baseDepthM: 4.1 },
      { trackId: "t_hg_bm_phone", label: "cell phone", tStart: 3586, tEnd: 3652, worldPos: at(PLACES.bamboo, 1.4, 1.28, 0.8), peakConfidence: 0.79, hz: 2.2, baseDepthM: 2.9 },
    ],
    splat: {
      status: "ready",
      url: "/mock/splats/m_hg_bamboo.spz",
      pointCount: 512_000,
      captureFrameCount: 264,
      bounds: { min: [-7, 0, -7], max: [7, 9, 7] },
    },
    music: {
      trackName: "Avril 14th",
      artist: "Aphex Twin",
      spotifyUri: "spotify:track:1USaAsUuPxxsFRHqLKvwCU",
      chosenBecause: "the loudest thing in the window was wind, so it picked something that would sit under it",
    },
    vibe: { mood: "still", energy: 0.15, tags: ["bamboo", "wind", "audio-first", "green-light"] },
  },
];

export const higashiyama: TripSpec = {
  id: TRIP_ID,
  title: "Higashiyama at first light",
  startedAt: "2026-04-09T05:50:00+09:00",
  durationSec: DURATION_SEC,
  place: {
    label: "Higashiyama",
    region: "Kyoto",
    country: "Japan",
    // The authoring anchor: Ishibe-kōji, where the walk starts. The route is
    // authored from real coordinates (bearing 0) — no calibration.
    origin: { lat: 35.00095, lng: 135.77867 },
  },
  start: PLACES.start,
  end: PLACES.end,
  route: ROUTE,
  sampleSec: 3,
  moments: MOMENTS,
  seeds: defaultSeeds(TRIP_ID),
};
