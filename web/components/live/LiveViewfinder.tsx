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
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

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
    </div>
  );
}
