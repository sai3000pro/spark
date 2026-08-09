/**
 * Every authored trip, newest first.
 *
 * Waterloo Park is the deep one — full transcripts, all three splat states, and
 * the "where is my water bottle" hero case. The rest are postcards that exist to
 * fill the gallery and spread pins across the globe. Adding a trip means adding a
 * TripSpec here and nothing else; see the authoring rules in lib/mock/buildTrip.ts.
 */
import type { TripSpec } from "../buildTrip";
import { alfama } from "./alfama";
import { brooklynBridgePark } from "./brooklyn-bridge-park";
import { higashiyama } from "./higashiyama";
import { highLine } from "./high-line";
import { lionsHead } from "./lions-head";
import { reynisfjara } from "./reynisfjara";
import { summerhacks } from "./summerhacks";
import { waterlooPark } from "./waterloo-park";

/** Sorted newest first — the gallery groups by month and reads top-down. */
export const TRIP_SPECS: readonly TripSpec[] = [
  summerhacks, // 2026-08-08 · Toronto, ON — carries the one real capture
  waterlooPark, // 2026-08-02 · Waterloo, ON
  brooklynBridgePark, // 2026-06-16 · Brooklyn, NY
  highLine, // 2026-06-14 · Manhattan, NY
  alfama, // 2026-05-23 · Lisbon
  higashiyama, // 2026-04-09 · Kyoto
  reynisfjara, // 2026-03-05 · Iceland
  lionsHead, // 2026-02-17 · Cape Town
];

const BY_ID = new Map(TRIP_SPECS.map((s) => [s.id, s]));

export const getTripSpec = (id: string): TripSpec | undefined => BY_ID.get(id);

/** Waterloo Park — the trip every deep-linked demo assumes. */
export const DEFAULT_TRIP_ID = waterlooPark.id;

export {
  summerhacks,
  waterlooPark,
  brooklynBridgePark,
  highLine,
  alfama,
  higashiyama,
  reynisfjara,
  lionsHead,
};
