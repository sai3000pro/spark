/**
 * The service-role client. It bypasses row level security on every table.
 *
 * Read that sentence again before importing this module. Nothing in
 * supabase/migrations/007_rls.sql applies to a query made with this client: not
 * `can_read_journey`, not `owns_journey`, not `is_guest`. `auth.uid()` is null,
 * so a policy that says "owner_id = auth.uid()" does not narrow anything — it is
 * simply not consulted. Every authorization decision a caller wants made here has
 * to be made BY the caller, in TypeScript, correctly, every time.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHEN IT IS ACTUALLY THE RIGHT TOOL
 *
 * Three jobs, all of which are the worker's rather than a person's:
 *
 *   · writing `splat_assets` after a reconstruction lands — there is no user
 *     session behind a webhook from KIRI, and 007 deliberately gives that table
 *     no client write policy at all;
 *   · the storage ledger in lib/storage/ledger.ts — fleet-wide accounting that
 *     belongs to no user, on a table whose RLS is enabled with zero policies;
 *   · anything that must be true across users, like a purge or a migration.
 *
 * If the answer depends on WHO IS ASKING, this is the wrong client. Use
 * lib/db/server.ts and let Postgres decide.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `server-only` IS LOAD-BEARING AND NOT DECORATION
 *
 * The import below makes a client bundle that reaches this module fail at BUILD
 * time with a legible error, instead of shipping. Without it the failure mode is
 * that `process.env.SUPABASE_SERVICE_ROLE_KEY` is un-prefixed and therefore
 * inlines as `undefined` in the browser — the client is constructed, the key is
 * empty, nothing throws loudly, and the bug looks like "some queries return no
 * rows in production". A build error is enormously better than that.
 *
 * The key is also never returned from any API response and never logged, for the
 * same reason KIRI_API_KEY is not: one leak is permanent.
 *
 * `persistSession` and `autoRefreshToken` are off because there is no session to
 * persist — this client is not a person, and a refresh timer in a serverless
 * function is a handle that keeps the process alive for nothing.
 */
import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { supabaseConfig } from "./config";

let client: SupabaseClient | null = null;

/**
 * The admin client, or `null` when either the project URL or the service-role
 * key is absent.
 *
 * Null is a normal state, not an error: the demo deployment has no Supabase
 * project, and a deployment may legitimately hold only the anon key (a preview
 * build, say) in which case reads work and worker writes do not. Callers take the
 * degraded path — lib/storage/index.ts, for one, falls back to an in-memory
 * ledger rather than refusing to run.
 */
export function adminDb(): SupabaseClient | null {
  const cfg = supabaseConfig();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!cfg || !serviceKey) return null;
  client ??= createClient(cfg.url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
