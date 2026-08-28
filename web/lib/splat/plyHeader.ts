/**
 * Is this actually a Gaussian-splat PLY, and can this app draw it?
 *
 * The gate on the one route that accepts a finished reconstruction from
 * outside — app/api/splat/upload. A file arriving there has been produced by
 * software we did not write, on a machine we have never seen: the studio
 * executable, KIRI, Polycam, Luma, Postshot, or somebody's own training run.
 * So it is checked rather than trusted.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE HEADER AND NOT THE EXTENSION
 *
 * `.ply` is a container, not a format. The same extension covers an ASCII mesh
 * from Blender, a binary point cloud from a laser scanner, and the INRIA
 * Gaussian layout this app renders — and only the last one will draw. Taking
 * the extension's word for it means accepting the upload, reporting success,
 * and handing the viewer a file that resolves to an empty scene. The user then
 * has a capture that the app says is ready and that shows them nothing, which
 * is the same class of lie as offering a reconstruction target that cannot run.
 *
 * A PLY header is plain text in the first few kilobytes and states the layout
 * outright. Reading it costs nothing and turns "we'll see" into an answer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO SEPARATE QUESTIONS, DELIBERATELY NOT COLLAPSED
 *
 *   `ok`         can this file be stored and served at all
 *   `gaussian`   does it carry the INRIA splat properties
 *
 * They are not the same, and merging them would reject files the app can
 * genuinely display. lib/video/plyBounds.ts wants every property to be float32
 * because it reads raw offsets to measure bounds; the RENDERER is looser than
 * that. So a valid binary PLY that this module cannot confirm is Gaussian is
 * still accepted — it is stored, served, and framed with a default camera —
 * and the caller is told what was unconfirmed rather than being refused.
 *
 * Refusal is reserved for files that cannot work: ASCII, big-endian, meshes,
 * truncation, and things that are not PLY at all.
 *
 * No `server-only` here on purpose. This is pure arithmetic over bytes with no
 * filesystem and no secrets, and scripts/verify-splat-upload.ts imports it
 * directly under `tsx` — a guard would buy nothing and cost the coverage.
 */

/** Headers are text and short. Anything past this is not a header. */
export const MAX_HEADER_BYTES = 64 * 1024;

/**
 * The properties the INRIA/Brush Gaussian layout is built from.
 *
 * `f_dc_*` is the zeroth-order spherical harmonic — the base colour — and its
 * presence is what separates a splat from a coloured point cloud, which is the
 * confusion this check exists to catch.
 */
const GAUSSIAN_PROPS = ["f_dc_0", "opacity", "scale_0", "rot_0"] as const;

export interface PlyHeaderOk {
  ok: true;
  /** Byte offset where vertex data begins. */
  dataOffset: number;
  /** Declared vertex count. */
  count: number;
  /** Bytes per vertex. */
  stride: number;
  /** Property names in file order. */
  properties: string[];
  /** Every property is float32 — so plyBounds.ts can measure this file. */
  allFloat: boolean;
  /**
   * Carries the INRIA splat properties. False means it is a point cloud or
   * mesh that will load but will not look like a capture.
   */
  gaussian: boolean;
  /** Present and human-readable when something is odd but not fatal. */
  warning: string | null;
}

export interface PlyHeaderBad {
  ok: false;
  /** Phrased for the person who chose the file, not for a log. */
  reason: string;
}

export type PlyHeaderResult = PlyHeaderOk | PlyHeaderBad;

/** Byte width of each PLY scalar type. Names include the old aliases. */
const TYPE_BYTES: Record<string, number> = {
  char: 1, int8: 1, uchar: 1, uint8: 1,
  short: 2, int16: 2, ushort: 2, uint16: 2,
  int: 4, int32: 4, uint: 4, uint32: 4,
  float: 4, float32: 4,
  double: 8, float64: 8,
};

/**
 * Parse a PLY header out of the first bytes of a file.
 *
 * `totalBytes` is the size of the whole file, which the caller knows and this
 * prefix does not. It is what catches truncation — a half-finished upload has
 * a perfectly valid header describing data that is not there, and storing one
 * produces a capture that fails at render time instead of at upload time.
 */
export function parsePlyHeader(prefix: Uint8Array, totalBytes: number): PlyHeaderResult {
  // latin1: header bytes are ASCII, and this must never throw on binary tails.
  const text = Buffer.from(
    prefix.subarray(0, Math.min(prefix.length, MAX_HEADER_BYTES)),
  ).toString("latin1");

  if (!text.startsWith("ply")) {
    // Name what it looks like instead. Someone who picked the wrong file wants
    // to know which wrong file they picked.
    const sniff = sniffOther(prefix);
    return {
      ok: false,
      reason: sniff
        ? `That is ${sniff}, not a PLY. Upload the .ply your reconstruction produced.`
        : "That file is not a PLY — it has no `ply` header.",
    };
  }

  // Tolerate CRLF, which Windows-authored exporters do emit.
  const marker = /end_header\r?\n/.exec(text);
  if (!marker) {
    return {
      ok: false,
      reason:
        prefix.length >= MAX_HEADER_BYTES
          ? "That PLY header is unreadably long — the file looks corrupt."
          : "That PLY is truncated: the header never ends. The upload or export was cut short.",
    };
  }
  const dataOffset = marker.index + marker[0].length;
  const header = text.slice(0, marker.index);

  const format = /format\s+(\S+)/.exec(header)?.[1];
  if (format === "ascii") {
    return {
      ok: false,
      reason:
        "That PLY is ASCII. Gaussian splats have to be binary little-endian to " +
        "load — re-export it as binary.",
    };
  }
  if (format === "binary_big_endian") {
    return {
      ok: false,
      reason: "That PLY is big-endian, which no splat renderer reads. Re-export it as binary little-endian.",
    };
  }
  if (format !== "binary_little_endian") {
    return { ok: false, reason: `Unrecognised PLY format \`${format ?? "none declared"}\`.` };
  }

  // A mesh is the single most common wrong-file case, because Blender and
  // MeshLab both write `.ply` by default and both write faces.
  if (/element\s+face\s+([1-9]\d*)/.test(header)) {
    return {
      ok: false,
      reason:
        "That is a mesh PLY (it has faces), not a Gaussian splat. It is probably " +
        "an export from Blender or MeshLab rather than from a splat trainer.",
    };
  }

  const vertexMatch = /element\s+vertex\s+(\d+)/.exec(header);
  if (!vertexMatch) {
    return { ok: false, reason: "That PLY declares no vertices, so there is nothing to draw." };
  }
  const count = Number(vertexMatch[1]);
  if (count === 0) {
    return { ok: false, reason: "That PLY contains zero points — the reconstruction produced nothing." };
  }

  /*
    Properties of the VERTEX element only.

    A PLY can declare several elements, each with its own property list, and
    they are laid out in declaration order. Summing every `property` line in the
    file would compute a stride for a record that does not exist — so the scan
    is bounded to the span between `element vertex` and whatever element comes
    next.
  */
  const afterVertex = header.slice(vertexMatch.index + vertexMatch[0].length);
  const nextElement = /^element\s+/m.exec(afterVertex);
  const vertexBlock = nextElement ? afterVertex.slice(0, nextElement.index) : afterVertex;

  const properties: string[] = [];
  let stride = 0;
  let allFloat = true;

  for (const m of vertexBlock.matchAll(/^property\s+(\S+)\s+(\S+)\s*$/gm)) {
    const [, type, name] = m;
    if (type === "list") {
      return {
        ok: false,
        reason: "That PLY has variable-length vertex properties, which splat renderers cannot read.",
      };
    }
    const width = TYPE_BYTES[type];
    if (width === undefined) {
      return { ok: false, reason: `That PLY uses an unknown property type \`${type}\`.` };
    }
    if (width !== 4 || (type !== "float" && type !== "float32")) allFloat = false;
    properties.push(name);
    stride += width;
  }

  if (properties.length === 0) {
    return { ok: false, reason: "That PLY declares vertices with no properties at all." };
  }

  const need = dataOffset + count * stride;
  if (totalBytes < need) {
    const got = (totalBytes / 1_048_576).toFixed(1);
    const want = (need / 1_048_576).toFixed(1);
    return {
      ok: false,
      reason:
        `That PLY is truncated: it declares ${count.toLocaleString()} points (${want} MB) ` +
        `but only ${got} MB arrived. The export or the transfer was interrupted.`,
    };
  }

  const gaussian = GAUSSIAN_PROPS.every((p) => properties.includes(p));

  return {
    ok: true,
    dataOffset,
    count,
    stride,
    properties,
    allFloat,
    gaussian,
    warning: gaussian
      ? null
      : // Accepted, but say so plainly rather than letting it look like a
        // successful splat upload that happens to render as dots.
        "This looks like a plain point cloud rather than a Gaussian splat — it " +
        "has positions but no splat properties (opacity, scale, rotation). It " +
        "will load, but it will not look like a capture.",
  };
}

/** Name the format someone uploaded by mistake, when it is one we recognise. */
function sniffOther(prefix: Uint8Array): string | null {
  const b = prefix;
  if (b.length >= 4) {
    if (b[0] === 0x4e && b[1] === 0x47 && b[2] === 0x53 && b[3] === 0x50) return "an SPZ file";
    if (b[0] === 0x50 && b[1] === 0x4b) return "a ZIP archive";
    if (b[0] === 0x1f && b[1] === 0x8b) return "a gzip archive";
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "a PNG image";
    if (b[0] === 0xff && b[1] === 0xd8) return "a JPEG image";
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "a PDF";
  }
  if (b.length >= 12) {
    const box = Buffer.from(b.subarray(4, 8)).toString("latin1");
    if (box === "ftyp") return "a video";
  }
  return null;
}
