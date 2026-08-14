/**
 * Send a magic link. POST { email, next? }.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A LINK AND NOT A PASSWORD
 *
 * A password is a thing this app would have to store the reset flow for, the
 * strength policy for, the breach-check for, and the "I forgot it" path for —
 * four surfaces, each with its own way of leaking accounts. An email round trip
 * proves control of the address, which is the only thing a password ever
 * really established here anyway. It also means there is no credential of ours
 * that can appear in someone else's breach dump.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE ANSWER IS THE SAME WHETHER OR NOT THE ADDRESS EXISTS
 *
 * Anything that distinguishes "we sent you a link" from "no such account" turns
 * this endpoint into an account-existence oracle: feed it a list of addresses
 * and learn which of your contacts uses the app. That is a privacy leak on its
 * own, and a target list for whoever collects it. So the response is identical
 * either way, and `shouldCreateUser` is true, which additionally makes signing
 * up and signing in the same act — there is no second form to build.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE LINK IS REQUESTED FROM THE SERVER
 *
 * The flow is PKCE. Asking for the link generates a code verifier which must be
 * stored where the code exchange can find it later; this client stores it in a
 * cookie, and a Route Handler is a place where a cookie write actually lands
 * (see lib/db/server.ts for where it does not). Requesting from the server also
 * keeps the redirect target out of the client's hands entirely — `emailRedirectTo`
 * is built here from headers and a filtered path, never from a field the caller
 * can set to an arbitrary URL.
 *
 * The consequence, worth knowing before debugging it: the link must be opened in
 * THE SAME BROWSER that requested it. Different browser, no verifier cookie, no
 * exchange. That is inherent to PKCE, not a bug in this route.
 */
import { authError, authOk, authUnavailable, looksLikeEmail, originOf, safeNext } from "@/lib/auth/http";
import { createServerDb } from "@/lib/db/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // The guard comes first, before the body is even read: with no Supabase
  // project this route has nothing to do and must say so cleanly rather than
  // fall over inside the SDK.
  const db = await createServerDb();
  if (!db) return authUnavailable();

  let body: { email?: unknown; next?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; next?: unknown };
  } catch {
    return authError("invalid JSON body");
  }

  const email = body.email;
  if (!looksLikeEmail(email)) return authError("a valid email address is required");

  const next = safeNext(typeof body.next === "string" ? body.next : null);
  const redirectTo = `${originOf(request)}/auth/callback?next=${encodeURIComponent(next)}`;

  const { error } = await db.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
  });

  if (error) {
    // 429 is passed through as itself because "you have asked for three links in
    // a minute, wait" is genuinely actionable, and rendering it as a generic
    // failure makes people mash the button. Everything else becomes 502: the
    // request was fine, the auth server would not do it.
    const status = error.status === 429 ? 429 : 502;
    return authError(error.message, status);
  }

  // Deliberately says nothing about whether an account existed. See above.
  return authOk({ sent: true, email: email.trim() });
}
