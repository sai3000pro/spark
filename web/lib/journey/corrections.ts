/**
 * What the person who was there says, laid over what the files said.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A LAYER AND NOT A FIELD
 *
 * The obvious implementation is to write the fix straight into the clip: the
 * reader drags a pin, we set `facts.location`, we re-derive, done. `ClipFacts`
 * has a `location` field already; it would take one line.
 *
 * It would also be a one-way door. `ClipCorrection` in ./clips.ts says why in
 * two clauses, and both are worth spelling out:
 *
 *   · "reset this row" becomes unimplementable. Once the correction is folded
 *     into the facts there is nothing left to reset TO — the original reading is
 *     gone, overwritten by the person who thought they were annotating it. The
 *     undo has to be an edit in the other direction, guessed at, and the reader
 *     has no way to get back a value they never saw.
 *
 *   · The UI can no longer show that a value was changed. A pin a person dropped
 *     and a pin a satellite fixed become byte-identical, which is precisely the
 *     failure ./clips.ts opens by forbidding: MEASURED AND ASSUMED ARE NEVER THE
 *     SAME FIELD. A correction is not measured. It is usually BETTER than
 *     measured — it comes from someone who was standing there — but it is a
 *     different kind of thing, and a route that cannot tell the reader which of
 *     its pins they placed themselves is a route they cannot audit.
 *
 * So corrections live in a `RouteCorrections` that travels beside the facts. The
 * facts stay exactly what the file said, forever. Clearing an edit restores the
 * reading for free, because the reading was never touched.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW THIS COMPOSES WITH deriveRoute
 *
 * This module does NOT re-derive the route. `deriveRoute` owns ordering,
 * interpolation, warnings and the honesty ledger, and a second implementation of
 * any of that would drift from the first within a month. Instead:
 *
 *   1. the time and location overrides are written onto a COPY of the facts;
 *   2. `deriveRoute` runs on the corrected copy, so every leg, inference and
 *      warning is computed once, in one place, by the code that already knows
 *      how — including the consequences a correction has downstream, like an
 *      `implausible-speed` that a moved pin clears or creates;
 *   3. the ordering and omission overrides are applied to the RESULT, because
 *      they are statements about the sequence that `deriveRoute` has no way to
 *      accept as input (it would just sort them away again);
 *   4. every value a person supplied is re-stamped `"corrected"`.
 *
 * Step 4 is the whole point of the layer and the easiest thing to lose. From
 * `deriveRoute`'s side a corrected location is indistinguishable from a read one
 * — it arrives in `facts.location` looking like any other fix, and comes back
 * out marked `"measured"`. Nothing errors. Nothing looks wrong. The route simply
 * stops being able to say which pins the reader placed, which is the one thing
 * this layer exists to preserve.
 *
 * The other thing that goes quietly stale is `assumptions`. It is rendered
 * verbatim under the route as the honesty ledger, so a line that has stopped
 * being true — "3 clips were placed by interpolation" after the reader has
 * pinned two of them — is worse than no line at all: it is the route lying about
 * its own confidence, in the exact place a reader goes to check it. Every
 * assumption a correction can falsify is recomputed or rewritten below.
 *
 * Pure and dependency-free, like ./route.ts and for the same reason: the browser
 * drop path, the server path and a `tsx` verification script must all produce
 * the same route from the same facts and the same edits.
 */
import { duration as durationLabel } from "../format";
import { deriveRoute } from "./route";
import {
  epochOf,
  metresApart,
  IMPLAUSIBLE_MPS,
  LONG_GAP_SEC,
  type ClipCorrection,
  type ClipFacts,
  type ClipSource,
  type DerivedRoute,
  type OrderBasis,
  type RouteCorrections,
  type RoutedClip,
  type RouteWarning,
} from "./clips";
import type { GeoPoint } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Small shared shapes
// ─────────────────────────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<RouteWarning["severity"], number> = {
  blocker: 0,
  warn: 1,
  note: 2,
};

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** A position we stand behind — read off a file, or put there by a person. */
const isFirm = (s: ClipSource) => s === "measured" || s === "corrected";

/**
 * The edits that actually survive, collapsed to one per clip per kind.
 *
 * `order` is a Map rather than a plain record because the ORDER of the surviving
 * order edits is load-bearing: they are splices, and splices do not commute.
 * "move A to 0, then move B to 2" lands somewhere different from the reverse.
 */
interface Effective {
  order: Map<string, number>;
  location: Map<string, GeoPoint>;
  time: Map<string, string>;
  omit: Set<string>;
}

function collapse(c: RouteCorrections): Effective {
  const eff: Effective = {
    order: new Map(),
    location: new Map(),
    time: new Map(),
    omit: new Set(),
  };

  for (const edit of c.edits) {
    switch (edit.kind) {
      case "order":
        // Delete before set so a re-drag moves to the END of the sequence. A
        // Map keeps a key's ORIGINAL insertion slot on re-set, which would
        // compose the newest intent as if it were the oldest.
        eff.order.delete(edit.clipId);
        eff.order.set(edit.clipId, edit.toIndex);
        break;
      case "location":
        eff.location.set(edit.clipId, edit.location);
        break;
      case "time":
        eff.time.set(edit.clipId, edit.recordedAt);
        break;
      case "omit":
        // `omitted: false` is "put it back", not a second kind of edit.
        if (edit.omitted) eff.omit.add(edit.clipId);
        else eff.omit.delete(edit.clipId);
        break;
    }
  }

  return eff;
}

// ─────────────────────────────────────────────────────────────────────────────
// The corrected route
// ─────────────────────────────────────────────────────────────────────────────

export function applyCorrections(
  clips: ClipFacts[],
  corrections: RouteCorrections,
): DerivedRoute {
  const eff = collapse(corrections);
  const present = new Set(clips.map((c) => c.id));

  // ── 1. Overrides onto a copy of the facts ──────────────────────────────────
  // A copy, never the caller's objects: `applyCorrections` is called on every
  // keystroke of a drag, and a layer that edited its input in place would make
  // "clear this correction" restore a value that had already been overwritten.
  const correctedFacts: ClipFacts[] = clips.map((f) => {
    const location = eff.location.get(f.id);
    const recordedAt = eff.time.get(f.id);
    if (!location && recordedAt === undefined) return f;
    return {
      ...f,
      location: location ?? f.location,
      // The offset in the string is preserved as given — a person typing a time
      // means the time on the clock where they were standing. `utcOffsetMin` is
      // deliberately left alone: it is a fact about the FILE, and this copy is
      // discarded below anyway (see step 2).
      recordedAt: recordedAt ?? f.recordedAt,
    };
  });

  // ── 2. One derivation, in the one place that owns it ───────────────────────
  const derived = deriveRoute(correctedFacts);

  // ── 3. Re-stamp the sources, and give the facts back ───────────────────────
  // The facts on the result are the ORIGINALS, not the corrected copies. A
  // `ClipFacts` is documented as what the file said and nothing inferred, so
  // writing a person's correction into one would break the contract at its most
  // load-bearing point. The corrected values live where derived values belong:
  // on `RoutedClip.location` / `.recordedAt`, next to a source that names them.
  // A row therefore holds both readings at once, which is exactly what an editor
  // needs to render "was 43.61, now 43.64" and to offer a reset.
  const originals = new Map(clips.map((c) => [c.id, c]));

  let routed: RoutedClip[] = derived.clips.map((rc) => {
    const id = rc.facts.id;
    return {
      ...rc,
      facts: originals.get(id) ?? rc.facts,
      // Guarded on the value actually surviving the derivation. A location
      // correction always does; a time correction whose string `deriveRoute`
      // could not parse comes back null and `"missing"`, and stamping that
      // `"corrected"` would claim a person supplied a value the route does not
      // have.
      locationSource:
        eff.location.has(id) && rc.location !== null ? "corrected" : rc.locationSource,
      recordedAtSource:
        eff.time.has(id) && rc.recordedAt !== null ? "corrected" : rc.recordedAtSource,
      omitted: eff.omit.has(id),
    };
  });

  // ── 4. Ordering: splice, not swap ──────────────────────────────────────────
  // "Put this clip at position 4" means everything else closes up around it, the
  // way dragging a row in a list behaves. A swap would move a second clip the
  // person never touched, which is the kind of surprise that makes people stop
  // trusting an editor. Applied in the order the edits were made, because each
  // splice is relative to the arrangement the one before it produced.
  const orderEdits = [...eff.order].filter(([id]) => present.has(id));

  for (const [id, toIndex] of orderEdits) {
    const from = routed.findIndex((c) => c.facts.id === id);
    if (from < 0) continue;
    const next = routed.slice();
    const [moved] = next.splice(from, 1);
    // After the removal there are `next.length` gaps to land in, so that is the
    // top of the range — clamped rather than rejected, since a stale index from
    // a list that has since shrunk should still land the clip at the end.
    const to = Math.min(Math.max(Math.trunc(toIndex), 0), next.length);
    next.splice(to, 0, moved);
    routed = next;
  }

  routed.forEach((c, i) => {
    // Index over the WHOLE list, omitted rows included. An omitted clip is still
    // a row on the screen — that is how it gets put back — so its index is its
    // row number. Numbering only the live clips would leave omitted rows sharing
    // an index with a live one or holding -1, and both are worse to render than
    // a row that is simply struck through at position 4.
    c.index = i;
  });

  // ── 5. Legs, bridged across omissions ──────────────────────────────────────
  const omitCount = routed.filter((c) => c.omitted).length;
  const orderChanged = orderEdits.length > 0;
  const anyOmitted = omitCount > 0;
  const sequenceChanged = orderChanged || anyOmitted;

  const live = routed.filter((c) => !c.omitted);

  // Only the sequence edits invalidate the legs. A corrected location or time
  // was already visible to `deriveRoute` in step 2, so its legs are correct and
  // recomputing them here would be a chance to disagree with it for nothing.
  const totalMetres = sequenceChanged ? relinkLegs(routed) : derived.totalMetres;
  const skippedLegs = sequenceChanged ? countSkippedLegs(live) : null;

  // ── 6. The summary, over the clips that are still in the journey ───────────
  const located = live.filter((c) => c.location !== null && isFirm(c.locationSource)).length;
  const timed = live.filter((c) => isFirm(c.recordedAtSource)).length;
  const inferred = live.filter((c) => c.locationSource === "inferred").length;
  const unplaceable = live.filter((c) => c.locationSource === "missing").length;

  const origin = live.find((c) => c.location !== null)?.location ?? null;

  // Min-to-max, matching `deriveRoute`: a hand-set order is allowed to run
  // against the clock, and a journey that lasted minus four minutes helps
  // nobody.
  const epochs = live
    .map((c) => epochOf(c.recordedAt))
    .filter((v): v is number => v !== null);
  const totalSeconds =
    epochs.length >= 2 ? (Math.max(...epochs) - Math.min(...epochs)) / 1000 : null;

  return {
    clips: routed,
    // A person has said what the order is. Nothing the files implied outranks
    // that, and no amount of further guessing is going to improve on it.
    orderedBy: orderChanged ? "corrected" : derived.orderedBy,
    totalMetres,
    totalSeconds,
    origin,
    located,
    timed,
    warnings: rebuildWarnings(derived.warnings, {
      live,
      omittedIds: new Set(routed.filter((c) => c.omitted).map((c) => c.facts.id)),
      orderChanged,
      anyOmitted,
      sequenceChanged,
      located,
      timed,
      inferred,
      unplaceable,
    }),
    assumptions: rebuildAssumptions(derived.assumptions, {
      basis: derived.orderedBy,
      routed,
      live,
      movedIds: new Set(orderEdits.map(([id]) => id)),
      orderChanged,
      anyOmitted,
      sequenceChanged,
      omitCount,
      locationEdits: countApplied(eff.location.keys(), present),
      timeEdits: countApplied(eff.time.keys(), present),
      located,
      timed,
      inferred,
      unplaceable,
      skippedLegs,
    }),
  };
}

function countApplied(ids: Iterable<string>, present: Set<string>): number {
  let n = 0;
  for (const id of ids) if (present.has(id)) n++;
  return n;
}

/**
 * Recompute every leg over the corrected sequence, stepping over omitted clips.
 *
 * THE BRIDGE. `prev` advances only past clips that are still in the journey, so
 * when clip 3 is left out, clip 4's leg is measured from clip 2 — the distance
 * between the two clips that are actually adjacent now, not the sum of two legs
 * through a clip nobody wants counted, and not a hole. An omitted clip carries
 * no leg of its own at all: its metres and seconds belong to a journey it is no
 * longer part of, and leaving stale numbers on it would put them back into any
 * total computed by summing the rows.
 *
 * Mutates the clips it is given, which are this module's own copies, never the
 * caller's.
 */
function relinkLegs(clips: RoutedClip[]): number {
  let totalMetres = 0;
  let prev: RoutedClip | null = null;

  for (const c of clips) {
    c.legMetres = null;
    c.legSeconds = null;
    c.legSpeedMps = null;

    if (c.omitted) continue;

    if (prev) {
      if (prev.location && c.location) {
        c.legMetres = metresApart(prev.location, c.location);
      }
      const ea = epochOf(prev.recordedAt);
      const eb = epochOf(c.recordedAt);
      // Start to start, as in ./route.ts: the fix on a clip is taken where the
      // camera was when recording began, so the span between two starts is the
      // interval that distance was covered in.
      if (ea !== null && eb !== null) c.legSeconds = (eb - ea) / 1000;

      if (c.legMetres !== null && c.legSeconds !== null && c.legSeconds > 0) {
        c.legSpeedMps = c.legMetres / c.legSeconds;
      }

      // Same rule as `deriveRoute`: a leg counts only when both ends were
      // actually placed by someone or something that was there. An interpolated
      // endpoint contributes a length we drew rather than one anyone walked.
      if (c.legMetres !== null && isFirm(prev.locationSource) && isFirm(c.locationSource)) {
        totalMetres += c.legMetres;
      }
    }

    prev = c;
  }

  return totalMetres;
}

/** How many legs the total had to skip, for the ledger line about it. */
/**
 * Which rule placed the interpolated clips that are still in the journey.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS COUNTED PER CLIP AND NOT READ OFF THE ROUTE
 *
 * This clause used to be chosen by `timed > 0` — a question about the WHOLE
 * route — to describe a fact about ONE clip. Those come apart in the ordinary
 * mixed case: clips a and c are timed and located, clip b between them is
 * neither, so the route is "timed" while b was in fact spaced evenly, because b
 * has no clock of its own. The ledger then told the reader that b's position was
 * "weighted by how much time had passed" when nothing weighted it.
 *
 * `assumptions` is documented as the product rather than debug output, so a
 * sentence the reader could catch being wrong costs more than the two counts it
 * takes to be right. Mirrors the same split in ./route.ts, applied here to the
 * clips that survive an omission.
 */
function placementClause(live: RoutedClip[]): string {
  // Time-weighting needs a clock on the clip AND on the located clips bracketing
  // it — the same three-way test route.ts applies at placement time.
  const locatedTimes = live.map((c) =>
    c.locationSource === "measured" || c.locationSource === "corrected"
      ? epochOf(c.recordedAt)
      : undefined,
  );

  let weighted = 0;
  let even = 0;

  live.forEach((clip, i) => {
    if (clip.locationSource !== "inferred") return;

    let before: number | null | undefined;
    for (let j = i - 1; j >= 0; j--) {
      if (locatedTimes[j] !== undefined) {
        before = locatedTimes[j];
        break;
      }
    }
    let after: number | null | undefined;
    for (let j = i + 1; j < live.length; j++) {
      if (locatedTimes[j] !== undefined) {
        after = locatedTimes[j];
        break;
      }
    }

    const own = epochOf(clip.recordedAt);
    if (own !== null && before != null && after != null && after > before) weighted++;
    else even++;
  });

  if (weighted > 0 && even > 0) {
    return `, ${weighted} of them weighted by how much time had passed and ${even} spaced evenly because ${even === 1 ? "it carried" : "they carried"} no clock`;
  }
  return weighted > 0
    ? ", weighted by how much time had passed"
    : ", spaced evenly between them";
}

function countSkippedLegs(live: RoutedClip[]): number {
  let skipped = 0;
  for (let i = 1; i < live.length; i++) {
    const prev = live[i - 1];
    const cur = live[i];
    if (!(cur.legMetres !== null && isFirm(prev.locationSource) && isFirm(cur.locationSource))) {
      skipped++;
    }
  }
  return skipped;
}

// ─────────────────────────────────────────────────────────────────────────────
// Keeping the warnings about the journey that now exists
// ─────────────────────────────────────────────────────────────────────────────

interface WarningCtx {
  live: RoutedClip[];
  omittedIds: Set<string>;
  orderChanged: boolean;
  anyOmitted: boolean;
  sequenceChanged: boolean;
  located: number;
  timed: number;
  inferred: number;
  unplaceable: number;
}

function rebuildWarnings(from: RouteWarning[], ctx: WarningCtx): RouteWarning[] {
  if (!ctx.sequenceChanged) return from.slice();

  const kept = from.filter((w) => {
    // Both of these read off adjacency, and adjacency is what just changed.
    if (w.code === "implausible-speed" || w.code === "long-gap") return false;

    // A person has said what the order is, so there is no longer a guess to
    // caveat. Dropping this is not hiding a problem — it is the problem being
    // solved, by the only source of truth there was.
    if (ctx.orderChanged && w.code === "order-guessed") return false;

    if (ctx.anyOmitted) {
      // Counted over the whole pile; recomputed below over what is left.
      if (
        w.code === "no-locations" ||
        w.code === "partial-locations" ||
        w.code === "no-timestamps" ||
        w.code === "single-clip"
      ) {
        return false;
      }
      // A complaint about clips that are all out of the journey is noise about
      // footage the reader has already dealt with.
      if (w.clipIds.length > 0 && w.clipIds.every((id) => ctx.omittedIds.has(id))) {
        return false;
      }
    }

    return true;
  });

  const n = ctx.live.length;

  if (ctx.anyOmitted && n > 0) {
    if (n === 1) {
      kept.push({
        code: "single-clip",
        clipIds: [ctx.live[0].facts.id],
        message: "one clip is not a journey yet, so there is nothing to order or measure between",
        severity: "note",
      });
    }
    if (ctx.timed === 0) {
      kept.push({
        code: "no-timestamps",
        clipIds: [],
        message: "no clip says when it was filmed, so nothing here knows how long the journey took",
        severity: "warn",
      });
    }
    if (ctx.located === 0) {
      kept.push({
        code: "no-locations",
        clipIds: [],
        message: "no clip carries a location, so this is an order without a map",
        severity: "blocker",
      });
    } else if (ctx.located < n) {
      kept.push({
        code: "partial-locations",
        clipIds: ctx.live.filter((c) => !isFirm(c.locationSource)).map((c) => c.facts.id),
        message: `${ctx.located} of ${n} clips carry a location — ${plural(ctx.inferred, "position")} interpolated between fixes and ${plural(ctx.unplaceable, "clip")} could not be placed at all`,
        severity: "warn",
      });
    }
  }

  // Regenerated from the legs as they now stand. A corrected pin or a reorder
  // routinely CLEARS an implausible speed — that is the mechanism working — and
  // just as routinely creates one somewhere new, which the reader needs to see.
  for (let i = 1; i < n; i++) {
    const prev = ctx.live[i - 1];
    const cur = ctx.live[i];
    const ids = [prev.facts.id, cur.facts.id];

    if (cur.legSpeedMps !== null && cur.legSpeedMps > IMPLAUSIBLE_MPS) {
      kept.push({
        code: "implausible-speed",
        clipIds: ids,
        message: `${prev.facts.name} to ${cur.facts.name} implies ${Math.round(cur.legSpeedMps)} m/s, so either the order is wrong or one of those fixes is`,
        severity: "warn",
      });
    }

    if (cur.legSeconds !== null && cur.legSeconds > LONG_GAP_SEC) {
      kept.push({
        code: "long-gap",
        clipIds: ids,
        message: `${durationLabel(cur.legSeconds)} passed between ${prev.facts.name} and ${cur.facts.name}, so the journey has a break in it`,
        severity: "note",
      });
    }
  }

  kept.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return kept;
}

// ─────────────────────────────────────────────────────────────────────────────
// Keeping the ledger true
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Openers of the assumption `deriveRoute` writes for each weak ordering basis,
 * and the clause that describes that basis mid-sentence.
 *
 * Matching on prose is coupling, and it is worth being honest about that: these
 * strings live in ./route.ts and this module recognises them by their first few
 * words. The coupling is narrow on purpose — a line is only ever looked for when
 * `orderedBy` says `deriveRoute` emitted exactly that one — and the alternative
 * is worse. A structured ledger would mean an assumption type, a renderer and a
 * second place for the wording to drift; leaving the lines alone would mean the
 * page telling a reader who has just fixed the order that nothing in the files
 * said what order they go in.
 */
const ORDER_LINE: Partial<Record<OrderBasis, { opener: string; clause: string }>> = {
  "file-modified": {
    opener: "No clip carried a capture time, so the order comes from each file's last-modified date",
    clause: "their file dates implied, which copying clips off a phone rewrites",
  },
  filename: {
    opener: "No clip carried a capture time or a usable file date",
    clause: "the numbers in their filenames implied, which is a camera's counter rather than a clock",
  },
  "as-given": {
    opener: "Nothing in these files said what order they go in",
    clause: "they were handed to us in, which nothing in the files confirms",
  },
};

const SLOTTING_MARK = "had no capture time. The timed clips are sorted by their timestamps";
const INFERRED_MARK = "placed on the straight line between the nearest located clips";
const UNPLACEABLE_MARK = "had no located clip both before and after";
const SKIPPED_MARK = "The total distance skips";

/**
 * Replace the first line matching `match` with `replacement`, drop it when the
 * replacement is null, and append when there was nothing to replace.
 *
 * Replacing in place rather than dropping-and-appending keeps the ledger in the
 * order the leaps were taken, which is what it claims to be.
 */
function amend(
  lines: string[],
  match: (line: string) => boolean,
  replacement: string | null,
): string[] {
  const out: string[] = [];
  let done = false;
  for (const line of lines) {
    if (!done && match(line)) {
      done = true;
      if (replacement !== null) out.push(replacement);
      continue;
    }
    out.push(line);
  }
  if (!done && replacement !== null) out.push(replacement);
  return out;
}

interface AssumptionCtx {
  basis: OrderBasis;
  routed: RoutedClip[];
  live: RoutedClip[];
  movedIds: Set<string>;
  orderChanged: boolean;
  anyOmitted: boolean;
  sequenceChanged: boolean;
  omitCount: number;
  locationEdits: number;
  timeEdits: number;
  located: number;
  timed: number;
  inferred: number;
  unplaceable: number;
  skippedLegs: number | null;
}

function rebuildAssumptions(from: string[], ctx: AssumptionCtx): string[] {
  let lines = from.slice();

  // ── The order line ─────────────────────────────────────────────────────────
  if (ctx.orderChanged) {
    const moved = ctx.movedIds.size;
    const weak = ORDER_LINE[ctx.basis];
    let line = `You put ${plural(moved, "clip")} where ${moved === 1 ? "it" : "they"} ${moved === 1 ? "belongs" : "belong"} by hand, so the order below is the one you gave rather than the one the files implied.`;
    if (weak) line += ` The clips you did not move are still in the order ${weak.clause}.`;

    if (weak) lines = amend(lines, (l) => l.startsWith(weak.opener), line);
    else lines = [line, ...lines];
  }

  // ── Where the untimed clips ended up ───────────────────────────────────────
  // `deriveRoute` writes this only under `recorded-at`, and it says two things:
  // how many clips had no clock, and that each was left where it was handed to
  // us. Omitting a clip changes the first; moving one falsifies the second for
  // that clip. Recount over the clips it still describes.
  if (ctx.sequenceChanged && ctx.basis === "recorded-at") {
    const stillSlotted = ctx.live.filter(
      (c) => c.recordedAtSource === "missing" && !ctx.movedIds.has(c.facts.id),
    ).length;
    lines = amend(
      lines,
      (l) => l.includes(SLOTTING_MARK),
      stillSlotted === 0
        ? null
        : `${plural(stillSlotted, "clip")} had no capture time. The timed clips are sorted by their timestamps, and each of those untimed clips was left directly after the timed clip it followed in the order you gave us.`,
    );
  }

  // ── The positional ledger ──────────────────────────────────────────────────
  // Interpolation and unplaceability are computed by `deriveRoute` over the
  // whole pile, including clips that are now out of the journey. The counts a
  // reader sees have to be about the route in front of them. (Corrected pins
  // need no work here: they went in as facts in step 1, so `deriveRoute` already
  // counted a clip the reader placed as located rather than interpolated.)
  if (ctx.anyOmitted) {
    lines = amend(
      lines,
      (l) => l.includes(INFERRED_MARK),
      ctx.inferred === 0
        ? null
        : `${plural(ctx.inferred, "clip")} had no location of ${ctx.inferred === 1 ? "its" : "their"} own and ${ctx.inferred === 1 ? "was" : "were"} placed on the straight line between the nearest located clips on either side${placementClause(ctx.live)}. Those are drawn positions, not fixes — drag them if you remember better.`,
    );
    lines = amend(
      lines,
      (l) => l.includes(UNPLACEABLE_MARK),
      ctx.unplaceable === 0
        ? null
        : `${plural(ctx.unplaceable, "clip")} had no located clip both before and after ${ctx.unplaceable === 1 ? "it" : "them"}, so ${ctx.unplaceable === 1 ? "it is" : "they are"} left unplaced. We do not guess past the ends of the located stretch: a clip beyond the last fix could be a step away or a city away, and the route cannot tell which.`,
    );
  }

  // ── What the total had to skip ─────────────────────────────────────────────
  if (ctx.skippedLegs !== null) {
    lines = amend(
      lines,
      (l) => l.startsWith(SKIPPED_MARK),
      ctx.skippedLegs > 0 && ctx.located > 0
        ? `The total distance skips ${plural(ctx.skippedLegs, "leg")} where one or both ends were not actually measured, so it is a floor rather than the length of the walk.`
        : null,
    );
  }

  // ── What the reader changed ────────────────────────────────────────────────
  // Appended last: these are the most recent leaps, and the ledger runs in the
  // order the leaps were taken. They are also the only lines in it that are not
  // an apology — a corrected value is the strongest thing on the page.
  if (ctx.locationEdits > 0) {
    const k = ctx.locationEdits;
    lines.push(
      `You placed ${plural(k, "clip")} yourself. ${k === 1 ? "That position is" : "Those positions are"} marked as corrected rather than measured, and the legs either side of ${k === 1 ? "it" : "them"} are measured from where you put ${k === 1 ? "it" : "them"} — which is why a distance may have changed.`,
    );
  }
  if (ctx.timeEdits > 0) {
    const k = ctx.timeEdits;
    lines.push(
      `You set the time on ${plural(k, "clip")} yourself, keeping the offset you gave. ${k === 1 ? "It counts" : "They count"} as corrected rather than measured, and ${k === 1 ? "it feeds" : "they feed"} the ordering and the durations like any other timestamp.`,
    );
  }
  if (ctx.omitCount > 0) {
    const k = ctx.omitCount;
    const all = ctx.live.length === 0;
    lines.push(
      all
        ? `Every clip is left out, so there is no journey left to measure. They are all still listed, so you can put any of them back.`
        : `${plural(k, "clip")} ${k === 1 ? "is" : "are"} left out of the journey. ${k === 1 ? "It is" : "They are"} still listed so you can put ${k === 1 ? "it" : "them"} back, but ${k === 1 ? "it adds" : "they add"} nothing to the distance or the duration, and the clips either side measure straight across the gap ${k === 1 ? "it" : "they"} left.`,
    );
  }

  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// Editing the set of corrections
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Add an edit, replacing any earlier edit of the same kind on the same clip.
 *
 * Collapsing rather than appending, because a person dragging a pin generates
 * one of these per animation frame. An append-only log would grow without bound
 * during an interaction that has a single outcome, and every consumer — undo,
 * serialisation, the "3 changes" badge — would have to de-duplicate it again to
 * get back the number of things the reader believes they changed.
 *
 * The replacement goes to the END, not into the slot the old one held: the newest
 * intent is the newest intent, and for `order` edits, which compose as splices,
 * where it sits in the sequence changes where the clip lands.
 */
export function addCorrection(
  c: RouteCorrections,
  edit: ClipCorrection,
): RouteCorrections {
  return {
    edits: [
      ...c.edits.filter((e) => !(e.clipId === edit.clipId && e.kind === edit.kind)),
      edit,
    ],
  };
}

/** Reset a row: forget everything a person said about one clip. */
export function clearFor(c: RouteCorrections, clipId: string): RouteCorrections {
  return { edits: c.edits.filter((e) => e.clipId !== clipId) };
}

/** Everything said about one clip, in the order it was said. */
export function correctionsFor(
  c: RouteCorrections,
  clipId: string,
): ClipCorrection[] {
  return c.edits.filter((e) => e.clipId === clipId);
}

/**
 * One correction, in the words a reader would use about it — for the undo
 * affordance and the list of changes.
 *
 * Positions are 1-BASED here and 0-based everywhere else in this file. That is
 * deliberate: `toIndex` is an array index and this string is a sentence for a
 * person, and no list a person has ever read starts at zero.
 */
export function describeCorrection(edit: ClipCorrection): string {
  switch (edit.kind) {
    case "order":
      return `moved to position ${edit.toIndex + 1}`;
    case "location":
      // Four decimals is about 11 m, which is finer than the pin and far coarser
      // than the float — printing the whole double would be noise dressed as
      // precision.
      return `placed at ${edit.location.lat.toFixed(4)}, ${edit.location.lng.toFixed(4)}`;
    case "time":
      return `time set to ${clockOf(edit.recordedAt)}`;
    case "omit":
      return edit.omitted ? "left out" : "put back";
  }
}

/**
 * The HH:mm a person would have read off the clock, taken out of the string.
 *
 * Read with a regex rather than a `Date`, because `Date` renders in the running
 * machine's zone: a clip stamped 14:20+01:00 would describe itself as "13:20" on
 * a server in UTC and "09:20" on a laptop in Toronto, all for a correction whose
 * entire content is that it was 14:20 where the reader was standing.
 */
function clockOf(iso: string): string {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1]}:${m[2]}` : iso;
}

// ─────────────────────────────────────────────────────────────────────────────
// Corrections off the wire
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate corrections from somewhere untrusted — a saved draft, a URL, another
 * tab, an older version of this app that spelled a field differently.
 *
 * DROP, never repair. Every other layer here is built to preserve the difference
 * between a value someone stood behind and a value we made up, and a clamp would
 * manufacture exactly the second kind while wearing the badge of the first: a
 * `lat: 991` rounded to 90 is a pin at the north pole that claims a person put
 * it there. A dropped edit leaves the clip showing what its file said, which is
 * a state the reader can see and fix.
 *
 * Never fatal, and never all-or-nothing: one malformed edit does not cost the
 * reader the other nine they made in the same session.
 */
export function parseCorrections(raw: unknown): RouteCorrections {
  const list = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.edits)
      ? raw.edits
      : null;

  if (!list) return { edits: [] };

  const edits: ClipCorrection[] = [];
  for (const item of list) {
    const edit = parseEdit(item);
    if (edit) edits.push(edit);
  }
  return { edits };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseEdit(raw: unknown): ClipCorrection | null {
  if (!isRecord(raw)) return null;

  const clipId = raw.clipId;
  if (typeof clipId !== "string" || clipId.length === 0) return null;

  switch (raw.kind) {
    case "order": {
      const toIndex = raw.toIndex;
      // Integers only. `2.5` is not a position, and `Math.round`ing it would be
      // this module deciding which of two rows a person meant. Clamping into the
      // list's range happens at apply time, where the length is known; a
      // negative or oversized integer is a legible instruction, unlike a
      // fraction.
      if (typeof toIndex !== "number" || !Number.isInteger(toIndex)) return null;
      return { kind: "order", clipId, toIndex };
    }

    case "location": {
      const loc = raw.location;
      if (!isRecord(loc)) return null;
      const { lat, lng } = loc;
      if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) {
        return null;
      }
      if (typeof lng !== "number" || !Number.isFinite(lng) || lng < -180 || lng > 180) {
        return null;
      }
      const label = typeof raw.label === "string" ? raw.label : undefined;
      // Rebuilt field by field rather than passed through, so nothing else on
      // the wire's object rides along into the route.
      return label === undefined
        ? { kind: "location", clipId, location: { lat, lng } }
        : { kind: "location", clipId, location: { lat, lng }, label };
    }

    case "time": {
      const recordedAt = raw.recordedAt;
      // Parseable or nothing: an unreadable timestamp accepted here would travel
      // as a correction, be marked "corrected", and describe a time nobody can
      // read. ./clips.ts's `epochOf` is the same parse the route will do.
      if (typeof recordedAt !== "string" || epochOf(recordedAt) === null) return null;
      return { kind: "time", clipId, recordedAt };
    }

    case "omit": {
      // Booleans only — no truthiness. `"false"` is a string that means false to
      // a person and true to JavaScript, and this is the one edit that can make
      // footage disappear from a journey.
      if (typeof raw.omitted !== "boolean") return null;
      return { kind: "omit", clipId, omitted: raw.omitted };
    }

    default:
      // An unknown kind is a newer client, a typo, or something hostile. All
      // three are handled the same way: it is not an instruction we understand,
      // so it is not one we act on.
      return null;
  }
}
