# SPEC-INFRA-003: OCI Always Free 프로덕션 배포 시스템

## 메타데이터

| 항목 | 값 |
|------|-----|
| **SPEC ID** | SPEC-INFRA-003 |
| **제목** | Oracle Cloud Infrastructure Always Free 프로덕션 배포 |
| **상태** | Planned |
| **우선순위** | High |
| **생성일** | 2026-03-14 |
| **관련 SPEC** | SPEC-INFRA-002 (프로덕션 인프라 운영), SPEC-OPS-001 (모니터링), SPEC-SEC-001 (보안) |
| **라이프사이클** | spec-anchored |

---

## 1. Environment (환경)

### 1.1 배포 대상 인프라

| 리소스 | 사양 | 비고 |
|--------|------|------|
| **VM 인스턴스** | ARM Ampere A1, 4 OCPU, 24GB RAM | Always Free, 만료 없음 |
| **Block Storage** | 200GB | 부트 볼륨 + 데이터 볼륨 |
| **Load Balancer** | 1x 10Mbps Flexible LB | Always Free |
| **VCN** | 1x Virtual Cloud Network | 퍼블릭/프라이빗 서브넷 |
| **OS** | Ubuntu 22.04 LTS (aarch64) | ARM64 아키텍처 |
| **리전** | ap-seoul-1 (한국) | 데이터 레지던시 준수 |

### 1.2 현재 시스템 구성

- **Backend**: FastAPI + SQLAlchemy async + PostgreSQL 18 (pgvector) + Redis
- **Frontend**: Next.js 16 + TypeScript
- **로컬 실행**: Docker Compose (`docker-compose.yml`)
- **모니터링**: Prometheus + Grafana + Loki (선택적 프로파일)
- **보안**: Rate Limiting, 보안 헤더, PIPA 컴플라이언스 구현 완료

### 1.3 ARM64 호환성 고려사항

- `pgvector/pgvector:pg18` 이미지: ARM64 multi-arch 지원 확인 필요
- `python:3.13-slim`: ARM64 공식 지원
- `node:22-alpine`: ARM64 공식 지원
- `redis:7-alpine`: ARM64 공식 지원
- Playwright: ARM64에서 Chromium headless 제한적 지원 (배포 환경에서는 불필요)

---

## 2. Assumptions (가정)

### 2.1 인프라 가정

- **AS-001**: OCI Always Free 계정이 생성되어 있고, ARM A1 인스턴스를 프로비저닝할 수 있다
- **AS-002**: `ap-seoul-1` 리전에서 Always Free ARM A1 리소스가 가용하다
- **AS-003**: 도메인이 구매되어 있으며 DNS A 레코드를 OCI 인스턴스 퍼블릭 IP로 설정할 수 있다
- **AS-004**: Let's Encrypt SSL 인증서를 HTTP-01 챌린지로 발급받을 수 있다

### 2.2 시스템 가정

- **AS-005**: 모든 Docker 이미지는 ARM64 (aarch64) 아키텍처를 지원한다
- **AS-006**: 4 OCPU + 24GB RAM은 초기 서비스 운영에 충분하다
- **AS-007**: 200GB Block Storage는 PostgreSQL 데이터, Docker 이미지, 로그 저장에 충분하다
- **AS-008**: 10Mbps Load Balancer 대역폭은 초기 트래픽을 처리하기에 충분하다

### 2.3 운영 가정

- **AS-009**: GitHub Actions에서 SSH를 통해 OCI VM에 접근할 수 있다
- **AS-010**: 기존 SPEC-INFRA-002의 헬스체크, 백업, 로깅 기능이 프로덕션 환경에서 동작한다

---

## 3. Requirements (요구사항)

### 3.1 CI/CD 자동 배포

**REQ-INFRA-001** [Event-Driven]
> **WHEN** `main` 브랜치에 push가 발생하면, **THE SYSTEM SHALL** GitHub Actions를 통해 OCI VM에 자동 배포를 수행한다.

- GitHub Actions 워크플로우가 SSH를 통해 OCI VM에 접속
- `git pull` 로 최신 코드 가져오기
- `docker compose -f docker-compose.prod.yml up --build -d` 실행
- 배포 후 헬스체크 검증

**REQ-INFRA-002** [Event-Driven]
> **WHEN** 배포 중 헬스체크가 실패하면, **THE SYSTEM SHALL** 이전 버전으로 자동 롤백한다.

- 배포 전 현재 이미지 태그 저장
- 헬스체크 실패 시 이전 이미지로 복원
- 롤백 결과를 GitHub Actions 로그에 기록

### 3.2 HTTPS 및 SSL

**REQ-INFRA-003** [Ubiquitous]
> **THE SYSTEM SHALL** 유효한 SSL 인증서를 사용하여 HTTPS를 제공한다.

- Let's Encrypt Certbot을 통한 자동 SSL 발급
- 인증서 자동 갱신 (cron 또는 systemd timer)
- HTTP -> HTTPS 자동 리다이렉트

**REQ-INFRA-004** [Ubiquitous]
> **THE SYSTEM SHALL** 보안 HTTP 헤더를 모든 응답에 포함한다.

- HSTS (Strict-Transport-Security)
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- Content-Security-Policy
- Referrer-Policy: strict-origin-when-cross-origin

### 3.3 서비스 안정성

**REQ-INFRA-005** [Ubiquitous]
> **THE SYSTEM SHALL** 서버 재부팅 시 모든 서비스를 자동으로 재시작한다.

- Docker Compose 서비스에 `restart: always` 설정
- Docker 데몬 systemd 자동 시작 설정

**REQ-INFRA-006** [Event-Driven]
> **WHEN** 컨테이너가 비정상 종료되면, **THE SYSTEM SHALL** 해당 컨테이너를 자동으로 재시작한다.

- `restart: always` 정책으로 자동 복구
- healthcheck 기반 비정상 감지

**REQ-INFRA-007** [Unwanted]
> **THE SYSTEM SHALL NOT** 프로덕션 환경에서 디버그 모드나 개발 서버를 실행한다.

- FastAPI: `--reload` 플래그 제거
- Next.js: `pnpm build && pnpm start` (프로덕션 빌드)
- 환경 변수 `DEBUG=false`

### 3.4 리버스 프록시

**REQ-INFRA-008** [Ubiquitous]
> **THE SYSTEM SHALL** `/api/*` 요청을 FastAPI 백엔드(포트 8000)로 프록시한다.

- Nginx 리버스 프록시 설정
- WebSocket 지원 (향후 스트리밍 응답용)
- 프록시 헤더 전달 (X-Real-IP, X-Forwarded-For, X-Forwarded-Proto)

**REQ-INFRA-009** [Ubiquitous]
> **THE SYSTEM SHALL** 루트 경로(`/`) 요청을 Next.js 프론트엔드(포트 3000)로 프록시한다.

- 정적 파일 캐싱
- gzip 압축 활성화

### 3.5 네트워크 보안

**REQ-INFRA-010** [Ubiquitous]
> **THE SYSTEM SHALL** 외부에서 포트 80(HTTP), 443(HTTPS), 22(SSH)만 접근을 허용한다.

- OCI Security List에서 인바운드 규칙 설정
- PostgreSQL(5432), Redis(6379) 포트 외부 노출 차단
- Docker 내부 네트워크로 서비스 간 통신

**REQ-INFRA-011** [State-Driven]
> **IF** SSH 접근이 시도되면, **THEN** 키 기반 인증만 허용하고 비밀번호 인증을 거부한다.

- `PasswordAuthentication no` 설정
- SSH 키 기반 인증 필수

### 3.6 환경 변수 관리

**REQ-INFRA-012** [Ubiquitous]
> **THE SYSTEM SHALL** 모든 시크릿을 환경 변수 파일(`.env.prod`)에서 관리한다.

- `.env.prod.example` 템플릿 제공
- Git에 `.env.prod` 포함 금지 (`.gitignore`)
- GitHub Actions Secrets에서 배포 시 주입

**REQ-INFRA-013** [Unwanted]
> **THE SYSTEM SHALL NOT** 프로덕션 환경에서 하드코딩된 시크릿을 사용한다.

- 데이터베이스 비밀번호, API 키, JWT 시크릿 모두 환경 변수 처리
- Docker Compose에서 `env_file` 참조

### 3.7 프로덕션 Docker Compose

**REQ-INFRA-014** [Ubiquitous]
> **THE SYSTEM SHALL** 프로덕션 전용 Docker Compose 파일(`docker-compose.prod.yml`)을 사용한다.

- 개발용 볼륨 마운트 제거 (핫 리로드 제거)
- `restart: always` 정책 적용
- 리소스 제한 설정 (CPU, 메모리)
- 내부 Docker 네트워크 사용 (포트 직접 노출 제거)
- 프로덕션 최적화 명령어 사용

**REQ-INFRA-015** [Ubiquitous]
> **THE SYSTEM SHALL** 프로덕션 빌드에서 멀티스테이지 Docker 빌드를 사용한다.

- Backend: 빌드 스테이지와 런타임 스테이지 분리
- Frontend: `pnpm build` 후 standalone 출력으로 최적화
- 최종 이미지 크기 최소화

---

## 4. Specifications (사양)

### 4.1 생성할 파일 구조

```
bodam/
├── deploy/
│   ├── oci/
│   │   ├── setup.sh                    # 서버 초기 설정 스크립트
│   │   ├── install-docker.sh           # Docker + Compose 설치 (ARM64)
│   │   └── firewall.sh                 # UFW 방화벽 설정
│   │
│   ├── nginx/
│   │   ├── nginx.conf                  # Nginx 메인 설정
│   │   ├── conf.d/
│   │   │   └── bodam.conf              # 사이트별 설정 (리버스 프록시)
│   │   └── ssl/
│   │       └── ssl-params.conf         # SSL 보안 파라미터
│   │
│   └── scripts/
│       ├── deploy.sh                   # 수동 배포 스크립트
│       ├── rollback.sh                 # 롤백 스크립트
│       ├── backup.sh                   # 데이터베이스 백업
│       └── ssl-renew.sh               # SSL 인증서 갱신
│
├── docker-compose.prod.yml             # 프로덕션 Docker Compose
├── backend/
│   └── Dockerfile.prod                 # 프로덕션 Backend Dockerfile
├── frontend/
│   └── Dockerfile.prod                 # 프로덕션 Frontend Dockerfile
├── .env.prod.example                   # 프로덕션 환경 변수 템플릿
│
└── .github/
    └── workflows/
        └── deploy.yml                  # CI/CD 배포 워크플로우
```

### 4.2 docker-compose.prod.yml 사양

```yaml
# 프로덕션 서비스 구성
services:
  postgres:
    image: pgvector/pgvector:pg18
    # 포트 외부 노출 안 함 (내부 네트워크만)
    restart: always
    env_file: .env.prod
    volumes:
      - postgres_data:/var/lib/postgresql/data
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 4G
    healthcheck: (기존 유지)

  redis:
    image: redis:7-alpine
    restart: always
    command: redis-server --requirepass ${REDIS_PASSWORD}
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 1G
    healthcheck: (기존 유지)

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile.prod
    restart: always
    env_file: .env.prod
    depends_on: [postgres, redis]
    deploy:
      resources:
        limits:
          cpus: "1.5"
          memory: 8G

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile.prod
    restart: always
    env_file: .env.prod
    depends_on: [backend]
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 4G

  nginx:
    image: nginx:alpine
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./deploy/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./deploy/nginx/conf.d:/etc/nginx/conf.d:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
      - /var/www/certbot:/var/www/certbot:ro
    depends_on: [frontend, backend]
```

**리소스 할당 계획 (4 OCPU / 24GB RAM 기준):**

| 서비스 | CPU 제한 | 메모리 제한 | 비고 |
|--------|---------|-----------|------|
| PostgreSQL | 1.0 OCPU | 4GB | pgvector 인덱싱 |
| Redis | 0.5 OCPU | 1GB | 캐시, 세션 |
| Backend (FastAPI) | 1.5 OCPU | 8GB | LLM 호출, RAG |
| Frontend (Next.js) | 0.5 OCPU | 4GB | SSR 렌더링 |
| Nginx | 0.25 OCPU | 256MB | 리버스 프록시 |
| OS + Docker | 0.25 OCPU | 2GB | 시스템 오버헤드 |
| **합계** | **4.0 OCPU** | **~19GB** | ~5GB 여유 |

### 4.3 Nginx 리버스 프록시 사양

```nginx
# 주요 라우팅 규칙
location /api/ {
    proxy_pass http://backend:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # WebSocket 지원
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}

location / {
    proxy_pass http://frontend:3000;
    proxy_set_header Host $host;
}
```

### 4.4 GitHub Actions CI/CD 사양

```yaml
# 트리거 조건
on:
  push:
    branches: [main]

# 필요한 Secrets
# OCI_SSH_HOST: OCI VM 퍼블릭 IP
# OCI_SSH_USER: ubuntu (기본 사용자)
# OCI_SSH_KEY: SSH 프라이빗 키
# ENV_PROD_CONTENTS: .env.prod 파일 내용 (base64 인코딩)

# 배포 스텝
# 1. SSH 접속
# 2. 코드 업데이트 (git pull)
# 3. .env.prod 파일 업데이트
# 4. docker compose -f docker-compose.prod.yml up --build -d
# 5. 헬스체크 검증 (30초 대기 후 /health 엔드포인트 확인)
# 6. 실패 시 롤백
```

### 4.5 환경 변수 템플릿 (.env.prod.example)

```bash
# === Database ===
POSTGRES_DB=bodam
POSTGRES_USER=bodam
POSTGRES_PASSWORD=<강력한_비밀번호>
DATABASE_URL=postgresql+asyncpg://bodam:<비밀번호>@postgres:5432/bodam

# === Redis ===
REDIS_PASSWORD=<강력한_비밀번호>
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0

# === Backend ===
SECRET_KEY=<JWT_시크릿_키>
DEBUG=false
ALLOWED_HOSTS=yourdomain.com
CORS_ORIGINS=https://yourdomain.com

# === AI/LLM API Keys ===
GEMINI_API_KEY=<Gemini_API_키>
OPENAI_API_KEY=<OpenAI_API_키>

# === Frontend ===
NEXT_PUBLIC_API_URL=https://yourdomain.com/api
NEXTAUTH_URL=https://yourdomain.com
NEXTAUTH_SECRET=<NextAuth_시크릿>

# === Monitoring (선택) ===
GRAFANA_ADMIN_PASSWORD=<Grafana_관리자_비밀번호>
```

---

## 5. 기술적 접근 방식

### 5.1 OCI 인프라 설정 (수동)

OCI Always Free 인프라는 Terraform 없이 OCI Console에서 수동으로 설정한다:

1. **VCN 생성**: 10.0.0.0/16 CIDR, 퍼블릭 서브넷 (10.0.1.0/24)
2. **Security List**: 인바운드 22, 80, 443 허용; 아웃바운드 전체 허용
3. **VM 인스턴스**: Ampere A1 (4 OCPU, 24GB RAM), Ubuntu 22.04 aarch64
4. **Block Volume**: 부트 볼륨 50GB + 추가 볼륨 150GB
5. **Reserved Public IP**: 고정 퍼블릭 IP 할당
6. **Object Storage**: 백업용 버킷 생성 (선택)

### 5.2 서버 초기화 순서

1. SSH 키 설정 및 접속
2. `deploy/oci/setup.sh` 실행 (패키지 업데이트, Docker 설치, UFW 설정)
3. 저장소 클론 (`git clone`)
4. `.env.prod` 파일 생성 및 설정
5. Nginx + Certbot으로 SSL 인증서 발급
6. `docker compose -f docker-compose.prod.yml up --build -d` 실행
7. 헬스체크 검증

### 5.3 개발 vs 프로덕션 차이점

| 항목 | 개발 (docker-compose.yml) | 프로덕션 (docker-compose.prod.yml) |
|------|--------------------------|----------------------------------|
| 볼륨 마운트 | 소스 코드 바인드 마운트 | 없음 (이미지에 코드 포함) |
| 포트 노출 | 모든 서비스 포트 노출 | Nginx만 80/443 노출 |
| 재시작 정책 | 없음 | `restart: always` |
| 빌드 모드 | 개발 (--reload) | 프로덕션 (최적화 빌드) |
| 환경 변수 | `.env` (로컬) | `.env.prod` (시크릿) |
| Redis 비밀번호 | 없음 | `requirepass` 설정 |
| 리소스 제한 | 없음 | CPU/메모리 제한 |
| Nginx | 없음 | 리버스 프록시 + SSL |

---

## 6. Traceability (추적성)

| 요구사항 ID | 관련 파일 | 검증 방법 |
|------------|----------|----------|
| REQ-INFRA-001 | `.github/workflows/deploy.yml` | GitHub Actions 로그 확인 |
| REQ-INFRA-002 | `deploy/scripts/rollback.sh` | 롤백 테스트 실행 |
| REQ-INFRA-003 | `deploy/nginx/conf.d/bodam.conf` | SSL 인증서 검증 (`curl -vI`) |
| REQ-INFRA-004 | `deploy/nginx/conf.d/bodam.conf` | 보안 헤더 검증 (`curl -I`) |
| REQ-INFRA-005 | `docker-compose.prod.yml` | 서버 재부팅 후 서비스 확인 |
| REQ-INFRA-006 | `docker-compose.prod.yml` | 컨테이너 강제 종료 후 복구 확인 |
| REQ-INFRA-007 | `Dockerfile.prod`, `docker-compose.prod.yml` | 프로세스 리스트 확인 |
| REQ-INFRA-008 | `deploy/nginx/conf.d/bodam.conf` | API 엔드포인트 접근 테스트 |
| REQ-INFRA-009 | `deploy/nginx/conf.d/bodam.conf` | 프론트엔드 페이지 접근 테스트 |
| REQ-INFRA-010 | OCI Security List | 포트 스캔 테스트 (`nmap`) |
| REQ-INFRA-011 | `/etc/ssh/sshd_config` | 비밀번호 SSH 접근 시도 |
| REQ-INFRA-012 | `.env.prod.example` | 환경 변수 존재 확인 |
| REQ-INFRA-013 | 전체 소스 코드 | 하드코딩 시크릿 검색 (`grep`) |
| REQ-INFRA-014 | `docker-compose.prod.yml` | 프로덕션 설정 검증 |
| REQ-INFRA-015 | `Dockerfile.prod` | 이미지 크기 확인 |
