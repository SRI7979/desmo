import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  outputFileTracingIncludes: {
    "/api/solve": [
      "./src/content/desmos-tricks.md",
      "./src/content/training-batches/*.json",
    ],
  },
};

export default nextConfig;
