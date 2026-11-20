import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // KB markdown is read with fs at runtime (local fallback + seeding); ship it with the function.
  outputFileTracingIncludes: { "/api/agent": ["./data/**/*"] },
};

export default nextConfig;
