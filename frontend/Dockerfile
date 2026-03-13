FROM node:22-alpine
# pnpm 패키지 매니저 활성화
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
# 의존성 파일 먼저 복사 (레이어 캐싱 최적화)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
# 애플리케이션 코드 복사
COPY . .
EXPOSE 3000
CMD ["pnpm", "dev"]
