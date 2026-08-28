/**
 * Streaming the phone's live camera into a reconstruction session, from the
 * laptop's browser.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE THIS SITS
 *
 * The phone already streams to the laptop over WebRTC (lib/webrtc.ts) so the
 * laptop can act as a viewfinder. Those frames are sitting in a <video> element
 * doing nothing but being looked at. This takes them and pushes them into a
 * live capture session as they arrive, so a reconstruction can begin while
 * someone is still filming rather than three minutes later.
 *
 *   phone ──WebRTC──▶ laptop <video> ──this──▶ ws://…/ws/phone ──▶ live_sessions/
 *                                                                        │
 *                                                        studio's LiveReconManager
 *
 * FROM THE BROWSER, NOT THROUGH NEXT. The laptop already holds the pixels, and
 * a WebSocket straight to the capture server means frame bytes never traverse
 * the app server at all. It also means no `ws` dependency on the Node side and
 * no per-frame handshake. The cost is a mixed-content rule: a page served over
 * https cannot open a `ws://`. The laptop is normally on http://localhost while
 * only the PHONE uses the tunnel, so this holds in the arrangement that
 * actually happens — and `canReachInsecureWs()` states it rather than failing
 * mysteriously.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PROTOCOL IS NOT OURS
 *
 * It is `tools/live_capture_server/protocol.py`, which the iOS app also speaks.
 * hello → hello_ack, begin_session → session_ack, then per payload a JSON
 * `bulk_header` text frame IMMEDIATELY followed by one binary frame, and wait
 * for the `ack`. Identity is (session_id, frame_id, payload_type) with a
 * sha256, never arrival order, which is what makes it idempotent and resumable.
 * Deviating here silently corrupts a session, so this file follows
 * `tools/live_capture_server/client.py` line for line.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT A BROWSER CANNOT SEND, AND WHY IT IS SAID OUT LOUD
 *
 * The native app sends ARKit's tracked 6-DoF pose and LiDAR depth. Per
 * REALTIME_SPLAT_PLAN.md those poses are "the single biggest enabler" — they
 * are what lets Brush skip the SfM solve entirely and train immediately.
 *
 * THIS path has neither. It is built on `DeviceOrientationEvent`, which gives
 * the phone's ROTATION and nothing about where it is. So `camera_transform`
 * below carries a real rotation and a ZERO translation, and the metadata says
 * so in `pose_source` / `has_translation`. A studio must treat these frames as
 * unposed and solve structure itself. Writing a plausible-looking translation
 * would be worse than sending none: it would train a confident, wrong scene.
 *
 * "A browser cannot know where it is" is NO LONGER TRUE IN GENERAL, and this
 * paragraph used to say it was. WebXR's `immersive-ar` session exposes ARCore's
 * tracked 6-DoF pose on Android, and lib/webxr/ uses exactly that to write a
 * finished COLMAP model so the solve can be skipped — the same enabler the
 * native app has. What remains true is that it is not available HERE: WebXR
 * needs a session the user grants, it is Android-only (iOS Safari has no WebXR
 * at all), and this socket is the fallback for every phone that cannot do it.
 *
 * So both paths exist and they are not redundant. Read lib/webxr/support.ts for
 * which one a given device gets, and do not "fix" the zero translation below by
 * copying a pose from there — a device on this path genuinely does not have one.
 */

/** The capture server's own default port. Override for a studio elsewhere. */
export const LIVE_CAPTURE_WS =
  process.env.NEXT_PUBLIC_LIVE_CAPTURE_WS ?? "ws://localhost:8765/ws/phone";

const PROTOCOL_VERSION = 1;

export type PayloadType = "rgb" | "depth" | "confidence" | "frame_metadata" | "audio";

/**
 * Can this page open a plain-ws socket at all?
 *
 * A secure page may not, and that is a browser rule with no workaround short of
 * running the capture server behind TLS. Worth checking before offering the
 * option rather than after someone has filmed for three minutes.
 */
export function canReachInsecureWs(url: string = LIVE_CAPTURE_WS): boolean {
  if (typeof window === "undefined") return false;
  if (url.startsWith("wss://")) return true;
  return !window.isSecureContext || window.location.hostname === "localhost";
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer: a Uint8Array view over a larger buffer would
  // hash the whole backing store, and the server compares against the payload.
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A 4×4 row-major camera transform from a rotation only.
 *
 * Translation is zero and that is deliberate — see the header. Exported so the
 * shape can be asserted without a socket.
 */
export function transformFromRotation(R: readonly number[] | null): number[][] {
  const r = R ?? [1, 0, 0, 0, 1, 0, 0, 0, 1];
  return [
    [r[0], r[1], r[2], 0],
    [r[3], r[4], r[5], 0],
    [r[6], r[7], r[8], 0],
    [0, 0, 0, 1],
  ];
}

/**
 * A pinhole intrinsics matrix from an assumed field of view.
 *
 * Assumed, because no web API reports a camera's FOV. A studio that solves
 * structure itself will refine these; one that trusts them will be slightly
 * wrong in a uniform way, which is the better of the two failure modes.
 */
export function intrinsicsFor(width: number, height: number, hFovDeg = 65): number[][] {
  const f = Math.max(width, height) / (2 * Math.tan((hFovDeg * Math.PI) / 360));
  return [
    [f, 0, width / 2],
    [0, f, height / 2],
    [0, 0, 1],
  ];
}

export interface LiveReconOptions {
  url?: string;
  deviceSessionId?: string;
  /** Frames per second handed to the reconstructor. */
  fps?: number;
  /** Long side of the streamed JPEG. Full resolution is wasted on a trainer. */
  longSide?: number;
  jpegQuality?: number;
  /** Latest camera rotation, row-major 3×3, or null when unknown. */
  rotationAt?: () => readonly number[] | null;
  onState?: (s: LiveReconState) => void;
}

export interface LiveReconState {
  phase: "idle" | "connecting" | "streaming" | "ended" | "failed";
  sessionId: string | null;
  framesSent: number;
  bytesSent: number;
  /** Frames dropped because the previous one had not been acknowledged. */
  dropped: number;
  error: string | null;
}

/**
 * One live session: connect, begin, pump frames, end.
 *
 * BACKPRESSURE IS A DROP, NOT A QUEUE. Each payload waits for its ack, and a
 * grab that arrives while the previous is still in flight is discarded rather
 * than buffered. A queue here would grow without bound the moment the studio
 * fell behind, and stale frames are worth less to a reconstructor than recent
 * ones anyway — the honest thing is to send fewer, current frames and say how
 * many were dropped.
 */
export class LiveReconSession {
  private ws: WebSocket | null = null;
  private seq = 0;
  private frameId = 0;
  private inFlight: ((v: unknown) => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private canvas: HTMLCanvasElement | null = null;
  private readonly opts: Required<Omit<LiveReconOptions, "onState" | "rotationAt">> &
    Pick<LiveReconOptions, "onState" | "rotationAt">;

  private state: LiveReconState = {
    phase: "idle",
    sessionId: null,
    framesSent: 0,
    bytesSent: 0,
    dropped: 0,
    error: null,
  };

  constructor(opts: LiveReconOptions = {}) {
    this.opts = {
      url: opts.url ?? LIVE_CAPTURE_WS,
      deviceSessionId: opts.deviceSessionId ?? `spark-web-${Date.now().toString(36)}`,
      fps: opts.fps ?? 4,
      longSide: opts.longSide ?? 960,
      jpegQuality: opts.jpegQuality ?? 0.82,
      onState: opts.onState,
      rotationAt: opts.rotationAt,
    };
  }

  private publish(patch: Partial<LiveReconState>): void {
    this.state = { ...this.state, ...patch };
    this.opts.onState?.(this.state);
  }

  /** Connect, handshake, and open a session. Resolves with the session id. */
  async start(): Promise<string | null> {
    if (!canReachInsecureWs(this.opts.url)) {
      this.publish({
        phase: "failed",
        error:
          "This page is served over HTTPS, so it cannot open a plain ws:// connection to the studio. Open the laptop view on http://localhost instead.",
      });
      return null;
    }

    this.publish({ phase: "connecting", error: null });

    try {
      this.ws = await this.open(this.opts.url);
    } catch {
      this.publish({
        phase: "failed",
        error: "Could not reach the capture server. Is it running?",
      });
      return null;
    }

    // hello → hello_ack
    const ack = await this.exchange({
      type: "hello",
      protocol_version: PROTOCOL_VERSION,
      client_type: "iphone",
      device_session_id: this.opts.deviceSessionId,
      app_version: "spark-web-1.0",
    });
    if (!ack || (ack as { accepted?: boolean }).accepted !== true) {
      this.publish({ phase: "failed", error: "The capture server refused the handshake." });
      this.stop();
      return null;
    }

    // begin_session → session_ack
    const begun = (await this.exchange({
      type: "begin_session",
      protocol_version: PROTOCOL_VERSION,
      device_session_id: this.opts.deviceSessionId,
    })) as { session_id?: string } | null;

    const sessionId = begun?.session_id ?? null;
    if (!sessionId) {
      this.publish({ phase: "failed", error: "The capture server did not open a session." });
      this.stop();
      return null;
    }

    this.publish({ phase: "streaming", sessionId });
    return sessionId;
  }

  /** Begin pumping frames out of a playing <video>. */
  pump(video: HTMLVideoElement): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(
      () => void this.grab(video),
      Math.max(80, Math.round(1000 / this.opts.fps)),
    );
  }

  private async grab(video: HTMLVideoElement): Promise<void> {
    if (this.state.phase !== "streaming" || !video.videoWidth) return;
    if (this.busy) {
      this.publish({ dropped: this.state.dropped + 1 });
      return;
    }
    this.busy = true;
    try {
      const scale = this.opts.longSide / Math.max(video.videoWidth, video.videoHeight);
      const w = Math.round(video.videoWidth * Math.min(1, scale));
      const h = Math.round(video.videoHeight * Math.min(1, scale));

      const canvas = (this.canvas ??= document.createElement("canvas"));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, w, h);

      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, "image/jpeg", this.opts.jpegQuality),
      );
      if (!blob) return;
      const rgb = new Uint8Array(await blob.arrayBuffer());

      const id = this.frameId++;

      // Metadata FIRST, matching client.py's send_frame: a consumer tailing
      // metadata.jsonl must never see a frame announced before its pixels are
      // on the way.
      const meta = {
        format_version: 1,
        frame_id: id,
        timestamp: Date.now() / 1000,
        rgb_path: `frames/${id}.jpg`,
        image_width: w,
        image_height: h,
        camera_transform: transformFromRotation(this.opts.rotationAt?.() ?? null),
        camera_intrinsics: intrinsicsFor(w, h),
        tracking_state: "normal",
        // The honest part, and the part a studio has to read. See the header.
        pose_source: "browser-orientation",
        has_translation: false,
        depth_available: false,
      };

      await this.sendPayload(id, "frame_metadata", new TextEncoder().encode(JSON.stringify(meta)));
      await this.sendPayload(id, "rgb", rgb);

      this.publish({
        framesSent: this.state.framesSent + 1,
        bytesSent: this.state.bytesSent + rgb.byteLength,
      });
    } catch {
      // A dropped frame is not worth ending a session over — the next one is
      // 250 ms away and the socket's own close handler owns real failures.
    } finally {
      this.busy = false;
    }
  }

  private async sendPayload(
    frameId: number,
    payloadType: PayloadType,
    data: Uint8Array,
  ): Promise<void> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const header = {
      type: "bulk_header",
      protocol_version: PROTOCOL_VERSION,
      session_id: this.state.sessionId,
      frame_id: frameId,
      payload_type: payloadType,
      sequence: ++this.seq,
      byte_length: data.byteLength,
      sha256: await sha256Hex(data),
    };

    // The header and its binary frame must be adjacent on the wire — the
    // server pairs them by arrival, not by id.
    const acked = this.expect();
    ws.send(JSON.stringify(header));
    ws.send(data);
    await acked;
  }

  private open(url: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      const timer = setTimeout(() => reject(new Error("timeout")), 4000);

      ws.onopen = () => {
        clearTimeout(timer);
        resolve(ws);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("socket error"));
      };
      ws.onclose = () => {
        if (this.state.phase === "streaming") {
          this.publish({ phase: "failed", error: "The capture server closed the connection." });
        }
      };
      ws.onmessage = (e) => {
        const settle = this.inFlight;
        this.inFlight = null;
        if (!settle) return;
        try {
          settle(typeof e.data === "string" ? JSON.parse(e.data) : null);
        } catch {
          settle(null);
        }
      };
    });
  }

  /** One reply. The protocol is strictly request/response, so one is enough. */
  private expect(): Promise<unknown> {
    return new Promise((resolve) => {
      this.inFlight = resolve;
      // Never hang a pump on a server that stopped answering.
      setTimeout(() => {
        if (this.inFlight === resolve) {
          this.inFlight = null;
          resolve(null);
        }
      }, 5000);
    });
  }

  private async exchange(msg: object): Promise<unknown> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return null;
    const reply = this.expect();
    ws.send(JSON.stringify(msg));
    return reply;
  }

  /** End the session cleanly if we can, and let go either way. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;

    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN && this.state.sessionId) {
      try {
        ws.send(
          JSON.stringify({
            type: "end_session",
            protocol_version: PROTOCOL_VERSION,
            session_id: this.state.sessionId,
          }),
        );
      } catch {
        // Already gone. The server reconciles on its own timeout.
      }
    }
    ws?.close();
    this.ws = null;
    if (this.state.phase === "streaming") this.publish({ phase: "ended" });
  }

  get snapshot(): LiveReconState {
    return this.state;
  }
}
