# SPEC-INFRA-003: 수락 기준

## 관련 SPEC

- **SPEC ID**: SPEC-INFRA-003
- **제목**: Vercel + OCI Always Free 분리 배포 시스템

---

## 수락 기준 (Acceptance Criteria)

### SC-001: 서버 초기화 (OCI)

**Given** OCI Always Free ARM A1 인스턴스가 Ubuntu 22.04로 프로비저닝되어 있을 때
**When** `deploy/oci/setup.sh`를 실행하면
**Then** Docker Engine, Docker Compose V2가 설치되고
**And** UFW 방화벽이 활성화되어 포트 22, 80, 443만 허용하고
**And** Docker 데몬이 부팅 시 자동 시작되도록 설정된다

---

### SC-002: 프로덕션 Docker Compose 실행 (Backend 전용)

**Given** `.env.prod` 파일이 올바른 환경 변수로 설정되어 있을 때
**When** `docker compose -f docker-compose.prod.yml up --build -d`를 실행하면
**Then** postgres, redis, backend, nginx 서비스가 모두 시작되고
**And** frontend 서비스는 포함되지 않고
**And** 모든 서비스의 healthcheck가 healthy 상태가 되고
**And** 외부에서 포트 80, 443으로만 접근 가능하고
**And** PostgreSQL(5432), Redis(6379) 포트는 외부에서 접근 불가하다

---

### SC-003: Nginx API 리버스 프록시 (프론트엔드 프록시 제거)

**Given** 프로덕션 Docker Compose가 실행 중일 때
**When** `https://{oci-domain}/api/v1/health`에 GET 요청을 보내면
**Then** FastAPI 백엔드에서 200 OK 응답이 반환된다

**Given** 프로덕션 Docker Compose가 실행 중일 때
**When** 브라우저에서 `https://{oci-domain}/`에 접속하면
**Then** Vercel 프론트엔드 도메인으로 301 리다이렉트된다

---

### SC-003-V: Vercel 프론트엔드 배포

**Given** Vercel 계정이 GitHub 리포지토리에 연결되어 있을 때
**When** `main` 브랜치에 frontend 코드를 push하면
**Then** Vercel이 자동으로 Next.js 프로젝트를 빌드하고 배포하고
**And** `https://bodam.vercel.app` (또는 커스텀 도메인)에서 프론트엔드가 접근 가능하다

**Given** Vercel에 `NEXT_PUBLIC_API_URL` 환경 변수가 설정되어 있을 때
**When** 프론트엔드에서 API 요청을 보내면
**Then** OCI 백엔드(`https://{oci-domain}/api`)로 요청이 전달되고
**And** 정상적인 응답이 반환된다

---

### SC-003-C: CORS 설정

**Given** OCI 백엔드의 `ALLOWED_ORIGINS`에 Vercel 도메인이 포함되어 있을 때
**When** Vercel 프론트엔드에서 OCI 백엔드로 API 요청을 보내면
**Then** CORS preflight (OPTIONS) 요청이 성공하고
**And** `Access-Control-Allow-Origin` 헤더에 Vercel 도메인이 포함되고
**And** 실제 API 요청이 성공적으로 처리된다

**Given** OCI 백엔드의 CORS 설정이 적용되어 있을 때
**When** 허용되지 않은 도메인에서 API 요청을 보내면
**Then** CORS 오류로 요청이 거부된다

**Given** OCI 백엔드의 CORS 설정을 확인할 때
**When** FastAPI CORS 미들웨어 설정을 검사하면
**Then** `allow_origins`에 와일드카드(`*`)가 사용되지 않았고
**And** 명시적 도메인 목록만 포함되어 있다

---

### SC-004: HTTPS 및 SSL 인증서 (OCI)

**Given** 도메인의 DNS A 레코드가 OCI VM 퍼블릭 IP를 가리킬 때
**When** Certbot으로 SSL 인증서를 발급하면
**Then** 유효한 Let's Encrypt 인증서가 설치되고
**And** `https://{oci-domain}`에 HTTPS로 접속 가능하고
**And** `http://{oci-domain}`에 접속하면 HTTPS로 리다이렉트된다

**Given** SSL 인증서가 설치되어 있을 때
**When** `curl -I https://{oci-domain}/api/v1/health`로 응답 헤더를 확인하면
**Then** `Strict-Transport-Security` 헤더가 존재하고
**And** `X-Content-Type-Options: nosniff` 헤더가 존재하고
**And** `X-Frame-Options: DENY` 헤더가 존재한다

---

### SC-005: 자동 배포 (CI/CD - OCI Backend만)

**Given** GitHub Actions에 OCI_SSH_HOST, OCI_SSH_USER, OCI_SSH_KEY 시크릿이 설정되어 있을 때
**When** `main` 브랜치에 backend 코드를 push하면
**Then** GitHub Actions 워크플로우가 트리거되고
**And** SSH를 통해 OCI VM에 접속하여 최신 코드를 pull하고
**And** Docker Compose를 빌드하고 재시작하고 (backend 서비스만)
**And** 헬스체크가 성공하면 배포 완료로 표시된다

**Given** GitHub Actions deploy.yml에 paths 필터가 설정되어 있을 때
**When** `frontend/**`만 변경된 push가 발생하면
**Then** OCI 배포 워크플로우는 트리거되지 않고
**And** Vercel만 자동으로 프론트엔드를 배포한다

---

### SC-006: 배포 롤백

**Given** 자동 배포가 진행 중일 때
**When** 배포 후 헬스체크가 60초 이내에 성공하지 않으면
**Then** 이전 버전의 Docker 이미지로 자동 롤백되고
**And** 롤백 후 헬스체크가 성공하면 서비스가 정상 상태로 복원되고
**And** GitHub Actions 로그에 롤백 사유가 기록된다

---

### SC-007: 서비스 자동 복구

**Given** 프로덕션 서비스가 실행 중일 때
**When** backend 컨테이너를 `docker kill`로 강제 종료하면
**Then** Docker가 `restart: always` 정책에 따라 자동으로 컨테이너를 재시작하고
**And** 30초 이내에 서비스가 정상 상태로 복구된다

**Given** 프로덕션 서비스가 실행 중일 때
**When** 서버를 재부팅하면
**Then** Docker 데몬이 자동으로 시작되고
**And** 모든 OCI 서비스 컨테이너가 자동으로 재시작되고
**And** 5분 이내에 모든 서비스가 정상 상태가 된다

---

### SC-008: 환경 변수 보안

**Given** 프로덕션 환경이 설정되어 있을 때
**When** Git 리포지터리에서 시크릿을 검색하면
**Then** `.env.prod` 파일은 `.gitignore`에 포함되어 Git에 추적되지 않고
**And** 하드코딩된 데이터베이스 비밀번호, API 키가 소스 코드에 존재하지 않고
**And** `docker-compose.prod.yml`에서 모든 시크릿이 `env_file` 참조로 관리된다

**Given** OCI `.env.prod.example` 파일을 확인할 때
**When** 프론트엔드 관련 환경 변수를 검색하면
**Then** `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `NEXT_PUBLIC_API_URL`이 포함되지 않았고
**And** 프론트엔드 환경 변수는 Vercel Dashboard에서만 관리된다

---

### SC-009: 프로덕션 모드 검증

**Given** 프로덕션 Docker Compose가 실행 중일 때
**When** backend 컨테이너의 프로세스를 확인하면
**Then** uvicorn이 `--reload` 플래그 없이 실행되고
**And** 2개 이상의 워커 프로세스가 실행된다

**Given** Vercel 배포가 완료되었을 때
**When** Vercel 배포 로그를 확인하면
**Then** Next.js 프로덕션 빌드(`next build`)가 실행되었고
**And** 개발 서버(`next dev`)는 실행되지 않는다

---

### SC-010: 네트워크 보안

**Given** 프로덕션 서버가 실행 중일 때
**When** 외부에서 포트 5432(PostgreSQL)에 접속을 시도하면
**Then** 연결이 거부된다

**Given** 프로덕션 서버가 실행 중일 때
**When** 외부에서 포트 6379(Redis)에 접속을 시도하면
**Then** 연결이 거부된다

**Given** 프로덕션 서버가 실행 중일 때
**When** SSH 비밀번호 인증으로 접속을 시도하면
**Then** 접속이 거부된다

---

### SC-011: 데이터베이스 백업

**Given** 프로덕션 PostgreSQL이 실행 중일 때
**When** `deploy/scripts/backup.sh`를 실행하면
**Then** PostgreSQL 데이터베이스 덤프가 생성되고
**And** 30일 이전의 백업 파일이 자동 삭제되고
**And** 백업 파일에 타임스탬프가 포함된 파일명이 지정된다

---

### SC-012: SSL 인증서 자동 갱신

**Given** Let's Encrypt SSL 인증서가 설치되어 있을 때
**When** `deploy/scripts/ssl-renew.sh`를 실행하면
**Then** 인증서 만료 30일 이전에 갱신이 시도되고
**And** 갱신 성공 시 Nginx가 자동으로 리로드된다

---

### SC-013: 리소스 재배분 검증

**Given** docker-compose.prod.yml의 리소스 설정을 확인할 때
**When** backend 서비스의 리소스 제한을 확인하면
**Then** CPU 제한이 2.0 OCPU로 설정되어 있고
**And** 메모리 제한이 12GB로 설정되어 있고
**And** frontend 서비스가 docker-compose.prod.yml에 정의되어 있지 않다

---

## Definition of Done (완료 정의)

- [ ] 모든 서버 설정 스크립트가 ARM64 Ubuntu 22.04에서 정상 실행된다
- [ ] docker-compose.prod.yml로 backend 서비스가 프로덕션 모드로 실행된다 (frontend 제외)
- [ ] Vercel에서 Next.js 프론트엔드가 자동 빌드/배포된다
- [ ] Vercel 프론트엔드에서 OCI 백엔드 API로 정상 통신된다 (CORS 포함)
- [ ] Nginx가 API 트래픽만 올바르게 프록시한다 (프론트엔드 프록시 제거)
- [ ] HTTPS가 유효한 SSL 인증서로 동작한다 (OCI)
- [ ] GitHub Actions에서 backend 코드 push 시 자동 배포가 실행된다
- [ ] frontend 코드만 변경 시 OCI 배포가 트리거되지 않는다
- [ ] 배포 실패 시 자동 롤백이 동작한다
- [ ] 서버 재부팅 후 모든 OCI 서비스가 자동으로 복구된다
- [ ] OCI 환경 변수가 .env.prod로 안전하게 관리된다 (프론트엔드 변수 제외)
- [ ] Vercel 환경 변수가 Dashboard에서 관리된다
- [ ] CORS에 와일드카드가 사용되지 않는다
- [ ] 외부에서 PostgreSQL, Redis 포트에 접근할 수 없다
- [ ] SSH 키 기반 인증만 허용된다
- [ ] 데이터베이스 백업 스크립트가 정상 동작한다
- [ ] SSL 인증서 자동 갱신 스크립트가 설정된다
- [ ] Backend 리소스가 2.0 OCPU / 12GB RAM으로 증가 설정된다

## 검증 도구

| 검증 항목 | 도구/명령어 |
|-----------|------------|
| SSL 인증서 유효성 | `curl -vI https://{oci-domain}` |
| 보안 헤더 | `curl -I https://{oci-domain}/api/v1/health` |
| 포트 스캔 | `nmap -p 1-65535 VM_IP` |
| 서비스 상태 | `docker compose -f docker-compose.prod.yml ps` |
| 헬스체크 | `curl https://{oci-domain}/api/v1/health` |
| 프로세스 확인 | `docker exec backend ps aux` |
| 컨테이너 로그 | `docker compose -f docker-compose.prod.yml logs` |
| SSH 인증 테스트 | `ssh -o PasswordAuthentication=yes user@host` |
| CORS 테스트 | `curl -H "Origin: https://bodam.vercel.app" -I https://{oci-domain}/api/v1/health` |
| Vercel 배포 상태 | Vercel Dashboard > Deployments |
| 프론트엔드 접근 | `curl -I https://bodam.vercel.app` |
| API 루트 리다이렉트 | `curl -I https://{oci-domain}/` (301 확인) |
