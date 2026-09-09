import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const config: NextConfig = {
  transpilePackages: ["@windchime/embed"],
  serverExternalPackages: ["sqlite3"],
  output: "standalone",
  outputFileTracingRoot: root,
  turbopack: { root },
};
export default config;
