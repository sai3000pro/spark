/**
 * GET /api/journey/:journeyId — one journey, with the whole route.
 *
 * The counterpart to the list at `/api/journey`, which deliberately returns
 * summaries: a `DerivedRoute` carries every clip, every warning and every
 * assumption, and that is the payload you want for the one journey somebody
 * opened and not for the thirty they were choosing between.
 *
 * What comes back is the route as it was DERIVED AT CREATE TIME, and not a
 * fresh derivation. lib/journey/store.ts is explicit that it does not
 * re-derive: a later correction makes a new journey rather than mutating this
 * one, which is what makes "what did this look like when I saved it" a question
 * with an answer.
 *
 * The 404 here is a real 404 and usually not a typo. The store is a globalThis
 * map that does not survive a restart, so a link somebody bookmarked this
 * morning is gone this afternoon — the `note` says so rather than letting an
 * empty response read as a bug in the page.
 */
import { NextResponse } from "next/server";

import { countLegs, getJourney } from "@/lib/journey/store";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

interface Ctx {
  params: Promise<{ journeyId: string }>;
}

export async function GET(_request: Request, { params }: Ctx) {
  const { journeyId } = await params;

  const journey = getJourney(journeyId);
  if (!journey) {
    return NextResponse.json(
      {
        error: "no such journey",
        note:
          "Journeys live in memory only. If the server has restarted since this one was posted, " +
          "it is gone and re-posting the same clips is what brings it back.",
      },
      { status: 404, headers: NO_STORE },
    );
  }

  const { total, named } = countLegs(journey);

  return NextResponse.json(
    {
      journey,
      persisted: false,
      // "Name", not "have". The store never goes and looks for the trip, so a
      // leg naming `trip_upload_x` may be a walk that was evicted, a walk from
      // before the last restart, or a string a client made up.
      note: `In memory only. Restarting the server forgets this journey. ${named} of ${total} legs name an uploaded walk; none of those names was checked to still resolve.`,
    },
    { status: 200, headers: NO_STORE },
  );
}
