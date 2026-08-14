/**
 * The session data access layer. One question — "who is asking?" — answered in
 * exactly one place.
 *
 * Every server component, route handler and server action that needs an identity
 * calls `getCurrentUser()`. Nothing reads the cookie itself, nothing calls
 * `auth.getUser()` directly, nothing passes a user id down from the client. The
 * value of routing it all through here is that the security decisions below are
 * made once instead of being re-litigated at forty call sites, some of which
 * would get it wrong.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * getUser(), NEVER getSession(). THIS IS THE IMPORTANT ONE.
 *
 * `getSession()` reads the JWT out of the cookie and decodes it. It does not
 * verify the signature server-side. The cookie is data the client sent us, and
 * the client can send whatever it likes — a hand-written JWT with
 * `sub: <someone else's uuid>` decodes perfectly well. Anything gated on
 * `getSession().user.id` on the server is therefore gated on a value the attacker
 * chose. It is the classic Supabase footgun, and it looks completely fine in
 * review because the call site reads identically.
 *
 * `getUser()` sends the token to the auth server, which verifies the signature
 * and that the user still exists and has not been banned or deleted since the
 * token was minted. It costs a network round trip. That round trip is the price
 * of the answer being true.
 *
 * The one place `getSession()` would be acceptable is client-side rendering of
 * cosmetic state, where the user is only lying to themselves. That is not what
 * this file is for, so it does not appear anywhere in it. Do not "optimize" this.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY React.cache
 *
 * A single render can ask "who is asking?" a dozen times — the layout, the page,
 * a couple of components, the route handler behind a server action. Each ask is
 * an HTTPS round trip to the auth server, so naively that is a dozen. `cache()`
 * memoizes per REQUEST (React clears it between requests, which is the property
 * that matters), so it becomes one.
 *
 * Note what is NOT being cached: this is not a TTL, not an LRU, not a module
 * global. Those would all outlive the request and hand user A's identity to user
 * B. The scope is the reason this is safe; see lib/db/server.ts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO SESSION IS CREATED BY ASKING
 *
 * Reading identity is a pure read. Nothing here signs anyone in, anonymously or
 * otherwise — the landing page, the globe and a shared walk must all be
 * renderable by someone who will never sign up, without minting an `auth.users`
 * row for the privilege. Sign-in happens in app/auth/* when a person asks for it,
 * and in lib/auth/guest.ts when a person WRITES something. Never here.
 *
 * The cookie sniff below is part of that promise as well as an optimization: with
 * no auth cookie on the request there is provably no session, so we return null
 * without constructing a client or touching the network. On the landing page —
 * the most-hit route in the app and the one a demo opens on — that turns the auth
 * layer into a few string comparisons.
 */
import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { isAuthCookieName, isAuthConfigured } from "@/lib/db/config";
import { createServerDb } from "@/lib/db/server";

/**
 * What the app knows about the person asking.
 *
 * Deliberately a narrow projection of Supabase's `User`, not the object itself.
 * The raw object carries `app_metadata`, identity providers and the full token
 * payload, and once that shape is passed around it ends up serialized into a
 * client component's props, where it does not belong. Everything else about a
 * person lives in `public.profiles` (see 001_extensions_and_identity.sql) and is
 * read with the ordinary client under RLS.
 */
export interface CurrentUser {
  id: string;
  /** Null for a guest — an anonymous user has no address until they upgrade. */
  email: string | null;
  /**
   * Anonymous sign-in, i.e. someone who has walked but never given an email.
   *
   * Mirrors `public.is_guest()` in 007_rls.sql, which reads the same
   * `is_anonymous` claim out of the JWT. The database is what enforces the
   * consequences — a guest's walk cannot be `public`, they cannot create groups
   * and they cannot invite — this flag exists so the UI can say so before the
   * insert fails rather than after.
   */
  isGuest: boolean;
}

/**
 * Who is asking, or null.
 *
 * Null means all of: auth is not configured in this deployment, or nobody is
 * signed in, or the token was rejected. Callers do not get to tell those apart
 * from this function, and almost none of them should care — the honest response
 * to all three is the same public view. Use `describeAuth()` when the difference
 * genuinely matters, which is mostly for rendering the sign-in affordance.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  if (!isAuthConfigured()) return null;

  // No auth cookie ⇒ no session, provably. Skip the client and the round trip.
  const store = await cookies();
  if (!store.getAll().some((c) => isAuthCookieName(c.name))) return null;

  const db = await createServerDb();
  if (!db) return null;

  try {
    // getUser, not getSession. See the block comment at the top of this file.
    const { data, error } = await db.auth.getUser();
    if (error || !data.user) return null;
    return {
      id: data.user.id,
      email: data.user.email ?? null,
      isGuest: data.user.is_anonymous === true,
    };
  } catch {
    // The auth server being unreachable must read as "signed out", not as a 500.
    // Every surface in this app has a public rendering; falling back to it keeps
    // the site up through a Supabase incident instead of taking it down with it.
    return null;
  }
});

export interface AuthState {
  /** Is there a Supabase project behind this deployment at all? */
  configured: boolean;
  user: CurrentUser | null;
}

/**
 * The same answer, plus whether sign-in exists here.
 *
 * For the header and for anything that must choose between "Sign in" and saying
 * nothing at all: offering a sign-in button that cannot work is worse than
 * offering none, and this is the only distinction that justifies leaking the
 * deployment's configuration into the UI.
 */
export async function describeAuth(): Promise<AuthState> {
  return { configured: isAuthConfigured(), user: await getCurrentUser() };
}
