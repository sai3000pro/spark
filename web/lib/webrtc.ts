/**
 * Phone → laptop live video, peer to peer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY WEBRTC AND NOT "JUST SEND FRAMES"
 *
 * The obvious alternative — MediaRecorder chunks POSTed every second, or JPEGs
 * over a socket — is much simpler and much worse. Chunked upload has 1–3 seconds
 * of latency, which is useless as a viewfinder: you cannot frame a shot against
 * a picture of three seconds ago. And every byte goes phone → server → laptop
 * even when the two devices are on the same Wi-Fi, two metres apart.
 *
 * WebRTC gets sub-200 ms on a LAN and sends the media DIRECTLY between the
 * devices. Only the negotiation touches a server, and that is a handful of small
 * JSON messages. It is also the one option that works identically on iOS Safari
 * (since iOS 11) and Android Chrome, which is the actual requirement.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THERE IS NO TURN SERVER, AND WHEN THAT MATTERS
 *
 * Both peers are on the same network, so ICE finds a route from HOST candidates
 * alone — the local IPs — with no relay involved. A STUN server is listed anyway
 * because it costs nothing and covers the case where the laptop is on Ethernet
 * and the phone on Wi-Fi behind the same router.
 *
 * What is NOT covered: phone on cellular, laptop behind a symmetric NAT. That
 * needs a TURN relay, which needs a server that pays for the bandwidth. The UI
 * says "same Wi-Fi" for this reason and it is a real constraint, not a nicety.
 */

/**
 * Google's public STUN. No account, no bandwidth cost — it only ever tells a
 * peer what its own public address looks like; media never passes through it.
 */
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

export type SignalRole = "phone" | "laptop";

export interface SignalMessage {
  seq: number;
  from: SignalRole;
  kind: "offer" | "answer" | "candidate";
  payload: unknown;
}

/**
 * Poll the relay for the other side's messages, applying each as it arrives.
 *
 * Returns a stop function. Polling at 700 ms: ICE completes in a second or two
 * on a LAN, and after that the loop finds nothing and costs one small request.
 */
export function pollSignals(
  handoffId: string,
  role: SignalRole,
  onMessage: (m: SignalMessage) => void | Promise<void>,
  intervalMs = 700,
): () => void {
  let cursor = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      const res = await fetch(
        `/api/capture/handoff/${handoffId}/signal?role=${role}&since=${cursor}`,
        { cache: "no-store" },
      );
      if (res.ok) {
        const body = (await res.json()) as { messages: SignalMessage[]; cursor: number };
        cursor = body.cursor;
        // Sequentially, not with Promise.all: an ICE candidate applied before
        // the remote description it belongs to throws, and the ordering the
        // relay preserves is the ordering that works.
        for (const m of body.messages) await onMessage(m);
      }
    } catch {
      // A dropped poll is normal on a phone changing networks. Keep going.
    }
    if (!stopped) timer = setTimeout(() => void tick(), intervalMs);
  };

  void tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

export interface SendSignalOptions {
  handoffId: string;
  role: SignalRole;
  /** Required for the phone; the laptop has none. See the signal route header. */
  token?: string;
  kind?: SignalMessage["kind"];
  payload?: unknown;
  /** Phone only: doubles as the liveness heartbeat. */
  streaming?: boolean;
}

export async function sendSignal(opts: SendSignalOptions): Promise<void> {
  await fetch(`/api/capture/handoff/${opts.handoffId}/signal`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts.token ? { "x-handoff-token": opts.token } : {}),
    },
    body: JSON.stringify({
      role: opts.role,
      kind: opts.kind,
      payload: opts.payload,
      streaming: opts.streaming,
    }),
  }).catch(() => {
    // Signalling is best-effort. A lost candidate just means ICE tries another.
  });
}

/**
 * Wire a peer connection to the relay: trickle its candidates out, and report
 * connection state. Shared by both ends so the two cannot drift apart.
 */
export function attachSignalling(
  pc: RTCPeerConnection,
  handoffId: string,
  role: SignalRole,
  token: string | undefined,
  onState: (state: RTCPeerConnectionState) => void,
): void {
  pc.onicecandidate = (e) => {
    // A null candidate means gathering finished — nothing to send.
    if (!e.candidate) return;
    void sendSignal({
      handoffId,
      role,
      token,
      kind: "candidate",
      payload: e.candidate.toJSON(),
    });
  };
  pc.onconnectionstatechange = () => onState(pc.connectionState);
}

/**
 * Apply an inbound message to a peer connection.
 *
 * Candidates that arrive before the remote description are buffered by the
 * caller-supplied `pending` array rather than dropped — on a fast LAN the other
 * side's candidates routinely beat its own answer through the relay, and
 * `addIceCandidate` throws if there is no remote description yet.
 */
export async function applySignal(
  pc: RTCPeerConnection,
  m: SignalMessage,
  pending: RTCIceCandidateInit[],
): Promise<{ answer?: RTCSessionDescriptionInit }> {
  if (m.kind === "offer") {
    await pc.setRemoteDescription(m.payload as RTCSessionDescriptionInit);
    await drain(pc, pending);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return { answer };
  }

  if (m.kind === "answer") {
    // Guard against a duplicate answer from a retried poll: setting a remote
    // answer twice puts the connection in an invalid state.
    if (pc.signalingState === "stable") return {};
    await pc.setRemoteDescription(m.payload as RTCSessionDescriptionInit);
    await drain(pc, pending);
    return {};
  }

  const candidate = m.payload as RTCIceCandidateInit;
  if (!pc.remoteDescription) {
    pending.push(candidate);
    return {};
  }
  try {
    await pc.addIceCandidate(candidate);
  } catch {
    // A candidate for a closed or renegotiated transport. Harmless.
  }
  return {};
}

async function drain(pc: RTCPeerConnection, pending: RTCIceCandidateInit[]): Promise<void> {
  while (pending.length) {
    const c = pending.shift()!;
    try {
      await pc.addIceCandidate(c);
    } catch {
      // Same as above — a stale candidate is not an error worth surfacing.
    }
  }
}

/**
 * Is WebRTC available here?
 *
 * Exposed as a `useSyncExternalStore` snapshot rather than a bare
 * `typeof RTCPeerConnection` check in a component, because that global does not
 * exist during SSR — so reading it at render time either mismatches on
 * hydration or forces a setState inside an effect. The server snapshot assumes
 * support (the overwhelmingly common case, so the first paint is right), and a
 * browser that genuinely lacks it corrects itself immediately after hydration.
 */
export function subscribeRtcSupport(): () => void {
  return () => {};
}

export function getRtcSupport(): boolean {
  return typeof RTCPeerConnection !== "undefined";
}

export function getServerRtcSupport(): boolean {
  return true;
}
