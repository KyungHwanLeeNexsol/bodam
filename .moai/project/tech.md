# Tech Stack

## Backend

| Category | Technology | Version |
|----------|-----------|---------|
| Language | Python | 3.13+ |
| Web framework | FastAPI | 0.135.x |
| ASGI server | Uvicorn | 0.34+ |
| Data validation | Pydantic v2 | 2.12.x |
| ORM | SQLAlchemy (async) | 2.0+ |
| DB driver | asyncpg | 0.30+ |
| Migrations | Alembic | 1.14+ |
| Task queue | Celery + Redis | 5.4+ |
| PDF parsing | pdfplumber | 0.11+ |
| Web crawling | Playwright | 1.49+ (SPA), httpx (static) |
| Embeddings | sentence-transformers (BAAI/bge-m3) | 3.0+ |
| Vector index | pgvector | 0.3.6+ |
| Token counting | tiktoken | 0.8+ |
| LLM SDKs | langchain-openai, langchain-google-genai | 0.3.x / 2.0.x |
| Auth | python-jose (JWT), bcrypt | 3.3+ / 4.0+ |
| Logging | structlog | 24.0+ |
| Metrics | prometheus-client | 0.21+ |
| Retry logic | tenacity | 9.0+ |
| Package manager | uv | latest |
| Linter | ruff | 0.8+ |

## Frontend

| Category | Technology |
|----------|-----------|
| Framework | Next.js (App Router) |
| Language | TypeScript |
| UI components | shadcn/ui |
| Package manager | pnpm |

## Infrastructure

### Database
- **PostgreSQL 18** with **pgvector** extension
- Hosted on **Fly.io** (app: `bodam-db`, region: Singapore `sin`)
- Vector index on `policy_chunks.embedding` (1024-dim, BAAI/bge-m3)
- Full-text search via PostgreSQL `tsvector` on `policy_chunks.search_vector`

### Cache & Queue
- **Redis 7** (Alpine) for Celery task broker and result backend
- Also used for API rate limiting state

### Object Storage
- **Local filesystem** (default) or **AWS S3** for crawled PDFs
- Configurable via `CRAWLER_STORAGE_BACKEND` env var

### Container
- Docker Compose for local development (postgres, redis, backend, frontend, MinIO)
- **Fly.io** for production deployment (app: `bodam`, region: `sin`)
  - `shared-cpu-1x`, 512 MB RAM
  - Auto-start/stop machines (`min_machines_running = 0`)
  - HTTPS enforced
  - Health check: `GET /api/v1/health` every 30s

## LLM Configuration

| Role | Model | Notes |
|------|-------|-------|
| Primary answering | `gemini-2.0-flash` | Lower cost, fast |
| Fallback answering | `gpt-4o` | Higher quality |
| Query classification | `gpt-4o-mini` | Intent routing |
| Embeddings | `BAAI/bge-m3` (local) | 1024-dim, Korean-capable |

- Confidence threshold: 0.7 (below → fallback to GPT-4o)
- Cost tracking enabled per request

## CI/CD

- **GitHub Actions** for all crawl + ingest workflows
- Per-company workflow triggered manually (`workflow_dispatch`)
- Each job connects to Fly.io PostgreSQL via `flyctl proxy` tunnel
- Failure state saved as artifact for partial re-run (`resume_state.json`)
- Job timeout: 6 hours (Actions maximum)
- Dependency install: `uv sync --frozen`

## Security

- JWT HS256 with configurable expiry (default: 30 min)
- Social OAuth2: Kakao, Naver, Google
- Social token encryption: Fernet symmetric key
- B2B PII encryption: Fernet symmetric key (PIPA compliance)
- CORS: configurable allowed origins via env var
- Rate limiting: 60 req/min (general), 10 req/min (auth), 100 chats/day (user)

## Key Environment Variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection (asyncpg) |
| `REDIS_URL` | Redis connection |
| `SECRET_KEY` | JWT signing key |
| `OPENAI_API_KEY` | GPT-4o / gpt-4o-mini |
| `GEMINI_API_KEY` | Gemini 2.0 Flash |
| `EMBEDDING_PROVIDER` | `local` (bge-m3) or `gemini` |
| `CRAWLER_STORAGE_BACKEND` | `local` or `s3` |
| `B2B_ENCRYPTION_KEY` | Fernet key for PII |
| `SOCIAL_TOKEN_ENCRYPTION_KEY` | Fernet key for OAuth tokens |
| `FLY_API_TOKEN` | Fly.io proxy access (CI only) |
