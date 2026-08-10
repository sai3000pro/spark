/**
 * GET /api/capture/state — one atomic snapshot for the Capture page, proxied
 * from the studio (:8899) so the client stays same-origin and ignorant of the
 * studio URL (matches app/api/album/*). Folds the studio's three poll endpoints
 * into one round-trip:
 *   /health                → { status, protocol_version }
 *   /api/capture/status    → { lan_ip, port, sessions }
 *   /api/live/list         → { runs: [...] }
 * Studio down → { online: false }, so the page shows an offline state, not a 500.
 */
import { NextResponse } from "next/server";
import { STUDIO_URL } from "@/lib/studio";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [hRes, stRes, lRes] = await Promise.all([
      fetch(`${STUDIO_URL}/health`, { cache: "no-store" }),
      fetch(`${STUDIO_URL}/api/capture/status`, { cache: "no-store" }),
      fetch(`${STUDIO_URL}/api/live/list`, { cache: "no-store" }),
    ]);
    const health = await hRes.json().catch(() => ({}));
    const status = await stRes.json().catch(() => ({}));
    const live = await lRes.json().catch(() => ({}));
    return NextResponse.json(
      {
        online: true,
        protocol: typeof health?.protocol_version === "number" ? health.protocol_version : null,
        lan_ip: status?.lan_ip ?? null,
        port: status?.port ?? null,
        sessions: status?.sessions ?? {},
        runs: Array.isArray(live?.runs) ? live.runs : [],
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { online: false, protocol: null, lan_ip: null, port: null, sessions: {}, runs: [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
