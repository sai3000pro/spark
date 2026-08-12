"use client";

/**
 * In-page recording, with coverage guidance.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE COLOURS MEAN — read before trusting them.
 *
 * The same measurement the native ARKit app makes: a patch of scene is green
 * once it has been seen from five of twelve distinct azimuths, which is the
 * parallax a Gaussian splat actually needs. See lib/coverage.ts for the port
 * and for why it needs no depth sensor, and lib/tracking.ts for the optical
 * flow that stands in for LiDAR's data association.
 *
 * The practical consequence, and the reason this was worth rebuilding: turning
 * on the spot adds no angles and the overlay stays red, however long you hold
 * it there. You have to move around a thing to fill it in. That is true of the
 * reconstruction too, which is the whole point.
 *
 * WHAT IT STILL CANNOT DO. A blank wall or a clear sky gives optical flow
 * nothing to track, so those areas get no measurement — LiDAR would see them.
 * They fall back to a faint tint from whatever that direction knew before, and
 * the copy says the overlay follows texture. There is also no metric scale
 * here, so the native app's keyframe selector (`acceptPoseNovelty`, which needs
 * a 0.15 m translation test) has no equivalent: coverage drives this HUD, not
 * the reconstruction pipeline.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ANGLE BUDGET
 *
 * Because it cannot say WHICH surface is thin, it says whether the capture
 * PATTERN was thorough enough that thin surfaces are unlikely: the twelve
 * stations around the ring, the three height bands, and a frame-overlap
 * warning. That is the compensation for having no depth sensor, and on a phone
 * without LiDAR it is most of what makes the difference.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REQUIREMENTS
 *
 * `getUserMedia` needs a secure context, so this only mounts when the page was
 * served over HTTPS — see lib/net.ts and the fallback in PhoneCapture. On iOS,
 * DeviceOrientationEvent needs an explicit grant from a user gesture, which is
 * why coverage asks separately and degrades to a plain timer if refused.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  BucketCoverage,
  BUCKETS,
  bearingOfPixel,
  cameraDirection,
  colorRamp,
  directionCellKey,
  focalFor,
  metresBetween,
  pitchBand,
  popcount,
  surfaceAzimuthBucket,
  type LookDirection,
  type Projection,
} from "@/lib/coverage";
import { PointTracker, toGray } from "@/lib/tracking";
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

/** Long side of the frame handed to the tracker. Small on purpose — see tracking.ts. */
const TRACK_LONG = 192;

/** ~12 Hz. Fast enough to keep tracks alive, slow enough to share a phone. */
const TICK_MS = 80;

/** Gravity alone is ~9.8 m/s²; well past that is a jerk, and motion blur is the
 *  single most common reason a reconstruction comes out soft. */
const SHAKE_MS2 = 16;

/** How often the summary crosses back into React. */
const PUBLISH_MS = 250;

/** Displacement that means "somewhere else now", so local memory is stale. */
const GPS_RESET_M = 15;

/** Heat overlay resolution. Deliberately coarse — it is upscaled and smoothed. */
const GRID_W = 9;
const GRID_H = 12;

/** Per-tick flow past which consecutive frames barely overlap, as a share of width. */
const FLOW_WARN = 0.1;

/** Rolling analysis window, in ticks. ~8 s. */
const WINDOW = 100;

type Mode = "unknown" | "orbit" | "walk" | "panning";

interface Progress {
  fraction: number;
  green: number;
  total: number;
  /** 12-bit mask: which sides the scene has been shot from. */
  stations: number;
  /** 3-bit mask: low / level / high. */
  bands: number;
  points: number;
  flow: number;
  mode: Mode;
}

const EMPTY: Progress = {
  fraction: 0, green: 0, total: 0, stations: 0, bands: 0, points: 0, flow: 0,
  mode: "unknown",
};

export function GuidedRecorder({
  onRecorded,
  maxSeconds = 170,
  handoffId,
  token,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  // All of this lives outside React: written from a 60 Hz sensor handler and a
  // 12 Hz frame loop, read by a canvas neither of them should re-render. Only
  // `progress` crosses back, four times a second. Same split as the iOS
  // CoverageMap, an ObservableObject that publishes nothing but its `fraction`.
  const trackerRef = useRef<PointTracker | null>(null);
  /** Keyed by track id — the live measurement. */
  const parallaxRef = useRef<BucketCoverage | null>(null);
  /** Keyed by direction cell — what outlives a track. */
  const memoryRef = useRef<BucketCoverage | null>(null);
  const cellOfRef = useRef(new Map<number, number>());
  const lookRef = useRef<LookDirection | null>(null);
  const steadyRef = useRef(true);
  const bandsRef = useRef(0);
  const gpsAnchorRef = useRef<{ lat: number; lng: number } | null>(null);
  const histRef = useRef({ yaw: [] as number[], turn: [] as number[], gain: [] as number[], travel: 0 });

  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState<Progress>(EMPTY);
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

  // ── Orientation and motion ─────────────────────────────────────────────────
  const enableOrientation = useCallback(async () => {
    type Req = { requestPermission?: () => Promise<"granted" | "denied"> };
    const DOE = window.DeviceOrientationEvent as unknown as Req | undefined;
    const DME = window.DeviceMotionEvent as unknown as Req | undefined;
    try {
      if (DOE && typeof DOE.requestPermission === "function") {
        // iOS 13+. Must be called from a user gesture, which is why this is its
        // own step rather than something done on mount.
        const res = await DOE.requestPermission();
        if (res !== "granted") return;
      }
      // Asked separately because the specs are separate, even though iOS
      // happens to back both with one Motion & Orientation toggle. Failing this
      // costs only the shake warning, so it is not allowed to abort the rest.
      if (DME && typeof DME.requestPermission === "function") {
        await DME.requestPermission().catch(() => undefined);
      }
      setOrientationOn(true);
    } catch {
      // Refused or unavailable — recording still works, just without coverage.
    }
  }, []);

  useEffect(() => {
    if (!orientationOn || !recording) return;

    const onOrient = (e: DeviceOrientationEvent) => {
      // Not `alpha` as heading and `beta` as pitch — that shortcut is only
      // right for a phone held bolt upright, and wrong by tens of degrees the
      // moment it tilts, which is most of a real scan.
      const look = cameraDirection(e.alpha, e.beta, e.gamma);
      if (!look) return;
      lookRef.current = look;
      bandsRef.current |= 1 << pitchBand(look.pitchDeg);
    };

    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a) return;
      const jerky = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0) > SHAKE_MS2;
      steadyRef.current = !jerky;
      setShaky(jerky);
    };

    window.addEventListener("deviceorientation", onOrient);
    window.addEventListener("devicemotion", onMotion);
    return () => {
      window.removeEventListener("deviceorientation", onOrient);
      window.removeEventListener("devicemotion", onMotion);
    };
  }, [orientationOn, recording]);

  // ── Location, when it is offered ───────────────────────────────────────────
  //
  // Direction memory is anchored to nothing but a compass bearing, so once you
  // have walked far enough that "north" points at different scenery, it is
  // describing somewhere you are no longer standing. Fifteen metres of
  // displacement clears it.
  //
  // Denied or indoors is the common case, so the frame loop infers the same
  // thing from track turnover; this path is the crisper of the two when
  // available, and it is where the walk's real GPS track will come from.
  useEffect(() => {
    if (!recording || !navigator.geolocation) return;

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const fix = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const anchor = gpsAnchorRef.current;
        if (!anchor) {
          gpsAnchorRef.current = fix;
          return;
        }
        if (metresBetween(anchor, fix) >= GPS_RESET_M) {
          gpsAnchorRef.current = fix;
          memoryRef.current?.clear();
          histRef.current.travel = 0;
        }
      },
      // Silent: a denied or unavailable fix is the expected case, not an error
      // worth interrupting a recording for.
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [recording]);

  // ── The frame loop ─────────────────────────────────────────────────────────
  //
  // Grab → track → bucket → paint. The web answer to ARCoverageView, which
  // drapes the LiDAR mesh and colours each vertex by `coverage.level`.
  useEffect(() => {
    if (!recording) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!video || !canvas || !ctx) return;

    const grab = document.createElement("canvas");
    const gctx = grab.getContext("2d", { willReadFrequently: true });
    const heat = document.createElement("canvas");
    heat.width = GRID_W;
    heat.height = GRID_H;
    const hctx = heat.getContext("2d");
    if (!gctx || !hctx) return;

    const tracker = (trackerRef.current ??= new PointTracker());
    const parallax = (parallaxRef.current ??= new BucketCoverage());
    const memory = (memoryRef.current ??= new BucketCoverage());
    const cellOf = cellOfRef.current;
    const hist = histRef.current;

    let raf = 0;
    let lastTick = 0;
    let published = 0;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - lastTick < TICK_MS) return;
      lastTick = now;

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return;

      // ── grab ───────────────────────────────────────────────────────────────
      const s = TRACK_LONG / Math.max(vw, vh);
      const gw = Math.max(32, Math.round(vw * s));
      const gh = Math.max(32, Math.round(vh * s));
      if (grab.width !== gw || grab.height !== gh) {
        grab.width = gw;
        grab.height = gh;
        // Every tracked point's coordinates just became meaningless.
        tracker.reset();
      }
      gctx.drawImage(video, 0, 0, gw, gh);
      const gray = toGray(gctx.getImageData(0, 0, gw, gh).data, gw, gh);
      const upd = tracker.update(gray);

      const look = lookRef.current;
      const screenAngle = window.screen?.orientation?.angle ?? 0;

      // The grab canvas holds the WHOLE frame, uncropped, so its projection is
      // the camera's own. The display box below is cropped by object-cover and
      // needs its own.
      const frameProj: Projection = {
        focal: focalFor(gw, gh, vw, vh),
        width: gw,
        height: gh,
        screenAngle,
      };

      let gained = 0;
      if (look) {
        // Bank what a dying track learned into the direction it occupied. This
        // is the stand-in for iOS's persistent world map: coarse, but it means
        // looking back at somewhere does not start from zero.
        for (const p of upd.lost) {
          const cell = cellOf.get(p.id);
          if (cell !== undefined) memory.merge(cell, parallax.mask(p.id));
          cellOf.delete(p.id);
          parallax.delete(p.id);
        }
        // A new track inherits whatever that direction already knew.
        for (const p of upd.born) {
          const b = bearingOfPixel(look.R, p.x, p.y, frameProj);
          if (!b) continue;
          const cell = directionCellKey(b.azDeg, b.elDeg);
          cellOf.set(p.id, cell);
          parallax.merge(p.id, memory.mask(cell));
        }

        for (const p of upd.points) {
          const b = bearingOfPixel(look.R, p.x, p.y, frameProj);
          if (!b) continue;
          cellOf.set(p.id, directionCellKey(b.azDeg, b.elDeg));
          const before = parallax.mask(p.id);
          parallax.observe(p.id, surfaceAzimuthBucket(b.azDeg));
          if (parallax.mask(p.id) !== before) gained++;
        }
      }

      // ── what kind of motion is this? ───────────────────────────────────────
      //
      // The discriminator that matters is `gained`: a pan adds no angles however
      // wide it sweeps, because a fixed surface keeps a fixed bearing from a
      // fixed camera. Sweeping widely while gaining nothing IS turning on the
      // spot, and it is the most useful thing this screen can tell someone.
      const alive = upd.points.length;
      const turnover = alive + upd.lost.length > 0
        ? upd.lost.length / (alive + upd.lost.length)
        : 0;
      if (look) hist.yaw.push(Math.floor(look.yawDeg / 30) % 12);
      hist.turn.push(turnover);
      hist.gain.push(gained);
      if (hist.yaw.length > WINDOW) hist.yaw.shift();
      if (hist.turn.length > WINDOW) hist.turn.shift();
      if (hist.gain.length > WINDOW) hist.gain.shift();

      const spread = popcount(hist.yaw.reduce((m, b) => m | (1 << b), 0)) * 30;
      const meanTurn = hist.turn.reduce((a, b) => a + b, 0) / (hist.turn.length || 1);
      const meanGain = hist.gain.reduce((a, b) => a + b, 0) / (hist.gain.length || 1);

      const mode: Mode =
        spread > 90 && meanGain < 0.3
          ? "panning"
          : spread > 90 && meanGain >= 0.3
            ? "orbit"
            : meanTurn > 0.35
              ? "walk"
              : "unknown";

      // Without a GPS fix, three complete turnovers of the tracked scene while
      // travelling is the proxy for having walked somewhere else. Coarse, and
      // deliberately conservative — clearing too eagerly would keep resetting a
      // slow orbit.
      if (mode === "walk") {
        hist.travel += turnover;
        if (hist.travel >= 3) {
          hist.travel = 0;
          if (!gpsAnchorRef.current) memory.clear();
        }
      }

      // ── paint ──────────────────────────────────────────────────────────────
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = Math.round(canvas.clientWidth * dpr);
      const ch = Math.round(canvas.clientHeight * dpr);
      if (!cw || !ch) return;
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      ctx.clearRect(0, 0, cw, ch);

      if (look) {
        const boxProj: Projection = {
          focal: focalFor(cw, ch, vw, vh),
          width: cw,
          height: ch,
          screenAngle,
        };
        // Grab pixels → display pixels, through object-cover's crop.
        const k = (vw / gw) * Math.max(cw / vw, ch / vh);
        const shown = upd.points.map((p) => ({
          x: cw / 2 + (p.x - gw / 2) * k,
          y: ch / 2 + (p.y - gh / 2) * k,
          level: parallax.level(p.id),
        }));

        const img = hctx.createImageData(GRID_W, GRID_H);
        const reach = Math.max(cw / GRID_W, ch / GRID_H) * 1.4;
        for (let gy = 0; gy < GRID_H; gy++) {
          for (let gx = 0; gx < GRID_W; gx++) {
            const px = ((gx + 0.5) * cw) / GRID_W;
            const py = ((gy + 0.5) * ch) / GRID_H;

            let wsum = 0;
            let lsum = 0;
            for (const pt of shown) {
              const d = Math.hypot(pt.x - px, pt.y - py);
              if (d > reach) continue;
              const w = 1 / (1 + (d / reach) * (d / reach) * 8);
              wsum += w;
              lsum += w * pt.level;
            }

            let level: number;
            let alpha: number;
            if (wsum > 0) {
              level = lsum / wsum;
              alpha = 0.34 * Math.min(1, wsum);
            } else {
              // No trackable texture here — sky, a bare wall, a blown-out
              // window. Fall back to what this direction knew, faintly, and
              // never invent a reading.
              const b = bearingOfPixel(look.R, px, py, boxProj);
              const cell = b ? directionCellKey(b.azDeg, b.elDeg) : null;
              if (cell === null || !memory.has(cell)) continue;
              level = memory.level(cell);
              alpha = 0.12;
            }

            const { r, g, b: bl } = colorRamp(level);
            const o = (gy * GRID_W + gx) * 4;
            img.data[o] = r;
            img.data[o + 1] = g;
            img.data[o + 2] = bl;
            img.data[o + 3] = Math.round(alpha * 255);
          }
        }
        hctx.putImageData(img, 0, 0);
        // Upscaled with smoothing, which is what turns nine by twelve cells
        // into something that reads like the native app's draped mesh.
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(heat, 0, 0, cw, ch);
      }

      if (now - published >= PUBLISH_MS) {
        published = now;
        setProgress({
          fraction: memory.fraction,
          green: memory.greenCount,
          total: memory.cellCount,
          stations: memory.unionMask | parallax.unionMask,
          bands: bandsRef.current,
          points: alive,
          flow: upd.medianFlow / gw,
          mode,
        });
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [recording]);

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
    trackerRef.current?.reset();
    parallaxRef.current?.clear();
    memoryRef.current?.clear();
    cellOfRef.current.clear();
    bandsRef.current = 0;
    gpsAnchorRef.current = null;
    histRef.current = { yaw: [], turn: [], gain: [], travel: 0 };
    setProgress(EMPTY);
    rec.start(1000);
    setRecording(true);
    void enableOrientation();
  }, [onRecorded, enableOrientation]);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (error) {
    return <p className="text-sm leading-relaxed opacity-70">{error}</p>;
  }

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

        <canvas
          ref={canvasRef}
          aria-hidden
          className={`pointer-events-none absolute inset-0 h-full w-full transition-opacity ${
            recording && orientationOn ? "opacity-100" : "opacity-0"
          }`}
        />

        {recording && (
          <>
            {orientationOn && (
              <StationRing fraction={progress.fraction} stations={progress.stations} />
            )}
            <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/55 px-2.5 py-1">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              <span className="font-mono text-xs text-white">{fmt(elapsed)}</span>
              <span className="font-mono text-xs text-white/55">/ {fmt(maxSeconds)}</span>
            </div>
            {orientationOn && (
              <div className="absolute inset-x-0 bottom-3 flex flex-col items-center gap-1.5">
                <Heights bands={progress.bands} />
                <Legend />
              </div>
            )}
          </>
        )}
      </div>

      {recording && orientationOn && (
        <p className="text-xs leading-relaxed opacity-70">
          {hint(progress, shaky)}
        </p>
      )}

      {recording && !orientationOn && (
        <p className="text-xs leading-relaxed opacity-50">
          Motion sensors unavailable, so there&rsquo;s no coverage overlay — circle the
          subject slowly and evenly.
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
        Green means seen from enough angles, which is what a splat needs — so turning
        on the spot won&rsquo;t fill it in, only moving around things will. The overlay
        follows texture, so blank walls and open sky stay unmeasured; our iPhone app
        uses its depth sensor for those.
      </p>
    </div>
  );
}

/** What to say next, most urgent first. */
function hint(p: Progress, shaky: boolean): string {
  if (shaky) return "Hold steadier — motion blur is the usual reason a capture comes out soft.";
  if (p.flow > FLOW_WARN)
    return "Slow down — consecutive frames need to overlap or the reconstruction can't line them up.";
  if (p.points < 5)
    return "Not much texture in view. Point at something with detail — blank walls can't be measured from a camera alone.";
  if (p.mode === "panning")
    return "Turning on the spot doesn't add angles. Step around what you're filming instead.";

  const sides = popcount(p.stations);
  if (p.mode === "walk")
    return `Walking — step side to side as you go. ${sides} of ${BUCKETS} sides captured.`;
  if (p.mode === "orbit")
    return sides >= 10
      ? "All the way around. Now try it once more from higher or lower."
      : `Keep circling — ${sides} of ${BUCKETS} sides so far.`;
  return `Move around what you're filming. ${sides} of ${BUCKETS} sides captured.`;
}

/**
 * The iOS CoverageRing plus the angle budget in one dial: twelve segments for
 * the sides shot from, its own colour thresholds (CaptureView.swift:242), and
 * the percentage of what you've looked at that is well covered.
 */
function StationRing({ fraction, stations }: { fraction: number; stations: number }) {
  const R = 25;
  const C = 32;
  const colour = fraction >= 0.7 ? "#22c55e" : fraction >= 0.3 ? "#eab308" : "#ef4444";

  return (
    <svg
      viewBox="0 0 64 64"
      className="absolute right-3 top-3 h-16 w-16"
      role="img"
      aria-label={`${Math.round(fraction * 100)} per cent covered, ${popcount(stations)} of ${BUCKETS} sides captured`}
    >
      <circle cx={C} cy={C} r={R + 3} fill="rgba(0,0,0,0.45)" />
      {Array.from({ length: BUCKETS }, (_, i) => {
        const on = (stations & (1 << i)) !== 0;
        const gap = 0.08;
        const a0 = (i / BUCKETS) * 2 * Math.PI - Math.PI / 2 + gap;
        const a1 = ((i + 1) / BUCKETS) * 2 * Math.PI - Math.PI / 2 - gap;
        return (
          <path
            key={i}
            d={`M ${C + R * Math.cos(a0)} ${C + R * Math.sin(a0)} A ${R} ${R} 0 0 1 ${C + R * Math.cos(a1)} ${C + R * Math.sin(a1)}`}
            fill="none"
            strokeWidth={4}
            strokeLinecap="round"
            stroke={on ? colour : "rgba(255,255,255,0.2)"}
          />
        );
      })}
      <text
        x={C}
        y={C + 4}
        textAnchor="middle"
        className="font-mono"
        fontSize={13}
        fontWeight={700}
        fill="#fff"
      >
        {Math.round(fraction * 100)}%
      </text>
    </svg>
  );
}

/**
 * Low / level / high.
 *
 * Splats fail hardest on geometry only ever seen from one elevation, and it is
 * the easiest thing in the world to forget — everyone films at chest height.
 */
function Heights({ bands }: { bands: number }) {
  const labels = ["low", "level", "high"];
  return (
    <div className="flex items-center gap-2 rounded-full bg-black/45 px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-wide text-white/85">
      {labels.map((l, i) => (
        <span key={l} className={(bands & (1 << i)) !== 0 ? "" : "opacity-35"}>
          {l}
        </span>
      ))}
    </div>
  );
}

/** iOS's three-dot legend, worded for what this measures. */
function Legend() {
  return (
    <div className="flex items-center gap-3 rounded-full bg-black/45 px-3 py-1.5 text-[10px] font-semibold text-white/90">
      <LegendDot color="#ef4444" label="need angles" />
      <LegendDot color="#eab308" label="some" />
      <LegendDot color="#22c55e" label="enough" />
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

const fmt = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
