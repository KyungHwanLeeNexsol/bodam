# Product Overview: Bodam

## Summary

Bodam is an AI-powered insurance policy (약관) platform for the Korean market. It automatically crawls PDF policy documents from major Korean insurance companies, processes and stores them in a vector database, and provides a semantic search and conversational AI interface for policy inquiry.

## Core Value Proposition

Korean insurance policies are notoriously complex and difficult to understand. Bodam bridges this gap by:
- Aggregating policy documents from 15+ insurance companies in one place
- Enabling natural language questions about coverage, exclusions, and eligibility
- Providing accurate, source-cited answers backed by the actual policy text

## Key Features

### 1. Automated Policy Ingestion
- Crawls PDF policy documents from Korean insurance company websites
- Supports both standard HTTP crawling and SPA-based crawling (Playwright)
- Parses PDF text using pdfplumber and splits into overlapping chunks
- Generates semantic embeddings (BAAI/bge-m3, 1024-dim) for each chunk

### 2. Semantic Search (RAG)
- Vector similarity search using pgvector on PostgreSQL
- Hybrid search combining vector similarity and PostgreSQL full-text search (tsvector)
- Configurable top-k retrieval and similarity threshold (default: top 5, threshold 0.3)
- Query rewriting for improved recall

### 2.1 Just-In-Time Policy Search (JIT RAG)
- Real-time policy document search via SearXNG meta-search engine (self-hosted on Fly.io)
- 4-stage search strategy: insurer site → insurance associations → web PDF → general web
- Automatic product name extraction from user questions
- PDF/HTML document fetching and text extraction (pdfplumber, pymupdf, OCR)
- Relevant section finding within extracted documents
- Redis caching (1-hour TTL) for frequently searched policies
- DuckDuckGo fallback for SearXNG resilience
- Search failure user guidance: PDF upload recommendation for missing policies

### 3. Conversational AI Chat
- Chat interface backed by RAG-retrieved policy chunks as context
- LLM routing: Gemini 2.0 Flash (primary) with GPT-4o fallback
- Query classification to route to appropriate LLM
- Response quality scoring and confidence-based fallback

### 4. Policy Data Management
- Structured storage: InsuranceCompany → Policy → Coverage → PolicyChunk hierarchy
- Three insurance categories: LIFE, NON_LIFE, THIRD_SECTOR
- Policy lifecycle tracking: effective date, expiry date, sale status

### 5. User & B2B Platform
- JWT-based authentication with social login (Kakao, Naver, Google OAuth2)
- Rate limiting per tier (general: 60 req/min, auth: 10 req/min, daily chat: 100)
- B2B customer management with PII encryption (Fernet symmetric key, PIPA compliance)
- Usage tracking and cost monitoring per LLM call

## Target Users

| Persona | Need |
|---------|------|
| Individual consumer | Understand their insurance policy before filing a claim |
| Insurance agent | Quickly compare coverage across multiple products |
| B2B partner (fintech, HR platform) | Embed insurance Q&A into their service |

## Business Value

- Reduces time to understand policy terms from hours to seconds
- Decreases customer support burden for insurance companies
- Enables compliance-friendly policy comparison (cites exact source text)
- Scales to cover the entire Korean insurance market (~15 companies currently)

## Covered Insurance Companies

**Non-life (손해보험):** Samsung Fire (삼성화재), DB Insurance (DB손해보험), Hyundai Marine & Fire (현대해상), KB Insurance (KB손해보험), Meritz Fire (메리츠화재), AXA General, NH Fire (NH손해보험), Lotte Insurance (롯데손해보험), Heungkuk Fire (흥국화재), MG Insurance

**Life (생명보험):** Samsung Life (삼성생명), Hanwha Life (한화생명), Kyobo Life (교보생명), Shinhan Life (신한라이프), NH Life, Heungkuk Life, Mirae Asset Life, Dongyang Life
