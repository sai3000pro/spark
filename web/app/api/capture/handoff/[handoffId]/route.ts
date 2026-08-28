/**
 * Handoff status — polled by the laptop, and claimed by the phone.
 *
 * GET is deliberately unauthenticated and returns nothing sensitive: a state
 * label, a device string the phone chose, and byte counts. Knowing a handoff id
 * lets you watch a progress bar; it does not let you upload, which needs the
 * token from the fragment.
 */
import { NextResponse } from "next/server";

import { claimHandoff, getHandoff } from "@/lib/handoff";
import { crossOriginRefusal } from "@/lib/http/sameOrigin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ handoffId: string }>;
}

export async function GET(_request: Request, { params }: Ctx) {
  const { handoffId } = await params;
  const handoff = getHandoff(handoffId);
  if (!handoff) {
    return NextResponse.json({ error: "no such handoff" }, { status: 404 });
  }
  return NextResponse.json({
    handoff,
    // The laptop drives its own poll rate from this rather than hardcoding one:
    // a paired phone is about to do something, an unclaimed code is not.
    pollAfterMs: handoff.state === "waiting" || handoff.state === "expired" ? 3000 : 1000,
  });
}

/** The phone claims the handoff, presenting the token it read from the fragment. */
export async function POST(request: Request, { params }: Ctx) {
  const refused = crossOriginRefusal(request);
  if (refused) return refused;

  const { handoffId } = await params;

  let token = "";
  let device: string | undefined;
  try {
    const body = (await request.json()) as { token?: string; device?: string };
    token = body?.token ?? "";
    device = body?.device;
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }

  if (!token) {
    return NextResponse.json({ error: "missing token" }, { status: 400 });
  }

  const result = claimHandoff(handoffId, token, device);
  if (!result.ok) {
    const status =
      result.reason === "not-found" ? 404 : result.reason === "expired" ? 410 : 403;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json({ handoff: result.handoff });
}
