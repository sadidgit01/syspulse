declare module "next-pwa" {
  import type { NextConfig } from "next";

  interface RuntimeCachingOptions {
    cacheName?: string;
    networkTimeoutSeconds?: number;
    expiration?: {
      maxEntries?: number;
      maxAgeSeconds?: number;
    };
  }

  interface RuntimeCachingRule {
    urlPattern: RegExp | string;
    handler: "NetworkFirst" | "CacheFirst" | "StaleWhileRevalidate" | "NetworkOnly" | "CacheOnly";
    options?: RuntimeCachingOptions;
  }

  interface PWAConfig {
    dest: string;
    disable?: boolean;
    register?: boolean;
    skipWaiting?: boolean;
    importScripts?: string[];
    runtimeCaching?: RuntimeCachingRule[];
  }

  export default function withPWAInit(config: PWAConfig): (nextConfig: NextConfig) => NextConfig;
}
