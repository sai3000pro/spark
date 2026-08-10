"use client";

/**
 * Claim the handoff, record, upload.
 *
 * THE TOKEN LIVES IN `location.hash` AND MUST LEAVE IT.
 * A fragment is never sent to a server, which is why the QR carries the token
 * there. This component reads it once, posts it deliberately in a body, and then
 * strips it from the address bar with replaceState — so a screenshot of the
 * phone, or someone scrolling back through history, does not carry a live
 * upload credential.
 *
 * Recording uses `<input type="file" accept="video/*" capture="environment">`,
 * which opens the phone's OWN camera app. That is better than an in-page
 * recorder for the thing that matters — stabilisation, exposure, and a correct
 * encoder — and it is the only option at all over plain LAN HTTP, since
 * getUserMedia requires a secure context. See lib/net.ts.
 *
 * Upload is XMLHttpRequest rather than fetch, purely because fetch still has no
 * upload progress event. On a 300 MB file over Wi-Fi, a progress bar is not a
 * nicety — without it people assume it has hung and background the tab, which
 * on a phone suspends the transfer.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  getCaptureSupport,
  subscribeCaptureSupport,
  SERVER_CAPTURE_SUPPORT,
  type CaptureMode,
} from "@/lib/captureSupport";

import { GuidedRecorder } from "./GuidedRecorder";

interface Props {
  handoffId: string;
}

type Phase =
  | { k: "claiming" }
  | { k: "ready" }
  | { k: "uploading"; pct: number; sentBytes: number; totalBytes: number }
  | { k: "done"; bytes: number }
  | { k: "error"; message: string; recoverable: boolean };

const MAX_BYTES = 512 * 1024 * 1024;

export function PhoneCapture({ handoffId }: Props) {
  // Detected on the client, after mount — `isSecureContext` and `MediaRecorder`
  // do not exist during SSR, and guessing server-side gets it wrong on exactly
  // the browsers that matter. Null until known, so nothing flashes the wrong
  // affordance first.
  const [phase, setPhase] = useState<Phase>({ k: "claiming" });
  const [file, setFile] = useState<File | null>(null);
  const tokenRef = useRef<string>("");
  // Also held as state: GuidedRecorder needs it as a prop, and reading a ref
  // during render is a React rule violation (the render would not re-run when
  // the ref changed). The ref stays for the upload path, which reads it from
  // inside a callback where a ref is correct.
  const [token, setToken] = useState("");
  const claimed = useRef(false);

  // ── Claim, once ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (claimed.current) return;
    claimed.current = true;

    // Every state transition below happens inside this async body rather than
    // in the effect itself. A synchronous setState here would cascade a second
    // render before the browser paints the first — and React lints for it.
    void (async () => {
      const token = window.location.hash.replace(/^#/, "");
      if (!token) {
        setPhase({
          k: "error",
          message:
            "This link is missing its key. Scan the code again from the laptop — the key is part of the code, so a copied or shortened link will not work.",
          recoverable: false,
        });
        return;
      }
      tokenRef.current = token;
      setToken(token);

      // Out of the address bar before anything else can observe it.
      window.history.replaceState(null, "", window.location.pathname);

      try {
        const res = await fetch(`/api/capture/handoff/${handoffId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            token,
            device: navigator.userAgent.includes("iPhone")
              ? "iPhone"
              : navigator.userAgent.includes("Android")
                ? "Android phone"
                : "a phone",
          }),
        });
        if (res.ok) {
          setPhase({ k: "ready" });
          return;
        }
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setPhase({ k: "error", message: explain(body.error, res.status), recoverable: false });
      } catch {
        setPhase({
          k: "error",
          message:
            "Could not reach the laptop. Check both devices are on the same Wi-Fi network.",
          recoverable: true,
        });
      }
    })();
  }, [handoffId]);

  // Browser capabilities are external state that React does not own, and
  // reading them in an effect would mean a render with the WRONG affordance
  // before the right one. `useSyncExternalStore` is the primitive built for
  // exactly this: a client snapshot, a server snapshot, and no cascading
  // setState. The server snapshot is the safe floor, so hydration agrees.
  const support = useSyncExternalStore(
    subscribeCaptureSupport,
    getCaptureSupport,
    () => SERVER_CAPTURE_SUPPORT,
  );

  // Null means "not chosen yet", so `support.best` wins until the user picks.
  // Derived at render rather than synced in an effect.
  const [chosenMode, setChosenMode] = useState<CaptureMode | null>(null);
  const mode: CaptureMode = chosenMode ?? support.best;

  // ── Upload ─────────────────────────────────────────────────────────────────
  const upload = useCallback(
    (f: File) => {
      if (f.size > MAX_BYTES) {
        setPhase({
          k: "error",
          message: `That clip is ${fmtMb(f.size)}, over the ${fmtMb(MAX_BYTES)} limit. Record a shorter one.`,
          recoverable: true,
        });
        return;
      }

      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/capture/handoff/${handoffId}/upload`);
      xhr.setRequestHeader("x-handoff-token", tokenRef.current);
      xhr.setRequestHeader("x-file-name", f.name);
      // The browser will not set content-type for a raw File body, and the
      // server needs it to pick a safe extension.
      xhr.setRequestHeader("content-type", f.type || "video/mp4");

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        setPhase({
          k: "uploading",
          pct: Math.round((e.loaded / e.total) * 100),
          sentBytes: e.loaded,
          totalBytes: e.total,
        });
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          setPhase({ k: "done", bytes: f.size });
        } else {
          const body = safeJson(xhr.responseText);
          setPhase({
            k: "error",
            message: explain(body?.error, xhr.status),
            recoverable: true,
          });
        }
      };
      xhr.onerror = () =>
        setPhase({
          k: "error",
          message: "The connection dropped mid-upload. Stay on Wi-Fi and try again.",
          recoverable: true,
        });

      setPhase({ k: "uploading", pct: 0, sentBytes: 0, totalBytes: f.size });
      xhr.send(f);
    },
    [handoffId],
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <header className="flex flex-col gap-1">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] opacity-55">
          Spark · capture
        </p>
        <h1 className="text-2xl font-semibold leading-tight">
          {phase.k === "done" ? "Sent to your laptop" : "Record this place"}
        </h1>
      </header>

      {phase.k === "claiming" && <Muted>Connecting to your laptop…</Muted>}

      {phase.k === "error" && (
        <div className="flex flex-col gap-3 rounded-xl border border-current/15 p-4">
          <p className="text-sm leading-relaxed">{phase.message}</p>
          {phase.recoverable && file && (
            <button
              type="button"
              onClick={() => upload(file)}
              className="rounded-lg border border-current/25 px-4 py-2.5 text-sm font-medium"
            >
              Try that upload again
            </button>
          )}
        </div>
      )}

      {phase.k === "ready" && (
        <div className="flex flex-col gap-5">
          {mode === "guided" ? (
            <GuidedRecorder
              handoffId={handoffId}
              token={token}
              onRecorded={(f) => { setFile(f); upload(f); }}
            />
          ) : (
            <>
              <ol className="flex flex-col gap-2.5 text-sm leading-relaxed opacity-75">
                <li>1 &middot; Walk the space slowly, keeping the subject in frame.</li>
                <li>2 &middot; Circle it &mdash; a splat needs to see more than one side.</li>
                <li>3 &middot; Keep it under 3 minutes.</li>
              </ol>

              <label className="flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border border-current/25 px-5 py-6 text-center">
                <span className="text-base font-medium">Open the camera</span>
                <span className="text-xs opacity-60">
                  Records with your phone&rsquo;s own camera app
                </span>
                <input
                  type="file"
                  accept="video/*"
                  capture="environment"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setFile(f);
                    upload(f);
                  }}
                />
              </label>
            </>
          )}

          {/* The other mode is always reachable. Guided recording is better for
              coverage; the camera app is better for image quality and never
              fails. Neither is strictly superior, so neither is hidden. */}
          {support.available.length > 1 && (
            <button
              type="button"
              onClick={() => setChosenMode(mode === "guided" ? "camera-app" : "guided")}
              className="text-center text-sm underline underline-offset-4 opacity-70"
            >
              {mode === "guided"
                ? "or use your camera app instead"
                : "or record here with coverage guidance"}
            </button>
          )}

          <label className="cursor-pointer text-center text-sm underline underline-offset-4 opacity-70">
            or choose a video you already have
            <input
              type="file"
              accept="video/*"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setFile(f);
                upload(f);
              }}
            />
          </label>

          {support.guidedBlockedBecause && (
            <p className="text-xs leading-relaxed opacity-50">
              {support.guidedBlockedBecause}
            </p>
          )}
        </div>
      )}

      {phase.k === "uploading" && (
        <div className="flex flex-col gap-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-current/10">
            <div
              className="h-full rounded-full bg-current transition-[width] duration-200"
              style={{ width: `${phase.pct}%` }}
            />
          </div>
          <p className="font-mono text-xs opacity-65">
            {phase.pct}% · {fmtMb(phase.sentBytes)} of {fmtMb(phase.totalBytes)}
          </p>
          <p className="text-xs leading-relaxed opacity-50">
            Keep this screen open. Switching apps can pause the upload.
          </p>
        </div>
      )}

      {phase.k === "done" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm leading-relaxed">
            {fmtMb(phase.bytes)} received. Your laptop has it — you can put the phone
            down.
          </p>
          <p className="text-xs opacity-50">
            Reconstruction takes a few minutes and happens on the laptop.
          </p>
        </div>
      )}
    </>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-sm opacity-60">{children}</p>;
}

function fmtMb(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function safeJson(s: string): { error?: string } | null {
  try {
    return JSON.parse(s) as { error?: string };
  } catch {
    return null;
  }
}

/** Server error codes are terse by design; this is where they become sentences. */
function explain(code: string | undefined, status: number): string {
  switch (code) {
    case "expired":
      return "That code expired. Generate a new one on the laptop — they last 10 minutes.";
    case "already-claimed":
      return "Another phone already used this code. Generate a fresh one on the laptop.";
    case "bad-token":
    case "not-claimed-or-bad-token":
      return "This link's key was not accepted. Scan the code again from the laptop.";
    case "not-found":
      return "The laptop is not expecting this capture any more. It may have restarted.";
    case "unsupported-type":
      return "That file is not a video format we can read. Try recording again.";
    case "too-large":
      return "That clip is too large. Record a shorter one — under 3 minutes.";
    default:
      return `Something went wrong on the laptop (${status}). Try again.`;
  }
}
