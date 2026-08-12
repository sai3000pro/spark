/**
 * Handing a capture off from the laptop to a phone.
 *
 * The laptop is where you plan a walk and where you look at it afterwards. The
 * phone is the only thing with a camera worth using. A QR code is the shortest
 * path between them that does not involve typing a URL with a thumb.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOT THE NATIVE APP
 *
 * ios/GauzensplatCapture exists and is good, but it cannot be delivered: it
 * needs Xcode to build, there is no TestFlight or fastlane config in the repo,
 * and there is no Android app at all. A QR pointing at it would work for
 * exactly one person — whoever holds the Mac it was installed from. So the
 * handoff targets a web page, which every phone already has.
 *
 * WHAT THE WEB PAGE GIVES UP, stated plainly: the native app records ARKit
 * `sceneDepth` (metric float32), a per-pixel confidence map, a tracked 6-DoF
 * camera pose and intrinsics. A browser can have NONE of those — there is no
 * web API for LiDAR, and iOS Safari does not implement WebXR at all. That is
 * why the recorder's coverage ring measures directions faced rather than
 * surfaces undersampled, and why it says so.
 *
 * WHAT IT GAINS: it runs on every phone, of every make, from a laptop of any
 * make, with nothing installed.
 *
 * Three capture paths, all reachable from this one handoff:
 *
 *   · live stream    phone → laptop over WebRTC, peer to peer over the Wi-Fi,
 *                    so the laptop is a viewfinder while you frame the shot.
 *   · guided record  in-page, with a duration budget, shake warnings and the
 *                    coverage ring. Needs HTTPS — see lib/net.ts.
 *   · camera app     `<input type="file" capture="environment">`, which opens
 *                    the phone's own camera. NOT gated on a secure context, so
 *                    it is the floor that always works, and it produces the
 *                    best image of the three.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TOKEN, AND WHY IT LIVES IN THE URL FRAGMENT
 *
 * A QR code is photographable over a shoulder, and this token authorises an
 * upload against the laptop user's account and eventually their reconstruction
 * credits. So it is:
 *
 *   · short-lived (10 minutes) — a QR left on a screen stops working;
 *   · single-use, bound to the first phone that claims it;
 *   · carried in the FRAGMENT (`/m/<id>#<token>`), which browsers do not send
 *     to the server. It therefore never appears in an access log, a Referer
 *     header, or an edge trace. The phone page reads it from `location.hash`
 *     and POSTs it once, deliberately, over the body.
 *
 * Only a hash is stored, for the same reason as invites: a dump of this store
 * must not be a pile of working upload credentials.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STORAGE
 *
 * globalThis singleton, matching lib/liveTrip.ts and lib/splatJobs.ts: survives
 * dev module reloads, does NOT survive a restart, single process only. Correct
 * for a 10-minute pairing token — the worst case is a QR that stops working
 * after a server restart, which is also true of the real thing when the token
 * expires. Moves to Postgres alongside the rest; see supabase/migrations.
 */
import { createHash, randomBytes } from "node:crypto";

export type HandoffState =
  /** QR is on screen; nothing has scanned it. */
  | "waiting"
  /** A phone opened the link and claimed the token. */
  | "paired"
  /** A live WebRTC stream is up, phone → laptop. */
  | "streaming"
  /** Bytes are moving. */
  | "uploading"
  /** The video landed. The laptop can take it from here. */
  | "received"
  /** Nothing claimed it in time, or it was used and closed. */
  | "expired";

/**
 * What the phone was sent here to do.
 *
 * The two paths share every byte of transport — claim, upload, storage, job —
 * and differ only in which control the phone is handed first. Carrying it on
 * the handoff rather than in the URL means the phone cannot land on the wrong
 * screen because a link was edited, and the laptop's copy can say what it is
 * offering before anyone scans.
 */
export type HandoffIntent =
  /** Record here and now, with coverage guidance. */
  | "record"
  /** Send a clip that already exists on the phone. */
  | "upload";

export interface Handoff {
  id: string;
  state: HandoffState;
  intent: HandoffIntent;
  createdAt: string;
  expiresAt: string;
  /** Which trip this capture belongs to, if one was already open. */
  tripId: string | null;
  /** Set once a phone claims it — a coarse label, not a fingerprint. */
  device: string | null;
  /** Progress, when the phone reports it. */
  upload: {
    name: string;
    bytes: number;
    receivedBytes: number;
  } | null;
  /** The reconstruction job opened once the video lands. */
  jobId: string | null;
  note: string;
}

/**
 * WebRTC signalling, carried on the handoff.
 *
 * The phone streams live to the laptop. That needs the two peers to exchange an
 * SDP offer/answer and a handful of ICE candidates — and nothing more, because
 * once they have each other's candidates the MEDIA goes directly phone → laptop
 * over the Wi-Fi. Only this negotiation touches a server.
 *
 * Polling rather than a socket. The whole exchange is a few small messages
 * inside a couple of seconds, a WebSocket would need its own lifecycle and
 * reconnect story, and this app already polls the handoff for state. `since`
 * makes each read incremental so a poll costs nothing once the connection is up.
 *
 * Each side only ever reads the OTHER's messages: a peer echoing its own
 * candidates back would try to connect to itself.
 */
export type SignalRole = "phone" | "laptop";

export interface SignalMessage {
  seq: number;
  from: SignalRole;
  kind: "offer" | "answer" | "candidate";
  /** RTCSessionDescriptionInit or RTCIceCandidateInit, opaque here. */
  payload: unknown;
}

const TTL_MS = 10 * 60 * 1000;

/** Beyond this something is looping; ICE for one connection is well under it. */
const MAX_SIGNALS = 200;

interface Stored extends Omit<Handoff, "state" | "note"> {
  tokenHash: string;
  claimedAt: string | null;
  receivedAt: string | null;
  signals: SignalMessage[];
  nextSeq: number;
  /** Bumped by the phone while a live stream is up, so the laptop can tell. */
  streamingAt: string | null;
}

const KEY = Symbol.for("spark.handoff.store");

interface Store {
  items: Map<string, Stored>;
}

function store(): Store {
  const g = globalThis as unknown as Record<symbol, Store | undefined>;
  return (g[KEY] ??= { items: new Map() });
}

const hash = (t: string): string => createHash("sha256").update(t).digest("hex");

/**
 * Derive, don't tick — the same discipline as getActiveTrip() and getSplatJob().
 * There is no timer expiring these; state is computed from timestamps at read
 * time, so a cold read an hour later is correct and nothing leaks.
 */
function stateOf(s: Stored): HandoffState {
  if (s.receivedAt) return "received";
  const expired = Date.parse(s.expiresAt) <= Date.now();
  if (s.upload && s.upload.receivedBytes > 0) return "uploading";
  // Derived from a heartbeat rather than a flag someone has to clear: a phone
  // that goes down a lift or gets locked never sends "I stopped", so a boolean
  // would stay true forever. Six seconds of silence ends the stream.
  if (s.streamingAt && Date.now() - Date.parse(s.streamingAt) < 6000) {
    return "streaming";
  }
  if (s.claimedAt) return expired ? "expired" : "paired";
  return expired ? "expired" : "waiting";
}

function view(s: Stored): Handoff {
  const state = stateOf(s);
  return {
    id: s.id,
    state,
    intent: s.intent,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    tripId: s.tripId,
    device: s.device,
    upload: s.upload,
    jobId: s.jobId,
    note: NOTES[state],
  };
}

const NOTES: Record<HandoffState, string> = {
  waiting: "Scan the code with your phone's camera.",
  paired: "Phone connected. Record when you're ready.",
  streaming: "Live from your phone.",
  uploading: "Receiving the video from your phone.",
  received: "Video received. Reconstruction can start.",
  expired: "This code expired. Generate a new one.",
};

/** The raw token is returned ONCE, here. It is never stored and never re-issued. */
export function createHandoff(
  input: { tripId?: string | null; intent?: HandoffIntent } = {},
): {
  handoff: Handoff;
  token: string;
} {
  const now = Date.now();
  const id = `ho_${now.toString(36)}${randomBytes(3).toString("hex")}`;
  // 32 bytes: this is a bearer credential, not an id.
  const token = randomBytes(32).toString("base64url");

  const stored: Stored = {
    id,
    intent: input.intent ?? "record",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TTL_MS).toISOString(),
    tripId: input.tripId ?? null,
    device: null,
    upload: null,
    jobId: null,
    tokenHash: hash(token),
    claimedAt: null,
    receivedAt: null,
    signals: [],
    nextSeq: 1,
    streamingAt: null,
  };

  const s = store();
  s.items.set(id, stored);
  sweep(s);
  return { handoff: view(stored), token };
}

export function getHandoff(id: string): Handoff | null {
  const s = store().items.get(id);
  return s ? view(s) : null;
}

export type ClaimResult =
  | { ok: true; handoff: Handoff }
  | { ok: false; reason: "not-found" | "expired" | "bad-token" | "already-claimed" };

/**
 * Bind this handoff to the phone that presented the token.
 *
 * Single-use: a second claim is refused even with the correct token, so a QR
 * photographed by two people does not give both of them an upload slot. Timing-
 * safe comparison is not needed — we compare hashes of a 32-byte random value,
 * where a timing oracle buys nothing.
 */
export function claimHandoff(id: string, token: string, device?: string): ClaimResult {
  const s = store().items.get(id);
  if (!s) return { ok: false, reason: "not-found" };
  if (stateOf(s) === "expired") return { ok: false, reason: "expired" };
  if (s.tokenHash !== hash(token)) return { ok: false, reason: "bad-token" };
  if (s.claimedAt) return { ok: false, reason: "already-claimed" };

  s.claimedAt = new Date().toISOString();
  s.device = device?.slice(0, 60) ?? "a phone";
  return { ok: true, handoff: view(s) };
}

/** Re-check on every subsequent request from the phone. */
export function verifyClaim(id: string, token: string): boolean {
  const s = store().items.get(id);
  if (!s || !s.claimedAt) return false;
  if (stateOf(s) === "expired") return false;
  return s.tokenHash === hash(token);
}

export function noteUploadStarted(id: string, name: string, bytes: number): void {
  const s = store().items.get(id);
  if (!s) return;
  s.upload = { name, bytes, receivedBytes: 0 };
}

export function noteUploadFinished(id: string, receivedBytes: number, jobId: string): void {
  const s = store().items.get(id);
  if (!s) return;
  if (s.upload) s.upload.receivedBytes = receivedBytes;
  s.jobId = jobId;
  s.receivedAt = new Date().toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// WebRTC signalling
// ─────────────────────────────────────────────────────────────────────────────

/** Post one message. Returns its seq, or null if the handoff is gone/expired. */
export function pushSignal(
  id: string,
  from: SignalRole,
  kind: SignalMessage["kind"],
  payload: unknown,
): number | null {
  const s = store().items.get(id);
  if (!s || stateOf(s) === "expired") return null;

  const seq = s.nextSeq++;
  s.signals.push({ seq, from, kind, payload });
  // Drop the oldest rather than refusing new ones: a renegotiation mid-session
  // is legitimate, and the only messages that matter are the recent ones.
  if (s.signals.length > MAX_SIGNALS) {
    s.signals.splice(0, s.signals.length - MAX_SIGNALS);
  }
  return seq;
}

/** Everything the OTHER side has said since `after`. */
export function readSignals(
  id: string,
  forRole: SignalRole,
  after: number,
): { messages: SignalMessage[]; cursor: number } | null {
  const s = store().items.get(id);
  if (!s) return null;
  const messages = s.signals.filter((m) => m.from !== forRole && m.seq > after);
  return {
    messages,
    // The cursor advances past everything present, not just what was returned —
    // otherwise our own messages are re-scanned on every poll forever.
    cursor: s.signals.length ? s.signals[s.signals.length - 1].seq : after,
  };
}

/** Phone-side heartbeat while a stream is live. See stateOf(). */
export function noteStreaming(id: string): void {
  const s = store().items.get(id);
  if (!s) return;
  s.streamingAt = new Date().toISOString();
}

/** Bounded, so a long-running dev server does not accumulate dead pairings. */
function sweep(s: Store): void {
  const cutoff = Date.now() - TTL_MS * 6;
  for (const [id, item] of s.items) {
    if (Date.parse(item.createdAt) < cutoff) s.items.delete(id);
  }
}

export function __resetHandoffs(): void {
  store().items.clear();
}
