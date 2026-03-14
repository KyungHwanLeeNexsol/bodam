# 보담 배포 가이드: Fly.io + Vercel + Neon + Upstash

## 아키텍처 (월 $0)

| 서비스 | 역할 | URL |
|--------|------|-----|
| Fly.io | FastAPI 백엔드 (항상 실행, 슬립 없음) | https://bodam-backend.fly.dev |
| Vercel | Next.js 프론트엔드 | https://bodam.vercel.app |
| Neon | PostgreSQL 18 + pgvector | 내부 연결 |
| Upstash | Redis (Rate Limiting + 캐시) | 내부 연결 |

---

## 1단계: Neon PostgreSQL 설정

1. [neon.tech](https://neon.tech) 가입 (GitHub 로그인 가능)
2. 새 프로젝트 생성 → 리전: **AWS ap-southeast-1** (싱가포르, 도쿄에서 가까움)
3. Database 이름: `bodam`
4. **Extensions** 탭 → `pgvector` 활성화
5. **Connection Details** → **Pooled connection** 복사
   - 형식: `postgresql+asyncpg://user:pass@ep-xxx.neon.tech/bodam?sslmode=require`

---

## 2단계: Upstash Redis 설정

1. [upstash.com](https://upstash.com) 가입
2. **Redis** → Create Database → 리전: **ap-northeast-1** (도쿄)
3. **Connect** 탭 → **Redis URL** 복사 (`rediss://` TLS URL)

---

## 3단계: Fly.io 백엔드 배포

### flyctl 설치

```bash
# macOS/Linux
curl -L https://fly.io/install.sh | sh

# Windows (PowerShell)
iwr https://fly.io/install.ps1 -useb | iex
```

### 로그인 및 앱 생성

```bash
flyctl auth login

# 프로젝트 루트에서 실행
flyctl launch --name bodam-backend --region nrt --no-deploy
# fly.toml이 이미 있으므로 기존 설정 사용 여부 → Yes
```

### 환경 변수 설정 (Fly.io Secrets)

```bash
# 각 값을 실제 값으로 교체 후 실행
flyctl secrets set \
  DATABASE_URL="postgresql+asyncpg://user:pass@ep-xxx.neon.tech/bodam?sslmode=require" \
  REDIS_URL="rediss://default:pass@us1-xxx.upstash.io:6379" \
  SECRET_KEY="$(openssl rand -hex 32)" \
  JWT_ALGORITHM="HS256" \
  ACCESS_TOKEN_EXPIRE_MINUTES="30" \
  GEMINI_API_KEY="your-gemini-api-key" \
  ALLOWED_ORIGINS="https://bodam.vercel.app" \
  ENVIRONMENT="production" \
  LOG_LEVEL="info" \
  --app bodam-backend
```

### 첫 배포

```bash
flyctl deploy --config fly.toml --remote-only --app bodam-backend
```

### 데이터베이스 마이그레이션

```bash
flyctl ssh console --command "uv run alembic upgrade head" --app bodam-backend
```

### 배포 확인

```bash
flyctl status --app bodam-backend
curl https://bodam-backend.fly.dev/api/v1/health
```

---

## 4단계: Vercel 프론트엔드 배포

### 방법 A: GitHub 통합 (권장, 자동 배포)

1. [vercel.com](https://vercel.com) → GitHub로 로그인
2. **Add New Project** → GitHub 저장소 선택
3. **Root Directory**: `frontend`
4. **Framework Preset**: Next.js (자동 감지)
5. **Environment Variables** 추가:
   - `NEXT_PUBLIC_API_URL` = `https://bodam-backend.fly.dev`
   - `NEXT_PUBLIC_APP_NAME` = `보담`
6. **Deploy** 클릭

이후 `main` 브랜치에 push할 때마다 자동 배포됩니다.

### 방법 B: Vercel CLI

```bash
npm i -g vercel
cd frontend
vercel --prod
```

---

## 5단계: GitHub Actions CI/CD 설정

GitHub 저장소 → Settings → Secrets → Actions Secrets:

| Secret | 값 |
|--------|-----|
| `FLY_API_TOKEN` | `flyctl auth token` 명령어 출력값 |

이후 `main` 브랜치 push 시:
- **Fly.io 백엔드**: GitHub Actions가 자동 배포
- **Vercel 프론트엔드**: Vercel GitHub 통합이 자동 배포

---

## CORS 업데이트

Vercel 배포 후 실제 URL 확인 (예: `https://bodam-xxx.vercel.app`):

```bash
flyctl secrets set ALLOWED_ORIGINS="https://bodam-xxx.vercel.app" --app bodam-backend
```

---

## 문제 해결

```bash
# Fly.io 로그 확인
flyctl logs --app bodam-backend

# Fly.io SSH 접속
flyctl ssh console --app bodam-backend

# 앱 상태 확인
flyctl status --app bodam-backend
```
