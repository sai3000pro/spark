/**
 * Runtime validation for the ingest endpoints.
 *
 * Hand-rolled rather than zod on purpose: the contract lives in lib/types.ts and
 * a second schema DSL would be a second source of truth to keep in sync. These
 * functions exist so the robot gets a real 400 with a reason instead of silently
 * writing junk into the pipeline at 2am.
 */
import type { Detection, Moment } from "./types";
import type { StartTripInput } from "./liveTrip";

export type Validated<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;

function checkBBox(v: unknown, path: string, errors: string[]): boolean {
  if (!Array.isArray(v) || v.length !== 4 || !v.every(isNum)) {
    errors.push(`${path}: expected [x, y, w, h] of 4 numbers`);
    return false;
  }
  if (v.some((n) => n < 0 || n > 1)) {
    errors.push(`${path}: must be normalized 0..1 (got ${JSON.stringify(v)})`);
    return false;
  }
  return true;
}

export function validateDetection(input: unknown, i: number, errors: string[]): boolean {
  if (typeof input !== "object" || input === null) {
    errors.push(`[${i}]: not an object`);
    return false;
  }
  const d = input as Record<string, unknown>;
  const before = errors.length;

  for (const key of ["id", "tripId", "frameId", "label", "source"] as const) {
    if (!isStr(d[key])) errors.push(`[${i}].${key}: required string`);
  }
  if (!isNum(d.t) || (d.t as number) < 0) errors.push(`[${i}].t: required number >= 0`);
  if (!isNum(d.confidence) || (d.confidence as number) < 0 || (d.confidence as number) > 1) {
    errors.push(`[${i}].confidence: required number 0..1`);
  }
  checkBBox(d.bbox, `[${i}].bbox`, errors);

  if (d.source !== undefined && !["onboard", "cloud", "manual"].includes(d.source as string)) {
    errors.push(`[${i}].source: must be onboard | cloud | manual`);
  }
  if (d.worldPos !== undefined) {
    const w = d.worldPos;
    if (!Array.isArray(w) || w.length !== 3 || !w.every(isNum)) {
      errors.push(`[${i}].worldPos: expected [x, up, z]`);
    }
  }
  if (d.trackId !== undefined && !isStr(d.trackId)) {
    errors.push(`[${i}].trackId: must be a non-empty string when present`);
  }

  return errors.length === before;
}

export function validateDetections(body: unknown): Validated<Detection[]> {
  const errors: string[] = [];
  const rows = Array.isArray(body)
    ? body
    : typeof body === "object" && body !== null && Array.isArray((body as { detections?: unknown }).detections)
      ? ((body as { detections: unknown[] }).detections)
      : null;

  if (!rows) return { ok: false, errors: ["expected an array, or { detections: [...] }"] };
  if (rows.length === 0) return { ok: false, errors: ["empty batch"] };
  if (rows.length > 20_000) return { ok: false, errors: [`batch too large (${rows.length} > 20000)`] };

  rows.forEach((row, i) => validateDetection(row, i, errors));
  // Cap the error list — a malformed client would otherwise generate megabytes.
  if (errors.length) return { ok: false, errors: errors.slice(0, 25) };
  return { ok: true, value: rows as Detection[] };
}

export function validateMoment(body: unknown): Validated<Moment> {
  const errors: string[] = [];
  if (typeof body !== "object" || body === null) {
    return { ok: false, errors: ["expected an object"] };
  }
  const m = body as Record<string, unknown>;

  for (const key of ["id", "tripId", "candidateId", "title", "summary"] as const) {
    if (!isStr(m[key])) errors.push(`${key}: required string`);
  }
  if (!isNum(m.tStart) || !isNum(m.tEnd)) errors.push("tStart/tEnd: required numbers");
  else if ((m.tEnd as number) <= (m.tStart as number)) errors.push("tEnd must be after tStart");

  // `place` is read unconditionally by buildObjectIndex, so a missing one is a
  // 400, not a 500.
  const place = m.place as Record<string, unknown> | undefined;
  if (!place || !isStr(place.label)) {
    errors.push("place: requires { label: string, pos: [x, z] }");
  } else if (
    !Array.isArray(place.pos) ||
    place.pos.length !== 2 ||
    !place.pos.every(isNum)
  ) {
    errors.push("place.pos: expected [x, z] in the trip's local frame");
  }

  if (!Array.isArray(m.people)) errors.push("people: required array (may be empty)");

  if (!Array.isArray(m.keyframes) || m.keyframes.length === 0) {
    errors.push("keyframes: required non-empty array (keyframes[0] is the thumbnail)");
  } else {
    // Every keyframe must be renderable — components read these directly.
    m.keyframes.forEach((k, i) => {
      const kf = k as Record<string, unknown>;
      if (!isStr(kf.id)) errors.push(`keyframes[${i}].id: required string`);
      if (!isNum(kf.t)) errors.push(`keyframes[${i}].t: required number`);
      if (!isNum(kf.placeholderSeed)) {
        errors.push(`keyframes[${i}].placeholderSeed: required number (seeds the fallback frame)`);
      }
    });
  }

  if (!Array.isArray(m.objects)) errors.push("objects: required array");
  else {
    const kfIds = new Set(
      Array.isArray(m.keyframes)
        ? m.keyframes.map((k) => (k as Record<string, unknown>).id)
        : [],
    );
    m.objects.forEach((o, i) => {
      const s = o as Record<string, unknown>;
      if (!isStr(s.label)) errors.push(`objects[${i}].label: required string`);
      if (!isStr(s.trackId)) errors.push(`objects[${i}].trackId: required string`);
      if (!isNum(s.confidence)) errors.push(`objects[${i}].confidence: required number`);
      checkBBox(s.bestBbox, `objects[${i}].bestBbox`, errors);
      // A sighting pointing at a keyframe that isn't in the payload would break
      // the search thumbnail silently.
      if (!isStr(s.keyframeId) || !kfIds.has(s.keyframeId)) {
        errors.push(`objects[${i}].keyframeId: must reference one of this moment's keyframes`);
      }
    });
  }

  if (!Array.isArray(m.transcript)) errors.push("transcript: required array (may be empty)");

  const splat = m.splat as Record<string, unknown> | undefined;
  if (!splat || !["ready", "processing", "failed"].includes(splat.status as string)) {
    errors.push("splat.status: must be ready | processing | failed");
  } else if (splat.status === "ready" && !isStr(splat.url)) {
    errors.push("splat.url: required when status is ready");
  }

  const vibe = m.vibe as Record<string, unknown> | undefined;
  if (!vibe || !isStr(vibe.mood) || !isNum(vibe.energy)) {
    errors.push("vibe: requires { mood: string, energy: number, tags: string[] }");
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: body as Moment };
}

// ─────────────────────────────────────────────────────────────────────────────
// Live trip control
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Everything is optional — starting a trip from the toolbar sends nothing at all,
 * and the robot will send what it knows. What is present has to be right.
 */
export function validateStartTrip(input: unknown): Validated<StartTripInput> {
  if (input === undefined || input === null) return { ok: true, value: {} };
  if (typeof input !== "object") return { ok: false, errors: ["body: expected an object"] };

  const b = input as Record<string, unknown>;
  const errors: string[] = [];

  for (const key of ["placeLabel", "region", "country"] as const) {
    if (b[key] !== undefined && !isStr(b[key])) {
      errors.push(`${key}: must be a non-empty string when present`);
    }
  }

  if (b.source !== undefined && !["ui", "robot"].includes(b.source as string)) {
    errors.push("source: must be ui | robot");
  }

  if (b.origin !== undefined) {
    const o = b.origin as Record<string, unknown> | null;
    if (!o || typeof o !== "object" || !isNum(o.lat) || !isNum(o.lng)) {
      errors.push("origin: expected { lat: number, lng: number }");
    } else if ((o.lat as number) < -90 || (o.lat as number) > 90) {
      errors.push("origin.lat: must be -90..90");
    } else if ((o.lng as number) < -180 || (o.lng as number) > 180) {
      errors.push("origin.lng: must be -180..180");
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: input as StartTripInput };
}

export function validateStopTrip(input: unknown): Validated<{ tripId?: string }> {
  if (input === undefined || input === null) return { ok: true, value: {} };
  if (typeof input !== "object") return { ok: false, errors: ["body: expected an object"] };

  const b = input as Record<string, unknown>;
  if (b.tripId !== undefined && !isStr(b.tripId)) {
    return { ok: false, errors: ["tripId: must be a non-empty string when present"] };
  }
  return { ok: true, value: input as { tripId?: string } };
}
