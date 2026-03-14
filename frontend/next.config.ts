import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone 빌드: Docker 프로덕션 이미지 최소화를 위한 설정
  // Dockerfile.prod에서 .next/standalone 결과물 복사에 필요
  output: "standalone",
};

export default nextConfig;
