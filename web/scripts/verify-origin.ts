/**
 * Can a website you happen to be visiting write to this API?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS AT ALL
 *
 * The bug lib/http/sameOrigin.ts fixes was invisible in every other suite, and
 * it would have stayed invisible: `npm run build` compiles a route with no
 * origin check exactly as happily as one with it, and `verify:upload` proves the
 * upload route accepts and stores a splat — which is the behaviour the attack
 * USES, not a behaviour that fails. Nothing in this repo asked "and who is
 * allowed to call this", so nothing noticed that the answer was "anyone".
 *
 * The checks below are therefore mostly REFUSALS. A suite that only proved the
 * legitimate paths still work would pass just as green against no check at all,
 * which is the failure mode worth designing against here.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SECOND HALF IS THE IMPORTANT HALF
 *
 * The check wants to live in proxy.ts, where a new route cannot forget to opt
 * into it. It cannot: proxy.ts excludes `/api/*` deliberately, because Next
 * buffers a matched request's body and silently truncates past 10 MB, which
 * would corrupt every video upload in the app. See the header of
 * lib/http/sameOrigin.ts.
 *
 * So it is a call at the top of each handler, and "somebody adds a route and
 * forgets" is a real way for this fix to rot. COVERAGE is therefore asserted
 * here, by reading every route file on disk: any exported POST/DELETE/PUT/PATCH
 * that does not call `crossOriginRefusal` first fails this suite. That is what
 * replaces the property proxy.ts would have given for free.
 *
 *     npx tsx scripts/verify-origin.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { crossOriginRefusal } from "../lib/http/sameOrigin";

let passed = 0;
const failures: string[] = [];

function ok(label: string, condition: boolean): void {
  if (condition) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

/**
 * One request, as a browser or a script would actually send it.
 *
 * `host` is set explicitly on every call rather than defaulted, because the
 * whole check is a comparison against it and a test that let it drift would be
 * asserting against itself.
 */
function req(opts: {
  method?: string;
  url?: string;
  host?: string;
  forwardedHost?: string;
  origin?: string;
  site?: string;
  contentType?: string;
}): Request {
  const url = opts.url ?? "http://localhost:3000/api/capture/delete";
  const headers = new Headers();
  headers.set("host", opts.host ?? new URL(url).host);
  if (opts.forwardedHost) headers.set("x-forwarded-host", opts.forwardedHost);
  if (opts.origin) headers.set("origin", opts.origin);
  if (opts.site) headers.set("sec-fetch-site", opts.site);
  if (opts.contentType) headers.set("content-type", opts.contentType);
  const method = opts.method ?? "POST";
  return new Request(url, {
    method,
    headers,
    ...(method === "GET" || method === "HEAD" ? {} : { body: JSON.stringify({ session: "s" }) }),
  });
}

/** Did the check let it through? `null` is the only "yes" it emits. */
function allowed(request: Request): boolean {
  return crossOriginRefusal(request) === null;
}

/**
 * Wrapped in a function only because two checks await a Response body, and tsx
 * compiles this file to CommonJS, where top-level await is not available.
 */
async function main(): Promise<void> {
  // ───────────────────────────────────────────────────────────────────────────
  section("The attack, in the exact shape a browser permits");

  /*
    This is the whole finding in one check. `text/plain` is a CORS-simple content
    type, so this POST is sent with NO preflight — the refusal has to happen at
    the request itself, because there is no earlier moment at which to say no.
  */
  ok(
    "a cross-site POST with a CORS-simple content type is refused",
    !allowed(req({ origin: "https://evil.example", site: "cross-site", contentType: "text/plain" })),
  );

  ok(
    "...and so is the same POST to the studio proxy that ff5ebe4 was protecting",
    !allowed(
      req({
        url: "http://localhost:3000/api/capture/full-run",
        origin: "https://evil.example",
        site: "cross-site",
        contentType: "text/plain",
      }),
    ),
  );

  ok(
    "...and the one that spends a KIRI credit",
    !allowed(
      req({
        url: "http://localhost:3000/api/splat/jobs/splat_123/dispatch",
        origin: "https://evil.example",
        site: "cross-site",
      }),
    ),
  );

  ok(
    "a DELETE from another origin is refused",
    !allowed(
      req({
        method: "DELETE",
        url: "http://localhost:3000/api/reconstruction/key",
        origin: "https://evil.example",
        site: "cross-site",
      }),
    ),
  );

  /*
    The premise the whole finding rests on, asserted rather than assumed: a body
    labelled text/plain still parses as JSON, so the content type is no defence
    and the routes reading `request.json()` really were reachable this way.
  */
  {
    const parsed = await new Request("http://x/y", {
      method: "POST",
      headers: { "content-type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ session: "pwned" }),
    })
      .json()
      .then((v: unknown) => (v as { session?: string }).session)
      .catch(() => null);
    ok(
      "a text/plain body still parses as JSON (so the content type guards nothing)",
      parsed === "pwned",
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("Neither header can be used to talk past the other");

  ok(
    "a foreign Origin is refused even when Sec-Fetch-Site claims same-origin",
    !allowed(req({ origin: "https://evil.example", site: "same-origin" })),
  );

  ok(
    "Sec-Fetch-Site cross-site is refused even with no Origin header",
    !allowed(req({ site: "cross-site" })),
  );

  ok(
    "same-site is refused — a sibling tunnel is somebody else's origin",
    !allowed(req({ origin: "https://other.trycloudflare.com", site: "same-site" })),
  );

  ok(
    'a literal "null" Origin (sandboxed iframe, file://) is refused',
    !allowed(req({ origin: "null", site: "cross-site" })),
  );

  // ───────────────────────────────────────────────────────────────────────────
  section("Everything that legitimately writes still writes");

  ok(
    "the app's own page, same-origin",
    allowed(req({ origin: "http://localhost:3000", site: "same-origin" })),
  );

  ok(
    "the phone on a LAN IP, posting to the page it was served from",
    allowed(
      req({
        url: "http://192.168.1.20:3000/api/capture/handoff/h1/upload",
        origin: "http://192.168.1.20:3000",
        site: "same-origin",
      }),
    ),
  );

  /*
    The tunnel case, and the reason `x-forwarded-host` is read before `host`.
    cloudflared terminates TLS at the public name and proxies to localhost:3000,
    so the raw Host is the WRONG thing to compare the phone's Origin against.
    Reversing those two lines refuses the phone handoff — the flow this app
    exists for — which is why it is asserted rather than trusted.
  */
  ok(
    "the phone behind a cloudflare tunnel, where Host and Origin disagree",
    allowed(
      req({
        url: "http://localhost:3000/api/capture/posed/h1",
        host: "localhost:3000",
        forwardedHost: "brave-cat-ply.trycloudflare.com",
        origin: "https://brave-cat-ply.trycloudflare.com",
        site: "same-origin",
      }),
    ),
  );

  ok(
    "spark-studio.exe pushing a .ply over urllib — no Origin, no Sec-Fetch-Site",
    allowed(req({ url: "http://localhost:3000/api/splat/upload" })),
  );

  ok(
    "the rover posting detections, same shape, no browser involved",
    allowed(req({ url: "http://localhost:3000/api/ingest/detections" })),
  );

  ok(
    'Sec-Fetch-Site "none" — a typed address or a bookmark, no initiating page',
    allowed(req({ site: "none" })),
  );

  // ───────────────────────────────────────────────────────────────────────────
  section("The explicit escape hatch");

  {
    const saved = process.env.SPARK_ALLOWED_ORIGINS;
    process.env.SPARK_ALLOWED_ORIGINS = "https://spark.example, https://staging.spark.example/";

    ok(
      "a named origin is allowed to write",
      allowed(req({ origin: "https://spark.example", site: "cross-site" })),
    );
    ok(
      "a trailing slash in the variable does not break the match",
      allowed(req({ origin: "https://staging.spark.example", site: "cross-site" })),
    );
    ok(
      "an origin NOT in the list is still refused",
      !allowed(req({ origin: "https://evil.example", site: "cross-site" })),
    );

    if (saved === undefined) delete process.env.SPARK_ALLOWED_ORIGINS;
    else process.env.SPARK_ALLOWED_ORIGINS = saved;

    ok(
      "and once the variable is gone, so is the permission",
      !allowed(req({ origin: "https://spark.example", site: "cross-site" })),
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("The refusal says something a person can act on");

  {
    const res = crossOriginRefusal(req({ origin: "https://evil.example", site: "cross-site" }));
    ok("it exists", res !== null);
    ok("it is a 403", res?.status === 403);
    ok("it is not cached", res?.headers.get("Cache-Control") === "no-store");
    const body = (await res!.json()) as { reason?: string; origin?: string };
    ok(
      "it names the environment variable that would allow this",
      typeof body.reason === "string" && body.reason.includes("SPARK_ALLOWED_ORIGINS"),
    );
    ok("it echoes the origin it refused, so a log says who", body.origin === "https://evil.example");
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("Coverage — every mutating route actually calls it");

  /*
    The part that replaces what proxy.ts would have enforced for free.

    Read off disk rather than from a hand-maintained list, because a list is the
    thing that goes stale in exactly the case this is meant to catch: somebody
    adds a route and does not think about origins. A new file is picked up by
    walking the tree; it cannot be picked up by a list nobody edited.
  */
  const ROUTES = path.join(process.cwd(), "app", "api");
  const HANDLER = /export\s+async\s+function\s+(POST|DELETE|PUT|PATCH)\s*\(/g;

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (name === "route.ts") out.push(full);
    }
    return out;
  }

  const files = walk(ROUTES);
  ok("the route tree was found and is not empty", files.length > 0);

  let handlers = 0;
  const uncovered: string[] = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const rel = path.relative(process.cwd(), file).replace(/\\/g, "/");
    for (const m of src.matchAll(HANDLER)) {
      handlers++;
      /*
        Called FIRST, not merely called. On the upload routes the body is
        hundreds of megabytes; a check that runs after it has been streamed to
        disk has already done the thing it was meant to prevent. So the call has
        to sit within the opening lines of the handler, not somewhere below.
      */
      const brace = src.indexOf("{", m.index);
      if (!src.slice(brace, brace + 140).includes("crossOriginRefusal(request)")) {
        uncovered.push(`${rel} — ${m[1]} does not open with the origin check`);
      }
    }
  }

  ok(`all ${handlers} mutating handlers open with the check`, uncovered.length === 0);
  for (const u of uncovered) console.log(`       ${u}`);

  /*
    A floor, not an exact count. Asserting the precise number would fail every
    time somebody legitimately adds a route, which trains people to edit the test
    rather than read it. A floor still catches the case that matters: the walk
    silently matching nothing and reporting success.
  */
  ok("and there are at least as many as when this was written (30)", handlers >= 30);

  // NOT COVERED HERE, and worth saying rather than leaving to be discovered:
  // this suite proves the DECISION and the CALL SITE. It does not prove the
  // wiring end to end — that a real cross-origin POST to a running server gets a
  // 403 — because that needs a listening port. That was verified by hand against
  // `next start` when this landed:
  //
  //   POST /api/capture/delete      Origin: https://evil.example  -> 403
  //   POST /api/capture/delete      Origin: http://localhost:3210 -> reached handler
  //   POST /api/reconstruction/key  no Origin at all              -> reached handler

  console.log(`\n${passed} ok, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("All invariants hold.");
}

void main();
