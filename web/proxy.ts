/**
 * Proxy — the one job of which is keeping the auth cookie fresh.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FILE RUNS BEFORE EVERY MATCHED REQUEST. TREAT IT ACCORDINGLY.
 *
 * There is no "this page is broken" failure mode here; there is only "the site
 * is down". A throw, a stray redirect, a client constructed from an undefined
 * URL — any of those takes the landing page, the globe, the capture flow and
 * every API route with it at once.
 *
 * This deployment ships with NO Supabase project. So the first thing that
 * happens below is an env check that returns an untouched pass-through, before
 * anything is imported-into-existence, before a cookie is read, before the SDK
 * is handed a single value. Everything after that check is wrapped so that a
 * Supabase outage degrades to "signed out" rather than to a 500. The site
 * without auth is the entire product today; the site with a broken proxy is
 * nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `middleware.ts` IS DEPRECATED — THIS IS THE REPLACEMENT
 *
 * Next 16 renamed the convention: the file is `proxy.ts` at the project root and
 * the export is `proxy`, not `middleware`. The rename came with one rule that is
 * easy to violate from memory: **never export `runtime` from this file.** Proxy
 * defaults to the Node.js runtime in Next 16 and the `runtime` segment config is
 * not available here — setting it throws. The `export const runtime = "edge"`
 * that every pre-16 middleware example carries is now a build error.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE COOKIE NEEDS REFRESHING HERE AT ALL
 *
 * Access tokens are short-lived and Server Components cannot set cookies — the
 * response headers are already committed by the time one runs. So a token that
 * expires mid-render gets refreshed by the SDK and the write is thrown away
 * (lib/db/server.ts swallows it deliberately). Without a proxy the user is
 * logged out roughly one token lifetime after signing in, intermittently, in a
 * way that reproduces only after waiting an hour.
 *
 * The proxy runs before the render, on a response it owns, so the write lands.
 * `getUser()` is the call that triggers the refresh — and it is `getUser()`, not
 * `getSession()`, for the reason set out at length in lib/auth/session.ts: only
 * getUser verifies the JWT with the auth server. A proxy that trusts an
 * unverified cookie is a proxy that can be handed a forged one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTE ON WHAT THIS PROXY DOES NOT DO: IT DOES NOT AUTHORIZE ANYTHING.
 *
 * No redirects, no gates, no "if not signed in, bounce to /login". Next's own
 * docs are explicit that proxy is for optimistic checks and not for session
 * management, and there is a concrete reason beyond style: Server Functions are
 * POSTs to whatever route they are declared in, so a matcher change or a
 * refactor silently removes proxy coverage from them. Authorization lives in
 * 007_rls.sql, where it is enforced by Postgres on every query regardless of
 * which route ran. This file only refreshes a token.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Read the env here rather than importing lib/db/config.ts.
 *
 * The proxy is bundled separately and, per Next's own guidance, should not lean
 * on shared modules — an import graph that reaches a `server-only` module or a
 * heavy transitive dependency turns into a cold-start cost paid on every single
 * request. Two `process.env` reads are not worth a shared module. They are
 * spelled out literally for the same reason as in lib/db/config.ts: Next
 * substitutes the exact text, not a computed key.
 */
function supabaseEnv(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  // ── The guard. Nothing above this line touches Supabase. ──────────────────
  const cfg = supabaseEnv();
  if (!cfg) return NextResponse.next();

  /**
   * No auth cookie ⇒ nothing to refresh, provably. Skip the round trip.
   *
   * This is not only an optimization, it is what keeps the promise made in
   * lib/auth/guest.ts: a visitor who has never written anything gets no session,
   * and the proxy must not be the thing that quietly changes that. It also keeps
   * the anonymous case at zero network calls per request — which, on the landing
   * page during a demo, is the difference between instant and not.
   *
   * The name is `sb-<project-ref>-auth-token`, sometimes chunked `.0`/`.1`.
   */
  const hasAuthCookie = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));
  if (!hasAuthCookie) return NextResponse.next();

  try {
    let response = NextResponse.next({ request });

    const supabase = createServerClient(cfg.url, cfg.anonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        /**
         * The dance below looks redundant and is not. The refreshed cookie has
         * to reach BOTH directions: onto `request`, so the render that happens
         * after this sees the new token instead of the expired one it arrived
         * with; and onto `response`, so the browser stores it and the next
         * request does not refresh again. Setting only the response gives a
         * render that still sees a stale token; setting only the request gives
         * an infinite refresh loop. The response is rebuilt from the mutated
         * request because that is the only way to carry request headers forward.
         *
         * `headers` carries the no-store family the SDK asks for. A response
         * with a `Set-Cookie` full of session tokens must never be cached by a
         * CDN — the failure there is serving one person's session to another,
         * which is as bad as it sounds.
         */
        setAll: (cookiesToSet, headers) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
          }
        },
      },
    });

    // The call that verifies the token and, if it is close to expiry, refreshes
    // it — which is what fires `setAll` above. The result is deliberately
    // discarded: the proxy makes no decisions, it only keeps the cookie alive.
    await supabase.auth.getUser();

    return response;
  } catch {
    // Supabase down, DNS gone, key rotated — the site keeps working, signed out.
    // Never let the auth layer be the thing that takes the app offline.
    return NextResponse.next();
  }
}

/**
 * Where this runs, and — more interestingly — where it must not.
 *
 * `/api/*` IS EXCLUDED, DELIBERATELY. Next buffers a matched request's body in
 * memory so it can be read twice (once here, once in the handler), capped at
 * 10 MB by default. This app POSTs video: the phone handoff upload
 * (/api/capture/handoff/[id]/upload) and /api/upload/walk routinely carry tens
 * of megabytes. Running the proxy over those would mean buffering every clip in
 * proxy memory and logging a truncation warning for each one, purchasing
 * nothing — a Route Handler builds its own client via lib/db/server.ts, where
 * `setAll` genuinely writes to the response, so API routes refresh their own
 * cookies perfectly well without help.
 *
 * Static assets are excluded because the proxy has nothing to say about a PNG,
 * and per Next's docs an unmatched proxy would otherwise run on every chunk,
 * font and image in `_next/static` and `public/`.
 *
 * `map-lib` is the vendored MapLibre worker bundle (scripts/copy-maplibre-worker),
 * and `mock` holds the demo splats — both are public, static, and hot.
 *
 * Matchers must be statically analysable string literals; a computed value is
 * silently ignored, which fails open, i.e. runs everywhere. Hence the one long
 * regex rather than anything assembled.
 */
export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|map-lib|mock|favicon.ico|icon.png|manifest.webmanifest|sw.js).*)",
  ],
};
