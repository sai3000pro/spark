import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

/**
 * Hosts allowed to load dev-server chunks.
 *
 * Next 16 blocks cross-origin requests for `/_next/*` in development by
 * default. The phone handoff needs a tunnel — `getUserMedia` requires a secure
 * context, and a LAN IP over plain HTTP is not one — so the page gets served
 * from a `*.trycloudflare.com` host while the dev server runs on localhost.
 *
 * Without this, the failure is quietly awful rather than loud: the HTML renders
 * fine (server components are unaffected), the API routes answer fine, and only
 * the JS chunks are refused. So the page LOOKS right, and every button on it is
 * dead, with the only evidence a warning in the dev server's own log. Worth
 * knowing before spending an hour on a React bug that is not one.
 *
 * `DEV_TUNNEL_HOST` covers ngrok or any other tunnel without another edit here.
 */

/**
 * This machine's own LAN addresses — the ones `next dev` prints as "Network".
 *
 * Scanning the QR from a phone on the same Wi-Fi lands on `http://<lan-ip>:3000`,
 * which is a different origin from `localhost` and was therefore refused every
 * chunk. That is the exact failure described above, and it cost an evening: the
 * phone sat on "Connecting to your laptop…" — the SERVER-rendered initial state
 * — because the bundle that would have replaced it never executed.
 *
 * Read from the interfaces rather than written down, because the one thing a
 * hardcoded `192.168.2.30` guarantees is a repeat of this the next time DHCP
 * hands out a different lease. Internal and non-IPv4 interfaces are skipped;
 * this runs in the Node process that is already about to bind them.
 *
 * Dev-only, like the setting it feeds. A production build ignores it.
 */
function lanAddresses(): string[] {
  const out: string[] = [];
  for (const iface of Object.values(networkInterfaces())) {
    for (const net of iface ?? []) {
      if (net.family === "IPv4" && !net.internal) out.push(net.address);
    }
  }
  return out;
}

const devOrigins = [
  "*.trycloudflare.com",
  ...lanAddresses(),
  ...(process.env.DEV_TUNNEL_HOST ? [process.env.DEV_TUNNEL_HOST] : []),
];

const nextConfig: NextConfig = {
  // Development-only setting; it has no effect on a production build.
  allowedDevOrigins: devOrigins,

  /**
   * Leave ffmpeg-static alone.
   *
   * It exports the path to a binary on disk, computed from its own `__dirname`.
   * Bundled, that `__dirname` is rewritten and the export becomes
   * `\ROOT\node_modules\ffmpeg-static\ffmpeg.exe` — a path that does not exist,
   * so every remux fails with ENOENT while the module still imports cleanly.
   * Externalising it keeps the real `__dirname`. See lib/video/remux.ts, which
   * also verifies the path rather than trusting it.
   */
  serverExternalPackages: ["ffmpeg-static"],

  /**
   * The other half of the fix in proxy.ts.
   *
   * `frame-ancestors 'none'` closes the route around it. proxy.ts refuses a
   * cross-origin fetch, but it cannot refuse a REAL click: a page that iframes
   * this app, makes the frame transparent and floats it under its own button
   * gets a genuine same-origin request, made by the user, with every header a
   * legitimate one would have. Every destructive control in this app is one
   * unconfirmed click — "Delete run" on the capture page, "Send to KIRI" on a
   * job — so an invisible frame is a working attack against exactly the actions
   * proxy.ts was written for.
   *
   * Nothing embeds this app. The studio's bigview and the live viewer are opened
   * with `window.open` into their own tabs, never framed — they have to be, since
   * bigview needs SharedArrayBuffer and its own COOP/COEP headers to get it.
   * So this costs nothing.
   *
   * `X-Frame-Options` is sent as well, and it is not redundant on purpose: it is
   * what a browser too old for `frame-ancestors` obeys, and the two never
   * disagree because both say no.
   *
   * WHAT IS DELIBERATELY NOT HERE: a full CSP with `script-src`. This app runs
   * WebGPU, Transformers.js and a wasm splat renderer, all of which need
   * `wasm-unsafe-eval` and some of which build workers from blobs — a policy
   * written without measuring which directives they actually need would either
   * be so loose it means nothing or would break the detector silently, in the
   * browser, where nothing in `npm run build` would catch it. It is worth doing
   * with a real browser to test against; it is not worth guessing at.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          // A response the browser is not allowed to re-interpret. An uploaded
          // .ply served under a guessed content type is the case that matters.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // A handoff URL carries a token in its fragment, which never leaves the
          // browser — but the path itself still names somebody's capture, and an
          // outbound click should not spend it on another origin.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },

  async redirects() {
    return [
      // The journal landing moved back to the root; keep old links alive.
      { source: "/landing-page", destination: "/", permanent: false },
    ];
  },
};

export default nextConfig;
