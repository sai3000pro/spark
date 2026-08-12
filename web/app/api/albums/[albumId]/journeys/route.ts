/**
 * POST   /api/albums/[albumId]/journeys  — file a walk under this album.
 * DELETE /api/albums/[albumId]/journeys  — take it back out.
 *
 * Filing a walk that is already in another album MOVES it rather than
 * erroring — see addToAlbum. "Put this in Autumn instead" is the obvious thing
 * to want, and refusing it would be the app being strict about a rule it made
 * up rather than one the person cares about.
 */
import { NextResponse } from "next/server";

import { addToAlbum, removeFromAlbum } from "@/lib/albums";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

interface Ctx {
  params: Promise<{ albumId: string }>;
}

async function journeyIdFrom(request: Request): Promise<string | null> {
  try {
    const body = (await request.json()) as { journeyId?: unknown };
    return typeof body.journeyId === "string" && body.journeyId ? body.journeyId : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request, { params }: Ctx) {
  const { albumId } = await params;
  const journeyId = await journeyIdFrom(request);
  if (!journeyId) {
    return NextResponse.json({ error: "journeyId required" }, { status: 400, headers: NO_STORE });
  }

  const result = addToAlbum(albumId, journeyId);
  if (!result.ok) {
    return NextResponse.json({ error: "no-such-album" }, { status: 404, headers: NO_STORE });
  }
  return NextResponse.json({ album: result.album }, { headers: NO_STORE });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const { albumId } = await params;
  const journeyId = await journeyIdFrom(request);
  if (!journeyId) {
    return NextResponse.json({ error: "journeyId required" }, { status: 400, headers: NO_STORE });
  }

  // Idempotent: removing something that is not there is the state you wanted.
  removeFromAlbum(albumId, journeyId);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
