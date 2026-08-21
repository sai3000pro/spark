/**
 * Albums: the layer between a walk and the globe.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT AN ALBUM IS, AND WHAT IT WAS
 *
 * Until now "album" and "walk" were the same thing — lib/globeData.ts builds one
 * GlobeAlbum per trip and pins it. That is fine for nine authored demo walks and
 * wrong for a person who goes back to the same park four times: they get four
 * unrelated pins and no way to say those belong together.
 *
 * So an album is a NAMED COLLECTION OF JOURNEYS, and a journey is one walk. It
 * matches supabase/migrations/004: `albums`, `journeys`, and the
 * `album_journeys` join that keeps the relationship many-to-one without an
 * album_id column on the journey.
 *
 *   album      "Autumn in Waterloo"
 *     journey    the walk on the 3rd      ← moments live here
 *     journey    the walk on the 11th
 *
 * A journey belongs to at most one album, which is a deliberate simplification
 * of the schema (which allows many). Two albums claiming the same walk raises
 * "which one does the globe pin it under?", and nobody has ever asked for it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STORAGE
 *
 * globalThis singleton for the working set, written through to
 * `.data/albums/<id>.json` so it DOES survive a restart. It did not used to,
 * and an album is the worst thing in this codebase to lose: it is a decision a
 * person made and typed a name for, which is the same reason there is no LRU
 * cap here. Everything goes through the functions below and nothing touches the
 * map directly, so the swap to Postgres is still this one file — `hydrate` and
 * `persist` are the two calls it replaces. Still single process and single
 * machine; see lib/persist.ts for what that does and does not buy.
 *
 * Unlike uploadedTrips there is NO LRU cap here. Evicting someone's album to
 * make room is a different kind of loss from evicting a cached walk — an album
 * is a decision a person made, and the walks it names may already be gone.
 * Albums are tiny (a title and a list of ids); the thing worth capping is bytes.
 */

import { __wipeStore, forget, hydrate, persist } from "./persist";

export interface Album {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** Walk ids, newest first. */
  journeyIds: string[];
  /** Which journey's cover represents the album. Null until one is added. */
  coverJourneyId: string | null;
}

export const ALBUM_ID_PREFIX = "album_";

export const isAlbumId = (id: string): boolean => id.startsWith(ALBUM_ID_PREFIX);

/** Long enough to be a real name, short enough to sit under a globe pin. */
export const MAX_TITLE = 60;

interface Store {
  albums: Map<string, Album>;
  /** journeyId → albumId. Derived, but kept so the lookup is not a scan. */
  byJourney: Map<string, string>;
  /** Whether the disk sidecars have been read back into this process yet. */
  hydrated: boolean;
}

const KEY = Symbol.for("spark.albums.store");

/** Sidecar directory under `.data/`. See lib/persist.ts. */
const STORE_NAME = "albums";

/**
 * Is this parsed JSON an album we are willing to serve?
 *
 * An album is small and flat, so unlike a journey this can afford to check the
 * whole shape. `journeyIds` is checked to be an array OF STRINGS rather than
 * merely an array: those ids are dereferenced against uploadedTrips and end up
 * as pins on the globe, and a number in there would resolve to nothing at a
 * point far from here.
 */
function parseAlbum(raw: unknown): Album | null {
  if (typeof raw !== "object" || raw === null) return null;
  const a = raw as Partial<Album>;
  if (typeof a.id !== "string" || !isAlbumId(a.id)) return null;
  if (typeof a.title !== "string" || a.title.length === 0) return null;
  if (typeof a.createdAt !== "string" || Number.isNaN(Date.parse(a.createdAt))) return null;
  if (typeof a.updatedAt !== "string" || Number.isNaN(Date.parse(a.updatedAt))) return null;
  if (!Array.isArray(a.journeyIds) || a.journeyIds.some((j) => typeof j !== "string")) return null;
  if (a.coverJourneyId !== null && typeof a.coverJourneyId !== "string") return null;
  return a as Album;
}

function store(): Store {
  const g = globalThis as unknown as Record<symbol, Store | undefined>;
  const s = (g[KEY] ??= { albums: new Map(), byJourney: new Map(), hydrated: false });

  if (!s.hydrated) {
    s.hydrated = true; // set first — a throw below must not retry forever
    const found = hydrate(STORE_NAME, parseAlbum);
    found.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const album of found) {
      s.albums.set(album.id, album);
      // byJourney is DERIVED, so it is rebuilt from the albums rather than
      // persisted alongside them. Storing it would create a second copy of the
      // same fact that could come back disagreeing with the first.
      for (const journeyId of album.journeyIds) s.byJourney.set(journeyId, album.id);
    }
  }
  return s;
}

/**
 * Write one album through to disk. Best effort — see lib/persist.ts.
 *
 * Called from every mutator rather than only from createAlbum, because an
 * album is almost entirely made of things that happen afterwards: the walks
 * filed into it, its cover, its name. A sidecar written once at create time
 * would come back as an empty album with the right title, which reads as "your
 * walks were lost" rather than "we failed to save".
 */
function persistAlbum(albumId: string): void {
  const album = store().albums.get(albumId);
  if (album) persist(STORE_NAME, albumId, album);
}

/**
 * Trim, collapse whitespace, cap. Returns null when nothing is left.
 *
 * Exported because the save screen validates before it POSTs, and one
 * implementation of "is this a usable title" beats two that disagree about
 * whether a string of spaces counts.
 */
export function normaliseTitle(raw: string): string | null {
  const title = raw.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
  return title.length > 0 ? title : null;
}

export function listAlbums(): Album[] {
  return [...store().albums.values()].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export function getAlbum(id: string): Album | null {
  return store().albums.get(id) ?? null;
}

/** The album a walk was filed under, if any. */
export function albumForJourney(journeyId: string): Album | null {
  const albumId = store().byJourney.get(journeyId);
  return albumId ? (store().albums.get(albumId) ?? null) : null;
}

export type CreateAlbumResult =
  | { ok: true; album: Album }
  | { ok: false; reason: "bad-title" };

/**
 * A new album, optionally with its first journey.
 *
 * The two happen together because that is how it is always used: nobody makes
 * an empty album and comes back later, they finish a walk and decide it starts
 * something. Splitting it would mean an empty album exists for one round trip
 * and is orphaned if the second call fails.
 */
export function createAlbum(input: {
  title: string;
  journeyId?: string | null;
}): CreateAlbumResult {
  const title = normaliseTitle(input.title);
  if (!title) return { ok: false, reason: "bad-title" };

  const now = new Date().toISOString();
  const id = `${ALBUM_ID_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const album: Album = {
    id,
    title,
    createdAt: now,
    updatedAt: now,
    journeyIds: [],
    coverJourneyId: null,
  };
  store().albums.set(id, album);
  persistAlbum(id);

  if (input.journeyId) addToAlbum(id, input.journeyId);
  return { ok: true, album: store().albums.get(id)! };
}

export type AddResult =
  | { ok: true; album: Album }
  | { ok: false; reason: "no-such-album" };

/**
 * File a walk under an album, moving it if it was already somewhere else.
 *
 * Moving rather than refusing: "put this in Autumn instead" is the obvious
 * thing to want, and an error telling you to remove it first would be the app
 * being pedantic about a rule it invented.
 */
export function addToAlbum(albumId: string, journeyId: string): AddResult {
  const s = store();
  const album = s.albums.get(albumId);
  if (!album) return { ok: false, reason: "no-such-album" };

  const previous = s.byJourney.get(journeyId);
  if (previous === albumId) return { ok: true, album };
  if (previous) removeFromAlbum(previous, journeyId);

  album.journeyIds = [journeyId, ...album.journeyIds.filter((j) => j !== journeyId)];
  album.coverJourneyId ??= journeyId;
  album.updatedAt = new Date().toISOString();
  s.byJourney.set(journeyId, albumId);
  persistAlbum(albumId);

  return { ok: true, album };
}

export function removeFromAlbum(albumId: string, journeyId: string): boolean {
  const s = store();
  const album = s.albums.get(albumId);
  if (!album) return false;

  const before = album.journeyIds.length;
  album.journeyIds = album.journeyIds.filter((j) => j !== journeyId);
  if (album.journeyIds.length === before) return false;

  // The cover pointed at the walk that just left. Fall to whatever is now
  // first rather than leaving a dangling reference the globe would resolve to
  // nothing.
  if (album.coverJourneyId === journeyId) {
    album.coverJourneyId = album.journeyIds[0] ?? null;
  }
  album.updatedAt = new Date().toISOString();
  if (s.byJourney.get(journeyId) === albumId) s.byJourney.delete(journeyId);
  persistAlbum(albumId);

  return true;
}

export type RenameResult =
  | { ok: true; album: Album }
  | { ok: false; reason: "no-such-album" | "bad-title" };

export function renameAlbum(albumId: string, raw: string): RenameResult {
  const album = store().albums.get(albumId);
  if (!album) return { ok: false, reason: "no-such-album" };
  const title = normaliseTitle(raw);
  if (!title) return { ok: false, reason: "bad-title" };

  album.title = title;
  album.updatedAt = new Date().toISOString();
  persistAlbum(albumId);
  return { ok: true, album };
}

/** Deletes the album, never the walks in it. */
export function deleteAlbum(albumId: string): boolean {
  const s = store();
  const album = s.albums.get(albumId);
  if (!album) return false;
  for (const journeyId of album.journeyIds) {
    if (s.byJourney.get(journeyId) === albumId) s.byJourney.delete(journeyId);
  }
  s.albums.delete(albumId);
  // Delete means delete. Leaving the sidecar would resurrect the album at the
  // next restart, which is the worst possible answer to "I deleted that".
  forget(STORE_NAME, albumId);
  return true;
}

/**
 * Forget a walk that no longer exists.
 *
 * uploadedTrips evicts its oldest walk past MAX_WALKS, which would otherwise
 * leave albums naming ids that resolve to nothing — a pin with no destination.
 */
export function forgetJourney(journeyId: string): void {
  const albumId = store().byJourney.get(journeyId);
  if (albumId) removeFromAlbum(albumId, journeyId);
}

export function __resetAlbums(): void {
  __wipeStore(STORE_NAME);
  const s = store();
  s.albums.clear();
  s.byJourney.clear();
  s.hydrated = true;
}

/**
 * Drop what this process holds WITHOUT touching disk — what a restart actually
 * is, and the only way to test durability. Tests only.
 */
export function __simulateRestart(): void {
  const g = globalThis as unknown as Record<symbol, Store | undefined>;
  g[KEY] = { albums: new Map(), byJourney: new Map(), hydrated: false };
}
