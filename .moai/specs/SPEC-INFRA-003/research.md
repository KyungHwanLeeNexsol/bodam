# SPEC-INFRA-003: 기술 분석 (Research)

## 1. 현재 docker-compose.yml 분석

### 현재 서비스 구성

```
services:
  postgres    - pgvector/pgvector:pg18, 포트 5432 노출, 하드코딩된 비밀번호
  redis       - redis:7-alpine, 포트 6379 노출, 비밀번호 없음
  backend     - ./backend/Dockerfile, 포트 8000 노출, 소스 코드 바인드 마운트, --reload 모드
  frontend    - ./frontend/Dockerfile, 포트 3000 노출, 소스 코드 바인드 마운트, pnpm dev 모드
  (monitoring profile) - prometheus, grafana, loki, promtail, alertmanager, postgres-exporter, redis-exporter
```

### 프로덕션에서 변경이 필요한 사항

| 현재 (개발) | 변경 (프로덕션) | 이유 |
|-------------|---------------|------|
| 모든 서비스 포트 외부 노출 | Nginx만 80/443 노출 | 보안 |
| `restart` 정책 없음 | `restart: always` | 자동 복구 |
| 소스 코드 바인드 마운트 | 바인드 마운트 제거 | 코드는 이미지에 포함 |
| `--reload` 플래그 | `--workers 2` (프로덕션) | 성능 + 안정성 |
| `pnpm dev` | `node server.js` (standalone) | 프로덕션 최적화 |
| 하드코딩된 DB 비밀번호 | `.env.prod`에서 관리 | 보안 |
| Redis 비밀번호 없음 | `requirepass` 설정 | 보안 |
| 리소스 제한 없음 | CPU/메모리 제한 | 리소스 관리 |
| Nginx 없음 | Nginx 리버스 프록시 + SSL | HTTPS + 라우팅 |

---

## 2. 현재 Dockerfile 분석

### backend/Dockerfile

```dockerfile
FROM python:3.13-slim
WORKDIR /app
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY . .
EXPOSE 8000
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**프로덕션 변경 사항:**
- 멀티스테이지 빌드로 이미지 크기 최소화
- 비root 사용자로 실행 (`--user appuser`)
- `--workers 2` 추가 (OCPU 수에 맞춤)
- `--reload` 명시적으로 제외 확인 (현재도 없지만 docker-compose.yml에서 override)
- 현재 docker-compose.yml의 command 오버라이드 (`--reload`)를 프로덕션에서 제거

**주의**: 현재 `docker-compose.yml`에서 backend의 command를 `uv run uvicorn ... --reload`로 오버라이드하고 있음. 프로덕션 compose에서는 이 오버라이드를 제거하거나 프로덕션 명령어로 대체해야 함.

### frontend/Dockerfile

```dockerfile
FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
EXPOSE 3000
CMD ["pnpm", "dev"]
```

**프로덕션 변경 사항:**
- 멀티스테이지 빌드 (의존성 -> 빌드 -> 런타임)
- `next.config.js`에 `output: 'standalone'` 설정 필요
- `pnpm build` 후 `node .next/standalone/server.js`로 실행
- 정적 파일은 `.next/static`과 `public`에서 Nginx로 직접 서빙 가능 (선택)
- 비root 사용자로 실행
- 최종 이미지에는 `node_modules` 불필요 (standalone 모드)

---

## 3. ARM64 호환성 분석

### Docker 이미지 ARM64 지원 현황

| 이미지 | ARM64 지원 | 근거 |
|--------|-----------|------|
| `pgvector/pgvector:pg18` | 높은 확률 지원 | pgvector GitHub에서 multi-arch 빌드 진행 중. pg17까지 확인됨, pg18도 동일 패턴 예상 |
| `python:3.13-slim` | 공식 지원 | Docker Hub 공식 이미지, `linux/arm64` manifest 존재 |
| `node:22-alpine` | 공식 지원 | Docker Hub 공식 이미지, `linux/arm64` manifest 존재 |
| `redis:7-alpine` | 공식 지원 | Docker Hub 공식 이미지, `linux/arm64` manifest 존재 |
| `nginx:alpine` | 공식 지원 | Docker Hub 공식 이미지, `linux/arm64` manifest 존재 |
| `prom/prometheus:v2.53.0` | 공식 지원 | Prometheus 공식 ARM64 빌드 제공 |
| `grafana/grafana:11.0.0` | 공식 지원 | Grafana 공식 ARM64 빌드 제공 |
| `grafana/loki:3.0.0` | 공식 지원 | Loki 공식 ARM64 빌드 제공 |

### pgvector ARM64 미지원 시 대안

pgvector가 pg18에서 ARM64를 지원하지 않을 경우, 커스텀 Dockerfile로 빌드:

```dockerfile
FROM postgres:18
RUN apt-get update && apt-get install -y \
    build-essential \
    git \
    postgresql-server-dev-18 \
  && git clone --branch v0.8.0 https://github.com/pgvector/pgvector.git \
  && cd pgvector \
  && make \
  && make install \
  && cd .. && rm -rf pgvector \
  && apt-get remove -y build-essential git postgresql-server-dev-18 \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*
```

### uv (Python 패키지 매니저) ARM64 지원

- `ghcr.io/astral-sh/uv:latest`는 multi-arch 지원
- ARM64에서 정상 동작 확인됨 (Rust 기반, 크로스 컴파일 제공)

### Playwright ARM64 제한

- Playwright는 ARM64 Linux에서 Chromium 지원이 제한적
- 그러나 프로덕션 배포 환경에서는 Playwright(크롤러)를 실행할 필요 없음
- 크롤러는 별도 x86 환경이나 GitHub Actions에서 실행 가능
- Dockerfile.prod에서 Playwright 의존성 제외 고려

---

## 4. OCI Always Free 리소스 상세 분석

### 컴퓨팅 리소스 (ARM Ampere A1)

- **4 OCPU**: ARM 코어 4개, x86 대비 비용효율 3배
- **24GB RAM**: PostgreSQL (pgvector HNSW 인덱스) + FastAPI + Next.js 운영에 충분
- **네트워크**: VCN 내부 통신 무료, 외부 트래픽 10TB/월
- **만료 없음**: Always Free는 계정 유지 시 영구 무료

### 스토리지

- **부트 볼륨**: 최소 47GB (Ubuntu 22.04 기본)
- **추가 Block Volume**: Always Free 200GB 한도 내에서 추가 가능
- **권장 구성**: 부트 50GB + 데이터 150GB

### 네트워크

- **Load Balancer**: 1x 10Mbps Flexible LB (선택적, 단일 VM에서는 불필요)
- **VCN**: 2개 VCN, 각 6개 서브넷
- **Public IP**: Reserved Public IP 1개 (무료)
- **DNS**: OCI DNS 무료 (또는 외부 DNS 사용)

### 제한 사항

- ARM A1 인스턴스는 리전별 가용성에 따라 프로비저닝 실패 가능
- `ap-seoul-1` 리전에서 ARM A1 수요가 높을 수 있음
- 대안: `ap-osaka-1` (일본) 또는 `ap-chuncheon-1` (춘천, 있는 경우)

---

## 5. 비용 비교: OCI vs AWS

| 항목 | OCI Always Free | AWS (기존 tech.md 계획) |
|------|----------------|----------------------|
| 서버 | ARM A1 4 OCPU 24GB (무료) | EC2 t3.medium ($33/월) |
| 데이터베이스 | Docker PostgreSQL (무료) | RDS PostgreSQL ($30-80/월) |
| 스토리지 | 200GB Block (무료) | EBS + S3 ($10-30/월) |
| 로드밸런서 | 10Mbps LB (무료) | ALB ($22/월) |
| SSL 인증서 | Let's Encrypt (무료) | ACM (무료, ALB 필요) |
| **월 비용** | **$0** | **$95-165/월** |

**결론**: OCI Always Free를 사용하면 서버 인프라 비용을 $0으로 줄이고, LLM API 비용 ($5-45/월)만 지불하면 된다.

---

## 6. 기존 SPEC과의 연관 분석

### SPEC-INFRA-002 (프로덕션 인프라 운영) 재활용

- **헬스체크 엔드포인트**: `/health`, `/health/ready`, `/health/live` - 그대로 사용
- **Graceful shutdown**: 30초 grace period - docker-compose.prod.yml의 `stop_grace_period`로 설정
- **구조화된 로깅**: structlog JSON 로깅 - 그대로 사용
- **자동 백업**: pg_dump 30일 롤링 - `deploy/scripts/backup.sh`로 이전

### SPEC-SEC-001 (보안 강화) 재활용

- **Rate Limiting**: Redis 기반 IP별/인증별 제한 - 프로덕션에서도 동일 동작
- **보안 헤더**: HSTS, CSP 등 - Nginx에서도 추가 설정 (이중 보안)
- **로그 마스킹**: 이메일, JWT 마스킹 - 그대로 사용
- **PIPA 컴플라이언스**: 개인정보 자동 삭제 - 그대로 사용

### SPEC-OPS-001 (프로덕션 모니터링) 연동

- `docker-compose.prod.yml`에 `profiles: ["monitoring"]` 프로파일 추가
- 기존 Prometheus, Grafana, Loki, Promtail, AlertManager 설정 재활용
- `docker compose --profile monitoring -f docker-compose.prod.yml up` 으로 선택적 실행

---

## 7. Next.js Standalone 모드 분석

### next.config.js 변경 필요

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // ... 기존 설정
}
```

### Standalone 모드 장점

- **이미지 크기**: ~200MB (전체 node_modules 대비 80% 감소)
- **실행 방식**: `node .next/standalone/server.js` (pnpm 불필요)
- **의존성**: standalone 디렉토리에 필요한 의존성만 포함
- **정적 파일**: `.next/static`과 `public`은 별도 복사 필요

### 주의 사항

- `NEXT_PUBLIC_*` 환경 변수는 빌드 시점에 주입됨 (런타임 변경 불가)
- 빌드 단계에서 `.env.prod`의 `NEXT_PUBLIC_*` 변수가 필요
- API URL 등 런타임 변경이 필요하면 서버 사이드 환경 변수 사용 권장

---

## 8. 배포 파이프라인 흐름

```
개발자 -> git push main
  |
  v
GitHub Actions 트리거
  |
  v
SSH로 OCI VM 접속
  |
  v
git pull origin main
  |
  v
.env.prod 업데이트 (Secrets에서)
  |
  v
docker compose -f docker-compose.prod.yml build
  |
  v
docker compose -f docker-compose.prod.yml up -d
  |
  v
헬스체크 (최대 60초 대기)
  |
  +-- 성공 -> 배포 완료 알림
  |
  +-- 실패 -> rollback.sh 실행 -> 알림
```

### 장점

- 단순한 아키텍처 (SSH + Docker Compose)
- 별도 CI/CD 인프라 불필요
- GitHub Actions 무료 (퍼블릭 리포) 또는 저비용 (프라이빗)
- 롤백이 빠름 (이전 이미지 캐시)

### 단점 및 향후 개선

- 단일 VM으로 무중단 배포 불가 (30-60초 다운타임)
- 향후 Docker Registry (GHCR) 활용으로 빌드/배포 분리 가능
- 향후 블루-그린 배포 패턴으로 무중단 배포 가능 (VM 추가 시)
