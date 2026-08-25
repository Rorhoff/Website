import type { NextConfig } from "next";

/** Production is always served at /ldbg — basePath is baked in at build time, not runtime. */
const basePath =
  process.env.LDBG_BASE_PATH !== undefined
    ? process.env.LDBG_BASE_PATH
    : process.env.NODE_ENV === "production"
      ? "/ldbg"
      : "";

const nextConfig: NextConfig = {
  basePath,
  serverExternalPackages: ["puppeteer"],
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  experimental: {
    // Orthophoto uploads use Route Handlers (req.formData()), not Server Actions.
    // This limit applies only if a Server Action is added later.
    serverActions: {
      bodySizeLimit: "200mb",
    },
    // Used when middleware is present; LDBG has no middleware.ts today.
    middlewareClientMaxBodySize: "200mb",
  },
};

export default nextConfig;
