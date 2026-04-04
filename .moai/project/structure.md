# Project Structure

## Repository Layout

```
bodam/
├── backend/                    # Python/FastAPI backend
│   ├── app/                    # Application source
│   │   ├── main.py             # FastAPI app entry point
│   │   ├── api/v1/             # REST API routes
│   │   ├── core/               # Config, DB, security
│   │   ├── models/             # SQLAlchemy ORM models
│   │   ├── schemas/            # Pydantic request/response schemas
│   │   ├── services/           # Business logic layer
│   │   ├── tasks/              # Celery task definitions
│   │   ├── workers/            # Celery worker setup
│   │   └── providers/          # External service adapters
│   ├── scripts/                # One-off crawl/ingest scripts
│   ├── tests/                  # pytest test suite
│   └── pyproject.toml          # Dependencies and tooling config
├── frontend/                   # Next.js frontend
│   ├── app/                    # Next.js App Router pages
│   ├── components/             # React UI components
│   ├── services/               # API client layer
│   └── lib/                    # Shared utilities
├── .github/workflows/          # GitHub Actions CI/CD
├── infra/                      # Infrastructure configs
│   └── searxng/                # SearXNG search engine deployment
│       ├── fly.toml            # Fly.io SearXNG app config
│       ├── Dockerfile          # SearXNG Docker image
│       └── settings.yml        # SearXNG engine settings (Google, Bing)
├── docker-compose.yml          # Local dev stack
├── fly.toml                    # Fly.io deployment config
└── Dockerfile                  # Backend container image
```

## Backend Architecture

### API Layer (`app/api/v1/`)

| Route module | Responsibility |
|--------------|----------------|
| `auth.py`, `oauth.py` | JWT auth, social login (Kakao/Naver/Google) |
| `chat.py` | Conversational AI endpoint |
| `search.py` | Policy semantic search |
| `crawler.py` | Trigger crawl/ingest jobs |
| `pipeline.py` | Ingest pipeline status |
| `pdf.py` | PDF upload and processing |
| `users.py` | User profile management |
| `guidance.py` | Policy guidance generation |
| `b2b/` | B2B partner API |
| `admin/` | Admin management API |
| `health.py` | Health check (`/api/v1/health`) |

### Service Layer (`app/services/`)

```
services/
├── crawler/                    # Policy document crawling
│   ├── base.py                 # BaseCrawler abstract class
│   ├── config/                 # Per-company crawl configs (YAML)
│   ├── config_loader.py        # YAML config loader
│   ├── policy_ingestor.py      # PDF parse → DB ingest pipeline
│   ├── storage.py              # Local/S3 PDF storage
│   ├── registry.py             # Crawler registry
│   └── companies/
│       ├── nonlife/            # DB, Hyundai Marine, KB, generic
│       └── life/               # Samsung Life, Hanwha, Kyobo, Shinhan, etc.
├── jit_rag/                    # Just-In-Time RAG (on-demand document processing)
│   ├── __init__.py             # Package initialization
│   ├── document_finder.py      # Product name → URL search (FSS, insurer sites, web search)
│   ├── document_fetcher.py     # URL → document download (PDF/HTML, async, retry)
│   ├── text_extractor.py       # PDF/HTML → structured text (pymupdf, section detection)
│   ├── session_store.py        # Redis session document cache (TTL 1 hour)
│   ├── section_finder.py       # Question → relevant section extraction (full-text or BM25)
│   └── config.py               # JIT RAG configuration constants
├── rag/                        # Retrieval-Augmented Generation
│   ├── vector_store.py         # pgvector similarity search
│   ├── hybrid_search.py        # Vector + full-text hybrid
│   ├── embeddings.py           # BAAI/bge-m3 embedding generation
│   ├── fulltext_search.py      # PostgreSQL tsvector search
│   ├── rewriter.py             # Query rewriting
│   └── chain.py                # RAG chain orchestration
├── llm/                        # LLM routing and quality
│   ├── router.py               # Primary/fallback model routing
│   ├── classifier.py           # Query intent classification
│   ├── quality.py              # Response quality scoring
│   ├── models.py               # LLM model definitions
│   └── metrics.py              # Cost and usage tracking
├── chat_service.py             # Chat session management (uses JIT RAG)
├── auth_service.py             # Authentication logic
├── oauth_service.py            # OAuth2 flow handling
├── privacy_service.py          # PII encryption/decryption
├── b2b/                        # B2B customer management
├── pdf/                        # PDF parsing with pdfplumber
├── guidance/                   # Policy guidance generation
└── parser/                     # Document structure parsing
```

### Data Model (`app/models/`)

```
InsuranceCompany (1)
    └── Policy (N)              # 약관 (product_code unique per company)
            ├── Coverage (N)    # 보장 항목 (coverage clauses)
            └── PolicyChunk (N) # RAG chunks with Vector(1024) embedding
```

Additional models: `User`, `Chat`, `Organization`, `OrganizationMember`, `APIKey`, `UsageRecord`, `CasePrecedent`, `AccessLog`, `Pipeline`, `SocialAccount`

### Key Design Patterns

- **Repository pattern**: All DB access through SQLAlchemy async sessions
- **Dependency injection**: FastAPI `Depends()` for settings, DB session, current user
- **Crawler abstraction**: `BaseCrawler` → company-specific subclasses; YAML config per company
- **LLM routing**: Classifier determines intent → router selects Gemini (primary) or GPT-4o (fallback)
- **Chunking**: Token-based splitting (tiktoken), 500 tokens/chunk, 100 token overlap

## GitHub Actions Workflows (`.github/workflows/`)

17 workflows covering per-company crawl+ingest jobs:
- One workflow per insurance company (e.g., `ingest-samsung-fire.yml`)
- `embedding-backfill.yml` / `backfill-embeddings.yml`: Backfill missing embeddings
- All workflows connect to Fly.io PostgreSQL via `flyctl proxy` tunnel
