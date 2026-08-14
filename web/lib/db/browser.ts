/**
 * The browser database client — for realtime subscriptions and client-side reads.
 *
 * Same anon key, same RLS, same session cookie as the server client; the only
 * difference is which side of the wire it runs on. Anything this client can read,
 * a person with the devtools open could already read by talking to PostgREST
 * directly, which is exactly why 007_rls.sql is written the way it is.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * COOKIES, NOT LOCAL STORAGE
 *
 * `createBrowserClient` persists the session in COOKIES rather than in
 * localStorage, which is the difference that makes server rendering work at all:
 * a token in localStorage is invisible to the server, so every page would render
 * signed-out and then flicker signed-in after hydration. Cookies travel with the
 * document request, so the server and the browser agree about who you are on the
 * first paint. Do not pass a custom `cookies` option to "fix" anything here —
 * the default implementation matches what lib/db/server.ts and proxy.ts read.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A SINGLETON, AND WHY THAT IS SAFE HERE
 *
 * The opposite of the server rule, for the opposite reason: a browser tab has
 * exactly one user, so there is no cross-request bleed to fear, and a second
 * client would open a second auth listener, a second refresh timer and a second
 * realtime socket against the same session. React Strict Mode double-invokes
 * effects in development, so without the singleton the duplicate is the DEFAULT
 * rather than the exception.
 */
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseConfig } from "./config";

let client: SupabaseClient | null = null;

/**
 * The browser client, or `null` when this deployment has no Supabase project.
 *
 * Components must branch on the null rather than assume — the demo build has no
 * project, and a component that throws during render there takes the page with
 * it. The honest UI for `null` is "sign-in is off in this build", not a spinner.
 */
export function browserDb(): SupabaseClient | null {
  const cfg = supabaseConfig();
  if (!cfg) return null;
  client ??= createBrowserClient(cfg.url, cfg.anonKey);
  return client;
}
