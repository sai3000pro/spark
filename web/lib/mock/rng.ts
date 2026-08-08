/**
 * Seeded RNG. Every piece of mock data must be stable across reloads — a demo
 * where the timeline reshuffles on refresh is a demo you cannot rehearse.
 */
export function makeRng(seed: number) {
  // mulberry32
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = ReturnType<typeof makeRng>;

export const rngRange = (r: Rng, min: number, max: number) => min + r() * (max - min);

export const rngInt = (r: Rng, min: number, max: number) =>
  Math.floor(rngRange(r, min, max + 1));

export const rngPick = <T,>(r: Rng, items: readonly T[]): T =>
  items[Math.min(items.length - 1, Math.floor(r() * items.length))];

/** Gaussian-ish via sum of uniforms — good enough for jittering bboxes. */
export const rngJitter = (r: Rng, magnitude: number) =>
  ((r() + r() + r()) / 3 - 0.5) * 2 * magnitude;
