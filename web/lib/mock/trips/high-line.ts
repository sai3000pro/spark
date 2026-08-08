/**
 * The High Line, Manhattan — 52 minutes along an elevated railbed turned park.
 *
 * A "postcard" trip: 3 moments, short transcripts, 4–5 tracks each. Waterloo Park
 * is the deep one; these exist to fill the gallery and spread pins across the
 * globe. See the authoring rules in lib/mock/buildTrip.ts before editing.
 *
 * Paired with Brooklyn Bridge Park so the globe's pin clustering has two trips in
 * one metro area to collapse.
 */
import { at, defaultSeeds, type MomentSpec, type TripSpec } from "../buildTrip";
import { SCENE_HUES } from "../placeholder";
import type { Vec2 } from "../../types";

const TRIP_ID = "trip_high_line";
const DURATION_SEC = 3120; // 52 min

/** Local metres. The line runs roughly south → north, so +south decreases. */
const PLACES = {
  start: [40, 520] as Vec2,
  overlook: [130, 430] as Vec2,
  lawn: [300, 260] as Vec2,
  spur: [470, 90] as Vec2,
  end: [520, 40] as Vec2,
};

const MOMENTS: MomentSpec[] = [
  {
    id: "m_hl_overlook",
    tStart: 430,
    tEnd: 505,
    placeLabel: "10th Ave overlook",
    placePos: PLACES.overlook,
    hue: SCENE_HUES.dusk,
    title: "Watching the avenue like it's television",
    summary:
      "The sunken amphitheatre over 10th Avenue, where the whole point is to sit and watch traffic through a window. It worked on all of us.",
    people: ["Nadia", "Theo"],
    transcript: [
      [4, "Theo", "We came to a park to watch cars."],
      [11, "Nadia", "We came to a park to watch cars and we are enjoying it."],
      [26, "You", "Look at the light coming down the avenue, that's the whole thing."],
      [48, "Theo", "Okay. Yeah. I get it."],
    ],
    laughterAt: [15],
    keywords: [[26, "look at"]],
    tracks: [
      { trackId: "t_hl_ov_nadia", label: "person", tStart: 430, tEnd: 505, worldPos: at(PLACES.overlook, -1.1, 0.88, 1.0), peakConfidence: 0.94, hz: 2.4, baseDepthM: 2.4 },
      { trackId: "t_hl_ov_theo", label: "person", tStart: 431, tEnd: 503, worldPos: at(PLACES.overlook, 0.9, 0.9, 1.2), peakConfidence: 0.92, hz: 2.4, baseDepthM: 2.7 },
      { trackId: "t_hl_ov_bench", label: "bench", tStart: 430, tEnd: 505, worldPos: at(PLACES.overlook, 0, 0.42, 2.0), peakConfidence: 0.88, hz: 1.6, baseDepthM: 3.0 },
      { trackId: "t_hl_ov_taxi", label: "car", tStart: 436, tEnd: 498, worldPos: at(PLACES.overlook, 2.6, 0.6, -14.0), peakConfidence: 0.83, hz: 2.2, baseDepthM: 18.5, dropRate: 0.22 },
      { trackId: "t_hl_ov_bus", label: "bus", tStart: 452, tEnd: 494, worldPos: at(PLACES.overlook, -3.4, 1.3, -17.5), peakConfidence: 0.79, hz: 2, baseDepthM: 22.0, dropRate: 0.26 },
    ],
    splat: {
      status: "ready",
      url: "/mock/splats/m_hl_overlook.spz",
      pointCount: 344_000,
      captureFrameCount: 188,
      bounds: { min: [-7, 0, -7], max: [7, 4, 7] },
    },
    music: {
      trackName: "Motion Picture Soundtrack",
      artist: "Radiohead",
      spotifyUri: "spotify:track:0BuGF8pfzSjmcYFxwoZLxb",
      chosenBecause: "a long seated dwell facing a window — it picked something that scores a view",
    },
    vibe: { mood: "unhurried", energy: 0.21, tags: ["seated", "city", "window", "afternoon"] },
  },

  {
    id: "m_hl_lawn",
    tStart: 1430,
    tEnd: 1520,
    placeLabel: "Chelsea Grasslands",
    placePos: PLACES.lawn,
    hue: SCENE_HUES.field,
    title: "Someone's dog decided we were friends",
    summary:
      "A brief and entirely one-sided friendship with a beagle, negotiated over a coffee cup on the planting beds.",
    people: ["Nadia", "Theo"],
    transcript: [
      [5, "Nadia", "Oh, hello. Hello. You're very committed to this."],
      [14, "Theo", "It's going for the cup. It's absolutely going for the cup."],
      [33, "You", "Get a picture before it takes the whole thing."],
      [52, "Nadia", "Too late."],
    ],
    laughterAt: [18, 55],
    keywords: [[33, "get a picture"]],
    tracks: [
      { trackId: "t_hl_lw_nadia", label: "person", tStart: 1430, tEnd: 1520, worldPos: at(PLACES.lawn, -1.5, 0.88, 0.8), peakConfidence: 0.95, hz: 2.6, baseDepthM: 2.2 },
      { trackId: "t_hl_lw_theo", label: "person", tStart: 1430, tEnd: 1520, worldPos: at(PLACES.lawn, 1.2, 0.9, 1.1), peakConfidence: 0.93, hz: 2.6, baseDepthM: 2.6 },
      { trackId: "t_hl_lw_dog", label: "dog", tStart: 1436, tEnd: 1514, worldPos: at(PLACES.lawn, 0.2, 0.3, -1.4), peakConfidence: 0.89, hz: 2.8, baseDepthM: 1.8 },
      { trackId: "t_hl_lw_cup", label: "cup", tStart: 1430, tEnd: 1508, worldPos: at(PLACES.lawn, -0.6, 0.55, 0.2), peakConfidence: 0.81, hz: 2.2, baseDepthM: 1.1 },
      { trackId: "t_hl_lw_plant", label: "potted plant", tStart: 1430, tEnd: 1520, worldPos: at(PLACES.lawn, 3.1, 0.5, 1.9), peakConfidence: 0.74, hz: 1.6, baseDepthM: 4.2 },
    ],
    splat: {
      status: "ready",
      url: "/mock/splats/m_hl_lawn.spz",
      pointCount: 302_000,
      captureFrameCount: 164,
      bounds: { min: [-6, 0, -6], max: [6, 3.5, 6] },
    },
    music: {
      trackName: "Feels Like We Only Go Backwards",
      artist: "Tame Impala",
      spotifyUri: "spotify:track:2X485Tc5MaCfMDds1FiXBB",
      chosenBecause: "laughter twice in ninety seconds with a low-energy backdrop — it stayed light",
    },
    vibe: { mood: "delighted", energy: 0.58, tags: ["dog", "laughter", "planting-beds", "unplanned"] },
  },

  {
    id: "m_hl_spur",
    tStart: 2520,
    tEnd: 2612,
    placeLabel: "The Spur, 30th St",
    placePos: PLACES.spur,
    hue: SCENE_HUES.golden,
    title: "The last of the light on the plinth",
    summary:
      "The wide platform at the north end, facing west into whatever the Hudson was doing to the sun. Nobody said much.",
    people: ["Nadia", "Theo"],
    transcript: [
      [9, "Theo", "That's the good one. That's the postcard."],
      [21, "Nadia", "Don't narrate it."],
      [55, "You", "Just let it record. It knows."],
      [80, "Theo", "Worth the walk up."],
    ],
    laughterAt: [25],
    keywords: [
      [55, "let it record"],
      [80, "worth the walk"],
    ],
    tracks: [
      { trackId: "t_hl_sp_nadia", label: "person", tStart: 2520, tEnd: 2612, worldPos: at(PLACES.spur, -1.8, 0.88, -0.9), peakConfidence: 0.93, hz: 2.2, baseDepthM: 3.1 },
      { trackId: "t_hl_sp_theo", label: "person", tStart: 2522, tEnd: 2610, worldPos: at(PLACES.spur, 0.6, 0.9, -1.2), peakConfidence: 0.91, hz: 2.2, baseDepthM: 3.4 },
      { trackId: "t_hl_sp_phone", label: "cell phone", tStart: 2534, tEnd: 2598, worldPos: at(PLACES.spur, -1.9, 1.32, -1.4), peakConfidence: 0.84, hz: 2.2, baseDepthM: 2.6 },
      { trackId: "t_hl_sp_bench", label: "bench", tStart: 2520, tEnd: 2612, worldPos: at(PLACES.spur, 2.8, 0.44, 1.6), peakConfidence: 0.8, hz: 1.6, baseDepthM: 4.4 },
      { trackId: "t_hl_sp_bag", label: "handbag", tStart: 2520, tEnd: 2606, worldPos: at(PLACES.spur, -2.4, 0.3, 0.6), peakConfidence: 0.72, hz: 1.8, baseDepthM: 2.9 },
    ],
    splat: {
      status: "ready",
      url: "/mock/splats/m_hl_spur.spz",
      pointCount: 398_000,
      captureFrameCount: 206,
      bounds: { min: [-8, 0, -8], max: [8, 4, 8] },
    },
    music: {
      trackName: "New York, I Love You but You're Bringing Me Down",
      artist: "LCD Soundsystem",
      spotifyUri: "spotify:track:0Zk8dJPzE2VYnHfNsuNqXn",
      chosenBecause: "golden hour, almost no speech, and it knew exactly which city it was in",
    },
    vibe: { mood: "wistful", energy: 0.18, tags: ["golden-hour", "skyline", "quiet", "north-end"] },
  },
];

export const highLine: TripSpec = {
  id: TRIP_ID,
  title: "The High Line, end to end",
  startedAt: "2026-06-14T17:40:00-04:00",
  durationSec: DURATION_SEC,
  place: {
    label: "The High Line",
    region: "Manhattan, NY",
    country: "United States",
    origin: { lat: 40.748, lng: -74.0048 },
  },
  start: PLACES.start,
  end: PLACES.end,
  moments: MOMENTS,
  seeds: defaultSeeds(TRIP_ID),
};
