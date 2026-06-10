import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.openfoodfacts.org",
      },
      {
        protocol: "https",
        hostname: "static.openfoodfacts.org",
      },
      {
        protocol: "https",
        hostname: "images.openbeautyfacts.org",
      },
    ],
  },
};

export default nextConfig;
