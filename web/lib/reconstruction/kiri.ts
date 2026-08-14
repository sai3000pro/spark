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

import { unzipSync } from "fflate";

const BASE = "https://api.kiriengine.app/api/v1/open";

/**
 * Parse an envelope, REPAIRING the malformed ones rather than giving up on them.
 *
 * Rule 1 in the header says never `res.json()`, because KIRI's error bodies put
 * raw control characters inside string literals — the 401 is
 * `{"code":401, "msg":"Authentication failed. Please check header apikey.<LF>"}`
 * and the out-of-credit reply does the same. Bailing out on those is safe but
 * lossy: the code and the message are right there, and discarding them left
 * this client guessing from the HTTP status alone.
 *
 * Escaping is only ever attempted on a body that already failed to parse as it
 * stands, because escaping first would corrupt the whitespace of a reply that
 * is merely pretty-printed. A body that is not JSON at all — an HTML error
 * page, or nothing — still comes back null.
 */
function parseEnvelope<T>(text: string): KiriEnvelope<T> | null {
  try {
    return JSON.parse(text) as KiriEnvelope<T>;
  } catch {
    // Not JSON as it stands. Worth one repair attempt, below.
  }
  try {
    return JSON.parse(escapeControlsInStrings(text)) as KiriEnvelope<T>;
  } catch {
    return null;
  }
}

/**
 * Escape control characters, but only INSIDE string literals.
 *
 * A newline between tokens is ordinary JSON whitespace; escaping those would
 * break a pretty-printed reply that was already valid.
 */
function escapeControlsInStrings(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (const character of text) {
    if (escaped) {
      out += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      out += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      out += character;
      continue;
    }
    const code = character.charCodeAt(0);
    out +=
      inString && code < 0x20 ? `\\u${code.toString(16).padStart(4, "0")}` : character;
  }

  return out;
}

/**
 * Codes that mean success. Both, because KIRI is not consistent across
 * endpoints: `/balance` answers 200 and the documented convention is 0.
 */
const SUCCESS_CODES = new Set([0, 200]);

/** Codes where a different account would fail identically. Do not fail over. */
const TERMINAL_CODES = new Set([
  2004, 2005, 2007, 2009, 2010,
  // Authentication failure, and the most terminal answer there is: no retry,
  // no backoff and no other clip will ever make a wrong key right.
  //
  // These live here because KIRI puts them in the BODY, not just the status
  // line — a bad key answers `{"code":401,"msg":"Authentication failed..."}`,
  // which is perfectly parseable and therefore takes the business-code branch
  // below rather than the unparseable-body branch that already knew about 401.
  // Without them a rejected key came back `terminal: false`, which reads as
  // "try again later" — so the menu kept offering KIRI, and the truth only
  // arrived after someone had uploaded a 100 MB clip to it.
  401, 403,
]);

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
  const body = parseEnvelope<T>(raw);

  if (!body) {
    return {
      ok: false,
      code: null,
      data: null,
      // Only reached now when the body is not JSON even after repair — an HTML
      // error page, or an empty response. KIRI's 401 and out-of-credit replies
      // both parse via `parseEnvelope`, so they take the business-code branch
      // below and arrive with KIRI's own wording intact.
      //
      // A 401/403 here is still a credential that will never work.
      terminal: res.status === 401 || res.status === 403,
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

  // Rule 2. The status line is not the answer; the ENVELOPE is.
  const code = typeof body.code === "number" ? body.code : null;
  const message = body.msg ?? body.message ?? "";

  /*
    ─────────────────────────────────────────────────────────────────────────
    KIRI SIGNALS SUCCESS AS `code: 200`, NOT `code: 0`.

    Measured against the live API with a real key:

        {"code":200,"msg":"success","data":{"balance":9},"ok":true}

    This client keyed on `code === 0` and therefore read EVERY successful
    response as a business error. The consequences were not cosmetic: a video
    KIRI had accepted came back as a failed dispatch, so `noteCreditSpent` and
    `noteKiriSubmission` never ran — the credit was gone, the reconstruction was
    running, and the handle needed to collect it was discarded. The user was
    then invited to "send it again", which would have spent a second credit for
    a second copy of the same job.

    Success is therefore `code` in {0, 200}. See the note below on why the
    `ok` flag is not trusted despite looking like the obvious answer.
    ─────────────────────────────────────────────────────────────────────────
  */
  /*
    `body.ok` is NOT consulted, and that is deliberate. It looks like the
    obvious signal and it lies:

        {"code":500,"msg":"No static resource ...","data":"ERR_500","ok":true}

    A hard server error carries `ok: true`. Rule 2 in this file's header says
    the status line is not the answer and the CODE is; that was right all along,
    and the only thing wrong with the original was its idea of which codes mean
    success. A response with no code at all falls back to the HTTP status,
    which is all there is left to go on.
  */
  const succeeded = code !== null ? SUCCESS_CODES.has(code) : res.ok;

  if (succeeded) {
    return { ok: true, code: code ?? 0, data: body.data ?? null, message, terminal: false };
  }

  if (code !== null && !SUCCESS_CODES.has(code)) {
    return {
      ok: false,
      code,
      data: null,
      raw,
      terminal: TERMINAL_CODES.has(code),
      // Trimmed: KIRI ends several messages with a raw newline, which is what
      // made the body unparseable in the first place and which shows up as a
      // stray blank line wherever this is rendered.
      message: message.trim() || `KIRI rejected this (code ${code}).`,
    };
  }

  // A 4xx with no code at all is still a failure — usually a bad key.
  if (code === null && !res.ok) {
    return {
      ok: false,
      code: null,
      data: null,
      raw,
      // Same reasoning as the auth codes above: a 401/403 status with no body
      // code is still a credential that will never work.
      terminal: res.status === 401 || res.status === 403,
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
 * What /3dgs/video will accept, in KIRI's own words.
 * https://docs.kiriengine.app/3dgs-scan/video-upload
 *
 *   "The duration should be no longer than 3 minutes."
 *   "The video resolution must not exceed 1920x1080."
 *
 * Lives here rather than beside the checker because this file is where the
 * endpoint and its documentation live, and two copies of a limit is how one of
 * them ends up wrong. app/m/[handoffId]/GuidedRecorder.tsx already stops
 * recording at 170s against the same cap — ten seconds of headroom, deliberate,
 * because container duration and frame duration are not the same number.
 *
 * The sides are named LONG and SHORT, not width and height. A phone held
 * upright produces 1080x1920 and it is exactly as legal as 1920x1080; see the
 * header of ../video/clipLimits.ts for what testing width does instead.
 *
 * No size limit is listed here because KIRI publishes none. An undocumented
 * limit is not a limit we get to enforce on someone's behalf.
 */
export const KIRI_VIDEO_LIMITS = {
  maxDurationSec: 180,
  maxLongSide: 1920,
  maxShortSide: 1080,
} as const;

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
  /*
    `isMesh` and `isMask`, both documented as REQUIRED by /3dgs/video.
    https://docs.kiriengine.app/3dgs-scan/video-upload

    This used to send `modelQuality` and `textureQuality`, which belong to the
    photogrammetry endpoints and mean nothing here — so the two fields this call
    actually requires were absent and the submission would have been rejected on
    arrival, after the whole video had been uploaded. Never exercised against a
    live key, so nothing said otherwise until it was compared with a working
    integration of the same API.

    Both zero: we want the splat, not a mesh, and masking would need per-frame
    subject selection this flow never collects.
  */
  form.append("isMesh", "0");
  form.append("isMask", "0");

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

/**
 * KIRI's own status numbers.
 * https://docs.kiriengine.app/model/retrieve-3d-model-status
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THESE WERE WRONG, AND WRONG IN THE WORST POSSIBLE WAY
 *
 * This file previously read `0 uploading · 1 processing · 2 failed · 3 done`,
 * which is off by one against the real table below in a way that INVERTS the
 * two answers that matter: 2 is **successful** and was being reported as "KIRI
 * could not reconstruct this clip", while 3 is **queuing** and was being
 * reported as "Ready". A finished reconstruction would have been thrown away
 * and a job that had not started would have been treated as a result.
 *
 * Caught by comparing against a second, working integration of the same API
 * (../../../atlas/src/lib/kiri.ts), which had the documented values. Nothing
 * here was ever exercised against a live key, so nothing contradicted it.
 *
 * The negative value is real: -1 means KIRI is still receiving the upload.
 */
export const KIRI_STATUS = {
  uploading: -1,
  processing: 0,
  failed: 1,
  successful: 2,
  queuing: 3,
  expired: 4,
} as const;

export function describeStatus(n: number | undefined): {
  stage: "queued" | "running" | "failed" | "ready" | "expired" | "unknown";
  label: string;
} {
  switch (n) {
    case KIRI_STATUS.uploading:
      return { stage: "queued", label: "KIRI is still receiving the video" };
    case KIRI_STATUS.processing:
      return { stage: "running", label: "Reconstructing" };
    case KIRI_STATUS.failed:
      return { stage: "failed", label: "KIRI could not reconstruct this clip" };
    case KIRI_STATUS.successful:
      return { stage: "ready", label: "Ready" };
    case KIRI_STATUS.queuing:
      return { stage: "queued", label: "Queued at KIRI" };
    case KIRI_STATUS.expired:
      // Distinct from failed: the reconstruction worked, and the download
      // window closed before anything collected it. That is our bug, not
      // KIRI's, and calling it "failed" would hide a fixable mistake.
      return { stage: "expired", label: "Expired before the result was downloaded" };
    default:
      return { stage: "unknown", label: "Waiting for KIRI" };
  }
}

/**
 * Collect the finished reconstruction: the PLY, out of KIRI's zip.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS HALF OF THE LOOP DID NOT EXIST
 *
 * The client could submit a clip and poll its status, and then stopped — the
 * only documented way to get a result into the app was to copy a file into
 * public/mock/splats by hand. So a KIRI reconstruction that succeeded produced
 * nothing a user could see, which makes spending the credit pointless.
 *
 * Two calls, because KIRI does not serve the model directly: `/model/getModelZip`
 * hands back a short-lived `modelUrl`, and the archive is fetched from there.
 * That URL EXPIRES — see KIRI_STATUS.expired, which is what a job looks like
 * once nothing collected it in time.
 *
 * The archive's manifest is undocumented, so the PLY is found by extension
 * rather than by a fixed name.
 */
export interface KiriModelZip {
  modelUrl?: string;
  serialize?: string;
}

export async function getModelZipUrl(
  key: string,
  serialize: string,
): Promise<KiriResult<KiriModelZip>> {
  return call<KiriModelZip>(
    `/model/getModelZip?serialize=${encodeURIComponent(serialize)}`,
    key,
    { method: "GET", signal: AbortSignal.timeout(60_000) },
  );
}

export type PlyFetch =
  | { ok: true; name: string; bytes: Uint8Array }
  | { ok: false; message: string; terminal: boolean };

/**
 * Status → zip url → archive → the .ply inside it.
 *
 * Never throws, for the same reason dispatch never throws: this runs after a
 * credit has already been spent, and an exception here would turn a finished
 * reconstruction into a stack trace instead of a sentence someone can act on.
 */
export async function fetchSplatPly(key: string, serialize: string): Promise<PlyFetch> {
  const zip = await getModelZipUrl(key, serialize);
  if (!zip.ok || !zip.data?.modelUrl) {
    return {
      ok: false,
      message: zip.message || "KIRI gave no download link for that reconstruction.",
      terminal: zip.terminal,
    };
  }

  let archive: Uint8Array;
  try {
    // Not a KIRI endpoint — this is their CDN, so no Authorization header and
    // no envelope. A plain fetch, and a plain failure if the link has expired.
    const res = await fetch(zip.data.modelUrl, { cache: "no-store" });
    if (!res.ok) {
      return {
        ok: false,
        message: `Could not download the model zip (HTTP ${res.status}). The link may have expired.`,
        terminal: false,
      };
    }
    archive = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    return {
      ok: false,
      message: `Could not reach KIRI's download host: ${err instanceof Error ? err.message : String(err)}`,
      terminal: false,
    };
  }

  try {
    const files = unzipSync(archive);
    const entry = Object.entries(files).find(([name]) => name.toLowerCase().endsWith(".ply"));
    if (!entry) {
      return {
        ok: false,
        // Naming what WAS in there, because "no ply" with no list is
        // unactionable and this archive's layout is undocumented.
        message: `No .ply in KIRI's archive (it held: ${Object.keys(files).join(", ") || "nothing"}).`,
        terminal: true,
      };
    }
    return { ok: true, name: entry[0], bytes: entry[1] };
  } catch (err) {
    return {
      ok: false,
      message: `KIRI's archive could not be read: ${err instanceof Error ? err.message : String(err)}`,
      terminal: true,
    };
  }
}
