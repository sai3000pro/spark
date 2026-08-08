/**
 * The authored demo trip: a 95-minute wander through Waterloo Park with the robot
 * trailing behind.
 *
 * Only the HUMAN layer is authored here — titles, summaries, transcripts, music,
 * vibe, and which objects were physically present. Everything machine-derived
 * (candidates, moment spans, object sightings, keyframes, the object index) is
 * produced by actually running lib/pipeline.ts over generated detections. That
 * means the timeline's three lanes are genuinely consistent with each other
 * rather than three independently-authored fictions that drift apart.
 *
 * Swapping in real data = replace `generateDetectionsForTracks` with the robot's
 * detection log and delete the ambient generator. Nothing else moves.
 */
import type {
  AudioEvent,
  MomentCandidate,
  Moment,
  MusicPick,
  SplatRef,
  TranscriptSegment,
  Trip,
  Vec2,
  Vec3,
  Vibe,
} from "../types";
import { promoteToMoment, scoreCandidates, type KeywordHit, type MomentContent } from "../pipeline";
import { generateAmbientTracks, generateDetectionsForTracks, type TrackSpec } from "./generateDetections";
import { generatePath, pathDistanceM, type Stop } from "./generatePath";
import { SCENE_HUES } from "./placeholder";
import { makeRng, rngRange } from "./rng";

export const TRIP_ID = "trip_waterloo_park";
const DURATION_SEC = 5700; // 95 min
const STARTED_AT = "2026-08-02T15:10:00-04:00";

/** Park-local metres. Ground plane is [x, z]; moment pins live in this frame. */
const PLACES = {
  start: [40, 420] as Vec2,
  lake: [150, 330] as Vec2,
  green: [350, 240] as Vec2,
  bandstand: [560, 340] as Vec2,
  pavilion: [700, 120] as Vec2,
  snackBar: [480, 60] as Vec2,
  hill: [200, 110] as Vec2,
  end: [55, 400] as Vec2,
};

/** Object world position: park-frame [x, up, z], offset from a place. */
const at = (place: Vec2, dx: number, up: number, dz: number): Vec3 => [
  place[0] + dx,
  up,
  place[1] + dz,
];

interface MomentSpec {
  id: string;
  /** Authored window. The pipeline decides the final span; this seeds the content. */
  tStart: number;
  tEnd: number;
  placeLabel: string;
  placePos: Vec2;
  hue: number;
  title: string;
  summary: string;
  people: string[];
  transcript: Array<[number, string, string]>; // [tOffset, speaker, text]
  tracks: TrackSpec[];
  splat: SplatRef;
  music?: MusicPick;
  vibe: Vibe;
  laughterAt?: number[];
  keywords?: Array<[number, string]>; // [tOffset, phrase]
}

// ─────────────────────────────────────────────────────────────────────────────
// The six moments
// ─────────────────────────────────────────────────────────────────────────────

const SPECS: MomentSpec[] = [
  {
    id: "m_silver_lake",
    tStart: 480,
    tEnd: 552,
    placeLabel: "Silver Lake shore",
    placePos: PLACES.lake,
    hue: SCENE_HUES.water,
    title: "It followed us to the water",
    summary:
      "Ten minutes in, the robot proved it would actually keep up — right to the edge of Silver Lake, where a small delegation of ducks came to inspect it.",
    people: ["Maya", "Omar"],
    transcript: [
      [2, "You", "Okay. It's actually following us. It's following us."],
      [7, "Maya", "Watch it go straight into the lake."],
      [11, "Omar", "It's fine, it's got — hold on, is that thing waterproof?"],
      [16, "You", "Do not answer that."],
      [24, "Maya", "Look at the ducks, they're forming a committee."],
      [31, "Omar", "They think it's one of them."],
      [44, "You", "Remember this bit, this is going in the demo."],
    ],
    laughterAt: [13, 34],
    keywords: [
      [24, "look at"],
      [44, "remember this"],
    ],
    tracks: [
      { trackId: "t_lake_bird1", label: "bird", tStart: 486, tEnd: 548, worldPos: at(PLACES.lake, 3.2, 0.1, -2.4), peakConfidence: 0.79, hz: 2.4, baseDepthM: 5.2 },
      { trackId: "t_lake_bird2", label: "bird", tStart: 494, tEnd: 540, worldPos: at(PLACES.lake, 4.1, 0.12, -3.1), peakConfidence: 0.71, hz: 2.2, baseDepthM: 6.4 },
      { trackId: "t_lake_bird3", label: "bird", tStart: 508, tEnd: 551, worldPos: at(PLACES.lake, 2.4, 0.08, -3.8), peakConfidence: 0.64, hz: 2, baseDepthM: 7.1, dropRate: 0.24 },
      { trackId: "t_lake_maya", label: "person", tStart: 481, tEnd: 552, worldPos: at(PLACES.lake, -1.4, 0.9, 1.2), peakConfidence: 0.94, hz: 2.6, baseDepthM: 2.6 },
      { trackId: "t_lake_omar", label: "person", tStart: 483, tEnd: 549, worldPos: at(PLACES.lake, 1.1, 0.92, 1.8), peakConfidence: 0.91, hz: 2.6, baseDepthM: 3.1 },
      { trackId: "t_lake_bench", label: "bench", tStart: 480, tEnd: 552, worldPos: at(PLACES.lake, -3.6, 0.4, 2.6), peakConfidence: 0.86, hz: 1.8, baseDepthM: 4.4 },
      { trackId: "t_lake_backpack", label: "backpack", tStart: 489, tEnd: 546, worldPos: at(PLACES.lake, -3.2, 0.55, 2.2), peakConfidence: 0.77, hz: 2, baseDepthM: 4.1 },
    ],
    splat: {
      status: "ready",
      url: "/mock/splats/m_silver_lake.spz",
      pointCount: 418_000,
      captureFrameCount: 214,
      bounds: { min: [-8, 0, -8], max: [8, 4, 8] },
    },
    music: {
      trackName: "Pink + White",
      artist: "Frank Ocean",
      spotifyUri: "spotify:track:3xKsf9qdS1CyvXSMEid6g8",
      chosenBecause: "warm, unhurried, slightly silly — matched the water and the duck committee",
    },
    vibe: { mood: "playful", energy: 0.52, tags: ["water", "curious", "sunlit", "first-contact"] },
  },

  {
    id: "m_frisbee_green",
    tStart: 1305,
    tEnd: 1396,
    placeLabel: "The open green",
    placePos: PLACES.green,
    hue: SCENE_HUES.field,
    title: "Frisbee, badly",
    summary:
      "Omar's throw curved into a tree. The robot tracked the disc the entire way, which is more than anyone else managed.",
    people: ["Maya", "Omar"],
    transcript: [
      [3, "Omar", "Go long!"],
      [6, "Maya", "That is not long, that is sideways —"],
      [12, "You", "It's in the tree. It's in the tree, Omar."],
      [22, "Omar", "The wind took it."],
      [26, "Maya", "There is no wind."],
      [40, "You", "Did it get that? Tell me it got that."],
      [58, "Maya", "One more, and this time aim at a person."],
    ],
    laughterAt: [15, 28, 44],
    keywords: [[40, "did it get that"]],
    tracks: [
      { trackId: "t_green_frisbee", label: "frisbee", tStart: 1306, tEnd: 1390, worldPos: at(PLACES.green, 0.4, 1.6, -5.2), peakConfidence: 0.68, hz: 3.2, baseDepthM: 8.4, dropRate: 0.3 },
      { trackId: "t_green_omar", label: "person", tStart: 1305, tEnd: 1396, worldPos: at(PLACES.green, -2.6, 0.9, 0.4), peakConfidence: 0.95, hz: 2.8, baseDepthM: 3.4 },
      { trackId: "t_green_maya", label: "person", tStart: 1305, tEnd: 1396, worldPos: at(PLACES.green, 2.9, 0.9, -1.1), peakConfidence: 0.93, hz: 2.8, baseDepthM: 4.6 },
      { trackId: "t_green_you", label: "person", tStart: 1312, tEnd: 1394, worldPos: at(PLACES.green, 0.2, 0.9, 2.4), peakConfidence: 0.88, hz: 2.4, baseDepthM: 2.2 },
      { trackId: "t_green_dog", label: "dog", tStart: 1330, tEnd: 1378, worldPos: at(PLACES.green, 5.2, 0.35, -2.8), peakConfidence: 0.81, hz: 2.4, baseDepthM: 9.1 },
      { trackId: "t_green_ball", label: "sports ball", tStart: 1344, tEnd: 1372, worldPos: at(PLACES.green, 6.1, 0.2, -3.4), peakConfidence: 0.59, hz: 2, baseDepthM: 10.2, dropRate: 0.3 },
      { trackId: "t_green_bottle_a", label: "bottle", tStart: 1318, tEnd: 1352, worldPos: at(PLACES.green, -3.4, 0.3, 1.9), peakConfidence: 0.64, hz: 1.8, baseDepthM: 3.8 },
    ],
    // A deliberately failed reconstruction: fast motion is exactly what breaks
    // splat capture, and the demo is stronger for admitting it.
    splat: {
      status: "failed",
      captureFrameCount: 96,
      note: "Too much subject motion — reconstruction did not converge. Frames kept for the timeline.",
    },
    music: {
      trackName: "Sun",
      artist: "Two Door Cinema Club",
      spotifyUri: "spotify:track:1SBdOdCzsdVGmMDDzTZ8pR",
      chosenBecause: "peak energy + laughter in the same window asked for something with a run in it",
    },
    vibe: { mood: "rowdy", energy: 0.91, tags: ["running", "laughter", "competitive", "open-space"] },
  },

  {
    id: "m_bandstand_bench",
    tStart: 2140,
    tEnd: 2268,
    placeLabel: "Bench by the bandstand",
    placePos: PLACES.bandstand,
    hue: SCENE_HUES.park,
    title: "Scoping it out on the bench",
    summary:
      "Twenty minutes of actual planning: what to build first, what to fake, and what to cut. The robot sat and transcribed all of it.",
    people: ["Maya", "Omar"],
    transcript: [
      [4, "Maya", "Okay but seriously, what are we building first?"],
      [9, "You", "Detection. Everything else hangs off it — the moments, the search, the anchors in the splat."],
      [18, "Omar", "You could start with the splats, they look better in a demo."],
      [24, "You", "They look better and they prove nothing. If detection works, the moments write themselves."],
      [34, "Maya", "So detection feeds the moment candidates, and the candidates get promoted into the full thing?"],
      [42, "You", "Right. Cheap pass on every frame, then only the interesting windows get the expensive treatment."],
      [53, "Omar", "What's the cheap pass looking for?"],
      [58, "You", "New objects, faces, whether we stopped walking, and audio. Laughter is a really strong signal."],
      [69, "Maya", "And the thing where you ask it where your stuff is?"],
      [74, "You", "That's just an index over the detections. Group by track, keep the best sighting, sort by recency."],
      [86, "Omar", "Are we doing voice control?"],
      [90, "You", "No. We're cutting voice. It'll eat the whole day and nobody scores it."],
      [97, "Maya", "Agreed. Cut voice, mock the music picks, make the trip page look real."],
      [106, "Omar", "And if the splats aren't done by morning?"],
      [110, "You", "Then we show the point cloud and say the reconstruction is still cooking. It's honest and it still reads."],
      [119, "Maya", "Fine. Write the schema down first so we're not all inventing field names."],
    ],
    laughterAt: [30, 94],
    keywords: [
      [9, "detection"],
      [34, "moment candidates"],
      [90, "cutting voice"],
    ],
    tracks: [
      { trackId: "t_bench_bench", label: "bench", tStart: 2140, tEnd: 2268, worldPos: at(PLACES.bandstand, 0, 0.45, 1.4), peakConfidence: 0.93, hz: 1.6, baseDepthM: 2.1 },
      { trackId: "t_bench_maya", label: "person", tStart: 2140, tEnd: 2268, worldPos: at(PLACES.bandstand, -0.9, 0.85, 1.2), peakConfidence: 0.96, hz: 2.4, baseDepthM: 1.9 },
      { trackId: "t_bench_omar", label: "person", tStart: 2142, tEnd: 2266, worldPos: at(PLACES.bandstand, 0.8, 0.85, 1.3), peakConfidence: 0.95, hz: 2.4, baseDepthM: 2.2 },
      { trackId: "t_bench_laptop", label: "laptop", tStart: 2158, tEnd: 2262, worldPos: at(PLACES.bandstand, -0.4, 0.72, 0.8), peakConfidence: 0.88, hz: 2, baseDepthM: 1.4 },
      { trackId: "t_bench_bottle", label: "bottle", tStart: 2150, tEnd: 2240, worldPos: at(PLACES.bandstand, 1.4, 0.5, 0.9), peakConfidence: 0.86, hz: 2, baseDepthM: 1.6 },
      { trackId: "t_bench_cup", label: "cup", tStart: 2146, tEnd: 2255, worldPos: at(PLACES.bandstand, -1.6, 0.5, 0.7), peakConfidence: 0.8, hz: 1.8, baseDepthM: 1.5 },
      { trackId: "t_bench_backpack", label: "backpack", tStart: 2140, tEnd: 2268, worldPos: at(PLACES.bandstand, 2.1, 0.25, 2.0), peakConfidence: 0.84, hz: 1.8, baseDepthM: 2.6 },
      { trackId: "t_bench_phone", label: "cell phone", tStart: 2196, tEnd: 2244, worldPos: at(PLACES.bandstand, 0.2, 0.7, 0.6), peakConfidence: 0.72, hz: 2, baseDepthM: 1.2 },
    ],
    splat: {
      status: "ready",
      url: "/mock/splats/m_bandstand_bench.spz",
      pointCount: 502_000,
      captureFrameCount: 288,
      bounds: { min: [-6, 0, -6], max: [6, 3.5, 6] },
    },
    music: {
      trackName: "Holocene",
      artist: "Bon Iver",
      spotifyUri: "spotify:track:53Hn5m5xhs9JeSDvGYbjTa",
      chosenBecause: "long stationary window, low energy, steady speech — it picked something that wouldn't compete",
    },
    vibe: { mood: "focused", energy: 0.24, tags: ["planning", "seated", "shade", "long-conversation"] },
  },

  {
    id: "m_pavilion_photo",
    tStart: 3065,
    tEnd: 3140,
    placeLabel: "Pavilion steps",
    placePos: PLACES.pavilion,
    hue: SCENE_HUES.park,
    title: "The group photo attempt",
    summary:
      "Four tries, one usable frame. The robot was asked to back up twice and did, which felt like a bigger milestone than it should have.",
    people: ["Maya", "Omar", "Priya"],
    transcript: [
      [3, "Maya", "Everyone in. Priya, you're behind the post."],
      [8, "Priya", "I am aware."],
      [14, "You", "Back up a bit? Can it — yeah, there we go."],
      [23, "Omar", "It just did that. It just backed up because you asked."],
      [30, "Maya", "Get a photo of the robot taking the photo."],
      [41, "You", "Okay, three, two —"],
      [46, "Priya", "Someone's eyes were shut, I can feel it."],
      [58, "Maya", "One more. This is the one."],
    ],
    laughterAt: [26, 50],
    keywords: [
      [30, "get a photo"],
      [58, "this is the one"],
    ],
    tracks: [
      { trackId: "t_pav_maya", label: "person", tStart: 3065, tEnd: 3140, worldPos: at(PLACES.pavilion, -1.8, 0.88, -0.6), peakConfidence: 0.96, hz: 2.6, baseDepthM: 3.2 },
      { trackId: "t_pav_omar", label: "person", tStart: 3065, tEnd: 3140, worldPos: at(PLACES.pavilion, -0.4, 0.9, -0.4), peakConfidence: 0.95, hz: 2.6, baseDepthM: 3.3 },
      { trackId: "t_pav_priya", label: "person", tStart: 3068, tEnd: 3140, worldPos: at(PLACES.pavilion, 1.1, 0.87, -0.9), peakConfidence: 0.92, hz: 2.6, baseDepthM: 3.6 },
      { trackId: "t_pav_you", label: "person", tStart: 3072, tEnd: 3138, worldPos: at(PLACES.pavilion, 2.4, 0.89, -0.2), peakConfidence: 0.9, hz: 2.4, baseDepthM: 3.9 },
      { trackId: "t_pav_phone", label: "cell phone", tStart: 3078, tEnd: 3136, worldPos: at(PLACES.pavilion, -1.9, 1.35, -1.1), peakConfidence: 0.83, hz: 2.2, baseDepthM: 2.8 },
      { trackId: "t_pav_bike", label: "bicycle", tStart: 3065, tEnd: 3122, worldPos: at(PLACES.pavilion, 5.6, 0.5, 2.4), peakConfidence: 0.87, hz: 1.8, baseDepthM: 7.8 },
      { trackId: "t_pav_backpack", label: "backpack", tStart: 3070, tEnd: 3140, worldPos: at(PLACES.pavilion, 3.2, 0.2, 1.6), peakConfidence: 0.79, hz: 1.8, baseDepthM: 4.8 },
    ],
    splat: {
      status: "ready",
      url: "/mock/splats/m_pavilion_photo.spz",
      pointCount: 361_000,
      captureFrameCount: 176,
      bounds: { min: [-7, 0, -7], max: [7, 4.5, 7] },
    },
    music: {
      trackName: "Home",
      artist: "Edward Sharpe & The Magnetic Zeros",
      spotifyUri: "spotify:track:2LhQ4mBu6zX0AzMBcSHYlL",
      chosenBecause: "four faces in frame and everyone talking over each other — it went for the singalong",
    },
    vibe: { mood: "warm", energy: 0.66, tags: ["group", "posing", "milestone", "steps"] },
  },

  {
    id: "m_snack_bar_table",
    tStart: 3845,
    tEnd: 3912,
    placeLabel: "Picnic table by the snack bar",
    placePos: PLACES.snackBar,
    hue: SCENE_HUES.golden,
    title: "Stopped for fries",
    summary:
      "A short stop at the picnic tables. Notable in hindsight: this is the last time the robot saw the blue water bottle.",
    people: ["Maya", "Omar", "Priya"],
    transcript: [
      [5, "Omar", "I'm getting fries. Anyone else?"],
      [10, "Maya", "Fries. And put your bottle down, you've been holding it for an hour."],
      [17, "You", "Just leave it on the table, we're coming back this way."],
      [28, "Priya", "We are not coming back this way."],
      [39, "Maya", "It'll be fine, the robot's watching it."],
      [46, "You", "That is... actually true."],
    ],
    laughterAt: [43],
    keywords: [
      [17, "leave it on the table"],
      [39, "the robot's watching"],
    ],
    tracks: [
      // The hero sighting for "where is my water bottle?" — high confidence, on a
      // table, and deliberately never detected again for the rest of the trip.
      { trackId: "t_snack_bottle", label: "bottle", tStart: 3852, tEnd: 3910, worldPos: at(PLACES.snackBar, 0.3, 0.78, 0.5), peakConfidence: 0.93, hz: 2.4, baseDepthM: 1.3, dropRate: 0.06 },
      { trackId: "t_snack_table", label: "dining table", tStart: 3845, tEnd: 3912, worldPos: at(PLACES.snackBar, 0, 0.62, 0.6), peakConfidence: 0.91, hz: 1.8, baseDepthM: 1.5 },
      { trackId: "t_snack_bench", label: "bench", tStart: 3845, tEnd: 3912, worldPos: at(PLACES.snackBar, 0, 0.42, 1.9), peakConfidence: 0.82, hz: 1.6, baseDepthM: 2.2 },
      { trackId: "t_snack_maya", label: "person", tStart: 3845, tEnd: 3912, worldPos: at(PLACES.snackBar, -1.2, 0.86, 1.6), peakConfidence: 0.94, hz: 2.4, baseDepthM: 2.0 },
      { trackId: "t_snack_priya", label: "person", tStart: 3848, tEnd: 3906, worldPos: at(PLACES.snackBar, 1.4, 0.86, 1.7), peakConfidence: 0.9, hz: 2.4, baseDepthM: 2.3 },
      { trackId: "t_snack_cup", label: "cup", tStart: 3860, tEnd: 3912, worldPos: at(PLACES.snackBar, -0.7, 0.74, 0.4), peakConfidence: 0.78, hz: 2, baseDepthM: 1.2 },
      { trackId: "t_snack_chair", label: "chair", tStart: 3845, tEnd: 3900, worldPos: at(PLACES.snackBar, 2.6, 0.45, 0.2), peakConfidence: 0.71, hz: 1.6, baseDepthM: 3.1 },
      { trackId: "t_snack_sandwich", label: "sandwich", tStart: 3874, tEnd: 3908, worldPos: at(PLACES.snackBar, 0.9, 0.75, 0.9), peakConfidence: 0.66, hz: 1.8, baseDepthM: 1.1 },
    ],
    splat: {
      status: "ready",
      url: "/mock/splats/m_snack_bar_table.spz",
      pointCount: 289_000,
      captureFrameCount: 152,
      bounds: { min: [-5, 0, -5], max: [5, 3, 5] },
    },
    // No music pick on purpose — a short mundane stop shouldn't get scored, and it
    // forces the NowPlaying empty state to exist.
    vibe: { mood: "easy", energy: 0.31, tags: ["food", "seated", "brief", "late-afternoon"] },
  },

  {
    id: "m_lookout_sunset",
    tStart: 4835,
    tEnd: 4962,
    placeLabel: "Lookout hill",
    placePos: PLACES.hill,
    hue: SCENE_HUES.golden,
    title: "Everyone went quiet on the hill",
    summary:
      "The longest stop of the day and the least said. The robot kept recording anyway, which is the whole point of it.",
    people: ["Maya", "Omar", "Priya"],
    transcript: [
      [8, "Maya", "Oh, that's good."],
      [14, "Priya", "Yeah."],
      [39, "Omar", "How long have we been out?"],
      [44, "You", "Hour and a half, maybe."],
      [52, "Maya", "Feels like less."],
      [78, "You", "Don't say anything, just let it get this."],
      [104, "Priya", "Okay, that was worth the walk."],
    ],
    keywords: [
      [78, "let it get this"],
      [104, "worth the walk"],
    ],
    tracks: [
      { trackId: "t_hill_maya", label: "person", tStart: 4835, tEnd: 4962, worldPos: at(PLACES.hill, -1.6, 0.88, -1.2), peakConfidence: 0.92, hz: 2.2, baseDepthM: 3.4 },
      { trackId: "t_hill_omar", label: "person", tStart: 4838, tEnd: 4960, worldPos: at(PLACES.hill, 0.4, 0.9, -1.6), peakConfidence: 0.9, hz: 2.2, baseDepthM: 3.8 },
      { trackId: "t_hill_priya", label: "person", tStart: 4842, tEnd: 4962, worldPos: at(PLACES.hill, 2.2, 0.87, -1.1), peakConfidence: 0.88, hz: 2.2, baseDepthM: 4.1 },
      { trackId: "t_hill_bench", label: "bench", tStart: 4835, tEnd: 4962, worldPos: at(PLACES.hill, -3.4, 0.44, 0.8), peakConfidence: 0.85, hz: 1.6, baseDepthM: 4.6 },
      { trackId: "t_hill_backpack", label: "backpack", tStart: 4835, tEnd: 4955, worldPos: at(PLACES.hill, -3.0, 0.22, 1.4), peakConfidence: 0.8, hz: 1.8, baseDepthM: 4.2 },
      { trackId: "t_hill_phone", label: "cell phone", tStart: 4880, tEnd: 4948, worldPos: at(PLACES.hill, 0.6, 1.3, -1.4), peakConfidence: 0.75, hz: 2, baseDepthM: 3.6 },
      { trackId: "t_hill_kite", label: "kite", tStart: 4902, tEnd: 4944, worldPos: at(PLACES.hill, 8.4, 6.2, -12.0), peakConfidence: 0.57, hz: 1.6, baseDepthM: 26, dropRate: 0.32 },
    ],
    // Still cooking. The last capture of the day is exactly the one that wouldn't
    // be finished by morning, so the UI has to handle it.
    splat: {
      status: "processing",
      captureFrameCount: 341,
      note: "341 frames queued — reconstruction started 6 minutes ago, usually takes ~20.",
    },
    music: {
      trackName: "Harvest Moon",
      artist: "Neil Young",
      spotifyUri: "spotify:track:0PmVYCkPbjcMcpUKMlcUvR",
      chosenBecause: "long dwell, almost no speech, golden light — it read the room and stayed out of the way",
    },
    vibe: { mood: "still", energy: 0.12, tags: ["golden-hour", "quiet", "view", "end-of-day"] },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Assembly — run the real pipeline over generated detections
// ─────────────────────────────────────────────────────────────────────────────

function buildStops(): Stop[] {
  const pad = 18; // arrive a little before the moment, leave a little after
  const stops: Stop[] = [{ pos: PLACES.start, arriveT: 0, departT: 30 }];
  for (const s of SPECS) {
    stops.push({ pos: s.placePos, arriveT: s.tStart - pad, departT: s.tEnd + pad });
  }
  stops.push({ pos: PLACES.end, arriveT: DURATION_SEC, departT: DURATION_SEC });
  return stops;
}

function buildTranscript(spec: MomentSpec): TranscriptSegment[] {
  return spec.transcript.map(([offset, speaker, text], i) => ({
    id: `${spec.id}_seg${i}`,
    t: spec.tStart + offset,
    // Rough speaking rate: ~2.6 words/sec, floor of 1.6s.
    durationSec: Number(Math.max(1.6, text.split(" ").length / 2.6).toFixed(1)),
    speaker,
    text,
    confidence: Number(rngRange(makeRng(1000 + i + spec.id.length), 0.88, 0.99).toFixed(3)),
  }));
}

function buildAudioEvents(): AudioEvent[] {
  const events: AudioEvent[] = [];

  for (const spec of SPECS) {
    const transcript = buildTranscript(spec);
    for (const seg of transcript) {
      events.push({
        t: seg.t,
        durationSec: seg.durationSec,
        kind: "speech",
        // Energy tracks the moment's vibe, so a quiet hilltop doesn't score like
        // a frisbee game.
        energy: Number(Math.min(0.98, 0.4 + spec.vibe.energy * 0.55).toFixed(2)),
      });
    }
    for (const t of spec.laughterAt ?? []) {
      events.push({ t: spec.tStart + t, durationSec: 2.4, kind: "laughter", energy: 0.86 });
    }
  }

  // Ambient chatter between moments. Kept below the 0.35 energy gate most of the
  // time so it does NOT trigger on its own — moments have to earn it.
  const r = makeRng(7788);
  for (let t = 60; t < DURATION_SEC - 60; t += rngRange(r, 25, 90)) {
    const insideMoment = SPECS.some((s) => t > s.tStart - 25 && t < s.tEnd + 25);
    if (insideMoment) continue;
    events.push({
      t: Number(t.toFixed(1)),
      durationSec: Number(rngRange(r, 1.5, 6).toFixed(1)),
      kind: r() < 0.82 ? "speech" : "ambient",
      energy: Number(rngRange(r, 0.14, 0.46).toFixed(2)),
    });
  }

  return events.sort((a, b) => a.t - b.t);
}

function buildKeywordHits(): KeywordHit[] {
  const hits: KeywordHit[] = [];
  for (const spec of SPECS) {
    for (const [offset, phrase] of spec.keywords ?? []) {
      hits.push({ t: spec.tStart + offset, phrase });
    }
  }
  return hits;
}

function contentFor(spec: MomentSpec): MomentContent {
  return {
    id: spec.id,
    title: spec.title,
    summary: spec.summary,
    place: { label: spec.placeLabel, pos: spec.placePos },
    people: spec.people,
    transcript: buildTranscript(spec),
    splat: spec.splat,
    music: spec.music,
    vibe: spec.vibe,
    hue: spec.hue,
  };
}

export interface BuiltTrip {
  trip: Trip;
  distanceM: number;
}

let cached: BuiltTrip | null = null;

export function buildTrip(): BuiltTrip {
  if (cached) return cached;

  const momentTracks = SPECS.flatMap((s) => s.tracks);
  const ambientTracks = generateAmbientTracks(
    DURATION_SEC,
    SPECS.map((s) => ({ tStart: s.tStart, tEnd: s.tEnd })),
  );

  const detections = generateDetectionsForTracks(TRIP_ID, [...momentTracks, ...ambientTracks]);
  const path = generatePath(buildStops(), DURATION_SEC);
  const audioEvents = buildAudioEvents();
  const keywordHits = buildKeywordHits();

  // Stage 2 for real: the candidates below are found, not authored.
  const candidates = scoreCandidates({
    tripId: TRIP_ID,
    durationSec: DURATION_SEC,
    detections,
    audioEvents,
    path,
    keywordHits,
  });

  // Stage 3: match each authored moment to the candidate covering its window.
  const moments: Moment[] = [];
  const claimed = new Set<string>();

  for (const spec of SPECS) {
    const mid = (spec.tStart + spec.tEnd) / 2;
    const candidate =
      candidates.find((c) => !claimed.has(c.id) && c.tStart <= mid && c.tEnd >= mid) ??
      // Fall back to whichever unclaimed candidate overlaps most, so a tuning
      // change to TRIGGER_WEIGHTS can never silently drop a moment.
      candidates
        .filter((c) => !claimed.has(c.id) && c.tEnd > spec.tStart && c.tStart < spec.tEnd)
        .sort(
          (a, b) =>
            overlap(b, spec.tStart, spec.tEnd) - overlap(a, spec.tStart, spec.tEnd),
        )[0];

    if (!candidate) {
      console.warn(
        `[mock] no candidate covered moment ${spec.id} (${spec.tStart}-${spec.tEnd}s). ` +
          `Check TRIGGER_WEIGHTS / windowThreshold in lib/pipeline.ts.`,
      );
      continue;
    }

    claimed.add(candidate.id);
    candidate.status = "promoted";
    delete candidate.discardReason;
    moments.push(promoteToMoment(candidate, detections, contentFor(spec)));
  }

  // Anything that survived stage 2 but has no moment: stage 3 looked and found
  // nothing worth keeping. That is a real outcome, not a bug.
  for (const c of candidates) {
    if (c.status === "pending") {
      c.status = "discarded";
      c.discardReason = c.discardReason ?? "passed stage 2, but no coherent subject to reconstruct";
    }
  }

  const trip: Trip = {
    id: TRIP_ID,
    title: "Waterloo Park loop",
    startedAt: STARTED_AT,
    endedAt: new Date(new Date(STARTED_AT).getTime() + DURATION_SEC * 1000).toISOString(),
    place: { label: "Waterloo Park", region: "Waterloo, ON" },
    path,
    moments,
    candidates,
    detections,
    audioEvents,
  };

  cached = { trip, distanceM: pathDistanceM(path) };
  return cached;
}

const overlap = (c: MomentCandidate, tStart: number, tEnd: number) =>
  Math.max(0, Math.min(c.tEnd, tEnd) - Math.max(c.tStart, tStart));
