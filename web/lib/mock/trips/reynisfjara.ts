/**
 * Reynisfjara, south Iceland — 44 minutes on the black sand.
 *
 * The shortest trip and the sub-arctic pin on the globe. Two moments.
 * See the authoring rules in lib/mock/buildTrip.ts.
 */
import { at, defaultSeeds, type MomentSpec, type TripSpec } from "../buildTrip";
import { SCENE_HUES } from "../placeholder";
import type { Vec2 } from "../../types";

const TRIP_ID = "trip_reynisfjara";
const DURATION_SEC = 2640; // 44 min

const PLACES = {
  start: [40, 300] as Vec2,
  columns: [200, 220] as Vec2,
  waterline: [380, 120] as Vec2,
  end: [420, 90] as Vec2,
};

const MOMENTS: MomentSpec[] = [
  {
    id: "m_rf_columns",
    tStart: 480,
    tEnd: 585,
    placeLabel: "The basalt columns",
    placePos: PLACES.columns,
    hue: SCENE_HUES.dusk,
    title: "A staircase built for nobody",
    summary:
      "Hexagonal columns stacked into something that looks deliberate and isn't. Everyone climbed three steps up and then thought better of it.",
    people: ["Elin", "Jonas"],
    transcript: [
      [6, "Jonas", "This cannot be natural. Look at the edges on it."],
      [19, "Elin", "It's cooling cracks. It's just physics being tidy."],
      [50, "You", "Get it close to the wall, the geometry is the whole shot."],
      [84, "Jonas", "Physics being tidy. I'm using that."],
    ],
    laughterAt: [24, 88],
    keywords: [[50, "the whole shot"]],
    tracks: [
      { trackId: "t_rf_cl_elin", label: "person", tStart: 480, tEnd: 585, worldPos: at(PLACES.columns, -1.3, 0.87, 1.1), peakConfidence: 0.93, hz: 2.4, baseDepthM: 2.6 },
      { trackId: "t_rf_cl_jonas", label: "person", tStart: 482, tEnd: 583, worldPos: at(PLACES.columns, 1.1, 0.9, 1.4), peakConfidence: 0.91, hz: 2.4, baseDepthM: 2.9 },
      { trackId: "t_rf_cl_bag", label: "backpack", tStart: 480, tEnd: 578, worldPos: at(PLACES.columns, -1.7, 0.34, 1.7), peakConfidence: 0.82, hz: 1.8, baseDepthM: 2.8 },
      { trackId: "t_rf_cl_phone", label: "cell phone", tStart: 496, tEnd: 570, worldPos: at(PLACES.columns, 1.2, 1.3, 0.8), peakConfidence: 0.83, hz: 2.2, baseDepthM: 2.4 },
      { trackId: "t_rf_cl_umbrella", label: "umbrella", tStart: 488, tEnd: 566, worldPos: at(PLACES.columns, -2.4, 0.9, 0.6), peakConfidence: 0.7, hz: 1.8, baseDepthM: 3.2, dropRate: 0.28 },
    ],
    splat: {
      status: "ready",
      url: "/mock/splats/m_rf_columns.spz",
      pointCount: 476_000,
      captureFrameCount: 252,
      bounds: { min: [-6, 0, -6], max: [6, 7, 6] },
    },
    music: {
      trackName: "Hoppípolla",
      artist: "Sigur Rós",
      spotifyUri: "spotify:track:6ma6rEbtzuJgKFEBIpMhTX",
      chosenBecause: "it had one obvious answer and took it, which is allowed occasionally",
    },
    vibe: { mood: "curious", energy: 0.34, tags: ["basalt", "geometry", "overcast", "cold"] },
  },

  {
    id: "m_rf_waterline",
    tStart: 1580,
    tEnd: 1700,
    placeLabel: "Back from the waterline",
    placePos: PLACES.waterline,
    hue: SCENE_HUES.water,
    title: "Standing well back, as instructed",
    summary:
      "The sneaker waves here are genuinely dangerous and the signs say so in five languages. So: black sand, white water, and a respectful distance.",
    people: ["Elin", "Jonas"],
    transcript: [
      [10, "Elin", "That's far enough. Seriously, that's far enough."],
      [28, "Jonas", "I'm ten metres back!"],
      [62, "You", "The sign says twenty. Move."],
      [104, "Elin", "Look at the black on the white though. That's the picture."],
    ],
    laughterAt: [32],
    keywords: [
      [62, "the sign says"],
      [104, "look at"],
    ],
    tracks: [
      { trackId: "t_rf_wl_elin", label: "person", tStart: 1580, tEnd: 1700, worldPos: at(PLACES.waterline, -1.8, 0.88, 1.0), peakConfidence: 0.92, hz: 2.2, baseDepthM: 3.4 },
      { trackId: "t_rf_wl_jonas", label: "person", tStart: 1582, tEnd: 1698, worldPos: at(PLACES.waterline, 2.2, 0.9, -0.8), peakConfidence: 0.9, hz: 2.2, baseDepthM: 6.2 },
      { trackId: "t_rf_wl_boat", label: "boat", tStart: 1608, tEnd: 1676, worldPos: at(PLACES.waterline, 14.0, 0.8, -46.0), peakConfidence: 0.58, hz: 1.6, baseDepthM: 62.0, dropRate: 0.34 },
      { trackId: "t_rf_wl_bag", label: "backpack", tStart: 1580, tEnd: 1692, worldPos: at(PLACES.waterline, -2.2, 0.32, 1.5), peakConfidence: 0.78, hz: 1.8, baseDepthM: 3.6 },
      { trackId: "t_rf_wl_bird", label: "bird", tStart: 1624, tEnd: 1684, worldPos: at(PLACES.waterline, 5.4, 2.6, -9.0), peakConfidence: 0.63, hz: 2, baseDepthM: 12.0, dropRate: 0.3 },
    ],
    splat: {
      status: "ready",
      url: "/mock/splats/m_rf_waterline.spz",
      pointCount: 318_000,
      captureFrameCount: 174,
      bounds: { min: [-12, 0, -12], max: [12, 4, 12] },
    },
    music: {
      trackName: "Reykjavík",
      artist: "Ólafur Arnalds",
      spotifyUri: "spotify:track:0ZKlMMSRXTPYbmqL2FpmHt",
      chosenBecause: "wind and surf under two raised voices — it picked something that would not compete",
    },
    vibe: { mood: "bracing", energy: 0.48, tags: ["black-sand", "surf", "wind", "keep-back"] },
  },
];

export const reynisfjara: TripSpec = {
  id: TRIP_ID,
  title: "Black sand at Reynisfjara",
  startedAt: "2026-03-05T13:15:00+00:00",
  durationSec: DURATION_SEC,
  place: {
    label: "Reynisfjara",
    region: "Vík í Mýrdal",
    country: "Iceland",
    origin: { lat: 63.403, lng: -19.044 },
  },
  start: PLACES.start,
  end: PLACES.end,
  moments: MOMENTS,
  seeds: defaultSeeds(TRIP_ID),
};
