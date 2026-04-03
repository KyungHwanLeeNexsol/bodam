# 보담 (Bodam)

보담 프로젝트 - AI 기반 노인 돌봄 서비스

## 주요 기능

### 보험 약관 분석
- 📊 **온디맨드 PDF 분석**: Gemini 2.0 Flash로 사용자 업로드 약관 실시간 분석
- 💬 **Q&A 채팅**: 업로드된 약관에 대한 자연어 질문 지원
- 📋 **보장 분석**: 담보 항목, 보상 조건, 면책 사항, 보상 한도 자동 추출
- 🔄 **세션 관리**: 분석 이력 조회 및 세션 수 제한
- 🔍 **자동 약관 검색**: 질문에서 보험사/상품명 자동 추출 후 약관 JIT 검색 (25개 보험사 지원)
- ⚡ **세션 목록 최적화**: SQL 서브쿼리 기반 페이지네이션, N+1 쿼리 제거, 200ms 이내 P95 응답

## 아키텍처

| 구성요소 | 플랫폼 | 설명 |
|--------|--------|------|
| Frontend | Vercel | Next.js, GitHub push 시 자동 배포 |
| Backend | Fly.io | FastAPI, 자동 배포 |
| Database | Fly Postgres (pgvector) | Fly.io 관리형 PostgreSQL |
| Cache | Upstash Redis | 인증 세션, Rate Limiting |
| AI/LLM | Google Gemini | Gemini 2.0 Flash API (1M context window) |

## 환경변수 설정

### 환경 파일 매핑

| 환경 | 참조 파일 | 예시 파일 |
|------|---------|---------|
| 로컬 개발 | `backend/.env` | `backend/.env.example` |
| 스테이징 | `.env.staging` | `.env.staging.example` |
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
- **Database**: Fly Postgres + pgvector (관리형)
- **Cache**: Upstash Redis (관리형)
