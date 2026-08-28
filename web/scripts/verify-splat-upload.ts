/**
 * Does the upload gate accept what renders and refuse what does not?
 *
 * The question this answers is narrow and it is the one that matters: a file
 * that gets past `parsePlyHeader` is written into the SERVED directory, and
 * from that moment `getSplatJob` calls it ready and hands the viewer its URL.
 * There is no later checkpoint. So a false accept is not a bad error message —
 * it is a capture the app promises and cannot draw, and the user finds out by
 * staring at an empty scene.
 *
 * The cases below are the ones people actually upload by mistake, in rough
 * order of how often: a mesh from Blender, an ASCII export, a half-finished
 * download, and the video they meant to reconstruct in the first place.
 *
 * Runs DOM-free under tsx, which is why lib/splat/plyHeader.ts carries no
 * `server-only` guard — see the note at the bottom of its header.
 *
 *     npx tsx scripts/verify-splat-upload.ts
 */
import { parsePlyHeader } from "../lib/splat/plyHeader";

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

console.log(`\n${passed} ok, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("The upload gate holds.");
