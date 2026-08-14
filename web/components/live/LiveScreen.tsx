"use client";

/**
 * The live screen's client half.
 *
 * It exists to own the LiveTripProvider. `/live` sits outside app/(app), which
 * is where the provider used to be mounted for the whole aurora subtree — and
 * the journal has no equivalent shell, because the journal's pages are mostly
 * one full-bleed surface with no persistent bar. So the page provides its own,
 * exactly as components/home/TickerBlob.tsx does for the landing's companion.
 *
 * The provider is what `useLiveTrip()` reads; without it RecordControl throws.
 */
import { useEffect, useState } from "react";

import { LiveTripProvider, useLiveTrip } from "@/components/shell/LiveTripProvider";
import { PhoneHandoffPanel } from "@/components/live/PhoneHandoffPanel";
import { PendingReconstructions } from "@/components/live/PendingReconstructions";
import { VideoWalkPanel } from "@/components/live/VideoWalkPanel";
import type { ActiveTripSnapshot } from "@/lib/liveTrip";

export function LiveScreen({ initial }: { initial: ActiveTripSnapshot | null }) {
  return (
    <LiveTripProvider initial={initial}>
      <section
        className="plate-vellum rise-in relative p-5 sm:p-6"
        style={{ "--i": 1 } as React.CSSProperties}
      >
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <span className="fnote text-[10px] text-ink-faint">[ 01 ]</span>
            <h2 className="mt-1 text-[20px] leading-tight text-ink">Follow a walk live</h2>
            <p className="mt-1.5 max-w-prose text-[13.5px] leading-relaxed text-ink-soft">
              A rover carries the camera and this counts what it sees. Nothing here is driving
              anything yet — connect one and the session opens by itself.
            </p>
          </div>
          <RoverGate />
        </header>

        {/* Renders itself away when nothing is running, which — with no rover —
            is the normal case. Kept mounted so that the moment something POSTs
            to /api/ingest/detections the counters simply appear, with no code
            change. That seam is the point; see lib/liveTrip.ts. */}
        <LiveCounters />

        <RoverSeam />
      </section>

      <PhoneHandoffSection />

      <VideoWalkPanel />

      {/* Renders itself away when nothing is outstanding. Its other job is to
          be somewhere the KIRI collector can run: a reconstruction is only
          polled by a read of /api/splat/jobs/<id>, so a clip nobody is looking
          at is a clip whose splat never lands. */}
      <PendingReconstructions />
    </LiveTripProvider>
  );
}

/**
 * The rover slot, held shut.
 *
 * This section used to open a recording session on click, and then count
 * detections extrapolated from the pipeline's average rates while a badge
 * admitted they were simulated. That was honest, and it was still the wrong
 * thing to offer: nobody has a rover, so the one prominent action on the page
 * led to a screen of numbers that no hardware produced.
 *
 * So the control is a status, not a button. When something actually reports in
 * — /api/ingest/detections is the seam, and it already validates and scores for
 * real — this becomes a live session with measured counters and no badge. Until
 * then it says what is true.
 *
 * Deliberately not hidden. The rover is a real part of the product's shape, and
 * a missing section reads as "this does not exist" rather than "this is not
 * plugged in".
 */
function RoverGate() {
  return (
    <div className="flex flex-col items-end gap-1.5">
      <span
        className="pill-brass pointer-events-none inline-flex items-center gap-2 px-4 py-2 text-[13px] opacity-45"
        aria-disabled="true"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-ink/35" />
        Connect a rover
      </span>
      <span className="fnote text-[9.5px] text-ink-faint">[ no rover detected ]</span>
    </div>
  );
}

/**
 * What a rover would have to do — the guide, in the two lines that are true.
 *
 * The section above says "connect one and the session opens by itself", which
 * is accurate and completely unactionable: it does not say what connecting IS.
 * A "full guide coming soon" note on its own would be worse — a promise instead
 * of information.
 *
 * So this states the seam. It is not a roadmap item; it is the contract the
 * counters above are already listening on, today, and anything that can POST
 * to it opens a session — a robot, a script, a phone on a stick. Naming it
 * turns a dead pill into something someone can actually go and satisfy.
 *
 * Closed by default. Someone who has no rover should not have to scroll past
 * an API description to reach the two capture routes that work right now.
 */
function RoverSeam() {
  return (
    <details className="group mt-4">
      <summary className="fnote cursor-pointer text-[10px] text-ink-faint">
        [ what counts as a rover ]
      </summary>
      <div className="mt-2.5 max-w-prose text-[12.5px] leading-relaxed text-ink-soft">
        <p>
          Anything that can POST detections. Send batches to{" "}
          <code className="fnote text-[11px] text-ink">POST /api/ingest/detections</code> as they
          are found — that call opens the session on its own, so there is no handshake to get
          wrong. The counters above appear on the first batch that validates, and the numbers are
          whatever was actually sent.
        </p>
        <p className="mt-2">
          <code className="fnote text-[11px] text-ink">POST /api/trip/start</code> is optional, and
          only worth calling to name the walk and its place before the first detection arrives.
        </p>
        <p className="mt-2">
          There is no rover-specific code path and no hardware list, which is deliberate: the
          detections a robot sends and the ones a browser produces from a video go through the same
          scorer.
        </p>
        <p className="fnote mt-2.5 text-[10px] leading-relaxed text-ink-faint">
          [ want to mount a phone on one instead? a build guide is coming ]
        </p>
      </div>
    </details>
  );
}

/**
 * Record on the phone instead.
 *
 * A laptop webcam is the wrong instrument for walking around a thing, so the
 * honest answer to "how do I capture this" is almost always "with the phone
 * already in your pocket". The QR is the shortest path to it that does not
 * involve typing an IP address with a thumb.
 *
 * A child of the provider so the handoff can be tagged with the trip that is
 * already open, and so a capture arrives attached to the walk it belongs to
 * rather than floating loose.
 */
function PhoneHandoffSection() {
  const { active } = useLiveTrip();

  return (
    <section
      className="plate-vellum rise-in relative mt-5 p-5 sm:p-6"
      style={{ "--i": 2 } as React.CSSProperties}
    >
      <header>
        <span className="fnote text-[10px] text-ink-faint">[ 02 ]</span>
        <h2 className="mt-1 text-[20px] leading-tight text-ink">Record with your phone</h2>
        {/* Deliberately says nothing about Wi-Fi. Whether both devices must share a
            network depends on how this page is being served, and only the server
            knows — PhoneHandoffPanel prints that caveat when, and only when, the
            QR points at a LAN address. Stating it here would be wrong over a
            tunnel or a deployment. */}
        <p className="mt-1.5 max-w-prose text-[13.5px] leading-relaxed text-ink-soft">
          Scan the code and record on your phone — either in the page with coverage
          guidance, or through your phone&apos;s own camera app. The clip comes straight
          back here.
        </p>
      </header>

      <div className="mt-4 max-w-sm">
        <PhoneHandoffPanel tripId={active?.id ?? null} />
      </div>

      <KiriKeyField />
    </section>
  );
}

/**
 * The KIRI key, entered here rather than on the phone.
 *
 * Typing a 40-character API key with a thumb is miserable, and the person is
 * sitting at the laptop anyway — so the phone only picks KIRI as a destination
 * and says "add a key on the laptop" when there isn't one.
 *
 * The key is POSTed once and never comes back: the server validates it against
 * KIRI's own /balance before storing, and every read after that returns four
 * characters and a credit count. See lib/reconstruction/keys.ts, which is also
 * honest about what this store is not.
 */
function KiriKeyField() {
  const [key, setKey] = useState("");
  const [state, setState] = useState<
    | { k: "idle" }
    | { k: "saving" }
    | { k: "saved"; tail: string; credits: number | null; source: "env" | "pasted" | null }
    | { k: "error"; why: string }
  >({ k: "idle" });

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/reconstruction/key", { cache: "no-store" });
        if (!alive || !res.ok) return;
        const body = (await res.json()) as {
          present: boolean;
          tail: string | null;
          credits: number | null;
          source?: "env" | "pasted" | null;
        };
        if (alive && body.present && body.tail) {
          setState({
            k: "saved",
            tail: body.tail,
            credits: body.credits,
            source: body.source ?? null,
          });
        }
      } catch {
        // No key configured is the normal case, not an error to announce.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const save = async () => {
    setState({ k: "saving" });
    try {
      const res = await fetch("/api/reconstruction/key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const body = (await res.json()) as {
        tail?: string; credits?: number | null; error?: string;
      };
      if (!res.ok) {
        setState({ k: "error", why: body.error ?? "That key was not accepted." });
        return;
      }
      // Out of the field the instant it is stored, so it is not sitting in a
      // form that a screenshot or an autofill dump would pick up.
      setKey("");
      setState({
        k: "saved",
        tail: body.tail ?? "····",
        credits: body.credits ?? null,
        source: "pasted",
      });
    } catch {
      setState({ k: "error", why: "Could not reach the server." });
    }
  };

  const forget = async () => {
    await fetch("/api/reconstruction/key", { method: "DELETE" }).catch(() => undefined);
    setState({ k: "idle" });
  };

  if (state.k === "saved") {
    return (
      <p className="fnote mt-4 flex flex-wrap items-center gap-2 text-[10px] text-ink-faint">
        [ kiri key ····{state.tail}
        {state.credits !== null ? ` · ${state.credits} credits` : ""}
        {/* Where it came from changes what the button beside this can promise.
            An env key is the machine's, not the session's — see the note in
            lib/reconstruction/keys.ts. */}
        {state.source === "env" ? " · from .env" : ""} ]
        <button
          type="button"
          onClick={() => void forget()}
          className="underline underline-offset-2 transition-colors hover:text-ink"
        >
          {state.source === "env" ? "ignore it until restart" : "forget it"}
        </button>
      </p>
    );
  }

  return (
    <details className="mt-4 max-w-sm">
      <summary className="fnote cursor-pointer text-[10px] text-ink-faint">
        [ add a kiri key, to reconstruct in the cloud ]
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="KIRI API key"
          autoComplete="off"
          spellCheck={false}
          className="rounded-[3px] border border-ink/15 bg-transparent px-2.5 py-1.5 font-mono text-[12px] text-ink placeholder:text-ink-faint"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={!key.trim() || state.k === "saving"}
            className="pill-brass px-3 py-1.5 text-[12px] disabled:opacity-50"
          >
            {state.k === "saving" ? "Checking…" : "Save"}
          </button>
          {state.k === "error" && (
            <span className="text-[11px] leading-relaxed text-clay">{state.why}</span>
          )}
        </div>
        <p className="fnote text-[9.5px] leading-relaxed text-ink-faint">
          [ checked against kiri before it is stored · held in memory on this server only,
          not encrypted at rest, and lost on restart ]
        </p>
      </div>
    </details>
  );
}

/**
 * The three stages, live.
 *
 * Reads the same snapshot the app bar does. `simulated` is surfaced rather than
 * hidden: the moment /api/ingest/* reports real numbers the badge disappears on
 * its own, with no code change — that is the whole point of the seam in
 * lib/liveTrip.ts.
 *
 * A child of the provider rather than part of LiveScreen's own body, because a
 * component cannot consume a context it renders itself.
 */
function LiveCounters() {
  const { active } = useLiveTrip();

  // Nothing to say. The section header already states that no rover is
  // connected, and "nothing running" underneath it would be the same sentence
  // twice. Previously this line was useful because the button above could open a
  // session; now that only hardware can, its absence IS the message.
  if (!active) return null;

  const rows: Array<[string, number]> = [
    ["detections", active.counters.detections],
    ["candidates", active.counters.candidates],
    ["moments", active.counters.moments],
  ];

  return (
    <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2">
      {rows.map(([label, n]) => (
        <span key={label} className="flex items-baseline gap-1.5">
          <span className="tnum text-[19px] leading-none text-ink" suppressHydrationWarning>
            {n.toLocaleString()}
          </span>
          <span className="fnote text-[9.5px] text-ink-faint">{label}</span>
        </span>
      ))}
      {/* No "extrapolated" badge any more, because there is nothing left to
          extrapolate: a session cannot exist unless something reported into it,
          so every number here was counted. See lib/liveTrip.ts. */}
    </div>
  );
}
