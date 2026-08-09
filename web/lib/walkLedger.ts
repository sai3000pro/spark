/**
 * The walk's ledger — everything the dashboard behind the map plate reads,
 * aggregated once on the server.
 *
 * The boundary rule from lib/tripData.ts is the reason this file exists: the
 * raw inputs (thousands of Detection rows, the dense odometry, every audio
 * event) never cross to the client — only these small totals do. The numbers
 * here are DERIVED, never authored: laughs come off the audio track, pauses
 * off the odometry, the trigger census off the candidates stage 2 actually
 * scored. Keep it pure and free of React/Next imports, like lib/pipeline.ts.
 */
import { PIPELINE_CONFIG } from "./pipeline";
import type { Trip, TriggerKind } from "./types";

/** A sustained pause read off the odometry — the robot saw you stop. */
export interface LedgerStop {
  /** When the pause began, trip seconds. */
  t: number;
  durationSec: number;
  /** The kept moment whose spot this pause happened at, when one is near. */
  label?: string;
}

export interface LedgerPerson {
  name: string;
  /** How many kept moments they appear in. */
  moments: number;
  /** Trip seconds of the first moment they appear in. */
  firstMetT: number;
}

export interface LedgerFamily {
  family: string;
  /** Distinct labels seen in this family — kinds of thing, not frames. */
  labels: number;
  /** Raw detection rows — how much of the cameras' attention it took. */
  detections: number;
}

export interface LedgerLine {
  speaker: string;
  text: string;
  /** Trip seconds — the client renders it as a wall clock. */
  t: number;
  momentTitle: string;
}

export interface LedgerMood {
  momentId: string;
  title: string;
  mood: string;
  /** 0..1 */
  energy: number;
  t: number;
}

export interface LedgerTune {
  trackName: string;
  artist: string;
  chosenBecause: string;
  momentTitle: string;
}

/** One kept moment, as a line in the day's log. */
export interface LedgerRow {
  id: string;
  tStart: number;
  tEnd: number;
  title: string;
  placeLabel: string;
  people: string[];
  mood: string;
  energy: number;
  /** Why stage 2 kept looking — distinct trigger kinds, strongest evidence first. */
  triggers: TriggerKind[];
  objectCount: number;
  laughCount: number;
  wordCount: number;
  splatStatus: "ready" | "processing" | "failed";
}

export interface WalkLedger {
  movement: {
    movingSec: number;
    pausedSec: number;
    /** Metres per second while actually moving. */
    avgMovingMps: number;
    /** Sustained pauses (≥ 45 s), in trip order. */
    stops: LedgerStop[];
  };
  perception: {
    /** Detection census by label family, most attention first. */
    families: LedgerFamily[];
    /** Trigger kinds across the KEPT candidates — why the day was kept. */
    triggers: { kind: TriggerKind; count: number }[];
    discardedCount: number;
  };
  company: {
    people: LedgerPerson[];
    /** Distinct transcript voices, in order of first appearance. */
    speakers: string[];
    segmentCount: number;
    wordCount: number;
    /** Every laugh the microphone caught, trip seconds, sorted. */
    laughT: number[];
    /** The line said right before the biggest laugh. */
    bestLine?: LedgerLine;
  };
  mood: {
    /** Mean of the kept moments' vibe energy, 0..1. */
    avgEnergy: number;
    moods: LedgerMood[];
    tags: { tag: string; count: number }[];
    music: LedgerTune[];
  };
  log: LedgerRow[];
}

/** A pause must hold this long to make the ledger — shorter is just traffic. */
const STOP_MIN_SEC = 45;
/** A pause within this many metres of a kept moment borrows its place label. */
const STOP_LABEL_RADIUS_M = 40;
/** A line must land within this many seconds before a laugh to have caused it. */
const LAUGH_SETUP_SEC = 22;

export function buildWalkLedger(
  trip: Trip,
  distanceM: number,
  familyOf: (label: string) => string,
): WalkLedger {
  return {
    movement: movementOf(trip, distanceM),
    perception: perceptionOf(trip, familyOf),
    company: companyOf(trip),
    mood: moodOf(trip),
    log: logOf(trip),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Movement — read off the odometry, the same signal the dwell trigger uses
// ─────────────────────────────────────────────────────────────────────────────

function movementOf(trip: Trip, distanceM: number): WalkLedger["movement"] {
  const { path, moments } = trip;
  let movingSec = 0;
  let pausedSec = 0;
  const stops: LedgerStop[] = [];

  let runStart = -1; // index where the current pause began, -1 while moving
  const closeRun = (endIdx: number) => {
    if (runStart < 0) return;
    const durationSec = path[endIdx].t - path[runStart].t;
    if (durationSec >= STOP_MIN_SEC) {
      const mid = path[runStart + ((endIdx - runStart) >> 1)].pos;
      let label: string | undefined;
      let best = STOP_LABEL_RADIUS_M;
      for (const m of moments) {
        const d = Math.hypot(m.place.pos[0] - mid[0], m.place.pos[1] - mid[1]);
        if (d < best) {
          best = d;
          label = m.place.label;
        }
      }
      stops.push({ t: path[runStart].t, durationSec: Math.round(durationSec), label });
    }
    runStart = -1;
  };

  for (let i = 0; i < path.length - 1; i++) {
    const dt = path[i + 1].t - path[i].t;
    if (path[i].speed < PIPELINE_CONFIG.dwellSpeedMps) {
      pausedSec += dt;
      if (runStart < 0) runStart = i;
    } else {
      movingSec += dt;
      closeRun(i);
    }
  }
  closeRun(path.length - 1);

  return {
    movingSec: Math.round(movingSec),
    pausedSec: Math.round(pausedSec),
    avgMovingMps: movingSec > 0 ? distanceM / movingSec : 0,
    stops,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Perception — what the cameras spent their attention on, and why it was kept
// ─────────────────────────────────────────────────────────────────────────────

function perceptionOf(
  trip: Trip,
  familyOf: (label: string) => string,
): WalkLedger["perception"] {
  const byFamily = new Map<string, { labels: Set<string>; detections: number }>();
  for (const d of trip.detections) {
    const fam = familyOf(d.label);
    const row = byFamily.get(fam) ?? { labels: new Set(), detections: 0 };
    row.labels.add(d.label);
    row.detections++;
    byFamily.set(fam, row);
  }

  const triggerCount = new Map<TriggerKind, number>();
  for (const c of trip.candidates) {
    if (c.status !== "promoted") continue;
    for (const t of c.triggers) triggerCount.set(t.kind, (triggerCount.get(t.kind) ?? 0) + 1);
  }

  return {
    families: [...byFamily.entries()]
      .map(([family, r]) => ({ family, labels: r.labels.size, detections: r.detections }))
      .sort((a, b) => b.detections - a.detections),
    triggers: [...triggerCount.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count),
    discardedCount: trip.candidates.filter((c) => c.status === "discarded").length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Company — who was there and what the day sounded like
// ─────────────────────────────────────────────────────────────────────────────

function companyOf(trip: Trip): WalkLedger["company"] {
  const people = new Map<string, LedgerPerson>();
  const speakers: string[] = [];
  let segmentCount = 0;
  let wordCount = 0;

  for (const m of trip.moments) {
    for (const name of m.people) {
      const p = people.get(name);
      if (p) p.moments++;
      else people.set(name, { name, moments: 1, firstMetT: m.tStart });
    }
    for (const seg of m.transcript) {
      segmentCount++;
      wordCount += seg.text.split(/\s+/).length;
      if (!speakers.includes(seg.speaker)) speakers.push(seg.speaker);
    }
  }

  const laughT = trip.audioEvents
    .filter((e) => e.kind === "laughter")
    .map((e) => e.t)
    .sort((a, b) => a - b);

  // The line said right before a laugh — smallest setup-to-laugh gap wins.
  let bestLine: LedgerLine | undefined;
  let bestGap = LAUGH_SETUP_SEC;
  for (const m of trip.moments) {
    for (const seg of m.transcript) {
      for (const t of laughT) {
        const gap = t - seg.t;
        if (gap >= 0 && gap < bestGap) {
          bestGap = gap;
          bestLine = { speaker: seg.speaker, text: seg.text, t: seg.t, momentTitle: m.title };
        }
      }
    }
  }

  return {
    people: [...people.values()].sort((a, b) => b.moments - a.moments || a.firstMetT - b.firstMetT),
    speakers,
    segmentCount,
    wordCount,
    laughT,
    bestLine,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mood — the day's weather, as the moments recorded it
// ─────────────────────────────────────────────────────────────────────────────

function moodOf(trip: Trip): WalkLedger["mood"] {
  const tags = new Map<string, number>();
  for (const m of trip.moments)
    for (const tag of m.vibe.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);

  return {
    avgEnergy:
      trip.moments.length > 0
        ? trip.moments.reduce((s, m) => s + m.vibe.energy, 0) / trip.moments.length
        : 0,
    moods: trip.moments.map((m) => ({
      momentId: m.id,
      title: m.title,
      mood: m.vibe.mood,
      energy: m.vibe.energy,
      t: m.tStart,
    })),
    tags: [...tags.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count),
    music: trip.moments.flatMap((m) =>
      m.music
        ? [
            {
              trackName: m.music.trackName,
              artist: m.music.artist,
              chosenBecause: m.music.chosenBecause,
              momentTitle: m.title,
            },
          ]
        : [],
    ),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The log — one line per kept moment
// ─────────────────────────────────────────────────────────────────────────────

function logOf(trip: Trip): LedgerRow[] {
  const byId = new Map(trip.candidates.map((c) => [c.id, c]));

  return trip.moments.map((m) => {
    // Distinct trigger kinds off the moment's own candidate, weight order kept —
    // the candidate lists them in the order stage 2 found them.
    const triggers: TriggerKind[] = [];
    for (const t of byId.get(m.candidateId)?.triggers ?? []) {
      if (!triggers.includes(t.kind)) triggers.push(t.kind);
    }

    return {
      id: m.id,
      tStart: m.tStart,
      tEnd: m.tEnd,
      title: m.title,
      placeLabel: m.place.label,
      people: m.people,
      mood: m.vibe.mood,
      energy: m.vibe.energy,
      triggers,
      objectCount: m.objects.length,
      laughCount: trip.audioEvents.filter(
        (e) => e.kind === "laughter" && e.t >= m.tStart && e.t <= m.tEnd,
      ).length,
      wordCount: m.transcript.reduce((s, seg) => s + seg.text.split(/\s+/).length, 0),
      splatStatus: m.splat.status,
    };
  });
}
