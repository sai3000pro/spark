/**
 * The shelf: what THIS person actually has.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * The landing's shelf rendered `listAllTrips()` under the heading "every album
 * the robot has pressed". Those are the nine authored specs in lib/mock/trips.
 * Nobody had pressed them. Someone opening this app for the first time, having
 * recorded nothing and uploaded nothing, was shown nine dated walks through
 * Lisbon, Kyoto and Cape Town — each with a distance, a duration, a moment
 * count and a card that opened a working `/trip/<id>` page. There is no reading
 * of that shelf on which those walks were not being presented as the reader's
 * own. This module answers "what does this person actually have", and the shelf
 * reads it instead.
 *
 * Nothing under lib/mock reaches this file. That is the entire point of it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT COUNTS AS REAL, AND WHICH STORE OWNS THE CAVEATS
 *
 *   walk     lib/uploadedTrips.ts — a clip a real detector ran over. Read that
 *            header before printing any number off one: the detections, the
 *            candidates and the moments are measured; the POSITION is not, and
 *            so neither is the distance. That is why no card here prints a
 *            distance for a walk, only counts and the clip's own length.
 *   album    lib/albums.ts — a name a person typed over a set of walks.
 *   journey  lib/journey/store.ts — several clips and the route between them.
 *            Its legs NAME walks; they are never checked to exist, so this file
 *            resolves them and counts only what came back.
 *   splat    lib/splatJobs.ts — a .ply on disk. Readiness is the file existing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EACH THING APPEARS EXACTLY ONCE, AND WHO CLAIMS IT
 *
 * The four stores overlap: one walk can be filed under an album AND be a leg of
 * a journey AND have a finished reconstruction hanging off it. Listing it three
 * times would inflate the shelf — which, on a page that has just stopped
 * overstating what you own, is the same mistake in a smaller font. So:
 *
 *   1. An ALBUM claims its walks. Filing is a decision a person made and typed
 *      a name for; nothing else on this list outranks that.
 *   2. A JOURNEY claims the remaining walks its legs resolve to. Legs are
 *      bookkeeping the server derived, so they lose to a person's filing.
 *   3. Whatever is left stands as its own walk.
 *   4. A ready SPLAT is a card only when nothing above already leads to it.
 *      `attachSplat` hangs the .ply on every moment of its walk, so when the
 *      job names a walk we are showing, that walk IS the door and a second card
 *      would be the same file twice. A .ply handed straight to `/live` has no
 *      walk behind it and no other door, so it gets one.
 *
 * An album whose walks have all been evicted (uploadedTrips caps at MAX_WALKS)
 * contributes nothing rather than an empty card. lib/globeData.ts already
 * resolves the same situation the same way: an album is a grouping, and with
 * nothing left to group there is nothing to show and nowhere for a card to go.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE SENTENCES ARE BUILT HERE AND NOT IN THE COMPONENT
 *
 * The four kinds have nothing in common to format. A walk counts moments kept,
 * a journey counts the clips that resolved out of the clips that did not, a
 * splat counts megabytes on disk. A component handed all four raw shapes would
 * have to carry every store's honesty rules with it, in the browser, next to
 * the animation code — and the rule that gets dropped in that move is always
 * the one about what a number does not mean. So each card arrives with its line
 * already written, and the caveats stay in the modules that own them.
 */
import { cache } from "react";

import { listAlbums } from "./albums";
import { duration } from "./format";
import { listJourneys } from "./journey/store";
import { computeTripStats } from "./pipeline";
import { listSplatJobs } from "./splatJobs";
import { coverThumbs, type TripThumb } from "./tripData";
import { listUploadedWalks, type UploadedWalk } from "./uploadedTrips";

/**
 * Which store a card came out of.
 *
 * Carried through to the UI rather than flattened away, because the four are
 * not interchangeable and the reader can tell: a journey is a route, a splat is
 * a file, and a card that quietly called both "a walk" would be the shelf
 * making the same claim it was just fixed for making.
 */
export type CaptureKind = "walk" | "album" | "journey" | "splat";

export interface CaptureCard {
  kind: CaptureKind;
  id: string;
  /** A route that exists for this kind. Never a guess; see `hrefFor` cases. */
  href: string;
  title: string;
  /**
   * The date the shelf sorts and prints. What it MEANS differs by kind — when a
   * walk was filmed, when a route was laid out — which is why each builder sets
   * it explicitly rather than inheriting one rule.
   */
  at: string;
  /** One line, literally true, built where the caveats live. */
  detail: string;
  /**
   * A caveat this card must carry, or null. Printed under the line, smaller.
   * Only ever set when there is something the reader would otherwise assume
   * wrongly — an absent location, a route with holes in it.
   */
  note: string | null;
  /** [0] is the cover; the rest fill the card's mini strip. Empty for a splat. */
  thumbs: TripThumb[];
}

/**
 * Everything this person has, newest first.
 *
 * React.cache so the shelf and any future header count come off one pass —
 * `listSplatJobs` stats every .ply on disk, and doing that twice per request to
 * answer "is the shelf empty" and "what is on it" would be two answers that
 * could disagree across a file landing between them.
 */
export const listCaptures = cache((): CaptureCard[] => {
  const walks = new Map(listUploadedWalks().map((w) => [w.id, w]));
  /** Walks some card above has already taken responsibility for showing. */
  const claimed = new Set<string>();
  const cards: CaptureCard[] = [];

  for (const album of listAlbums()) {
    const members = album.journeyIds
      .map((id) => walks.get(id))
      .filter((w): w is UploadedWalk => Boolean(w));
    if (members.length === 0) continue;
    for (const w of members) claimed.add(w.id);

    const cover = members.find((w) => w.id === album.coverJourneyId) ?? members[0];
    const moments = members.reduce((n, w) => n + w.built.trip.moments.length, 0);

    cards.push({
      kind: "album",
      id: album.id,
      // There is no `/album/<id>` route — `/album` is the studio's own shelf of
      // splats, a different thing entirely — so an album opens the walk it
      // chose to represent itself. Linking somewhere that 404s would be worse
      // than linking one level in.
      href: `/trip/${cover.id}`,
      title: album.title,
      // The newest walk in it. An album is open-ended, so "when did this last
      // get something" is the fact that sorts it sensibly among single walks.
      at: members.reduce(
        (newest, w) => (w.built.trip.startedAt > newest ? w.built.trip.startedAt : newest),
        members[0].built.trip.startedAt,
      ),
      detail: [countOf(members.length, "walk"), countOf(moments, "moment")].join(" · "),
      note: null,
      thumbs: coverThumbs(cover.built.trip),
    });
  }

  for (const journey of listJourneys()) {
    const built: UploadedWalk[] = [];
    for (const leg of journey.legs) {
      const walk = leg.tripId ? walks.get(leg.tripId) : undefined;
      if (walk && !claimed.has(walk.id)) built.push(walk);
    }
    for (const w of built) claimed.add(w.id);

    const clips = journey.route.clips.length;
    const located = journey.route.located;

    cards.push({
      kind: "journey",
      id: journey.id,
      href: `/journey/${journey.id}`,
      title: journey.title ?? "An unnamed journey",
      // When the route was worked out, not when the clips were filmed. The
      // route is derived once at create time and never re-derived (see that
      // store's header), so this is the only date it can honestly carry.
      at: journey.createdAt,
      detail: [
        countOf(clips, "clip"),
        // "Built into a walk", not "has one": the legs' ids are unverified in
        // the store, so this counts the ones that came back from the lookup
        // above and nothing else.
        `${built.length} built into ${built.length === 1 ? "a walk" : "walks"}`,
      ].join(" · "),
      note:
        located < clips
          ? `${clips - located} of these clips carried no position, so the route skips those legs rather than estimating them.`
          : null,
      thumbs: built.flatMap((w) => coverThumbs(w.built.trip)).slice(0, 4),
    });
  }

  for (const walk of walks.values()) {
    if (claimed.has(walk.id)) continue;
    const { trip, distanceM } = walk.built;
    const stats = computeTripStats(trip, distanceM);

    cards.push({
      kind: "walk",
      id: walk.id,
      href: `/trip/${walk.id}`,
      title: trip.title,
      // The container's own timestamp when the file carried one, otherwise the
      // moment it was uploaded — uploadedTrips decides which, and both are the
      // honest answer to "when is this walk".
      at: trip.startedAt,
      detail: [
        // No distance. An uploaded clip has no odometry and no GPS, so its
        // metres are a synthesized transect — see lib/uploadedTrips.ts. The
        // duration is the video's real length and the moments were really kept.
        stats.momentCount === 0
          ? "nothing kept from it"
          : countOf(stats.momentCount, "moment"),
        duration(stats.durationSec),
      ].join(" · "),
      note: trip.place.originMeasured
        ? null
        : "The file carried no location, so this walk is not really anywhere yet.",
      thumbs: coverThumbs(trip),
    });
  }

  for (const job of listSplatJobs()) {
    if (job.status !== "ready") continue;
    // A job naming a walk we are showing is reachable through that walk's
    // moments; only a reconstruction with no walk behind it needs a card.
    if (job.tripId && walks.has(job.tripId)) continue;

    cards.push({
      kind: "splat",
      id: job.id,
      href: `/splat/${job.id}`,
      title: job.sourceName,
      at: job.createdAt,
      // `note` off the job is already the honest sentence — it is derived from
      // the file on disk, and it is the megabytes that are actually there.
      detail: job.note,
      note:
        job.origin === "upload"
          ? "Brought in as a finished splat. There is no walk behind it — no clip was ever scored."
          : null,
      thumbs: [],
    });
  }

  return cards.sort((a, b) => b.at.localeCompare(a.at));
});

/** "1 walk", "3 walks" — the shelf says these often enough to spell once. */
function countOf(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
