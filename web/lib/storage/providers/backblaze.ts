/**
 * Backblaze B2, over its S3-compatible API.
 *
 * Third provider, and the reason is arithmetic: R2's 10 GB plus Supabase's 1 GB
 * is roughly 300 journeys' worth of splats (see ../provider.ts). B2 adds another
 * 10 GB stored, free, with no card — which very nearly doubles the fleet. Free
 * tiers are not fungible, so the only way to buy headroom without paying is to
 * run another one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT A COPY OF r2.ts, DESPITE BOTH SPEAKING S3
 *
 * 1. THE REGION IS PART OF THE HOSTNAME. R2 has one global endpoint and ignores
 *    the region entirely, which is why it can hardcode `region: "auto"`. B2
 *    shards by cluster — s3.us-west-004.backblazeb2.com, s3.eu-central-003, and
 *    so on — and the same string must ALSO be handed to the SDK, because SigV4
 *    signs the region into the credential scope. Get it wrong in either place
 *    and every request fails, one with DNS/404 and the other with a signature
 *    mismatch. There is no defensible default, so an unset B2_REGION marks the
 *    provider unavailable rather than guessing a cluster.
 *
 * 2. EGRESS IS METERED, so `freeEgress` is false. B2 gives free egress up to 3x
 *    the average monthly stored bytes — 30 GB/month at a full 10 GB — and bills
 *    beyond that. Unlimited free egress exists only through a Bandwidth Alliance
 *    CDN, and this app's CDN worker fronts R2, not B2. Reporting `true` here
 *    would let placement park a hot, repeatedly-downloaded SPZ on a metered
 *    tier, which is the precise mistake ../placement.ts exists to prevent. False
 *    is both honest and useful: it puts B2 in the same tier as Supabase for
 *    `archive`, where its 10 GB beats Supabase's 1 GB on headroom, so cold PLY
 *    masters land here first and R2's free-egress space stays free for hot bytes.
 *
 * 3. THE SDK'S DEFAULT CHECKSUMS BREAK B2. Since @aws-sdk/client-s3 v3.729 the
 *    client attaches a CRC32 checksum to every request by default, and B2
 *    rejects the `x-amz-sdk-checksum-algorithm` header it arrives with. The
 *    client below turns that off; see the comment on `s3()`.
 *
 * As with R2, `capacity()` reads our own ledger rather than the provider. B2
 * does expose usage, but only through the native b2_list_buckets/b2_get_file_info
 * API — a second protocol, a second credential exchange, and a per-bucket walk.
 * Not something to do on a write path. See ../ledger.ts.
 *
 * THE LEDGER NEEDS THE ENUM. `storage_provider` in supabase/migrations/006 was
 * ('r2', 'supabase', 'firebase'), and createDbLedger writes the provider id into
 * that column — so a `put()` here would have stored the bytes remotely and then
 * failed to record them, which is worse than not writing at all: the objects
 * exist, they are billed, and the accounting that picks the next destination
 * cannot see them. supabase/migrations/009 adds 'b2'. Apply it before pointing
 * this at a real database; the in-memory ledger (local dev, tests) never cared.
 */
import "server-only";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { UsageLedger } from "../ledger";
import {
  ProviderUnavailableError,
  type ProviderCapacity,
  type PutInput,
  type ResumableUpload,
  type SignedUrl,
  type StorageClass,
  type StorageObject,
  type StorageProvider,
} from "../provider";

/** Free tier, as of 2026-08: 10 GB stored. Overridable — a paid B2 account has
 *  no such ceiling, and pretending it does would refuse writes that would work. */
const DEFAULT_QUOTA_BYTES = 10 * 1024 * 1024 * 1024;

const MISSING =
  "not configured — set B2_KEY_ID, B2_APPLICATION_KEY and B2_REGION (e.g. us-west-004)";

/**
 * B2 has ONE storage tier — no Glacier equivalent, no per-object class — so
 * `archive` and `delivery` share a bucket exactly as they do on R2, and the
 * split that matters (hot vs cold) is made by placement, not by the store.
 *
 * Note that B2 bucket names are unique across ALL B2 accounts, not just yours,
 * so these defaults are placeholders that will not exist for you. Set them.
 */
const BUCKETS: Record<StorageClass, string> = {
  delivery: process.env.B2_BUCKET_SPLATS ?? "spark-splats",
  archive: process.env.B2_BUCKET_SPLATS ?? "spark-splats",
  ephemeral: process.env.B2_BUCKET_UPLOADS ?? "spark-uploads",
};

function quotaBytes(): number {
  const raw = process.env.B2_QUOTA_BYTES;
  if (!raw) return DEFAULT_QUOTA_BYTES;
  const n = Number(raw);
  // A malformed override must not silently become 0 (refuses every write) or
  // NaN (poisons every comparison in placement.ts into `false`).
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_QUOTA_BYTES;
}

/**
 * Read the environment on every call rather than at module scope.
 *
 * The app is expected to run with only KIRI_API_KEY set, so importing this file
 * must never be able to throw or to freeze a decision made before the process
 * finished loading its environment. Same discipline as r2.ts.
 */
function config() {
  const keyId = process.env.B2_KEY_ID;
  const applicationKey = process.env.B2_APPLICATION_KEY;
  const region = process.env.B2_REGION;
  if (!keyId || !applicationKey || !region) return null;
  return { keyId, applicationKey, region };
}

let client: S3Client | null = null;

function s3(): S3Client {
  const cfg = config();
  if (!cfg) throw new ProviderUnavailableError("b2", MISSING);
  client ??= new S3Client({
    // The region appears twice on purpose. In the hostname it selects the
    // cluster that actually holds the bucket; in `region` it goes into the
    // SigV4 credential scope, which B2 verifies. They must agree.
    region: cfg.region,
    endpoint: `https://s3.${cfg.region}.backblazeb2.com`,
    credentials: {
      // A B2 application key is a pair: the keyID is the access key id and the
      // applicationKey is the secret. The master key works too but is scoped to
      // the whole account, so use a bucket-scoped application key in production.
      accessKeyId: cfg.keyId,
      secretAccessKey: cfg.applicationKey,
    },
    // WHEN_REQUIRED, not the SDK default of WHEN_SUPPORTED. Since v3.729 the
    // default makes the client compute a CRC32 for every request body and send
    // `x-amz-sdk-checksum-algorithm`, which B2's S3 layer rejects outright —
    // uploads fail with a 400 that says nothing about checksums. WHEN_REQUIRED
    // restricts checksums to the handful of operations S3 mandates them for,
    // which B2 does implement. Integrity is not lost: SigV4 already signs a
    // SHA-256 of the payload, and we additionally record our own digest below.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return client;
}

export function createBackblazeProvider(ledger: UsageLedger): StorageProvider {
  return {
    id: "b2",
    displayName: "Backblaze B2",

    bucketFor: (cls) => BUCKETS[cls],

    async capacity(): Promise<ProviderCapacity> {
      if (!config()) {
        return {
          quotaBytes: quotaBytes(),
          usedBytes: 0,
          freeEgress: false,
          available: false,
          unavailableReason: MISSING,
        };
      }
      return {
        quotaBytes: quotaBytes(),
        usedBytes: await ledger.usedBytes("b2"),
        // Metered. See point 2 in the header — this is a placement decision, not
        // an oversight.
        freeEgress: false,
        available: true,
      };
    },

    async put(cls: StorageClass, input: PutInput): Promise<StorageObject> {
      const bucket = BUCKETS[cls];
      await s3().send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: input.key,
          Body: input.body as never,
          ContentLength: input.bytes,
          ContentType: input.contentType,
          CacheControl: input.immutable
            ? "public, max-age=31536000, immutable"
            : "public, max-age=60",
          // R2 round-trips the digest as a native `ChecksumSHA256`; B2's S3 layer
          // does not implement the full flexible-checksum set, and sending it
          // would trip the same rejection the client config above exists to
          // avoid. User metadata is the portable place to keep it: it survives
          // the round trip on every S3 implementation, comes back on HEAD, and
          // still lets a reconciliation pass detect silent corruption. What it
          // does NOT do is make the store verify the bytes on write, so the
          // guarantee here is weaker than R2's and knowingly so.
          Metadata: input.sha256 ? { sha256: input.sha256 } : undefined,
        }),
      );
      await ledger.record("b2", bucket, input.key, input.bytes);
      return {
        provider: "b2",
        bucket,
        key: input.key,
        bytes: input.bytes,
        sha256: input.sha256,
        contentType: input.contentType,
      };
    },

    async get(obj) {
      const out = await s3().send(
        new GetObjectCommand({ Bucket: obj.bucket, Key: obj.key }),
      );
      if (!out.Body) throw new Error(`b2: empty body for ${obj.bucket}/${obj.key}`);
      return out.Body.transformToWebStream();
    },

    async head(obj) {
      try {
        const out = await s3().send(
          new HeadObjectCommand({ Bucket: obj.bucket, Key: obj.key }),
        );
        return { bytes: out.ContentLength ?? 0, contentType: out.ContentType };
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },

    async delete(obj) {
      // B2 buckets can be set to keep prior versions, in which case an S3 DELETE
      // hides the file behind a delete marker instead of freeing the bytes, and
      // the ledger would then under-count real usage. Run Spark's buckets with
      // lifecycle "keep only the last version"; HEADROOM_RESERVE in
      // ../placement.ts absorbs the difference either way.
      await s3().send(new DeleteObjectCommand({ Bucket: obj.bucket, Key: obj.key }));
      await ledger.forget("b2", obj.bucket, obj.key);
    },

    async signedReadUrl(obj, ttlSec): Promise<SignedUrl> {
      // B2 caps presigned URL lifetime at 7 days, same as SigV4 everywhere. Our
      // callers ask for minutes, so no clamp is added — a clamp that never fires
      // is a lie waiting to be believed.
      const url = await getSignedUrl(
        s3(),
        new GetObjectCommand({ Bucket: obj.bucket, Key: obj.key }),
        { expiresIn: ttlSec },
      );
      return { url, expiresAt: new Date(Date.now() + ttlSec * 1000).toISOString() };
    },

    // `auth` is unused for the same reason as R2: a presigned PUT is already
    // scoped to one bucket, key, content-type and length and expires in an hour,
    // so there is no broader authority that could leak into the browser.
    async createResumableUpload(cls, input): Promise<ResumableUpload> {
      const bucket = BUCKETS[cls];
      // Also a single presigned PUT rather than true multipart — and here the
      // limit is OURS, not B2's. B2 implements CreateMultipartUpload/UploadPart
      // fully (parts of 5 MB–5 GB, up to 10,000 of them), but ResumableUpload is
      // a single `endpoint` + `token`, which cannot carry a per-part URL list or
      // an upload id. Expressing real multipart means changing that interface
      // for every provider, so it waits until the upload cap actually needs it.
      //
      // The ceiling this leaves is B2's 5 GB single-object PUT limit, which is
      // an order of magnitude above anything the capture flow accepts today.
      const url = await getSignedUrl(
        s3(),
        new PutObjectCommand({
          Bucket: bucket,
          Key: input.key,
          ContentType: input.contentType,
          ContentLength: input.bytes,
        }),
        { expiresIn: 60 * 60 },
      );
      return {
        protocol: "s3-multipart",
        endpoint: url,
        token: "",
        object: { provider: "b2", bucket, key: input.key },
      };
    },
  };
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404;
}
