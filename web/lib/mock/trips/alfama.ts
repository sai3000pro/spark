/**
 * Alfama, Lisbon — 68 minutes uphill through the oldest quarter.
 *
 * A "postcard" trip. See the authoring rules in lib/mock/buildTrip.ts.
 * This one owns the single `processing` splat across the five light trips, so the
 * gallery and the album screen both have a reconstruction still cooking.
 */
import { at, defaultSeeds, type MomentSpec, type TripSpec } from "../buildTrip";
import type { RouteSegment } from "../generateRoutePath";
import { SCENE_HUES } from "../placeholder";
import {
  STAIRS_TO_TERRACE,
  START_TO_STAIRS,
  TERRACE_TO_TRAM,
  TRAM_TO_END,
} from "./alfama-route.gen";
import { makeLngLatToLocal } from "../../geo";
import type { Vec2 } from "../../types";

const TRIP_ID = "trip_alfama";
const DURATION_SEC = 4080; // 68 min

/** Real [lat, lng] → local metres. The whole file authors in coordinates. */
const P = makeLngLatToLocal({ origin: { lat: 38.7099, lng: -9.12966 }, bearingDeg: 0 });

/** A baked leg (alfama-route.gen.ts) → local-frame waypoints. */
const LEG = (pts: Array<[number, number]>): Vec2[] => pts.map(([lat, lng]) => P(lat, lng));

/** Real spots in the quarter, uphill in walking order. */
const PLACES = {
  start: P(38.7099, -9.12966), // Largo de São Rafael, low Alfama
  stairs: P(38.71156, -9.12931), // the tiled steps by São Miguel
  terrace: P(38.71174, -9.13022), // Miradouro de Santa Luzia
  tram: P(38.71306, -9.12974), // Rua das Escolas Gerais — tram 28's street
  end: P(38.7146, -9.1277), // Largo de São Vicente
};

/* ── The route — every leg SNAPPED to Alfama's real lanes ───────────────────
 *
 * The polylines live in alfama-route.gen.ts, baked from OpenStreetMap
 * foot-way data by scripts/bake-routes.mjs: the stepped becos off São Miguel,
 * the climb to Santa Luzia, and the tram-track street of Escolas Gerais. The
 * lanes are three metres wide and the route threads them exactly — nothing
 * cuts through a block. Slow leg speeds are the honest pace of Alfama:
 * everything is uphill and half of it is stairs.
 */
const ROUTE: RouteSegment[] = [
  // Coffee at São Rafael before committing to the hill.
  { kind: "dwell", at: PLACES.start, fromT: 0, toT: 230, radiusM: 2.6 },

  // Up through the lanes to the foot of the tiled stairs.
  { kind: "walk", departT: 230, arriveT: 542, via: LEG(START_TO_STAIRS) },
  // The staircase negotiation, then a long recovery with the cat.
  { kind: "dwell", at: PLACES.stairs, fromT: 542, toT: 1500, radiusM: 2.2 },

  // The last climb to the miradouro.
  { kind: "walk", departT: 1500, arriveT: 1780, via: LEG(STAIRS_TO_TERRACE) },
  // A long sit at Santa Luzia — the view, the guitar, the running capture.
  { kind: "dwell", at: PLACES.terrace, fromT: 1780, toT: 2800, radiusM: 2.8 },

  // Around to Escolas Gerais, where the 28 owns the street.
  { kind: "walk", departT: 2800, arriveT: 3192, via: LEG(TERRACE_TO_TRAM) },
  { kind: "dwell", at: PLACES.tram, fromT: 3192, toT: 3318, radiusM: 2.0 },

  // The tired final climb to São Vicente.
  { kind: "walk", departT: 3318, arriveT: 3960, via: LEG(TRAM_TO_END) },
  { kind: "dwell", at: PLACES.end, fromT: 3960, toT: 4080, radiusM: 2.4 },
];

const MOMENTS: MomentSpec[] = [
  {
    id: "m_al_stairs",
    tStart: 560,
    tEnd: 650,
    placeLabel: "The tiled stairs",
    placePos: PLACES.stairs,
    hue: SCENE_HUES.indoor,
    title: "The robot met its first staircase",
    summary:
      "Forty-one steps of azulejo, and a long negotiation about whether we were carrying it. We were, in the end.",
    people: ["Inês", "Rui"],
    speechAt: [[6, 2.7], [17, 2.7], [38, 1.9], [64, 3.1]],
    laughterAt: [21, 68],
    keywords: [[38, "take a corner"]],
    tracks: [
      { trackId: "t_al_st_ines", label: "person", tStart: 560, tEnd: 650, worldPos: at(PLACES.stairs, -1.2, 0.87, 0.9), peakConfidence: 0.95, hz: 2.6, baseDepthM: 2.1 },
      { trackId: "t_al_st_rui", label: "person", tStart: 560, tEnd: 650, worldPos: at(PLACES.stairs, 1.0, 0.9, 1.2), peakConfidence: 0.93, hz: 2.6, baseDepthM: 2.5 },
      { trackId: "t_al_st_bag", label: "backpack", tStart: 560, tEnd: 644, worldPos: at(PLACES.stairs, -1.6, 0.4, 1.5), peakConfidence: 0.82, hz: 2, baseDepthM: 2.3 },
      { trackId: "t_al_st_plant", label: "potted plant", tStart: 566, tEnd: 650, worldPos: at(PLACES.stairs, 2.4, 0.55, -0.8), peakConfidence: 0.77, hz: 1.8, baseDepthM: 3.6 },
      { trackId: "t_al_st_cat", label: "cat", tStart: 588, tEnd: 636, worldPos: at(PLACES.stairs, 3.2, 0.28, 1.8), peakConfidence: 0.71, hz: 2.2, baseDepthM: 4.4, dropRate: 0.28 },
    ],
    splat: {
      status: "ready",
      url: "/mock/splats/m_al_stairs.spz",
      pointCount: 268_000,
      captureFrameCount: 158,
      bounds: { min: [-5, 0, -5], max: [5, 4, 5] },
    },
    music: {
      trackName: "Bota Fogo",
      artist: "Seu Jorge",
      spotifyUri: "spotify:track:5CQ30WqJwcep0pYcV4AMNc",
      chosenBecause: "two bursts of laughter carrying something heavy uphill — it went for a groove",
    },
    vibe: { mood: "game", energy: 0.63, tags: ["stairs", "tiles", "teamwork", "narrow"] },
  },

  {
    id: "m_al_terrace",
    tStart: 1980,
    tEnd: 2085,
    placeLabel: "Miradouro terrace",
    placePos: PLACES.terrace,
    hue: SCENE_HUES.golden,
    title: "Rooftops all the way down to the water",
    summary:
      "The viewpoint everybody walks up for, and it earned it. Orange roofs, the river behind them, a guitar somewhere below.",
    people: ["Inês", "Rui"],
    speechAt: [[7, 3.1], [19, 1.9], [46, 1.9], [88, 2.7]],
    laughterAt: [24],
    keywords: [
      [7, "that's what"],
      [88, "leave it running"],
    ],
    tracks: [
      { trackId: "t_al_te_ines", label: "person", tStart: 1980, tEnd: 2085, worldPos: at(PLACES.terrace, -1.4, 0.88, 0.8), peakConfidence: 0.94, hz: 2.4, baseDepthM: 2.8 },
      { trackId: "t_al_te_rui", label: "person", tStart: 1982, tEnd: 2083, worldPos: at(PLACES.terrace, 1.1, 0.9, 1.0), peakConfidence: 0.92, hz: 2.4, baseDepthM: 3.1 },
      { trackId: "t_al_te_phone", label: "cell phone", tStart: 1994, tEnd: 2070, worldPos: at(PLACES.terrace, -1.5, 1.3, 0.4), peakConfidence: 0.85, hz: 2.2, baseDepthM: 2.4 },
      { trackId: "t_al_te_bottle", label: "bottle", tStart: 1988, tEnd: 2062, worldPos: at(PLACES.terrace, 0.4, 0.62, 1.6), peakConfidence: 0.78, hz: 2, baseDepthM: 1.7 },
      { trackId: "t_al_te_bench", label: "bench", tStart: 1980, tEnd: 2085, worldPos: at(PLACES.terrace, 2.6, 0.44, 2.2), peakConfidence: 0.83, hz: 1.6, baseDepthM: 3.9 },
    ],
    // The one still-cooking reconstruction across the five light trips.
    splat: {
      status: "processing",
      captureFrameCount: 297,
      note: "297 frames queued — a wide viewpoint takes longer to converge than a close scene.",
    },
    music: {
      trackName: "Barco Negro",
      artist: "Amália Rodrigues",
      spotifyUri: "spotify:track:6bqZQXcaFYtEQGxRlSFqmS",
      chosenBecause: "a long still window over a city, with guitar bleeding in from below — it did not fight it",
    },
    vibe: { mood: "open", energy: 0.27, tags: ["viewpoint", "rooftops", "river", "guitar"] },
  },

  {
    id: "m_al_tram",
    tStart: 3210,
    tEnd: 3300,
    placeLabel: "Tram 28 crossing",
    placePos: PLACES.tram,
    hue: SCENE_HUES.dusk,
    title: "Flattened against a wall for the 28",
    summary:
      "The tram takes the whole street, so everyone becomes part of the wall for ten seconds. The robot learned this the hard way.",
    people: ["Inês", "Rui"],
    speechAt: [[8, 2.7], [16, 3.1], [34, 2.3], [61, 2.3]],
    laughterAt: [39, 66],
    keywords: [[34, "look at"]],
    tracks: [
      { trackId: "t_al_tr_ines", label: "person", tStart: 3210, tEnd: 3300, worldPos: at(PLACES.tram, -1.0, 0.87, 1.4), peakConfidence: 0.93, hz: 2.6, baseDepthM: 2.0 },
      { trackId: "t_al_tr_rui", label: "person", tStart: 3210, tEnd: 3300, worldPos: at(PLACES.tram, 0.8, 0.9, 1.6), peakConfidence: 0.91, hz: 2.6, baseDepthM: 2.2 },
      { trackId: "t_al_tr_tram", label: "bus", tStart: 3224, tEnd: 3272, worldPos: at(PLACES.tram, 0.6, 1.6, -4.2), peakConfidence: 0.88, hz: 2.4, baseDepthM: 6.1 },
      { trackId: "t_al_tr_bike", label: "motorcycle", tStart: 3212, tEnd: 3258, worldPos: at(PLACES.tram, 3.4, 0.6, 2.4), peakConfidence: 0.76, hz: 2, baseDepthM: 5.2, dropRate: 0.24 },
      { trackId: "t_al_tr_bag", label: "backpack", tStart: 3210, tEnd: 3296, worldPos: at(PLACES.tram, -1.4, 0.32, 1.8), peakConfidence: 0.74, hz: 1.8, baseDepthM: 2.4 },
    ],
    splat: {
      status: "ready",
      url: "/mock/splats/m_al_tram.spz",
      pointCount: 231_000,
      captureFrameCount: 141,
      bounds: { min: [-5, 0, -5], max: [5, 3.5, 5] },
    },
    vibe: { mood: "startled", energy: 0.74, tags: ["tram", "narrow", "close-call", "street"] },
  },
];

export const alfama: TripSpec = {
  id: TRIP_ID,
  title: "Uphill through Alfama",
  startedAt: "2026-05-23T16:05:00+01:00",
  durationSec: DURATION_SEC,
  place: {
    label: "Alfama",
    region: "Lisbon",
    country: "Portugal",
    // The authoring anchor: Largo de São Rafael, where the walk starts. The
    // route is authored from real coordinates (bearing 0), so the walk sits
    // on Alfama's actual lanes by construction — no calibration nudging.
    origin: { lat: 38.7099, lng: -9.12966 },
  },
  start: PLACES.start,
  end: PLACES.end,
  route: ROUTE,
  sampleSec: 3,
  moments: MOMENTS,
  seeds: defaultSeeds(TRIP_ID),
};
