/**
 * The storage fleet — one entry point over however many providers are configured.
 *
 * Callers say what an object is FOR and hand over the bytes; they never name a
 * provider. Placement decides, the object records where it landed, and reads
 * follow that record. Adding or removing a provider is therefore a config
 * change, not a migration: existing objects keep pointing at wherever they
 * already are.
 *
 * See ./provider.ts for why multiple providers exist at all, and ./placement.ts
 * for the rule that decides between them.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createDbLedger, createMemoryLedger, type UsageLedger } from "./ledger";
import { choose, rank, summarise, type FleetCapacity } from "./placement";
import { createR2Provider } from "./providers/r2";
import { createSupabaseStorageProvider } from "./providers/supabaseStorage";
import {
  ProviderUnavailableError,
  type PutInput,
  type ResumableUpload,
  type SignedUrl,
  type StorageClass,
  type StorageObject,
  type StorageProvider,
  type StorageProviderId,
  type UploadAuth,
} from "./provider";

export * from "./provider";
export { classOf } from "./keys";
export type { FleetCapacity } from "./placement";

export interface Fleet {
  providers: StorageProvider[];
  get(id: StorageProviderId): StorageProvider;
  capacity(): Promise<FleetCapacity>;
  /** Place and write in one step. Falls through on a provider-level failure. */
  put(cls: StorageClass, input: PutInput): Promise<StorageObject>;
  read(obj: Pick<StorageObject, "provider" | "bucket" | "key">): Promise<ReadableStream>;
  remove(obj: Pick<StorageObject, "provider" | "bucket" | "key">): Promise<void>;
  signedReadUrl(
    obj: Pick<StorageObject, "provider" | "bucket" | "key">,
    ttlSec?: number,
  ): Promise<SignedUrl>;
  createResumableUpload(
    cls: StorageClass,
    input: { key: string; bytes: number; contentType: string },
    auth: UploadAuth,
  ): Promise<ResumableUpload>;
}

/**
 * Build the fleet.
 *
 * Pass the admin Supabase client to get a durable ledger; omit it and usage is
 * tracked in memory, which is right for local dev and tests and wrong for
 * anything else. Firebase Storage is deliberately absent — since 2024-10-30 a
 * new project cannot provision a bucket without a billing account, so it cannot
 * contribute free capacity and pretending otherwise would just move the failure
 * to runtime. Firebase earns its place in this stack through Realtime Database
 * and Cloud Messaging instead; see lib/firebase/.
 */
export function createFleet(db?: SupabaseClient): Fleet {
  const ledger: UsageLedger = db ? createDbLedger(db) : createMemoryLedger();
  const providers = [createR2Provider(ledger), createSupabaseStorageProvider(ledger)];
  const byId = new Map(providers.map((p) => [p.id, p]));

  const entries = async () =>
    Promise.all(providers.map(async (p) => ({ provider: p, capacity: await p.capacity() })));

  const get = (id: StorageProviderId): StorageProvider => {
    const p = byId.get(id);
    if (!p) {
      throw new ProviderUnavailableError(id, "not registered in this deployment");
    }
    return p;
  };

  return {
    providers,
    get,

    async capacity() {
      return summarise(await entries());
    },

    async put(cls, input) {
      // Rank rather than choose, so a provider that reports room but fails the
      // write does not lose the object. Capacity and availability are different
      // questions and only the second one is answered by actually trying.
      const options = rank(cls, await entries(), input.bytes);
      if (!options.length) {
        // Re-run choose purely to raise the NoCapacityError with its full
        // "tried" list, which is the message worth showing the user.
        choose(cls, await entries(), input.bytes);
      }
      let lastErr: unknown;
      for (const option of options) {
        try {
          const obj = await option.provider.put(cls, input);
          if (option.degraded) {
            console.warn(
              `[storage] ${cls} ${input.key} → ${option.provider.id}: ${option.reason}`,
            );
          }
          return obj;
        } catch (err) {
          lastErr = err;
          console.warn(`[storage] ${option.provider.id} put failed, trying next:`, err);
        }
      }
      throw lastErr ?? new Error(`storage: no provider accepted ${input.key}`);
    },

    read: (obj) => get(obj.provider).get(obj),
    remove: (obj) => get(obj.provider).delete(obj),
    signedReadUrl: (obj, ttlSec = 900) => get(obj.provider).signedReadUrl(obj, ttlSec),

    async createResumableUpload(cls, input, auth) {
      const options = rank(cls, await entries(), input.bytes);
      if (!options.length) choose(cls, await entries(), input.bytes);
      let lastErr: unknown;
      for (const option of options) {
        try {
          return await option.provider.createResumableUpload(cls, input, auth);
        } catch (err) {
          // A provider that refuses to mint a scoped credential (see the
          // Supabase adapter) lands here and we move on rather than downgrade.
          lastErr = err;
          console.warn(`[storage] ${option.provider.id} cannot host this upload:`, err);
        }
      }
      throw lastErr ?? new Error(`storage: no provider could host ${input.key}`);
    },
  };
}
