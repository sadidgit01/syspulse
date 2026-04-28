import type { NextConfig } from "next";
import withPWAInit from "next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
  importScripts: ["/sw-custom.js"],
  runtimeCaching: [
    {
      urlPattern: /^\/api\/.*$/i,
      handler: "NetworkFirst",
      options: {
        cacheName: "syspulse-api",
        networkTimeoutSeconds: 10,
        expiration: {
          maxEntries: 80,
          maxAgeSeconds: 60 * 5
        }
      }
    },
    {
      urlPattern: /\.(?:js|css|woff2?|png|jpg|jpeg|svg|ico)$/i,
      handler: "CacheFirst",
      options: {
        cacheName: "syspulse-static",
        expiration: {
          maxEntries: 160,
          maxAgeSeconds: 60 * 60 * 24 * 30
        }
      }
    }
  ]
});

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts"]
  }
};

export default withPWA(nextConfig);
