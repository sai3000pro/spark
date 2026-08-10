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
const devOrigins = [
  "*.trycloudflare.com",
  ...(process.env.DEV_TUNNEL_HOST ? [process.env.DEV_TUNNEL_HOST] : []),
];

const nextConfig: NextConfig = {
  // Development-only setting; it has no effect on a production build.
  allowedDevOrigins: devOrigins,

  async redirects() {
    return [
      // The journal landing moved back to the root; keep old links alive.
      { source: "/landing-page", destination: "/", permanent: false },
    ];
  },
};

export default nextConfig;
