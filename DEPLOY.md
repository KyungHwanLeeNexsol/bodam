# Bodam Backend - Fly.io Deployment Guide

## Prerequisites

Before deploying, you need the following services and tools set up.

### 1. Neon PostgreSQL (with pgvector)

1. Sign up at https://neon.tech
2. Create a new project (select region: `ap-northeast-1` for Tokyo proximity)
3. Enable the `pgvector` extension:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
4. Copy the connection string from: Dashboard > Connection Details
   - Use the **asyncpg** format: `postgresql+asyncpg://user:password@ep-xxx.ap-northeast-1.aws.neon.tech/bodam?sslmode=require`

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
# Database (Neon asyncpg connection string)
fly secrets set DATABASE_URL="postgresql+asyncpg://user:password@ep-xxx.ap-northeast-1.aws.neon.tech/bodam?sslmode=require" --app bodam

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

Run Alembic migrations against the Neon database before first deploy:

```bash
# From the backend directory
cd backend
DATABASE_URL="postgresql+asyncpg://..." alembic upgrade head
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
| `DATABASE_URL` | Yes | Neon PostgreSQL asyncpg connection string |
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
| Neon PostgreSQL | Free tier (3GB, 100 compute hours) | $0/month |
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
- Ensure Neon DB has `pgvector` extension enabled

**Cold start delays**
- Expected with `auto_stop_machines = 'stop'` — first request after idle wakes the VM
- Set `min_machines_running = 1` in `fly.toml` to eliminate cold starts (adds ~$5/month)

**Secrets not applied**
- After setting secrets, redeploy: `fly deploy --app bodam`
