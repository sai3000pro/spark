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

import {
  describeKey,
  hasKiriKey,
  kiriCredits,
  kiriRejected,
  refreshKiriCredits,
} from "@/lib/reconstruction/keys";
import { describeTargets, probeStudio } from "@/lib/reconstruction/targets";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  // A key from KIRI_API_KEY has never been validated — nothing checked it on
  // the way in, unlike a pasted one. Ask before offering it, so this route
  // keeps its promise that every option was probed rather than declared, and
  // so an exhausted key reads as "no credits left" instead of failing after
  // the upload. Both probes run together; neither depends on the other.
  const [studio] = await Promise.all([probeStudio(), refreshKiriCredits()]);
  const options = describeTargets({
    studio,
    hasKiriKey: hasKiriKey(),
    kiriCredits: kiriCredits(),
    kiriRejected: kiriRejected(),
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
