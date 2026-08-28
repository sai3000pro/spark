/**
 * The origin check the API routes never had.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS ACTUALLY WRONG
 *
 * Thirty handlers under /api accept POST or DELETE. Not one of them looked at
 * where the request came from, and this app has no accounts, no session cookie
 * and no CSRF token — so "who is allowed to call this" had exactly one answer
 * everywhere: anybody who can reach the port.
 *
 * That sounds like the trade-off already written down in
 * app/api/splat/jobs/[jobId]/dispatch/route.ts ("guarded by knowing the job
 * id... LAN-appropriate and no more"). It is not the same thing. Reaching the
 * port is not something only the person at the laptop can do: ANY WEBSITE the
 * user visits in the same browser can POST to http://localhost:3000, because a
 * cross-origin `fetch` with a CORS-simple content type is sent WITHOUT a
 * preflight. The attacker cannot read the response — no route sends
 * Access-Control-Allow-Origin — but every side effect still happens.
 *
 * And `Request.json()` does not check the content type. Measured, not assumed:
 *
 *   new Request(url, { method: "POST",
 *                      headers: { "content-type": "text/plain;charset=UTF-8" },
 *                      body: JSON.stringify({ session: "pwned" }) }).json()
 *   -> { session: "pwned" }
 *
 * `text/plain` is CORS-simple. So a `no-cors` POST from any tab landed in the
 * handler with a fully parsed body, and /api/capture/delete deleted a capture.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT ALSO DEFEATED THE FIX IN ff5ebe4
 *
 * That commit gave the studio an origin allowlist, precisely so a random site
 * could not enumerate somebody's captures or delete a session. But the studio
 * allows requests with NO Origin header — it has to, because that is what a
 * server-side proxy call looks like, and it says so in its own comment.
 *
 * This app IS that proxy. /api/capture/delete, /api/capture/full-run and
 * /api/album/{rename,place,thumb} take a body from the caller and forward it to
 * the studio server-side. So the studio's allowlist was bypassable through here
 * by any origin at all: a confused deputy with no check of its own, calling a
 * careful service in the one way that careful service is obliged to trust.
 *
 * It could not be fixed in the studio. From the studio's side those calls are
 * indistinguishable from legitimate ones. It had to be fixed here.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A FUNCTION AND NOT proxy.ts, WHICH IS WHERE IT BELONGS
 *
 * It was written in proxy.ts first. That is the right shape — one place a new
 * route cannot forget to opt into — and it is wrong here for a specific reason,
 * which proxy.ts's own matcher comment already gives: `/api/*` is excluded
 * DELIBERATELY, because Next buffers a matched request's body in memory so it
 * can be read twice.
 *
 * The docs are blunt about what happens past the cap
 * (node_modules/next/dist/docs/01-app/03-api-reference/05-config/
 * 01-next-config-js/proxyClientMaxBodySize.md): the default is 10 MB, and past
 * it "only the partial body will be available" and "the request will not fail".
 * This app POSTs video — the phone handoff upload and /api/upload/walk carry
 * tens to hundreds of megabytes. Matching /api would therefore have TRUNCATED
 * every real capture to 10 MB, silently, and written the fragment to disk while
 * reporting success. Raising `proxyClientMaxBodySize` instead only moves the
 * problem: it would hold a 500 MB clip in proxy memory on top of the stream.
 *
 * So the check is a call at the top of each handler, before a byte of the body
 * is read. The cost is that a new route can forget it — and that is why
 * scripts/verify-origin.ts reads every route file and fails if a mutating
 * handler does not call this. The enforcement moved; it did not disappear.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY STILL ALLOWED
 *
 * Non-browser clients: spark-studio.exe pushing a .ply to /api/splat/upload
 * (tools/spark_studio/push.py, urllib), curl, the rover posting detections.
 * None of them send `Origin` or `Sec-Fetch-Site`, and none of them can be a CSRF
 * vector — CSRF needs a browser holding somebody's ambient authority. A check
 * that broke them would trade a real capability for no security at all.
 *
 * The phone is unaffected: every request it makes is to a RELATIVE path from the
 * page it is already on — /api/capture/handoff/<id>/upload, /api/capture/posed/
 * <id>, /api/reconstruction/targets — so it is same-origin whether that page came
 * from a LAN IP or a *.trycloudflare.com tunnel.
 *
 * Reads are not checked at all. A cross-origin GET cannot be read back without
 * Access-Control-Allow-Origin, which nothing here sends, so refusing them would
 * break every poll in the app to prevent nothing.
 */
import { NextResponse } from "next/server";

/**
 * Extra origins allowed to make mutating calls, comma-separated.
 *
 * The equivalent of the studio's `--allow-origin`, and for the same case: a
 * front end deployed somewhere else that legitimately talks to this API. A
 * decision somebody makes explicitly, never one they inherit from a default.
 */
function allowedOrigins(): string[] {
  return (process.env.SPARK_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

/**
 * The host this request was actually addressed to.
 *
 * `x-forwarded-host` first because the tunnel case is the one that matters: the
 * phone loads https://something.trycloudflare.com, cloudflared forwards it to
 * localhost:3000, and the raw Host header is then the wrong thing to compare an
 * Origin against. Getting this backwards would refuse the phone handoff — the
 * flow this whole app exists for.
 */
function addressedHost(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-host");
  if (forwarded) return forwarded.split(",")[0].trim().toLowerCase();
  return request.headers.get("host")?.trim().toLowerCase() ?? null;
}

function sameHost(origin: string, request: Request): boolean {
  const host = addressedHost(request);
  if (!host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    // An Origin that is not a URL is not one we can match. The literal string
    // "null" arrives this way — a sandboxed iframe, a file:// page — and it is
    // emphatically not same-origin.
    return false;
  }
}

/**
 * Is this write allowed to have come from where it came from?
 *
 * Returns a ready-to-return 403, or `null` when the request may proceed. A
 * response rather than a boolean so no caller has to invent the refusal, and so
 * every route refuses in the same words.
 *
 * CALL IT FIRST, before reading the body. That is not a style preference: on the
 * upload routes the body is hundreds of megabytes, and a check that runs after
 * it has been streamed to disk has already done the thing it was meant to
 * prevent.
 */
export function crossOriginRefusal(request: Request): NextResponse | null {
  const site = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  const extra = allowedOrigins();

  /*
    The named-origin case short-circuits, and it has to.

    This was written as a third clause of `originOk` first, and the effect was
    that SPARK_ALLOWED_ORIGINS did nothing whatsoever: a request from a deployed
    front end on another host arrives with `Sec-Fetch-Site: cross-site` — that is
    what it IS — so requiring both conditions refused every origin the variable
    was set to permit. scripts/verify-origin.ts caught it, which is the whole
    reason that file asserts the escape hatch rather than only the refusals.

    Naming an origin here is a statement that its cross-site requests are wanted.
    Nothing else in this function can be asked to infer that.
  */
  if (origin !== null && extra.includes(origin.replace(/\/$/, ""))) return null;

  /*
    Two independent signals, because they cover different browsers and neither
    covers everything.

    `Sec-Fetch-Site` is the precise one — the browser states the relationship
    rather than leaving it to be inferred — and it cannot be set from script: it
    is a forbidden header name.

    `Origin` is the fallback for anything not sending Sec-Fetch metadata, and it
    is checked SEPARATELY rather than as an else-branch. A request carrying a
    foreign Origin is refused whatever its Sec-Fetch-Site says, so neither header
    can be used to talk past the other.
  */
  const originOk = origin === null || sameHost(origin, request);

  /*
    `none` is a request with no initiator — a typed address, a bookmark. It
    cannot be a cross-site attack, because there is no attacking page.

    `same-site` is NOT accepted. It means a different origin under the same
    registrable domain, which on a shared tunnel host is a sibling tunnel
    somebody else owns. Same-origin or nothing.
  */
  const siteOk = site === null || site === "same-origin" || site === "none";

  if (originOk && siteOk) return null;

  /*
    A sentence, not a bare 403. Everything else in this app that refuses says
    why, and the person most likely to read this is a developer who has just
    moved the front end to another origin and has no idea this check exists.
  */
  return NextResponse.json(
    {
      error: "cross-origin request refused",
      reason:
        "This API only accepts writes from a page served by this deployment. " +
        "Set SPARK_ALLOWED_ORIGINS to name another origin explicitly.",
      origin: origin ?? null,
      site: site ?? null,
    },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}
