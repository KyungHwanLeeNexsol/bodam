# 보담 (Bodam)

보담 프로젝트 - AI 기반 노인 돌봄 서비스

## 아키텍처

| 구성요소 | 플랫폼 | 설명 |
|--------|--------|------|
| Frontend | Vercel | Next.js, GitHub push 시 자동 배포 |
| Backend | Fly.io | FastAPI, 자동 배포 |
| Database | Neon PostgreSQL (pgvector) | 서버리스 PostgreSQL |
| Cache | Upstash Redis | 인증 세션, Rate Limiting |

## 환경변수 설정

### 환경 파일 매핑

| 환경 | 참조 파일 | 예시 파일 |
|------|---------|---------|
| 로컬 개발 | `backend/.env` | `backend/.env.example` |
| 프로덕션 (Fly.io) | Fly.io Secrets | `backend/.env.fly.example` |

> **Frontend (Vercel)**: 환경변수는 Vercel 대시보드에서 관리합니다. `NEXT_PUBLIC_API_URL` 등 프론트엔드 변수는 별도 `.env` 파일로 관리되지 않습니다.

### 빠른 설정

**로컬 개발 환경:**

```bash
cp backend/.env.example backend/.env
# backend/.env 파일을 열어 실제 값 입력
docker compose up -d
```

**프로덕션 환경 (Fly.io):**

```bash
# backend/.env.fly.example 참고하여 Fly.io secrets 설정
fly secrets set KEY=VALUE --app bodam
# 또는 일괄 설정
fly secrets import < backend/.env.fly --app bodam
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

- **Frontend**: Vercel에서 GitHub push 시 자동 배포
- **Backend**: Fly.io에서 `fly deploy` 또는 GitHub 연동 자동 배포
- **Database**: Neon 서버리스 PostgreSQL (관리형)
- **Cache**: Upstash Redis (관리형)
