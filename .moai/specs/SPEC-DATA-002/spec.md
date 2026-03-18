---
id: SPEC-DATA-002
version: 1.0.0
status: in-progress
created: 2026-03-18
updated: 2026-03-18
author: zuge3
priority: critical
issue_number: 0
tags: [crawler, insurance, data-collection, life-insurance, nonlife-insurance, embedding]
dependencies: [SPEC-CRAWLER-001, SPEC-CRAWLER-003, SPEC-EMBED-001]
blocks: []
---

# SPEC-DATA-002: 보험 약관 전체 수집 - 질병/상해 전 상품 (판매중+판매중지)

## HISTORY

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-03-18 | zuge3 | Initial - 4-phase data collection plan |

---

## 1. Environment

### 1.1 Current State

Bodam platform has collected 160 products from KLIA exclusive-use disclosure page (배타적사용권 신약관 공시), generating 2,814 chunks with 100% embedding completion. This covers only a small fraction of all insurance products.

### 1.2 Target State

Collect ALL disease(질병) and injury(상해) insurance policy documents from Korean insurance companies, including both active (판매중) and discontinued (판매중지) products.

### 1.3 Data Sources

| Source | Type | Status | Est. Products |
|--------|------|--------|---------------|
| KLIA (배타적사용권) | Life Association | Done | 160 |
| PubInsure (pub.insure.or.kr) | Life Association | Phase 1 - Code exists | 500-2000 |
| Individual Life Insurers (8) | Company-specific | Phase 2 - YAML validation | 1000-5000 |
| KB Non-Life | Non-Life Company | Phase 3 - New development | 500-2000 |
| DB Non-Life | Non-Life Company | Phase 3 - New development | 500-2000 |
| Other Non-Life Insurers | Non-Life Companies | Phase 3 - New development | 1000-3000 |
| Automation | Scheduler | Phase 4 - Integration | N/A |

---

## 2. Requirements (EARS Format)

### Phase 1: PubInsure Crawler Execution

**REQ-P1-01**: When the operator runs `crawl --crawler pubinsure`, the system SHALL crawl pub.insure.or.kr for all 10 life insurance product categories across 22 companies.

**REQ-P1-02**: The system SHALL download PDF files and store them in local storage with the existing pipeline (parse -> chunk -> embed).

**REQ-P1-03**: The system SHALL use API key rotation (GEMINI_API_KEYS) for embedding generation to avoid rate limits.

### Phase 2: Individual Life Insurer Crawling

**REQ-P2-01**: For each of the 8 life insurance companies (Samsung, Kyobo, Shinhan, Hanwha, Heungkuk, Dongyang, Mirae, NH), the system SHALL validate and update YAML CSS selectors against current website HTML.

**REQ-P2-02**: The system SHALL support both ON_SALE and DISCONTINUED product filtering using the sale_status field.

**REQ-P2-03**: The system SHALL handle company-specific PDF download patterns (e.g., Kyobo URL normalization).

### Phase 3: Non-Life Insurance Crawlers

**REQ-P3-01**: The system SHALL implement KB Non-Life crawler targeting `kbinsure.co.kr/CG802030001.ec` with sale status filtering.

**REQ-P3-02**: The system SHALL implement DB Non-Life crawler targeting `idbins.com/FWMAIV1534.do` using the `/cYakgwanDown.do` endpoint.

**REQ-P3-03**: The system SHALL implement GenericNonLife YAML configs for remaining non-life insurers (Hyundai Marine, Meritz, etc.).

**REQ-P3-04**: The system SHALL filter for disease(질병) and injury(상해) categories only, excluding auto insurance and property insurance.

### Phase 4: Automation & Monitoring

**REQ-P4-01**: The `run_pipeline.py crawl --all` command SHALL execute all registered crawlers sequentially.

**REQ-P4-02**: The system SHALL provide crawler health monitoring showing per-company success rates and last crawl timestamps.

---

## 3. Acceptance Criteria

### Phase 1
- [ ] AC-P1-01: PubInsure crawler runs and discovers 100+ products
- [ ] AC-P1-02: PDFs downloaded and stored in `data/crawled_pdfs/`
- [ ] AC-P1-03: PolicyChunk records created with embeddings in Neon DB
- [ ] AC-P1-04: No rate limit failures (API key rotation working)

### Phase 2
- [ ] AC-P2-01: At least 3 life insurers' YAML selectors validated and working
- [ ] AC-P2-02: sale_status correctly parsed (ON_SALE/DISCONTINUED)
- [ ] AC-P2-03: GenericLife crawler successfully processes validated companies

### Phase 3
- [ ] AC-P3-01: KB Non-Life crawler downloads disease/injury product PDFs
- [ ] AC-P3-02: DB Non-Life crawler downloads disease/injury product PDFs
- [ ] AC-P3-03: At least 2 additional non-life insurers configured

### Phase 4
- [ ] AC-P4-01: `crawl --all` executes all crawlers in sequence
- [ ] AC-P4-02: Health status API reports per-crawler statistics

---

## 4. Technical Approach

### Phase 1 (Immediate)
- Execute existing `pubinsure_life_crawler.py` via `run_pipeline.py`
- Add `pubinsure` option to `_create_crawler()` in `run_pipeline.py`
- Use API key rotation for embedding generation
- Process PDFs with TextCleaner (NULL byte removal)

### Phase 2 (YAML Validation)
- For each company: visit site -> inspect HTML -> update YAML selectors
- Test with `crawl --crawler {company_code}`
- Fix company-specific issues (SPA rendering, PDF URL patterns)

### Phase 3 (New Development)
- KB/DB Non-Life: Implement new crawler classes extending BaseCrawler
- GenericNonLife YAML: Create configs for remaining non-life companies
- Category filtering: Add insurance category filter to non-life crawlers

### Phase 4 (Automation)
- Extend `run_pipeline.py` to support registry-based `--all`
- Add health check endpoint integration
- Configure Celery Beat for weekly execution (future)

---

## 5. Out of Scope

- Auto insurance (자동차보험)
- Property insurance (화재보험)
- Travel insurance (여행보험)
- KNIA association-level crawling (PDF not publicly available)
- Real-time price comparison features

---

## 6. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Website HTML structure changes | Crawlers break | StructureChangedError detection + health monitoring |
| Rate limiting by insurance sites | Crawling blocked | rate_limit_seconds config + exponential backoff |
| Gemini API daily quota | Embedding fails | API key rotation (GEMINI_API_KEYS) |
| PDF not valid | Processing fails | Magic bytes validation + graceful skip |
| Large data volume | Storage/DB costs | Incremental processing, Neon free tier limits |
