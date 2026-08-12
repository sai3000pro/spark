/**
 * KIRI Engine — cloud Gaussian-splat reconstruction, bring your own key.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THREE THINGS THIS API DOES THAT WILL BREAK NAIVE CODE
 *
 * Every one of these is handled below, and none of them is defensive
 * programming for its own sake — each is a real response shape.
 *
 *   1. NEVER `res.json()`. The out-of-credit body contains a raw newline inside
 *      a string literal, which is invalid JSON, so `JSON.parse` throws and the
 *      real error ("you have no credits") is replaced by a SyntaxError from a
 *      stack frame that has nothing to do with it. Read `.text()`, parse in a
 *      try/catch, and keep the raw body when it fails.
 *
 *   2. BUSINESS ERRORS ARRIVE AS HTTP 500 WITH `"ok": true`. The status line is
 *      not the answer; `data.code` is. A `res.ok` check reports success on a
 *      rejected video and failure on a fine one.
 *
 *   3. SOME FAILURES ARE TERMINAL AND MUST NOT BE RETRIED ANYWHERE. Codes 2004,
 *      2005, 2007, 2009 and 2010 mean the video itself is unusable — too short,
 *      too few frames, unreadable. Every account in the world will reject it
 *      identically, so retrying against a second key just spends another credit
 *      to be told the same thing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY BYOK, AND WHY THAT IS A HARD WALL
 *
 * KIRI is $1 per credit, one credit per reconstruction, ten free on signup, and
 * the minimum top-up is $500. So "buy more credits" is not an affordance we can
 * offer a hobbyist — a user gets ten and then stops. The UI therefore has to
 * treat running out as an expected end state rather than an error, and the
 * clip must already be safely stored before a credit is ever spent.
 *
 * No key is ever sent to the browser. See ./keys.ts.
 */

const BASE = "https://api.kiriengine.app/api/v1/open";

/** Codes where a different account would fail identically. Do not fail over. */
const TERMINAL_CODES = new Set([2004, 2005, 2007, 2009, 2010]);

export interface KiriResult<T> {
  ok: boolean;
  /** KIRI's own code. 0 is success; everything else is a business error. */
  code: number | null;
  data: T | null;
  /** Human-readable, already phrased for a person. */
  message: string;
  /** True when no other key would do better — do not retry, do not fail over. */
  terminal: boolean;
  /** The raw body, kept when parsing failed so a bug report has something. */
  raw?: string;
}

interface KiriEnvelope<T> {
  ok?: boolean;
  code?: number;
  msg?: string;
  message?: string;
  data?: T;
}

/**
 * One request, with every rule above applied.
 *
 * Deliberately does not throw for business errors: a rejected video is a normal
 * outcome that the UI has to render, not an exception. It throws only when the
 * network itself failed, which is the one case a caller can retry unchanged.
 */
async function call<T>(
  path: string,
  key: string,
  init: RequestInit = {},
): Promise<KiriResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, ...(init.headers ?? {}) },
      cache: "no-store",
      // Generous: a 300 MB upload over a domestic connection is not quick.
      signal: init.signal ?? AbortSignal.timeout(10 * 60_000),
    });
  } catch (err) {
    return {
      ok: false,
      code: null,
      data: null,
      terminal: false,
      message:
        err instanceof DOMException && err.name === "TimeoutError"
          ? "KIRI did not respond in time."
          : "Could not reach KIRI. Check the connection and try again.",
    };
  }

  // Rule 1. Not res.json() — see the header.
  const raw = await res.text().catch(() => "");
  let body: KiriEnvelope<T> | null = null;
  try {
    body = JSON.parse(raw) as KiriEnvelope<T>;
  } catch {
    body = null;
  }

  if (!body) {
    return {
      ok: false,
      code: null,
      data: null,
      terminal: false,
      raw,
      // An unparseable body is not automatically a mystery. The two cases that
      // actually happen are a rejected key — whose 401 body is not JSON at all —
      // and the out-of-credit response, whose body is JSON with a raw newline in
      // it. Both are things a person can act on, and reporting either as "we
      // could not read the response" would send them looking in the wrong place.
      message:
        res.status === 401 || res.status === 403
          ? "KIRI did not accept that key."
          : /credit/i.test(raw)
            ? "KIRI says this key is out of credits."
            : `KIRI returned something unreadable (HTTP ${res.status}).`,
    };
  }

  // Rule 2. The status line is not the answer; the code is.
  const code = typeof body.code === "number" ? body.code : null;
  const message = body.msg ?? body.message ?? "";

  if (code !== null && code !== 0) {
    return {
      ok: false,
      code,
      data: null,
      raw,
      terminal: TERMINAL_CODES.has(code),
      message: message || `KIRI rejected this (code ${code}).`,
    };
  }

  // A 4xx with no code at all is still a failure — usually a bad key.
  if (code === null && !res.ok) {
    return {
      ok: false,
      code: null,
      data: null,
      raw,
      terminal: false,
      message:
        res.status === 401 || res.status === 403
          ? "KIRI did not accept that key."
          : message || `KIRI returned HTTP ${res.status}.`,
    };
  }

  return { ok: true, code: code ?? 0, data: body.data ?? null, message, terminal: false };
}

export interface KiriBalance {
  balance?: number;
  credit?: number;
}

/** Validate a key on entry, and find out how many reconstructions are left. */
export async function checkBalance(key: string): Promise<KiriResult<KiriBalance>> {
  return call<KiriBalance>("/balance", key, { method: "GET", signal: AbortSignal.timeout(15_000) });
}

/** `balance` or `credit`, whichever this account's response uses. */
export function creditsOf(b: KiriBalance | null): number | null {
  if (!b) return null;
  if (typeof b.balance === "number") return b.balance;
  if (typeof b.credit === "number") return b.credit;
  return null;
}

export interface KiriSubmission {
  serialize?: string;
  serializeId?: string;
}

/**
 * Hand a clip to KIRI. Returns the job handle it will be known by.
 *
 * The caller must have stored the video FIRST. This spends a credit, KIRI's
 * download links expire, and there is no way to ask for the source back — so a
 * clip that exists only inside this request is a clip that can be lost to a
 * timeout.
 */
export async function submitVideo(
  key: string,
  video: Blob,
  filename: string,
): Promise<KiriResult<KiriSubmission>> {
  const form = new FormData();
  form.append("videoFile", video, filename);
  // 3DGS rather than photogrammetry — this app wants splats, not meshes.
  form.append("modelQuality", "0");
  form.append("textureQuality", "0");

  return call<KiriSubmission>("/3dgs/video", key, { method: "POST", body: form });
}

/** The handle KIRI returns is not consistently named across its endpoints. */
export function serializeOf(s: KiriSubmission | null): string | null {
  return s?.serialize ?? s?.serializeId ?? null;
}

export interface KiriStatus {
  status?: number;
  serialize?: string;
}

/**
 * Poll a submission.
 *
 * Must be called with the SAME key that created it — KIRI scopes a job to the
 * account that submitted it, so asking with a different key of the same user
 * returns "not found" rather than a status.
 */
export async function getStatus(key: string, serialize: string): Promise<KiriResult<KiriStatus>> {
  return call<KiriStatus>(`/model/getStatus?serialize=${encodeURIComponent(serialize)}`, key, {
    method: "GET",
    signal: AbortSignal.timeout(30_000),
  });
}

/** KIRI's numeric status, as words. 0 uploading · 1 processing · 2 failed · 3 done. */
export function describeStatus(n: number | undefined): {
  stage: "queued" | "running" | "failed" | "ready" | "unknown";
  label: string;
} {
  switch (n) {
    case 0:
      return { stage: "queued", label: "Uploaded — waiting for a slot" };
    case 1:
      return { stage: "running", label: "Reconstructing" };
    case 2:
      return { stage: "failed", label: "KIRI could not reconstruct this clip" };
    case 3:
      return { stage: "ready", label: "Ready" };
    default:
      return { stage: "unknown", label: "Waiting for KIRI" };
  }
}
