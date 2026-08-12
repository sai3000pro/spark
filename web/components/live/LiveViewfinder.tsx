"use client";

/**
 * The laptop watching the phone's camera, live.
 *
 * The receiving half of the WebRTC link opened in
 * app/m/[handoffId]/GuidedRecorder.tsx. The phone offers because it owns the
 * media; this side only answers and renders. Media arrives directly over the
 * Wi-Fi — it does not pass through the server, which is why it can be a
 * viewfinder rather than a slideshow.
 *
 * `recvonly` is declared explicitly rather than implied by adding no tracks.
 * Without a transceiver in place before `setRemoteDescription`, some browsers
 * answer with no media section at all and the connection completes carrying
 * nothing — a black rectangle with a healthy `connectionState`, which is a
 * miserable thing to debug.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { canReachInsecureWs, LiveReconSession, type LiveReconState } from "@/lib/liveRecon";
import {
  applySignal,
  attachSignalling,
  ICE_SERVERS,
  pollSignals,
  sendSignal,
  getRtcSupport,
  getServerRtcSupport,
  subscribeRtcSupport,
  type SignalMessage,
} from "@/lib/webrtc";

type Link = "idle" | "connecting" | "live" | "failed";

export function LiveViewfinder({ handoffId }: { handoffId: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [link, setLink] = useState<Link>("idle");

  const rtcSupported = useSyncExternalStore(
    subscribeRtcSupport,
    getRtcSupport,
    getServerRtcSupport,
  );

  useEffect(() => {
    if (!rtcSupported) return;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const pending: RTCIceCandidateInit[] = [];
    let cancelled = false;

    // See the header — this must exist before the offer is applied.
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });

    pc.ontrack = (e) => {
      if (videoRef.current && e.streams[0]) {
        videoRef.current.srcObject = e.streams[0];
      }
    };

    attachSignalling(pc, handoffId, "laptop", undefined, (state) => {
      if (cancelled) return;
      setLink(
        state === "connected"
          ? "live"
          : state === "failed" || state === "disconnected" || state === "closed"
            ? "failed"
            : "connecting",
      );
    });

    const stopPolling = pollSignals(handoffId, "laptop", async (m: SignalMessage) => {
      if (cancelled) return;
      const { answer } = await applySignal(pc, m, pending);
      if (answer) {
        setLink("connecting");
        await sendSignal({ handoffId, role: "laptop", kind: "answer", payload: answer });
      }
    });

    return () => {
      cancelled = true;
      stopPolling();
      pc.close();
    };
  }, [handoffId, rtcSupported]);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-hidden rounded-xl bg-ink-950/90">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          // Muted because the phone is in the same room: an unmuted return feed
          // is a feedback loop. The audio track is still received and recorded.
          muted
          className="aspect-video w-full object-contain"
        />
        {link !== "live" && (
          <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-[13px] text-paper/70">
            {!rtcSupported
              ? "This browser can't show a live view. Recording on the phone still works."
              : link === "failed"
                ? "Lost the live view. The recording on the phone is unaffected."
                : "Waiting for the phone's camera…"}
          </p>
        )}
      </div>

      <p className="fnote flex items-center gap-2 text-[9.5px] text-ink-faint">
        <span
          aria-hidden
          className={`h-1.5 w-1.5 rounded-full ${
            link === "live" ? "bg-moss" : "animate-pulse bg-ink-faint"
          }`}
        />
        {link === "live"
          ? "[ live · direct from the phone, not through a server ]"
          : "[ connecting · both devices must be on the same wi-fi ]"}
      </p>

      {link === "live" && <LiveReconControl videoRef={videoRef} />}
    </div>
  );
}

/**
 * Reconstruct while they film.
 *
 * The laptop already holds the phone's frames — they are in the <video> above.
 * This pushes them into a live capture session as they arrive, so the studio
 * can start training instead of waiting for a finished clip to be uploaded.
 *
 * A LAPTOP control, not a phone one, and deliberately so: it is the laptop's
 * studio, the laptop's GPU and the laptop's socket. The phone's post-recording
 * choice picks where the FINISHED clip goes; this is a different question asked
 * of a different machine at a different time.
 *
 * Only offered when a capture server actually answers, because a toggle that
 * silently streams into nothing is worse than no toggle.
 */
function LiveReconControl({
  videoRef,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const sessionRef = useRef<LiveReconSession | null>(null);
  const [offered, setOffered] = useState(false);
  const [state, setState] = useState<LiveReconState | null>(null);
  const [splat, setSplat] = useState<{ version: number; ply: string | null } | null>(null);

  // Offer it only if the studio is up. Probed server-side, since the browser
  // cannot see whether localhost:8899 is listening without a CORS fight.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/reconstruction/targets", { cache: "no-store" });
        if (!alive || !res.ok) return;
        const body = (await res.json()) as { studio: { reachable: boolean } };
        if (alive) setOffered(body.studio.reachable && canReachInsecureWs());
      } catch {
        // Not offered. Recording is unaffected.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Watch the splat grow. The studio rewrites result.ply in place each snapshot,
  // so a bumping version is the only signal that anything changed.
  useEffect(() => {
    const id = state?.sessionId;
    if (!id || state?.phase !== "streaming") return;
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/capture/live-splat?session=${encodeURIComponent(id)}`, {
          cache: "no-store",
        });
        if (!alive || !res.ok) return;
        const body = (await res.json()) as { version?: number; current_ply?: string };
        if (alive && typeof body.version === "number") {
          setSplat({ version: body.version, ply: body.current_ply ?? null });
        }
      } catch {
        // The studio is allowed to be busy. Nothing here is load-bearing.
      }
    };
    const timer = setInterval(() => void tick(), 3000);
    void tick();
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [state?.sessionId, state?.phase]);

  useEffect(() => () => sessionRef.current?.stop(), []);

  const begin = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    const session = new LiveReconSession({ onState: setState });
    sessionRef.current = session;
    const id = await session.start();
    if (id) session.pump(video);
  }, [videoRef]);

  const end = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
  }, []);

  if (!offered) return null;

  if (!state || state.phase === "idle" || state.phase === "ended") {
    return (
      <button
        type="button"
        onClick={() => void begin()}
        className="fnote self-start rounded-[3px] border border-ink/20 px-2.5 py-1 text-[10px] text-ink-soft transition-colors hover:text-ink"
      >
        [ reconstruct while they film ]
      </button>
    );
  }

  if (state.phase === "failed") {
    return (
      <p className="fnote text-[9.5px] leading-relaxed text-clay">
        [ {state.error ?? "live reconstruction stopped"} · the recording is unaffected ]
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="fnote flex flex-wrap items-center gap-2 text-[9.5px] text-ink-faint">
        <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-lagoon" />
        [ {state.phase === "connecting" ? "opening a session" : `${state.framesSent} frames sent`}
        {state.dropped > 0 ? ` · ${state.dropped} dropped` : ""}
        {splat ? ` · splat v${splat.version}` : " · waiting for the first splat"} ]
        <button
          type="button"
          onClick={end}
          className="underline underline-offset-2 transition-colors hover:text-ink"
        >
          stop
        </button>
      </p>
      <p className="fnote text-[9px] leading-relaxed text-ink-faint">
        [ a browser has no depth sensor and no tracked position, so these frames go over
        unposed — the studio has to solve structure itself, which our iPhone app skips ]
      </p>
    </div>
  );
}
