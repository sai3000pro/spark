/**
 * Guest → real account. POST { email, next? }.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE USER ID DOES NOT CHANGE. THAT IS THE ENTIRE POINT.
 *
 * `updateUser({ email })` attaches an address to the EXISTING anonymous
 * `auth.users` row rather than creating a second account. So every journey,
 * album, moment and splat the person made as a guest — all of them keyed on
 * `owner_id = auth.uid()` under the policies in 007_rls.sql — is still theirs the
 * instant the address is confirmed. There is no migration step, no "claim your
 * walks" screen, no window in which a row belongs to nobody.
 *
 * The obvious alternative — sign up a fresh account and copy the rows across —
 * is where this design would go wrong. It needs a transaction spanning several
 * tables and a storage bucket, it has to decide what happens when it fails
 * halfway, and it is the kind of code that gets written once and tested never.
 * Anonymous sign-in exists precisely so that it does not have to be.
 *
 * What DOES change is `is_anonymous`, and with it what the database will accept:
 * `public.is_guest()` starts returning false, so their walks may now be public
 * and they may create groups, share and invite. Nothing in this app has to
 * re-evaluate anything for that to happen — the policies read the claim on every
 * query.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS NOT DONE WHEN THIS ROUTE RETURNS
 *
 * The address is unconfirmed until the emailed link is clicked, which comes back
 * through /auth/callback as an `email_change` verification. Until then the user
 * is still a guest, and the UI must say "check your email", not "welcome". A
 * route that reported success here would be claiming an unverified address is
 * owned — which is the whole vulnerability that email confirmation exists to
 * prevent, since anyone could type someone else's address.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT REFUSES A SIGNED-IN, NON-GUEST USER
 *
 * Because for them this is not an upgrade, it is an email CHANGE — a different
 * action with different stakes (it moves control of the account) that deserves
 * its own route, its own confirmation and, ideally, a notice to the old address.
 * Quietly overloading this one is how account-takeover paths get built by
 * accident.
 */
import {
  authError,
  authOk,
  authUnavailable,
  looksLikeEmail,
  originOf,
  safeNext,
} from "@/lib/auth/http";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerDb } from "@/lib/db/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
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

  const user = await getCurrentUser();
  if (!user) {
    // Not an error state worth dressing up: there is no guest session to
    // upgrade, so the thing they want is an ordinary magic link.
    return authError("no session to upgrade — use /auth/magic-link instead", 409);
  }
  if (!user.isGuest) {
    return authError("this account already has an email address", 409);
  }

  const next = safeNext(typeof body.next === "string" ? body.next : null);
  const redirectTo = `${originOf(request)}/auth/callback?next=${encodeURIComponent(next)}`;

  const { error } = await db.auth.updateUser({ email: email.trim() }, { emailRedirectTo: redirectTo });

  if (error) {
    // An address already attached to another account comes back as a 422 here.
    // It is passed through rather than flattened, because "that email is already
    // in use" is the one message that tells the person what to do next — and
    // unlike /auth/magic-link this is not an enumeration oracle, since the
    // caller has already proved they hold this session.
    const status = error.status === 429 ? 429 : error.status === 422 ? 422 : 502;
    return authError(error.message, status);
  }

  // Still a guest at this point. Confirmation is what finishes the job.
  return authOk({ confirmationSent: true, email: email.trim(), stillGuest: true });
}
