import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 親ディレクトリ (developsecond/) に別プロジェクトの lockfile があるため、
// Next がワークスペースルートを親と誤推定し、Turbopack のファイルトレースが
// 巨大ツリーへ波及して OOM する。ルートをこの motion-editor に固定して防ぐ。
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: projectRoot,
  turbopack: {
    root: projectRoot,
  },
  webpack: (config) => {
    config.module.rules.push({
      test: /\.(glb|gltf)$/,
      type: "asset/resource",
    });
    return config;
  },
};

export default nextConfig;
