# SPEC-INFRA-003: 구현 계획

## 관련 SPEC

- **SPEC ID**: SPEC-INFRA-003
- **제목**: OCI Always Free 프로덕션 배포 시스템

---

## 마일스톤 개요

| 마일스톤 | 설명 | 우선순위 | 의존성 |
|----------|------|---------|--------|
| **M1** | 서버 설정 및 초기화 | Primary Goal | 없음 |
| **M2** | 프로덕션 Docker Compose | Primary Goal | M1 |
| **M3** | Nginx 리버스 프록시 + HTTPS | Primary Goal | M2 |
| **M4** | GitHub Actions CI/CD | Secondary Goal | M3 |
| **M5** | 운영 스크립트 및 문서화 | Final Goal | M4 |

---

## M1: 서버 설정 및 초기화 (Primary Goal)

### 목표

OCI Always Free VM에 Docker 기반 서비스 실행 환경을 구축한다.

### 작업 목록

**M1-1: OCI 인프라 매뉴얼 작성**

- OCI Console에서 VCN, Subnet, Security List 생성 가이드
- ARM A1 인스턴스 (4 OCPU, 24GB RAM) 프로비저닝 가이드
- Reserved Public IP 할당 가이드
- SSH 키 페어 생성 및 등록

**M1-2: deploy/oci/setup.sh 작성**

- Ubuntu 22.04 LTS 패키지 업데이트
- 기본 도구 설치 (git, curl, wget, htop, vim)
- swap 메모리 설정 (4GB, OOM 방지)
- 타임존 설정 (Asia/Seoul)
- 자동 보안 업데이트 설정 (unattended-upgrades)

**M1-3: deploy/oci/install-docker.sh 작성**

- Docker Engine 설치 (ARM64 공식 리포지터리)
- Docker Compose V2 플러그인 설치
- Docker 데몬 설정 (로그 로테이션, 스토리지 드라이버)
- 사용자를 docker 그룹에 추가 (sudo 없이 실행)
- Docker 서비스 부팅 시 자동 시작

**M1-4: deploy/oci/firewall.sh 작성**

- UFW 방화벽 설정
- 포트 22 (SSH), 80 (HTTP), 443 (HTTPS) 허용
- 기타 모든 인바운드 트래픽 차단
- SSH 비밀번호 인증 비활성화

### 산출물

- `deploy/oci/setup.sh`
- `deploy/oci/install-docker.sh`
- `deploy/oci/firewall.sh`
- OCI 인프라 설정 가이드 (README 내 포함)

---

## M2: 프로덕션 Docker Compose (Primary Goal)

### 목표

프로덕션 환경에 최적화된 Docker Compose 설정과 Dockerfile을 작성한다.

### 작업 목록

**M2-1: backend/Dockerfile.prod 작성**

- 멀티스테이지 빌드 (빌더 + 런타임)
- 빌더 스테이지: uv sync로 의존성 설치
- 런타임 스테이지: 최소 이미지 (python:3.13-slim)
- 비root 사용자로 실행
- uvicorn production 모드 (--workers 2, --reload 없음)

**M2-2: frontend/Dockerfile.prod 작성**

- 멀티스테이지 빌드 (의존성 설치 + 빌드 + 런타임)
- Next.js standalone 출력 모드 설정
- 프로덕션 빌드 (`pnpm build`)
- Node.js 프로덕션 모드 (`node server.js`)
- 비root 사용자로 실행

**M2-3: docker-compose.prod.yml 작성**

- 개발용 docker-compose.yml 기반으로 프로덕션 설정
- 서비스별 리소스 제한 (CPU, 메모리)
- `restart: always` 정책
- 포트 외부 노출 제거 (Nginx만 80/443)
- Redis 비밀번호 설정
- env_file로 `.env.prod` 참조
- 내부 Docker 네트워크 구성

**M2-4: .env.prod.example 작성**

- 모든 프로덕션 환경 변수 템플릿
- 각 변수에 대한 설명 주석
- 기본값이 없는 필수 시크릿 명시

### 산출물

- `backend/Dockerfile.prod`
- `frontend/Dockerfile.prod`
- `docker-compose.prod.yml`
- `.env.prod.example`

---

## M3: Nginx 리버스 프록시 + HTTPS (Primary Goal)

### 목표

Nginx를 통한 리버스 프록시와 Let's Encrypt SSL을 설정한다.

### 작업 목록

**M3-1: deploy/nginx/nginx.conf 작성**

- Nginx 메인 설정 (worker_processes, worker_connections)
- gzip 압축 설정
- 로그 포맷 설정
- 보안 설정 (server_tokens off)

**M3-2: deploy/nginx/conf.d/bodam.conf 작성**

- 서버 블록 (80, 443)
- HTTP -> HTTPS 리다이렉트
- SSL 인증서 경로 (Let's Encrypt)
- 리버스 프록시 규칙:
  - `/api/*` -> `http://backend:8000`
  - `/_next/*` -> `http://frontend:3000`
  - `/` -> `http://frontend:3000`
- WebSocket 프록시 설정
- 보안 헤더 (HSTS, CSP, X-Frame-Options)
- 정적 파일 캐싱

**M3-3: deploy/nginx/ssl/ssl-params.conf 작성**

- TLS 1.2 / 1.3만 허용
- 강력한 암호 스위트 설정
- OCSP Stapling
- SSL 세션 캐싱

**M3-4: SSL 인증서 발급 스크립트**

- Certbot standalone 모드로 초기 인증서 발급
- 인증서 자동 갱신 cron 작업 설정
- `deploy/scripts/ssl-renew.sh` 작성

### 산출물

- `deploy/nginx/nginx.conf`
- `deploy/nginx/conf.d/bodam.conf`
- `deploy/nginx/ssl/ssl-params.conf`
- `deploy/scripts/ssl-renew.sh`

---

## M4: GitHub Actions CI/CD (Secondary Goal)

### 목표

main 브랜치 push 시 자동으로 OCI VM에 배포하는 CI/CD 파이프라인을 구축한다.

### 작업 목록

**M4-1: .github/workflows/deploy.yml 작성**

- 트리거: `push` to `main`
- 환경: ubuntu-latest
- 스텝:
  1. SSH 키 설정 (GitHub Secrets에서 주입)
  2. SSH로 OCI VM 접속
  3. 코드 업데이트 (`git pull origin main`)
  4. .env.prod 업데이트 (Secrets에서)
  5. Docker Compose 빌드 및 재시작
  6. 헬스체크 검증 (최대 60초 대기)
  7. 실패 시 롤백 스크립트 실행
  8. 배포 결과 알림 (GitHub Actions summary)

**M4-2: deploy/scripts/deploy.sh 작성**

- 수동 배포용 스크립트
- 현재 이미지 백업
- 빌드 및 재시작
- 헬스체크 검증

**M4-3: deploy/scripts/rollback.sh 작성**

- 이전 버전 Docker 이미지로 롤백
- 롤백 후 헬스체크 검증
- 롤백 이력 로깅

### 산출물

- `.github/workflows/deploy.yml`
- `deploy/scripts/deploy.sh`
- `deploy/scripts/rollback.sh`

### GitHub Actions에 등록할 Secrets

| Secret 이름 | 설명 |
|-------------|------|
| `OCI_SSH_HOST` | OCI VM 퍼블릭 IP 주소 |
| `OCI_SSH_USER` | SSH 접속 사용자 (기본: `ubuntu`) |
| `OCI_SSH_KEY` | SSH 프라이빗 키 (PEM 형식) |
| `ENV_PROD_CONTENTS` | `.env.prod` 파일 전체 내용 (base64 인코딩) |

---

## M5: 운영 스크립트 및 문서화 (Final Goal)

### 목표

일상 운영에 필요한 스크립트와 배포 가이드를 작성한다.

### 작업 목록

**M5-1: deploy/scripts/backup.sh 작성**

- PostgreSQL 데이터베이스 백업 (pg_dump)
- 30일 롤링 삭제
- OCI Object Storage 업로드 (선택)
- cron 작업 등록 (매일 03:00 KST)

**M5-2: 배포 가이드 문서 작성**

- OCI 인프라 설정 단계별 가이드 (스크린샷 포함 여부는 향후 결정)
- 초기 서버 설정 절차
- SSL 인증서 발급 절차
- 첫 배포 절차
- 트러블슈팅 가이드

**M5-3: 모니터링 프로파일 통합**

- `docker-compose.prod.yml`에 monitoring 프로파일 추가
- 기존 SPEC-OPS-001 모니터링 스택과 호환
- `docker compose --profile monitoring up` 지원

### 산출물

- `deploy/scripts/backup.sh`
- 배포 가이드 문서
- 모니터링 프로파일 통합

---

## 기술적 접근 방식

### ARM64 호환성 전략

모든 Docker 이미지가 ARM64를 지원하는지 사전 검증한다:

| 이미지 | ARM64 지원 | 비고 |
|--------|-----------|------|
| `pgvector/pgvector:pg18` | 확인 필요 | multi-arch manifest 검증 |
| `python:3.13-slim` | 지원 | 공식 ARM64 빌드 |
| `node:22-alpine` | 지원 | 공식 ARM64 빌드 |
| `redis:7-alpine` | 지원 | 공식 ARM64 빌드 |
| `nginx:alpine` | 지원 | 공식 ARM64 빌드 |
| `prom/prometheus` | 지원 | 공식 ARM64 빌드 |
| `grafana/grafana` | 지원 | 공식 ARM64 빌드 |

pgvector ARM64 미지원 시 대안:
- PostgreSQL 18 공식 이미지에 pgvector 소스 빌드
- Dockerfile로 커스텀 이미지 생성

### 보안 전략

1. **네트워크 계층**: OCI Security List + UFW 이중 방화벽
2. **애플리케이션 계층**: Nginx 보안 헤더 + Rate Limiting (기존 SPEC-SEC-001)
3. **데이터 계층**: Redis 비밀번호 + PostgreSQL 강력한 비밀번호
4. **접근 계층**: SSH 키 인증 전용, 비밀번호 인증 차단
5. **시크릿 관리**: GitHub Secrets + .env.prod (Git 추적 제외)

### 무중단 배포 전략

완전한 무중단 배포는 단일 VM 환경에서 제한적이지만, 다운타임을 최소화한다:

1. `docker compose pull` (새 이미지 미리 다운로드)
2. `docker compose up --build -d` (기존 컨테이너 순차 교체)
3. 헬스체크 통과 확인
4. 실패 시 `rollback.sh` 실행 (약 30초 이내)

예상 배포 다운타임: 약 30-60초

---

## 리스크 및 대응

| 리스크 | 영향도 | 대응 방안 |
|--------|--------|----------|
| ARM64에서 pgvector 이미지 미지원 | High | PostgreSQL 공식 이미지에 소스 빌드 |
| OCI Always Free 인스턴스 가용성 부족 | High | 다른 리전 시도 또는 대기 |
| 4 OCPU + 24GB RAM 성능 부족 | Medium | 서비스별 리소스 튜닝, 불필요 서비스 비활성화 |
| Let's Encrypt 인증서 발급 실패 | Medium | DNS 챌린지 대안, 수동 인증서 설치 |
| 단일 VM 장애 시 전체 서비스 중단 | High | 자동 백업, 빠른 복구 스크립트, OCI 스냅샷 |
| Docker 빌드 시 ARM64 크로스컴파일 이슈 | Medium | VM에서 직접 빌드 (네이티브 ARM64) |
