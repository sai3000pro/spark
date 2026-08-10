/**
 * Supabase Storage — the overflow tier.
 *
 * Free tier, as of 2026-08: 1 GB stored and 5 GB egress per month, where that
 * egress allowance is SHARED with every API call the app makes. That sharing is
 * the whole reason this is a secondary provider rather than a peer: ~600
 * downloads of an 8 MB SPZ would consume the month's entire budget for the
 * application, auth round-trips and RSC payloads included.
 *
 * So placement sends cold bytes here first (see ../placement.ts) — a PLY master
 * is written once and read almost never, which makes it the only thing that can
 * safely occupy a tier whose egress we cannot afford to spend. That inversion is
 * what turns an otherwise-unusable 1 GB into real capacity.
 *
 * It does bring one thing R2 does not: a TUS resumable endpoint. Phone uploads
 * on cellular get interrupted, and resuming at a byte offset beats restarting a
 * 300 MB transfer. Worth remembering when the upload cap rises.
 */
import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

const QUOTA_BYTES = 1024 * 1024 * 1024;

const BUCKETS: Record<StorageClass, string> = {
  delivery: "spark-splats",
  archive: "spark-archive",
  ephemeral: "spark-uploads",
};

function config() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return { url, serviceKey };
}

let client: SupabaseClient | null = null;

function admin(): SupabaseClient {
  const cfg = config();
  if (!cfg) {
    throw new ProviderUnavailableError(
      "supabase",
      "set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  client ??= createClient(cfg.url, cfg.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export function createSupabaseStorageProvider(ledger: UsageLedger): StorageProvider {
  return {
    id: "supabase",
    displayName: "Supabase Storage",

    bucketFor: (cls) => BUCKETS[cls],

    async capacity(): Promise<ProviderCapacity> {
      if (!config()) {
        return {
          quotaBytes: QUOTA_BYTES,
          usedBytes: 0,
          freeEgress: false,
          available: false,
          unavailableReason:
            "not configured — set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
        };
      }
      return {
        quotaBytes: QUOTA_BYTES,
        usedBytes: await ledger.usedBytes("supabase"),
        freeEgress: false,
        available: true,
      };
    },

    async put(cls: StorageClass, input: PutInput): Promise<StorageObject> {
      const bucket = BUCKETS[cls];
      const { error } = await admin()
        .storage.from(bucket)
        .upload(input.key, input.body as Blob | ArrayBuffer, {
          contentType: input.contentType,
          cacheControl: input.immutable ? "31536000" : "60",
          upsert: true,
        });
      if (error) throw new Error(`supabase put ${bucket}/${input.key}: ${error.message}`);
      await ledger.record("supabase", bucket, input.key, input.bytes);
      return {
        provider: "supabase",
        bucket,
        key: input.key,
        bytes: input.bytes,
        sha256: input.sha256,
        contentType: input.contentType,
      };
    },

    async get(obj) {
      const { data, error } = await admin().storage.from(obj.bucket).download(obj.key);
      if (error) throw new Error(`supabase get ${obj.bucket}/${obj.key}: ${error.message}`);
      return data.stream() as unknown as ReadableStream;
    },

    async head(obj) {
      // Storage has no HEAD; list the parent prefix and match the leaf. Cheap
      // enough at our fan-out, and it is the documented way to stat an object.
      const slash = obj.key.lastIndexOf("/");
      const prefix = slash === -1 ? "" : obj.key.slice(0, slash);
      const leaf = slash === -1 ? obj.key : obj.key.slice(slash + 1);
      const { data, error } = await admin()
        .storage.from(obj.bucket)
        .list(prefix, { search: leaf, limit: 100 });
      if (error) throw new Error(`supabase head ${obj.bucket}/${obj.key}: ${error.message}`);
      const hit = data?.find((f) => f.name === leaf);
      if (!hit) return null;
      const meta = hit.metadata as { size?: number; mimetype?: string } | null;
      return { bytes: meta?.size ?? 0, contentType: meta?.mimetype };
    },

    async delete(obj) {
      const { error } = await admin().storage.from(obj.bucket).remove([obj.key]);
      if (error) throw new Error(`supabase delete ${obj.bucket}/${obj.key}: ${error.message}`);
      await ledger.forget("supabase", obj.bucket, obj.key);
    },

    async signedReadUrl(obj, ttlSec): Promise<SignedUrl> {
      const { data, error } = await admin()
        .storage.from(obj.bucket)
        .createSignedUrl(obj.key, ttlSec);
      if (error || !data) {
        throw new Error(`supabase sign ${obj.bucket}/${obj.key}: ${error?.message}`);
      }
      return {
        url: data.signedUrl,
        expiresAt: new Date(Date.now() + ttlSec * 1000).toISOString(),
      };
    },

    async createResumableUpload(cls, input, auth): Promise<ResumableUpload> {
      const cfg = config();
      if (!cfg) throw new ProviderUnavailableError("supabase", "not configured");
      if (!auth.accessToken) {
        // Never substitute the service role key here. It bypasses RLS on every
        // table in the database, and this value is handed to a browser. An
        // upload that cannot be authorised as the user must fail.
        throw new ProviderUnavailableError(
          "supabase",
          "a user access token is required for resumable upload; refusing to issue a privileged credential",
        );
      }
      const bucket = BUCKETS[cls];
      // TUS. The client sends `Authorization: Bearer <token>` plus `x-upsert`,
      // and puts bucketName/objectName in the upload metadata. Storage RLS is
      // evaluated against this token, which is what confines the write to the
      // user's own prefix.
      return {
        protocol: "tus",
        endpoint: `${cfg.url}/storage/v1/upload/resumable`,
        token: auth.accessToken,
        object: { provider: "supabase", bucket, key: input.key },
      };
    },
  };
}
