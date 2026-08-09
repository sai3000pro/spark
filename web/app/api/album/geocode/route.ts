/**
 * GET /api/album/geocode?q=<place> — turn a place name into coordinates so the
 * album's location editor can drop a real pin without the user hand-typing
 * lat/lng. Proxied server-side to OpenStreetMap's Nominatim (which requires a
 * User-Agent and forbids browser-origin abuse), and kept optional: if it's
 * unreachable or finds nothing, the editor falls back to manual lat/lng entry.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!q) return NextResponse.json({ results: [] }, { status: 400 });

  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=5&q=" + encodeURIComponent(q);
  try {
    const res = await fetch(url, {
      headers: {
        // Nominatim's usage policy requires an identifying UA.
        "User-Agent": "Spark-Album/1.0 (local studio)",
        "Accept-Language": "en",
      },
      cache: "no-store",
    });
    if (!res.ok) return NextResponse.json({ results: [] }, { status: 502 });
    const raw = (await res.json()) as Array<{
      display_name?: string;
      lat?: string;
      lon?: string;
    }>;
    const results = raw
      .map((r) => ({
        name: r.display_name ?? q,
        lat: r.lat ? Number(r.lat) : null,
        lng: r.lon ? Number(r.lon) : null,
      }))
      .filter((r) => r.lat !== null && r.lng !== null);
    return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ results: [], error: "geocoder unreachable" }, { status: 502 });
  }
}
