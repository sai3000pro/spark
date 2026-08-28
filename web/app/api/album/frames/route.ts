/**
 * GET /api/album/frames?run=<id> — the source frames of one run, proxied from
 * the studio (:8899) so the cover picker fetches same-origin. Routing it here
 * keeps the client ignorant of the studio URL and matches the thumb POST, which
 * must be proxied to dodge the JSON preflight.
 *
 * This used to say a plain GET "could hit the studio directly (it sends
 * ACAO:*)". That stopped being true in ff5ebe4, which replaced the wildcard with
 * an origin allowlist precisely because a wildcard let any site the user visited
 * read their captures. Corrected rather than deleted: a comment claiming a
 * wildcard is still there is how somebody talks themselves into putting one back.
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
