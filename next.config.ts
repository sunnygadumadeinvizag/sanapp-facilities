import path from "node:path";
import type { NextConfig } from "next";

// Monorepo root: sanapp-common-ui lives outside this project directory.
const MONOREPO_ROOT = path.join(__dirname, "..");

const nextConfig: NextConfig = {
  // sanapp-common-ui ships TypeScript source; ask Next to compile it.
  transpilePackages: ["sanapp-common-ui"],
  // Resolve linked packages (sanapp-common-ui) outside the project root.
  turbopack: {
    root: MONOREPO_ROOT,
  },
  outputFileTracingRoot: MONOREPO_ROOT,
  // Next 16 blocks cross-origin dev chunks/HMR; allow the local proxy host
  // (local-proxy.js serves the apps at http://localintranet.iipe.ac.in/*).
  allowedDevOrigins: ["localintranet.iipe.ac.in"],
  // In production behind Apache this app is served at https://intranet.iipe.ac.in/app1
  basePath: process.env.BASE_PATH || "",
  // Expose the basePath to the proxy (middleware) so it can strip the prefix.
  env: {
    NEXT_PUBLIC_BASE_PATH: process.env.BASE_PATH || "",
  },
};

export default nextConfig;
