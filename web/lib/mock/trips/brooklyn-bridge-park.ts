/**
 * Brooklyn Bridge Park — 38 minutes along the East River piers.
 *
 * Deliberately ~5 km from the High Line trip. That is not incidental: the globe
 * clusters pins within 220 km, and without two trips in one metro area the
 * clustering path would be dead code that never renders in the demo.
 *
 * A "postcard" trip. See the authoring rules in lib/mock/buildTrip.ts.
 */
import { at, defaultSeeds, type MomentSpec, type TripSpec } from "../buildTrip";
import { SCENE_HUES } from "../placeholder";
import type { Vec2 } from "../../types";

const TRIP_ID = "trip_brooklyn_bridge_park";
const DURATION_SEC = 2280; // 38 min

const PLACES = {
  start: [30, 380] as Vec2,
  pier: [180, 280] as Vec2,
  carousel: [340, 130] as Vec2,
  end: [380, 90] as Vec2,
};

const MOMENTS: MomentSpec[] = [
  {
    id: "m_bb_pier",
    tStart: 460,
    tEnd: 560,
    placeLabel: "Pier 2, under the bridge",
    placePos: PLACES.pier,
    hue: SCENE_HUES.water,
    title: "Basketball under a suspension bridge",
    summary:
      "Someone was down two games and refusing to leave. The bridge is directly overhead and after four minutes nobody was looking at it.",
    people: ["Dara", "Wes"],
    transcript: [
      [6, "Wes", "One more. One more and then we walk."],
      [17, "Dara", "You said that two games ago."],
      [44, "You", "It's filming you losing, you know that?"],
      [76, "Wes", "It's filming me warming up."],
    ],
    laughterAt: [22, 80],
    keywords: [[44, "it's filming"]],
    tracks: [
      { trackId: "t_bb_pr_dara", label: "person", tStart: 460, tEnd: 560, worldPos: at(PLACES.pier, -1.6, 0.88, 0.8), peakConfidence: 0.95, hz: 2.8, baseDepthM: 3.0 },
      { trackId: "t_bb_pr_wes", label: "person", tStart: 460, tEnd: 560, worldPos: at(PLACES.pier, 1.8, 0.9, -0.6), peakConfidence: 0.93, hz: 2.8, baseDepthM: 4.2 },
      { trackId: "t_bb_pr_ball", label: "sports ball", tStart: 466, tEnd: 552, worldPos: at(PLACES.pier, 0.6, 1.1, -1.8), peakConfidence: 0.72, hz: 3.2, baseDepthM: 5.4, dropRate: 0.3 },
      { trackId: "t_bb_pr_bag", label: "backpack", tStart: 460, tEnd: 556, worldPos: at(PLACES.pier, -2.6, 0.3, 1.9), peakConfidence: 0.8, hz: 1.8, baseDepthM: 3.4 },
      { trackId: "t_bb_pr_bottle", label: "bottle", tStart: 474, tEnd: 544, worldPos: at(PLACES.pier, -2.4, 0.58, 1.6), peakConfidence: 0.79, hz: 2, baseDepthM: 3.2 },
    ],
    splat: {
      status: "ready",
      url: "/mock/splats/m_bb_pier.spz",
      pointCount: 356_000,
      captureFrameCount: 192,
      bounds: { min: [-9, 0, -9], max: [9, 5, 9] },
    },
    music: {
      trackName: "Ms. Jackson",
      artist: "Outkast",
      spotifyUri: "spotify:track:0LmiHgtP71K0J6yzcMPfnT",
      chosenBecause: "high energy, two people talking over each other, laughter twice — it read the court",
    },
    vibe: { mood: "competitive", energy: 0.83, tags: ["basketball", "bridge", "river", "trash-talk"] },
  },

  {
    id: "m_bb_carousel",
    tStart: 1420,
    tEnd: 1530,
    placeLabel: "Jane's Carousel",
    placePos: PLACES.carousel,
    hue: SCENE_HUES.golden,
    title: "A carousel in a glass box at dusk",
    summary:
      "It's a 1922 carousel inside a glass pavilion, lit from within, with Manhattan behind it. Absurd, and completely effective.",
    people: ["Dara", "Wes"],
    transcript: [
      [9, "Dara", "It's a carousel in a glass box. Why is that so good."],
      [26, "Wes", "Because it shouldn't be there."],
      [58, "You", "Hold on, wait for it to come round again."],
      [94, "Dara", "That's the album cover. Done."],
    ],
    laughterAt: [30],
    keywords: [
      [58, "wait for it"],
      [94, "album cover"],
    ],
    tracks: [
      { trackId: "t_bb_cr_dara", label: "person", tStart: 1420, tEnd: 1530, worldPos: at(PLACES.carousel, -1.4, 0.88, 1.0), peakConfidence: 0.93, hz: 2.4, baseDepthM: 2.8 },
      { trackId: "t_bb_cr_wes", label: "person", tStart: 1422, tEnd: 1528, worldPos: at(PLACES.carousel, 1.2, 0.9, 1.3), peakConfidence: 0.91, hz: 2.4, baseDepthM: 3.1 },
      { trackId: "t_bb_cr_horse", label: "horse", tStart: 1434, tEnd: 1516, worldPos: at(PLACES.carousel, 0.4, 1.2, -5.6), peakConfidence: 0.74, hz: 2.4, baseDepthM: 8.2, dropRate: 0.26 },
      { trackId: "t_bb_cr_phone", label: "cell phone", tStart: 1440, tEnd: 1512, worldPos: at(PLACES.carousel, -1.5, 1.3, 0.6), peakConfidence: 0.85, hz: 2.2, baseDepthM: 2.4 },
      { trackId: "t_bb_cr_bench", label: "bench", tStart: 1420, tEnd: 1530, worldPos: at(PLACES.carousel, 3.0, 0.44, 2.0), peakConfidence: 0.78, hz: 1.6, baseDepthM: 4.4 },
    ],
    splat: {
      status: "ready",
      url: "/mock/splats/m_bb_carousel.spz",
      pointCount: 393_000,
      captureFrameCount: 208,
      bounds: { min: [-7, 0, -7], max: [7, 5, 7] },
    },
    music: {
      trackName: "Dream Baby Dream",
      artist: "Suicide",
      spotifyUri: "spotify:track:6ZFbXIJkuI1dVNWvzJzown",
      chosenBecause: "something circular and lit from inside at dusk — it picked the loop",
    },
    vibe: { mood: "charmed", energy: 0.36, tags: ["carousel", "dusk", "glass", "skyline"] },
  },
];

export const brooklynBridgePark: TripSpec = {
  id: TRIP_ID,
  title: "Piers at Brooklyn Bridge Park",
  startedAt: "2026-06-16T18:20:00-04:00",
  durationSec: DURATION_SEC,
  place: {
    label: "Brooklyn Bridge Park",
    region: "Brooklyn, NY",
    country: "United States",
    origin: { lat: 40.7002, lng: -73.9967 },
  },
  start: PLACES.start,
  end: PLACES.end,
  moments: MOMENTS,
  seeds: defaultSeeds(TRIP_ID),
};
