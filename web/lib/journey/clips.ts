/**
 * The contract between a pile of video files and a route through a place.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS FOR
 *
 * One clip is a walk. Several clips are a JOURNEY — you filmed the courtyard,
 * stopped, walked to the fountain, filmed that, walked on. The gaps between the
 * clips are as much a part of the route as the clips themselves, and every phone
 * already stamps each file with when and where it was shot. So the order and the
 * shape of the path do not have to be asked for: they can be read, and then
 * shown to the person who was there so they can say where we got it wrong.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE RULE EVERY MODULE HERE OBEYS
 *
 * MEASURED AND ASSUMED ARE NEVER THE SAME FIELD.
 *
 * A clip with a GPS fix and a clip we guessed the position of both render as a
 * dot on a map, at the same size, in the same colour, unless something in the
 * data forces them apart. So nothing in this module is allowed to fill a hole
 * quietly. `ClipFacts` carries only what a file actually said — every field
 * nullable, and null is the common case, not the error case. Everything derived
 * lives on `RoutedClip` next to a `ClipSource` that names where it came from,
 * and every leap of faith is written down in `assumptions` in words a person can
 * read and disagree with.
 *
 * The corollary: `deriveRoute` is a FIRST DRAFT, not an answer. It is expected
 * to be wrong about at least one clip in a real pile, and the whole design point
 * is that being wrong is cheap — the reader reorders a row or drops a pin and
 * the route re-derives. See ./corrections.ts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE FACTS ARE READ IN THE BROWSER
 *
 * `lib/video/probeMetadata.ts` already reads all of this with ffmpeg — but only
 * for a file that reached the server, and the drop path deliberately keeps the
 * video in the tab. Uploading four hundred megabytes of video to find out what
 * order it goes in would trade the one privacy property this path has for a
 * timestamp. `lib/video/clientMetadata.ts` reads the same tags out of the
 * container in the browser, off a few kilobytes of `File.slice()`.
 *
 * Both fill in the SAME `ClipFacts`, which is why it lives here rather than
 * beside either of them. A clip that arrived from the phone and a clip dragged
 * onto the laptop must produce the same route, or the two paths disagree about
 * the same footage and nobody can say which is right.
 */
import type { GeoPoint } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// What a file said about itself
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Everything read off one video, and nothing inferred.
 *
 * Every field except `id`, `name` and `bytes` is nullable, and on real footage
 * most of them frequently are: sharing a clip through a messaging app, an
 * export, or a re-encode strips the metadata block entirely, and location is
 * only ever present when location services were on at the time.
 *
 * A null here must never be repaired at the reader. It travels as null into
 * `deriveRoute`, which is the one place allowed to decide what to do about it,
 * and which has to say so out loud when it does.
 */
export interface ClipFacts {
  /** Stable within one selection. Not a database id — see `clipId`. */
  id: string;
  /** The filename, as the reader will recognise it. */
  name: string;
  bytes: number;

  /**
   * When it was filmed, ISO 8601, KEEPING the original UTC offset when the
   * container had one (`com.apple.quicktime.creationdate` does; the generic
   * `creation_time` does not and is always UTC).
   *
   * The offset is worth preserving because a journey reads in the time it
   * happened — 7pm in Lisbon is 7pm, not 6pm — and because two clips shot on
   * either side of a timezone boundary sort correctly only if both are
   * absolute. Parse with `Date.parse`, compare as epoch ms, DISPLAY with the
   * offset intact.
   */
  recordedAt: string | null;

  /**
   * The offset in minutes east of UTC, when the file stated one, so a display
   * layer can render local time without re-parsing the string. Null when the
   * timestamp was UTC-only or absent.
   */
  utcOffsetMin: number | null;

  /** Where the camera was. Absent far more often than present. */
  location: GeoPoint | null;

  /** Metres above the ellipsoid, when the fix carried one. Rarely useful, occasionally decisive on a hill. */
  altitudeM: number | null;

  /** "Apple iPhone 15 Pro". Provenance, shown rather than inferred from. */
  device: string | null;

  /** Seconds. Null when the container did not say and nothing has measured it. */
  durationSec: number | null;

  /**
   * The filesystem's last-modified time, ISO 8601, which every `File` has and
   * no container can lose.
   *
   * NOT a substitute for `recordedAt` and never written into it: copying a clip
   * off a phone rewrites this to the time of the copy, so it is routinely hours
   * or days wrong in a way that looks completely plausible. It is here as a
   * TIE-BREAKER of last resort — see `orderedBy` — and every route that leans
   * on it says so.
   */
  fileModifiedAt: string | null;
}

/** A `ClipFacts` with nothing found. The honest result for a stripped file. */
export function emptyFacts(id: string, name: string, bytes: number): ClipFacts {
  return {
    id,
    name,
    bytes,
    recordedAt: null,
    utcOffsetMin: null,
    location: null,
    altitudeM: null,
    device: null,
    durationSec: null,
    fileModifiedAt: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// What we made of them
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where a value on a routed clip came from. This is the field that keeps a
 * guess from looking like a fix.
 *
 *   measured   the file said so
 *   corrected  a person said so, overruling whatever we had
 *   inferred   we worked it out from the clips either side of it
 *   missing    we do not know and are not pretending to
 */
export type ClipSource = "measured" | "corrected" | "inferred" | "missing";

/** What decided the order of the clips. Reported so the UI can caveat it. */
export type OrderBasis =
  /** Real capture timestamps. The only basis that is actually trustworthy. */
  | "recorded-at"
  /** Filesystem mtime — plausible and often wrong. Say so. */
  | "file-modified"
  /** Numbers in the filenames (IMG_0041 before IMG_0042). A convention, not a fact. */
  | "filename"
  /** The order they were handed to us in, because nothing else was available. */
  | "as-given"
  /** A person dragged them into this order. Outranks everything above. */
  | "corrected";

/** One clip's place in the finished route. */
export interface RoutedClip {
  facts: ClipFacts;
  /** 0-based position along the journey. */
  index: number;

  /** Where this clip sits, once inference and corrections have had their turn. */
  location: GeoPoint | null;
  locationSource: ClipSource;

  /** When it was filmed, likewise. */
  recordedAt: string | null;
  recordedAtSource: ClipSource;

  /**
   * Metres from the previous clip's position, when both are known. Null for the
   * first clip and for any clip on either side of a positional hole.
   */
  legMetres: number | null;
  /**
   * Seconds between this clip's start and the PREVIOUS CLIP'S START, when both
   * times are known. Start to start, not start to previous-end.
   *
   * That pairing is deliberate and it is what makes `legSpeedMps` meaningful. A
   * clip's fix is taken where the camera was when recording BEGAN, so the
   * distance between two fixes spans the whole interval between those two
   * starts — including whatever walking happened while the first clip was still
   * recording. Dividing that distance by the shorter start-to-end gap would
   * manufacture implausible speeds out of perfectly ordinary footage.
   */
  legSeconds: number | null;
  /**
   * Implied m/s over the gap. The number that catches a mis-ordering: a walk is
   * about 1.4, a car about 15, and 300 means two clips are not from the same
   * afternoon or the order is wrong.
   */
  legSpeedMps: number | null;

  /** Excluded by the reader. Kept in the list so it can be put back. */
  omitted: boolean;
}

/**
 * A problem with the route, phrased for the person who filmed it.
 *
 * Not exceptions and not validation errors: a route with six of these is still
 * a perfectly good route, and printing them is the entire mechanism by which
 * the reader knows which row to go and fix. Severity orders the list, it does
 * not gate anything.
 */
export interface RouteWarning {
  /** Machine-readable, for tests and for the UI to attach an affordance to. */
  code:
    | "no-timestamps"
    | "no-locations"
    | "partial-locations"
    | "order-guessed"
    | "implausible-speed"
    | "same-timestamp"
    | "long-gap"
    | "mixed-devices"
    | "single-clip";
  /** `ClipFacts.id`s this is about. Empty when it is about the route as a whole. */
  clipIds: string[];
  /** One sentence, lowercase, no trailing period — rendered inside `[ ... ]`. */
  message: string;
  /** `warn` is worth reading; `blocker` means the route is a guess end to end. */
  severity: "note" | "warn" | "blocker";
}

/** The whole derived journey. */
export interface DerivedRoute {
  clips: RoutedClip[];
  orderedBy: OrderBasis;

  /** Sum of the known legs, metres. Legs across a positional hole are skipped, not estimated. */
  totalMetres: number;
  /** First recorded timestamp to last, seconds, when both ends are known. */
  totalSeconds: number | null;

  /** Where the journey starts — the first clip with a position, or null. */
  origin: GeoPoint | null;

  /** How many clips had a real fix, and a real timestamp. The honest denominator. */
  located: number;
  timed: number;

  warnings: RouteWarning[];

  /**
   * Every leap of faith, in prose, in the order it was taken. Rendered verbatim
   * under the route. If this array is empty the route is measured end to end,
   * which on real footage is rare enough to be worth showing off.
   */
  assumptions: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Corrections
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One overruling, from the person who was there.
 *
 * Kept as a separate layer over the derived route rather than written into it,
 * for the reason lib/uploadedTrips.ts gives about derived state generally: if
 * the correction is folded in, "reset this row" cannot be implemented and the
 * UI cannot show that a value was changed — both of which are the difference
 * between an editor and a form that ate your input.
 */
export type ClipCorrection =
  /** Put this clip at this position. Everything else closes up around it. */
  | { kind: "order"; clipId: string; toIndex: number }
  /** This clip was filmed here. */
  | { kind: "location"; clipId: string; location: GeoPoint; label?: string }
  /** This clip was filmed then. ISO 8601, offset preserved if given. */
  | { kind: "time"; clipId: string; recordedAt: string }
  /** Leave this one out of the journey. */
  | { kind: "omit"; clipId: string; omitted: boolean };

/** The set of corrections in play, in the order they were made. */
export interface RouteCorrections {
  edits: ClipCorrection[];
}

export const NO_CORRECTIONS: RouteCorrections = { edits: [] };

// ─────────────────────────────────────────────────────────────────────────────
// Shared numbers, so two modules cannot disagree about them
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Above this, the gap between two clips was not walked.
 *
 * 30 m/s is 108 km/h — comfortably above a car in town and far below the ~300
 * that a mis-ordered pair or a stale GPS fix produces. Crossing it does not
 * stop anything; it raises `implausible-speed`, because the honest response to
 * "you appear to have travelled at 400 m/s" is to show the person the two rows
 * and let them look, not to silently reorder their afternoon.
 */
export const IMPLAUSIBLE_MPS = 30;

/** Longer than this between two clips and it is a different part of the day. */
export const LONG_GAP_SEC = 60 * 60;

/**
 * Metres between two points on the earth. Haversine, mean earth radius.
 *
 * Duplicated in spirit by `metresBetween` in lib/coverage.ts, which is about
 * the capture overlay and imports nothing from here. Kept separate on purpose:
 * that one is on a 12 Hz path and this one runs a few dozen times per upload,
 * and coupling them would tie a hot render loop to a route editor.
 */
export function metresApart(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_008.8;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Epoch ms for a clip's timestamp, or null. Never throws on a malformed string. */
export function epochOf(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}
