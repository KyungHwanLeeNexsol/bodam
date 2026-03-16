---
id: SPEC-GUIDANCE-001
version: 1.0.0
status: completed
created: 2026-03-15
updated: 2026-03-16
author: zuge3
priority: medium
issue_number: 0
---

# SPEC-GUIDANCE-001: 보험 분쟁 안내 및 판례 기반 분석 시스템

## 1. Environment (환경)

### 1.1 시스템 환경

- **백엔드**: Python 3.13+ / FastAPI 0.135.x
- **LLM**: Gemini 2.0 Flash (primary), GPT-4o (fallback) - 기존 LLMRouter 활용
- **RAG**: 기존 RAGChain 기반 다단계 검색 파이프라인 확장
- **벡터 DB**: PostgreSQL 18.x + pgvector 0.8.2 (HNSW index)
- **캐시/큐**: Redis 7.x (Celery broker + 응답 캐시)
- **프론트엔드**: Next.js 16 + Vercel AI SDK 6.x (스트리밍 UI)

### 1.2 비즈니스 환경

- 한국 보험 시장 대상 (한국어 전용)
- 금융감독원(FSC) 규제 환경 하 운영
- **법적 면책**: 법률 자문이 아닌 교육적 정보 제공 목적
- 개인정보보호법(PIPA) 준수 필수

### 1.3 기존 시스템 의존성

| 구성요소 | 경로 | 역할 |
|---------|------|------|
| LLMRouter | `backend/app/services/llm/router.py` | 모델 선택 및 fallback |
| RAGChain | `backend/app/services/rag/chain.py` | 다단계 벡터 검색 |
| QueryRewriter | `backend/app/services/rag/rewriter.py` | 한국어 용어 확장 |
| IntentClassifier | `backend/app/services/llm/classifier.py` | 쿼리 의도 분류 |
| Chat API | `backend/app/api/v1/chat.py` | 채팅 엔드포인트 |

---

## 2. Assumptions (가정)

- **A1**: 판례 데이터는 공개된 법원 판결문(대법원 종합법률정보, 보험분쟁조정위원회 결정례)에서 수집 가능하다
- **A2**: 기존 RAGChain과 LLMRouter를 확장하여 분쟁 분석 기능을 추가할 수 있다
- **A3**: 사용자는 자연어로 보험 분쟁 상황을 설명하며, 시스템이 모호성을 자동 감지한다
- **A4**: 확률 추정은 초기에 규칙 기반(rule-based)으로 구현하고, 향후 ML 모델로 전환한다
- **A5**: 법적 면책 고지는 모든 분쟁 관련 응답에 자동 삽입된다
- **A6**: 판례 데이터베이스는 최소 1,000건 이상의 보험 관련 판례로 시작한다

---

## 3. Requirements (요구사항)

### Module 1: 분쟁 케이스 탐지 (Dispute Case Detection)

**REQ-GD-001** [Ubiquitous]
시스템은 **항상** 사용자 질의에 대해 보험 약관의 모호한 조항 여부를 분석해야 한다.

**REQ-GD-002** [Event-Driven]
**WHEN** 사용자가 보험 보상 관련 질문을 입력하면, **THEN** IntentClassifier가 `dispute_guidance` 의도를 감지하고 분쟁 분석 파이프라인으로 라우팅해야 한다.

**REQ-GD-003** [Event-Driven]
**WHEN** LLM이 약관 텍스트에서 2개 이상의 해석 가능성을 식별하면, **THEN** 해당 조항을 `ambiguous_clause`로 태깅하고 분쟁 분석 모드를 활성화해야 한다.

**REQ-GD-004** [State-Driven]
**IF** 질의가 기존 보상 분석(Coverage Analysis)과 분쟁 안내 모두에 해당하면, **THEN** 보상 분석 결과와 분쟁 안내를 통합하여 응답해야 한다.

### Module 2: 판례 검색 및 분석 (Precedent Search & Analysis)

**REQ-GD-010** [Event-Driven]
**WHEN** 분쟁 케이스가 탐지되면, **THEN** 관련 보험 판례를 벡터 검색과 키워드 검색을 결합하여 조회해야 한다.

**REQ-GD-011** [Ubiquitous]
시스템은 **항상** 판례 검색 결과에 사건번호, 판결일자, 판결 요지, 관련 약관 조항을 포함해야 한다.

**REQ-GD-012** [Event-Driven]
**WHEN** 동일 쟁점에 대해 상반된 판결이 존재하면, **THEN** 양쪽 판결을 모두 제시하고 최신 판례 우선으로 정렬해야 한다.

**REQ-GD-013** [State-Driven]
**IF** 관련 판례가 5건 미만이면, **THEN** WebSearch를 통해 최신 판례를 추가 검색하고 결과를 보강해야 한다.

**REQ-GD-014** [Unwanted]
시스템은 출처가 불명확한 판례 정보를 제공**하지 않아야 한다**.

### Module 3: 확률 기반 성공 예측 (Probability-Based Success Prediction)

**REQ-GD-020** [Event-Driven]
**WHEN** 분쟁 케이스에 대한 판례 분석이 완료되면, **THEN** 청구 성공 확률을 0-100% 범위로 산출해야 한다.

**REQ-GD-021** [Ubiquitous]
시스템은 **항상** 확률 산출의 근거 요인(유사 판례 비율, 약관 해석 방향성, 금감원 분쟁조정 결과)을 함께 제시해야 한다.

**REQ-GD-022** [State-Driven]
**IF** 유사 판례가 3건 미만이면, **THEN** 확률 점수 대신 "판례 부족으로 정확한 예측이 어렵습니다"라는 안내 메시지를 표시해야 한다.

**REQ-GD-023** [Unwanted]
시스템은 확률 점수를 법적 보장이나 확정적 결과로 표현**하지 않아야 한다**.

### Module 4: 증거 전략 안내 (Evidence Strategy Guidance)

**REQ-GD-030** [Event-Driven]
**WHEN** 분쟁 케이스가 확인되면, **THEN** 청구 성공을 위해 필요한 증빙서류 목록과 수집 전략을 안내해야 한다.

**REQ-GD-031** [State-Driven]
**IF** 분쟁 유형이 '기왕증(pre-existing condition) 분류'이면, **THEN** 시술 시점 증빙, 의료 소견서, 진료 기록 등의 구체적 증거 수집 가이드를 제공해야 한다.

**REQ-GD-032** [State-Driven]
**IF** 분쟁 유형이 '인과관계(causation) 요건'이면, **THEN** 사고와 상해 간 인과관계를 입증할 수 있는 증거 체크리스트를 제공해야 한다.

**REQ-GD-033** [Optional]
**가능하면** 증거 수집 우선순위와 시급성(시효 관련)을 함께 안내해야 한다.

### Module 5: 전문가 연계 추천 (Professional Escalation)

**REQ-GD-040** [State-Driven]
**IF** 분쟁 성공 확률이 30% 이상 70% 미만이면, **THEN** "보험 전문가 상담을 권장합니다"라는 안내를 포함해야 한다.

**REQ-GD-041** [State-Driven]
**IF** 분쟁 금액이 1,000만원 이상이거나 소송이 필요한 사안이면, **THEN** "보험 전문 변호사 상담을 권장합니다"라는 강한 안내를 제공해야 한다.

**REQ-GD-042** [Event-Driven]
**WHEN** 사용자가 전문가 연계를 요청하면, **THEN** 금융감독원 민원센터(1332), 보험분쟁조정위원회, 보험소비자보호원 등의 공식 채널 정보를 안내해야 한다.

**REQ-GD-043** [Ubiquitous]
시스템은 **항상** 분쟁 안내 응답의 마지막에 법적 면책 고지를 포함해야 한다.

### 비기능 요구사항 (Non-Functional Requirements)

**REQ-GD-050** [Ubiquitous]
시스템은 **항상** 분쟁 분석 응답을 5초 이내(LLM 스트리밍 시작 기준)에 제공해야 한다.

**REQ-GD-051** [Ubiquitous]
시스템은 **항상** 판례 검색 결과를 200ms 이내에 반환해야 한다(벡터 검색 기준).

**REQ-GD-052** [State-Driven]
**IF** 동시 분쟁 분석 요청이 50건을 초과하면, **THEN** 요청을 큐에 적재하고 예상 대기 시간을 안내해야 한다.

---

## 4. Specifications (세부 사양)

### 4.1 새로운 Intent 유형

```python
class QueryIntent(str, Enum):
    # 기존 intent...
    POLICY_LOOKUP = "policy_lookup"
    CLAIM_GUIDANCE = "claim_guidance"
    GENERAL_QA = "general_qa"
    # 신규 intent
    DISPUTE_GUIDANCE = "dispute_guidance"
```

### 4.2 분쟁 분석 서비스 구조

```
backend/app/services/guidance/
├── __init__.py
├── dispute_detector.py      # 모호한 약관 조항 탐지
├── precedent_service.py     # 판례 검색 및 분석
├── probability_scorer.py    # 확률 기반 성공 예측
├── evidence_advisor.py      # 증거 전략 안내
├── escalation_advisor.py    # 전문가 연계 추천
├── disclaimer.py            # 법적 면책 고지 관리
└── models.py                # 분쟁 분석 Pydantic 모델
```

### 4.3 판례 데이터 모델

```python
class CasePrecedent(Base):
    """보험 판례 테이블"""
    __tablename__ = "case_precedents"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_number: Mapped[str]          # 사건번호 (e.g., "2024다12345")
    court_name: Mapped[str]           # 법원명
    decision_date: Mapped[date]       # 판결일자
    case_type: Mapped[str]            # 분쟁 유형 (coverage_interpretation, pre_existing_condition, causation)
    insurance_type: Mapped[str]       # 보험 유형 (life, non_life, health)
    summary: Mapped[str]              # 판결 요지
    ruling: Mapped[str]               # 판결 결과 (plaintiff_win, defendant_win, partial)
    key_clauses: Mapped[list[str]]    # 관련 약관 조항 (JSON)
    full_text: Mapped[str | None]     # 전문 (선택)
    embedding: Mapped[Vector]         # pgvector 임베딩
    source_url: Mapped[str | None]    # 출처 URL
    created_at: Mapped[datetime]
    updated_at: Mapped[datetime]
```

### 4.4 분쟁 분석 응답 스키마

```python
class DisputeAnalysisResponse(BaseModel):
    """분쟁 분석 응답"""
    dispute_detected: bool
    ambiguous_clauses: list[AmbiguousClause]
    related_precedents: list[PrecedentSummary]
    success_probability: ProbabilityScore | None
    evidence_strategy: EvidenceStrategy | None
    escalation_recommendation: EscalationLevel
    disclaimer: str  # 항상 포함
```

### 4.5 법적 면책 고지 (FSC 요건)

모든 분쟁 관련 응답에 포함되는 고지문:

> "본 안내는 교육적 목적의 정보 제공이며, 법적 자문이나 보험금 지급을 보장하는 것이 아닙니다. 실제 보험금 청구 및 분쟁 해결을 위해서는 보험사 또는 관련 전문가에게 상담하시기 바랍니다. 금융감독원 민원상담: 1332"

---

## 5. Traceability (추적성)

| 요구사항 ID | 모듈 | 구현 파일 | 테스트 |
|------------|------|----------|--------|
| REQ-GD-001~004 | Module 1 | `dispute_detector.py` | `test_dispute_detector.py` |
| REQ-GD-010~014 | Module 2 | `precedent_service.py` | `test_precedent_service.py` |
| REQ-GD-020~023 | Module 3 | `probability_scorer.py` | `test_probability_scorer.py` |
| REQ-GD-030~033 | Module 4 | `evidence_advisor.py` | `test_evidence_advisor.py` |
| REQ-GD-040~043 | Module 5 | `escalation_advisor.py` | `test_escalation_advisor.py` |
| REQ-GD-050~052 | NFR | 통합 테스트 | `test_guidance_integration.py` |

---

## 6. Dependencies (의존성)

| SPEC | 의존 유형 | 설명 |
|------|----------|------|
| SPEC-LLM-001 | 확장 | LLMRouter에 `DISPUTE_GUIDANCE` intent 추가 |
| SPEC-EMBED-001 | 확장 | 판례 문서 임베딩 파이프라인 재사용 |
| SPEC-AUTH-001 | 참조 | 인증된 사용자만 분쟁 분석 접근 |
| SPEC-SEC-001 | 준수 | Rate limiting, PIPA 컴플라이언스 적용 |
| SPEC-CRAWLER-001 | 확장 | 판례 데이터 크롤링 추가 (향후) |
