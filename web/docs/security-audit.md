# Security audit — 2026-08-28

A full pass over the web app's attack surface: every route under `/api`, every
place a request-controlled string reaches the filesystem, a process or an
outbound URL, and the boundary between this app and the Python studio.

Everything below was read out of the code or measured against a running server.
Where something was measured, the command is given so you can repeat it rather
than trust it.

---

## Fixed in this pass

### 1. Any website could write to this API — CSRF on every mutating route

**Severity: high. This was the real finding.**

Thirty handlers across 27 routes under `/api` accept `POST` or `DELETE`. None of
them checked where the request came from, and the app has no accounts, no session
cookie and no CSRF token — so the only guard on any of them was "can you reach
the port".

Reaching the port is not restricted to the person at the laptop. Any page open
in the same browser could POST to `http://localhost:3000`, because a
cross-origin `fetch` with a CORS-simple content type is sent **without a
preflight**. The attacker cannot read the response — no route sends
`Access-Control-Allow-Origin` — but every side effect still happens.

`Request.json()` does not check the content type, which is what makes it
reachable. Measured:

```js
new Request(url, { method: "POST",
                   headers: { "content-type": "text/plain;charset=UTF-8" },
                   body: JSON.stringify({ session: "pwned" }) }).json()
// → { session: "pwned" }
```

So `fetch("http://localhost:3000/api/capture/delete", { method: "POST",
mode: "no-cors", body: '{"session":"…"}' })` from any tab reached the handler
with a parsed body. What that got you:

| Route | Effect |
|---|---|
| `/api/capture/delete` | delete a live splat run |
| `/api/capture/full-run` | start a reconstruction on the user's GPU |
| `/api/splat/jobs/<id>/dispatch` | **spend a KIRI credit** |
| `/api/reconstruction/key` (POST/DELETE) | replace or clear the stored KIRI key |
| `/api/album/{rename,place,thumb}` | rewrite album metadata |
| `/api/journey/probe` | spawn ffmpeg processes |

**It also defeated the fix in ff5ebe4.** That commit gave the studio an origin
allowlist, precisely so a random site could not enumerate or delete somebody's
captures. But the studio allows requests with *no* `Origin` — it has to, because
that is what a server-side proxy call looks like, and its own comment says so.
This app **is** that proxy: `/api/capture/delete`, `/api/capture/full-run` and
the three `/api/album/*` writers forward a caller-supplied body to the studio
server-side. A confused deputy with no check of its own, calling a careful
service in the one way that careful service is obliged to trust. It could not be
fixed on the studio side — from there, those calls are indistinguishable from
legitimate ones.

**Fix:** `web/lib/http/sameOrigin.ts` — `crossOriginRefusal(request)`, called as
the first statement of all 30 mutating handlers. Refuses a request whose `Origin`
is not this deployment's, or whose `Sec-Fetch-Site` is `cross-site`/`same-site`.
The two are checked independently, so neither header can be used to talk past the
other.

**Why not `proxy.ts`, which is where it belongs.** It was written there first —
one place a new route cannot forget to opt into — and it is wrong there for a
reason `proxy.ts`'s own matcher comment already gave: `/api/*` is excluded
deliberately, because Next buffers a matched request's body so it can be read
twice. Past the 10 MB default, per Next's own docs, "only the partial body will
be available" and "the request will **not** fail". This app POSTs video, so
matching `/api` would have silently truncated every real capture to 10 MB and
written the fragment to disk while reporting success — a worse bug than the one
being fixed, and one no unit test would have caught. Raising
`proxyClientMaxBodySize` only moves it: a 500 MB clip would then sit in proxy
memory on top of the stream.

So the enforcement moved rather than disappearing: `scripts/verify-origin.ts`
walks `app/api/**/route.ts` and fails if any exported `POST`/`DELETE`/`PUT`/
`PATCH` does not **open** with the check. Not merely call it — open with it,
because on the upload routes a check that runs after the body has been streamed
to disk has already done the thing it was meant to prevent.

Deliberately still allowed, and asserted as such:

- **Non-browser clients** — `spark-studio.exe` pushing a `.ply` over urllib, the
  rover posting detections, curl. They send neither header, and none of them can
  be a CSRF vector: CSRF needs a browser holding somebody's ambient authority.
- **The phone**, including behind a `*.trycloudflare.com` tunnel. Every request
  it makes is to a relative path from the page it is already on, so it is
  same-origin — which is why `x-forwarded-host` is read *before* `host`.
  Reversing those two lines refuses the phone handoff.
- **All reads.** A cross-origin `GET` cannot be read back without
  `Access-Control-Allow-Origin`, so refusing them would break every poll in the
  app to prevent nothing.

`SPARK_ALLOWED_ORIGINS` (comma-separated) names extra origins explicitly — the
equivalent of the studio's `--allow-origin`.

Verified against a running server:

```
POST /api/capture/delete  Origin: https://evil.example  → 403
POST /api/capture/delete  Origin: http://localhost:3210 → 502 (reached the handler)
POST /api/reconstruction/key  no Origin at all          → 400 (reached the handler)
```

and by `npm run verify:origin` — 27 checks, mostly refusals on purpose. A suite
that only proved the legitimate paths still work would pass just as green
against no check at all.

### 2. Ids used as capabilities were guessable

**Severity: medium.**

`app/api/splat/jobs/[jobId]/video/route.ts` states the posture plainly: "Knowing
the job id is the whole authorisation, and job ids are minted from a timestamp
… so they are guessable by anyone who can guess a millisecond." That was written
as a caveat and was really a hole.

A job id was `splat_<Date.now() in base36>` and nothing else — about 86 million
values for a whole day, and far fewer tries than that if you know roughly when a
walk was recorded. `journey_` and `album_` added four characters of
`Math.random()`, which is not a CSPRNG and whose base-36 rendering is not even
fixed length (`0.5` renders as `"0.i"`, so `.slice(2, 6)` can return one
character — the same trap already documented for `tempUploadPath`).

The cross-site half of this is closed by fix #1. This is the other half,
which the proxy deliberately cannot close: **reads**. `GET /api/splat/jobs/<id>/
video` has to stay open to a browser, and the dev server binds the LAN on
purpose — that is how the phone reaches it after scanning the QR. Anybody else
on that Wi-Fi could walk the timestamps and pull down somebody's recordings.

**Fix:** `web/lib/ids.ts` — `<prefix><base36 ms>_<64 CSPRNG bits>`, used by
`splat_`, `journey_`, `album_` and the WebXR session id. The timestamp stays
because it makes a directory listing sort chronologically; it is not doing
security work and never was.

Old ids keep working — nothing parses the format, ids are read back from
sidecars and filenames, and every guard on the path is a `startsWith(…)` or the
`[A-Za-z0-9_-]` fence, both of which the new format still satisfies. Confirmed
against the two real captures on this machine.

**This is a capability, not an identity.** It stops enumeration. It does not stop
a link from being forwarded, and it will not survive being the only answer once
more than one person uses an instance. The real fix is still owners on rows and
a session to check them against — see `production-readiness.md`.

### 3. No clickjacking defence

**Severity: medium**, and it is the route *around* fix #1. The origin check refuses a
cross-origin fetch but cannot refuse a real click: a page that iframes this app,
makes the frame transparent and floats it under its own button gets a genuine
same-origin request with every header a legitimate one would have. Every
destructive control here is one unconfirmed click.

**Fix:** `next.config.ts` now sends `Content-Security-Policy: frame-ancestors
'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and
`Referrer-Policy: strict-origin-when-cross-origin`. Nothing embeds this app —
bigview and the live viewer are opened with `window.open` into their own tabs,
which they must be, since bigview needs its own COOP/COEP for SharedArrayBuffer.

### 4. A comment that had become false

`app/api/album/frames/route.ts` said a plain GET could hit the studio directly
because "it sends ACAO:\*". ff5ebe4 replaced that wildcard with an allowlist for
exactly the reason the wildcard was dangerous. Corrected rather than deleted: a
comment claiming a wildcard is still there is how somebody talks themselves into
putting one back.

---

## Checked and found sound

Recorded so the next audit does not re-derive them.

- **Path traversal.** Every request-controlled string that reaches the
  filesystem is fenced or never used as a path. `lib/persist.ts` fences ids
  against `[A-Za-z0-9_-]{1,128}` once, at the store, rather than at each caller.
  The posed-capture route mints its own session id and re-checks it against
  `SAFE_SESSION` before `path.join`. `/api/splat/jobs/[jobId]/video` and
  `/dispatch` both go through `getSplatJob()` first, so a traversal attempt
  never reaches `readdir`. The handoff upload builds its path from a
  server-minted id and a whitelisted extension; the phone's filename is used
  only as a display string.
- **SSRF.** Every outbound `fetch` targets either a compile-time constant
  (`STUDIO_URL`, KIRI's base) or Nominatim with the query in an encoded
  parameter. No route takes a URL from a request.
- **Command injection.** The only `spawn` calls are ffmpeg in
  `lib/video/{probeMetadata,remux}.ts`, with an argv array (never a shell) and a
  server-controlled path. `/api/journey/probe` caps the number of ids and the
  concurrency, so it cannot be turned into a fork bomb.
- **XSS.** One `dangerouslySetInnerHTML` in the app,
  `components/live/PhoneHandoffPanel.tsx`, and it renders the `qrcode` library's
  own SVG output — geometry generated from encoded data, with no user string
  placed in the markup.
- **Open redirect.** `safeNext` in `lib/auth/http.ts` accepts only a path and
  rejects `//`, `/\` and control characters, with the reasoning written down.
  `/auth/callback` always ends in a 303 so the single-use credential leaves the
  address bar and the history entry.
- **Secrets.** `SUPABASE_SERVICE_ROLE_KEY`, `KIRI_API_KEY`, `R2_*` and `B2_*`
  are all un-prefixed and only read in server modules; the ones that reach
  Postgres are behind `server-only`. `/api/reconstruction/key` never returns the
  key by any method, including the POST that just received it.
  `/api/deployment` reports `database.configured` as a boolean and never says
  which provider or at what URL.
- **Timing.** `verifyClaim` compares SHA-256 hashes of a 32-byte
  `randomBytes` token with `===`. Not constant-time, and correctly so — the file
  says why, and a timing oracle on a hash prefix gives no path to the preimage.
  Left alone.
- **Upload validation.** `/api/splat/upload` streams to a temp file, tees the
  first 64 KB, validates the header against five format detectors, and only then
  renames into place. Byte budget, rate limit and concurrency cap are all
  enforced before the body is read. Covered by 191 checks in `verify:upload`.

---

## Open, with reasons

- **There is still no authentication.** Every fix above is a fence around a
  system with no notion of who is asking. The origin check stops another *origin*;
  it does not stop another *person* who can reach the port, and the LAN is
  reachable by design. On a shared network this app should be treated as
  readable by everyone on it. The fix is Phase 1.3/1.4 in
  `production-readiness.md`, and it is blocked on a Supabase project.
- **No `script-src` CSP.** Only `frame-ancestors` is set. This app runs WebGPU,
  Transformers.js and a wasm splat renderer; several need `wasm-unsafe-eval` and
  some build workers from blobs. A policy written without measuring which
  directives they actually need would either be so loose it means nothing or
  would break the detector silently, in the browser, where `npm run build`
  catches nothing. Worth doing with a real browser to test against; not worth
  guessing at.
- **`originOf` trusts `Host`/`x-forwarded-host`.** It has to — that is the
  tunnel case, and the origin check reads the same headers for the same reason. A
  poisoned `Host` could aim an auth redirect elsewhere, but a browser sets `Host`
  from the URL it is visiting, so this is a cache-poisoning shape rather than a
  cross-site one. Named here so it is a known trade rather than an oversight.

---

## Not a security finding, but found on the way

**Five endpoints the web app calls do not exist in the studio that ships in this
repo.** `tools/spark_studio/server.py` serves `/health`,
`/api/{runs,queue,capture/status,live/list,live/delete,live_splat}`,
`/api/studio/*` and `/file`. The app also calls:

| Called by | Endpoint |
|---|---|
| `/api/album/frames` | `/api/frames` |
| `/api/album/thumb` | `/api/run/thumb` |
| `/api/album/rename` | `/api/run/rename` |
| `/api/album/place` | `/api/run/place` |
| `/api/capture/full-run` | `/api/live/full-run` |

Nothing in the repo implements any of them, so the album's cover picker, rename,
location editor and the capture page's full-run button cannot work against the
bundled studio. The UI does *surface* the failure rather than hiding it —
`AlbumClient.tsx` shows "Couldn't load frames." and renders the error text from a
failed write — so this is a missing feature, not a silent one. It looks like the
album UI was written against a different studio build. Worth deciding
deliberately: implement them in `spark_studio`, or drop the controls.
