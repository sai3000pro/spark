/**
 * The user's KIRI key, held server-side and never handed back.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS, AND WHAT IT IS NOT
 *
 * A globalThis singleton, exactly like lib/handoff.ts and lib/liveTrip.ts: it
 * survives dev module reloads, does not survive a restart, and is single
 * process. For a key someone pastes in before a capture that is a reasonable
 * trade — the cost of a restart is pasting it again.
 *
 * It is NOT the Phase 2 design. That one is AES-256-GCM at rest with AAD
 * `${user_id}:${provider}`, a `key_version` column for rotation, multiple keys
 * per user with failover, and decryption only inside a `withKey` callback so
 * plaintext never lands in a logged object. All of that needs auth and a
 * database, which do not exist yet — see tasks #3 and #4. Building the
 * encrypted store now would mean encrypting against a user id that is always
 * null, which is theatre rather than security.
 *
 * WHAT IS ALREADY TRUE, AND MUST STAY TRUE:
 *
 *   · The key is NEVER returned to a client. `describeKey()` is the only read
 *     the API exposes and it returns a masked tail and a credit count.
 *   · The key is NEVER `NEXT_PUBLIC_`, never in a URL, never in a redirect.
 *   · The key is never included in an error message or a thrown object, so it
 *     cannot reach a log through a stack trace.
 *
 * The one property this file cannot offer is at-rest protection, and the UI
 * says so rather than implying a vault that is not there.
 */
import { checkBalance, creditsOf } from "./kiri";

interface StoredKey {
  key: string;
  addedAt: string;
  /** Last known credits, from the balance check at entry. */
  credits: number | null;
  checkedAt: string | null;
  /**
   * Where it came from. A pasted key is this session's; an env key belongs to
   * the machine and comes back on every boot, which changes what "forget it"
   * can honestly promise.
   */
  source: "env" | "pasted";
  /**
   * KIRI's own words for refusing this key, or null while it is believed good.
   *
   * Only ever set from a TERMINAL result — see kiri.ts, where a network failure
   * is `terminal: false` and a rejected credential is `true`. That distinction
   * is the whole point: an unreachable KIRI must not retire a working key, and
   * a typo in `.env` must not survive to cost someone a 100 MB upload.
   */
  rejected: string | null;
}

interface Store {
  kiri: StoredKey | null;
  /**
   * The env key was explicitly dismissed in this process.
   *
   * Without this, `clearKiriKey()` is a lie whenever the key came from the
   * environment: the next read would re-seed it from `process.env` and the key
   * someone just removed would silently reappear.
   */
  envDismissed: boolean;
}

const KEY = Symbol.for("spark.reconstruction.keys");

function store(): Store {
  const g = globalThis as unknown as Record<symbol, Store | undefined>;
  return (g[KEY] ??= { kiri: null, envDismissed: false });
}

/**
 * `KIRI_API_KEY` in `.env.local`, adopted as if it had been pasted.
 *
 * Why an env key at all: pasting into the UI is the right flow for someone
 * else's laptop, and the wrong one for your own machine, where a process
 * restart currently costs you the key and the singleton above cannot help. A
 * dev running the capture flow should be able to write it down once.
 *
 * NEVER `NEXT_PUBLIC_`. That prefix inlines the value into the client bundle,
 * which would publish the key to every visitor — the one mistake this file's
 * header rules out in three separate ways, and the one an env var makes easy.
 *
 * Seeded lazily on first read rather than at import: `process.env` is populated
 * by the time a request runs, and doing it here means every accessor below sees
 * it without an initialisation order to get wrong. Credits stay unknown until
 * `refreshKiriCredits()` asks KIRI — an unvalidated key is still offered,
 * because `dispatch` finds out for real and the clip is stored either way.
 */
function seedFromEnv(): void {
  const s = store();
  if (s.kiri || s.envDismissed) return;

  const raw = process.env.KIRI_API_KEY?.trim();
  if (!raw || raw.length < 8) return;

  s.kiri = {
    key: raw,
    addedAt: new Date().toISOString(),
    credits: null,
    checkedAt: null,
    source: "env",
    rejected: null,
  };
}

/** What a client is allowed to know: that there is one, and roughly how much is left. */
export interface KeyDescription {
  present: boolean;
  /** Last four characters only — enough to tell two keys apart, useless alone. */
  tail: string | null;
  credits: number | null;
  addedAt: string | null;
  /** Where it came from, so the UI can stop offering "forget it" for an env key. */
  source: "env" | "pasted" | null;
  /** KIRI's reason for refusing it, when it has. */
  rejected: string | null;
}

export function describeKey(): KeyDescription {
  seedFromEnv();
  const k = store().kiri;
  if (!k) {
    return { present: false, tail: null, credits: null, addedAt: null, source: null, rejected: null };
  }
  return {
    present: true,
    tail: k.key.slice(-4),
    credits: k.credits,
    addedAt: k.addedAt,
    source: k.source,
    rejected: k.rejected,
  };
}

/**
 * Ask KIRI what this key is actually worth, and remember the answer.
 *
 * A pasted key is validated at entry by `setKiriKey`; an env key has never been
 * checked, so without this the menu would offer KIRI on the strength of a
 * string in a file. Called by /api/reconstruction/targets, which is already the
 * probe-before-you-offer path for the studio.
 *
 * Never throws and never clears: a network blip is not evidence that a key is
 * bad, and dropping it here would take the option away for the wrong reason.
 * `checkedAt` records that we asked, so an unreachable KIRI is distinguishable
 * from one that answered zero.
 */
export async function refreshKiriCredits(): Promise<void> {
  seedFromEnv();
  const k = store().kiri;
  if (!k) return;

  const balance = await checkBalance(k.key).catch(() => null);
  if (!balance) return;

  if (!balance.ok) {
    // DELIBERATELY NOT RETIRING THE KEY.
    //
    // `/balance` is the one endpoint in this client with no second source: the
    // other integration we checked against (../../../atlas/src/lib/kiri.server.ts)
    // never calls it, so its response shape and its auth behaviour are both
    // unconfirmed. Treating its failure as proof that a key is bad means an
    // endpoint we do not trust can block a key that works — which is a worse
    // outcome than the one it was added to prevent.
    //
    // So it is ADVISORY: it can tell us a credit count, and it can never take
    // the KIRI option away. A key that is genuinely dead is found out by
    // `dispatch`, which reports it in KIRI's own words with the clip still
    // safely on disk.
    //
    // To make it authoritative again once /balance is confirmed against a live
    // key: set `k.rejected = balance.message` here when `balance.terminal`.
    return;
  }

  k.credits = creditsOf(balance.data);
  k.rejected = null;
  k.checkedAt = new Date().toISOString();
}

/** KIRI's reason for refusing the stored key, or null while it looks good. */
export function kiriRejected(): string | null {
  seedFromEnv();
  return store().kiri?.rejected ?? null;
}

export type SetKeyResult =
  | { ok: true; description: KeyDescription }
  | { ok: false; reason: string };

/**
 * Store a key, but only after KIRI itself has accepted it.
 *
 * Validating on entry rather than at submit time is the difference between
 * finding out now and finding out after a three-minute upload — and it is also
 * the only moment we can read the credit balance, which decides whether the
 * KIRI option is even offered.
 */
export async function setKiriKey(raw: string): Promise<SetKeyResult> {
  const key = raw.trim();
  if (key.length < 8) return { ok: false, reason: "That does not look like a KIRI key." };

  // Advisory, for the same reason as refreshKiriCredits above: a `/balance` we
  // cannot corroborate must not be able to refuse a key someone just pasted.
  // The credit count is kept when it answers and the key is stored either way.
  const balance = await checkBalance(key).catch(() => null);
  const credits = balance?.ok ? creditsOf(balance.data) : null;
  const s = store();
  s.kiri = {
    key,
    addedAt: new Date().toISOString(),
    credits,
    checkedAt: new Date().toISOString(),
    source: "pasted",
    rejected: null,
  };
  // A pasted key is a deliberate override of whatever the environment says, and
  // it must survive the next read rather than being replaced by the env one.
  s.envDismissed = true;
  return { ok: true, description: describeKey() };
}

/**
 * Forget it — and mean it, even when the environment would hand it straight back.
 *
 * Only for this process: the value is still in `.env.local`, so a restart
 * re-adopts it. The API route says so rather than implying the file changed.
 */
export function clearKiriKey(): void {
  const s = store();
  s.kiri = null;
  s.envDismissed = true;
}

/**
 * Use the key without copying it anywhere.
 *
 * A callback rather than a getter so there is no `const key = getKey()` sitting
 * in a scope that something might later serialise. Mirrors the `withKey` shape
 * the Phase 2 design lands on, so the call sites do not change when the real
 * encrypted store arrives.
 */
export async function withKiriKey<T>(
  fn: (key: string) => Promise<T>,
): Promise<T | null> {
  seedFromEnv();
  const k = store().kiri;
  if (!k) return null;
  return fn(k.key);
}

export function hasKiriKey(): boolean {
  seedFromEnv();
  return store().kiri !== null;
}

export function kiriCredits(): number | null {
  seedFromEnv();
  return store().kiri?.credits ?? null;
}

/** Spend one, locally, so the UI stops offering a route that will now fail. */
export function noteCreditSpent(): void {
  const k = store().kiri;
  if (k && typeof k.credits === "number") k.credits = Math.max(0, k.credits - 1);
}

export function __resetKeys(): void {
  store().kiri = null;
}
