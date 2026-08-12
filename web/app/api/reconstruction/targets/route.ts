/**
 * GET /api/reconstruction/targets — where a clip could actually go right now.
 *
 * Probed, not declared. The studio is pinged and KIRI's stored balance is read,
 * so the phone never offers a destination that would quietly do nothing. Called
 * by the capture page after recording and by the laptop panel when it renders.
 *
 * Returns no secrets: the KIRI key is described by its last four characters and
 * a credit count, never by its value. See lib/reconstruction/keys.ts.
 */
import { NextResponse } from "next/server";

import { describeKey, hasKiriKey, kiriCredits } from "@/lib/reconstruction/keys";
import { describeTargets, probeStudio } from "@/lib/reconstruction/targets";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  const studio = await probeStudio();
  const options = describeTargets({
    studio,
    hasKiriKey: hasKiriKey(),
    kiriCredits: kiriCredits(),
  });

  return NextResponse.json(
    {
      options,
      studio,
      kiri: describeKey(),
      // The clip is stored before any of this is consulted, so "nothing is
      // available" is a degraded outcome and not a blocked one.
      anyAvailable: options.some((o) => o.available),
    },
    { headers: NO_STORE },
  );
}
