"use client";

/**
 * The laptop half of the phone handoff: draw a code, then watch for the phone.
 *
 * The QR is rendered client-side from the URL the server minted. It has to be —
 * the URL carries the one-time token in its fragment, and round-tripping that
 * through an <img src> would put it in a request line and therefore in a log,
 * which is the exact thing the fragment was chosen to avoid.
 *
 * Polling rather than a socket, at a rate the SERVER chooses (`pollAfterMs`):
 * an unclaimed code is idle and a paired phone is about to do something, and the
 * server is the only side that knows which. Same pattern as /api/trip/active.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { LiveViewfinder } from "@/components/live/LiveViewfinder";

interface Handoff {
  id: string;
  state: "waiting" | "paired" | "streaming" | "uploading" | "received" | "expired";
  expiresAt: string;
  device: string | null;
  upload: { name: string; bytes: number; receivedBytes: number } | null;
  jobId: string | null;
  note: string;
}

interface Opened {
  handoff: Handoff;
  url: string;
  origin: string;
  insecure: boolean;
}

type State =
  | { k: "idle" }
  | { k: "opening" }
  | { k: "live"; opened: Opened; svg: string }
  | { k: "unavailable"; detail: string };

export function PhoneHandoffPanel({ tripId }: { tripId?: string | null }) {
  const [state, setState] = useState<State>({ k: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Declared before `open`, which calls it. A `const` arrow declared afterwards
  // is in its temporal dead zone at that point — the first scan would throw.
  const poll = useCallback(function tick(id: string, afterMs: number) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/capture/handoff/${id}`, { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { handoff: Handoff; pollAfterMs: number };

        setState((prev) =>
          prev.k === "live" && prev.opened.handoff.id === id
            ? { ...prev, opened: { ...prev.opened, handoff: body.handoff } }
            : prev,
        );

        // Stop once nothing further can happen. A received capture is the end of
        // this component's job; an expired code needs a new one, not more polls.
        if (body.handoff.state === "received" || body.handoff.state === "expired") return;
        tick(id, body.pollAfterMs);
      } catch {
        // A dropped poll is not an error worth showing — try again, slower.
        tick(id, 5000);
      }
    }, afterMs);
  }, []);

  const open = useCallback(async () => {
    setState({ k: "opening" });
    try {
      const res = await fetch("/api/capture/handoff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tripId: tripId ?? null }),
      });

      if (res.status === 503) {
        const body = (await res.json()) as { detail?: string };
        setState({
          k: "unavailable",
          detail:
            body.detail ??
            "This machine has no network address a phone could reach.",
        });
        return;
      }
      if (!res.ok) {
        setState({ k: "unavailable", detail: `The server returned ${res.status}.` });
        return;
      }

      const opened = (await res.json()) as Opened;

      // Imported lazily: the QR encoder is only needed the moment someone asks
      // for a code, and it has no business in the initial bundle of a page most
      // people will use to upload a file from the laptop instead.
      const QR = (await import("qrcode")).default;
      const svg = await QR.toString(opened.url, {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 1,
        width: 240,
      });

      setState({ k: "live", opened, svg });
      poll(opened.handoff.id, 1500);
    } catch (err) {
      setState({
        k: "unavailable",
        detail: err instanceof Error ? err.message : "Could not open a handoff.",
      });
    }
  }, [tripId, poll]);

  if (state.k === "idle") {
    return (
      <button
        type="button"
        onClick={() => void open()}
        className="rounded-lg border border-current/25 px-4 py-2.5 text-sm font-medium"
      >
        Use my phone to record
      </button>
    );
  }

  if (state.k === "opening") {
    return <p className="text-sm opacity-60">Opening a handoff…</p>;
  }

  if (state.k === "unavailable") {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-current/15 p-4">
        <p className="text-sm">Can&rsquo;t hand off to a phone right now.</p>
        <p className="text-xs leading-relaxed opacity-60">{state.detail}</p>
        <p className="text-xs leading-relaxed opacity-60">
          You can still upload a video from this machine.
        </p>
      </div>
    );
  }

  const { handoff, url, insecure } = state.opened;
  const done = handoff.state === "received";
  const dead = handoff.state === "expired";
  // Once a phone is on the other end the code has done its job, and the useful
  // thing to occupy that space is what the phone can see.
  const paired = handoff.state === "paired" || handoff.state === "streaming";

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-current/15 p-5">
      {!done && !dead && !paired && (
        <>
          <div
            className="mx-auto [&>svg]:h-[240px] [&>svg]:w-[240px]"
            // The encoder's own SVG output. Not user content — it is generated
            // in this component from a URL this app just minted.
            dangerouslySetInnerHTML={{ __html: state.svg }}
          />
          <p className="text-center text-sm">
            Point your phone&rsquo;s camera at this
          </p>
        </>
      )}

      {paired && <LiveViewfinder handoffId={handoff.id} />}

      <div className="flex items-center gap-2 text-sm">
        <span
          aria-hidden
          className={`h-2 w-2 shrink-0 rounded-full ${
            done
              ? "bg-current"
              : dead
                ? "bg-current/30"
                : handoff.state === "waiting"
                  ? "animate-pulse bg-current/40"
                  : "animate-pulse bg-current"
          }`}
        />
        <span>{handoff.note}</span>
      </div>

      {handoff.device && !done && (
        <p className="text-xs opacity-60">{handoff.device} connected</p>
      )}

      {handoff.upload && handoff.state === "uploading" && (
        <p className="font-mono text-xs opacity-60">
          {(handoff.upload.receivedBytes / 1_048_576).toFixed(1)} MB received
        </p>
      )}

      {done && handoff.upload && (
        <p className="text-sm">
          {(handoff.upload.receivedBytes / 1_048_576).toFixed(1)} MB arrived from your
          phone.
        </p>
      )}

      {dead && (
        <button
          type="button"
          onClick={() => void open()}
          className="rounded-lg border border-current/25 px-4 py-2 text-sm"
        >
          Generate a new code
        </button>
      )}

      {insecure && !done && (
        <p className="text-xs leading-relaxed opacity-45">
          Served over your local network, so both devices must be on the same Wi-Fi.
        </p>
      )}

      <details className="text-xs opacity-45">
        <summary className="cursor-pointer">Can&rsquo;t scan it?</summary>
        <p className="mt-2 break-all font-mono leading-relaxed">{url}</p>
      </details>
    </div>
  );
}
