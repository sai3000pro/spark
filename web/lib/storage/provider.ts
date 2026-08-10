/**
 * Where the bytes live.
 *
 * Splats are the only genuinely large thing this app owns — a delivery SPZ is
 * 5–8 MB and its archival PLY is 25–100 MB — so blob capacity, not database
 * rows, is what runs out first. Postgres holds ~35 KB per journey once raw
 * detections are excluded (see lib/repo/detections.ts), which means the 500 MB
 * free tier is good for something like 14,000 journeys. The 10 GB blob tier is
 * good for about 300. That asymmetry is why this file exists and why there is
 * no equivalent abstraction over the database.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY MORE THAN ONE PROVIDER
 *
 * Free tiers are small and they are not fungible, so the only way to add
 * headroom without a card is to use several at once. Each object records WHERE
 * it went, so providers can be added, drained, or removed without touching the
 * rows that point at them. Postgres stays the single source of truth; only the
 * bytes move.
 *
 * This is sharding at the object level, which is the safe kind. Sharding the
 * RELATIONAL data across two databases is the unsafe kind and is deliberately
 * not done here: RLS in Postgres *is* this app's authorization model, and a
 * second store would need a second implementation of the same visibility rules
 * with no cross-database transaction to keep them agreeing. The first time they
 * disagreed, a private walk would be readable. Bytes have no such problem — an
 * object is either found or not.
 *
 * KNOWN CAPACITIES, as of 2026-08. Verify before relying on them; they move.
 *
 *   r2        10 GB stored · unlimited free egress · 1M class-A + 10M class-B ops
 *   supabase   1 GB stored ·  5 GB egress/month, SHARED with API egress
 *   firebase  NOT AVAILABLE without a billing account. Since 2024-10-30 a new
 *             project cannot provision a bucket on the free Spark plan, and
 *             since 2026-02-02 non-Blaze projects lost access to existing ones.
 *             The adapter exists so that a project already on Blaze can opt in,
 *             but it is off unless explicitly configured. Do not plan capacity
 *             around it.
 *
 * R2 is the default for everything for one reason: egress is free at any
 * volume. Supabase's 5 GB/month is shared with API egress, so roughly 600
 * downloads of a 8 MB SPZ would consume the entire month's budget for the whole
 * application, API calls included. It is overflow, not a peer.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Providers this app knows how to address. Persisted — never renumber. */
export type StorageProviderId = "r2" | "supabase" | "firebase";

/**
 * What an object is FOR, which is what decides where it should go.
 *
 * Kept separate from the bucket name because placement is a policy question
 * ("archives can live somewhere slow") and the bucket is an implementation
 * detail of whichever provider answered.
 */
export type StorageClass =
  /** Served to browsers, repeatedly, over a CDN. Egress cost dominates. */
  | "delivery"
  /** Written once, read on re-transcode or export. Egress is ~zero. */
  | "archive"
  /** User-supplied source media. Deleted on a lifecycle rule after 7 days. */
  | "ephemeral";

export interface StorageObject {
  provider: StorageProviderId;
  bucket: string;
  /** Path within the bucket. Never user-controlled — see keys.ts. */
  key: string;
  bytes: number;
  /** Hex sha256, when the caller computed one. Used to detect silent corruption. */
  sha256?: string;
  contentType?: string;
}

export interface PutInput {
  key: string;
  body: Uint8Array | ReadableStream | Blob;
  bytes: number;
  contentType: string;
  sha256?: string;
  /** Immutable content gets a one-year cache. Mutable content must say so. */
  immutable?: boolean;
}

/**
 * A time-limited URL the browser may use directly.
 *
 * Note that for public delivery assets this is NOT how they are served — see
 * the CDN worker in infra/cdn. Presigned URLs put a signature in the query
 * string, which makes every issued URL a distinct cache key, which means the
 * CDN caches nothing and every viewer pays a cold origin fetch for an 8 MB
 * file. Presigning is for uploads and for private reads only.
 */
export interface SignedUrl {
  url: string;
  expiresAt: string;
  /** Extra headers the caller must send for the signature to validate. */
  headers?: Record<string, string>;
}

export interface ResumableUpload {
  protocol: "tus" | "s3-multipart";
  endpoint: string;
  /**
   * Opaque to the client; whatever the protocol needs to authorise.
   *
   * MUST be scoped to the uploading user and short-lived. It is handed to a
   * browser, so anything with broader authority than "write this one object"
   * is a compromise, not a leak — most sharply for Supabase, whose service role
   * key bypasses RLS entirely. Providers that cannot mint a scoped credential
   * must throw rather than substitute a privileged one.
   */
  token: string;
  object: Pick<StorageObject, "provider" | "bucket" | "key">;
}

/** Everything a provider needs to authorise a browser upload on a user's behalf. */
export interface UploadAuth {
  userId: string;
  /**
   * The user's own Supabase access token, forwarded from the request. Storage
   * RLS policies are evaluated against it, so this is what keeps one user from
   * writing into another's prefix.
   */
  accessToken: string;
}

/** What a provider reports about itself, for the placement policy. */
export interface ProviderCapacity {
  /** Bytes this provider is willing to hold, or null if genuinely unmetered. */
  quotaBytes: number | null;
  /** Our own running total. Providers do not expose usage cheaply or at all. */
  usedBytes: number;
  /** True when egress is free at any volume — the reason R2 wins delivery. */
  freeEgress: boolean;
  /** False when unconfigured or knowingly unavailable (see firebase above). */
  available: boolean;
  /** Human-readable reason when `available` is false. Surfaced in /settings. */
  unavailableReason?: string;
}

export interface StorageProvider {
  readonly id: StorageProviderId;
  readonly displayName: string;

  /** Buckets this provider serves, keyed by storage class. */
  bucketFor(cls: StorageClass): string;

  capacity(): Promise<ProviderCapacity>;

  put(cls: StorageClass, input: PutInput): Promise<StorageObject>;
  get(obj: Pick<StorageObject, "bucket" | "key">): Promise<ReadableStream>;
  head(
    obj: Pick<StorageObject, "bucket" | "key">,
  ): Promise<{ bytes: number; contentType?: string } | null>;
  delete(obj: Pick<StorageObject, "bucket" | "key">): Promise<void>;

  /** For private reads. Public delivery goes through the CDN worker instead. */
  signedReadUrl(
    obj: Pick<StorageObject, "bucket" | "key">,
    ttlSec: number,
  ): Promise<SignedUrl>;

  /**
   * A handle the BROWSER uploads to directly, so a 300 MB video never passes
   * through a request handler. Vercel caps request bodies at 4.5 MB, so this is
   * the only upload path that can work in production, not an optimisation.
   */
  createResumableUpload(
    cls: StorageClass,
    input: { key: string; bytes: number; contentType: string },
    auth: UploadAuth,
  ): Promise<ResumableUpload>;
}

/** Thrown when a provider is addressed but not configured. */
export class ProviderUnavailableError extends Error {
  constructor(
    readonly provider: StorageProviderId,
    reason: string,
  ) {
    super(`storage provider "${provider}" is unavailable: ${reason}`);
    this.name = "ProviderUnavailableError";
  }
}

/** Thrown when every eligible provider is full. Surfaced to the user as 507. */
export class NoCapacityError extends Error {
  constructor(
    readonly cls: StorageClass,
    readonly bytes: number,
    readonly tried: StorageProviderId[],
  ) {
    super(
      `no provider has room for ${bytes} bytes of "${cls}" (tried: ${tried.join(", ") || "none"})`,
    );
    this.name = "NoCapacityError";
  }
}
