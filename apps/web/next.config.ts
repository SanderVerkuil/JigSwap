import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import path from "path";

const withNextIntl = createNextIntlPlugin({
  experimental: {
    createMessagesDeclaration: path.join(__dirname, "./locales/source.json"),
  },
});

// Next 16.2 fatally rejects a remotePattern with an undefined hostname, so only add the
// Convex storage host when its env var is actually set (e.g. absent in CI/local builds).
const remotePatterns: NonNullable<NextConfig["images"]>["remotePatterns"] = [
  {
    protocol: "https",
    hostname: "images.unsplash.com",
  },
];
if (process.env.CONVEX_STORAGE_URL) {
  remotePatterns.push({
    protocol: "https",
    hostname: process.env.CONVEX_STORAGE_URL,
  });
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns,
  },

  turbopack: {
    root: path.resolve(__dirname, "../.."),
    rules: {
      "*.svg": {
        loaders: ["@svgr/webpack"],
        as: "*.js",
      },
    },
  },

  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://eu-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://eu.i.posthog.com/:path*",
      },
      {
        source: "/ingest/decide",
        destination: "https://eu.i.posthog.com/decide",
      },
    ];
  },

  skipTrailingSlashRedirect: true,
};

export default withNextIntl(nextConfig);
