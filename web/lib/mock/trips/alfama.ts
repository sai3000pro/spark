/**
 * Alfama, Lisbon — 68 minutes uphill through the oldest quarter.
 *
 * A "postcard" trip. See the authoring rules in lib/mock/buildTrip.ts.
 * This one owns the single `processing` splat across the five light trips, so the
 * gallery and the album screen both have a reconstruction still cooking.
 */
import { at, defaultSeeds, type MomentSpec, type TripSpec } from "../buildTrip";
import { SCENE_HUES } from "../placeholder";
import type { Vec2 } from "../../types";

const TRIP_ID = "trip_alfama";
const DURATION_SEC = 4080; // 68 min

const PLACES = {
  start: [60, 480] as Vec2,
  stairs: [190, 360] as Vec2,
  terrace: [380, 200] as Vec2,
  tram: [250, 90] as Vec2,
  end: [120, 60] as Vec2,
};

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
    transcript: [
      [6, "Rui", "It's looking at the stairs. It knows."],
      [17, "Inês", "It does not know, it's a robot."],
      [38, "You", "Alright, everybody take a corner."],
      [64, "Rui", "This is the most exercise it's given anyone."],
    ],
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
    transcript: [
      [7, "Inês", "There. That's what I was trying to describe."],
      [19, "You", "You did not describe this."],
      [46, "Rui", "Is someone playing down there?"],
      [88, "Inês", "Leave it running, I want the sound."],
    ],
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
    transcript: [
      [8, "Rui", "Back, back, back — against the wall."],
      [16, "Inês", "Is it going to move? It's not moving."],
      [34, "You", "It moved. Look at it go."],
      [61, "Rui", "That was closer than I'd like."],
    ],
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
    // Nudged uphill so the whole authored shape stays on Alfama's streets —
    // at the old anchor the first minutes printed in the Tagus.
    origin: { lat: 38.7138, lng: -9.1308 },
  },
  start: PLACES.start,
  end: PLACES.end,
  moments: MOMENTS,
  seeds: defaultSeeds(TRIP_ID),
};
