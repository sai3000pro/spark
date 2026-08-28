/**
 * Ids that are also secrets, because in this app they are.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PROBLEM THIS FIXES
 *
 * Nothing here has accounts yet, so several routes say out loud that knowing an
 * id IS the authorisation — app/api/splat/jobs/[jobId]/video/route.ts puts it
 * plainly: "Knowing the job id is the whole authorisation, and job ids are
 * minted from a timestamp... so they are guessable by anyone who can guess a
 * millisecond."
 *
 * That was written as a caveat and it was really a hole. A job id was
 * `splat_<Date.now() in base36>` with nothing else in it, so the id space for a
 * given day is about 86 million values, and anybody who knew roughly WHEN a walk
 * was recorded could find it in far fewer tries than that. The same was true of
 * `journey_` and `album_`, which carry four characters of `Math.random()` —
 * which is not a CSPRNG, is seeded per process, and whose base-36 rendering is
 * not even fixed length (0.5 renders as "0.i", so `.slice(2, 6)` can return one
 * character). See the header of `tempUploadPath` in app/api/splat/upload/
 * limits.ts, which already worked this out for temp files.
 *
 * The cross-site half of that exposure is closed by proxy.ts, which refuses
 * writes from another origin. This closes the other half, which the proxy
 * deliberately cannot: READS. `GET /api/splat/jobs/<id>/video` has to stay open
 * to a browser, and this dev server binds the LAN on purpose — that is how the
 * phone reaches it after scanning the QR. So anybody else on that Wi-Fi could
 * walk the timestamps and pull down somebody's recordings.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS DOES NOT CLAIM
 *
 * An unguessable id is a capability, not an identity. It stops enumeration; it
 * does not stop a link from being forwarded, and it will not survive being the
 * only answer once there is more than one person using an instance. The real fix
 * is still owners on rows and a session to check them against — Phase 1.3/1.4,
 * and web/docs/production-readiness.md. This is the part that can be true today.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE TIMESTAMP STAYS
 *
 * Every id built here keeps its time prefix. It is not doing security work and
 * never was, but it makes a directory listing sort chronologically, which is how
 * a person actually looks for one of these — the same reason `tempUploadPath`
 * kept its timestamp after being handed a UUID.
 */

/**
 * Random hex from the platform CSPRNG.
 *
 * `crypto.getRandomValues` rather than `node:crypto` so this file stays safe to
 * import from anywhere: `lib/albums.ts` and `lib/journey/store.ts` are reached
 * from server code today, but a `node:` import is a landmine for whoever first
 * touches one of them from a component, and the Web Crypto global is present in
 * both runtimes.
 *
 * Eight bytes — 64 bits — is the default. Guessing one is 2^63 tries on average
 * against a server that answers one request at a time; the timestamp in front of
 * it narrows nothing, because the entropy is not in the timestamp.
 */
export function randomSuffix(bytes = 8): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = "";
  for (const b of buf) out += b.toString(16).padStart(2, "0");
  return out;
}

/**
 * `<prefix><base36 ms>_<random hex>`.
 *
 * The underscore matters: it makes the boundary between "when" and "which"
 * visible, so a reader can tell at a glance that the tail is not a counter and
 * must not be reconstructed from anything.
 *
 * Every id this produces stays inside `[A-Za-z0-9_-]`, which is what
 * lib/persist.ts's `SAFE_ID` fence and `SAFE_SESSION` in the posed-capture route
 * both require. An id that could not pass those fences would be one that cannot
 * be stored.
 */
export function mintId(prefix: string, at: Date = new Date()): string {
  return `${prefix}${at.getTime().toString(36)}_${randomSuffix()}`;
}
