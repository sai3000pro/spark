/**
 * Which provider gets the bytes.
 *
 * The whole point of running more than one free tier is that their limits are
 * different in KIND, not just in size. R2 gives 10 GB with free egress;
 * Supabase gives 1 GB with 5 GB/month of egress that is shared with every API
 * call the app makes. Treating those as interchangeable buckets and filling
 * whichever is emptier would be the obvious policy and the wrong one — it would
 * park a hot, repeatedly-downloaded SPZ on the tier where 600 downloads consume
 * the month's entire budget for the whole application.
 *
 * So placement is decided by what the object is FOR:
 *
 *   delivery   free-egress first. These are downloaded over and over; egress is
 *              the dominant cost and R2's is zero. Metered tiers are a last
 *              resort and the UI should say so when it happens.
 *
 *   ephemeral  free-egress first. A 300 MB source video is read exactly once
 *              (worker → reconstruction provider), but 300 MB against a 5 GB
 *              monthly allowance is 1.7% of it per upload. Not worth spending.
 *
 *   archive    METERED FIRST. This is the inversion that actually buys
 *              capacity. A PLY master is written once and read almost never, so
 *              its egress cost is ~zero wherever it sits — which makes it the
 *              only thing that can safely occupy a tier whose egress we cannot
 *              afford to use. Parking cold bytes there keeps R2's free-egress
 *              space available for the hot ones.
 *
 * Within a tier, most-headroom-first, so no single provider fills while another
 * sits idle.
 *
 * PROVIDERS DO NOT REPORT USAGE CHEAPLY. R2 exposes it via a separate metrics
 * API on a delay; Supabase via the dashboard. Polling either on the write path
 * would be slow and rate-limited, so capacity comes from our own ledger — the
 * sum of `bytes` over live rows, maintained transactionally with the rows
 * themselves. It can drift if an object is deleted out from under us, which is
 * what `reconcileUsage()` is for.
 */
import {
  NoCapacityError,
  type ProviderCapacity,
  type StorageClass,
  type StorageProvider,
  type StorageProviderId,
} from "./provider";

/**
 * Never fill a provider to its stated limit. Going over on a free tier does not
 * queue — it errors, or on a metered plan it bills. The reserve absorbs the
 * ledger drift described above, plus whatever the provider counts that we do
 * not (multipart parts mid-upload, versioning, per-object metadata overhead).
 */
const HEADROOM_RESERVE = 0.9;

export interface PlacementDecision {
  provider: StorageProvider;
  /** Why this one, in a form worth logging and showing in /settings/storage. */
  reason: string;
  /** True when we fell past the preferred tier — worth surfacing, not hiding. */
  degraded: boolean;
}

function roomFor(cap: ProviderCapacity, bytes: number): boolean {
  if (!cap.available) return false;
  if (cap.quotaBytes === null) return true;
  return cap.usedBytes + bytes <= cap.quotaBytes * HEADROOM_RESERVE;
}

function remaining(cap: ProviderCapacity): number {
  if (cap.quotaBytes === null) return Number.POSITIVE_INFINITY;
  return Math.max(0, cap.quotaBytes * HEADROOM_RESERVE - cap.usedBytes);
}

/**
 * Order providers by preference for a storage class. Returns every eligible
 * provider, best first, so the caller can fall through on a write failure
 * rather than only on a capacity miss — a provider can be up for `capacity()`
 * and down for `put()`.
 */
export function rank(
  cls: StorageClass,
  entries: Array<{ provider: StorageProvider; capacity: ProviderCapacity }>,
  bytes: number,
): PlacementDecision[] {
  const eligible = entries.filter((e) => roomFor(e.capacity, bytes));
  if (!eligible.length) return [];

  // `archive` inverts the egress preference; see the header.
  const preferFreeEgress = cls !== "archive";

  const sorted = [...eligible].sort((a, b) => {
    const aPreferred = a.capacity.freeEgress === preferFreeEgress;
    const bPreferred = b.capacity.freeEgress === preferFreeEgress;
    if (aPreferred !== bPreferred) return aPreferred ? -1 : 1;
    return remaining(b.capacity) - remaining(a.capacity);
  });

  const topTierIsPreferred = sorted[0].capacity.freeEgress === preferFreeEgress;

  return sorted.map((e, i) => ({
    provider: e.provider,
    degraded: i > 0 || !topTierIsPreferred,
    reason: describe(cls, e.capacity, preferFreeEgress, i),
  }));
}

function describe(
  cls: StorageClass,
  cap: ProviderCapacity,
  preferFreeEgress: boolean,
  index: number,
): string {
  const tier = cap.freeEgress === preferFreeEgress ? "preferred" : "fallback";
  const left =
    cap.quotaBytes === null
      ? "unmetered"
      : `${(remaining(cap) / 1_073_741_824).toFixed(2)} GB free`;
  if (cls === "archive" && cap.freeEgress) {
    return `${tier} tier (${left}) — cold bytes spilled onto free-egress storage because the metered tier is full`;
  }
  if (cls !== "archive" && !cap.freeEgress) {
    return `${tier} tier (${left}) — WARNING: hot ${cls} bytes on metered egress`;
  }
  return `${tier} tier (${left}), choice ${index + 1}`;
}

/** The single best provider, or a NoCapacityError naming everything tried. */
export function choose(
  cls: StorageClass,
  entries: Array<{ provider: StorageProvider; capacity: ProviderCapacity }>,
  bytes: number,
): PlacementDecision {
  const ranked = rank(cls, entries, bytes);
  if (!ranked.length) {
    throw new NoCapacityError(
      cls,
      bytes,
      entries.map((e) => e.provider.id),
    );
  }
  return ranked[0];
}

/**
 * A capacity report for the whole fleet, for /settings/storage and for deciding
 * whether to accept an upload before the user waits through it.
 */
export interface FleetCapacity {
  totalQuotaBytes: number | null;
  totalUsedBytes: number;
  byProvider: Array<{ id: StorageProviderId; capacity: ProviderCapacity }>;
  /**
   * The largest single object still placeable, anywhere. Note this is the max
   * of the per-provider remainders, NOT their sum: one object goes to one
   * provider, so 900 MB free on each of two providers does not accept a 1.5 GB
   * file. This is the number to check before letting a user start an upload.
   *
   * It does not vary by storage class — class changes which provider is tried
   * first, never whether a given provider has room.
   */
  largestAcceptableBytes: number;
}

export function summarise(
  entries: Array<{ provider: StorageProvider; capacity: ProviderCapacity }>,
): FleetCapacity {
  const live = entries.filter((e) => e.capacity.available);
  const anyUnmetered = live.some((e) => e.capacity.quotaBytes === null);
  const remainders = live.map((e) => remaining(e.capacity));

  return {
    totalQuotaBytes: anyUnmetered
      ? null
      : live.reduce((n, e) => n + (e.capacity.quotaBytes ?? 0), 0),
    totalUsedBytes: live.reduce((n, e) => n + e.capacity.usedBytes, 0),
    byProvider: entries.map((e) => ({ id: e.provider.id, capacity: e.capacity })),
    largestAcceptableBytes: remainders.length ? Math.max(...remainders) : 0,
  };
}
