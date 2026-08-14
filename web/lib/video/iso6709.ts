/**
 * ISO 6709 — the coordinate format QuickTime stores a location in.
 *
 * Its own module, free of `server-only` and of any Node import, so
 * scripts/verify-pipeline.ts can assert it under tsx. Same split as
 * lib/splat/renderer.ts against useSplatRenderer.ts: the part with real logic
 * is the part worth testing, and spawning ffmpeg is not it.
 */
/**
 * ISO 6709, the format QuickTime stores a fix in.
 *
 * `+43.6406-079.4019+076.320/` — sign-prefixed latitude, then longitude, then
 * an optional altitude, then a solidus. The signs are the delimiters; there is
 * nothing else separating the numbers, which is why this is a regex and not a
 * split.
 *
 * Rejects out-of-range values rather than clamping them. A latitude of 91 means
 * the string was not what we thought it was, and clamping it to 90 would put a
 * confident pin at the north pole.
 */
export function parseISO6709(raw: string): { lat: number; lng: number } | null {
  const m = /([+-]\d{1,3}(?:\.\d+)?)([+-]\d{1,3}(?:\.\d+)?)/.exec(raw.trim());
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  // 0,0 is in the Gulf of Guinea and is overwhelmingly a null island rather
  // than a capture. Treated as absent, which is what it almost always means.
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}
