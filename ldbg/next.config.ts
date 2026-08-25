import type { NextConfig } from "next";

const basePath = process.env.LDBG_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  basePath,
  serverExternalPackages: ["puppeteer"],
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "200mb",
    },
    middlewareClientMaxBodySize: "200mb",
  },
};

export default nextConfig;
