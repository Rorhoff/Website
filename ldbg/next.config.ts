import type { NextConfig } from "next";

const basePath = process.env.LDBG_BASE_PATH ?? "";

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
