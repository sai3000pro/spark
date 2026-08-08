/**
 * "Where is my water bottle?"
 *
 * Builds a trip-wide index of every object the robot saw, grouped by label, and
 * answers loose natural-language queries against it. Deliberately not an LLM:
 * this has to run instantly and offline on the robot, and the hard part was never
 * the language — it was having a trustworthy index to look things up in.
 */
import { LABEL_ALIASES, LABEL_FAMILIES, familyOf } from "./mock/labels";
import { nearestPathPoint } from "./mock/generatePath";
import type {
  IndexedSighting,
  Moment,
  ObjectIndexEntry,
  ObjectSearchResult,
  TrackPoint,
  Vec2,
} from "./types";

export function buildObjectIndex(moments: Moment[], path: TrackPoint[] = []): ObjectIndexEntry[] {
  const byLabel = new Map<string, IndexedSighting[]>();

  for (const moment of moments) {
    for (const o of moment.objects) {
      // The frame this object looked best in — that is the one worth showing.
      const kf =
        moment.keyframes.find((k) => k.id === o.keyframeId) ?? moment.keyframes[0];
      const indexed: IndexedSighting = {
        ...o,
        momentId: moment.id,
        momentTitle: moment.title,
        placeLabel: moment.place.label,
        thumbnail: { placeholderSeed: kf.placeholderSeed, hue: kf.hue, url: kf.url },
      };
      const arr = byLabel.get(o.label);
      if (arr) arr.push(indexed);
      else byLabel.set(o.label, [indexed]);
    }
  }

  const entries: ObjectIndexEntry[] = [];
  for (const [label, sightings] of byLabel) {
    sightings.sort((a, b) => b.lastSeenT - a.lastSeenT);
    // "Best" balances confidence against recency — for finding a thing you lost,
    // a slightly blurrier look at where it ended up beats a crisp look from an
    // hour earlier.
    const lastSeenT = Math.max(...sightings.map((s) => s.lastSeenT));
    const best = sightings.reduce((a, b) => (rank(b, lastSeenT) > rank(a, lastSeenT) ? b : a));

    entries.push({
      label,
      sightings,
      lastSeenT,
      best,
      navTarget: navTargetFor(best, path),
    });
  }

  return entries.sort((a, b) => b.lastSeenT - a.lastSeenT);
}

const rank = (s: IndexedSighting, lastSeenT: number) =>
  s.confidence * 0.6 + (lastSeenT > 0 ? s.lastSeenT / lastSeenT : 0) * 0.4;

/**
 * The pose the robot would drive to in order to show you the thing.
 *
 * `heading` is a compass bearing in DEGREES, 0–360, measured clockwise from +z.
 * It used to be raw `Math.atan2` radians while every caller rendered it with a
 * "°" suffix, so every object in the trip reported a heading between -3° and 3°.
 */
function navTargetFor(
  sighting: IndexedSighting,
  path: TrackPoint[],
): ObjectIndexEntry["navTarget"] {
  if (!sighting.worldPos || !path.length) return undefined;
  // worldPos is [x, up, z]; the robot navigates the ground plane.
  const ground: Vec2 = [sighting.worldPos[0], sighting.worldPos[2]];
  const near = nearestPathPoint(path, ground);
  const deg = (Math.atan2(ground[0] - near.pos[0], ground[1] - near.pos[1]) * 180) / Math.PI;
  return {
    pos: ground,
    heading: Math.round(((deg % 360) + 360) % 360),
    approachFromT: near.t,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Query
// ─────────────────────────────────────────────────────────────────────────────

/** Words people wrap a real query in. Stripping these is 90% of the "NLU". */
const STOP_WORDS = new Set([
  "where", "is", "are", "was", "were", "my", "mine", "the", "a", "an", "did", "i",
  "you", "we", "leave", "left", "put", "see", "saw", "find", "show", "me", "can",
  "could", "please", "on", "in", "at", "to", "do", "does", "have", "has", "get",
  "go", "went", "it", "that", "this", "there", "here", "know", "remember", "last",
  "time", "seen", "look", "for", "of", "any", "some", "and", "what", "which",
]);

export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .join(" ")
    .trim();
}

export function searchObjects(
  query: string,
  index: ObjectIndexEntry[],
  limit = 6,
): ObjectSearchResult[] {
  const q = normalizeQuery(query);
  if (!q) return [];

  const results: ObjectSearchResult[] = [];

  for (const entry of index) {
    const label = entry.label;
    let matchScore = 0;
    let matchedOn: ObjectSearchResult["matchedOn"] = "fuzzy";

    if (label === q) {
      matchScore = 1;
      matchedOn = "exact";
    } else if (q.includes(label) || label.includes(q)) {
      matchScore = 0.9;
      matchedOn = "exact";
    } else {
      const aliases = LABEL_ALIASES[label] ?? [];
      const hitAlias = aliases.find((a) => q === a || q.includes(a) || a.includes(q));
      if (hitAlias) {
        matchScore = 0.82;
        matchedOn = "alias";
      } else if (isFamilyQuery(q, label)) {
        matchScore = 0.5;
        matchedOn = "category";
      } else {
        const sim = bestTokenSimilarity(q, [label, ...aliases]);
        if (sim > 0.62) {
          matchScore = sim * 0.75;
          matchedOn = "fuzzy";
        }
      }
    }

    if (matchScore > 0) {
      // Nudge by evidence quality so a confident, recent sighting outranks a
      // marginal one when both labels match equally well.
      const evidence = entry.best.confidence * 0.15;
      results.push({ entry, matchScore: Math.min(1, matchScore + evidence), matchedOn });
    }
  }

  return results.sort((a, b) => b.matchScore - a.matchScore).slice(0, limit);
}

function isFamilyQuery(q: string, label: string): boolean {
  const fam = familyOf(label);
  if (q === fam) return true;
  // "my stuff" / "my things" → personal items.
  if ((q === "stuff" || q === "things" || q === "belongings") && fam === "personal") return true;
  if ((q === "animal" || q === "animals") && fam === "animal") return true;
  return Object.prototype.hasOwnProperty.call(LABEL_FAMILIES, q) && q === fam;
}

/** Normalized Levenshtein over the closest token — catches typos and plurals. */
function bestTokenSimilarity(q: string, candidates: string[]): number {
  const qTokens = q.split(" ");
  let best = 0;
  for (const cand of candidates) {
    for (const ct of cand.split(" ")) {
      for (const qt of qTokens) {
        const d = levenshtein(qt, ct);
        const sim = 1 - d / Math.max(qt.length, ct.length, 1);
        if (sim > best) best = sim;
      }
    }
  }
  return best;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

/** Suggestions shown in the empty state of the search palette. */
export function suggestedQueries(index: ObjectIndexEntry[], n = 4): string[] {
  const preferred = ["bottle", "backpack", "cell phone", "frisbee", "cup", "bicycle"];
  const available = preferred.filter((l) => index.some((e) => e.label === l));
  const phrases = available.map((l) => {
    const alias = LABEL_ALIASES[l]?.[0] ?? l;
    return `where is my ${alias}`;
  });
  for (const e of index) {
    if (phrases.length >= n) break;
    if (!available.includes(e.label)) phrases.push(`where is the ${e.label}`);
  }
  return phrases.slice(0, n);
}
