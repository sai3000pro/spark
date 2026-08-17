/**
 * The first draft of a journey, derived from what the files actually said.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS REFUSES TO INVENT
 *
 * lib/uploadedTrips.ts is blunt about the hole this module fills: a walk built
 * from an uploaded video has NO position, so its moments get laid along a
 * straight synthetic transect and `synthetic: true` says so. The clips
 * themselves know more than that — a phone stamps the time and often the fix
 * onto every file — and this is where that knowledge is finally read out.
 *
 * But only what is there. This module will:
 *
 *   · order clips by real capture times when they exist, and say plainly which
 *     weaker signal it fell back to when they do not;
 *   · place a clip between two located clips by interpolation, marked
 *     `inferred`, never `measured`;
 *   · leave a position `null` / `"missing"` rather than guess it from one side.
 *
 * It will NOT extrapolate past the ends of the located range, will not
 * substitute mtime for capture time, will not treat an unknown distance as
 * zero, and will not fold a guess into a total. Every leap it does take is
 * written into `assumptions` in a sentence the person who was there can read
 * and disagree with — that array is the product, not debug output.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A WRONG-BUT-CORRECTABLE DRAFT BEATS A CONFIDENT ANSWER
 *
 * On a real pile of clips this route will be wrong about at least one of them.
 * That is fine and expected — see the contract in ./clips.ts. What is not fine
 * is being wrong INVISIBLY: a pin dropped near the first fix because a clip had
 * none looks exactly like a pin from a satellite, and the reader has no reason
 * to touch it. A hole in the route is legible; a wrong pin is not. So the whole
 * design leans one way: when in doubt, say nothing, loudly.
 *
 * Pure and dependency-free on purpose — no I/O, no `next/*`, no DOM, no
 * `server-only`. The same function has to run in the browser drop path, on the
 * server after a probe, and under `tsx` in a verification script, and produce
 * the same route from the same facts, or the two paths disagree about the same
 * footage and nobody can say which is right.
 */
import { duration as durationLabel } from "../format";
import {
  epochOf,
  metresApart,
  IMPLAUSIBLE_MPS,
  LONG_GAP_SEC,
  type ClipFacts,
  type DerivedRoute,
  type OrderBasis,
  type RoutedClip,
  type RouteWarning,
} from "./clips";
import type { GeoPoint } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

/** One clip plus the two numbers everything downstream keys off. */
interface Entry {
  facts: ClipFacts;
  /** Position in the array we were handed. The tie-breaker of every sort. */
  input: number;
  /** Epoch ms, or null when absent OR unparseable — the two are equally unknown. */
  epoch: number | null;
  /** Epoch ms of the filesystem mtime. Ordering only; never becomes a capture time. */
  mtime: number | null;
}

const SEVERITY_RANK: Record<RouteWarning["severity"], number> = {
  blocker: 0,
  warn: 1,
  note: 2,
};

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** "a", "a and b", "a, b and c", "a, b and 4 others" — for naming clips in a message. */
function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${plural(names.length - 2, "other")}`;
}

/**
 * Natural filename order: `IMG_2.mov` before `IMG_10.mov`.
 *
 * Lexical order puts `IMG_10` first, which reverses the middle of every camera
 * roll and is exactly the kind of quietly-wrong ordering this module exists to
 * avoid. Digit runs compare numerically, everything else lexically, so the
 * usual `PREFIX_0041.MOV` convention sorts the way the camera meant it to.
 */
function compareNatural(a: string, b: string): number {
  const chunks = (s: string) => s.toLowerCase().match(/\d+|\D+/g) ?? [];
  const ac = chunks(a);
  const bc = chunks(b);
  const shared = Math.min(ac.length, bc.length);
  for (let i = 0; i < shared; i++) {
    const x = ac[i];
    const y = bc[i];
    const xNum = x.charCodeAt(0) >= 48 && x.charCodeAt(0) <= 57;
    const yNum = y.charCodeAt(0) >= 48 && y.charCodeAt(0) <= 57;
    if (xNum && yNum) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d;
      // Equal value, different spelling ("01" vs "1"). Length keeps it stable.
      if (x.length !== y.length) return x.length - y.length;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return ac.length - bc.length;
}

/**
 * Are the filenames actually a numbering convention, or just words?
 *
 * Sorting `beach.mov` before `castle.mov` alphabetically is not evidence of
 * anything — it would dress the alphabet up as a chronology. We only claim
 * `filename` as a basis when every name carries digits and they are not all
 * the same, which is what a camera roll looks like and what an arbitrary pile
 * of named files does not.
 */
function filenamesLookNumbered(entries: Entry[]): boolean {
  if (entries.length < 2) return false;
  if (!entries.every((e) => /\d/.test(e.facts.name))) return false;
  return new Set(entries.map((e) => e.facts.name)).size >= 2;
}

/**
 * Choose an order, and say what it rests on.
 *
 * Priority is capture time → mtime → filename → as-given, weakest last. The one
 * non-obvious rule is the MIX: capture times win as long as at least half the
 * clips carry one, because a real timestamp on half the pile anchors the whole
 * order better than a signal that is uniformly untrustworthy. Below half, a
 * complete set of mtimes at least orders every clip on the same basis, so it
 * wins — and if there is no complete mtime set either, the handful of real
 * times comes back as a last resort, since a few facts beat none.
 */
function orderEntries(entries: Entry[]): { ordered: Entry[]; basis: OrderBasis } {
  const n = entries.length;
  if (n === 0) return { ordered: [], basis: "as-given" };

  const timed = entries.filter((e) => e.epoch !== null).length;
  const mtimed = entries.filter((e) => e.mtime !== null).length;

  const byTime = () => ({ ordered: slotUntimed(entries), basis: "recorded-at" as const });

  if (timed > 0 && timed * 2 >= n) return byTime();
  if (mtimed === n) {
    const ordered = [...entries].sort(
      (a, b) => (a.mtime as number) - (b.mtime as number) || a.input - b.input,
    );
    return { ordered, basis: "file-modified" };
  }
  if (filenamesLookNumbered(entries)) {
    const ordered = [...entries].sort(
      (a, b) => compareNatural(a.facts.name, b.facts.name) || a.input - b.input,
    );
    return { ordered, basis: "filename" };
  }
  if (timed > 0) return byTime();
  return { ordered: [...entries], basis: "as-given" };
}

/**
 * Sort the timed clips by time; leave each untimed clip attached to the timed
 * clip it followed in the input order.
 *
 * The alternative — dropping every untimed clip at the end, or interleaving
 * them by filename — throws away the one thing the input order genuinely is:
 * the sequence a person handed us, which for a folder drop is usually the
 * sequence they were filmed in. Anchoring instead of re-sorting means a clip
 * whose metadata was stripped by a messaging app stays next to its neighbours
 * rather than teleporting to the bottom of the list, and an untimed clip before
 * the first timed one stays at the front rather than being invented a place.
 */
function slotUntimed(entries: Entry[]): Entry[] {
  const head: Entry[] = [];
  const timed: Entry[] = [];
  const trailing = new Map<number, Entry[]>();
  let anchor: number | null = null;

  for (const e of entries) {
    if (e.epoch !== null) {
      timed.push(e);
      anchor = e.input;
      trailing.set(e.input, []);
    } else if (anchor === null) {
      head.push(e);
    } else {
      trailing.get(anchor)?.push(e);
    }
  }

  timed.sort((a, b) => (a.epoch as number) - (b.epoch as number) || a.input - b.input);

  const ordered = [...head];
  for (const t of timed) {
    ordered.push(t, ...(trailing.get(t.input) ?? []));
  }
  return ordered;
}

/** Linear blend of two fixes. Degrees, which is honest at journey scale. */
function between(a: GeoPoint, b: GeoPoint, t: number): GeoPoint {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ─────────────────────────────────────────────────────────────────────────────
// The route
// ─────────────────────────────────────────────────────────────────────────────

export function deriveRoute(clips: ClipFacts[]): DerivedRoute {
  // An empty selection is not a degenerate route, it is no route. Warning about
  // its missing timestamps would be shouting at an empty room.
  if (clips.length === 0) {
    return {
      clips: [],
      orderedBy: "as-given",
      totalMetres: 0,
      totalSeconds: null,
      origin: null,
      located: 0,
      timed: 0,
      warnings: [],
      assumptions: [],
    };
  }

  const entries: Entry[] = clips.map((facts, input) => ({
    facts,
    input,
    epoch: epochOf(facts.recordedAt),
    mtime: epochOf(facts.fileModifiedAt),
  }));

  const n = entries.length;
  const { ordered, basis } = orderEntries(entries);

  const warnings: RouteWarning[] = [];
  const assumptions: string[] = [];

  const timedCount = entries.filter((e) => e.epoch !== null).length;
  const locatedCount = entries.filter((e) => e.facts.location !== null).length;
  /** A timestamp was written down and we could not read it — not the same as absent. */
  const unreadable = entries.filter((e) => e.facts.recordedAt !== null && e.epoch === null);

  // ── Order ──────────────────────────────────────────────────────────────────
  // One clip has no order to guess, so it never gets an order warning; the
  // `single-clip` note below already says everything there is to say.
  const untimedIds = ordered.filter((e) => e.epoch === null).map((e) => e.facts.id);

  if (n > 1) {
    if (basis === "recorded-at" && untimedIds.length > 0) {
      warnings.push({
        code: "order-guessed",
        clipIds: untimedIds,
        message: `${plural(untimedIds.length, "clip")} carry no capture time and were left where they were handed to us`,
        severity: "warn",
      });
    } else if (basis === "file-modified") {
      warnings.push({
        code: "order-guessed",
        clipIds: [],
        message:
          "ordered by file modification time, which copying clips off a phone rewrites, so this order is plausible rather than known",
        severity: "warn",
      });
    } else if (basis === "filename") {
      warnings.push({
        code: "order-guessed",
        clipIds: [],
        message:
          "ordered by the numbers in the filenames, which is a camera's convention rather than a record of when anything was filmed",
        severity: "warn",
      });
    } else if (basis === "as-given") {
      warnings.push({
        code: "order-guessed",
        clipIds: [],
        message: "nothing in these files says what order they go in, so this is the order they arrived in",
        severity: "blocker",
      });
    }
  }

  if (basis === "file-modified") {
    assumptions.push(
      "No clip carried a capture time, so the order comes from each file's last-modified date. Copying clips off a phone rewrites that date, so this ordering is plausible rather than known — check it before trusting the route.",
    );
  } else if (basis === "filename") {
    assumptions.push(
      "No clip carried a capture time or a usable file date, so the order comes from the numbers in the filenames, read as numbers rather than as text (IMG_2 before IMG_10). That is a camera's counter, not a clock.",
    );
  } else if (basis === "as-given" && n > 1) {
    assumptions.push(
      "Nothing in these files said what order they go in, so they are in the order they were handed to us. Every distance and duration below inherits that guess.",
    );
  }

  if (basis === "recorded-at" && untimedIds.length > 0) {
    assumptions.push(
      `${plural(untimedIds.length, "clip")} had no capture time. The timed clips are sorted by their timestamps, and each untimed clip was left directly after the timed clip it followed in the order you gave us.`,
    );
  }

  if (unreadable.length > 0) {
    assumptions.push(
      `${plural(unreadable.length, "clip")} carried a capture time we could not read (${nameList(unreadable.slice(0, 3).map((e) => e.facts.name))}) and ${unreadable.length === 1 ? "was" : "were"} treated as untimed rather than guessed at.`,
    );
  }

  // ── Positions ──────────────────────────────────────────────────────────────
  // Nearest located clip on each side, precomputed. A clip with a located clip
  // on BOTH sides can be interpolated; anything else is a hole.
  const prevLocated: (number | null)[] = new Array(n).fill(null);
  const nextLocated: (number | null)[] = new Array(n).fill(null);
  {
    let seen: number | null = null;
    for (let i = 0; i < n; i++) {
      prevLocated[i] = seen;
      if (ordered[i].facts.location !== null) seen = i;
    }
    seen = null;
    for (let i = n - 1; i >= 0; i--) {
      nextLocated[i] = seen;
      if (ordered[i].facts.location !== null) seen = i;
    }
  }

  const positions: (GeoPoint | null)[] = new Array(n).fill(null);
  const sources: RoutedClip["locationSource"][] = new Array(n).fill("missing");
  let inferredCount = 0;
  /** Split so the ledger can say which rule placed them. See the loop below. */
  let inferredWeighted = 0;
  let inferredEven = 0;
  let unplaceableCount = 0;

  for (let i = 0; i < n; i++) {
    const fix = ordered[i].facts.location;
    if (fix) {
      positions[i] = fix;
      sources[i] = "measured";
      continue;
    }

    const p = prevLocated[i];
    const q = nextLocated[i];

    // NO EXTRAPOLATION, EVER. A clip before the first fix or after the last one
    // could be a step away or a city away, and the shape of the route says
    // nothing about which — a journey does not have to continue in the
    // direction it was last seen going. Placing it "probably near the first
    // one" would draw a pin that is indistinguishable from a measured one and
    // wrong by an unbounded amount. A hole is recoverable; a wrong pin is a
    // lie the reader has no reason to question.
    if (p === null || q === null) {
      unplaceableCount++;
      continue;
    }

    const a = ordered[p].facts.location as GeoPoint;
    const b = ordered[q].facts.location as GeoPoint;
    const ea = ordered[p].epoch;
    const eb = ordered[q].epoch;
    const ei = ordered[i].epoch;

    // Weight by elapsed time when all three clocks are known — someone who
    // filmed at 2:00 and 2:50 and has an untimed clip at 2:40 was much nearer
    // the second fix than the middle. Clamped, because the timestamps are
    // allowed to disagree with the chosen order and a t outside [0,1] would
    // become the extrapolation we just refused. With no clocks, fall back to
    // even spacing across the gap: it claims nothing except "in between".
    //
    // Which of the two ran is recorded PER CLIP, not derived afterwards from
    // whether the route has any timestamps at all. Those are different
    // questions: in a pile where two clips are timed and the unplaced one
    // between them is not, the route is "timed" but this particular clip was
    // still spaced evenly, because it has no clock of its own. Wording the
    // ledger off the route-wide count would tell the reader a position was
    // "weighted by how much time had passed" when nothing weighted it.
    const weighted = ea !== null && eb !== null && ei !== null && eb > ea;
    const t = weighted ? clamp01((ei - ea) / (eb - ea)) : (i - p) / (q - p);

    positions[i] = between(a, b, t);
    sources[i] = "inferred";
    inferredCount++;
    if (weighted) inferredWeighted++;
    else inferredEven++;
  }

  // ── Clips and legs ─────────────────────────────────────────────────────────
  const routed: RoutedClip[] = ordered.map((e, i) => ({
    facts: e.facts,
    index: i,
    location: positions[i],
    locationSource: sources[i],
    // An unparseable timestamp does not travel onward as a string: downstream
    // would only try to parse it again and get the same nothing.
    recordedAt: e.epoch !== null ? e.facts.recordedAt : null,
    recordedAtSource: e.epoch !== null ? "measured" : "missing",
    legMetres: null,
    legSeconds: null,
    legSpeedMps: null,
    omitted: false,
  }));

  let totalMetres = 0;
  let skippedLegs = 0;

  for (let i = 1; i < n; i++) {
    const prev = routed[i - 1];
    const cur = routed[i];

    const a = prev.location;
    const b = cur.location;
    if (a && b) cur.legMetres = metresApart(a, b);

    const ea = ordered[i - 1].epoch;
    const eb = ordered[i].epoch;
    // Start to start, NOT start-to-previous-end. The fix on a clip is taken
    // where the camera was when recording began, so the distance between two
    // fixes covers the whole span between those two starts — including the
    // walking done DURING the first clip. Subtracting the first clip's duration
    // would divide a start-to-start distance by a shorter interval and invent
    // implausible speeds out of ordinary footage. See the note in the report.
    if (ea !== null && eb !== null) cur.legSeconds = (eb - ea) / 1000;

    if (cur.legMetres !== null && cur.legSeconds !== null && cur.legSeconds > 0) {
      cur.legSpeedMps = cur.legMetres / cur.legSeconds;
    }

    // A leg only counts toward the total when BOTH ends were actually measured.
    // An interpolated point sits on the straight line between two fixes, so a
    // leg touching one contributes a length we drew rather than one anyone
    // walked; adding it would quietly turn the total into an estimate wearing a
    // measurement's clothes. Skipping is a smaller lie than estimating, and the
    // assumption below says how much was skipped so the total can be read as
    // the floor it is.
    const bothMeasured =
      (prev.locationSource === "measured" || prev.locationSource === "corrected") &&
      (cur.locationSource === "measured" || cur.locationSource === "corrected");

    if (bothMeasured && cur.legMetres !== null) totalMetres += cur.legMetres;
    else skippedLegs++;
  }

  // ── The rest of the summary ────────────────────────────────────────────────
  const epochs = ordered.map((e) => e.epoch).filter((v): v is number => v !== null);
  // Min-to-max rather than first-to-last in route order: when the order came
  // from filenames or mtimes the timestamps may run backwards through it, and a
  // journey that lasted minus four minutes helps nobody.
  const totalSeconds =
    epochs.length >= 2 ? (Math.max(...epochs) - Math.min(...epochs)) / 1000 : null;

  // The first clip with a position is necessarily the first MEASURED one —
  // nothing can be inferred before the first fix, by the no-extrapolation rule.
  const origin = positions.find((p): p is GeoPoint => p !== null) ?? null;

  // ── Warnings about the data itself ─────────────────────────────────────────
  if (n === 1) {
    warnings.push({
      code: "single-clip",
      clipIds: [ordered[0].facts.id],
      message: "one clip is not a journey yet, so there is nothing to order or measure between",
      severity: "note",
    });
  }

  if (timedCount === 0) {
    warnings.push({
      code: "no-timestamps",
      clipIds: [],
      message: "no clip says when it was filmed, so nothing here knows how long the journey took",
      severity: "warn",
    });
  }

  if (locatedCount === 0) {
    // Louder than a missing clock: with no fix anywhere there is no shape to
    // draw at all, and every metre below is absent rather than approximate.
    warnings.push({
      code: "no-locations",
      clipIds: [],
      message: "no clip carries a location, so this is an order without a map",
      severity: "blocker",
    });
  } else if (locatedCount < n) {
    const unlocated = ordered.filter((e) => e.facts.location === null);
    warnings.push({
      code: "partial-locations",
      clipIds: unlocated.map((e) => e.facts.id),
      message: `${locatedCount} of ${n} clips carry a location — ${plural(inferredCount, "position")} interpolated between fixes and ${plural(unplaceableCount, "clip")} could not be placed at all`,
      severity: "warn",
    });
  }

  // Same second, usually a duplicate file or two frames of a burst. It also
  // makes the order between them arbitrary, which is why it is worth a look.
  const bySecond = new Map<number, Entry[]>();
  for (const e of ordered) {
    if (e.epoch === null) continue;
    const sec = Math.floor(e.epoch / 1000);
    const group = bySecond.get(sec);
    if (group) group.push(e);
    else bySecond.set(sec, [e]);
  }
  for (const group of bySecond.values()) {
    if (group.length < 2) continue;
    warnings.push({
      code: "same-timestamp",
      clipIds: group.map((e) => e.facts.id),
      message: `${nameList(group.map((e) => e.facts.name))} claim the same second, which usually means a duplicate or a burst`,
      severity: "warn",
    });
  }

  for (let i = 1; i < n; i++) {
    const cur = routed[i];
    const prevName = routed[i - 1].facts.name;
    const ids = [routed[i - 1].facts.id, cur.facts.id];

    if (cur.legSpeedMps !== null && cur.legSpeedMps > IMPLAUSIBLE_MPS) {
      warnings.push({
        code: "implausible-speed",
        clipIds: ids,
        message: `${prevName} to ${cur.facts.name} implies ${Math.round(cur.legSpeedMps)} m/s, so either the order is wrong or one of those fixes is`,
        severity: "warn",
      });
    }

    if (cur.legSeconds !== null && cur.legSeconds > LONG_GAP_SEC) {
      warnings.push({
        code: "long-gap",
        clipIds: ids,
        message: `${durationLabel(cur.legSeconds)} passed between ${prevName} and ${cur.facts.name}, so the journey has a break in it`,
        severity: "note",
      });
    }
  }

  const devices = new Set(
    entries
      .map((e) => e.facts.device?.trim())
      .filter((d): d is string => typeof d === "string" && d.length > 0),
  );
  if (devices.size > 1) {
    warnings.push({
      code: "mixed-devices",
      clipIds: [],
      message: `${plural(devices.size, "device")} filmed this (${nameList([...devices])}), which is normal when two people were filming`,
      severity: "note",
    });
  }

  // ── The rest of the ledger ─────────────────────────────────────────────────
  if (inferredCount > 0) {
    // The clause names the rule that ACTUALLY placed these clips, which is a
    // per-clip fact — a route can contain both kinds at once, and saying so is
    // cheaper than a sentence the reader can catch being wrong.
    const how =
      inferredWeighted > 0 && inferredEven > 0
        ? `, ${inferredWeighted} of them weighted by how much time had passed and ${inferredEven} spaced evenly because ${inferredEven === 1 ? "it carried" : "they carried"} no clock`
        : inferredWeighted > 0
          ? ", weighted by how much time had passed"
          : ", spaced evenly between them";
    assumptions.push(
      `${plural(inferredCount, "clip")} had no location of ${inferredCount === 1 ? "its" : "their"} own and ${inferredCount === 1 ? "was" : "were"} placed on the straight line between the nearest located clips on either side${how}. Those are drawn positions, not fixes — drag them if you remember better.`,
    );
  }
  if (unplaceableCount > 0) {
    assumptions.push(
      `${plural(unplaceableCount, "clip")} had no located clip both before and after ${unplaceableCount === 1 ? "it" : "them"}, so ${unplaceableCount === 1 ? "it is" : "they are"} left unplaced. We do not guess past the ends of the located stretch: a clip beyond the last fix could be a step away or a city away, and the route cannot tell which.`,
    );
  }
  if (skippedLegs > 0 && locatedCount > 0) {
    assumptions.push(
      `The total distance skips ${plural(skippedLegs, "leg")} where one or both ends were not actually measured, so it is a floor rather than the length of the walk.`,
    );
  }

  // blocker → warn → note, stable within a severity so related warnings stay
  // in the order they were found (and therefore in route order).
  warnings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  return {
    clips: routed,
    orderedBy: basis,
    totalMetres,
    totalSeconds,
    origin,
    located: locatedCount,
    timed: timedCount,
    warnings,
    assumptions,
  };
}
