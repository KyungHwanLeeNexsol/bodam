# 보담 (Bodam)

보담 프로젝트 - AI 기반 노인 돌봄 서비스

## 아키텍처

| 구성요소 | 플랫폼 | 설명 |
|--------|--------|------|
| Frontend | Vercel | Next.js, GitHub push 시 자동 배포 |
| Backend | OCI ARM64 VM | FastAPI, Docker Compose |
| Database | PostgreSQL 18 (pgvector) | 내부 네트워크만 노출 |
| Cache | Redis 7 | 인증 세션, Rate Limiting |
| Proxy | Nginx | SSL 종료, /api/* 프록시 |

## 환경변수 설정

### 환경 파일 매핑

| 환경 | 참조 파일 | 예시 파일 |
|------|---------|---------|
| 로컬 개발 | `backend/.env` | `backend/.env.example` |
| 스테이징 | `.env.staging` | `.env.staging.example` |
| 프로덕션 | `.env.prod` | `.env.prod.example` |

> **Frontend (Vercel)**: 환경변수는 Vercel 대시보드에서 관리합니다. `NEXT_PUBLIC_API_URL` 등 프론트엔드 변수는 별도 `.env` 파일로 관리되지 않습니다.

### 빠른 설정

**로컬 개발 환경:**

```bash
cp backend/.env.example backend/.env
# backend/.env 파일을 열어 실제 값 입력
docker compose up -d
```

**프로덕션 환경 (OCI VM):**

```bash
cp .env.prod.example .env.prod
# .env.prod 파일을 열어 모든 CHANGE_ME 값 교체
docker compose -f docker-compose.prod.yml up -d
```

**스테이징 환경:**

```bash
cp .env.staging.example .env.staging
# .env.staging 파일을 열어 스테이징용 값 입력
docker compose -f docker-compose.staging.yml up -d
```

### 주의사항

- `.env.prod`, `.env.staging`, `backend/.env` 파일은 절대 git에 커밋하지 마세요.
- `SECRET_KEY` 생성: `openssl rand -hex 32`
- `SOCIAL_TOKEN_ENCRYPTION_KEY` / `B2B_ENCRYPTION_KEY` 생성: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`

## 개발 시작

```bash
# 의존성 설치 및 백엔드 실행
docker compose up -d

# 데이터베이스 마이그레이션
docker compose exec backend uv run alembic upgrade head
```

## 배포

프로덕션 배포는 `.github/workflows/deploy.yml` GitHub Actions 워크플로우를 통해 자동화됩니다.

자세한 내용은 `deploy/` 디렉토리의 스크립트 및 `deploy/oci/README.md`를 참고하세요.
