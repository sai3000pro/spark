/**
 * Working out the address a phone can actually reach.
 *
 * The QR code cannot encode `localhost` — that resolves to the phone itself, and
 * the failure is confusing rather than obvious: the camera opens a browser, the
 * browser says it cannot connect, and nothing anywhere mentions that the address
 * was never going to work.
 *
 * It also cannot reliably use the request's Host header. In development that is
 * `localhost:3000` whenever the laptop is looking at its own page, which is
 * exactly when the QR is generated.
 *
 * So in development we resolve the LAN interface directly. In production the
 * public origin is correct and this is not used at all.
 */
import "server-only";

import { networkInterfaces } from "node:os";

/**
 * Interfaces that are never the answer.
 *
 * Docker and WSL both create host-side adapters with perfectly ordinary private
 * addresses, and on a Windows machine running Docker Desktop — which this one is
 * — picking one produces a QR that resolves to a bridge no phone can route to.
 * The name check is the only cheap way to tell them apart; the address ranges
 * are identical to a real LAN's.
 */
const EXCLUDED = /^(docker|br-|veth|vEthernet|WSL|Loopback|utun|tun|tap|Hyper-V)/i;

/** RFC1918 only. A public address here means something is misconfigured. */
function isPrivateV4(addr: string): boolean {
  const p = addr.split(".").map(Number);
  if (p.length !== 4 || p.some(Number.isNaN)) return false;
  if (p[0] === 10) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  return false;
}

/**
 * Best guess at this machine's LAN IPv4, or null.
 *
 * Returning null rather than falling back to localhost is deliberate: a QR that
 * cannot work should not be rendered at all, and the UI should say why. A code
 * that silently encodes an unreachable address wastes the one thing this feature
 * is meant to save — the moment where someone picks up their phone.
 */
export function lanAddress(): string | null {
  const candidates: string[] = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (!addrs || EXCLUDED.test(name)) continue;
    for (const a of addrs) {
      // Node <18 reports `family` as the string "IPv4"; newer reports 4.
      const isV4 = a.family === "IPv4" || (a.family as unknown as number) === 4;
      if (!isV4 || a.internal) continue;
      if (isPrivateV4(a.address)) candidates.push(a.address);
    }
  }
  if (!candidates.length) return null;
  // Prefer 192.168.x.x — the overwhelmingly common home/office range, and the
  // one least likely to be a VPN or a virtual adapter that slipped the filter.
  return candidates.find((a) => a.startsWith("192.168.")) ?? candidates[0];
}

/**
 * The origin this request arrived on, but only if it was genuinely secure.
 *
 * A tunnel terminates TLS at the edge and forwards plain HTTP to us, so the
 * proof that the browser had a secure context is `x-forwarded-proto`, not the
 * socket. Both that header and Host are attacker-controllable in general — but
 * the only thing they influence here is which URL gets drawn into a QR code on
 * the laptop's own screen, for its own user to scan. Forging them lets someone
 * put a different address in their own QR code, which is not an attack.
 *
 * `localhost` is deliberately rejected even though browsers treat it as a
 * secure context: the phone is a different device, and localhost there is the
 * phone. That is the single most confusing way this can fail.
 */
function secureForwardedOrigin(h?: Headers | null): string | null {
  if (!h) return null;
  const proto = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
  if (proto !== "https" || !host) return null;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/i.test(host)) return null;
  return `https://${host}`;
}

export interface PhoneOrigin {
  origin: string | null;
  /** Why there is no origin, for the UI to show instead of a broken code. */
  problem: string | null;
  /** True when this is a plain-HTTP LAN address, which limits what the page can do. */
  insecure: boolean;
}

/**
 * The origin to put in the QR.
 *
 * `NEXT_PUBLIC_SITE_URL` wins when set — that is the deployed case, and it is
 * both reachable and HTTPS. Otherwise fall back to the LAN address, and flag it
 * as insecure so the phone page knows to offer only the capture paths that work
 * without a secure context.
 */
export function phoneOrigin(headers?: Headers | null, devPort = 3000): PhoneOrigin {
  // 1 · However this request actually arrived, if that was over real HTTPS.
  //
  // This is what makes a tunnel (cloudflared, ngrok) or any deployment work with
  // no configuration: the phone needs a secure context for getUserMedia, and the
  // origin the laptop is *already* being served on is by definition reachable.
  // Checked first because it is the only source that is verified rather than
  // declared — an env var can be stale, a LAN address can be the wrong adapter.
  const forwarded = secureForwardedOrigin(headers);
  if (forwarded) return { origin: forwarded, problem: null, insecure: false };

  // 2 · Explicitly configured. The deployed case.
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (configured) {
    return {
      origin: configured,
      problem: null,
      insecure: configured.startsWith("http://"),
    };
  }

  // 3 · The LAN. Works, but plain HTTP, so the in-page recorder is unavailable.
  const lan = lanAddress();
  if (!lan) {
    return {
      origin: null,
      problem:
        "No LAN address found. Connect this machine to Wi-Fi, or set NEXT_PUBLIC_SITE_URL to a reachable origin.",
      insecure: false,
    };
  }

  return { origin: `http://${lan}:${devPort}`, problem: null, insecure: true };
}

/**
 * What the phone can do at this origin.
 *
 * `getUserMedia` requires a secure context, so the in-page guided recorder is
 * unavailable over LAN HTTP. A file input carrying `capture="environment"` is
 * NOT gated that way — it opens the phone's own camera app and works fine. That
 * asymmetry is what makes the whole flow testable on a dev machine with no
 * tunnel and no certificate.
 */
export function captureCapabilities(insecure: boolean): {
  cameraApp: boolean;
  inPageRecorder: boolean;
  note: string;
} {
  return insecure
    ? {
        cameraApp: true,
        inPageRecorder: false,
        note: "Served over plain HTTP on your network, so in-page recording is unavailable — browsers only grant camera access on HTTPS. Recording through your phone's camera app works normally.",
      }
    : { cameraApp: true, inPageRecorder: true, note: "" };
}
