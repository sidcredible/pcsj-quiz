import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The service-account key and the answer keys must never be bundled for the
  // browser, so nothing here is exposed via `env`. Server code reads
  // process.env directly at request time.
  outputFileTracingIncludes: {
    "/api/**": ["./schema/**"],
  },
};

export default nextConfig;
