/**
 * The user's KIRI key. POST to set, DELETE to forget, GET to describe.
 *
 * THE KEY IS NEVER RETURNED BY ANY METHOD HERE, including the one that just
 * received it. GET answers with a masked tail and a credit count; that is the
 * whole read surface. See lib/reconstruction/keys.ts for why the store is what
 * it is and what it deliberately is not.
 *
 * POST validates against KIRI's own /balance before storing, so a typo is
 * caught while someone is still looking at the field rather than after a
 * three-minute upload.
 */
import { NextResponse } from "next/server";

import { clearKiriKey, describeKey, setKiriKey } from "@/lib/reconstruction/keys";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  return NextResponse.json(describeKey(), { headers: NO_STORE });
}

export async function POST(request: Request) {
  let body: { key?: unknown };
  try {
    body = (await request.json()) as { key?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers: NO_STORE });
  }

  if (typeof body.key !== "string" || !body.key.trim()) {
    return NextResponse.json({ error: "key required" }, { status: 400, headers: NO_STORE });
  }

  const result = await setKiriKey(body.key);
  if (!result.ok) {
    // 422 rather than 401: the request was well-formed, KIRI just would not
    // take the key. A 401 here would read as "you are not signed in to Spark".
    return NextResponse.json({ error: result.reason }, { status: 422, headers: NO_STORE });
  }

  return NextResponse.json(result.description, { headers: NO_STORE });
}

export async function DELETE() {
  clearKiriKey();
  return NextResponse.json(describeKey(), { headers: NO_STORE });
}
