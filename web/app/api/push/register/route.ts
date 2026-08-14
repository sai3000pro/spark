/**
 * POST /api/push/register — this browser would like to be told.
 * DELETE the same path — it would like to stop.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT NEVER FAILS, BECAUSE FAILING HERE COSTS SOMETHING IRREVERSIBLE
 *
 * By the time this is called the reader has already granted a notification
 * permission — the one thing in this flow that cannot be taken back and cannot
 * be asked for twice. A 500 at that point would leave them permanently opted in
 * at the browser and not registered at the server, and the UI's only truthful
 * response would be to ask them to press a button that will now do nothing
 * visible.
 *
 * So every path returns 200 with a sentence. `durable: false` means the token
 * was taken but lives only as long as this process (see lib/push/registry.ts
 * for why that is the normal case until sign-in exists), which is a different
 * claim from success and is rendered differently.
 *
 * The only 400 is a malformed body, which is not something a real client can
 * produce.
 */
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { registerPushToken, revokePushTokens, type PushPlatform } from "@/lib/push/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

const PLATFORMS: readonly PushPlatform[] = ["web", "ios", "android"];

/**
 * FCM tokens are long opaque strings and their format is not documented as
 * stable, so this is a sanity bound rather than a parse: it exists to keep a
 * megabyte of nonsense out of a text column, not to validate anything. FCM
 * itself is the authority on whether a token is real, and it says so by
 * refusing to deliver.
 */
function isPlausibleToken(value: unknown): value is string {
  return typeof value === "string" && value.length >= 20 && value.length <= 4096;
}

export async function POST(request: Request): Promise<Response> {
  let body: { token?: unknown; platform?: unknown; userAgent?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "expected JSON" }, { status: 400, headers: NO_STORE });
  }

  if (!isPlausibleToken(body.token)) {
    return NextResponse.json(
      { error: "a registration token is required" },
      { status: 400, headers: NO_STORE },
    );
  }

  const platform = PLATFORMS.find((p) => p === body.platform) ?? "web";

  const result = await registerPushToken({
    token: body.token,
    /*
      Null when nobody is signed in, which is a supported outcome rather than a
      refusal — see the registry's header for the two stores and the seam
      between them. Deliberately NOT `ensureWriter()`: registering for a
      notification is not writing anything a person owns, and minting an
      `auth.users` row because someone ticked "tell me when it's done" would be
      a side effect nobody asked for.
    */
    userId: (await getCurrentUser())?.id ?? null,
    platform,
    userAgent: typeof body.userAgent === "string" ? body.userAgent : null,
  });

  return NextResponse.json({ ok: true, ...result }, { status: 200, headers: NO_STORE });
}

export async function DELETE(request: Request): Promise<Response> {
  let body: { token?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "expected JSON" }, { status: 400, headers: NO_STORE });
  }

  /*
    Unauthenticated, deliberately.

    Presenting a token is the proof: only the browser FCM issued it to has it,
    and the worst a stolen one buys is silencing a device that the thief could
    already receive nothing on. Requiring a session here would mean the local
    path — which has no sessions at all — could register but never unregister,
    and a feature you cannot turn off is one people block at the browser
    instead, which costs the permission permanently.
  */
  if (!isPlausibleToken(body.token)) {
    return NextResponse.json(
      { error: "a registration token is required" },
      { status: 400, headers: NO_STORE },
    );
  }

  await revokePushTokens([body.token]);
  return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE });
}
