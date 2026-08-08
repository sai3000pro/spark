/**
 * Decoding the land mask, plus the distance-to-coast field the globe shades with.
 *
 * Pure: no `three`, no `next`. The WebGL globe, the SVG fallback and the verify
 * script all read from here, on the server and the client alike.
 */
import { LANDMASK_B64, LANDMASK_H, LANDMASK_W } from "./landmask";

export interface LandMask {
  w: number;
  h: number;
  /** 1 = land. One byte per cell after unpacking — 131 KB, worth it for O(1) reads. */
  land: Uint8Array;
  /** Cells to the nearest sea cell. 0 for sea and for coastline, saturating at 63. */
  coast: Uint8Array;
}

/** Deep inland saturates here. 63 cells ≈ 44° of longitude at the equator. */
const MAX_COAST = 63;

let memo: LandMask | null = null;

/**
 * Decoded and distance-transformed once per process, then shared.
 *
 * Same memoization idiom as buildTrip() in lib/mock: the work is deterministic
 * and every caller wants the identical result.
 */
export function getLandMask(): LandMask {
  if (memo) return memo;

  const w = LANDMASK_W;
  const h = LANDMASK_H;
  const land = unpack(LANDMASK_B64, w * h);
  memo = { w, h, land, coast: distanceToSea(land, w, h) };
  return memo;
}

export function isLand(mask: LandMask, lat: number, lng: number): boolean {
  return mask.land[indexOf(mask, lat, lng)] === 1;
}

export function coastCells(mask: LandMask, lat: number, lng: number): number {
  return mask.coast[indexOf(mask, lat, lng)];
}

/** Row 0 is latitude +90; column 0 starts at longitude −180. */
function indexOf(mask: LandMask, lat: number, lng: number): number {
  const y = clamp(Math.floor(((90 - lat) / 180) * mask.h), 0, mask.h - 1);
  // Longitude wraps, so wrap rather than clamp — a sample at +180.0001 belongs
  // at the left edge, not pinned to the right one.
  const x = ((Math.floor(((lng + 180) / 360) * mask.w) % mask.w) + mask.w) % mask.w;
  return y * mask.w + x;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** MSB-first within each byte, row-major. */
function unpack(b64: string, cells: number): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(cells);
  for (let i = 0; i < cells; i++) {
    out[i] = (binary.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1;
  }
  return out;
}

/**
 * Two-pass chamfer distance transform — city-block distance from each land cell
 * to the nearest sea cell.
 *
 * ~131k cells × 2 passes ≈ 1–2 ms, once per process. Far cheaper than shipping a
 * second data channel: a 4-bit distance field would have cost another 87 KB of
 * base64 for a value that is trivially derivable.
 *
 * X wraps (longitude is a circle); Y does not (the poles are edges, and treating
 * them as adjacent would join Antarctica to the Arctic).
 */
function distanceToSea(land: Uint8Array, w: number, h: number): Uint8Array {
  const dist = new Uint8Array(w * h);
  for (let i = 0; i < dist.length; i++) dist[i] = land[i] ? MAX_COAST : 0;

  // Forward: left, up.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!land[i]) continue;
      const left = dist[y * w + ((x - 1 + w) % w)];
      const up = y > 0 ? dist[(y - 1) * w + x] : MAX_COAST;
      const best = Math.min(left, up) + 1;
      if (best < dist[i]) dist[i] = best;
    }
  }

  // Backward: right, down.
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!land[i]) continue;
      const right = dist[y * w + ((x + 1) % w)];
      const down = y < h - 1 ? dist[(y + 1) * w + x] : MAX_COAST;
      const best = Math.min(right, down) + 1;
      if (best < dist[i]) dist[i] = best;
    }
  }

  return dist;
}
