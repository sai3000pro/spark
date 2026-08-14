"use client";

/**
 * Firebase in the browser — initialised lazily, or never at all.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MIRROR OF ./admin.ts, AND IT MAKES THE SAME PROMISE
 *
 * The server half logs once and becomes a set of no-ops when
 * FIREBASE_SERVICE_ACCOUNT_B64 is missing, because a missing push provider must
 * never fail a reconstruction that otherwise succeeded. This half owes the
 * reader the same guarantee for the same reason: with no Firebase configured —
 * which is how this app runs today, on KIRI_API_KEY alone — every function here
 * resolves to `null` and nothing on screen changes. No throw, no console noise
 * past a single informational line, no render that depends on it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY EVERY IMPORT IS DYNAMIC
 *
 * `firebase/app` + `firebase/database` + `firebase/auth` is a few hundred KB of
 * JavaScript. A static import puts all of it in the bundle of whatever component
 * touches this module, which means a reader who has no Firebase project — again,
 * today, everyone — downloads and parses it in order for it to do nothing. That
 * is a real cost paid by someone who receives no feature in return.
 *
 * So the config gate is checked FIRST, synchronously, off inlined
 * `NEXT_PUBLIC_*` literals, and the SDK is only fetched on the far side of it.
 * Unconfigured, the chunk is never requested.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THERE IS AN ANONYMOUS SIGN-IN IN A PRODUCT WITH NO ACCOUNTS
 *
 * The RTDB rules in ./progress.ts read `auth.uid === $userId`. That is not
 * decoration — write is denied outright and read is denied to anyone who cannot
 * name themselves, which is what stops one reader watching another's job. A
 * browser therefore needs *an* identity, and the cheapest honest one is Firebase
 * anonymous auth: no email, no account, no consent dialog, a uid that lives in
 * IndexedDB and is thrown away with site data.
 *
 * That uid is what this module calls a CHANNEL. It is not a user, it makes no
 * claim about who anybody is, and nothing is authorised by it — it exists so a
 * progress frame has somewhere to go that only the browser that asked for it can
 * read. If anonymous sign-in is not enabled on the project, `getChannelId()`
 * returns null, no frames are published, and every watcher falls back to polling
 * `splat_jobs` — which was already the contract, and is why losing this loses a
 * spinner rather than an answer.
 */
import type { FirebaseApp } from "firebase/app";
import type { Database } from "firebase/database";

/**
 * Named, so it cannot collide with a default app initialised by anything else
 * on the page. Same reasoning as APP_NAME in ./admin.ts.
 */
const APP_NAME = "spark-web";

export interface FirebaseWebConfig {
  apiKey: string;
  projectId: string;
  appId: string;
  databaseURL: string;
  messagingSenderId: string;
}

/**
 * The five values, or nothing.
 *
 * Read as whole `process.env.NEXT_PUBLIC_*` literals rather than through a
 * loop or a helper, because that is the only form the bundler can find and
 * inline — `process.env[name]` is `undefined` in the browser, silently, and the
 * feature would simply never turn on with no error to explain it.
 *
 * All-or-nothing on purpose. A half-filled block is a typo, and a Firebase app
 * initialised without `databaseURL` fails later, deeper, and less legibly than
 * one that was never initialised at all.
 */
export function firebaseWebConfig(): FirebaseWebConfig | null {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
  const databaseURL = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL;
  const messagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
  if (!apiKey || !projectId || !appId || !databaseURL || !messagingSenderId) return null;
  return { apiKey, projectId, appId, databaseURL, messagingSenderId };
}

/**
 * The VAPID public key, for web push.
 *
 * Public by design — it is the key a browser uses to verify that a push came
 * from the sender it subscribed to, and it is meant to be in the bundle. The
 * PRIVATE half lives inside the Firebase project and never leaves it, which is
 * why there is no server-side counterpart to this in .env.example.
 */
export function firebaseVapidKey(): string | null {
  return process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || null;
}

export function isFirebaseConfigured(): boolean {
  return firebaseWebConfig() !== null;
}

let told = false;

/**
 * One line, once, and only in development.
 *
 * The unconfigured case is the NORMAL case for this app, not a fault, so it must
 * not look like one — a warning on every page load teaches the reader to ignore
 * the console, which is the actual cost of noisy logging. `console.info` in dev
 * only; a production build says nothing whatsoever.
 */
function noteOnce(message: string): void {
  if (told) return;
  told = true;
  if (process.env.NODE_ENV !== "production") console.info(`[firebase] ${message}`);
}

let appPromise: Promise<FirebaseApp | null> | null = null;

/** The app handle, or null. Memoised — the SDK is fetched at most once. */
export function getFirebaseApp(): Promise<FirebaseApp | null> {
  appPromise ??= (async () => {
    const config = firebaseWebConfig();
    if (!config) {
      noteOnce(
        "not configured in the browser — live progress and push are off. " +
          "Watchers poll /api/splat/jobs instead, which is the fallback the design assumes.",
      );
      return null;
    }
    try {
      const { getApps, initializeApp } = await import("firebase/app");
      return getApps().find((a) => a.name === APP_NAME) ?? initializeApp(config, APP_NAME);
    } catch (err) {
      noteOnce(`SDK failed to load (non-fatal): ${String(err)}`);
      return null;
    }
  })();
  return appPromise;
}

let channelPromise: Promise<string | null> | null = null;

/**
 * This browser's channel id — the `$userId` segment of its progress path.
 *
 * Memoised as a PROMISE rather than a value so that ten components mounting at
 * once produce one sign-in rather than ten. The sign-in itself is idempotent
 * across reloads: the SDK persists the anonymous credential, so this is a
 * round-trip on first visit and a local read forever after.
 *
 * Returns null, never throws. The common reason for null in a real project is
 * that Anonymous sign-in was left disabled in the Firebase console — which
 * degrades to polling rather than to an error, so it is worth knowing but not
 * worth interrupting anyone over.
 */
export function getChannelId(): Promise<string | null> {
  channelPromise ??= (async () => {
    const app = await getFirebaseApp();
    if (!app) return null;
    try {
      const { getAuth, signInAnonymously } = await import("firebase/auth");
      const auth = getAuth(app);
      if (auth.currentUser) return auth.currentUser.uid;
      const credential = await signInAnonymously(auth);
      return credential.user.uid;
    } catch (err) {
      noteOnce(
        "anonymous sign-in failed, so there is no channel to read progress on " +
          `— enable it under Authentication → Sign-in method if you want live frames (${String(err)})`,
      );
      return null;
    }
  })();
  return channelPromise;
}

let databasePromise: Promise<Database | null> | null = null;

/** The RTDB handle, or null. */
export function getProgressDatabase(): Promise<Database | null> {
  databasePromise ??= (async () => {
    const app = await getFirebaseApp();
    if (!app) return null;
    try {
      const { getDatabase } = await import("firebase/database");
      return getDatabase(app);
    } catch (err) {
      noteOnce(`RTDB failed to initialise (non-fatal): ${String(err)}`);
      return null;
    }
  })();
  return databasePromise;
}
