# Bodam Insurance AI Platform - Technology Stack

**Document Version:** 1.1.0
**Last Updated:** 2026-03-15
**Status:** Phase 2 Features Implemented

---

## Executive Summary

Bodam is an AI-powered insurance claims analysis platform designed to process policy documents, analyze claims, and provide intelligent recommendations. The technology stack prioritizes cost-efficiency, scalability, and rapid development velocity through a carefully chosen combination of Python backend, Next.js frontend, and cloud infrastructure optimized for MVP deployment in South Korea.

**Key Design Decisions:**
- Python + FastAPI for AI/ML ecosystem maturity
- Next.js for rapid UI development with AI streaming
- PostgreSQL + pgvector for unified data and vector search
- Gemini 2.0 Flash as primary LLM for cost efficiency
- Docker Compose for MVP deployment
- AWS Seoul Region for data residency compliance

---

## Frontend Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| **Next.js** | 16.1.6 | React meta-framework with App Router, SSR, API routes |
| **React** | 19.2.3 | UI component library |
| **TypeScript** | 5.x | Type-safe JavaScript |
| **Tailwind CSS** | 4 | Utility-first CSS framework for rapid styling |
| **shadcn** | 4.0.6 | CLI tool for copying UI components |
| **class-variance-authority** | 0.7.1 | Component styling utilities |
| **react-hook-form** | 7.71.2 | Performant, flexible form state management |
| **zod** | 4.3.6 | TypeScript-first schema validation |
| **@hookform/resolvers** | 5.2.2 | Zod integration for react-hook-form |
| **lucide-react** | 0.577.0 | Icon library |
| **clsx** / **tailwind-merge** | 2.1.1 / 3.5.0 | Utility functions for className management |

### Frontend Design Rationale

**Why Next.js?**

Next.js 16.1.x with App Router provides production-grade infrastructure for rapidly building complex UIs. The Vercel AI SDK's `useChat` hook enables real-time LLM streaming directly in React components, transforming hours of custom streaming code into minutes of declarative JSX. This is particularly valuable for displaying policy analysis results and claim recommendations as they're computed by the backend.

The framework's built-in API routes eliminate the need for a separate proxy layer between frontend and backend, simplifying deployment. Image optimization and code splitting are automatic, ensuring fast page loads critical for mobile-first insurance users.

**Why Tailwind CSS 4.2.x?**

Tailwind 4.2 brings container query support and performance improvements that are essential for responsive design across mobile, tablet, and desktop devices. Insurance claim analysis requires clear information hierarchy and accessibility—Tailwind's constraint-based approach ensures consistent spacing and color systems.

**Why shadcn/ui?**

shadcn/ui provides unstyled, composable Radix UI primitives wrapped with Tailwind styling. Unlike monolithic component libraries, shadcn allows copying components directly into the project for fine-grained customization. This is critical for insurance compliance where precise control over form validation, error messaging, and accessibility features is required.

**Why Vercel AI SDK 6.x?**

The AI SDK's `useChat` hook handles all streaming complexity:
- Automatic request deduplication
- Built-in error retry with exponential backoff
- Optimistic UI updates while awaiting server response
- Type-safe integration with OpenAI, Anthropic, and Google APIs

For policy analysis UI, this means the frontend can render streaming policy insights line-by-line without manual WebSocket management.

**Why Auth.js v5?**

Auth.js provides enterprise-grade authentication without forcing a monolithic auth platform:
- OAuth support for Korean services (KakaoTalk, Naver)
- JWT and session token strategies
- Database-agnostic session storage (PostgreSQL via SQLAlchemy)
- Built-in CSRF protection

---

## Backend Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| **Python** | 3.13+ | Primary backend language with mature AI/ML ecosystem |
| **FastAPI** | >=0.135.0,<0.136.0 | Async web framework with auto-generated OpenAPI documentation |
| **Pydantic** | >=2.12.0,<2.13.0 | Type-safe data validation and serialization |
| **pydantic-settings** | >=2.7.0 | Environment variable management |
| **bcrypt** | >=4.0.0 | Password hashing (used directly instead of passlib for Python 3.13 compatibility) |
| **python-jose[cryptography]** | >=3.3.0 | JWT token generation and verification |
| **cryptography** | >=43.0.0 | Symmetric encryption for PII in B2B agent client management |
| **langchain-core** | >=0.3.0,<0.4.0 | Lightweight LLM framework core |
| **langchain-openai** | >=0.3.0,<0.4.0 | OpenAI LLM integration |
| **langchain-google-genai** | >=2.0.0,<3.0.0 | Google Gemini LLM integration |
| **google-generativeai** | >=0.8.0 | Gemini Files API for on-demand PDF analysis |
| **Celery** | >=5.4.0 | Async background task processing |
| **structlog** | >=24.0.0 | Structured logging for LLM metrics and analytics |
| **tenacity** | >=9.0.0 | Retry library for exponential backoff on API failures |
| **SQLAlchemy** | >=2.0.0 | ORM for database operations and relationships |
| **asyncpg** | >=0.30.0 | PostgreSQL async driver |
| **Alembic** | >=1.14.0 | Database migration management |
| **Playwright** | >=1.49.0 | Web scraping for insurance disclosure pages |
| **pydantic[email]** | >=2.12.0,<2.13.0 | Email validation support (EmailStr type) |
| **OpenAI** | >=1.60.0 | OpenAI API client |
| **tiktoken** | >=0.8.0 | Token counting for OpenAI models |
| **pdfplumber** | >=0.11.0 | PDF parsing and text extraction |
| **pgvector** | >=0.3.6 | Vector database extension |
| **Redis** | >=5.2.0 | Redis client for caching and message broker |
| **prometheus-client** | >=0.21.0 | Prometheus metrics collection |

### Backend Design Rationale

**Why Python + FastAPI?**

Python dominates the AI/ML ecosystem. LangChain, embeddings, OCR libraries, and NLP tools are all Python-first. FastAPI provides:

- **ASGI async runtime** for handling concurrent requests without threading complexity
- **Automatic OpenAPI documentation** at `/docs` endpoint—no manual Swagger maintenance
- **Type hints as first-class citizens** with Pydantic integration for automatic request validation
- **Real-time performance** competitive with Go/Node for I/O-bound workloads (policy analysis involves I/O to LLM APIs)

For a 1-person team, this reduces cognitive overhead versus managing three languages (TypeScript + Go + Python).

**Why Pydantic 2.12.x?**

Pydantic v2's JSON schema generation enables:
- Automatic validation of claim data, policy documents, and API payloads
- Type-safe database model definitions with SQLAlchemy integration
- Deterministic serialization for caching policy analysis results
- Field validators for business logic (e.g., claim amount cannot be negative)

**Why LangChain 1.2.x?**

LangChain abstracts away LLM-specific APIs. If Gemini API changes or becomes cost-prohibitive, switching to OpenAI requires changing one environment variable, not rewriting prompt orchestration logic.

LangChain provides:
- **Prompt templates** for consistent policy analysis prompts
- **Output parsers** for structured extraction (e.g., claim decision, confidence score)
- **Memory management** for multi-turn claim analysis conversations
- **Chain composition** for complex workflows (e.g., extract claim terms → lookup policy → analyze → recommend)

**Why Celery 5.x?**

Policy analysis is compute-intensive. A 200-page insurance policy can take 30+ seconds for Gemini to analyze. Celery enables:
- **Request-response decoupling** so the API returns immediately with a job ID
- **Long-polling or WebSocket** for frontend to check analysis status
- **Retry logic** with exponential backoff for transient API failures
- **Task prioritization** so urgent claims are analyzed before routine claims

Redis as the message broker (see Database section).

**Why Playwright?**

Insurance companies publish policy documents, disclosure statements, and terms on public websites. Playwright enables:
- **Automated scraping** of policy documents from insurance company websites
- **JavaScript rendering** for dynamic content (some websites load PDFs via JavaScript)
- **Headless browser automation** for extracting structured data from unstructured HTML

This is critical for building the ground truth dataset of insurance policies to feed into the RAG pipeline.

**Why google-generativeai?**

The Gemini 2.0 Flash API with 1M token context window enables real-time analysis of user-uploaded insurance policies without requiring database entry. The google-generativeai library provides direct Files API support for:
- **Direct PDF upload and analysis**: Send policy PDFs directly to Gemini without conversion
- **Rapid processing**: 1M context window accommodates 200-page policies in a single request
- **Cost efficiency**: ~$0.02 per policy analysis at Gemini 2.0 Flash pricing ($0.10/MTok)
- **Flexible coverage**: Support for non-indexed policies, regional variants, custom policies

This enables SPEC-PDF-001 on-demand analysis feature without modifying the core RAG database.

---

## Database Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| **PostgreSQL** | 18.x | Primary relational database for structured data |
| **pgvector** | 0.8.2 | Vector similarity search extension for RAG and case precedents |
| **Redis** | 7.x | Caching, session store, Celery message broker |

### Database Design Rationale

**Why PostgreSQL 18.x + pgvector?**

Instead of managing a separate vector database (Pinecone, Weaviate, Qdrant), pgvector embeddings live in the same PostgreSQL instance as relational policy data:

```
SELECT policies.name, policies.coverage_amount
FROM policies
WHERE policy_vector <-> query_embedding < 0.15  -- cosine distance < 0.15
ORDER BY policy_vector <-> query_embedding
LIMIT 5;
```

This enables hybrid queries combining:
- **Vector similarity** for semantic policy matching ("collision coverage" ≈ "accident protection")
- **SQL WHERE clauses** for business logic (policy_issued_date > '2023-01-01')

pgvector's HNSW indexing handles up to 1M vectors efficiently, sufficient for MVP containing ~10K policies × ~10 chunks per policy = 100K vectors.

**Why Redis 7.x?**

Redis serves three purposes:
1. **Session store** for Auth.js JWT tokens
2. **Cache** for LLM responses (same policy questions cache for 1 hour)
3. **Celery message broker** for task queue communication

Using a single Redis instance eliminates operational complexity. Upgrade path to Redis Cluster or Amazon ElastiCache exists at scale.

---

## AI/LLM Stack

| Technology | Purpose | Cost Model |
|-----------|---------|-----------|
| **Gemini 2.0 Flash** | Primary LLM for policy analysis | $0.10/MTok input |
| **Gemini 2.5 Flash** | Complex multi-step reasoning | Mid-tier |
| **GPT-4o** | Structured analysis fallback | Higher cost |
| **GPT-4o-mini** | Query classification and routing | Low cost |
| **text-embedding-3-small** | Policy vector embeddings | $0.02/MTok |

### LLM Strategy Rationale

**Why Gemini 2.0 Flash as Primary?**

The critical innovation in Gemini 2.0 Flash is the **1M token context window** combined with exceptional cost efficiency:

- **Policy document processing**: 200-page insurance policies (~80K tokens) fit entirely in context
- **Cost per document**: At $0.10/MTok with 1M token limit, analyzing a 200-page policy costs ~$0.02
- **Ground truth extraction**: Feeding entire policy documents to the LLM ensures accuracy that fine-tuned smaller models cannot achieve

GPT-4o's $2.50/MTok input cost makes economically infeasible the core business model of "analyze any insurance policy on-demand for $0.01-0.05."

**Fallback Strategy**: Use Gemini 2.5 Flash for claim cases requiring multi-step reasoning (e.g., "does this claim qualify under Section 3.2.1 AND the rider in Section 8?"). Fall back to GPT-4o only when Gemini rates are exceeded or for security-sensitive operations.

**Query Routing**: Use GPT-4o-mini ($0.15/MTok) to classify incoming user queries ("Is this a policy question or claim question?") to route to appropriate backend pipeline. This costs ~$0.0001 per query but saves time routing to wrong pipeline.

**Embeddings**: Use text-embedding-3-small for all policy vector embeddings. For RAG, you need millions of chunks; the 3x cost reduction vs. larger models is justified by MVP constraints.

---

## Infrastructure Stack

| Technology | Purpose |
|-----------|---------|
| **Docker + Docker Compose** | Local development and MVP deployment |
| **AWS Seoul Region (ap-northeast-2)** | Cloud hosting with Korean data residency |
| **EC2** | Application server |
| **RDS PostgreSQL** | Managed database service |
| **S3** | Policy document storage and backups |
| **GitHub Actions** | CI/CD pipeline |
| **Sentry** | Error tracking and performance monitoring |
| **LangSmith** | LLM debugging and prompt optimization |

### Infrastructure Design Rationale

**Why Docker Compose (not Kubernetes)?**

For a 1-person team, Kubernetes operational overhead is unjustified:
- 80 hours to learn Kubernetes + 10 hours/week to maintain it
- Docker Compose allows production-grade setup (PostgreSQL, Redis, FastAPI) with 3 commands: `docker compose build`, `docker compose up`, `docker logs`

**Scaling path**: When user base exceeds capacity, migrate to AWS ECS Fargate (serverless containers) without rewriting deployment configuration—Docker Compose and Fargate use identical container images.

**Why AWS Seoul Region?**

- **Data residency compliance**: Korean financial regulations (개인정보보호법, PIPA) require customer data on Korean servers
- **Free tier utilization**: $300 credit covers EC2 + RDS for 6 months
- **Larger ecosystem**: More Korean regional support and documentation
- **NCP hybrid option**: If financial institution insurance customers require NCP, AWS services integrate with NCP via AWS Direct Connect

**Why S3 for Document Storage?**

Policy documents and claim attachments are large files (PDF, images) that shouldn't live in PostgreSQL. S3 provides:
- Automatic backups and disaster recovery
- Access control per document (signed URLs for per-claim document access)
- Integration with Lambda for document processing at scale

---

## Development Tools

| Technology | Purpose |
|-----------|---------|
| **pnpm** | Frontend package manager (faster than npm) |
| **uv** | Python package manager (10x faster than pip) |
| **Ruff** | Python linter and formatter (50x faster than Flake8) |
| **ESLint + Prettier** | TypeScript linting and formatting |
| **Vitest** | Frontend unit testing with Vite speed |
| **pytest** | Backend unit testing with coverage reporting |
| **Playwright Test** | End-to-end browser testing |

### Dev Tools Rationale

**Why uv instead of pip?**

`uv` is a Rust-based Python package manager that's 10-100x faster than pip for dependency resolution. For a project with 20+ dependencies (FastAPI, LangChain, SQLAlchemy, etc.), `pip install` can take 2-3 minutes; `uv pip install` takes 10 seconds.

**Why Ruff instead of Flake8?**

Ruff is 50-100x faster at linting and combines the functionality of Flake8, isort, and Black:
- `ruff check --fix` formats and lints in a single pass
- Runs on every save in editor, providing instant feedback
- Pre-commit hooks complete in <1 second

**Why Vitest for frontend testing?**

Vitest provides Jest-compatible API but runs 5-10x faster by using Vite's ES module native support. For rapid iteration, test feedback latency matters—Vitest enables TDD without waiting 10 seconds per test run.

---

## Cost Analysis

### Estimated Monthly Operational Costs (MVP)

| Item | Cost Range | Notes |
|------|-----------|-------|
| **AWS (EC2 t3.medium + RDS PostgreSQL 15GB + S3)** | $50-150 | Covers 1K-5K policies, ~10K policy chunks in pgvector |
| **Gemini API (1M tokens/month)** | $5-40 | At 10 analyses/day of 200-page documents (~80K tokens each) |
| **OpenAI API (embeddings + GPT-4o-mini routing)** | $0.50-5 | Embedding 100K vectors at $0.02/MTok = ~$2; routing = ~$1 |
| **Vercel (frontend hosting)** | $0-20 | Free tier sufficient for MVP; upgrade to Pro at 50K users |
| **Sentry (error tracking)** | $0 | Free tier: 5K errors/month |
| **LangSmith (LLM debugging)** | $0 | Free tier: 100 LLM traces/month |
| **GitHub (source control)** | $0 | Free tier sufficient |
| **Total Monthly Cost** | **$55-215** | Scales sublinearly; cost per policy analysis = $0.001-0.01 |

---

## Development Environment Requirements

### Local Machine Setup

- **Node.js**: 22 LTS (for `nvm install 22`)
- **Python**: 3.13+ (for `pyenv install 3.13.0`)
- **Docker Desktop**: Latest (includes Docker and Docker Compose)
- **Git**: Latest version
- **Editor**: VS Code with Python, TypeScript, and Docker extensions

### Docker Containers (Local Development)

```yaml
Services:
  - PostgreSQL 18: Database on port 5432
  - Redis 7: Cache and message broker on port 6379
  - FastAPI: Backend API on port 8000
  - Next.js: Frontend on port 3000
```

**Getting Started**:

1. Clone repository
2. Copy `.env.example` to `.env` with local values
3. Run `docker compose up`
4. Access frontend at `http://localhost:3000`
5. Access API docs at `http://localhost:8000/docs`

---

## Deployment Checklist

### Pre-Production (AWS Seoul Region)

- [ ] Create AWS account with billing alerts at $500/month
- [ ] Configure EC2 security groups (22 for SSH, 80/443 for HTTP/HTTPS)
- [ ] Create RDS PostgreSQL instance with automated backups (daily)
- [ ] Create S3 bucket for policy documents with versioning enabled
- [ ] Configure Route53 DNS pointing to EC2 instance
- [ ] Set up CloudWatch alarms for error rates and latency
- [ ] Enable AWS WAF (Web Application Firewall) for DDoS protection

### CI/CD Pipeline

- [ ] GitHub Actions workflows for automated testing on push
- [ ] Automated PostgreSQL migrations on deployment
- [ ] Zero-downtime deployment with health checks
- [ ] Automated rollback on deployment failure

### Security Hardening

- [ ] Enable HTTPS with AWS Certificate Manager
- [ ] Rotate database passwords monthly
- [ ] Enable PostgreSQL encryption at rest
- [ ] Implement API rate limiting (10 requests/minute per user)
- [ ] Audit Sentry for security-related errors

---

## Technology Decisions Summary Table

| Decision | Choice | Alternatives Considered | Rationale |
|----------|--------|------------------------|-----------|
| **Backend Framework** | FastAPI | Django, Flask, Go | Async support + auto-docs + type safety + AI ecosystem |
| **Frontend Framework** | Next.js | Vue, Svelte, Remix | Vercel AI SDK + shadcn/ui ecosystem + SSR/SEO |
| **Primary LLM** | Gemini 2.0 Flash | GPT-4o, Claude | 1M token context + $0.10/MTok cost efficiency |
| **Vector DB** | pgvector | Pinecone, Qdrant | Single database for relational + vector data |
| **Deployment** | Docker Compose → ECS Fargate | Kubernetes | Minimal ops burden for MVP, scalable path |
| **Package Manager (Python)** | uv | pip, Poetry | 10x speed improvement for dependency resolution |

---

## Migration Paths

### Scaling to Production (Year 1)

**Phase 1 (Months 1-3)**: Docker Compose on single EC2 instance with manual scaling.

**Phase 2 (Months 4-6)**: Migrate to AWS ECS Fargate with auto-scaling based on CPU/memory, upgrade RDS to multi-AZ for high availability.

**Phase 3 (Months 7-12)**: Introduce separate microservices: policy ingestion service, claim analysis service, embedding generation service. Each scales independently.

### LLM Migration Path

If Gemini becomes cost-prohibitive:
1. Maintain LangChain abstraction layer (no code changes required)
2. Switch to open-source Llama 3.1 405B (via vLLM) running on GPU instances
3. Cost-benefit: $2K/month for GPU instances vs. $1K/month Gemini savings

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.1.0 | 2026-03-18 | Updated with verified version numbers from pyproject.toml and package.json (March 2026) |
| 1.0.0 | 2026-03-13 | Initial technology stack documentation with verified version numbers (March 2026) |

---

## References

### Official Documentation Links

- **Next.js**: https://nextjs.org/docs
- **React**: https://react.dev
- **FastAPI**: https://fastapi.tiangolo.com
- **PostgreSQL**: https://www.postgresql.org/docs/
- **pgvector**: https://github.com/pgvector/pgvector
- **LangChain**: https://python.langchain.com
- **Gemini API**: https://ai.google.dev
- **Docker**: https://docs.docker.com
- **AWS Seoul Region**: https://docs.aws.amazon.com/general/latest/gr/rande.html

### Compliance References

- **Korean PIPA (개인정보보호법)**: Data residency in Korea required
- **Financial Supervisory Service (FSS)**: Insurance industry regulations
- **OWASP Top 10**: Security best practices for insurance data

---

**Document Maintainer**: Bodam Engineering Team
**Last Review**: 2026-03-18
**Next Review**: 2026-06-18 (quarterly technology assessment)