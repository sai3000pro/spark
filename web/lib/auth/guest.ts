/**
 * The guest path: a session is minted on the first WRITE, and not one moment
 * before.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOT ON ARRIVAL, WHICH IS THE OBVIOUS THING TO DO
 *
 * The tempting design is to call `signInAnonymously()` in the root layout so
 * `auth.uid()` is never null and no policy in 007_rls.sql needs a guest branch.
 * It is wrong for four separate reasons, any one of which is sufficient:
 *
 *  1. IT MINTS A REAL ROW. Every anonymous sign-in is an `auth.users` insert,
 *     which fires `handle_new_user()` and writes a `public.profiles` row too. A
 *     crawler, a link preview bot, a monitoring probe, a person who opened the
 *     landing page and closed it — each becomes a permanent user account. The
 *     free tier counts those, and Supabase's own guidance is to delete stale
 *     anonymous users precisely because this pattern generates them by the
 *     thousand.
 *
 *  2. IT SETS A COOKIE ON A PUBLIC PAGE. A `Set-Cookie` on the landing response
 *     makes every response uncacheable and per-user. The most-hit, most static
 *     page in the app — the one a demo opens on — stops being cacheable at the
 *     CDN in order to identify someone who has not done anything yet.
 *
 *  3. IT COSTS THE FIRST PAINT. A round trip to the auth server, in the render
 *     path, before any HTML goes out, on the page that has to be fast.
 *
 *  4. IT IS A CONSENT PROBLEM. Creating an identifiable, persistent account for
 *     someone who came to LOOK is not something to do quietly. Reading a public
 *     walk should leave no trace of the reader.
 *
 * So: reads are anonymous in the true sense — no session, no row, no cookie.
 * Identity appears at the first moment there is something to own, which is the
 * first write. That is also the first moment a person can be told about it, in
 * language that means something: "your walk is saved to this browser".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE THIS MAY BE CALLED FROM
 *
 * Route Handlers and Server Actions ONLY. Signing in writes a cookie, and a
 * Server Component cannot write cookies — there, `createServerDb()`'s `setAll`
 * swallows the write (see lib/db/server.ts) and the result would be a session
 * that exists on the auth server, is charged to the project, and is attached to
 * nobody. Every write in this app already goes through a route handler, so this
 * is a constraint that costs nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT A GUEST IS ALLOWED TO DO
 *
 * The database decides, not this file. `public.is_guest()` in 007_rls.sql reads
 * the `is_anonymous` claim and the policies use it: a guest's journey is
 * genuinely theirs and they can keep, edit and delete it, but it cannot be
 * `public` — it does not go on the world's globe — and they cannot create groups,
 * grant shares or send invites. Upgrading (app/auth/upgrade) turns the same row
 * into a real account WITHOUT changing its id, so every journey, album and moment
 * they made as a guest is still theirs afterwards. That id continuity is the
 * entire reason this is anonymous sign-in rather than a cookie full of local
 * state that has to be migrated later.
 */
import "server-only";

import { createServerDb } from "@/lib/db/server";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";

export type WriterResult =
  | {
      ok: true;
      user: CurrentUser;
      /** True when this call is what created the guest, i.e. the first write. */
      created: boolean;
    }
  | {
      ok: false;
      /**
       * `unconfigured` is not a failure. It is the demo build, where there is no
       * auth server and writes go to the in-memory stores (lib/liveTrip.ts,
       * lib/splatJobs.ts, lib/uploadedTrips.ts) exactly as they always have.
       * Callers take that path; they do not report an error to the user.
       */
      reason: "unconfigured" | "sign-in-failed";
      detail: string;
    };

/**
 * Make sure there is somebody to own what is about to be written.
 *
 * Call this at the top of a write, after validating the request and before
 * touching any store. Returns the existing user untouched if there is one — an
 * already-signed-in person is never re-signed-in, and a guest is never silently
 * upgraded or duplicated.
 */
export async function ensureWriter(): Promise<WriterResult> {
  const existing = await getCurrentUser();
  if (existing) return { ok: true, user: existing, created: false };

  const db = await createServerDb();
  if (!db) {
    return {
      ok: false,
      reason: "unconfigured",
      detail: "No Supabase project in this deployment; writes stay local to this process.",
    };
  }

  try {
    const { data, error } = await db.auth.signInAnonymously();
    if (error || !data.user) {
      return {
        ok: false,
        reason: "sign-in-failed",
        // Anonymous sign-ins are a per-project toggle and are rate limited by
        // IP. Both refusals arrive here, and both are worth saying out loud
        // rather than rendering as a generic write failure.
        detail: error?.message ?? "the auth server declined to create a guest session",
      };
    }
    return {
      ok: true,
      user: {
        id: data.user.id,
        email: data.user.email ?? null,
        // Asserted rather than read back: this is the response to
        // signInAnonymously, so there is no other thing it could be, and
        // trusting the flag here would make the type depend on a field the SDK
        // marks optional.
        isGuest: true,
      },
      created: true,
    };
  } catch {
    return {
      ok: false,
      reason: "sign-in-failed",
      detail: "the auth server was unreachable",
    };
  }
}
