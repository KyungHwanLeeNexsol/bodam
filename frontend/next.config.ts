import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone 빌드: Docker 환경(Dockerfile.prod)에서만 활성화
  // Vercel 배포 시에는 undefined (Vercel이 자체 최적화 적용)
  ...(process.env.BUILD_STANDALONE === "true" ? { output: "standalone" } : {}),
};

export default nextConfig;
