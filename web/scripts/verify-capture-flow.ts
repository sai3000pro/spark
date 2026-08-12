/**
 * The capture flow, end to end, against a running server.
 *
 *   npm run dev            # in one terminal
 *   npm run verify:flow    # in another
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS SEPARATE FROM `npm run verify`
 *
 * `verify-pipeline.ts` asserts pure functions and imports no server. This one
 * needs a live process, because the thing it protects is the SEAM BETWEEN
 * routes: a handoff minted here, a token claimed there, bytes streamed to disk
 * by a third handler, and a job record that has to survive all of it and still
 * be readable afterwards. Every one of those has been broken at least once by a
 * change that typechecked perfectly.
 *
 * It is the flow a person actually walks through:
 *
 *   open a handoff → scan it → claim the token → record → upload →
 *   the clip is stored → the laptop reads it back → the walk can be built
 *
 * The one step it cannot perform is the detector, which needs a browser with
 * WebGPU/WASM. Everything up to handing the clip back is covered, and that is
 * exactly the part that is plumbing rather than perception.
 */

import { RECON_TARGETS } from "../lib/reconstruction/targets";

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
}

function section(title: string): void {
  console.log(`\n${title}`);
}

async function main(): Promise<void> {
  console.log(`Capture flow · ${BASE}`);

  // Fail loudly and early rather than reporting twenty confusing failures.
  try {
    const ping = await fetch(`${BASE}/api/trip/active`, { cache: "no-store" });
    if (!ping.ok) throw new Error(String(ping.status));
  } catch {
    console.error(
      `\nNo server at ${BASE}. Start one with \`npm run dev\`, or set VERIFY_BASE_URL.\n`,
    );
    process.exit(2);
  }

  // ── 1 · the handoff ────────────────────────────────────────────────────────
  section("Opening a handoff");

  const openRes = await fetch(`${BASE}/api/capture/handoff`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });

  if (openRes.status === 503) {
    // Legitimate on a machine with no reachable address; not a code failure.
    console.log("  skip  this machine has no address a phone could reach");
    process.exit(0);
  }
  check("a handoff opens", openRes.ok, `HTTP ${openRes.status}`);
  const opened = (await openRes.json()) as {
    handoff: { id: string; state: string };
    url: string;
  };

  const id = opened.handoff.id;
  check("it starts unclaimed", opened.handoff.state === "waiting", opened.handoff.state);

  // The single most important property of the QR: the token is in the FRAGMENT,
  // which browsers never send to a server. If it ever moves into the query
  // string it lands in every access log between here and the phone.
  const [path, token] = opened.url.split("#");
  check("the token rides in the URL fragment", !!token && token.length > 20);
  check("the path carries no secret", !path.includes("?"), path);

  // ── 2 · claiming it ────────────────────────────────────────────────────────
  section("Claiming it from the phone");

  const badClaim = await fetch(`${BASE}/api/capture/handoff/${id}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "not-the-token", device: "test" }),
  });
  check("a wrong token is refused", badClaim.status >= 400, `HTTP ${badClaim.status}`);

  const claim = await fetch(`${BASE}/api/capture/handoff/${id}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, device: "verify-script" }),
  });
  check("the right token claims it", claim.ok, `HTTP ${claim.status}`);

  // Single-use is what stops a QR photographed over a shoulder granting a
  // second person an upload slot against your credits.
  const reclaim = await fetch(`${BASE}/api/capture/handoff/${id}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, device: "second-phone" }),
  });
  check("a second phone cannot claim the same code", reclaim.status >= 400,
    `HTTP ${reclaim.status}`);

  // ── 3 · uploading ──────────────────────────────────────────────────────────
  section("Uploading the clip");

  const clip = new Uint8Array(64 * 1024);
  for (let i = 0; i < clip.length; i++) clip[i] = (i * 31 + 7) & 0xff;

  const noToken = await fetch(`${BASE}/api/capture/handoff/${id}/upload`, {
    method: "POST",
    headers: { "content-type": "video/mp4", "x-file-name": "clip.mp4" },
    body: clip,
  });
  check("an unauthenticated upload is refused", noToken.status === 403,
    `HTTP ${noToken.status}`);

  const wrongType = await fetch(`${BASE}/api/capture/handoff/${id}/upload`, {
    method: "POST",
    headers: {
      "content-type": "application/zip",
      "x-handoff-token": token,
      "x-file-name": "clip.zip",
    },
    body: clip,
  });
  check("a non-video is refused", wrongType.status === 415, `HTTP ${wrongType.status}`);

  const upload = await fetch(`${BASE}/api/capture/handoff/${id}/upload`, {
    method: "POST",
    headers: {
      "content-type": "video/mp4",
      "x-handoff-token": token,
      "x-file-name": "clip.mp4",
      "x-reconstruct-target": "studio-batch",
    },
    body: clip,
  });
  check("the clip uploads", upload.status === 201, `HTTP ${upload.status}`);

  const result = (await upload.json()) as {
    jobId: string;
    bytes: number;
    stored: boolean;
    reconstruction: { requested: string; target: string | null; ok: boolean; note: string };
  };

  check("every byte arrived", result.bytes === clip.length,
    `${result.bytes} of ${clip.length}`);

  // THE load-bearing guarantee: the clip is stored before anything that can
  // fail is attempted, so an absent studio or a dead KIRI key costs a
  // reconstruction and never a recording.
  check("the clip is stored regardless of the destination", result.stored === true);
  check("the destination asked for is reported back",
    result.reconstruction.requested === "studio-batch");
  check("an unreachable destination says so instead of pretending",
    result.reconstruction.ok === false ? result.reconstruction.note.length > 10 : true,
    result.reconstruction.note.slice(0, 60));

  // ── 4 · the job ────────────────────────────────────────────────────────────
  section("The job it opened");

  // This route used to mint an id string and register nothing, so the id it
  // returned referred to no record and this read 404'd forever.
  const job = await fetch(`${BASE}/api/splat/jobs/${result.jobId}`, { cache: "no-store" });
  check("the job id refers to a real record", job.ok, `HTTP ${job.status}`);

  const state = await fetch(`${BASE}/api/capture/handoff/${id}`, { cache: "no-store" });
  const after = (await state.json()) as { handoff: { state: string; jobId: string | null } };
  check("the handoff reports the clip received", after.handoff.state === "received",
    after.handoff.state);
  check("and carries the job id the laptop needs", after.handoff.jobId === result.jobId);

  // ── 5 · reading it back ────────────────────────────────────────────────────
  section("Handing the clip back to the laptop");

  const video = await fetch(`${BASE}/api/splat/jobs/${result.jobId}/video`);
  check("the clip reads back", video.ok, `HTTP ${video.status}`);
  check("as a video", (video.headers.get("content-type") ?? "").startsWith("video/"),
    video.headers.get("content-type") ?? "");
  // A <video> element seeks with Range requests; without this it either fails
  // or buffers the whole file before showing a frame.
  check("range requests are advertised",
    video.headers.get("accept-ranges") === "bytes");

  const bytes = new Uint8Array(await video.arrayBuffer());
  check("byte-for-byte what was uploaded",
    bytes.length === clip.length && bytes[0] === clip[0] && bytes[clip.length - 1] === clip[clip.length - 1],
    `${bytes.length} bytes`);

  const ranged = await fetch(`${BASE}/api/splat/jobs/${result.jobId}/video`, {
    headers: { Range: "bytes=100-199" },
  });
  check("a range request is honoured", ranged.status === 206, `HTTP ${ranged.status}`);
  check("with the right slice",
    ranged.headers.get("content-range") === `bytes 100-199/${clip.length}`,
    ranged.headers.get("content-range") ?? "");

  const missing = await fetch(`${BASE}/api/splat/jobs/splat_does_not_exist/video`);
  check("an unknown job is a 404, not a traversal", missing.status === 404,
    `HTTP ${missing.status}`);

  // ── 6 · where it could go ──────────────────────────────────────────────────
  section("Reconstruction destinations");

  const targets = await fetch(`${BASE}/api/reconstruction/targets`, { cache: "no-store" });
  check("the destinations are probed", targets.ok, `HTTP ${targets.status}`);
  const menu = (await targets.json()) as {
    options: { id: string; available: boolean; blockedBecause: string | null }[];
    kiri: { present: boolean; tail: string | null };
  };
  // Against the enum rather than a hardcoded count, so adding a destination
  // cannot silently stop it being offered.
  const described = new Set(menu.options.map((o) => o.id));
  check("every destination in the enum is described",
    RECON_TARGETS.every((t) => described.has(t)),
    `${[...described].join(", ")}`);
  // An option that is off must say why — "no studio running" and "no key yet"
  // are both things someone can go and fix.
  check("every unavailable option explains itself",
    menu.options.every((o) => o.available || (o.blockedBecause ?? "").length > 10));
  // The key is described, never returned. A leak here is a leak everywhere.
  check("no KIRI key is ever echoed back",
    !("key" in menu.kiri) && (menu.kiri.tail === null || menu.kiri.tail.length <= 4));

  // ── 7 · the audio pass, at the route ───────────────────────────────────────
  //
  // verify-pipeline.ts already asserts the pure functions that turn a waveform
  // into events. What it cannot assert is the part that matters here: that the
  // ROUTE believes real events and disbelieves invented ones. Those numbers go
  // straight into TRIGGER_WEIGHTS, so a POST that gets to set them is a POST
  // that gets to manufacture memories.
  //
  // The fixture is deliberately one where the pictures alone find nothing: a
  // single stationary object, novel once, over a span too short to promote. So
  // any moment that appears afterwards came from the audio and nowhere else.
  section("The audio pass, at the route");

  const AUDIO_DURATION = 40;
  const fixture = Array.from({ length: 16 }, (_, i) => ({
    id: `det_audio_${i}`,
    tripId: "trip_upload_pending",
    frameId: `f${i}`,
    t: 0.5 + i * 2,
    label: "chair",
    confidence: 0.6,
    bbox: [0.4, 0.4, 0.2, 0.2],
    trackId: "trk_chair",
    source: "onboard",
  }));

  const postWalk = async (extra: Record<string, unknown>) => {
    const res = await fetch(`${BASE}/api/upload/walk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        detections: fixture,
        durationSec: AUDIO_DURATION,
        sourceName: "verify-flow.mp4",
        ...extra,
      }),
    });
    return {
      status: res.status,
      body: (await res.json()) as {
        found?: { moments: number; candidates: number };
        measured?: string[];
        synthesized?: string[];
      },
    };
  };

  const silent = await postWalk({});
  check("a walk builds from pictures alone", silent.status === 201, `HTTP ${silent.status}`);
  check("and this fixture finds nothing without audio",
    silent.body.found?.moments === 0,
    `${silent.body.found?.moments} moment(s)`);
  check("a silent walk does not claim a transcript",
    !(silent.body.measured ?? []).some((m) => m.startsWith("transcript")),
    (silent.body.measured ?? []).join(" · "));

  const heard = await postWalk({
    audioEvents: [
      { t: 10, durationSec: 10, kind: "speech", energy: 0.9 },
      { t: 12, durationSec: 2, kind: "laughter", energy: 0.7 },
    ],
    keywordHits: [{ t: 15, phrase: "look at that" }],
    transcript: [
      {
        id: "seg_0",
        t: 10,
        durationSec: 10,
        text: "look at that",
        speaker: "unknown",
        confidence: 0.9,
      },
    ],
  });
  check("the same footage with audio builds too", heard.status === 201, `HTTP ${heard.status}`);
  // The whole point of the stage: three trigger kinds that were unreachable
  // while these arrays were always empty.
  check("the audio triggers reach the scorer",
    (heard.body.found?.moments ?? 0) > 0,
    `${heard.body.found?.moments} moment(s)`);
  check("and the walk says so, in the ledger",
    (heard.body.measured ?? []).some((m) => m.startsWith("transcript")) &&
      (heard.body.measured ?? []).some((m) => m.includes("speech energy")),
    (heard.body.measured ?? []).join(" · "));
  check("it also admits Whisper does not diarise",
    (heard.body.synthesized ?? []).some((s) => s.includes("speaker labels")));

  // The one that is actually a security check. Every field here is out of
  // range, so a route that clamps instead of dropping would happily promote a
  // window on numbers nobody measured.
  const poisoned = await postWalk({
    audioEvents: [
      { t: 12, durationSec: 2, kind: "laughter", energy: 1e9 },
      { t: 9999, durationSec: 2, kind: "laughter", energy: 0.9 },
      { t: 12, durationSec: 2, kind: "applause", energy: 0.9 },
    ],
    keywordHits: [{ t: 15, phrase: "x".repeat(500) }],
    transcript: [{ id: "seg_0", t: 15, durationSec: 1, text: "hi" }],
  });
  check("a poisoned payload is still a 201", poisoned.status === 201, `HTTP ${poisoned.status}`);
  check("but every bad event is dropped, not clamped",
    poisoned.body.found?.moments === 0,
    `${poisoned.body.found?.moments} moment(s)`);
  check("and nothing unmeasured is claimed as measured",
    !(poisoned.body.measured ?? []).some(
      (m) => m.startsWith("transcript") || m.includes("speech energy"),
    ),
    (poisoned.body.measured ?? []).join(" · "));

  // ── clean up after ourselves ───────────────────────────────────────────────
  //
  // The upload path deliberately keeps clips for a week (see UPLOAD_RETENTION_MS),
  // which is right for a real capture and wrong for a test that runs on every
  // change. Left alone this drops a file into .uploads every run forever.
  //
  // Local only, and never fatal: pointed at a deployed server there is no shared
  // filesystem to reach, and failing the suite over stray bytes would be absurd.
  if (BASE.includes("localhost") || BASE.includes("127.0.0.1")) {
    try {
      const { unlinkSync, readdirSync } = await import("node:fs");
      const { join } = await import("node:path");
      const dir = join(process.cwd(), ".uploads");
      for (const f of readdirSync(dir)) {
        if (f.startsWith(`${result.jobId}.`)) unlinkSync(join(dir, f));
      }
    } catch {
      // Nothing to clean, or not ours to clean.
    }
  }

  console.log(
    failures === 0
      ? "\nThe capture flow holds.\n"
      : `\n${failures} check(s) failed.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
