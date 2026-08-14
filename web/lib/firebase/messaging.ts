"use client";

/**
 * Asking for permission to interrupt someone, and then earning it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS ACTUALLY BUYING
 *
 * A KIRI reconstruction is minutes, not seconds, and the polling watcher gives
 * up after thirty of them. So the honest shape of the wait is: start it, close
 * the tab, go and do something else. Everything downstream of that already
 * works — the job record is on disk, reopening the page resumes the collection —
 * except the part where anyone finds out. This is that part, and it is the only
 * notification this app will ever send.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PROMPT IS EXPENSIVE AND YOU ONLY GET ONE
 *
 * A denied notification permission is close to permanent: it does not expire, it
 * cannot be asked for again, and clearing it means finding a padlock icon in a
 * toolbar. Browsers know this and have started punishing sites that spend it
 * carelessly — Firefox and Safari require a gesture outright, and Chrome quietly
 * demotes origins whose prompts are dismissed.
 *
 * Which is why `enablePush()` is a function you call from a click handler and
 * nothing here runs on mount. `pushSupport()` is a pure read — it touches no
 * browser permission state and shows no dialog — so a component can decide
 * whether it has anything to offer without having asked anybody anything.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY EXIT IS A SENTENCE
 *
 * There are eight or nine distinct reasons this can fail and most of them are
 * indistinguishable from each other at the call site: unconfigured project,
 * missing VAPID key, http origin, private window, iOS Safari before the app is
 * installed to the home screen, a blocked service worker, a denied prompt. A
 * boolean return would collapse all of that into "it didn't work", so every
 * outcome carries the sentence the UI should show, phrased for a person.
 */
import { firebaseVapidKey, firebaseWebConfig, getFirebaseApp } from "./client";

export type PushSupport = { ok: true } | { ok: false; why: string };

/**
 * Can this browser, on this deployment, be told anything?
 *
 * Pure and synchronous, and it never touches `Notification.requestPermission`.
 * Safe to call during an effect on every render.
 */
export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return { ok: false, why: "Not in a browser." };

  // Configuration first, because it is the one that is true right now for
  // everybody, and there is no point telling someone their browser is fine when
  // the deployment has no project to register against.
  if (!firebaseWebConfig()) {
    return { ok: false, why: "This deployment has no Firebase project configured." };
  }
  if (!firebaseVapidKey()) {
    return { ok: false, why: "This deployment has no web push key configured." };
  }

  if (!("serviceWorker" in navigator)) {
    return { ok: false, why: "This browser has no service workers, so push cannot be delivered." };
  }
  if (!("PushManager" in window)) {
    return { ok: false, why: "This browser does not support web push." };
  }
  if (!("Notification" in window)) {
    return { ok: false, why: "This browser does not support notifications." };
  }
  /*
    Service workers and push require a secure context. `localhost` counts, which
    is why this is `isSecureContext` and not a check on the protocol — the phone
    handoff serves this app over a tunnel and the laptop over plain http on
    localhost, and both of those are fine.
  */
  if (!window.isSecureContext) {
    return { ok: false, why: "Notifications need https — this page is not on a secure origin." };
  }
  return { ok: true };
}

/**
 * What the browser currently thinks, without asking it anything.
 *
 * Null when there is no Notification API at all, which is a different state from
 * "default" and the caller renders it differently.
 */
export function pushPermission(): NotificationPermission | null {
  if (typeof window === "undefined" || !("Notification" in window)) return null;
  return Notification.permission;
}

export type EnableResult =
  /** Permission granted, a token exists, and the server has it. */
  | { k: "on"; durable: boolean; note: string }
  /** The prompt was shown and refused. There is no second chance; say so once. */
  | { k: "denied"; note: string }
  /** The prompt was shown and dismissed. Askable again in principle — but not by us. */
  | { k: "dismissed"; note: string }
  /** Never got as far as the prompt. */
  | { k: "unavailable"; note: string };

/**
 * Register this browser for "your reconstruction is ready".
 *
 * MUST be called from a user gesture. Everything before the token — the SDK
 * fetch, the worker registration — is deliberately ordered AFTER the permission
 * prompt, so a reader who says no never pays for a service worker or a few
 * hundred KB of messaging SDK they will not use.
 */
export async function enablePush(): Promise<EnableResult> {
  const support = pushSupport();
  if (!support.ok) return { k: "unavailable", note: support.why };

  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    /*
      Older Safari only has the callback form and rejects the promise form. Not
      worth a shim: it means the reader saw no dialog, so nothing was spent and
      the honest answer is that it did not work here.
    */
    return { k: "unavailable", note: "This browser would not show the permission prompt." };
  }

  if (permission === "denied") {
    return {
      k: "denied",
      note: "Notifications are blocked for this site. Your browser's padlock menu can undo that.",
    };
  }
  if (permission !== "granted") {
    return {
      k: "dismissed",
      note: "No answer, so nothing changed. Nothing will ask again.",
    };
  }

  const app = await getFirebaseApp();
  const vapidKey = firebaseVapidKey();
  if (!app || !vapidKey) {
    return { k: "unavailable", note: "This deployment has no Firebase project configured." };
  }

  try {
    const { getMessaging, getToken, isSupported } = await import("firebase/messaging");

    /*
      The SDK's own verdict, which knows things the feature checks above cannot:
      most usefully that iOS Safari only permits web push for a site that has
      been added to the home screen. Asked after the prompt because it is a
      network-free local check and the prompt is the expensive part.
    */
    if (!(await isSupported())) {
      return {
        k: "unavailable",
        note: "This browser cannot receive web push. On an iPhone, add this app to your home screen first.",
      };
    }

    /*
      Register the worker ourselves and hand the registration over, rather than
      letting getToken() find `/firebase-messaging-sw.js` on its own.

      Two reasons. A registration failure surfaces HERE, as a sentence, instead
      of inside the SDK as an unhelpful `messaging/failed-service-worker-
      registration`. And `ready` guarantees the worker is active before a
      subscription is minted against it — a token issued against a worker that
      then fails to activate is a token FCM will happily accept and never be
      able to deliver to, which is the worst possible outcome because everything
      reports success.
    */
    await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/" });
    const registration = await navigator.serviceWorker.ready;

    const token = await getToken(getMessaging(app), {
      vapidKey,
      serviceWorkerRegistration: registration,
    });
    if (!token) {
      return { k: "unavailable", note: "The browser would not issue a push token." };
    }

    const stored = await storeToken(token);
    return {
      k: "on",
      durable: stored.durable,
      note: stored.note,
    };
  } catch (err) {
    /*
      Never rethrow. This is reached from a click handler in a panel about
      reconstructions; an unhandled rejection here would be a red overlay in dev
      over a feature nobody's work depends on.
    */
    return {
      k: "unavailable",
      note: `Push could not be set up here (${err instanceof Error ? err.message : String(err)}).`,
    };
  }
}

/**
 * Stop. Deletes the token at FCM and revokes it server side.
 *
 * The browser permission is deliberately NOT touched, because a page cannot
 * revoke it and pretending otherwise would be a lie in the UI. What this does is
 * make the app stop using a permission it has — which is the part we control,
 * and the part that actually stops the notifications.
 */
export async function disablePush(): Promise<void> {
  try {
    const app = await getFirebaseApp();
    if (!app) return;
    const { deleteToken, getMessaging, isSupported } = await import("firebase/messaging");
    if (!(await isSupported())) return;
    const messaging = getMessaging(app);

    /*
      Tell the server first. If deleteToken succeeds and the POST then fails we
      have a row pointing at a token that no longer exists — harmless, since the
      send path prunes on FCM's own UNREGISTERED reply, but it is a dead endpoint
      we knew about and left. This order leaves the opposite and better residue:
      at worst a live token nobody will send to.
    */
    const token = await currentToken(messaging);
    if (token) await forgetToken(token);
    await deleteToken(messaging);
  } catch {
    // Turning something off must never fail loudly.
  }
}

/**
 * The token this browser already holds, if any.
 *
 * `getToken` is the only way to read it and it will mint a new one as a side
 * effect if there is none — which is why this is only ever called from the
 * disable path, where a token is known to exist and minting one would be
 * absurd but harmless.
 */
async function currentToken(
  messaging: import("firebase/messaging").Messaging,
): Promise<string | null> {
  const vapidKey = firebaseVapidKey();
  if (!vapidKey) return null;
  try {
    const { getToken } = await import("firebase/messaging");
    return (await getToken(messaging, { vapidKey })) || null;
  } catch {
    return null;
  }
}

async function storeToken(token: string): Promise<{ durable: boolean; note: string }> {
  try {
    const res = await fetch("/api/push/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token,
        platform: "web",
        // Purely so a person can tell two of their own devices apart in a list.
        // Never used to decide anything.
        userAgent: navigator.userAgent,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { durable?: boolean; note?: string };
    return {
      durable: body.durable ?? false,
      note: body.note ?? "This browser will be told when a reconstruction finishes.",
    };
  } catch {
    /*
      The permission is granted and the token is real; only the round trip
      failed. Reported as on-but-not-durable rather than as a failure, because
      the expensive irreversible part — the prompt — did succeed, and telling
      someone it did not would invite them to try again for nothing.
    */
    return {
      durable: false,
      note: "Allowed, but the server did not record it. It will be recorded next time this page loads.",
    };
  }
}

async function forgetToken(token: string): Promise<void> {
  await fetch("/api/push/register", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  }).catch(() => undefined);
}
