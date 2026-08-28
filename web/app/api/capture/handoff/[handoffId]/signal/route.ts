/**
 * WebRTC signalling relay.
 *
 * This endpoint carries the SDP offer/answer and ICE candidates that let the
 * phone and the laptop find each other. It does NOT carry video: once the two
 * peers have exchanged candidates the media flows directly between them over the
 * Wi-Fi, which is the whole point — a 1080p stream relayed through a Next.js
 * route would be both slow and pointless when the devices are two metres apart.
 *
 * AUTH IS ASYMMETRIC, deliberately.
 *
 *   The phone must present the handoff token. It is the party that could be an
 *   impostor — anyone who photographed the QR — so it proves it holds the
 *   credential, exactly as the upload route requires.
 *
 *   The laptop does not. It is already displaying the code and polling this
 *   handoff by id, and it has no token to present (the raw token was handed to
 *   the phone in the URL fragment and never stored). What an attacker could do
 *   with a guessed handoff id is offer to receive a stream that the phone will
 *   only ever answer once — and the phone's answer goes to whoever asked first.
 *
 * That last point is a real limitation and worth naming: with the id alone,
 * someone on the network could race the laptop to answer. The id is 15
 * unguessable characters and lives for ten minutes, so this is a narrow window,
 * but the durable fix is a laptop-side session — which arrives with auth in
 * phase 1.3. Until then, do not treat a stream as private.
 */
import { NextResponse } from "next/server";
import { crossOriginRefusal } from "@/lib/http/sameOrigin";

import {
  noteStreaming,
  pushSignal,
  readSignals,
  verifyClaim,
  type SignalRole,
} from "@/lib/handoff";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ handoffId: string }>;
}

const ROLES: SignalRole[] = ["phone", "laptop"];

function roleOf(value: unknown): SignalRole | null {
  return ROLES.includes(value as SignalRole) ? (value as SignalRole) : null;
}

/** Post an offer, an answer, or a candidate. */
export async function POST(request: Request, { params }: Ctx) {
  const refused = crossOriginRefusal(request);
  if (refused) return refused;

  const { handoffId } = await params;

  let body: {
    role?: string;
    kind?: string;
    payload?: unknown;
    streaming?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const role = roleOf(body.role);
  if (!role) {
    return NextResponse.json({ error: "role must be phone or laptop" }, { status: 400 });
  }

  // Only the phone has to prove itself. See the header.
  if (role === "phone") {
    const token = request.headers.get("x-handoff-token") ?? "";
    if (!verifyClaim(handoffId, token)) {
      return NextResponse.json({ error: "not-claimed-or-bad-token" }, { status: 403 });
    }
    // Doubles as the liveness heartbeat, so the laptop's "streaming" state ends
    // on its own if the phone goes quiet. No explicit stop message required.
    if (body.streaming) noteStreaming(handoffId);
  }

  // A heartbeat-only ping carries no message.
  if (!body.kind) return NextResponse.json({ ok: true });

  if (body.kind !== "offer" && body.kind !== "answer" && body.kind !== "candidate") {
    return NextResponse.json({ error: "unknown kind" }, { status: 400 });
  }

  const seq = pushSignal(handoffId, role, body.kind, body.payload);
  if (seq === null) {
    return NextResponse.json({ error: "no such handoff, or expired" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, seq });
}

/** Read whatever the other side has said since `?since=`. */
export async function GET(request: Request, { params }: Ctx) {
  const { handoffId } = await params;
  const url = new URL(request.url);

  const role = roleOf(url.searchParams.get("role"));
  if (!role) {
    return NextResponse.json({ error: "role must be phone or laptop" }, { status: 400 });
  }

  const since = Number(url.searchParams.get("since") ?? "0");
  const out = readSignals(handoffId, role, Number.isFinite(since) ? since : 0);
  if (!out) {
    return NextResponse.json({ error: "no such handoff" }, { status: 404 });
  }

  return NextResponse.json(out);
}
