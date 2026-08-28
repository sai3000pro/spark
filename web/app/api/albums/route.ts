/**
 * GET  /api/albums  — every album, newest activity first.
 * POST /api/albums  — make one, optionally filing a walk into it at the same time.
 *
 * The POST does both because that is the only way it is used: someone finishes
 * a walk and decides it starts something. Two calls would leave an empty album
 * behind whenever the second one failed.
 *
 * No ownership checks, because there are no accounts yet. When auth lands these
 * become `owner_id = auth.uid()` and the list gets an RLS predicate; the shape
 * of the responses does not change. See supabase/migrations/004_journeys.
 */
import { NextResponse } from "next/server";

import { createAlbum, listAlbums } from "@/lib/albums";
import { crossOriginRefusal } from "@/lib/http/sameOrigin";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export function GET() {
  return NextResponse.json({ albums: listAlbums() }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  const refused = crossOriginRefusal(request);
  if (refused) return refused;

  let body: { title?: unknown; journeyId?: unknown };
  try {
    body = (await request.json()) as { title?: unknown; journeyId?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers: NO_STORE });
  }

  if (typeof body.title !== "string") {
    return NextResponse.json({ error: "title required" }, { status: 400, headers: NO_STORE });
  }

  const result = createAlbum({
    title: body.title,
    journeyId: typeof body.journeyId === "string" ? body.journeyId : null,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: "That name is empty once trimmed." },
      { status: 422, headers: NO_STORE },
    );
  }

  return NextResponse.json({ album: result.album }, { status: 201, headers: NO_STORE });
}
