import "server-only";

/**
 * Where a push registration token is kept.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO STORES, AND THE SEAM BETWEEN THEM IS AUTH
 *
 * `push_tokens` (supabase/migrations/008) is the real home. Its `user_id` is
 * `not null references profiles(id)`, and that constraint is not negotiable: it
 * is what makes the RLS policies on that table mean anything, and what stops the
 * device inventory becoming a shared bucket that anybody can read out of.
 *
 * Which means the table can only be written for a signed-in user — and this app
 * has no sign-in yet. Today it runs on KIRI_API_KEY alone: no Supabase, no
 * `profiles` row, no `auth.uid()`, no uuid to put in that column. Inventing one
 * would be worse than useless; it would be a foreign key violation on the good
 * days and someone else's row on the bad ones.
 *
 * So there is a second store for that case, in memory, keyed by nothing, with
 * exactly the same precedent and the same honesty as lib/reconstruction/keys.ts:
 * held on this server only, lost on restart, and the UI says so rather than
 * implying a durability that does not exist. Losing it costs one click to
 * re-register, because the browser still holds the FCM token — the permission,
 * which is the irreversible part, is untouched.
 *
 * The switch is automatic and one-way: the moment a request arrives carrying a
 * Supabase session, the token goes to Postgres and stays there.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHO GETS TOLD, WITH NO AUTH
 *
 * A `splat_job` has no owner. lib/splatJobs.ts is a machine-global map over a
 * directory of videos, minted by whoever POSTed to the box — the concept of
 * "whose reconstruction is this" does not exist below the Supabase layer, and
 * cannot be invented here honestly.
 *
 * So in the local path, `tokensToNotify(null)` returns EVERY registered token.
 * That is not a leak: it is a single-user development server, the tokens on it
 * belong to the person running it, and the alternative — attaching the poller's
 * channel to the job and notifying only that — would mean the phone that
 * uploaded a clip never tells the laptop that watched it. With a real user id
 * the query narrows to that user and this paragraph stops applying.
 */
import { adminDb } from "@/lib/db/admin";
import { __wipeStore, hydrate, persist } from "@/lib/persist";

export type PushPlatform = "web" | "ios" | "android";

/** Mirrors the columns of `public.push_tokens`. `created_at` is the DB's. */
interface LocalRegistration {
  token: string;
  platform: PushPlatform;
  userAgent: string | null;
  seenAt: number;
  revokedAt: number | null;
}

/**
 * Survives a hot reload AND a restart, but is still not Postgres.
 *
 * Same `Symbol.for` trick as lib/splatJobs.ts's store, for the same reason: in
 * development every edit re-evaluates this module, and a plain module-level Map
 * would drop every registration on each keystroke. It is now written through to
 * `.data/push/` as well, because the whole point of a push token is a promise
 * made in advance -- "we will tell you when this finishes" -- and a promise that
 * a deploy silently cancels is worse than one never made. A reconstruction can
 * easily outlast the process that started it; that is the normal case, not the
 * edge one.
 *
 * `durable` on RegisterResult still means POSTGRES, not this. The distinction
 * survives because it is the one that matters for more than one instance: a
 * sidecar is readable by the process that wrote it and by nothing else.
 */
const KEY = Symbol.for("spark.push.registry");

/** Sidecar directory under `.data/`. See lib/persist.ts. */
const STORE_NAME = "push";

/** One record for the whole map: these are read together, never individually. */
const RECORD_ID = "tokens";

interface LocalStoreState {
  tokens: Map<string, LocalRegistration>;
  hydrated: boolean;
}

function localState(): LocalStoreState {
  const g = globalThis as unknown as Record<symbol, LocalStoreState | undefined>;
  const s = (g[KEY] ??= { tokens: new Map(), hydrated: false });
  if (!s.hydrated) {
    s.hydrated = true; // set first -- a throw below must not retry forever
    const [record] = hydrate<Record<string, unknown>>(STORE_NAME, (raw) =>
      typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null,
    );
    for (const [token, value] of Object.entries(record ?? {})) {
      const r = value as Partial<LocalRegistration>;
      // A malformed entry is dropped rather than repaired. A token is an opaque
      // endpoint handed to a push service; a half-understood one produces a
      // delivery failure at the worst moment rather than an error here.
      if (typeof r.token !== "string" || r.token !== token) continue;
      if (r.platform !== "web" && r.platform !== "ios" && r.platform !== "android") continue;
      s.tokens.set(token, {
        token,
        platform: r.platform,
        userAgent: typeof r.userAgent === "string" ? r.userAgent : null,
        seenAt: typeof r.seenAt === "number" ? r.seenAt : Date.now(),
        revokedAt: typeof r.revokedAt === "number" ? r.revokedAt : null,
      });
    }
  }
  return s;
}

function localStore(): Map<string, LocalRegistration> {
  return localState().tokens;
}

/** Best effort, like everything in lib/persist.ts. */
function persistLocal(): void {
  persist(STORE_NAME, RECORD_ID, Object.fromEntries(localState().tokens));
}

/** Tests only -- memory cleared, disk left alone, which is what a restart is. */
export function __simulatePushRestart(): void {
  const g = globalThis as unknown as Record<symbol, LocalStoreState | undefined>;
  g[KEY] = { tokens: new Map(), hydrated: false };
}

/** Tests only -- clears both halves. */
export function __resetPushRegistry(): void {
  __wipeStore(STORE_NAME);
  const g = globalThis as unknown as Record<symbol, LocalStoreState | undefined>;
  g[KEY] = { tokens: new Map(), hydrated: true };
}

/*
  Identity is NOT resolved in this module.

  lib/auth/session.ts is emphatic that "who is asking?" is answered in exactly
  one place, with `getUser()` rather than `getSession()` because the cookie is
  attacker-controlled and only the auth server can verify it. So callers resolve
  the user with `getCurrentUser()` at the edge and pass the id inward. This
  module takes a `userId | null` and never second-guesses it.

  It also means nothing here calls `cookies()`, which keeps the send path — which
  runs with no request context of its own — able to reuse the same functions.
*/

export interface RegisterResult {
  /** True only when the token reached Postgres and will outlive this process. */
  durable: boolean;
  /** Phrased for a person; rendered as-is. */
  note: string;
}

/**
 * Record a token. Never throws.
 *
 * Idempotent by construction — the token is the primary key, because FCM
 * reissues per browser install and the same token registering twice must be one
 * row, not two. A re-registration bumps `seen_at` and clears `revoked_at`: a
 * token that FCM previously rejected and that a live browser has just presented
 * again is alive, and refusing to un-revoke it would strand that device forever.
 */
export async function registerPushToken(input: {
  token: string;
  userId: string | null;
  platform?: PushPlatform;
  userAgent?: string | null;
}): Promise<RegisterResult> {
  const platform: PushPlatform = input.platform ?? "web";
  const userAgent = input.userAgent?.slice(0, 512) ?? null;

  /*
    The service-role client, which bypasses RLS — so the authorization decision
    is made here, in TypeScript, as lib/db/admin.ts requires: the row is written
    for the user the CALLER verified, and there is no path that lets a request
    body name a different one.
  */
  const db = input.userId ? adminDb() : null;
  if (db && input.userId) {
    try {
      const { error } = await db.from("push_tokens").upsert(
        {
          token: input.token,
          user_id: input.userId,
          platform,
          user_agent: userAgent,
          seen_at: new Date().toISOString(),
          revoked_at: null,
        },
        { onConflict: "token" },
      );
      if (!error) {
        return {
          durable: true,
          note: "This browser will be told when a reconstruction finishes.",
        };
      }
      console.warn("[push] could not store token (falling back to memory):", error.message);
    } catch (err) {
      console.warn("[push] could not store token (falling back to memory):", err);
    }
  }

  localStore().set(input.token, {
    token: input.token,
    platform,
    userAgent,
    seenAt: Date.now(),
    revokedAt: null,
  });
  persistLocal();
  return {
    // Still false: `durable` means Postgres, and a sidecar is readable only by
    // the machine that wrote it. The note no longer says "until this server
    // restarts" because that stopped being true -- but it must not overclaim
    // either, so it says exactly which machine the promise is good on.
    durable: false,
    note:
      "This browser will be told when a reconstruction finishes, as long as it is " +
      "this laptop doing the telling.",
  };
}

/**
 * The tokens to send a job's completion to.
 *
 * See the header for why a null user id means "everything on this machine".
 */
export async function tokensToNotify(userId: string | null): Promise<string[]> {
  if (userId) {
    const db = adminDb();
    if (db) {
      try {
        const { data, error } = await db
          .from("push_tokens")
          .select("token")
          .eq("user_id", userId)
          .is("revoked_at", null);
        if (!error && data) return data.map((row) => String(row.token));
        if (error) console.warn("[push] could not read tokens (non-fatal):", error.message);
      } catch (err) {
        console.warn("[push] could not read tokens (non-fatal):", err);
      }
    }
  }
  return [...localStore().values()]
    .filter((r) => r.revokedAt === null)
    .map((r) => r.token);
}

/**
 * Retire tokens FCM has told us are dead, or that a browser has asked us to.
 *
 * Marked, not deleted, exactly as migration 008 requires: a stale client
 * retrying its registration must not be able to resurrect a token FCM has
 * already declared unregistered. The local store follows the same rule so the
 * two halves cannot behave differently.
 *
 * Never throws — this is a cleanup that runs inside a send, and a send that
 * worked must not be reported as failed because the tidying afterwards did not.
 */
export async function revokePushTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;

  const now = Date.now();
  const local = localStore();
  let touched = false;
  for (const token of tokens) {
    const existing = local.get(token);
    if (existing) {
      existing.revokedAt = now;
      touched = true;
    }
  }
  // Revocation has to stick for the same reason unposting a walk does: it is
  // the direction that must never silently undo itself. A token is revoked
  // because the push service told us it is dead or because someone turned
  // notifications off, and a restart that resurrected it would send to a
  // dead endpoint forever, or to a person who asked us to stop.
  if (touched) persistLocal();

  const db = adminDb();
  if (!db) return;
  try {
    const { error } = await db
      .from("push_tokens")
      .update({ revoked_at: new Date(now).toISOString() })
      .in("token", tokens)
      .is("revoked_at", null);
    if (error) console.warn("[push] could not revoke tokens (non-fatal):", error.message);
  } catch (err) {
    console.warn("[push] could not revoke tokens (non-fatal):", err);
  }
}
