# Bodam Backend - Fly.io Deployment Guide

## Prerequisites

Before deploying, you need the following services and tools set up.

### 1. Fly Postgres

Bodam uses Fly.io Managed PostgreSQL with pgvector extension.

```bash
# Postgres 앱 생성 (이미 bodam-db로 존재)
fly postgres create --name bodam-db --region nrt

# pgvector 확장 활성화 (마이그레이션에서 자동 실행)
# CREATE EXTENSION IF NOT EXISTS vector;
```

내부 접속 주소: `postgresql+asyncpg://postgres:<password>@bodam-db.flycast:5432/bodam`

### 2. Upstash Redis

1. Sign up at https://upstash.com
2. Create a new Redis database (select region: `ap-northeast-1`)
3. Copy the **TLS connection URL** (starts with `rediss://`):
   - Dashboard > Your DB > Connect > .env tab

### 3. Fly CLI

Install the Fly CLI:

```bash
# macOS / Linux
curl -L https://fly.io/install.sh | sh

# Windows (PowerShell)
iwr https://fly.io/install.ps1 -useb | iex
```

---

## Deployment Steps

### Step 1: Login to Fly.io

```bash
fly auth login
```

### Step 2: Create the Fly app

```bash
fly apps create bodam
```

> If the app name `bodam` is already taken, choose a unique name and update `app = 'bodam'` in `fly.toml`.

### Step 3: Set secrets

Run the following commands, replacing each `CHANGE_ME` with your actual values.

**Required secrets:**

```bash
# Database (Fly Postgres 내부 주소, SSL 불필요)
fly secrets set DATABASE_URL="postgresql+asyncpg://postgres:<password>@bodam-db.flycast:5432/bodam" --app bodam

# Redis (Upstash TLS URL)
fly secrets set REDIS_URL="rediss://default:password@apn1-xxx.upstash.io:6379" --app bodam

# JWT signing key (generate with: openssl rand -hex 32)
fly secrets set SECRET_KEY="your-secret-key-here" --app bodam

# Google Gemini API key
fly secrets set GEMINI_API_KEY="your-gemini-api-key" --app bodam
```

**OAuth2 secrets (required for social login):**

```bash
fly secrets set KAKAO_CLIENT_ID="your-kakao-client-id" --app bodam
fly secrets set KAKAO_CLIENT_SECRET="your-kakao-client-secret" --app bodam
fly secrets set KAKAO_REDIRECT_URI="https://bodam.fly.dev/api/v1/auth/oauth/kakao/callback" --app bodam

fly secrets set NAVER_CLIENT_ID="your-naver-client-id" --app bodam
fly secrets set NAVER_CLIENT_SECRET="your-naver-client-secret" --app bodam
fly secrets set NAVER_REDIRECT_URI="https://bodam.fly.dev/api/v1/auth/oauth/naver/callback" --app bodam

fly secrets set GOOGLE_CLIENT_ID="your-google-client-id" --app bodam
fly secrets set GOOGLE_CLIENT_SECRET="your-google-client-secret" --app bodam
fly secrets set GOOGLE_REDIRECT_URI="https://bodam.fly.dev/api/v1/auth/oauth/google/callback" --app bodam
```

**Encryption keys (required for PII protection):**

```bash
# Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
fly secrets set SOCIAL_TOKEN_ENCRYPTION_KEY="your-fernet-key=" --app bodam
fly secrets set B2B_ENCRYPTION_KEY="your-fernet-key=" --app bodam
```

**CORS (update with your actual Vercel frontend URL):**

```bash
fly secrets set ALLOWED_ORIGINS="https://bodam-one.vercel.app" --app bodam
```

**Optional: OpenAI fallback LLM:**

```bash
fly secrets set OPENAI_API_KEY="your-openai-api-key" --app bodam
```

**Tip:** You can also import all secrets from a file at once:

```bash
# Copy the example file, fill in all values, then import
cp backend/.env.fly.example backend/.env.fly
# Edit backend/.env.fly with real values
fly secrets import < backend/.env.fly --app bodam
```

### Step 4: Run database migrations

Run Alembic migrations against the Fly Postgres database:

```bash
# Fly proxy로 로컬에서 DB 접속
fly proxy 5432 -a bodam-db &

# 마이그레이션 실행
cd backend
DATABASE_URL="postgresql+asyncpg://postgres:<password>@localhost:5432/bodam" alembic upgrade head
```

Or trigger migrations as part of the startup command by updating `backend/Dockerfile` CMD if not already done.

### Step 5: Deploy

```bash
fly deploy --app bodam
```

The first deploy will build the Docker image and push it to Fly.io. Subsequent deploys reuse the build cache.

---

## Verification

### Check deployment status

```bash
fly status --app bodam
```

### Check health endpoint

```bash
curl https://bodam.fly.dev/health
```

Expected response:
```json
{"status": "ok", "database": "connected", "timestamp": "..."}
```

### View live logs

```bash
fly logs --app bodam
```

### Open the app in browser

```bash
fly open --app bodam
```

---

## Complete Secrets Reference

The following secrets must be set. See `backend/.env.fly.example` for format details.

| Secret | Required | Description |
|--------|----------|-------------|
| `DATABASE_URL` | Yes | Fly Postgres 내부 접속 URL |
| `REDIS_URL` | Yes | Upstash Redis TLS URL (`rediss://`) |
| `SECRET_KEY` | Yes | JWT signing key (32-byte hex) |
| `GEMINI_API_KEY` | Yes | Google Gemini API key |
| `ALLOWED_ORIGINS` | Yes | Frontend Vercel domain (comma-separated) |
| `KAKAO_CLIENT_ID` | OAuth | Kakao developers app client ID |
| `KAKAO_CLIENT_SECRET` | OAuth | Kakao developers app client secret |
| `KAKAO_REDIRECT_URI` | OAuth | Kakao OAuth callback URL |
| `NAVER_CLIENT_ID` | OAuth | Naver developers app client ID |
| `NAVER_CLIENT_SECRET` | OAuth | Naver developers app client secret |
| `NAVER_REDIRECT_URI` | OAuth | Naver OAuth callback URL |
| `GOOGLE_CLIENT_ID` | OAuth | Google Cloud OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth | Google Cloud OAuth client secret |
| `GOOGLE_REDIRECT_URI` | OAuth | Google OAuth callback URL |
| `SOCIAL_TOKEN_ENCRYPTION_KEY` | Yes | Fernet key for social token encryption |
| `B2B_ENCRYPTION_KEY` | Yes | Fernet key for B2B customer PII encryption |
| `OPENAI_API_KEY` | Optional | OpenAI key for fallback LLM |

---

## Cost Estimate (MVP)

| Resource | Plan | Estimated Cost |
|----------|------|----------------|
| Fly.io VM (`shared-cpu-1x`, 512MB) | Auto-stop enabled | ~$0-5/month |
| Fly Postgres | 1GB RAM, 10GB disk | ~$0-7/month |
| Upstash Redis | Free tier (10K commands/day) | $0/month |

With `auto_stop_machines = 'stop'` and `min_machines_running = 0`, the VM stops when idle and only incurs cost when actively serving requests.

---

## Troubleshooting

**Build fails: Dockerfile not found**
- Ensure `fly.toml` is in the project root (not inside `backend/`)
- The `dockerfile = 'backend/Dockerfile'` path is relative to `fly.toml`

**App starts but health check fails**
- Verify `DATABASE_URL` is set correctly with `fly secrets list --app bodam`
- Check logs: `fly logs --app bodam`
- Fly Postgres의 pgvector는 마이그레이션에서 `CREATE EXTENSION IF NOT EXISTS vector`로 활성화

**Cold start delays**
- Expected with `auto_stop_machines = 'stop'` — first request after idle wakes the VM
- Set `min_machines_running = 1` in `fly.toml` to eliminate cold starts (adds ~$5/month)

**Secrets not applied**
- After setting secrets, redeploy: `fly deploy --app bodam`

**DB 접속 안 될 때**
- Fly Postgres 상태 확인: `fly status -a bodam-db`
- Fly 내부 DNS 확인: `bodam-db.flycast` (같은 organization 내에서만 접근 가능)
- Proxy로 로컬 테스트: `fly proxy 5432 -a bodam-db`
