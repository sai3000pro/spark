/**
 * Where the link in the email lands. Exchanges a one-time code for a session and
 * bounces onward.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO SHAPES, BECAUSE SUPABASE SENDS BOTH
 *
 *   · `?code=…`                    — the PKCE flow. The default for a magic link
 *                                    requested through @supabase/ssr, and the
 *                                    one this app's own /auth/magic-link mints.
 *                                    The code is worthless without the verifier
 *                                    cookie set when the link was requested, so
 *                                    an intercepted link is not a session.
 *   · `?token_hash=…&type=…`       — the older confirmation-link shape, still
 *                                    produced by a project's default email
 *                                    templates and by the email-change flow that
 *                                    app/auth/upgrade triggers. Handling it costs
 *                                    six lines; not handling it means "invite" and
 *                                    "confirm your new address" links silently
 *                                    dead-end.
 *
 * Handling both here rather than in two routes matters because the URL is baked
 * into emails that outlive deployments. A link sent today has to keep working.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS ALWAYS ENDS IN A REDIRECT, NEVER IN A PAGE
 *
 * The URL contains a single-use credential. Leave it in the address bar and it
 * goes into history, into a screenshot, into a pasted "look at this" link, and —
 * on the next outbound click from a page rendered at this URL — into a Referer
 * header. A 303 to a clean path replaces the history entry with one that carries
 * nothing. The session itself is already in the cookies this response sets.
 *
 * Failures redirect too, to `/?auth=…`, rather than rendering an error. An
 * expired link is the single most common outcome of this route — people click
 * them the next morning — and the right response to that is the ordinary site
 * with a note, not a dead end that looks like the app is broken.
 */
import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { authUnavailable, originOf, safeNext } from "@/lib/auth/http";
import { createServerDb } from "@/lib/db/server";

export const dynamic = "force-dynamic";

/**
 * `type` arrives in the query string, i.e. from the network. It is passed
 * straight to the auth server, so an allowlist rather than a cast: the SDK's own
 * type is `… | (string & {})`, which accepts anything, and there is no reason to
 * forward an arbitrary caller-chosen verb.
 */
const OTP_TYPES: readonly EmailOtpType[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = originOf(request);
  const next = safeNext(url.searchParams.get("next"));

  const away = (path: string) =>
    // 303: the browser must GET the destination. It also drops this URL — and
    // the credential in it — from the entry it replaces.
    NextResponse.redirect(new URL(path, origin), { status: 303 });

  const db = await createServerDb();
  if (!db) return authUnavailable();

  // Supabase reports its own refusals in the query string (expired link, already
  // used, rate limited). Nothing to exchange in that case.
  if (url.searchParams.get("error")) {
    return away(`/?auth=link-failed`);
  }

  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  try {
    if (code) {
      const { error } = await db.auth.exchangeCodeForSession(code);
      if (error) return away(`/?auth=link-expired`);
      return away(next);
    }

    if (tokenHash && type && (OTP_TYPES as readonly string[]).includes(type)) {
      const { error } = await db.auth.verifyOtp({
        token_hash: tokenHash,
        type: type as EmailOtpType,
      });
      if (error) return away(`/?auth=link-expired`);
      return away(next);
    }
  } catch {
    // The auth server being unreachable is not the visitor's problem to read a
    // stack trace about.
    return away(`/?auth=link-failed`);
  }

  // Somebody opened /auth/callback by hand, or a mail client mangled the URL.
  return away(`/?auth=link-invalid`);
}
