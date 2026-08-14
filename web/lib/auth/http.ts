/**
 * The three things every auth route needs and no two of them should implement
 * differently: where "here" is, where it is safe to send someone next, and what
 * to say when there is no auth server to talk to.
 */
import "server-only";

import { NextResponse } from "next/server";

import { AUTH_UNCONFIGURED_DETAIL } from "@/lib/db/config";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The answer when this deployment has no Supabase project.
 *
 * 503 and not 500: nothing went wrong, a capability is switched off, and the two
 * are different in a way that matters to whoever is reading the network tab at
 * 2am. Not 404 either — the route exists and will start working the moment the
 * env vars appear, and a 404 would send someone hunting for a missing file.
 *
 * It explains itself in the body because the only person who will ever see it is
 * a developer running the demo build, and "Service Unavailable" alone would send
 * them to the wrong place entirely.
 */
export function authUnavailable(): NextResponse {
  return NextResponse.json(
    { error: "auth-unconfigured", detail: AUTH_UNCONFIGURED_DETAIL },
    { status: 503, headers: NO_STORE },
  );
}

export function authError(reason: string, status = 400): NextResponse {
  return NextResponse.json({ error: reason }, { status, headers: NO_STORE });
}

export function authOk(body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, { headers: NO_STORE });
}

/**
 * The public origin of this deployment, for building the link that goes in an
 * email.
 *
 * `request.url` is not enough on its own. Behind the Cloudflare tunnel this app
 * uses for phone handoff (see lib/handoff.ts and next.config.ts) the Node server
 * sees `http://localhost:3000` while the human is on `https://x.trycloudflare.com`
 * — so a magic link built from `request.url` lands the phone on a host it cannot
 * reach, and the PKCE verifier cookie set on the tunnel origin would not be sent
 * to localhost anyway. The forwarded headers carry the origin the browser
 * actually used.
 *
 * These headers are client-controllable in principle, which is fine for THIS use
 * and would not be for others: the value only ever ends up in a redirect target
 * inside an email sent to the address the requester just typed. It is never used
 * to make an authorization decision. If that ever changes, this needs an
 * allowlist of hosts instead.
 */
export function originOf(request: Request): string {
  const headers = request.headers;
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!host) return new URL(request.url).origin;
  const proto =
    headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Where to send someone after they sign in — an OPEN REDIRECT filter.
 *
 * The `next` parameter travels through an email, which makes it the classic
 * phishing primitive: a link to our own domain that bounces the reader to an
 * attacker's, arriving with our reputation attached and, worse, with a fresh
 * session in the browser that just followed it.
 *
 * So only a path is ever accepted, and the rules are all necessary:
 *
 *   · must start with `/`               — no `https://evil.example`
 *   · must not start with `//`          — `//evil.example` is protocol-relative
 *                                         and browsers treat it as absolute
 *   · must not start with `/\` or `\`   — some parsers normalise backslashes to
 *                                         forward slashes, resurrecting the above
 *   · no control characters             — a newline can smuggle a header
 *
 * Anything that fails goes to `/`, silently. There is no case where the right
 * response to a suspicious redirect target is to show the user an error about it.
 */
export function safeNext(value: string | null | undefined, fallback = "/"): string {
  if (!value) return fallback;
  const path = value.trim();
  if (!path.startsWith("/")) return fallback;
  if (path.startsWith("//") || path.startsWith("/\\")) return fallback;
  for (const ch of path) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return fallback;
  }
  return path;
}

/**
 * Is this plausibly an email address?
 *
 * Deliberately loose. The authoritative check is that a message arrives and gets
 * clicked, and a stricter regex only ever rejects somebody's genuinely valid,
 * unusual address. This exists to catch an empty field or a pasted sentence
 * before it becomes a wasted round trip to the auth server.
 */
export function looksLikeEmail(value: unknown): value is string {
  return typeof value === "string" && /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(value.trim());
}
