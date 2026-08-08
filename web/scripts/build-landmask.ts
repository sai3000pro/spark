/**
 * Bakes Natural Earth's 1:110m land polygons into a 1-bit equirectangular mask.
 *
 *   npm run build:landmask        # writes lib/globe/landmask.ts, ASCII preview to stderr
 *
 * WHY a bitmask and not the GeoJSON itself: the globe samples ~48,000 points on a
 * Fibonacci sphere and asks "is this land?" for each. Point-in-polygon against
 * 5,143 vertices, 48,000 times, is tens of milliseconds of main-thread work on
 * every mount. Rasterizing once at build time turns that into a single array
 * index — and 16 KB of packed bits ships smaller than 138 KB of coordinates.
 *
 * This script is NOT part of the Next build graph. Nothing under app/ or lib/
 * imports scripts/, so the source GeoJSON never reaches a bundle.
 *
 * Source: scripts/data/ne_110m_land.json — Natural Earth, public domain.
 *   https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson
 *   138,160 bytes · FNV-1a 0x3f44446b · 127 features · 5,143 vertices
 * If those numbers stop matching, the upstream file changed: re-check the output
 * before committing it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const W = 512;
const H = 256;

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, "data", "ne_110m_land.json");

/** A closed ring of [lng, lat] pairs. */
type Ring = Array<[number, number]>;

interface GeoJson {
  features: Array<{
    geometry:
      | { type: "Polygon"; coordinates: Ring[] }
      | { type: "MultiPolygon"; coordinates: Ring[][] };
  }>;
}

function readRings(): Ring[] {
  const raw = readFileSync(SOURCE);

  // FNV-1a over the raw bytes — cheap drift detection against the header above.
  let hash = 0x811c9dc5;
  for (const byte of raw) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }

  const geo = JSON.parse(raw.toString("utf8")) as GeoJson;
  const rings: Ring[] = [];
  for (const feature of geo.features) {
    const { geometry } = feature;
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons) rings.push(...polygon);
  }

  process.stderr.write(
    `source  ${raw.length} bytes · FNV-1a 0x${hash.toString(16).padStart(8, "0")} · ` +
      `${geo.features.length} features · ${rings.length} rings\n`,
  );
  return rings;
}

/**
 * Even-odd scanline fill in equirectangular space.
 *
 * Crossings from every ring of every polygon go into one sorted list per row.
 * Even-odd parity then handles interior holes for free — the Caspian's hole ring
 * contributes two crossings that toggle the fill back off inside it. This is only
 * correct because Natural Earth's landmasses do not overlap each other.
 *
 * Natural Earth 110m is already split at ±180, so there are no wrapping edges.
 */
function rasterize(rings: Ring[]): Uint8Array {
  const cells = new Uint8Array(W * H);

  for (let y = 0; y < H; y++) {
    // Row 0 is the north pole. Sample at the cell's centre, not its edge.
    const lat = 90 - (y + 0.5) * (180 / H);
    const crossings: number[] = [];

    for (const ring of rings) {
      for (let i = 0, n = ring.length; i < n; i++) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[(i + 1) % n];
        // Half-open test: a vertex exactly on the scanline counts once, not twice.
        if (y1 <= lat === y2 <= lat) continue;
        crossings.push(x1 + ((lat - y1) / (y2 - y1)) * (x2 - x1));
      }
    }

    if (crossings.length < 2) continue;
    crossings.sort((a, b) => a - b);

    for (let i = 0; i + 1 < crossings.length; i += 2) {
      // Half-open in x too, so adjacent spans never double-write a boundary cell.
      const from = Math.max(0, Math.ceil(((crossings[i] + 180) / 360) * W - 0.5));
      const to = Math.min(W - 1, Math.floor(((crossings[i + 1] + 180) / 360) * W - 0.5));
      for (let x = from; x <= to; x++) cells[y * W + x] = 1;
    }
  }

  return cells;
}

/** MSB-first within each byte, row-major. */
function pack(cells: Uint8Array): Buffer {
  const bytes = Buffer.alloc((W * H) / 8);
  for (let i = 0; i < cells.length; i++) {
    if (cells[i]) bytes[i >> 3] |= 0x80 >> (i & 7);
  }
  return bytes;
}

/**
 * An 80x40 ASCII render to stderr. A mirrored or upside-down Earth is the single
 * most likely bug here and the single hardest to spot in a base64 blob — but it
 * is instantly obvious as text.
 */
function preview(cells: Uint8Array): void {
  const cols = 80;
  const rows = 40;
  const lines: string[] = [];
  for (let ry = 0; ry < rows; ry++) {
    let line = "";
    for (let rx = 0; rx < cols; rx++) {
      let land = 0;
      let total = 0;
      const y0 = Math.floor((ry * H) / rows);
      const y1 = Math.floor(((ry + 1) * H) / rows);
      const x0 = Math.floor((rx * W) / cols);
      const x1 = Math.floor(((rx + 1) * W) / cols);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          total++;
          land += cells[y * W + x];
        }
      }
      const ratio = total ? land / total : 0;
      line += ratio > 0.6 ? "#" : ratio > 0.25 ? "+" : ratio > 0.02 ? "." : " ";
    }
    lines.push(line);
  }
  process.stderr.write(`\n${lines.join("\n")}\n\n`);
}

const rings = readRings();
const cells = rasterize(rings);
const packed = pack(cells);

/**
 * Two different fractions, and only one of them is meaningful as a sanity check.
 *
 * Equirectangular cells are equal in lat/lng but NOT in area — a row next to the
 * pole covers a tiny sliver of Earth while a row at the equator covers a huge
 * band. So a raw cell count massively over-weights Antarctica and Greenland and
 * lands near 0.33. Weighting each cell by cos(lat) recovers real surface area,
 * which should sit near Earth's actual land fraction of 0.292.
 */
let landCells = 0;
let landArea = 0;
let totalArea = 0;
for (let y = 0; y < H; y++) {
  const lat = 90 - (y + 0.5) * (180 / H);
  const weight = Math.cos((lat * Math.PI) / 180);
  for (let x = 0; x < W; x++) {
    const land = cells[y * W + x];
    landCells += land;
    totalArea += weight;
    if (land) landArea += weight;
  }
}
const cellFraction = landCells / cells.length;
const areaFraction = landArea / totalArea;

preview(cells);
process.stderr.write(
  `mask    ${W}x${H} · ${landCells} land cells · ${packed.length} bytes packed\n` +
    `        cell fraction ${cellFraction.toFixed(4)} (poles over-weighted, ~0.33 is normal)\n` +
    `        area fraction ${areaFraction.toFixed(4)} (cos-weighted; expect 0.27–0.31, Earth is 0.292)\n`,
);
if (areaFraction < 0.27 || areaFraction > 0.31) {
  process.stderr.write("FAILED: land area fraction outside the plausible range — not writing.\n");
  process.exit(1);
}

const b64 = packed.toString("base64");
process.stdout.write(`/**
 * GENERATED FILE — do not edit. Run \`npm run build:landmask\` to regenerate.
 *
 * A 1-bit equirectangular land mask baked from Natural Earth 1:110m (public
 * domain). Packed MSB-first within each byte, row-major, row 0 = latitude +90.
 *
 * Cell centres:
 *   lat = 90 - (y + 0.5) * (180 / ${H})
 *   lng = -180 + (x + 0.5) * (360 / ${W})
 *
 * ${W}x${H} = ${(W * H).toLocaleString("en-US")} cells → ${packed.length.toLocaleString("en-US")} bytes → ${b64.length.toLocaleString("en-US")} base64 chars.
 *
 * Land is ${(cellFraction * 100).toFixed(1)}% of cells but only ${(areaFraction * 100).toFixed(1)}% of surface area — equirectangular
 * cells shrink toward the poles, so the raw count over-weights Antarctica and
 * Greenland. Earth's true land fraction is 29.2%.
 *
 * Decoded and distance-transformed once per process by lib/globe/mask.ts.
 */

export const LANDMASK_W = ${W};
export const LANDMASK_H = ${H};

export const LANDMASK_B64 =
  "${b64}";
`);
