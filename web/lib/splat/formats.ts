/**
 * Which splat format is this, decided by the bytes rather than by the name.
 *
 * The gate on /api/splat/upload used to read one format. `lib/splat/renderer.ts`
 * has always said what the engines actually open —
 *
 *   Spark 2.1 (@sparkjsdev/spark)   ply · spz · splat · ksplat · pcsogs · rad
 *   mkkellogg 0.4.7                 ply · splat · ksplat
 *
 * — and the upload path accepted `.ply` alone, so a Luma `.splat` and a
 * compressed `.spz` (about a third the size of the PLY it came from, which is
 * the whole reason SPZ exists) were refused with a sentence telling the person
 * their file "is not a PLY". True, and useless: the app can draw it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE BYTES AND NOT THE EXTENSION
 *
 * Same reason plyHeader.ts reads the header: an extension is a claim by whoever
 * named the file, and this endpoint takes files from software we did not write
 * on machines we have never seen. Renaming `walk.ply` to `walk.spz` must not
 * change what happens, in either direction. So the chain below dispatches on
 * magic bytes and on structure, and the declared filename is never consulted.
 *
 * Spark's own `getSplatFileType` does the same thing and is the reference this
 * follows: `ply` for the ASCII magic, gzip-then-NGSP for SPZ. Where it stops,
 * so does the honesty of anything downstream — see the next section.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT EACH FORMAT LETS US CHECK, AND WHAT IT DOES NOT
 *
 * These are not equally checkable, and pretending they are would be the same
 * class of lie the header check exists to prevent. Written out plainly:
 *
 *   PLY     Fully checked. plyHeader.ts parses the text header and can prove
 *           truncation from `dataOffset + count * stride` against the real byte
 *           count. ASCII, big-endian, meshes and point clouds are all named
 *           specifically. Nothing here weakens that — PLY still goes straight
 *           to `parsePlyHeader` and its answer is final.
 *
 *   SPZ     Header checked, payload NOT. The 16-byte header is real and
 *           readable (magic, version, splat count, SH degree), and every field
 *           in it is validated. The payload is DEFLATE inside gzip, so the only
 *           way to prove it holds `numSplats` splats is to decompress the whole
 *           file — hundreds of megabytes of work inside a request handler, to
 *           answer a question the renderer answers for free a second later.
 *           The gzip ISIZE trailer would give the uncompressed length cheaply
 *           and is deliberately not used: it is per-member, so a multi-member
 *           stream (legal gzip, and something a proxy or another encoder can
 *           produce) would read as short and get a valid file refused. A
 *           truncated SPZ therefore gets through this gate. It fails at load
 *           with a decompression error rather than rendering as a wrong scene,
 *           which is the mild end of the failure and is why that is tolerable.
 *
 *   KSPLAT  Header and section table checked, splat data NOT read. The format
 *           declares its own storage size — a 4096-byte file header, a
 *           1024-byte record per section, then each section's buckets and
 *           splats — so the total size a complete file must have is
 *           COMPUTABLE, and truncation is caught exactly. The one gap: that
 *           arithmetic needs the section table, and only the first 64 KB of the
 *           upload is kept, which covers 60 sections. A file declaring more
 *           than that is accepted on its file header alone and SAYS SO in the
 *           warning rather than quietly.
 *
 *   RAD     MAGIC ONLY, and it is the least checked format here. RAD is World
 *           Labs' streaming/LOD format: a "RAD0" magic, then a header that
 *           Spark decodes in wasm (`decode_rad_header`, handed the first 1 MB
 *           of the file). That layout is not published and is not readable from
 *           TypeScript without shipping the wasm into this request handler, so
 *           the only fact established here is those four bytes and a plausible
 *           length. Truncation is NOT caught. A half-downloaded .rad reaches
 *           the viewer and fails there.
 *
 *           Accepted anyway, on the same reasoning as SPZ: the failure is a
 *           loud one at load rather than a wrong scene quietly drawn, and the
 *           format is what makes a million-splat capture openable at all. If
 *           the header layout is ever published, this becomes checkable and
 *           this paragraph should shrink.
 *
 *   SPLAT   Structure only, and it is the weakest of the five BY CONSTRUCTION.
 *           The antimatter15/Luma `.splat` format has no magic number and no
 *           header at all: it is a bare array of 32-byte records (3 float32
 *           position, 3 float32 scale, 4 uint8 RGBA, 4 uint8 quaternion). So
 *           the only structural facts available are that the length is a
 *           non-zero multiple of 32 and that the leading records read as
 *           plausible numbers. A file that is neither PLY, SPZ nor KSPLAT, is a
 *           multiple of 32 bytes long, and whose first floats are finite will
 *           be taken for a `.splat` — and some of those will be something else
 *           entirely. That cannot be fixed from inside this function; it is a
 *           property of a format that carries no self-description. It is last
 *           in the chain for exactly that reason, so every format that CAN
 *           identify itself gets to do so first.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOT server-only, same as plyHeader.ts
 *
 * Pure arithmetic over bytes — no filesystem, no secrets — and
 * scripts/verify-splat-upload.ts imports it directly under `tsx`. A guard would
 * buy nothing and cost the coverage.
 */
import { constants as zlibConstants, gunzipSync } from "node:zlib";

import { SPLAT_EXTENSIONS, SPLAT_FORMATS, type SplatFormat } from "./extensions";
import { MAX_HEADER_BYTES, parsePlyHeader, sniffForeignFormat } from "./plyHeader";

/*
  The list itself lives in ./extensions.ts and not here, because the file picker
  in components/live/SplatUploadPanel.tsx needs it too and this module imports
  `node:zlib` — which a client bundle cannot resolve. Re-exported so a server
  caller still needs one import for the whole vocabulary.
*/
export { MAX_HEADER_BYTES, SPLAT_EXTENSIONS, SPLAT_FORMATS };
export type { SplatFormat };

export interface SplatFileOk {
  ok: true;
  format: SplatFormat;
  /**
   * Gaussians the file declares, or null when the format will not say.
   *
   * Null is a real answer — a `.ksplat` whose section table runs past the kept
   * prefix cannot be counted without reading the rest of the file. Reporting 0
   * there would be read as "empty", which is a different and wrong sentence.
   */
  count: number | null;
  /**
   * Confirmed to carry Gaussian splat properties.
   *
   * True for SPZ, KSPLAT and SPLAT by construction — those formats cannot
   * express anything else, so a valid one IS a splat. For PLY it is the
   * property-name test in plyHeader.ts, which is where a coloured point cloud
   * gets caught and warned about.
   */
  gaussian: boolean;
  /**
   * lib/video/plyBounds.ts can measure this file and derive a camera from it.
   *
   * Only ever true for an all-float PLY. That module reads raw float offsets
   * out of a PLY body and has no idea what an SPZ is; the honest consequence is
   * that the other three formats get the viewer's default camera. Surfaced here
   * rather than discovered later by a null return, so a caller can say so.
   */
  measurable: boolean;
  /** Present and human-readable when something is odd but not fatal. */
  warning: string | null;
}

export interface SplatFileBad {
  ok: false;
  /** Phrased for the person who chose the file, not for a log. */
  reason: string;
}

export type SplatFileResult = SplatFileOk | SplatFileBad;

// ─────────────────────────────────────────────────────────────────────────────
// SPZ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * "NGSP" — Niantic Gaussian SPlat — read as a little-endian uint32.
 *
 * The same constant Spark exports as SPZ_MAGIC (1347635022). Written out as
 * bytes here because bytes are what it is compared against.
 */
const SPZ_MAGIC = [0x4e, 0x47, 0x53, 0x50] as const;

/** Bytes of the SPZ header, every field of which is validated below. */
const SPZ_HEADER_BYTES = 16;

/**
 * Versions any renderer in this repo will open.
 *
 * Spark's SpzReader refuses outside 1–3 and its writer emits 3. Accepting a
 * version it will refuse would mean storing a file the app cannot draw, which
 * is the exact failure this module exists to prevent.
 */
const SPZ_MIN_VERSION = 1;
const SPZ_MAX_VERSION = 3;

/**
 * How much of a gzip stream to hand the inflater.
 *
 * Only the first 16 uncompressed bytes are wanted, so the input is what gets
 * bounded: DEFLATE's worst-case expansion is a hair over 1032:1, which makes
 * "how many bytes go in" the only real control over how much memory a hostile
 * file can make this handler allocate. 4 KB is far more than any encoder needs
 * to emit its first block — measured on a Spark-written SPZ, 256 compressed
 * bytes already yield 218 uncompressed — and caps the worst case around four
 * megabytes.
 *
 * The output limit is DERIVED from that rather than picked, and the difference
 * is not cosmetic. A round number here was 1 MB, and a legitimately
 * compressible SPZ payload inflated past it: `gunzipSync` threw, the probe
 * returned nothing, and a perfectly good file was refused as "a gzip archive,
 * not a splat". A limit low enough to reject real files is not a safety
 * measure, it is a bug wearing one. 1100 is above DEFLATE's true maximum, so
 * this can bound the memory without ever being the reason something is refused.
 */
const GZIP_PROBE_INPUT_BYTES = 4 * 1024;
const GZIP_PROBE_OUTPUT_LIMIT = GZIP_PROBE_INPUT_BYTES * 1100;

/**
 * Inflate just enough of a gzip stream to look at what is inside it.
 *
 * `Z_SYNC_FLUSH` is the whole trick: the default finish flush treats a
 * deliberately truncated stream as a corrupt one and throws, so without it a
 * PREFIX of a perfectly valid gzip file is indistinguishable from garbage.
 * Returns an empty buffer rather than throwing, because "could not be inflated"
 * is an answer this chain handles and not an exception it wants to carry.
 */
function inflatePrefix(bytes: Uint8Array): Buffer {
  try {
    return gunzipSync(bytes.subarray(0, GZIP_PROBE_INPUT_BYTES), {
      finishFlush: zlibConstants.Z_SYNC_FLUSH,
      maxOutputLength: GZIP_PROBE_OUTPUT_LIMIT,
    });
  } catch {
    // Not gzip after all, or a bomb that blew the output limit. Either way
    // there is nothing here to identify.
    return Buffer.alloc(0);
  }
}

function startsWithSpzMagic(b: Uint8Array): boolean {
  return (
    b.length >= 4 &&
    b[0] === SPZ_MAGIC[0] &&
    b[1] === SPZ_MAGIC[1] &&
    b[2] === SPZ_MAGIC[2] &&
    b[3] === SPZ_MAGIC[3]
  );
}

/** The smallest a gzip member can be: 10-byte header, 8-byte trailer. */
const GZIP_FRAMING_BYTES = 18;

/**
 * Read and check the 16-byte SPZ header.
 *
 * `header` is the UNCOMPRESSED head of the stream — the caller has already
 * inflated it if it needed inflating, because a gzip-framed SPZ (what every
 * encoder actually writes) and a raw one land here identically.
 */
function readSpzHeader(header: Buffer, totalBytes: number): SplatFileResult {
  if (header.length < SPZ_HEADER_BYTES) {
    return {
      ok: false,
      reason:
        `That SPZ ends before its header does — ${header.length} of ${SPZ_HEADER_BYTES} bytes are ` +
        "there. The export or the transfer was cut short.",
    };
  }

  const version = header.readUInt32LE(4);
  if (version < SPZ_MIN_VERSION || version > SPZ_MAX_VERSION) {
    return {
      ok: false,
      reason:
        `That SPZ says it is version ${version}, and the renderers here read versions ` +
        `${SPZ_MIN_VERSION} to ${SPZ_MAX_VERSION}. Re-export it from a current tool.`,
    };
  }

  const numSplats = header.readUInt32LE(8);
  if (numSplats === 0) {
    return {
      ok: false,
      reason: "That SPZ contains zero splats — the reconstruction produced nothing.",
    };
  }

  const shDegree = header.readUInt8(12);
  if (shDegree > 3) {
    return {
      ok: false,
      reason:
        `That SPZ declares spherical harmonics of degree ${shDegree}; the format only goes to 3. ` +
        "That is not a header a splat encoder wrote.",
    };
  }

  // Positions are 24-bit fixed point, so more than 24 fractional bits leaves no
  // integer part at all — every splat would sit within a unit of the origin.
  const fractionalBits = header.readUInt8(13);
  if (fractionalBits > 24) {
    return {
      ok: false,
      reason:
        `That SPZ declares ${fractionalBits} fractional bits in a 24-bit position, which cannot be ` +
        "right. The header is corrupt.",
    };
  }

  /*
    The smallest a complete file could possibly be.

    NOT a completeness check — the header of this file says why the payload is
    not verified — but it does catch a header handed over with nothing behind
    it, because gzip cannot fit numSplats splats into fewer bytes than its own
    framing takes. Deliberately loose: DEFLATE over quantised splat data reaches
    only about 1.16:1 in practice (measured: 8,000,016 bytes down to 6,901,373
    on a real 400k-splat capture), and the point of a floor is that it cannot be
    tripped legitimately.
  */
  if (totalBytes < GZIP_FRAMING_BYTES + SPZ_HEADER_BYTES) {
    return {
      ok: false,
      reason:
        `That SPZ declares ${numSplats.toLocaleString()} splats but the whole file is ` +
        `${totalBytes} bytes. There is no data behind the header.`,
    };
  }

  return {
    ok: true,
    format: "spz",
    count: numSplats,
    // An SPZ cannot hold anything but Gaussians. There is no point-cloud case
    // to warn about the way there is for PLY.
    gaussian: true,
    measurable: false,
    warning: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// KSPLAT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The layout, read out of Spark's own `decodeKsplat` rather than guessed at.
 *
 * File header is 4096 bytes; then `maxSectionCount` section records of 1024
 * bytes each; then, per section, its bucket storage followed by its splat data.
 * Every one of those sizes is declared in a header, which is what makes ksplat
 * the one compressed format here whose completeness CAN be proven from a prefix.
 */
const KSPLAT_HEADER_BYTES = 4096;
const KSPLAT_SECTION_BYTES = 1024;

/** Per compression level: bytes for one splat record, and for one SH component. */
const KSPLAT_COMPRESSION: Record<number, { splat: number; sh: number }> = {
  // centre + scale + rotation + colour
  0: { splat: 12 + 12 + 16 + 4, sh: 4 },
  1: { splat: 6 + 6 + 8 + 4, sh: 2 },
  2: { splat: 6 + 6 + 8 + 4, sh: 1 },
};

/** SH components stored per splat at each degree. Spark's table, verbatim. */
const KSPLAT_SH_COMPONENTS: Record<number, number> = { 0: 0, 1: 9, 2: 24, 3: 45 };

/**
 * How many sections the kept prefix can actually reach.
 *
 * 64 KB of prefix, minus the 4 KB file header, divided by the 1 KB section
 * record. Sixty. The mkkellogg tool writes one section per input file, so this
 * is not a limit anyone meets by accident — and a file that exceeds it is
 * accepted with a warning rather than refused, because "your file has an
 * unusual number of sections" is not a reason to make someone lose it.
 */
const KSPLAT_SECTIONS_IN_PREFIX = Math.floor(
  (MAX_HEADER_BYTES - KSPLAT_HEADER_BYTES) / KSPLAT_SECTION_BYTES,
);

/**
 * Does this look like a ksplat at all?
 *
 * KSPLAT has no magic number either — its first byte is a version major that
 * happens to be zero. So the signature is the CONJUNCTION of several fields
 * being in range at once, which a `.splat`'s leading float32 will essentially
 * never satisfy: a splat's first byte is the low byte of an X coordinate, and
 * its second would have to land in 1–15 while a plausible section count and a
 * compression level of 0–2 also fell into place.
 *
 * Kept separate from validation on purpose. Matching the signature means this
 * function OWNS the file: its refusals are final and the chain does not fall
 * through to `.splat`, because a truncated ksplat whose length happens to be a
 * multiple of 32 would otherwise be quietly re-labelled as a valid splat and
 * stored as a capture nothing can draw.
 */
function looksLikeKsplat(prefix: Uint8Array, totalBytes: number): boolean {
  if (prefix.length < 44 || totalBytes < KSPLAT_HEADER_BYTES) return false;
  const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
  if (view.getUint8(0) !== 0) return false;
  const versionMinor = view.getUint8(1);
  if (versionMinor < 1 || versionMinor > 15) return false;
  const maxSectionCount = view.getUint32(4, true);
  if (maxSectionCount < 1 || maxSectionCount > 4096) return false;
  if (view.getUint16(20, true) > 2) return false;
  return totalBytes >= KSPLAT_HEADER_BYTES + maxSectionCount * KSPLAT_SECTION_BYTES;
}

function readKsplatHeader(prefix: Uint8Array, totalBytes: number): SplatFileResult {
  const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
  const versionMajor = view.getUint8(0);
  const versionMinor = view.getUint8(1);
  const maxSectionCount = view.getUint32(4, true);
  const compressionLevel = view.getUint16(20, true);

  const compression = KSPLAT_COMPRESSION[compressionLevel];
  if (!compression) {
    return {
      ok: false,
      reason:
        `That .ksplat declares compression level ${compressionLevel}; the readers here know 0, 1 ` +
        "and 2. It was written by a newer tool than this app has.",
    };
  }

  const readable = Math.min(maxSectionCount, KSPLAT_SECTIONS_IN_PREFIX);
  let declaredSplats = 0;
  let storage = 0;
  let sectionsRead = 0;

  for (let i = 0; i < readable; i++) {
    const base = KSPLAT_HEADER_BYTES + i * KSPLAT_SECTION_BYTES;
    if (base + KSPLAT_SECTION_BYTES > prefix.length) break;
    sectionsRead++;

    const splatCount = view.getUint32(base + 0, true);
    const maxSplatCount = view.getUint32(base + 4, true);
    const bucketSize = view.getUint32(base + 8, true);
    const bucketCount = view.getUint32(base + 12, true);
    const bucketStorageSizeBytes = view.getUint16(base + 20, true);
    const partiallyFilledBucketCount = view.getUint32(base + 36, true);
    const shDegree = view.getUint16(base + 40, true);

    const shComponents = KSPLAT_SH_COMPONENTS[shDegree];
    if (shComponents === undefined) {
      return {
        ok: false,
        reason:
          `That .ksplat declares spherical harmonics of degree ${shDegree} in section ${i + 1}; ` +
          "the format only goes to 3. The file is corrupt.",
      };
    }
    if (splatCount > maxSplatCount) {
      return {
        ok: false,
        reason:
          `That .ksplat's section ${i + 1} says it holds ${splatCount.toLocaleString()} splats in ` +
          `room for ${maxSplatCount.toLocaleString()}. The header contradicts itself.`,
      };
    }
    // The decoder walks buckets of `bucketSize` splats each; a zero size with a
    // non-zero count is a header that cannot be walked at all.
    if (bucketCount > 0 && bucketSize === 0) {
      return {
        ok: false,
        reason: `That .ksplat's section ${i + 1} declares buckets of zero size. The header is corrupt.`,
      };
    }

    declaredSplats += splatCount;
    const bytesPerSplat = compression.splat + shComponents * compression.sh;
    storage +=
      bytesPerSplat * maxSplatCount +
      bucketStorageSizeBytes * bucketCount +
      partiallyFilledBucketCount * 4;
  }

  const complete = sectionsRead === maxSectionCount;
  if (complete && declaredSplats === 0) {
    return {
      ok: false,
      reason: "That .ksplat contains zero splats — the reconstruction produced nothing.",
    };
  }

  /*
    Truncation, provable when the whole section table was in the prefix.

    This is the check that makes ksplat worth accepting at all: a half-downloaded
    one otherwise reaches the viewer as a capture the app calls ready and cannot
    draw. When the table did NOT fit, `need` covers only the sections that did,
    so it stays a valid LOWER bound — still able to catch a badly short file, and
    never able to refuse a long one for being long.
  */
  const need = KSPLAT_HEADER_BYTES + maxSectionCount * KSPLAT_SECTION_BYTES + storage;
  if (totalBytes < need) {
    const got = (totalBytes / 1_048_576).toFixed(1);
    const want = (need / 1_048_576).toFixed(1);
    return {
      ok: false,
      reason:
        `That .ksplat is truncated: its header describes ${want} MB of splats but only ${got} MB ` +
        "arrived. The export or the transfer was interrupted.",
    };
  }

  return {
    ok: true,
    format: "ksplat",
    count: complete ? declaredSplats : null,
    gaussian: true,
    measurable: false,
    warning: complete
      ? null
      : `This .ksplat declares ${maxSectionCount.toLocaleString()} sections, more than the ` +
        `${KSPLAT_SECTIONS_IN_PREFIX} that fit in the start of a file this check reads. It was ` +
        `accepted on its file header (version ${versionMajor}.${versionMinor}, compression level ` +
        `${compressionLevel}); whether every section is complete was not verified.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SPLAT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The antimatter15/Luma record: 12 bytes position, 12 bytes scale, 4 bytes
 * RGBA, 4 bytes quaternion. No header, no magic, no count — the whole format
 * specification is this one number.
 */
/*
  "RAD0" — World Labs' streaming/LOD container.

  Taken from Spark's own `getSplatFileType`, which compares a little-endian
  uint32 against 809779538. That is 0x30444152, which is the four bytes
  52 41 44 30 in file order: R A D 0. Written here as bytes rather than as that
  integer so it cannot silently mean something else on a big-endian host, and so
  the next person does not have to do the arithmetic to see what it is.
*/
/*
  The accepted list, as a sentence, DERIVED rather than typed.

  This was written out by hand as ".ply, .spz, .splat and .ksplat" and went
  stale the moment a fifth format landed: the gate took `.rad` while the
  refusal still told people it did not. A message that lists what is accepted
  is precisely the message that must never be a second copy of the list -
  someone reads it, believes it, and does not try the file that would have
  worked.
*/
function spokenExtensions(): string {
  const all = [...SPLAT_EXTENSIONS];
  if (all.length <= 1) return all.join("");
  return `${all.slice(0, -1).join(", ")} and ${all[all.length - 1]}`;
}

const RAD_MAGIC = [0x52, 0x41, 0x44, 0x30] as const;

/*
  A floor, not a validation, and the comment is the honest part.

  Spark hands `decode_rad_header` up to the first megabyte, so the real header
  can be large and its layout is not something this module can read. All this
  rules out is a four-byte file that happens to spell RAD0. Anything past it is
  the viewer's problem, which the module header says plainly.
*/
const RAD_MIN_BYTES = 64;

function startsWithRadMagic(b: Uint8Array): boolean {
  return b.length >= 4 && RAD_MAGIC.every((byte, i) => b[i] === byte);
}

const SPLAT_RECORD_BYTES = 32;

/**
 * Records sampled for plausibility.
 *
 * Enough that random bytes are very unlikely to clear all of them, few enough
 * that the check is free. Bounded by the kept prefix in any case.
 */
const SPLAT_SAMPLE_RECORDS = 64;

/**
 * The largest coordinate a real scene puts in a float32 position.
 *
 * KIRI normalises into a ±50 box; an un-normalised outdoor reconstruction can
 * reach the thousands. A million is far past anything anyone frames and well
 * short of float32's range, so it rejects noise without rejecting scenes.
 */
const SPLAT_MAX_COORD = 1e6;

/**
 * Is this a bare array of 32-byte splat records?
 *
 * The weakest check in this file, and the header of the file says why: there is
 * nothing in the format to check AGAINST. What is available:
 *
 *   - the length is a non-zero exact multiple of 32 — every renderer's decoder
 *     throws on anything else, so this is a real gate rather than a guess
 *   - the leading positions and scales are finite float32s in a range a scene
 *     could occupy, and scales are non-negative because `.splat` stores them
 *     linear rather than logged
 *   - not every sampled position is exactly zero, which is what a run of zero
 *     padding looks like
 *
 * What is NOT checked, and cannot be: that the file is a splat rather than some
 * other headerless binary whose length happens to divide by 32. Anything with a
 * recognisable shape has already been claimed by an earlier link in the chain,
 * so what reaches here is genuinely unidentifiable — this is a judgement about
 * it, not a proof. Returns null to mean "not mine", so the chain can go on to
 * name the file as something else entirely.
 */
function readSplatStructure(prefix: Uint8Array, totalBytes: number): SplatFileResult | null {
  if (totalBytes === 0 || totalBytes % SPLAT_RECORD_BYTES !== 0) return null;

  const records = Math.min(
    Math.floor(prefix.length / SPLAT_RECORD_BYTES),
    SPLAT_SAMPLE_RECORDS,
  );
  if (records === 0) return null;

  const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
  let nonZeroPositions = 0;
  let positiveScales = 0;

  for (let i = 0; i < records; i++) {
    const base = i * SPLAT_RECORD_BYTES;
    for (let axis = 0; axis < 3; axis++) {
      const p = view.getFloat32(base + axis * 4, true);
      if (!Number.isFinite(p) || Math.abs(p) > SPLAT_MAX_COORD) return null;
      if (p !== 0) nonZeroPositions++;
    }
    for (let axis = 0; axis < 3; axis++) {
      const s = view.getFloat32(base + 12 + axis * 4, true);
      if (!Number.isFinite(s) || s < 0 || s > SPLAT_MAX_COORD) return null;
      if (s > 0) positiveScales++;
    }
  }

  if (nonZeroPositions === 0 || positiveScales === 0) return null;

  return {
    ok: true,
    format: "splat",
    // Not declared anywhere — derived, which is the only thing the format
    // allows and is exact rather than approximate.
    count: totalBytes / SPLAT_RECORD_BYTES,
    gaussian: true,
    measurable: false,
    warning: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The chain
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Identify and validate an uploaded splat from its leading bytes.
 *
 * `totalBytes` is the size of the WHOLE file, which the caller counted and this
 * prefix cannot know. It is what makes truncation detectable for the formats
 * that declare their own length, and it is deliberately the COUNTED byte total
 * rather than Content-Length — a sender's claim about length is exactly what a
 * truncation check exists to catch.
 *
 * The order below is the design. PLY and SPZ announce themselves with magic
 * bytes and their answers are FINAL, refusals included, because a specific
 * reason ("that PLY is ASCII") always beats a generic one. KSPLAT owns a file
 * whose header fields all line up, for the same reason. `.splat` goes last
 * because it can only ever say "nothing ruled this out".
 */
export function detectSplatFormat(prefix: Uint8Array, totalBytes: number): SplatFileResult {
  if (totalBytes === 0) {
    return { ok: false, reason: "That file is empty." };
  }

  // PLY: the ASCII magic, then the existing strict parse, untouched.
  if (prefix.length >= 3 && prefix[0] === 0x70 && prefix[1] === 0x6c && prefix[2] === 0x79) {
    const ply = parsePlyHeader(prefix, totalBytes);
    if (!ply.ok) return ply;
    return {
      ok: true,
      format: "ply",
      count: ply.count,
      gaussian: ply.gaussian,
      // The one format plyBounds.ts can read, and only when every property is
      // a float32 — it reads raw offsets, and a uchar colour would shift them.
      measurable: ply.allFloat,
      warning: ply.warning,
    };
  }

  // SPZ, as every encoder actually writes it: gzip around the NGSP header.
  if (prefix.length >= 2 && prefix[0] === 0x1f && prefix[1] === 0x8b) {
    const inflated = inflatePrefix(prefix);
    if (startsWithSpzMagic(inflated)) return readSpzHeader(inflated, totalBytes);
    return {
      ok: false,
      reason:
        "That is a gzip archive, not a splat. If it is a capture somebody zipped up, unpack it " +
        "first — an .spz is already compressed and is uploaded exactly as it is.",
    };
  }

  // SPZ unwrapped. Not what a tool writes, but it is a valid SPZ stream and
  // refusing it would be refusing a file that works.
  if (startsWithSpzMagic(prefix)) return readSpzHeader(Buffer.from(prefix), totalBytes);

  if (looksLikeKsplat(prefix, totalBytes)) return readKsplatHeader(prefix, totalBytes);

  // RAD, before the headerless guess below, because it can name itself.
  if (startsWithRadMagic(prefix)) {
    if (totalBytes < RAD_MIN_BYTES) {
      return { ok: false, reason: "That .rad file is too small to contain a scene." };
    }
    return {
      ok: true,
      format: "rad",
      // Both unknowable without the wasm decoder. `null` rather than 0: the
      // count is not zero, it is unmeasured, and the difference is the whole
      // point of the type allowing null.
      count: null,
      gaussian: true,
      measurable: false,
      warning:
        "Streaming RAD files open in the Spark engine only — the original engine " +
        "cannot read them, so the renderer choice will be fixed for this capture.",
    };
  }

  const splat = readSplatStructure(prefix, totalBytes);
  if (splat) return splat;

  // Nothing claimed it. Name what it looks like instead — someone who picked
  // the wrong file wants to know which wrong file they picked.
  const sniff = sniffForeignFormat(prefix);
  return {
    ok: false,
    reason: sniff
      ? `That is ${sniff}, not a splat. This takes ${spokenExtensions()}.`
      : `That file is not a splat this app can read. It takes ${spokenExtensions()}, ` +
        "and this one matches none of them.",
  };
}
