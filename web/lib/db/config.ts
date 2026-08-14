/**
 * Is there a Supabase project behind this deployment at all?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS AS A SEPARATE THING
 *
 * Auth in this app is OPTIONAL, and not in the polite sense. The demo build ships
 * with one variable set — KIRI_API_KEY — and nothing else. There is no Supabase
 * project, no anon key, no auth server to talk to. Everything auth-shaped must
 * therefore degrade to a no-op rather than to an error, because the alternative
 * is not "sign-in is unavailable", it is "the site is a 500". `proxy.ts` runs on
 * every request; a client constructed from `undefined` throws inside the
 * Supabase SDK, and a throw there takes down the landing page, the globe, the
 * capture flow and the reader in one go.
 *
 * So the rule for every caller is the same shape: ask this module, get `null`,
 * take the no-auth branch. Never `!` an env var, never assume, never construct a
 * client optimistically and catch later — by then a cookie may already have been
 * touched.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE LITERAL `process.env.NEXT_PUBLIC_…` SPELLING MATTERS
 *
 * Next replaces the exact TEXT `process.env.NEXT_PUBLIC_SUPABASE_URL` at build
 * time when it appears in code that reaches the browser. It does not resolve
 * `process.env[name]`, nor a destructured `const { NEXT_PUBLIC_… } = process.env`.
 * Written any other way this returns `null` in the client bundle even on a fully
 * configured deployment, and the browser client silently stops working while the
 * server one keeps going — a difference that costs an evening to find. Hence the
 * two spelled-out reads below and no clever indirection.
 *
 * Only the two PUBLIC keys live here. The service-role key is deliberately not
 * in this file: this module is imported by browser code, and a module that even
 * MENTIONS `SUPABASE_SERVICE_ROLE_KEY` in a client bundle is a mistake waiting to
 * be made by the next person who adds a field to the returned object. It lives in
 * ./admin.ts behind `server-only`, where the import graph enforces the boundary.
 */

export interface SupabaseConfig {
  url: string;
  /**
   * Safe in the browser by design: the anon key carries no authority of its own.
   * Every table in supabase/migrations/007_rls.sql is behind row level security,
   * so this key can only ever see what `auth.uid()` is allowed to see.
   */
  anonKey: string;
}

/**
 * The public Supabase config, or `null` when this deployment has none.
 *
 * Empty strings count as absent. `.env.example` ships these keys with empty
 * values, and a copied-but-unfilled `.env.local` is the single most likely state
 * of a fresh checkout — treating `""` as "configured" would produce a client
 * pointed at the empty-string URL and a stack of confusing fetch failures.
 */
export function supabaseConfig(): SupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/** Sugar for the many call sites that only need the yes/no. */
export function isAuthConfigured(): boolean {
  return supabaseConfig() !== null;
}

/**
 * The one sentence every unconfigured surface says, in one place.
 *
 * It names the variables rather than saying "auth unavailable", because the only
 * person who ever sees this string is a developer who is one `.env.local` edit
 * away from fixing it.
 */
export const AUTH_UNCONFIGURED_DETAIL =
  "Sign-in is switched off in this deployment. Set NEXT_PUBLIC_SUPABASE_URL and " +
  "NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local to turn it on; see .env.example.";

/**
 * Cookie names @supabase/ssr uses for the session, as a predicate.
 *
 * The real name is `sb-<project-ref>-auth-token`, optionally chunked with a
 * `.0`/`.1` suffix when the token is too large for one cookie. We match on shape
 * rather than deriving the project ref, because the ref would have to be parsed
 * out of the URL and would be wrong for self-hosted deployments.
 *
 * Used to answer "could this request possibly be signed in?" without building a
 * client or making a network call. See lib/auth/session.ts and proxy.ts for why
 * that question is worth answering cheaply.
 */
export function isAuthCookieName(name: string): boolean {
  return name.startsWith("sb-") && name.includes("auth-token");
}
