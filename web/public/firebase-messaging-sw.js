/*
 * The service worker that receives "your reconstruction is ready".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE HAS TO EXIST AND WHY IT HAS TO BE CALLED THIS
 *
 * A web push cannot be delivered to a page. The browser wakes a service worker,
 * hands it the payload, and the worker is the only thing permitted to show a
 * notification — so without a worker at the origin root there is no push at all,
 * regardless of what the server sends. FCM looks for exactly
 * `/firebase-messaging-sw.js` when `getToken()` is called without an explicit
 * registration, which is what fixes both the name and the location.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO `importScripts`, NO FIREBASE SDK, NO NETWORK AT INSTALL
 *
 * The documented recipe is two `importScripts()` calls against
 * `www.gstatic.com/firebasejs/<version>/firebase-{app,messaging}-compat.js`,
 * followed by re-declaring the whole Firebase config inside the worker. Both
 * halves of that are liabilities here:
 *
 *   · The config is not available to a static file in `public/`. Every workaround
 *     — smuggling it through the registration query string, serving the worker
 *     from a route handler, generating it at build time — makes a second copy of
 *     five environment variables that must not drift from lib/firebase/client.ts.
 *
 *   · `importScripts` is a hard network dependency inside the install step. If
 *     gstatic is slow, blocked by an extension, unreachable on the coffee-shop
 *     wifi, or simply does not publish the exact version this repo pins, the
 *     worker fails to install and push silently never works — and the failure
 *     surfaces nowhere a person would look.
 *
 * None of it buys anything, because FCM web push IS standard Web Push. The
 * browser has already decrypted the payload by the time it reaches the handler
 * below; `event.data.json()` is the message. The SDK inside a worker is a
 * convenience wrapper over these same two event listeners.
 *
 * So this file has no configuration in it, no dependencies, and nothing to keep
 * in step with anything. It is inert until a push arrives, which — with no
 * Firebase project configured — is never, because nothing ever registers it:
 * see `enablePush()` in lib/firebase/messaging.ts, which returns before touching
 * `navigator.serviceWorker` unless a config and a VAPID key both exist.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PAYLOAD SHAPE
 *
 * lib/firebase/admin.ts sends `notification` (title/body), `data.url`, and
 * `webpush.fcmOptions.link`. FCM flattens those differently depending on how the
 * message was composed and on the version of the transport, so every field is
 * read defensively from more than one place rather than trusting one shape. A
 * push that arrives and cannot be rendered is worse than no push: the browser
 * has already woken the worker, and some platforms punish a wake that shows
 * nothing by showing their own "site updated in the background" notice.
 */

/*
 * Take over without waiting for every tab to close.
 *
 * The default lifecycle leaves a new worker "waiting" until the last page using
 * the old one is gone, which for a laptop that keeps this app open for days
 * means a fix here would not land for days. There is no in-page state to
 * corrupt — this worker owns notifications and nothing else — so skipping the
 * wait is free.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/** Where a notification click should land when the message did not say. */
const FALLBACK_URL = "/live";

function payloadOf(event) {
  if (!event.data) return {};
  try {
    return event.data.json() || {};
  } catch {
    /*
      Not JSON. FCM does not send anything else, but a browser will deliver any
      push encrypted to this subscription, and a parse error inside a push
      handler aborts the event — which on some platforms counts as "the site
      woke up and did nothing" and earns a generic system notification. Falling
      back to plain text keeps that from happening.
    */
    try {
      return { notification: { body: event.data.text() } };
    } catch {
      return {};
    }
  }
}

function linkFrom(payload) {
  const data = payload.data || {};
  const notification = payload.notification || {};
  return (
    data.url ||
    data.link ||
    (payload.fcmOptions && payload.fcmOptions.link) ||
    notification.click_action ||
    FALLBACK_URL
  );
}

/**
 * Is a tab of this app open and on screen right now?
 *
 * If it is, the person is already looking at the thing the notification is
 * about — ReconstructionWatch is on the page saying "landed" in the same second
 * — and a system notification on top of that is noise the user did not ask for.
 * This is the one piece of behaviour the Firebase SW SDK would have given us for
 * free, and it is four lines.
 */
async function someoneIsWatching() {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return windows.some((client) => client.visibilityState === "visible");
}

self.addEventListener("push", (event) => {
  const payload = payloadOf(event);
  const notification = payload.notification || {};
  const data = payload.data || {};

  const title = notification.title || data.title || "Your capture is ready";
  const body = notification.body || data.body || "";
  const url = linkFrom(payload);

  event.waitUntil(
    (async () => {
      if (await someoneIsWatching()) return;
      await self.registration.showNotification(title, {
        body,
        /*
          `icon` is whatever the sender asked for. It is deliberately not
          defaulted to a path in this repo: a 404 on an icon renders as no icon,
          which is fine, but a wrong-looking icon is worse than none and the
          sender is the only thing that knows what this deployment ships.
        */
        icon: notification.icon || data.icon,
        /*
          One notification per job, replaced rather than stacked. A job that
          fails, is retried and then succeeds should leave one line in the
          shade, not three — and `renotify` is what makes the replacement still
          buzz, because the second message genuinely is news.
        */
        tag: data.jobId ? `spark-job-${data.jobId}` : "spark",
        renotify: Boolean(data.jobId),
        /*
          Never sticky. A reconstruction finishing is worth telling someone
          about and is not worth making them dismiss — the walk is not going
          anywhere, and requireInteraction on a notification nobody asked to be
          interrupted by is how a useful feature becomes one people disable.
        */
        requireInteraction: false,
        data: { url },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || FALLBACK_URL;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

      /*
        Reuse a tab rather than opening a fourth copy of the app.

        Matched on origin, not on the full URL: the reader almost certainly has
        this app open somewhere, and focusing that tab and navigating it is what
        they meant. Only when nothing of ours is open is a new window right.
      */
      const origin = self.location.origin;
      const existing = windows.find((client) => client.url.startsWith(origin));
      if (existing) {
        await existing.focus();
        // `navigate` is not implemented everywhere, and a focus with no
        // navigation is still the right outcome — the tab is in front.
        if (typeof existing.navigate === "function") {
          await existing.navigate(target).catch(() => {});
        }
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
