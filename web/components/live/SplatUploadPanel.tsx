"use client";

/**
 * Bring a splat that is already finished.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT REDUNDANT WITH THE PANEL ABOVE IT
 *
 * That one takes a video and owes you a reconstruction — minutes to an hour of
 * someone's GPU, and a destination that has to be reachable. This one takes the
 * result and owes you nothing but a URL. They look similar and they are the
 * opposite ends of the same pipe.
 *
 * It is what makes the local route usable by a person who is not sitting at a
 * checkout with a terminal open. The studio executable turns a clip into a
 * `.ply` on any laptop; without somewhere to put that file, the whole local
 * path dead-ends at a file manager. It also opens the app to every splat made
 * anywhere else — KIRI, Polycam, Luma, Postshot, a friend's export — because
 * nothing in a Gaussian splat records what produced it, and refusing files on a
 * guess about their origin would only mean refusing files that work.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * XHR, NOT FETCH, AND THAT IS THE WHOLE REASON
 *
 * `fetch` cannot report upload progress — there is no event for bytes sent, only
 * a promise that settles at the end. These files are 20 MB to 1 GB, and a
 * 143 MB upload over a slow link with a spinner and no number is indistinguishable
 * from a hang. People kill hung uploads. `XMLHttpRequest.upload.onprogress` is
 * the only thing in the platform that answers "how far in are we", so the older
 * API is the correct one here rather than the legacy one.
 *
 * The server refuses on the HEADER (see lib/splat/plyHeader.ts), so a mesh, an
 * ASCII export or a half-finished download is rejected with a sentence saying
 * which — and nothing lands in the served directory until it has passed.
 */
import { useCallback, useRef, useState } from "react";
import Link from "next/link";

import { formatBytes } from "@/lib/format";

interface Accepted {
  id: string;
  gaussians: number;
  bytes: number;
  warning: string | null;
  view: string;
}

type Phase =
  | { k: "idle" }
  | { k: "sending"; sent: number; total: number }
  | { k: "checking" }
  | { k: "done"; result: Accepted }
  | { k: "error"; message: string };

export function SplatUploadPanel() {
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const send = useCallback((file: File | undefined | null) => {
    if (!file) return;

    /*
      Checked here only to save a doomed 500 MB round trip.

      This is NOT the validation — the server re-derives everything from the
      bytes, because an extension is a claim by whoever named the file. A `.ply`
      that is really a mesh gets past this line and is refused there, which is
      the correct division: the client saves time, the server decides.
    */
    if (!/\.ply$/i.test(file.name)) {
      setPhase({
        k: "error",
        message: `That is ${file.name}. This takes a .ply — the file your reconstruction produced.`,
      });
      return;
    }

    const form = new FormData();
    form.append("ply", file);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("POST", "/api/splat/upload");

    xhr.upload.onprogress = (e) => {
      // `lengthComputable` is false on some proxies. Falling back to the file's
      // own size is right: it is the number we are sending.
      setPhase({ k: "sending", sent: e.loaded, total: e.lengthComputable ? e.total : file.size });
    };
    // Bytes are all gone but the response has not come back — the server is
    // reading the header. Named separately so the bar does not sit at 100%
    // looking stuck.
    xhr.upload.onload = () => setPhase({ k: "checking" });

    xhr.onload = () => {
      xhrRef.current = null;
      let body: { job?: { id?: string }; gaussians?: number; bytes?: number; warning?: string | null; view?: string; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        setPhase({ k: "error", message: "The server sent back something unreadable." });
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.job?.id) {
        setPhase({
          k: "done",
          result: {
            id: body.job.id,
            gaussians: body.gaussians ?? 0,
            bytes: body.bytes ?? file.size,
            warning: body.warning ?? null,
            view: body.view ?? `/splat/${body.job.id}`,
          },
        });
      } else {
        // The server's sentence, verbatim. It knows why; wrapping it in a
        // generic "upload failed" would throw away the only useful part.
        setPhase({ k: "error", message: body.error ?? `The upload failed (${xhr.status}).` });
      }
    };
    xhr.onerror = () => {
      xhrRef.current = null;
      setPhase({ k: "error", message: "The connection dropped. Nothing was saved — try again." });
    };
    xhr.onabort = () => {
      xhrRef.current = null;
      setPhase({ k: "idle" });
    };

    setPhase({ k: "sending", sent: 0, total: file.size });
    xhr.send(form);
  }, []);

  const busy = phase.k === "sending" || phase.k === "checking";

  return (
    <section
      className="plate-vellum rise-in relative p-5 sm:p-6"
      style={{ "--i": 5 } as React.CSSProperties}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="fnote text-[10px] text-ink-faint">[ 05 ]</span>
          <h2 className="mt-1 text-[20px] leading-tight text-ink">Or bring a finished splat</h2>
          <p className="mt-1.5 max-w-prose text-[13.5px] leading-relaxed text-ink-soft">
            Already have a <code className="text-[12.5px]">.ply</code>? Drop it here and it becomes
            a capture you can open, name and keep — no reconstruction, no waiting. Works with
            output from the studio, from KIRI, or from anything else that makes splats.
          </p>
        </div>
        <span className="fnote chip text-[10px]">[ no GPU needed ]</span>
      </header>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy) send(e.dataTransfer.files[0]);
        }}
        className="mt-4 rounded-[6px] p-6 text-center transition-shadow"
        style={{
          boxShadow: dragging
            ? "inset 0 0 0 1.5px rgb(176 141 87 / 0.85)"
            : "inset 0 0 0 1.5px rgb(120 120 108 / 0.35)",
        }}
      >
        {(phase.k === "idle" || phase.k === "error") && (
          <>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="pill-brass px-4 py-2 text-[13px]"
            >
              Choose a .ply
            </button>
            <p className="fnote mt-2.5 text-[9.5px] text-ink-faint">
              [ or drop it anywhere in this box · stays on this machine ]
            </p>
            {phase.k === "error" && (
              <p className="mx-auto mt-3 max-w-prose text-[12.5px] leading-relaxed text-clay">
                {phase.message}
              </p>
            )}
          </>
        )}

        {phase.k === "sending" && (
          <>
            <p className="text-[13.5px] text-ink">
              Sending — {formatBytes(phase.sent)} of {formatBytes(phase.total)}
            </p>
            <div
              className="mx-auto mt-3 h-[3px] w-full max-w-sm overflow-hidden rounded-full"
              style={{ background: "rgb(120 120 108 / 0.2)" }}
            >
              <div
                className="h-full bg-brass transition-[width] duration-150"
                style={{ width: `${phase.total ? (phase.sent / phase.total) * 100 : 0}%` }}
              />
            </div>
            <button
              type="button"
              onClick={() => xhrRef.current?.abort()}
              className="fnote mt-3 text-[10px] text-ink-faint underline underline-offset-2"
            >
              [ cancel ]
            </button>
          </>
        )}

        {phase.k === "checking" && (
          <p className="text-[13.5px] text-ink">Checking the file…</p>
        )}

        {phase.k === "done" && (
          <>
            <p className="text-[13.5px] text-ink">
              {phase.result.gaussians.toLocaleString()} gaussians · {formatBytes(phase.result.bytes)}
            </p>
            {phase.result.warning && (
              <p className="mx-auto mt-2 max-w-prose text-[12.5px] leading-relaxed text-clay">
                {phase.result.warning}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <Link href={phase.result.view} className="pill-brass px-4 py-2 text-[13px]">
                Open it
              </Link>
              <button
                type="button"
                onClick={() => setPhase({ k: "idle" })}
                className="pill-ghost px-3 py-1.5 text-[12.5px] text-ink-soft"
              >
                Add another
              </button>
            </div>
          </>
        )}

        <input
          ref={fileRef}
          type="file"
          accept=".ply"
          hidden
          onChange={(e) => {
            send(e.target.files?.[0]);
            // Cleared so choosing the SAME file twice fires a change event —
            // which is exactly what someone does after a failed upload.
            e.target.value = "";
          }}
        />
      </div>

      <p className="fnote mt-3 text-[10px] leading-relaxed text-ink-faint">
        [ no .ply yet? the studio makes one from a video on this machine — see{" "}
        <code>tools/spark_studio/README.md</code> ]
      </p>
    </section>
  );
}
