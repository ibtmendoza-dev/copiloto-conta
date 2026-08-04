import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.100.8'],
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

export default withSerwist(nextConfig);
