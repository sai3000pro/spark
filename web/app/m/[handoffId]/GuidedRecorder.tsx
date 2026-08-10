"use client";

/**
 * In-page recording, with coverage guidance.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS CAN AND CANNOT TELL YOU — read before trusting the ring.
 *
 * The native ARKit app in ios/ knows which SURFACES are undersampled, because it
 * has depth and a tracked 3D map: it can say "that chair leg has been seen from
 * one angle". This cannot. A browser gets no depth, no SLAM, and no WebXR on iOS
 * Safari.
 *
 * What a browser DOES get is device orientation — the direction the phone is
 * pointing. So the ring below measures ANGULAR COVERAGE: how much of the circle
 * around you the camera has faced, and for how long. That is a genuinely useful
 * proxy, because the failure mode it catches is the common one — people sweep
 * one arc, stop, and get a reconstruction that is sharp on one side and mush on
 * the other.
 *
 * It is a proxy and the copy says so. "You have not pointed the camera here" is
 * true and checkable; "this surface needs more scanning" would not be.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REQUIREMENTS
 *
 * `getUserMedia` needs a secure context, so this component only ever mounts when
 * the page was served over HTTPS — see lib/net.ts and the fallback in
 * PhoneCapture. On iOS, DeviceOrientationEvent additionally needs an explicit
 * permission grant triggered by a user gesture, which is why the coverage ring
 * asks separately and degrades to a plain timer if refused.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  applySignal,
  attachSignalling,
  ICE_SERVERS,
  pollSignals,
  sendSignal,
  type SignalMessage,
} from "@/lib/webrtc";

interface Props {
  onRecorded: (file: File) => void;
  /** KIRI's hard cap. Going over wastes a credit on a rejected clip. */
  maxSeconds?: number;
  /** Streams the viewfinder to the laptop while this is open. */
  handoffId: string;
  token: string;
}

/** Twelve 30° sectors. Fine enough to show a gap, coarse enough to fill. */
const SECTORS = 12;
/** A sector counts as covered after this long facing it — a glance is not a scan. */
const DWELL_MS = 700;

export function GuidedRecorder({
  onRecorded,
  maxSeconds = 170,
  handoffId,
  token,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const sectorEntered = useRef<number | null>(null);
  const lastSector = useRef<number | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [covered, setCovered] = useState<boolean[]>(() => Array(SECTORS).fill(false));
  const [orientationOn, setOrientationOn] = useState(false);
  const [shaky, setShaky] = useState(false);
  const [linkState, setLinkState] = useState<RTCPeerConnectionState>("new");

  // ── Camera ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // `environment` is a preference, not a guarantee — a phone with one
          // camera, or a laptop, still resolves. That is fine; the guidance is
          // the same either way.
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setLive(true);
      } catch (err) {
        setError(
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "Camera access was declined. Allow it in your browser settings, or use your camera app instead."
            : "Could not open the camera. Use your camera app instead.",
        );
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // ── Live link to the laptop ────────────────────────────────────────────────
  //
  // Starts as soon as the camera is open, not when recording starts: the point
  // is that whoever is at the laptop can see the framing and say "left a bit"
  // BEFORE the take, which is the entire reason to have two devices.
  //
  // The phone is the offerer because it owns the media; the laptop only
  // receives. That also means the phone is the side holding the token, which is
  // the side the relay authenticates.
  useEffect(() => {
    if (!live) return;
    const stream = streamRef.current;
    if (!stream || typeof RTCPeerConnection === "undefined") return;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const pending: RTCIceCandidateInit[] = [];
    let cancelled = false;

    for (const track of stream.getTracks()) pc.addTrack(track, stream);
    attachSignalling(pc, handoffId, "phone", token, setLinkState);

    const stopPolling = pollSignals(handoffId, "phone", async (m: SignalMessage) => {
      if (cancelled) return;
      await applySignal(pc, m, pending);
    });

    void (async () => {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendSignal({ handoffId, role: "phone", token, kind: "offer", payload: offer });
    })();

    // Heartbeat. The laptop derives "streaming" from its recency, so a phone
    // that is locked or leaves the network stops showing as live on its own —
    // no explicit teardown message, which would never arrive in those cases.
    const beat = setInterval(() => {
      void sendSignal({ handoffId, role: "phone", token, streaming: true });
    }, 2500);

    return () => {
      cancelled = true;
      clearInterval(beat);
      stopPolling();
      pc.close();
    };
  }, [live, handoffId, token]);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
    setRecording(false);
  }, []);

  // ── Elapsed, and the hard stop ─────────────────────────────────────────────
  //
  // Wall-clock, not a tick count. A phone throttles timers in a backgrounded or
  // dimmed tab, so counting `setInterval` fires drifts short — and drifting
  // short on a duration cap means shipping an over-length clip that the
  // reconstructor rejects after the credit is spent.
  //
  // The cap is enforced here rather than in its own effect so the stop happens
  // inside a callback, not synchronously in an effect body.
  useEffect(() => {
    if (!recording) return;
    const startedAt = Date.now();
    const id = setInterval(() => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      setElapsed(s);
      if (s >= maxSeconds) stop();
    }, 250);
    return () => clearInterval(id);
  }, [recording, maxSeconds, stop]);

  // ── Coverage, from device orientation ──────────────────────────────────────
  const enableOrientation = useCallback(async () => {
    type Req = { requestPermission?: () => Promise<"granted" | "denied"> };
    const DOE = window.DeviceOrientationEvent as unknown as Req | undefined;
    try {
      if (DOE && typeof DOE.requestPermission === "function") {
        // iOS 13+. Must be called from a user gesture, which is why this is its
        // own button rather than something done on mount.
        const res = await DOE.requestPermission();
        if (res !== "granted") return;
      }
      setOrientationOn(true);
    } catch {
      // Refused or unavailable — the recorder still works, just without a ring.
    }
  }, []);

  useEffect(() => {
    if (!orientationOn || !recording) return;

    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.alpha == null) return;
      const sector = Math.floor(((e.alpha % 360) + 360) % 360 / (360 / SECTORS));
      const now = Date.now();

      if (sector !== lastSector.current) {
        lastSector.current = sector;
        sectorEntered.current = now;
        return;
      }
      // Held here long enough to count as looked at, rather than swept past.
      if (sectorEntered.current && now - sectorEntered.current >= DWELL_MS) {
        setCovered((prev) => {
          if (prev[sector]) return prev;
          const next = [...prev];
          next[sector] = true;
          return next;
        });
      }
    };

    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a) return;
      const mag = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0);
      // Gravity alone is ~9.8; well above that is a jerk, and motion blur is the
      // single most common reason a reconstruction comes out soft.
      setShaky(mag > 16);
    };

    window.addEventListener("deviceorientation", onOrient);
    window.addEventListener("devicemotion", onMotion);
    return () => {
      window.removeEventListener("deviceorientation", onOrient);
      window.removeEventListener("devicemotion", onMotion);
    };
  }, [orientationOn, recording]);

  // ── Recording ──────────────────────────────────────────────────────────────
  const start = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;

    // iOS Safari emits mp4/HEVC; Android emits webm. Ask for what the platform
    // actually supports rather than assuming, or `start()` throws.
    const mime = [
      "video/mp4;codecs=avc1",
      "video/mp4",
      "video/webm;codecs=vp9",
      "video/webm",
    ].find((m) => MediaRecorder.isTypeSupported(m));

    chunks.current = [];
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data);
    };
    rec.onstop = () => {
      const type = rec.mimeType || mime || "video/mp4";
      const ext = type.includes("mp4") ? "mp4" : "webm";
      const blob = new Blob(chunks.current, { type });
      onRecorded(new File([blob], `capture.${ext}`, { type }));
    };

    recorderRef.current = rec;
    setElapsed(0);
    setCovered(Array(SECTORS).fill(false));
    rec.start(1000);
    setRecording(true);
    void enableOrientation();
  }, [onRecorded, enableOrientation]);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (error) {
    return <p className="text-sm leading-relaxed opacity-70">{error}</p>;
  }

  const coveredCount = covered.filter(Boolean).length;
  const remaining = Math.max(0, maxSeconds - elapsed);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative overflow-hidden rounded-xl bg-black">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="aspect-[3/4] w-full object-cover"
        />

        {recording && (
          <>
            <CoverageRing covered={covered} />
            <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/55 px-2.5 py-1">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              <span className="font-mono text-xs text-white">{fmt(elapsed)}</span>
              <span className="font-mono text-xs text-white/55">/ {fmt(maxSeconds)}</span>
            </div>
            {shaky && (
              <p className="absolute inset-x-3 bottom-3 rounded-lg bg-black/65 px-3 py-2 text-center text-xs text-white">
                Slow down — fast movement blurs the frames
              </p>
            )}
          </>
        )}
      </div>

      {recording && orientationOn && (
        <p className="text-xs leading-relaxed opacity-65">
          {coveredCount === SECTORS
            ? "You've faced the camera all the way around. Good coverage."
            : `Faced ${coveredCount} of ${SECTORS} directions. Turn towards the gaps in the ring.`}
        </p>
      )}

      {recording && !orientationOn && (
        <p className="text-xs leading-relaxed opacity-50">
          Motion sensors unavailable, so there&rsquo;s no coverage ring — circle the subject
          slowly and evenly.
        </p>
      )}

      {!recording ? (
        <button
          type="button"
          onClick={start}
          disabled={!live}
          className="rounded-xl border border-current/25 px-5 py-4 text-base font-medium disabled:opacity-40"
        >
          {live ? "Start recording" : "Opening camera…"}
        </button>
      ) : (
        <button
          type="button"
          onClick={stop}
          className="rounded-xl bg-red-600 px-5 py-4 text-base font-medium text-white"
        >
          Stop · {fmt(remaining)} left
        </button>
      )}

      <p className="flex items-center gap-2 text-xs opacity-60">
        <span
          aria-hidden
          className={`h-1.5 w-1.5 rounded-full ${
            linkState === "connected" ? "bg-green-500" : "animate-pulse bg-current/40"
          }`}
        />
        {linkState === "connected"
          ? "Your laptop is seeing this live"
          : linkState === "failed"
            ? "Couldn't reach the laptop — check you're both on the same Wi-Fi. Recording still works."
            : "Connecting to your laptop…"}
      </p>

      <p className="text-xs leading-relaxed opacity-45">
        The ring tracks which directions you&rsquo;ve pointed the camera. It can&rsquo;t see
        which surfaces are still thin — that needs depth sensing the browser has no access to.
      </p>
    </div>
  );
}

/** Twelve sectors as a ring. Filled = faced for long enough to count. */
function CoverageRing({ covered }: { covered: boolean[] }) {
  const R = 26;
  const C = 32;
  return (
    <svg
      viewBox="0 0 64 64"
      className="absolute right-3 top-3 h-16 w-16"
      aria-label={`Coverage: ${covered.filter(Boolean).length} of ${covered.length} directions`}
    >
      <circle cx={C} cy={C} r={R} fill="rgba(0,0,0,0.45)" />
      {covered.map((on, i) => {
        const a0 = (i / covered.length) * 2 * Math.PI - Math.PI / 2;
        const a1 = ((i + 1) / covered.length) * 2 * Math.PI - Math.PI / 2;
        const gap = 0.06;
        const x0 = C + R * Math.cos(a0 + gap);
        const y0 = C + R * Math.sin(a0 + gap);
        const x1 = C + R * Math.cos(a1 - gap);
        const y1 = C + R * Math.sin(a1 - gap);
        return (
          <path
            key={i}
            d={`M ${x0} ${y0} A ${R} ${R} 0 0 1 ${x1} ${y1}`}
            fill="none"
            strokeWidth={5}
            strokeLinecap="round"
            stroke={on ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.22)"}
          />
        );
      })}
    </svg>
  );
}

const fmt = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
