/**
 * Sign out. POST only.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOT A GET, WHICH WOULD BE SO MUCH EASIER TO LINK
 *
 * Because then `<img src="https://spark.example/auth/signout">` on any page
 * anywhere signs out every reader who loads it, and every link prefetcher and
 * antivirus URL scanner does it by accident. Logout is a state change, so it is
 * a POST — the same reasoning that says a delete button is not a link. The cost
 * is a two-line form or a fetch; the alternative is a site people get randomly
 * ejected from.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SIGNING OUT A GUEST IS A DELETION, IN EFFECT
 *
 * An anonymous session is the ONLY handle to a guest's walks: there is no email
 * to sign back in with, and the id lives nowhere but that cookie. Clearing it
 * does not delete their rows, but it does make them permanently unreachable,
 * which from where the person is standing is the same thing.
 *
 * This route does not refuse to do it — it is their session and their decision —
 * but the caller is expected to have said so first, and the response says which
 * case it was so the UI can confirm afterwards rather than guess. Offering
 * "sign out" to a guest without warning is how someone loses a day's walk.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SCOPE
 *
 * The default (`global`) revokes every refresh token for the user, so signing
 * out on the laptop also ends the phone's session. That is the right default for
 * a "sign me out" that someone reaches for because they think a device is
 * compromised — the weaker `local` scope would leave the attacker's session
 * running.
 */
import { authError, authOk, authUnavailable } from "@/lib/auth/http";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerDb } from "@/lib/db/server";

export const dynamic = "force-dynamic";

export async function POST() {
  const db = await createServerDb();
  if (!db) return authUnavailable();

  // Read before destroying, so the response can say what was just lost.
  const before = await getCurrentUser();
  if (!before) return authOk({ signedOut: true, wasGuest: false, alreadySignedOut: true });

  const { error } = await db.auth.signOut();
  if (error) return authError(error.message, 502);

  return authOk({ signedOut: true, wasGuest: before.isGuest, alreadySignedOut: false });
}
