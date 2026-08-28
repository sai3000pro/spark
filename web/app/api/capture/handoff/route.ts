/**
 * Open a phone handoff, and hand back everything needed to draw the QR.
 *
 * The raw token is returned exactly once, in this response, and is never
 * retrievable again. It goes into the URL FRAGMENT of the QR — see the header of
 * lib/handoff.ts for why that matters.
 */
import { NextResponse } from "next/server";

import { createHandoff, type HandoffIntent } from "@/lib/handoff";
import { captureCapabilities, phoneOrigin } from "@/lib/net";
import { crossOriginRefusal } from "@/lib/http/sameOrigin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // node:os and node:crypto

export async function POST(request: Request) {
  const refused = crossOriginRefusal(request);
  if (refused) return refused;

  let tripId: string | null = null;
  let intent: HandoffIntent = "record";
  try {
    const body = (await request.json()) as { tripId?: string; intent?: string } | null;
    tripId = body?.tripId ?? null;
    // Validated, not trusted: an unknown value lands on the path that asks the
    // phone what it wants rather than guessing on its behalf.
    if (body?.intent === "upload") intent = "upload";
  } catch {
    // No body is fine — a handoff can be opened before a trip exists.
  }

  const { origin, problem, insecure } = phoneOrigin(request.headers);
  if (!origin) {
    // 503 rather than 500: nothing is broken, the machine just has no address a
    // phone could reach, and the UI should say so rather than draw a dead code.
    return NextResponse.json(
      { error: "no-reachable-origin", detail: problem },
      { status: 503 },
    );
  }

  const { handoff, token } = createHandoff({ tripId, intent });
  const url = `${origin}/m/${handoff.id}#${token}`;

  return NextResponse.json(
    {
      handoff,
      url,
      origin,
      insecure,
      capabilities: captureCapabilities(insecure),
      note:
        "The token is in the URL fragment, so it never reaches a server log. " +
        "It expires in 10 minutes and binds to the first phone that claims it.",
    },
    { status: 201 },
  );
}

export async function GET(request: Request) {
  const { origin, problem, insecure } = phoneOrigin(request.headers);
  return NextResponse.json({
    contract: "POST to open a handoff. The response carries the URL to encode as a QR.",
    reachableOrigin: origin,
    problem,
    insecure,
    capabilities: captureCapabilities(insecure),
  });
}
