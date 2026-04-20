import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /** 1Panel / Docker 部署用精简镜像（见本目录 Dockerfile） */
  output: 'standalone',
  /** 避免与上级 WindChime 的 lockfile 混淆输出追踪根目录 */
  outputFileTracingRoot: path.join(__dirname),
  /** better-sqlite3 为原生模块，需从打包中排除，仅在 Node 运行时加载 */
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
