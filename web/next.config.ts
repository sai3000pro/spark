import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // The journal landing moved back to the root; keep old links alive.
      { source: "/landing-page", destination: "/", permanent: false },
    ];
  },
};

export default nextConfig;
