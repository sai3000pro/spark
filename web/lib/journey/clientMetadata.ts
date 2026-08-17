/**
 * Reading a video's own metadata in the browser, off a few kilobytes of it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS AT ALL
 *
 * ../video/probeMetadata.ts already reads every tag this module reads, with
 * ffmpeg, better — it has the whole header rather than a window onto it. But it
 * only runs on a file that reached the server, and the drop path deliberately
 * keeps the video in the tab. Uploading four hundred megabytes of footage to
 * find out what ORDER it goes in would trade away the one privacy property that
 * path has, and pay for it in minutes of the reader's time, in exchange for a
 * timestamp that is sitting in the first kilobyte of the container.
 *
 * So this parses the container directly. `File.slice()` is a lazy view: reading
 * 1 MiB out of the middle of a 4 GB clip costs 1 MiB, and the browser never
 * materialises the rest. Twelve clips are read in the time it takes to render
 * the list.
 *
 * Both readers fill the SAME `ClipFacts` (./clips.ts), which is the whole
 * point — a clip that came off the phone through the handoff and a clip dragged
 * onto the laptop must produce the same route, or the two paths disagree about
 * the same footage and nobody can say which one is right. `clipFactsFromFile`
 * over there is this function's mirror, and is preferred whenever it can run.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT REFUSES TO DO
 *
 *   · It never reads the whole file. Two bounded windows, head and tail, capped
 *     at MAX_WINDOW_BYTES each. If `moov` is not in either, the answer is "we
 *     do not know", not "let me fetch the other 3.9 GB".
 *   · It never throws. A corrupt clip must not take down an eleven-clip
 *     selection, so every failure lands on `emptyFacts` with `fileModifiedAt`
 *     still filled — that field comes off the `File` and no container can lose
 *     it.
 *   · It never guesses. A tag that is not there is null. In particular
 *     `recordedAt` NEVER falls back to `file.lastModified`: copying a clip off a
 *     phone rewrites the mtime to the time of the copy, so it is routinely hours
 *     wrong in a way that looks entirely plausible. `ClipFacts` has a separate
 *     field for it and its comment explains what conflating them costs.
 *   · It does not parse WebM/Matroska. Those are EBML, a completely different
 *     tree, and a shaky half-parser for it would produce confident wrong
 *     answers on the one format nobody tests with. A non-ISO-BMFF container
 *     comes back with empty facts, which is honest. MP4/MOV/M4V — everything a
 *     phone camera produces — is what is handled here.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FORMAT, BRIEFLY
 *
 * ISO base media format is a tree of boxes, each `[uint32 size][4-char type]`
 * followed by its payload; `size` counts the header. Two escapes: size 1 means
 * a 64-bit largesize follows the type, and size 0 means "to the end of the
 * file" and is legal only on the last box. Everything below is a walk over that
 * with the offsets checked at every step — a size field of 0, or one larger
 * than the window, or one small enough not to advance, all appear in real
 * damaged files and none of them may spin.
 */
import type { GeoPoint } from "../types";
import { parseISO6709 } from "../video/iso6709";

import { emptyFacts, type ClipFacts } from "./clips";

// ─────────────────────────────────────────────────────────────────────────────
// Bounds
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How much of each end of the file we are willing to read. Per window, so the
 * worst case for one clip is twice this.
 *
 * A `moov` is a few kilobytes plus roughly 100 bytes per second of footage for
 * the sample tables, so 2 MiB covers hours of video with room to spare. The cap
 * exists because the alternative failure mode is silent: without it, a phone on
 * a hotel wifi reading a dozen clips off a network drive would be pulling
 * gigabytes to sort a list, and the only symptom would be a slow page.
 */
const MAX_WINDOW_BYTES = 2 * 1024 * 1024;

/**
 * Iteration ceilings. Every loop over a length read out of the file gets one,
 * because the length came from the file and the file may be lying.
 */
const MAX_BOXES = 4096;
const MAX_KEYS = 512;

/**
 * The `moov` timestamps count seconds from 1904-01-01 UTC — the Mac epoch,
 * inherited from QuickTime, and 2082844800 seconds before the Unix one.
 */
const MAC_EPOCH_OFFSET_SEC = 2_082_844_800;

/**
 * The window an `mvhd` creation time has to fall in to be believed.
 *
 * A stripped or zeroed header reads as 1904, and a garbage one reads as some
 * year in the sixty thousands. Both are "the file did not say", not an error —
 * fixed bounds rather than `Date.now()` so the same bytes give the same answer
 * on every machine and in every test run.
 */
const PLAUSIBLE_FROM_MS = Date.UTC(1990, 0, 1);
const PLAUSIBLE_UNTIL_MS = Date.UTC(2100, 0, 1);

/**
 * The QuickTime location tag's four-character type. Its first byte is 0xA9 —
 * built from the code point rather than typed as `©` so the comparison cannot
 * be broken by this source file being read back as anything but UTF-8.
 */
const XYZ_TAG = `${String.fromCharCode(0xa9)}xyz`;

/** Box types that a real `moov` starts one of. Used to reject a false positive. */
const MOOV_CHILDREN = new Set(["mvhd", "trak", "udta", "meta", "mvex", "iods", "uuid"]);

const utf8 = new TextDecoder("utf-8", { fatal: false });

// ─────────────────────────────────────────────────────────────────────────────
// The public surface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Everything one video file says about itself. Never throws, never uploads.
 *
 * A thin wrapper over `factsFromContainer` on purpose: the parser is the part
 * with the logic in it, and it takes a plain `ArrayBuffer` so a verification
 * script can hand it a hand-built container under tsx with no `File` and no
 * browser in sight. The tested code is then literally the shipped code —
 * the same split ../video/iso6709.ts was pulled out for.
 */
export async function readClipFacts(file: File, id: string): Promise<ClipFacts> {
  const seed = {
    id,
    name: file.name,
    bytes: file.size,
    fileModifiedAt: isoOrNull(file.lastModified),
  };

  // Head first: a faststart file (anything served over the web, and anything
  // exported by an editor) has `moov` before `mdat`, and one small read ends it.
  const head = await sliceBytes(file, 0, Math.min(file.size, MAX_WINDOW_BYTES));
  if (head) {
    const facts = factsFromContainer(head, seed);
    if (saidSomething(facts)) return facts;
  }

  // Then the tail. Phone cameras cannot know a recording's length until it
  // stops, so they stream samples into `mdat` and write `moov` after it — which
  // means on most footage that actually matters here, the metadata is the LAST
  // thing in the file and the walk from the front hits a multi-hundred-megabyte
  // `mdat` it is not allowed to read past.
  if (file.size > MAX_WINDOW_BYTES) {
    const tail = await sliceBytes(file, file.size - MAX_WINDOW_BYTES, file.size);
    if (tail) {
      const facts = factsFromContainer(tail, seed);
      if (saidSomething(facts)) return facts;
    }
  }

  return { ...emptyFacts(seed.id, seed.name, seed.bytes), fileModifiedAt: seed.fileModifiedAt };
}

/**
 * A whole selection, in order, with progress.
 *
 * The ids are assigned here rather than asked for because they only have to be
 * stable within one selection — see `ClipFacts.id` — and the caller inventing
 * them would be a second place that has to agree about ordering. Sequential, not
 * parallel: reading twelve files at once turns twelve bounded reads into one
 * unbounded memory spike, and the progress callback exists precisely so the
 * sequence is visible rather than fast.
 */
export async function readAllClipFacts(
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<ClipFacts[]> {
  const out: ClipFacts[] = [];
  for (let i = 0; i < files.length; i++) {
    out.push(await readClipFacts(files[i], `clip_${i}`));
    onProgress?.(i + 1, files.length);
  }
  return out;
}

/**
 * The parser proper: an ISO-BMFF buffer in, `ClipFacts` out. Never throws.
 *
 * `buf` may be a window onto the middle of a file rather than the whole of it,
 * so nothing here may assume offset 0 is the start of the container.
 */
export function factsFromContainer(
  buf: ArrayBuffer,
  seed: { id: string; name: string; bytes: number; fileModifiedAt: string | null },
): ClipFacts {
  const facts = emptyFacts(seed.id, seed.name, seed.bytes);
  facts.fileModifiedAt = seed.fileModifiedAt;

  try {
    const view = new DataView(buf);
    const moov = findMoov(view);
    if (!moov) return facts;
    fillFromMoov(view, moov.body, moov.end, facts);
  } catch {
    // Any offset that got past the guards below, any decoder that disliked its
    // bytes. Whatever we had filled in stays; the rest is null. One bad clip
    // does not cost the reader the other eleven.
  }
  return facts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Finding `moov`
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Locate the `moov` box, by walking if we can and by scanning if we cannot.
 *
 * The walk is correct and is tried first. The scan exists because the walk
 * fundamentally cannot finish in the case this module was written for: a
 * top-level `mdat` declaring 900 MB cannot be stepped over inside a 2 MiB
 * window, and the tail window does not begin on a box boundary at all — it
 * begins wherever `size - MAX_WINDOW_BYTES` landed, mid-sample.
 *
 * Scanning for four bytes is not free of false positives (`moov` can occur
 * inside compressed video), so a candidate is only accepted if its size field
 * is sane AND its first child is a box type a `moov` actually contains. That
 * pair of conditions is what separates a real header from a coincidence.
 */
function findMoov(view: DataView): { body: number; end: number } | null {
  const len = view.byteLength;

  // Collected into an array rather than a nullable local: a value assigned only
  // inside a callback is not something the compiler can narrow afterwards.
  const walked: { body: number; end: number }[] = [];
  eachBox(view, 0, len, (type, body, end) => {
    if (type !== "moov") return true;
    if (!looksLikeMoov(view, body, end)) return true;
    walked.push({ body, end });
    return false;
  });
  if (walked.length > 0) return walked[0];

  // 'm','o','o','v' — the size field is the four bytes in front of it.
  for (let i = 4; i + 4 <= len; i++) {
    if (view.getUint8(i) !== 0x6d) continue;
    if (view.getUint8(i + 1) !== 0x6f) continue;
    if (view.getUint8(i + 2) !== 0x6f) continue;
    if (view.getUint8(i + 3) !== 0x76) continue;

    const start = i - 4;
    let size = view.getUint32(start);
    let body = i + 4;
    if (size === 1) {
      if (body + 8 > len) continue;
      size = readUint64(view, body);
      body += 8;
    }
    // A `moov` is never smaller than its own header plus an `mvhd` header. The
    // size is otherwise not bounded here on purpose — in the tail window the
    // box legitimately starts before the buffer's own idea of the file — so the
    // real filter is the child check below.
    if (size < 16) continue;
    const end = Math.min(start + size, len);
    if (looksLikeMoov(view, body, end)) return { body, end };
  }
  return null;
}

/** Does a box that claims to be `moov` contain something a `moov` contains? */
function looksLikeMoov(view: DataView, body: number, end: number): boolean {
  if (body + 8 > end) return false;
  const size = view.getUint32(body);
  if (size !== 0 && size !== 1 && (size < 8 || body + size > end)) return false;
  return MOOV_CHILDREN.has(fourcc(view, body + 4));
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading it
// ─────────────────────────────────────────────────────────────────────────────

function fillFromMoov(view: DataView, body: number, end: number, facts: ClipFacts): void {
  eachBox(view, body, end, (type, childBody, childEnd) => {
    if (type === "mvhd") readMvhd(view, childBody, childEnd, facts);
    else if (type === "udta") readUdta(view, childBody, childEnd, facts);
    else if (type === "meta") readAppleMeta(view, childBody, childEnd, facts);
    return true;
  });
}

/**
 * `mvhd` — the movie header. Duration always, and a creation time of last
 * resort.
 *
 * Version 0 stores the times and the duration as 32-bit, version 1 as 64-bit;
 * the timescale is 32-bit in both. The time is UTC with no offset attached, so
 * a stamp read here leaves `utcOffsetMin` null — see `utcOffsetMinFrom`. It is
 * only used when Apple's `creationdate` was absent, because that one carries
 * the offset and is strictly the better answer.
 */
function readMvhd(view: DataView, body: number, end: number, facts: ClipFacts): void {
  if (body + 4 > end) return;
  const version = view.getUint8(body);
  const p = body + 4; // version byte + 3 flag bytes

  let createdSec: number;
  let timescale: number;
  let duration: number;

  if (version === 1) {
    if (p + 28 > end) return;
    createdSec = readUint64(view, p);
    timescale = view.getUint32(p + 16);
    duration = readUint64(view, p + 20);
  } else {
    if (p + 16 > end) return;
    createdSec = view.getUint32(p);
    timescale = view.getUint32(p + 8);
    duration = view.getUint32(p + 12);
  }

  if (timescale > 0 && duration > 0) {
    // 0xFFFFFFFF is the "unknown duration" sentinel for a still-being-written
    // file; it would otherwise read as 49 days of footage.
    const seconds = duration === 0xffff_ffff ? 0 : duration / timescale;
    if (Number.isFinite(seconds) && seconds > 0) facts.durationSec = seconds;
  }

  if (facts.recordedAt) return; // `creationdate` already won
  const ms = (createdSec - MAC_EPOCH_OFFSET_SEC) * 1000;
  if (!Number.isFinite(ms) || ms < PLAUSIBLE_FROM_MS || ms >= PLAUSIBLE_UNTIL_MS) return;
  facts.recordedAt = new Date(ms).toISOString();
  facts.utcOffsetMin = null;
}

/**
 * `moov/udta/©xyz` — the classic QuickTime location tag, written by phones and
 * by anything that ever copied phone output.
 *
 * The `©` is byte 0xA9, and the payload is not a string but
 * `[uint16 length][uint16 language][text]` — a "pascal-ish" tag, the same shape
 * as the other `©`-prefixed user-data tags.
 */
function readUdta(view: DataView, body: number, end: number, facts: ClipFacts): void {
  eachBox(view, body, end, (type, childBody, childEnd) => {
    if (type !== XYZ_TAG) return true;
    if (childBody + 4 > childEnd) return true;
    const textLen = view.getUint16(childBody);
    const from = childBody + 4;
    const to = Math.min(from + textLen, childEnd);
    if (to <= from) return true;
    applyISO6709(text(view, from, to), facts);
    return true;
  });
}

/**
 * Apple's `moov/meta` — where the good timestamp lives.
 *
 * Three children in sequence: a `hdlr` naming the metadata format, a `keys` box
 * listing reverse-DNS names, and an `ilst` of values. The indirection is the
 * part worth stating: an `ilst` entry does not name its key, its BOX TYPE is a
 * big-endian integer INDEXING the keys list, counted from 1. So an entry's
 * meaning is only knowable by having parsed `keys` first, and an `ilst` read on
 * its own is a list of anonymous strings.
 *
 * One further wrinkle: in QuickTime `meta` is a plain box, while in ISO/MP4 it
 * is a full box with four version/flag bytes before its children. Rather than
 * guess from the file extension, look at where the first child's type lands.
 */
function readAppleMeta(view: DataView, body: number, end: number, facts: ClipFacts): void {
  let from = body;
  if (body + 8 <= end && !isBoxType(fourcc(view, body + 4))) {
    if (body + 12 > end) return;
    from = body + 4;
  }

  const keys: string[] = [];
  const lists: { body: number; end: number }[] = [];

  eachBox(view, from, end, (type, childBody, childEnd) => {
    if (type === "keys") keys.push(...readKeys(view, childBody, childEnd));
    else if (type === "ilst") lists.push({ body: childBody, end: childEnd });
    return true;
  });

  if (lists.length === 0 || keys.length === 0) return;
  const list = lists[0];

  eachBox(view, list.body, list.end, (type, entryBody, entryEnd) => {
    // The "type" of an ilst entry is a 1-based index into `keys`.
    const index = fourccAsIndex(type);
    const key = index >= 1 && index <= keys.length ? keys[index - 1] : null;
    if (!key) return true;
    const value = readDataBox(view, entryBody, entryEnd);
    if (value !== null) applyAppleTag(key, value, facts);
    return true;
  });
}

/**
 * The `keys` full box: version+flags, an entry count, then that many
 * `[uint32 size]['mdta'][name]` records where `size` counts the 8-byte header.
 */
function readKeys(view: DataView, body: number, end: number): string[] {
  if (body + 8 > end) return [];
  const count = Math.min(view.getUint32(body + 4), MAX_KEYS);
  const out: string[] = [];
  let off = body + 8;
  for (let i = 0; i < count; i++) {
    if (off + 8 > end) break;
    const size = view.getUint32(off);
    if (size < 8 || off + size > end) break; // truncated by our window, or nonsense
    out.push(text(view, off + 8, off + size));
    off += size;
  }
  return out;
}

/**
 * The `data` box inside an `ilst` entry:
 * `[uint32 typeIndicator][uint32 locale][payload]`.
 *
 * Type indicator 1 is UTF-8 text, which is what every tag this module wants is
 * stored as. The numeric indicators (21 signed int, 23 float) are deliberately
 * not decoded — nothing here reads a numeric tag, and half-decoding one would
 * put a number in a string field.
 */
function readDataBox(view: DataView, body: number, end: number): string | null {
  const found: string[] = [];
  eachBox(view, body, end, (type, dataBody, dataEnd) => {
    if (type !== "data") return true;
    if (dataBody + 8 > dataEnd) return true;
    if (view.getUint32(dataBody) !== 1) return true;
    found.push(text(view, dataBody + 8, dataEnd));
    return false;
  });
  return found.length > 0 ? found[0] : null;
}

/** Route one `com.apple.quicktime.*` tag into the facts. */
function applyAppleTag(key: string, value: string, facts: ClipFacts): void {
  const raw = value.trim();
  if (!raw) return;

  switch (key) {
    case "com.apple.quicktime.creationdate": {
      // The one stamp in the container that carries its UTC offset, which is
      // why it outranks `mvhd` and why it is read for the offset directly
      // rather than off whatever ended up in `recordedAt`.
      const stamp = normalizeStamp(raw);
      if (!stamp) return;
      facts.recordedAt = stamp;
      facts.utcOffsetMin = utcOffsetMinFrom(stamp);
      return;
    }
    case "com.apple.quicktime.location.ISO6709":
    case "com.apple.quicktime.location":
      applyISO6709(raw, facts);
      return;
    case "com.apple.quicktime.make":
      facts.device = joinDevice(raw, facts.device);
      return;
    case "com.apple.quicktime.model":
      facts.device = joinDevice(facts.device, raw);
      return;
    default:
      return;
  }
}

/**
 * "Apple" + "iPhone 15 Pro" → "Apple iPhone 15 Pro", in whichever order the
 * two tags arrived, without doubling the make when the model already carries
 * it ("Apple Apple iPhone"). Same rule as `deviceFrom` in probeMetadata.ts, so
 * the two readers produce the same string for the same camera.
 */
function joinDevice(make: string | null, model: string | null): string | null {
  if (make && model) return model.startsWith(make) ? model : `${make} ${model}`;
  return model ?? make;
}

/**
 * Position and, if the fix carried one, altitude.
 *
 * `parseISO6709` is imported rather than reimplemented — it is the tested
 * parser and it already rejects out-of-range coordinates and null island. The
 * altitude is scraped off the same raw string here for the reason its
 * counterpart in probeMetadata.ts gives: widening that function's return type
 * would change the shape every caller destructures, to serve a field that is
 * null on most clips. It is read ONLY when `parseISO6709` succeeded, because
 * that success is the evidence the string was the format we took it for — a
 * third signed number out of something that failed the lat/lng range check is
 * not an altitude, it is a coincidence.
 */
function applyISO6709(raw: string, facts: ClipFacts): void {
  const location: GeoPoint | null = parseISO6709(raw);
  if (!location) return;
  facts.location = location;

  const m = /([+-]\d{1,3}(?:\.\d+)?)([+-]\d{1,3}(?:\.\d+)?)([+-]\d{1,6}(?:\.\d+)?)/.exec(raw.trim());
  if (!m) return;
  const alt = Number(m[3]);
  // Bounded for the same reason the coordinate is: a value outside the range a
  // camera can physically occupy means the string was not what we took it for.
  if (Number.isFinite(alt) && Math.abs(alt) <= 100_000) facts.altitudeM = alt;
}

/**
 * `2026-08-15T18:42:11-0400` as written, with the offset made parseable.
 *
 * The offset is preserved because a journey reads in the time it happened —
 * see `ClipFacts.recordedAt`. The only edit is inserting the colon into a bare
 * `±HHMM`: ES `Date.parse` is only required to accept `±HH:MM`, and `epochOf`
 * in ./clips.ts parses these strings for ordering. Same instant, same offset,
 * one character. A stamp that still will not parse is discarded rather than
 * stored, because an unparseable `recordedAt` sorts as absent anyway and would
 * only look like data.
 */
function normalizeStamp(raw: string): string | null {
  const stamp = raw.replace(/([+-])(\d{2})(\d{2})$/, "$1$2:$3");
  return Number.isFinite(Date.parse(stamp)) ? stamp : null;
}

/**
 * Minutes east of UTC off the tail of a stamp, or null.
 *
 * Kept identical to `utcOffsetMinFrom` in probeMetadata.ts. A bare `Z` matches
 * nothing here and so yields null, which is correct and not an oversight: `Z`
 * says the time is UTC, it does NOT say the camera was in London. Reporting 0
 * for it would put every UTC-only clip in a timezone somebody has to be in.
 */
function utcOffsetMinFrom(stamp: string): number | null {
  const m = /([+-])(\d{2}):?(\d{2})$/.exec(stamp.trim());
  if (!m) return null;
  const hours = Number(m[2]);
  const minutes = Number(m[3]);
  // Real offsets run −12:00 to +14:00; past that it is a number that happened
  // to sit at the end of the string.
  if (hours > 14 || minutes > 59) return null;
  const total = hours * 60 + minutes;
  return m[1] === "-" ? -total : total;
}

// ─────────────────────────────────────────────────────────────────────────────
// Box walking, with every offset distrusted
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Walk the box chain in `[from, to)`, calling `visit` with each box's payload
 * range. Return `false` from `visit` to stop early.
 *
 * The guards are the substance of this function. `size === 0` means "to the end
 * of the container" and is only legal on the last box, so it terminates the
 * walk. A box whose declared end runs past `to` has been cut by our window —
 * it is still handed over with the range clamped, because a truncated `moov` is
 * worth descending into, but the walk stops after it rather than resuming at an
 * offset that is now meaningless. And the loop is bounded by `MAX_BOXES`
 * regardless, because "the size field advances" is a property of the file and
 * the file may be damaged.
 */
function eachBox(
  view: DataView,
  from: number,
  to: number,
  visit: (type: string, body: number, end: number) => boolean | void,
): void {
  let off = Math.max(0, from);
  const limit = Math.min(to, view.byteLength);

  for (let n = 0; n < MAX_BOXES; n++) {
    if (off + 8 > limit) return;

    let size = view.getUint32(off);
    const type = fourcc(view, off + 4);
    let body = off + 8;

    if (size === 1) {
      if (body + 8 > limit) return;
      // 64-bit largesize. Read as two 32-bit halves: a file with a box past
      // 2^53 bytes does not exist, and BigInt here would buy nothing.
      size = readUint64(view, body);
      body += 8;
    } else if (size === 0) {
      size = limit - off;
    }

    const headerBytes = body - off;
    if (size < headerBytes) return; // cannot even contain its own header

    const declaredEnd = off + size;
    if (declaredEnd > limit) {
      // Cut off by the window. Show what is visible, then stop — there is no
      // next box to be found at a known offset.
      visit(type, body, limit);
      return;
    }

    if (visit(type, body, declaredEnd) === false) return;

    if (declaredEnd <= off) return; // non-advancing: would spin forever
    off = declaredEnd;
  }
}

/** The four-character type at `off`, as a string. `©` arrives as U+00A9. */
function fourcc(view: DataView, off: number): string {
  if (off + 4 > view.byteLength) return "";
  return (
    String.fromCharCode(view.getUint8(off)) +
    String.fromCharCode(view.getUint8(off + 1)) +
    String.fromCharCode(view.getUint8(off + 2)) +
    String.fromCharCode(view.getUint8(off + 3))
  );
}

/** The same four bytes read as the big-endian integer an `ilst` entry uses. */
function fourccAsIndex(type: string): number {
  if (type.length !== 4) return -1;
  return (
    (type.charCodeAt(0) << 24) |
    (type.charCodeAt(1) << 16) |
    (type.charCodeAt(2) << 8) |
    type.charCodeAt(3)
  );
}

/** Printable ASCII, which every real box type is. Used to detect a full box. */
function isBoxType(type: string): boolean {
  if (type.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const c = type.charCodeAt(i);
    if (c !== 0xa9 && (c < 0x20 || c > 0x7e)) return false;
  }
  return true;
}

function readUint64(view: DataView, off: number): number {
  return view.getUint32(off) * 2 ** 32 + view.getUint32(off + 4);
}

/** UTF-8, non-fatal: a mangled byte becomes U+FFFD rather than an exception. */
function text(view: DataView, from: number, to: number): string {
  const start = Math.max(0, Math.min(from, view.byteLength));
  const end = Math.max(start, Math.min(to, view.byteLength));
  return utf8.decode(new Uint8Array(view.buffer, view.byteOffset + start, end - start));
}

// ─────────────────────────────────────────────────────────────────────────────
// File plumbing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One bounded read. `File.slice` is lazy — this pulls exactly `end - start`
 * bytes off the disk and never touches the rest of the clip.
 */
async function sliceBytes(file: File, start: number, end: number): Promise<ArrayBuffer | null> {
  if (end <= start) return null;
  try {
    return await file.slice(start, end).arrayBuffer();
  } catch {
    // The file moved or the permission lapsed between the drop and here.
    return null;
  }
}

/** Did the parse find anything at all? Decides whether the tail is worth reading. */
function saidSomething(facts: ClipFacts): boolean {
  return (
    facts.recordedAt !== null ||
    facts.location !== null ||
    facts.durationSec !== null ||
    facts.device !== null
  );
}

/** `File.lastModified` is milliseconds, and is NaN on a few odd sources. */
function isoOrNull(ms: number): string | null {
  if (!Number.isFinite(ms)) return null;
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}
