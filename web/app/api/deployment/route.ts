/**
 * GET /api/deployment — what this instance can actually do.
 *
 * The first thing to open after a deploy, and the thing to paste into a bug
 * report. Everything else in this app degrades quietly and correctly on a host
 * that cannot store anything, which is right for a user and useless for
 * diagnosis: the shelf is simply empty, the upload panel simply refuses, and
 * nothing on screen distinguishes "nothing has been captured yet" from "this
 * deployment cannot keep a capture."
 *
 * So this route answers that in one request, in the app's own words rather than
 * the platform's.
 *
 * NOTHING SENSITIVE. It reports capabilities and limits, never configuration:
 * no connection strings, no keys, not even which provider — `db.configured` is
 * a boolean, because "is there a database" is a fact a deployer needs and "which
 * one, at what URL" is not something an unauthenticated route should say. It is
 * deliberately readable without auth, since the case it exists for is the deploy
 * where auth does not work yet.
 */
import { NextResponse } from "next/server";

import { supabaseConfig } from "@/lib/db/config";
import { storageReality } from "@/lib/deployment";
import { MAX_UPLOAD_BYTES } from "../splat/upload/limits";
import { SPLAT_FORMATS } from "@/lib/splat/extensions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  const storage = storageReality();
  const db = supabaseConfig() !== null;

  /*
    Object storage is a THIRD fact, and leaving it out made this route
    misleading in the exact situation it exists for. `lib/storage/` holds three
    real providers, and `createFleet()` — the only way into any of them — is
    never called anywhere in the app. So configuring an R2 bucket changes
    nothing: /api/splat/upload still writes to the local filesystem, and a
    deployer who set the credentials would reasonably conclude the problem was
    their credentials.

    Hardcoded rather than probed, deliberately. There is nothing to measure: the
    wiring either exists in the source or it does not, and today it does not.
    When the upload route goes through the fleet, this becomes a real check of
    whether a provider answers — and it should be changed in that commit, not
    before.
  */
  const objectStorageWired = false;

  /*
    "Ready" means a stranger could use this deployment and keep what they made.
    Every part is required and none implies another: a box with a disk and no
    database loses everything the moment it scales past one instance, a database
    with a read-only disk has nowhere to put a 200 MB splat, and neither helps
    while the code still writes to `public/`.
  */
  const ready = storage.durable && db && objectStorageWired;

  return NextResponse.json(
    {
      ready,
      storage: {
        writable: storage.writable,
        durable: storage.durable,
        host: storage.host,
        reason: storage.reason,
      },
      database: {
        configured: db,
        reason: db
          ? "A database is configured."
          : "No database is configured, so anything written lives only in this process.",
      },
      objectStorage: {
        wired: objectStorageWired,
        reason: objectStorageWired
          ? "Uploads go to object storage."
          : "lib/storage/ is written but never called — createFleet() has no callers, so uploads " +
            "go to this instance's own disk regardless of any bucket credentials.",
      },
      uploads: {
        accepted: SPLAT_FORMATS,
        maxBytes: MAX_UPLOAD_BYTES,
        maxLabel: `${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB`,
        enabled: storage.durable,
      },
      /*
        The single sentence to act on. Ordered by what blocks what: with no
        durable disk the database will not save you, so that is named first.
      */
      summary: !storage.durable
        ? storage.reason
        : !objectStorageWired
          ? "Captures are stored on this instance's own disk. Object storage is written but not wired up, so bucket credentials alone will not change that."
          : !db
            ? "Captures are stored, but records live only in this process. Configure a database before running more than one instance."
            : "This deployment can accept captures and keep them.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
