/**
 * Cloudflare R2, over the S3 API.
 *
 * The primary provider, for one reason that outweighs everything else: egress
 * is free at any volume. Every other free object store meters the bytes going
 * out, and this app's whole job is handing multi-megabyte splats to browsers.
 *
 * Free tier, as of 2026-08: 10 GB stored, 1M class-A (write/list) and 10M
 * class-B (read) operations per month, unlimited egress. Ops are not close to
 * binding — a capture is a handful of writes — so only stored bytes are
 * tracked.
 *
 * R2 does expose usage, but through a separate GraphQL analytics API on a
 * multi-minute delay. Calling that on the write path would be slow and
 * rate-limited and still wrong, so `capacity()` reads our own ledger. See
 * ../ledger.ts.
 *
 * Note this deliberately does NOT sign public delivery URLs. A presigned URL
 * carries its signature in the query string, so every issued URL is a distinct
 * CDN cache key and nothing is ever served from cache. Public objects go
 * through the CDN worker on a stable path; presigning here is for uploads and
 * private reads only.
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

const QUOTA_BYTES = 10 * 1024 * 1024 * 1024;

const BUCKETS: Record<StorageClass, string> = {
  delivery: process.env.R2_BUCKET_SPLATS ?? "spark-splats",
  archive: process.env.R2_BUCKET_SPLATS ?? "spark-splats",
  ephemeral: process.env.R2_BUCKET_UPLOADS ?? "spark-uploads",
};

function config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) return null;
  return { accountId, accessKeyId, secretAccessKey };
}

let client: S3Client | null = null;

function s3(): S3Client {
  const cfg = config();
  if (!cfg) {
    throw new ProviderUnavailableError(
      "r2",
      "set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY",
    );
  }
  client ??= new S3Client({
    // R2 ignores the region but the SDK requires one; "auto" is what Cloudflare
    // documents and what their endpoint expects.
    region: "auto",
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
  return client;
}

export function createR2Provider(ledger: UsageLedger): StorageProvider {
  return {
    id: "r2",
    displayName: "Cloudflare R2",

    bucketFor: (cls) => BUCKETS[cls],

    async capacity(): Promise<ProviderCapacity> {
      if (!config()) {
        return {
          quotaBytes: QUOTA_BYTES,
          usedBytes: 0,
          freeEgress: true,
          available: false,
          unavailableReason:
            "not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY",
        };
      }
      return {
        quotaBytes: QUOTA_BYTES,
        usedBytes: await ledger.usedBytes("r2"),
        freeEgress: true,
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
          // Round-trips as the object's checksum so a later read can detect
          // corruption without re-hashing the whole file.
          ChecksumSHA256: input.sha256 ? hexToBase64(input.sha256) : undefined,
        }),
      );
      await ledger.record("r2", bucket, input.key, input.bytes);
      return {
        provider: "r2",
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
      if (!out.Body) throw new Error(`r2: empty body for ${obj.bucket}/${obj.key}`);
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
      await s3().send(new DeleteObjectCommand({ Bucket: obj.bucket, Key: obj.key }));
      await ledger.forget("r2", obj.bucket, obj.key);
    },

    async signedReadUrl(obj, ttlSec): Promise<SignedUrl> {
      const url = await getSignedUrl(
        s3(),
        new GetObjectCommand({ Bucket: obj.bucket, Key: obj.key }),
        { expiresIn: ttlSec },
      );
      return { url, expiresAt: new Date(Date.now() + ttlSec * 1000).toISOString() };
    },

    // `auth` is unused: a presigned PUT is already scoped to exactly one bucket,
    // key, content-type and length, and expires in an hour. There is no broader
    // authority to leak, so nothing about the user needs to reach the signature.
    async createResumableUpload(cls, input): Promise<ResumableUpload> {
      const bucket = BUCKETS[cls];
      // A presigned PUT, not true multipart. R2 supports S3 multipart, but the
      // browser-side orchestration (part sizing, retry, completion) is real work
      // and a single presigned PUT already handles the sizes we accept. When the
      // cap rises past ~1 GB this becomes CreateMultipartUpload + per-part URLs.
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
        object: { provider: "r2", bucket, key: input.key },
      };
    },
  };
}

function hexToBase64(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return Buffer.from(bytes).toString("base64");
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404;
}
