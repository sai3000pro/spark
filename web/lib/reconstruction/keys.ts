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
}

interface Store {
  kiri: StoredKey | null;
}

const KEY = Symbol.for("spark.reconstruction.keys");

function store(): Store {
  const g = globalThis as unknown as Record<symbol, Store | undefined>;
  return (g[KEY] ??= { kiri: null });
}

/** What a client is allowed to know: that there is one, and roughly how much is left. */
export interface KeyDescription {
  present: boolean;
  /** Last four characters only — enough to tell two keys apart, useless alone. */
  tail: string | null;
  credits: number | null;
  addedAt: string | null;
}

export function describeKey(): KeyDescription {
  const k = store().kiri;
  if (!k) return { present: false, tail: null, credits: null, addedAt: null };
  return {
    present: true,
    tail: k.key.slice(-4),
    credits: k.credits,
    addedAt: k.addedAt,
  };
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

  const balance = await checkBalance(key);
  if (!balance.ok) {
    // `balance.message` is KIRI's own phrasing and never contains the key.
    return { ok: false, reason: balance.message };
  }

  const credits = creditsOf(balance.data);
  store().kiri = {
    key,
    addedAt: new Date().toISOString(),
    credits,
    checkedAt: new Date().toISOString(),
  };
  return { ok: true, description: describeKey() };
}

export function clearKiriKey(): void {
  store().kiri = null;
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
  const k = store().kiri;
  if (!k) return null;
  return fn(k.key);
}

export function hasKiriKey(): boolean {
  return store().kiri !== null;
}

export function kiriCredits(): number | null {
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
