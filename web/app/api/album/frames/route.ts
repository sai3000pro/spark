/**
 * GET /api/album/frames?run=<id> — the source frames of one run, proxied from
 * the studio (:8899) so the cover picker fetches same-origin. A plain GET could
 * hit the studio directly (it sends ACAO:*), but routing it here keeps the
 * client ignorant of the studio URL and matches the thumb POST, which must be
 * proxied to dodge the JSON preflight.
 */
import { NextResponse } from "next/server";
import { STUDIO_URL } from "@/lib/studio";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const run = new URL(request.url).searchParams.get("run") ?? "";
  if (!run) return NextResponse.json({ frames: [] }, { status: 400 });
  try {
    const res = await fetch(`${STUDIO_URL}/api/frames?run=${encodeURIComponent(run)}`, {
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ frames: [], error: "studio unreachable" }, { status: 502 });
  }
}
