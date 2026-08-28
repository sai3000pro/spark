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
    "Ready" means a stranger could use this deployment and keep what they made.
    Both halves are required and neither implies the other: a box with a disk
    and no database loses everything the moment it scales past one instance, and
    a database with a read-only disk has nowhere to put a 200 MB splat.
  */
  const ready = storage.durable && db;

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
        : !db
          ? "Captures are stored on this instance's disk and are not shared between instances. Configure a database before running more than one."
          : "This deployment can accept captures and keep them.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
