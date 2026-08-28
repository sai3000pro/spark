/**
 * Does the upload gate accept what renders and refuse what does not?
 *
 * The question this answers is narrow and it is the one that matters: a file
 * that gets past the format check is written into the SERVED directory, and
 * from that moment `getSplatJob` calls it ready and hands the viewer its URL.
 * There is no later checkpoint. So a false accept is not a bad error message —
 * it is a capture the app promises and cannot draw, and the user finds out by
 * staring at an empty scene.
 *
 * The cases below are the ones people actually upload by mistake, in rough
 * order of how often: a mesh from Blender, an ASCII export, a half-finished
 * download, and the video they meant to reconstruct in the first place.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHICH FIXTURES ARE REAL, AND WHICH ARE NOT — READ THIS BEFORE TRUSTING A PASS
 *
 * The gate takes four formats now, and the four are NOT equally well covered
 * here. Being specific, because "the tests pass" means different things for each:
 *
 *   PLY     REAL. The last section opens the four .ply files committed under
 *           public/mock/splats — two KIRI captures and two authored ones,
 *           22 MB to 143 MB — and runs the detector over their actual first
 *           64 KB and actual byte counts. Everything else in the PLY sections
 *           is a constructed header, which is fair: a PLY header IS text, and
 *           writing one is not an approximation of writing one.
 *
 *   SPZ     SYNTHETIC, but of a format whose header is 16 fixed bytes and whose
 *           framing is ordinary gzip, both of which `zlib.gzipSync` produces
 *           exactly. The layout was read out of @sparkjsdev/spark's own
 *           SpzWriter rather than from documentation. What is NOT exercised
 *           here is a file from a real encoder end to end — no .spz is
 *           committed to this repo, and a fixture cannot prove that a Luma or
 *           Niantic export has the header this expects.
 *
 *   KSPLAT  SYNTHETIC, and the least real of the four. The header and section
 *           layout were read out of Spark's `decodeKsplat`; the fixtures below
 *           build that layout and pad it to the size it declares. Nobody has
 *           run this against a file the mkkellogg tool actually wrote.
 *
 *   SPLAT   SYNTHETIC in origin, EXACT in form. The format is a bare array of
 *           32-byte records with no header at all, so a constructed one is not
 *           an approximation of a real one — it is the same thing with
 *           different numbers in it. What is untested is a real Luma export,
 *           for the same reason: there is not one in the repo.
 *
 * Do not read a green run here as "verified against real .spz and .splat
 * exports". It is not that, and the day someone drops a real one into
 * public/mock/splats this comment should shrink.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THE LIMITS
 *
 * The last sections cover app/api/splat/upload/limits.ts — the byte budget, the
 * rate limiter and the concurrency cap that stand in for an authentication
 * layer this checkout cannot run. Those tests are read-only against the real
 * public/mock/splats: they scan it, they never write to it.
 *
 * Runs DOM-free under tsx, which is why lib/splat/plyHeader.ts and its
 * neighbours carry no `server-only` guard — see the note at the bottom of
 * plyHeader's header, and lib/splat/store.ts, which exists so the limits are
 * reachable from here at all.
 *
 *     npx tsx scripts/verify-splat-upload.ts
 */
import { closeSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

import {
  budgetVerdict,
  identifyUploader,
  MAX_CONCURRENT_UPLOADS,
  MAX_UPLOAD_BYTES,
  openUploadSlot,
  RATE_LIMIT_UPLOADS,
  resetUploadLimitsForTest,
  SPLAT_STORE_BUDGET_BYTES,
  storedUploadBytes,
  sweepStaleTemps,
  tempUploadPath,
} from "../app/api/splat/upload/limits";
import { SPLAT_ACCEPT_ATTRIBUTE, SPLAT_EXTENSIONS, hasSplatExtension } from "../lib/splat/extensions";
import { detectSplatFormat, MAX_HEADER_BYTES } from "../lib/splat/formats";
import { parsePlyHeader } from "../lib/splat/plyHeader";
import { SPLAT_DIR } from "../lib/splat/store";

let passed = 0;
const failures: string[] = [];

function ok(label: string, condition: boolean): void {
  if (condition) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

/** The INRIA layout, trimmed to the properties that identify it. */
const GAUSSIAN_PROPS = [
  "x", "y", "z",
  "f_dc_0", "f_dc_1", "f_dc_2",
  "opacity",
  "scale_0", "scale_1", "scale_2",
  "rot_0", "rot_1", "rot_2", "rot_3",
];

/**
 * Build a PLY prefix the way a real exporter would.
 *
 * Returns the header bytes plus enough of a body to be realistic; the SIZE the
 * parser is told about is passed separately, which is what lets a truncation
 * case be expressed without allocating the megabytes it claims.
 */
function ply(opts: {
  format?: string;
  count?: number;
  props?: string[];
  types?: string[];
  extra?: string;
  eol?: string;
}): Buffer {
  const {
    format = "binary_little_endian 1.0",
    count = 1000,
    props = GAUSSIAN_PROPS,
    types,
    extra = "",
    eol = "\n",
  } = opts;
  const lines = ["ply", `format ${format}`];
  if (extra) lines.push(extra);
  lines.push(`element vertex ${count}`);
  props.forEach((p, i) => lines.push(`property ${types?.[i] ?? "float"} ${p}`));
  lines.push("end_header");
  return Buffer.from(lines.join(eol) + eol, "latin1");
}

/** Header plus a body big enough for `count` vertices of `stride` bytes. */
function sized(header: Buffer, count: number, stride: number): number {
  return header.length + count * stride;
}

section("A real Gaussian splat is accepted and measured");
{
  const h = ply({ count: 1000 });
  const total = sized(h, 1000, GAUSSIAN_PROPS.length * 4);
  const r = parsePlyHeader(h, total);
  ok("accepted", r.ok);
  if (r.ok) {
    ok("count read from the header", r.count === 1000);
    ok("stride is 4 bytes per float property", r.stride === GAUSSIAN_PROPS.length * 4);
    ok("dataOffset lands just past end_header", r.dataOffset === h.length);
    ok("recognised as a Gaussian splat", r.gaussian);
    ok("all-float layout detected, so plyBounds can frame it", r.allFloat);
    ok("no warning on a good file", r.warning === null);
  }
}

section("CRLF headers — Windows exporters emit them");
{
  const h = ply({ count: 10, eol: "\r\n" });
  const r = parsePlyHeader(h, sized(h, 10, GAUSSIAN_PROPS.length * 4));
  ok("accepted with \\r\\n line endings", r.ok);
  ok("dataOffset accounts for the \\r", r.ok && r.dataOffset === h.length);
}

section("The four common wrong files");
{
  const ascii = ply({ format: "ascii 1.0" });
  const r1 = parsePlyHeader(ascii, ascii.length + 10_000);
  ok("ASCII PLY refused", !r1.ok);
  ok("...and told to re-export as binary", !r1.ok && /binary/i.test(r1.reason));

  const be = ply({ format: "binary_big_endian 1.0" });
  ok("big-endian PLY refused", !parsePlyHeader(be, be.length + 10_000).ok);

  const mesh = ply({ props: ["x", "y", "z"], extra: "element face 500" });
  const r3 = parsePlyHeader(mesh, mesh.length + 100_000);
  ok("mesh PLY refused", !r3.ok);
  ok("...and named as a mesh, not a splat", !r3.ok && /mesh/i.test(r3.reason));

  // The single most likely mistake: the clip, not the reconstruction.
  const mp4 = Buffer.concat([
    Buffer.from([0, 0, 0, 0x20]),
    Buffer.from("ftypisom", "latin1"),
    Buffer.alloc(64),
  ]);
  const r4 = parsePlyHeader(mp4, 50_000_000);
  ok("an mp4 refused", !r4.ok);
  ok("...and identified as a video", !r4.ok && /video/i.test(r4.reason));
}

section("Truncation — the failure that used to reach the viewer");
{
  const h = ply({ count: 500_000 });
  const full = sized(h, 500_000, GAUSSIAN_PROPS.length * 4);
  ok("complete file accepted", parsePlyHeader(h, full).ok);

  const r = parsePlyHeader(h, Math.floor(full / 2));
  ok("half-arrived file refused", !r.ok);
  ok("...and says it is truncated", !r.ok && /truncated/i.test(r.reason));
  // The numbers are the actionable part: they tell you it was the transfer.
  ok("...and reports both sizes", !r.ok && (r.reason.match(/MB/g) ?? []).length >= 2);

  // One byte short is still short. An off-by-one here reads the last vertex
  // out of bounds at render time.
  ok("one byte short refused", !parsePlyHeader(h, full - 1).ok);
  ok("exactly enough accepted", parsePlyHeader(h, full).ok);
}

section("A header with no end is not a slow header");
{
  const nev = Buffer.from("ply\nformat binary_little_endian 1.0\nelement vertex 5\n", "latin1");
  const r = parsePlyHeader(nev, 1_000_000);
  ok("unterminated header refused", !r.ok);
  ok("...and blamed on truncation, not on the format", !r.ok && /truncated|corrupt/i.test(r.reason));
}

section("Point clouds load, so they are accepted — with a warning");
{
  const cloud = ply({ props: ["x", "y", "z", "red", "green", "blue"], types: ["float", "float", "float", "uchar", "uchar", "uchar"] });
  const stride = 3 * 4 + 3;
  const r = parsePlyHeader(cloud, sized(cloud, 1000, stride));
  ok("coloured point cloud accepted", r.ok);
  ok("mixed-width stride computed correctly", r.ok && r.stride === stride);
  ok("not claimed to be a Gaussian splat", r.ok && !r.gaussian);
  ok("allFloat false, so plyBounds is not asked to measure it", r.ok && !r.allFloat);
  ok("warning explains it will not look like a capture", r.ok && !!r.warning && /point cloud/i.test(r.warning));
}

section("Multi-element files — stride must come from the vertex block alone");
{
  // A second element AFTER vertex. Summing every `property` line in the file
  // would inflate the stride and make a valid file look truncated.
  const lines = [
    "ply",
    "format binary_little_endian 1.0",
    "element vertex 100",
    ...GAUSSIAN_PROPS.map((p) => `property float ${p}`),
    "element camera 1",
    "property float view_px",
    "property float view_py",
    "end_header",
  ];
  const h = Buffer.from(lines.join("\n") + "\n", "latin1");
  const stride = GAUSSIAN_PROPS.length * 4;
  const r = parsePlyHeader(h, h.length + 100 * stride + 8);
  ok("trailing element ignored for stride", r.ok && r.stride === stride);
  ok("vertex count still read correctly", r.ok && r.count === 100);
}

section("Degenerate declarations");
{
  const zero = ply({ count: 0 });
  const r1 = parsePlyHeader(zero, zero.length);
  ok("zero vertices refused", !r1.ok);
  ok("...and says the reconstruction produced nothing", !r1.ok && /nothing|zero/i.test(r1.reason));

  const noVerts = Buffer.from("ply\nformat binary_little_endian 1.0\nend_header\n", "latin1");
  ok("no vertex element refused", !parsePlyHeader(noVerts, 1000).ok);

  const listProp = Buffer.from(
    "ply\nformat binary_little_endian 1.0\nelement vertex 10\nproperty list uchar int idx\nend_header\n",
    "latin1",
  );
  ok("variable-length property refused", !parsePlyHeader(listProp, 10_000).ok);

  const weird = Buffer.from(
    "ply\nformat binary_little_endian 1.0\nelement vertex 10\nproperty quaternion x\nend_header\n",
    "latin1",
  );
  ok("unknown property type refused", !parsePlyHeader(weird, 10_000).ok);
}

section("Other formats are named rather than called corrupt");
{
  const spz = Buffer.concat([Buffer.from([0x4e, 0x47, 0x53, 0x50]), Buffer.alloc(64)]);
  const r1 = parsePlyHeader(spz, 5_000_000);
  ok("SPZ refused", !r1.ok);
  ok("...and named as SPZ", !r1.ok && /SPZ/i.test(r1.reason));

  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(64)]);
  ok("PNG named as an image", (() => { const r = parsePlyHeader(png, 5000); return !r.ok && /PNG/i.test(r.reason); })());

  const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64)]);
  ok("ZIP named as an archive", (() => { const r = parsePlyHeader(zip, 5000); return !r.ok && /ZIP/i.test(r.reason); })());
}

section("Every refusal is phrased for a person");
{
  const bad = [
    ply({ format: "ascii 1.0" }),
    ply({ props: ["x", "y", "z"], extra: "element face 5" }),
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(64)]),
    ply({ count: 0 }),
  ];
  let humane = 0;
  for (const b of bad) {
    const r = parsePlyHeader(b, b.length + 1000);
    // No stack traces, no jargon-only messages, and it ends like a sentence.
    if (!r.ok && r.reason.length > 20 && /[.!]$/.test(r.reason) && !/undefined|NaN|\[object/.test(r.reason)) {
      humane++;
    }
  }
  ok("all four refusals read as sentences", humane === bad.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// The other three formats
//
// From here on the subject is `detectSplatFormat`, not `parsePlyHeader`. The
// chain has to do two things at once: identify a format from bytes alone, and
// then hold each format to whatever standard that format actually permits —
// which for PLY is "prove it is complete" and for SPZ is "the header is sane
// and the payload is not checkable". Every section below says which it is.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The 16-byte SPZ header, built to Spark's SpzWriter layout.
 *
 * magic · version · numSplats · shDegree · fractionalBits · flags · reserved.
 */
function spzHeader(o: {
  version?: number;
  numSplats?: number;
  shDegree?: number;
  fractionalBits?: number;
  flags?: number;
  magic?: number;
} = {}): Buffer {
  const h = Buffer.alloc(16);
  h.writeUInt32LE(o.magic ?? 0x5053474e, 0); // "NGSP"
  h.writeUInt32LE(o.version ?? 3, 4);
  h.writeUInt32LE(o.numSplats ?? 1000, 8);
  h.writeUInt8(o.shDegree ?? 0, 12);
  h.writeUInt8(o.fractionalBits ?? 12, 13);
  h.writeUInt8(o.flags ?? 1, 14);
  h.writeUInt8(0, 15);
  return h;
}

/** Bytes per splat in a version-2/3 SPZ at SH degree 0: 9 + 1 + 3 + 3 + 4. */
const SPZ_SPLAT_BYTES = 20;

/**
 * A whole gzip-framed SPZ, the way an encoder writes one.
 *
 * The payload is filler rather than real quantised splats — nothing in the gate
 * decompresses past the header, which is the point the module header makes at
 * length. It is filled with a cheap PRNG rather than a constant on purpose:
 * quantised splat data barely compresses (measured, 1.16:1 on a real capture),
 * and a payload of one repeated byte would compress a thousand to one, which
 * makes it a test of a case no encoder produces. The pathological case gets its
 * own test below instead of being smuggled into every other one.
 *
 * Returned as `{ prefix, total }` because that is the shape the route hands the
 * detector: the first 64 KB, and the counted length of the whole file.
 */
function spzFile(
  o: Parameters<typeof spzHeader>[0] & { fill?: number } = {},
): { prefix: Buffer; total: number } {
  const header = spzHeader(o);
  const payload = Buffer.alloc((o?.numSplats ?? 1000) * SPZ_SPLAT_BYTES);
  if (o.fill === undefined) {
    let seed = 0x9e3779b9;
    for (let i = 0; i < payload.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      payload[i] = (seed >>> 24) & 0xff;
    }
  } else {
    payload.fill(o.fill);
  }
  const gz = gzipSync(Buffer.concat([header, payload]));
  return { prefix: gz.subarray(0, MAX_HEADER_BYTES), total: gz.length };
}

section("SPZ is accepted — the format the whole compressed path exists for");
{
  const { prefix, total } = spzFile({ numSplats: 400_000 });
  const r = detectSplatFormat(prefix, total);
  ok("gzip-framed SPZ accepted", r.ok);
  ok("identified as spz", r.ok && r.format === "spz");
  ok("splat count read out of the compressed header", r.ok && r.count === 400_000);
  ok("known to be a Gaussian splat", r.ok && r.gaussian);
  // The honest half: plyBounds cannot open this, and the viewer gets a default
  // camera. Reported rather than discovered.
  ok("not claimed to be measurable", r.ok && !r.measurable);
  ok("no warning on a good SPZ", r.ok && r.warning === null);

  // An SPZ stream with no gzip around it is still a valid SPZ stream.
  const raw = Buffer.concat([spzHeader({ numSplats: 10 }), Buffer.alloc(10 * SPZ_SPLAT_BYTES)]);
  const rr = detectSplatFormat(raw, raw.length);
  ok("un-gzipped SPZ also accepted", rr.ok && rr.format === "spz");

  /*
    The case that caught a real bug.

    An 8 MB payload of one repeated byte compresses about a thousand to one, so
    the few kilobytes the probe inflates expand enormously — and the probe's
    output ceiling was a round 1 MB, which threw, which made the whole file read
    as "a gzip archive, not a splat". The ceiling is now derived from DEFLATE's
    real maximum expansion, so it cannot be the reason anything is refused. No
    encoder writes a payload like this; the check is that a limit meant to bound
    memory never becomes a limit on what is accepted.
  */
  const compressible = spzFile({ numSplats: 400_000, fill: 0x41 });
  const rc = detectSplatFormat(compressible.prefix, compressible.total);
  ok("a wildly compressible payload does not blow the probe", rc.ok && rc.format === "spz");
}

section("SPZ refusals — every field in that header is checked");
{
  const v0 = spzFile({ version: 0 });
  const r1 = detectSplatFormat(v0.prefix, v0.total);
  ok("version 0 refused", !r1.ok);
  ok("...and the version is named in the sentence", !r1.ok && /version 0/i.test(r1.reason));

  const v9 = spzFile({ version: 9 });
  ok("version past 3 refused", !detectSplatFormat(v9.prefix, v9.total).ok);

  const empty = spzFile({ numSplats: 0 });
  const r2 = detectSplatFormat(empty.prefix, empty.total);
  ok("zero splats refused", !r2.ok);
  ok("...and says the reconstruction produced nothing", !r2.ok && /nothing|zero/i.test(r2.reason));

  const sh = spzFile({ shDegree: 9 });
  const r3 = detectSplatFormat(sh.prefix, sh.total);
  ok("impossible SH degree refused", !r3.ok);
  ok("...and says the format only goes to 3", !r3.ok && /degree 9/.test(r3.reason));

  const frac = spzFile({ fractionalBits: 30 });
  ok("30 fractional bits in a 24-bit position refused", !detectSplatFormat(frac.prefix, frac.total).ok);

  // A header and nothing else. The one completeness statement SPZ allows.
  const stub = gzipSync(spzHeader({ numSplats: 500_000 }));
  const r4 = detectSplatFormat(stub, 20);
  ok("a header with no file behind it refused", !r4.ok);

  // Truncated so hard the header itself does not survive decompression.
  const short = gzipSync(Buffer.from([0x4e, 0x47, 0x53, 0x50, 3, 0, 0, 0]));
  const r5 = detectSplatFormat(short, short.length);
  ok("SPZ cut off inside its own header refused", !r5.ok);
  ok("...and blamed on truncation", !r5.ok && /cut short|ends before/i.test(r5.reason));
}

section("A gzip that is not an SPZ is named, not mistaken for one");
{
  const gz = gzipSync(Buffer.from("this is a text file somebody compressed", "latin1"));
  const r = detectSplatFormat(gz, gz.length);
  ok("gzip archive refused", !r.ok);
  ok("...and named as a gzip archive", !r.ok && /gzip/i.test(r.reason));
  // The useful half of that sentence: what to do about it.
  ok("...and says an .spz is uploaded as-is", !r.ok && /already compressed/i.test(r.reason));
}

/**
 * A `.splat`: nothing but 32-byte records.
 *
 * 3 float32 position, 3 float32 scale, 4 uint8 RGBA, 4 uint8 quaternion. There
 * is no header to build, which is exactly why the detector's confidence in this
 * format is the lowest of the four.
 */
function splatFile(count: number, o: { position?: number; scale?: number } = {}): Buffer {
  const buf = Buffer.alloc(count * 32);
  for (let i = 0; i < count; i++) {
    const base = i * 32;
    buf.writeFloatLE(o.position ?? (i % 17) - 8, base);
    buf.writeFloatLE(o.position ?? (i % 11) - 5, base + 4);
    buf.writeFloatLE(o.position ?? (i % 23) - 11, base + 8);
    buf.writeFloatLE(o.scale ?? 0.02, base + 12);
    buf.writeFloatLE(o.scale ?? 0.03, base + 16);
    buf.writeFloatLE(o.scale ?? 0.01, base + 20);
    buf.writeUInt8(200, base + 24);
    buf.writeUInt8(180, base + 25);
    buf.writeUInt8(160, base + 26);
    buf.writeUInt8(240, base + 27);
    buf.writeUInt8(128, base + 28);
    buf.writeUInt8(128, base + 29);
    buf.writeUInt8(128, base + 30);
    buf.writeUInt8(255, base + 31);
  }
  return buf;
}

section("A .splat is accepted on structure, which is all it offers");
{
  const f = splatFile(5000);
  const r = detectSplatFormat(f.subarray(0, MAX_HEADER_BYTES), f.length);
  ok(".splat accepted", r.ok);
  ok("identified as splat", r.ok && r.format === "splat");
  // The count is DERIVED from the length, not declared. That is the only
  // number this format offers and it is exact.
  ok("count derived from the file length", r.ok && r.count === 5000);
  ok("not claimed to be measurable", r.ok && !r.measurable);

  // The prefix is only the first 2048 records; the rest is never seen.
  const big = splatFile(3000);
  const rb = detectSplatFormat(big.subarray(0, MAX_HEADER_BYTES), big.length);
  ok("count is right even when most of the file was never read", rb.ok && rb.count === 3000);
}

section(".splat refusals — the length rule is the whole gate");
{
  const f = splatFile(100);
  const odd = detectSplatFormat(f.subarray(0, MAX_HEADER_BYTES), f.length - 1);
  ok("a length that is not a multiple of 32 refused", !odd.ok);
  ok("...and told which formats this takes", !odd.ok && /\.ply|\.spz/i.test(odd.reason));

  // 32 bytes of zeros is a legal-length file and not a splat. Padding, or the
  // tail of something else that got cut.
  const zeros = Buffer.alloc(3200);
  ok("all-zero records refused", !detectSplatFormat(zeros, zeros.length).ok);

  // NaN positions come from a trainer that diverged. They are a multiple of 32
  // and they draw nothing.
  const nan = splatFile(100);
  nan.writeUInt32LE(0x7fc00000, 0);
  ok("NaN in the first position refused", !detectSplatFormat(nan.subarray(0, MAX_HEADER_BYTES), nan.length).ok);

  // Negative scale is not a splat: `.splat` stores scale linear, not logged.
  const negative = splatFile(100, { scale: -1 });
  ok("negative scale refused", !detectSplatFormat(negative.subarray(0, MAX_HEADER_BYTES), negative.length).ok);

  // Coordinates no scene occupies. This is what random bytes look like.
  const huge = splatFile(100, { position: 1e30 });
  ok("absurd coordinates refused", !detectSplatFormat(huge.subarray(0, MAX_HEADER_BYTES), huge.length).ok);
}

/**
 * A `.ksplat`, built to the layout in Spark's `decodeKsplat`.
 *
 * 4096-byte file header, then one 1024-byte record per section, then each
 * section's splat storage and buckets. Returns the prefix a route would keep
 * and the total size a COMPLETE file of this shape would have — which is the
 * pair that makes the truncation check testable without allocating it.
 */
function ksplatFile(o: {
  versionMajor?: number;
  versionMinor?: number;
  compressionLevel?: number;
  sections?: Array<{
    splatCount: number;
    maxSplatCount?: number;
    bucketSize?: number;
    bucketCount?: number;
    bucketStorageSizeBytes?: number;
    partialBuckets?: number;
    shDegree?: number;
  }>;
} = {}): { prefix: Buffer; total: number } {
  const sections = o.sections ?? [{ splatCount: 250_000 }];
  const level = o.compressionLevel ?? 1;
  const prefix = Buffer.alloc(4096 + sections.length * 1024);
  prefix.writeUInt8(o.versionMajor ?? 0, 0);
  prefix.writeUInt8(o.versionMinor ?? 1, 1);
  prefix.writeUInt32LE(sections.length, 4);
  prefix.writeUInt16LE(level, 20);

  const perSplat: Record<number, number> = { 0: 44, 1: 24, 2: 24 };
  const perSh: Record<number, number> = { 0: 4, 1: 2, 2: 1 };
  const shComponents: Record<number, number> = { 0: 0, 1: 9, 2: 24, 3: 45 };

  let storage = 0;
  sections.forEach((s, i) => {
    const base = 4096 + i * 1024;
    const maxSplatCount = s.maxSplatCount ?? s.splatCount;
    const bucketCount = s.bucketCount ?? 32;
    const bucketStorage = s.bucketStorageSizeBytes ?? 12;
    const partial = s.partialBuckets ?? 0;
    const shDegree = s.shDegree ?? 0;
    prefix.writeUInt32LE(s.splatCount, base + 0);
    prefix.writeUInt32LE(maxSplatCount, base + 4);
    prefix.writeUInt32LE(s.bucketSize ?? 256, base + 8);
    prefix.writeUInt32LE(bucketCount, base + 12);
    prefix.writeFloatLE(5, base + 16);
    prefix.writeUInt16LE(bucketStorage, base + 20);
    prefix.writeUInt32LE(32767, base + 24);
    prefix.writeUInt32LE(bucketCount - partial, base + 32);
    prefix.writeUInt32LE(partial, base + 36);
    prefix.writeUInt16LE(shDegree, base + 40);

    const bytesPerSplat = perSplat[level] + (shComponents[shDegree] ?? 0) * perSh[level];
    storage += bytesPerSplat * maxSplatCount + bucketStorage * bucketCount + partial * 4;
  });

  return { prefix, total: prefix.length + storage };
}

section("A .ksplat is accepted, and its declared size is checked exactly");
{
  const { prefix, total } = ksplatFile({ sections: [{ splatCount: 250_000 }] });
  const r = detectSplatFormat(prefix, total);
  ok(".ksplat accepted", r.ok);
  ok("identified as ksplat", r.ok && r.format === "ksplat");
  ok("splat count summed from the section table", r.ok && r.count === 250_000);
  ok("not claimed to be measurable", r.ok && !r.measurable);
  ok("no warning when the whole section table was read", r.ok && r.warning === null);

  const multi = ksplatFile({
    sections: [{ splatCount: 100 }, { splatCount: 250, shDegree: 2 }, { splatCount: 40 }],
  });
  const rm = detectSplatFormat(multi.prefix, multi.total);
  ok("three sections summed", rm.ok && rm.count === 390);
  // Each section carries its own SH degree, so a stride taken from the first
  // one would make this file look truncated.
  ok("per-section SH degree used for the size", rm.ok);

  // Every compression level the readers know.
  for (const level of [0, 1, 2]) {
    const c = ksplatFile({ compressionLevel: level, sections: [{ splatCount: 1000 }] });
    ok(`compression level ${level} accepted`, detectSplatFormat(c.prefix, c.total).ok);
  }
}

section(".ksplat refusals — this is the compressed format that CAN be checked");
{
  const { prefix, total } = ksplatFile({ sections: [{ splatCount: 250_000 }] });
  const half = detectSplatFormat(prefix, Math.floor(total / 2));
  ok("half-arrived .ksplat refused", !half.ok);
  ok("...and says it is truncated", !half.ok && /truncated/i.test(half.reason));
  ok("...and reports both sizes", !half.ok && (half.reason.match(/MB/g) ?? []).length >= 2);
  ok("one byte short refused", !detectSplatFormat(prefix, total - 1).ok);
  ok("exactly enough accepted", detectSplatFormat(prefix, total).ok);

  const level = ksplatFile({ compressionLevel: 5, sections: [{ splatCount: 10 }] });
  const rl = detectSplatFormat(level.prefix, level.total);
  // Level 5 fails the signature test, so this falls through the chain rather
  // than being owned by the ksplat reader — either way it must not be stored.
  ok("unknown compression level not accepted as a ksplat", !rl.ok || rl.format !== "ksplat");

  const contradiction = ksplatFile({ sections: [{ splatCount: 900, maxSplatCount: 100 }] });
  const rc = detectSplatFormat(contradiction.prefix, contradiction.total);
  ok("a section holding more splats than it has room for refused", !rc.ok);
  ok("...and says the header contradicts itself", !rc.ok && /contradicts/i.test(rc.reason));

  const empty = ksplatFile({ sections: [{ splatCount: 0, maxSplatCount: 0, bucketCount: 0 }] });
  const re = detectSplatFormat(empty.prefix, empty.total);
  ok("zero splats refused", !re.ok);

  const badSh = ksplatFile({ sections: [{ splatCount: 10, shDegree: 7 }] });
  ok("impossible SH degree refused", !detectSplatFormat(badSh.prefix, badSh.total).ok);

  const zeroBuckets = ksplatFile({ sections: [{ splatCount: 10, bucketSize: 0, bucketCount: 4 }] });
  ok("buckets of zero size refused", !detectSplatFormat(zeroBuckets.prefix, zeroBuckets.total).ok);
}

section("A .ksplat with more sections than the prefix reaches is honest about it");
{
  // 60 sections fit in the 64 KB the route keeps. 200 do not.
  const many = ksplatFile({
    sections: Array.from({ length: 200 }, () => ({ splatCount: 1000 })),
  });
  const r = detectSplatFormat(many.prefix.subarray(0, MAX_HEADER_BYTES), many.total);
  ok("accepted rather than refused for being unusual", r.ok);
  ok("count reported as unknown, not as a partial sum", r.ok && r.count === null);
  ok("warning says the sections were not all verified", r.ok && !!r.warning && /not verified/i.test(r.warning));
}

section("The chain: one format never gets mistaken for another");
{
  // Every fixture, through the one entry point, checked for the right label.
  const plyBytes = ply({ count: 100 });
  const plyTotal = plyBytes.length + 100 * GAUSSIAN_PROPS.length * 4;
  const spz = spzFile({ numSplats: 100 });
  const ks = ksplatFile({ sections: [{ splatCount: 100 }] });
  const sp = splatFile(100);

  const rPly = detectSplatFormat(plyBytes, plyTotal);
  const rSpz = detectSplatFormat(spz.prefix, spz.total);
  const rKs = detectSplatFormat(ks.prefix, ks.total);
  const rSp = detectSplatFormat(sp, sp.length);

  ok("PLY labelled ply", rPly.ok && rPly.format === "ply");
  ok("SPZ labelled spz", rSpz.ok && rSpz.format === "spz");
  ok("KSPLAT labelled ksplat", rKs.ok && rKs.format === "ksplat");
  ok("SPLAT labelled splat", rSp.ok && rSp.format === "splat");

  /*
    The one that matters most for storage.

    The route names the stored file from the DETECTED format, never from what
    the sender called it — so a `.splat` that is 4096-plus bytes and looks
    faintly like a ksplat header must not be stored under the wrong extension,
    because the renderer picks its decoder from the URL.
  */
  ok(
    "every accepted format maps to an extension the store knows",
    [rPly, rSpz, rKs, rSp].every((r) => r.ok && SPLAT_EXTENSIONS.includes(`.${r.format}`)),
  );

  // A PLY is not 32-byte-aligned by luck of the draw, and a splat does not
  // start with "ply" — but the assertion is that the chain ORDER guarantees it
  // rather than that the fixtures happened to differ.
  const alignedPly = ply({ count: 100 });
  ok(
    "a PLY whose length divides by 32 is still a PLY",
    (() => {
      const total = Math.ceil(plyTotal / 32) * 32;
      const r = detectSplatFormat(alignedPly, total);
      return r.ok && r.format === "ply";
    })(),
  );
}

section("Formats the app does not store are refused by name");
{
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(1020)]);
  const r1 = detectSplatFormat(png, 1024);
  ok("PNG refused", !r1.ok);
  ok("...and named as an image", !r1.ok && /PNG/i.test(r1.reason));

  // PCSOGS arrives as a zip, and this endpoint deliberately does not take it.
  const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(1020)]);
  const r2 = detectSplatFormat(zip, 1024);
  ok("ZIP refused", !r2.ok);
  ok("...and named as an archive", !r2.ok && /ZIP/i.test(r2.reason));

  const mp4 = Buffer.concat([
    Buffer.from([0, 0, 0, 0x20]),
    Buffer.from("ftypisom", "latin1"),
    Buffer.alloc(1012),
  ]);
  const r3 = detectSplatFormat(mp4, 50_000_000);
  ok("an mp4 refused", !r3.ok);
  ok("...and identified as a video", !r3.ok && /video/i.test(r3.reason));

  const empty = detectSplatFormat(Buffer.alloc(0), 0);
  ok("an empty file refused", !empty.ok);

  // Nothing recognisable at all: the refusal still has to list what IS taken.
  const noise = Buffer.alloc(1000);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 37 + 11) & 0xff;
  const r4 = detectSplatFormat(noise, 1000);
  ok("unrecognisable bytes refused", !r4.ok);
  ok("...and the four formats are named", !r4.ok && /\.ply.*\.spz.*\.splat.*\.ksplat/i.test(r4.reason));
}

section("Every new refusal is phrased for a person");
{
  const spzBad = spzFile({ version: 0 });
  const ksBad = ksplatFile({ sections: [{ splatCount: 900, maxSplatCount: 100 }] });
  const reasons = [
    detectSplatFormat(spzBad.prefix, spzBad.total),
    detectSplatFormat(ksBad.prefix, ksBad.total),
    detectSplatFormat(gzipSync(Buffer.from("hello")), 40),
    detectSplatFormat(Buffer.alloc(3200), 3200),
  ];
  let humane = 0;
  for (const r of reasons) {
    if (!r.ok && r.reason.length > 20 && /[.!]$/.test(r.reason) && !/undefined|NaN|\[object/.test(r.reason)) {
      humane++;
    }
  }
  ok("all four refusals read as sentences", humane === reasons.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// Real files
// ─────────────────────────────────────────────────────────────────────────────

section("The .ply files actually committed to this repo");
{
  let plys: string[] = [];
  try {
    plys = readdirSync(SPLAT_DIR).filter((n) => n.endsWith(".ply"));
  } catch {
    // Nothing to say if the directory is not there; the count check below fails
    // loudly rather than the section silently passing on zero files.
  }
  ok("there are real .ply captures to check against", plys.length > 0);

  let accepted = 0;
  let gaussian = 0;
  let measurable = 0;
  for (const name of plys) {
    const file = path.join(SPLAT_DIR, name);
    const size = statSync(file).size;
    const buf = Buffer.alloc(Math.min(MAX_HEADER_BYTES, size));
    const fd = openSync(file, "r");
    try {
      readSync(fd, buf, 0, buf.length, 0);
    } finally {
      closeSync(fd);
    }
    // The real bytes and the real length — the same two arguments the route
    // passes, from a file nobody constructed for this test.
    const r = detectSplatFormat(buf, size);
    if (r.ok && r.format === "ply") accepted++;
    if (r.ok && r.gaussian) gaussian++;
    if (r.ok && r.measurable) measurable++;
    if (!r.ok) console.log(`       ${name}: ${r.reason}`);
  }
  ok("every committed capture is accepted", accepted === plys.length);
  ok("every one is recognised as a Gaussian splat", gaussian === plys.length);
  ok("every one is measurable, so the viewer can frame it", measurable === plys.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// The limits
//
// Read-only against the real public/mock/splats. Nothing below writes a file.
// ─────────────────────────────────────────────────────────────────────────────

/** A request that looks like it came from one particular client. */
function from(address: string): Request {
  return new Request("http://localhost:3000/api/splat/upload", {
    method: "POST",
    headers: { "x-forwarded-for": address },
  });
}

section("The disk budget counts uploads and not the scenery");
{
  const entries = readdirSync(SPLAT_DIR);
  let expected = 0;
  for (const name of entries) {
    const isUpload =
      name.startsWith("splat_") && SPLAT_EXTENSIONS.includes(path.extname(name).toLowerCase());
    const isTemp = name.startsWith(".uploading-") && name.endsWith(".tmp");
    if (isUpload || isTemp) expected += statSync(path.join(SPLAT_DIR, name)).size;
  }
  const everything = entries.reduce((n, name) => {
    try {
      return n + statSync(path.join(SPLAT_DIR, name)).size;
    } catch {
      return n;
    }
  }, 0);

  ok("counted from the real directory", storedUploadBytes() === expected);
  // The authored mock captures are committed scenery. Counting them would spend
  // part of the budget before anyone uploads anything.
  ok("the committed mock captures are excluded", expected < everything);
}

section("The budget arithmetic, where every branch is reachable");
{
  ok("a normal upload fits", budgetVerdict(50 * 1_048_576, 200 * 1_048_576, 0) === "ok");
  ok("over the per-file ceiling", budgetVerdict(MAX_UPLOAD_BYTES + 1, 0, 0) === "too-large");
  ok("exactly the ceiling is allowed", budgetVerdict(MAX_UPLOAD_BYTES, 0, 0) === "ok");
  ok(
    "a nearly full store refuses the next upload",
    budgetVerdict(1_048_576, SPLAT_STORE_BUDGET_BYTES, 0) === "no-space",
  );
  ok("exactly the budget is allowed", budgetVerdict(1024, SPLAT_STORE_BUDGET_BYTES - 1024, 0) === "ok");
  /*
    The case a single-upload check cannot see.

    Two streams that each fit are not two streams that fit together. Without the
    in-flight term, three concurrent uploads are each told there is room for the
    same last gigabyte and the disk goes over.
  */
  ok(
    "another upload in flight is counted against this one",
    budgetVerdict(1_048_576, SPLAT_STORE_BUDGET_BYTES - 1_048_576, 1_048_576) === "no-space",
  );
  ok(
    "...and the same upload alone would have been fine",
    budgetVerdict(1_048_576, SPLAT_STORE_BUDGET_BYTES - 1_048_576, 0) === "ok",
  );
}

section("The rate limit — what stands in for an account today");
{
  resetUploadLimitsForTest();
  const slots = [];
  let refused: { status: number; error: string } | null = null;
  for (let i = 0; i < RATE_LIMIT_UPLOADS + 3; i++) {
    const s = openUploadSlot(from("198.51.100.7"));
    if (s.ok) {
      s.close(); // Sequential, so the concurrency cap is not what is being tested.
      slots.push(s);
    } else if (!refused) {
      refused = { status: s.status, error: s.error };
    }
  }
  ok(`exactly ${RATE_LIMIT_UPLOADS} uploads let through`, slots.length === RATE_LIMIT_UPLOADS);
  ok("the next one is refused", refused !== null);
  ok("...with 429", refused?.status === 429);
  ok("...and a sentence, not a code", !!refused && /wait a few minutes/i.test(refused.error));

  // A different client is a different bucket. Sharing one would mean the first
  // person to run a loop locks everybody else out.
  const other = openUploadSlot(from("203.0.113.9"));
  ok("a different address is unaffected", other.ok);
  if (other.ok) other.close();

  // Time passing clears it. Verified by asking the future rather than sleeping.
  const later = openUploadSlot(from("198.51.100.7"), Date.now() + 11 * 60 * 1000);
  ok("the window expires", later.ok);
  if (later.ok) later.close();
}

section("The concurrency cap, and that a slot is actually released");
{
  resetUploadLimitsForTest();
  const held = [];
  for (let i = 0; i < MAX_CONCURRENT_UPLOADS; i++) {
    const s = openUploadSlot(from(`192.0.2.${i}`));
    if (s.ok) held.push(s);
  }
  ok(`${MAX_CONCURRENT_UPLOADS} uploads may be in flight`, held.length === MAX_CONCURRENT_UPLOADS);

  const overflow = openUploadSlot(from("192.0.2.99"));
  ok("one more is refused", !overflow.ok);
  ok("...with 503, because it will be untrue in a minute", !overflow.ok && overflow.status === 503);

  held[0].close();
  const afterRelease = openUploadSlot(from("192.0.2.98"));
  ok("closing a slot frees it", afterRelease.ok);
  if (afterRelease.ok) afterRelease.close();

  // Double close is what a `finally` on a path that already returned looks like.
  held[0].close();
  for (const s of held.slice(1)) s.close();
  const drained = openUploadSlot(from("192.0.2.97"));
  ok("a double close does not corrupt the count", drained.ok);
  if (drained.ok) drained.close();
  resetUploadLimitsForTest();
}

section("An in-flight upload's bytes count against everyone else's budget");
{
  resetUploadLimitsForTest();
  const a = openUploadSlot(from("198.51.100.1"));
  const b = openUploadSlot(from("198.51.100.2"));
  ok("two uploads open", a.ok && b.ok);
  if (a.ok && b.ok) {
    ok("a small chunk is fine", a.accept(1_048_576) === "ok");
    ok("the per-file ceiling still applies", a.accept(MAX_UPLOAD_BYTES + 1) === "too-large");
    // b sees what a has written, because `accept` sums the live in-flight set.
    ok("the other upload is still admitted", b.accept(1024) === "ok");
    a.close();
    b.close();
  }
  resetUploadLimitsForTest();
}

section("Temp files: unique names, and a sweep that leaves the store alone");
{
  const before = readdirSync(SPLAT_DIR).sort();

  const names = new Set<string>();
  for (let i = 0; i < 2000; i++) names.add(tempUploadPath());
  ok("2000 temp paths, no collisions", names.size === 2000);
  ok("all of them inside the served directory", [...names].every((p) => path.dirname(p) === SPLAT_DIR));
  ok("all of them hidden and .tmp", [...names].every((p) => path.basename(p).startsWith(".uploading-") && p.endsWith(".tmp")));
  // A temp name is not one of the extensions the store looks for, so an upload
  // in flight can never be adopted as a finished capture.
  ok(
    "a temp name is not mistakable for a stored splat",
    [...names].every((p) => !SPLAT_EXTENSIONS.some((e) => p.endsWith(e))),
  );
  ok("naming a path does not create it", readdirSync(SPLAT_DIR).length === before.length);

  ok("nothing stale to sweep", sweepStaleTemps() === 0);
  ok("and the sweep left every real capture alone", readdirSync(SPLAT_DIR).sort().join("|") === before.join("|"));
}

section("Who an upload is counted against — the seam authentication replaces");
{
  ok(
    "x-forwarded-for, first hop only",
    identifyUploader(new Request("http://x/", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } })).key === "1.2.3.4",
  );
  ok(
    "x-real-ip when there is no forwarding chain",
    identifyUploader(new Request("http://x/", { headers: { "x-real-ip": "9.9.9.9" } })).key === "9.9.9.9",
  );
  const bare = identifyUploader(new Request("http://x/"));
  ok("a local dev server shares one bucket", bare.key === "local");
  // Reported rather than hidden, so a refusal can say how coarse the key is.
  ok("...and says so, rather than pretending to know who it is", bare.kind === "shared");
}

section("The picker and the store agree about what is accepted");
{
  ok("four formats", SPLAT_EXTENSIONS.length === 4);
  ok("the accept attribute is the same list", SPLAT_ACCEPT_ATTRIBUTE === SPLAT_EXTENSIONS.join(","));
  ok("every one is offered", SPLAT_EXTENSIONS.every((e) => SPLAT_ACCEPT_ATTRIBUTE.includes(e)));
  ok("the client check accepts a .spz", hasSplatExtension("walk.spz"));
  ok("...and is case-insensitive, because Windows", hasSplatExtension("WALK.PLY"));
  ok("...and refuses a video", !hasSplatExtension("walk.mp4"));
  ok("...and is not fooled by a name that merely contains one", !hasSplatExtension("ply.zip"));

  /*
    The suffix trap.

    `.ksplat` ends with the letters of `splat`, so anything that classifies a
    filename with `endsWith` in a loop is right only while this list happens to
    put ksplat first. Every directory scan uses `path.extname` instead; this is
    the check that the two are not the same thing.
  */
  ok("a .ksplat is offered too", hasSplatExtension("walk.ksplat"));
  ok("...and extname tells it apart from a .splat", path.extname("walk.ksplat") === ".ksplat");
  ok(
    "...where a suffix test would not",
    "walk.ksplat".endsWith("splat") && !SPLAT_EXTENSIONS.includes("splat"),
  );
}

console.log(`\n${passed} ok, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("The upload gate holds.");
