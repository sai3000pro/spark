/**
 * The request-scoped database client — the one that speaks as the signed-in user.
 *
 * It carries the session cookie, so every query it makes is evaluated by Postgres
 * with `auth.uid()` set, and the policies in supabase/migrations/007_rls.sql are
 * what decide the answer. That is the whole point: authorization is enforced by
 * the database, not by the route handler that happens to be calling it. A bug in
 * an API route cannot hand out someone else's walk, because the rows never leave
 * Postgres in the first place.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A NEW CLIENT PER REQUEST, ALWAYS
 *
 * There is no module-level singleton here and there must never be one. The
 * client closes over ONE request's cookies; cached across requests in a warm
 * serverless container it would answer request B with request A's session. That
 * is not a subtle cache bug, it is serving one user another user's private data.
 * The per-request cost is an object allocation, which is nothing.
 *
 * For request-level deduplication of the actual auth round-trip, see
 * lib/auth/session.ts — that is what React.cache is for, and it is scoped to a
 * single render, which is the safe scope.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `setAll` IS ALLOWED TO FAIL SILENTLY
 *
 * Server Components cannot set cookies — by the time one runs, the response
 * headers are already committed. The Supabase client does not know that, so when
 * it refreshes an expiring token mid-render it will try, and `cookies().set()`
 * throws. Letting that throw propagate would turn a routine token refresh into a
 * 500 on a page that rendered perfectly well.
 *
 * Swallowing it is only correct BECAUSE proxy.ts exists: the proxy runs before
 * the render, refreshes the token there, and writes the new cookie onto a
 * response it does own. The render then reads an already-fresh cookie and never
 * needs to write. Delete proxy.ts and this catch becomes a silent logout loop —
 * the two files are one mechanism, not two.
 *
 * In Route Handlers and Server Actions the write DOES land, which is what makes
 * app/auth/* and lib/auth/guest.ts able to mint sessions at all.
 */
import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { supabaseConfig } from "./config";

/**
 * Build a client bound to this request's cookies, or `null` when this deployment
 * has no Supabase project. Callers MUST handle the null — see ./config.ts.
 */
export async function createServerDb(): Promise<SupabaseClient | null> {
  const cfg = supabaseConfig();
  if (!cfg) return null;

  const store = await cookies();

  return createServerClient(cfg.url, cfg.anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            store.set(name, value, options);
          }
        } catch {
          // Server Component render. See the block comment above: proxy.ts has
          // already refreshed this session on a response it can write to.
        }
      },
    },
  });
}
