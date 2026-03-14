---
id: SPEC-GUIDANCE-001
type: plan
version: 1.0.0
created: 2026-03-15
updated: 2026-03-15
author: zuge3
---

# SPEC-GUIDANCE-001 구현 계획서

## 1. 구현 전략 개요

보험 분쟁 안내 시스템은 기존 LLMRouter + RAGChain 아키텍처를 확장하여 구현한다. Strangler Fig 패턴을 적용하여 기존 채팅 파이프라인에 영향을 주지 않으면서 분쟁 분석 기능을 점진적으로 추가한다.

### 핵심 설계 원칙

- **기존 시스템 재사용**: LLMRouter, RAGChain, EmbeddingService를 최대한 활용
- **모듈 독립성**: `backend/app/services/guidance/` 하위에 독립 모듈로 구현
- **점진적 확장**: 규칙 기반 시스템으로 시작, ML 모델로 전환 가능한 인터페이스 설계
- **법적 안전성**: 모든 응답에 면책 고지를 강제하는 미들웨어 적용

---

## 2. 마일스톤

### Primary Goal: 분쟁 탐지 및 판례 검색 기반 구축

**Module 1 - 분쟁 케이스 탐지**

- IntentClassifier에 `DISPUTE_GUIDANCE` intent 추가
- DisputeDetector 서비스 구현 (LLM 기반 약관 모호성 분석)
- 기존 채팅 파이프라인에 분쟁 탐지 분기 로직 추가
- Prompt template 작성 (약관 모호성 분석 전용)

**Module 2 - 판례 데이터베이스 및 검색**

- `case_precedents` 테이블 생성 (Alembic migration)
- PrecedentService 구현 (벡터 검색 + 키워드 하이브리드 검색)
- 판례 임베딩 파이프라인 구축 (기존 EmbeddingService 확장)
- 초기 판례 데이터 시드 스크립트 작성 (공개 판례 1,000건)

### Secondary Goal: 확률 예측 및 증거 전략

**Module 3 - 확률 기반 성공 예측**

- ProbabilityScorer 서비스 구현 (규칙 기반 v1)
  - 유사 판례 승소율 가중 평균
  - 약관 해석 방향성 점수
  - 금감원 분쟁조정 결과 반영
- 확률 산출 근거 설명 생성 로직

**Module 4 - 증거 전략 안내**

- EvidenceAdvisor 서비스 구현
- 분쟁 유형별 증거 체크리스트 데이터 구성
  - 기왕증 분류 분쟁
  - 인과관계 요건 분쟁
  - 약관 해석 분쟁
  - 보험금 산정 분쟁
- 증거 수집 우선순위 및 시효 안내 로직

### Final Goal: 전문가 연계 및 프론트엔드 통합

**Module 5 - 전문가 연계 추천**

- EscalationAdvisor 서비스 구현
- 에스컬레이션 기준 로직 (확률, 금액, 복잡도 기반)
- 공식 채널 정보 데이터 관리 (금감원, 분쟁조정위 등)

**프론트엔드 통합**

- 분쟁 분석 결과 UI 컴포넌트 (확률 게이지, 판례 카드, 증거 체크리스트)
- 법적 면책 고지 배너 컴포넌트
- 전문가 연계 CTA 컴포넌트

---

## 3. 기술 접근 방식

### 3.1 LLM Chain 설계 - 분쟁 탐지

분쟁 탐지는 2단계 LLM chain으로 구현한다:

**Stage 1: 약관 모호성 분석 (Ambiguity Detection)**

```
입력: 사용자 질의 + RAG 검색 약관 텍스트
LLM: Gemini 2.0 Flash
프롬프트: 약관 조항의 다중 해석 가능성 분석
출력: AmbiguityAnalysis (ambiguous: bool, clauses: list, interpretations: list)
```

**Stage 2: 분쟁 유형 분류 (Dispute Classification)**

```
입력: AmbiguityAnalysis + 사용자 상황 설명
LLM: Gemini 2.0 Flash
프롬프트: 분쟁 유형 분류 및 핵심 쟁점 추출
출력: DisputeClassification (type: DisputeType, key_issues: list)
```

### 3.2 판례 데이터베이스 스키마

```sql
CREATE TABLE case_precedents (
    id SERIAL PRIMARY KEY,
    case_number VARCHAR(50) NOT NULL UNIQUE,
    court_name VARCHAR(100) NOT NULL,
    decision_date DATE NOT NULL,
    case_type VARCHAR(50) NOT NULL,
    insurance_type VARCHAR(50) NOT NULL,
    summary TEXT NOT NULL,
    ruling VARCHAR(20) NOT NULL,
    key_clauses JSONB DEFAULT '[]',
    full_text TEXT,
    embedding vector(1536),
    source_url VARCHAR(500),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- HNSW 인덱스 (벡터 유사도 검색용)
CREATE INDEX idx_precedents_embedding
ON case_precedents USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- 분쟁 유형별 조회 인덱스
CREATE INDEX idx_precedents_case_type ON case_precedents(case_type);
CREATE INDEX idx_precedents_insurance_type ON case_precedents(insurance_type);
CREATE INDEX idx_precedents_decision_date ON case_precedents(decision_date DESC);
CREATE INDEX idx_precedents_ruling ON case_precedents(ruling);
```

### 3.3 확률 점수 모델 (규칙 기반 v1)

초기 확률 산출은 다음 가중 요인으로 계산한다:

| 요인 | 가중치 | 설명 |
|------|--------|------|
| 유사 판례 승소율 | 40% | 유사 판례 중 원고 승소 비율 |
| 약관 해석 방향성 | 25% | 최근 판례의 약관 해석 경향 |
| 금감원 분쟁조정 결과 | 20% | 유사 분쟁의 조정 결과 |
| 증거 충분성 | 15% | 사용자 제공 정보의 증거력 수준 |

```python
class ProbabilityScorer:
    WEIGHTS = {
        "precedent_ratio": 0.40,
        "interpretation_trend": 0.25,
        "fsc_resolution": 0.20,
        "evidence_sufficiency": 0.15,
    }

    async def calculate(self, analysis: DisputeAnalysis) -> ProbabilityScore:
        scores = {
            "precedent_ratio": self._calc_precedent_ratio(analysis.precedents),
            "interpretation_trend": self._calc_trend(analysis.precedents),
            "fsc_resolution": self._calc_fsc_score(analysis.dispute_type),
            "evidence_sufficiency": self._calc_evidence_score(analysis.user_evidence),
        }
        weighted = sum(scores[k] * self.WEIGHTS[k] for k in scores)
        return ProbabilityScore(
            score=round(weighted, 1),
            factors=scores,
            confidence="low" if len(analysis.precedents) < 3 else "medium",
        )
```

### 3.4 기존 RAGChain 통합

기존 RAGChain을 확장하여 판례 검색을 추가한다:

```
사용자 질의
    ↓
IntentClassifier
    ↓ (dispute_guidance 감지)
DisputeDetector (약관 모호성 분석)
    ↓
RAGChain.search() + PrecedentService.search() [병렬 실행]
    ↓
ProbabilityScorer.calculate()
    ↓
EvidenceAdvisor.recommend()
    ↓
EscalationAdvisor.evaluate()
    ↓
DisclaimerService.append()
    ↓
DisputeAnalysisResponse (스트리밍 응답)
```

### 3.5 법적 면책 시스템 (FSC Disclaimer)

법적 면책 고지는 분쟁 관련 응답의 모든 경로에서 강제 삽입된다:

- **Response Middleware**: 분쟁 분석 응답을 반환하는 모든 엔드포인트에 면책 고지 자동 추가
- **Prompt 내장**: LLM 프롬프트에 면책 문구 생성 지시 포함
- **UI 강제**: 프론트엔드에서 분쟁 관련 응답 시 면책 배너 항상 표시
- **감사 로그**: 면책 고지 포함 여부를 로그로 기록 (컴플라이언스 감사용)

### 3.6 한국 보험 규제 준수

- **보험업법 제95조의5**: 보험안내에 관한 비교공시 기준 준수
- **금융소비자보호법**: 적합성 원칙 및 설명의무 고지
- **PIPA 컴플라이언스**: 판례 내 개인정보 마스킹 (SPEC-SEC-001 적용)
- **면책 고지 필수**: FSC 가이드라인에 따른 고지문 표시

---

## 4. 아키텍처 설계 방향

### 4.1 서비스 레이어 구조

```
backend/app/services/guidance/
├── __init__.py                  # GuidanceService (facade)
├── dispute_detector.py          # 모호한 약관 탐지 (LLM chain)
├── precedent_service.py         # 판례 검색 (hybrid search)
├── probability_scorer.py        # 확률 예측 (rule-based v1)
├── evidence_advisor.py          # 증거 전략 안내
├── escalation_advisor.py        # 전문가 연계 판단
├── disclaimer.py                # 면책 고지 관리
└── models.py                    # Pydantic 모델 정의
```

### 4.2 API 엔드포인트

기존 `/api/v1/chat` 엔드포인트를 확장하되, 분쟁 분석 전용 엔드포인트도 추가한다:

```
POST /api/v1/chat              # 기존 - intent에 따라 분쟁 분석으로 자동 라우팅
GET  /api/v1/guidance/precedents  # 판례 검색 (독립 조회)
GET  /api/v1/guidance/precedents/{id}  # 판례 상세 조회
```

### 4.3 데이터 흐름

```
[사용자 질의]
     │
     ▼
[IntentClassifier] ──── dispute_guidance ────→ [DisputeDetector]
     │                                              │
     │ (기존 intent)                                  ▼
     ▼                                        [RAGChain + PrecedentService]
[기존 RAG 파이프라인]                                │
                                                    ▼
                                          [ProbabilityScorer]
                                                    │
                                                    ▼
                                          [EvidenceAdvisor]
                                                    │
                                                    ▼
                                          [EscalationAdvisor]
                                                    │
                                                    ▼
                                          [DisclaimerService]
                                                    │
                                                    ▼
                                          [스트리밍 응답 전송]
```

---

## 5. 리스크 및 대응 방안

### 기술적 리스크

| 리스크 | 영향 | 대응 방안 |
|--------|------|----------|
| 판례 데이터 부족 | 확률 예측 정확도 저하 | 규칙 기반 v1으로 시작, 데이터 축적 후 ML 전환 |
| LLM 약관 해석 오류 | 잘못된 분쟁 안내 | QualityGuard 확장하여 confidence threshold 적용 |
| 판례 임베딩 품질 | 부정확한 유사 판례 검색 | 법률 도메인 특화 임베딩 모델 평가 (향후) |
| 응답 지연 (다중 LLM 호출) | 사용자 경험 저하 | 병렬 실행 + 스트리밍 + Redis 캐시 |

### 법적 리스크

| 리스크 | 영향 | 대응 방안 |
|--------|------|----------|
| 법률 자문 행위 해석 | 규제 위반 | 엄격한 면책 고지 + "교육 정보" 프레이밍 |
| 판례 저작권 | 저작권 침해 | 공개 판결문만 사용, 판결 요지 요약으로 제공 |
| 확률 점수 오해 | 사용자 피해 | 확률의 한계 명시 + 전문가 상담 권장 |

---

## 6. 테스트 전략

### 단위 테스트

- DisputeDetector: 모호한 약관 탐지 정확도 검증
- PrecedentService: 하이브리드 검색 결과 품질 검증
- ProbabilityScorer: 가중 평균 계산 로직 검증
- EvidenceAdvisor: 분쟁 유형별 증거 체크리스트 검증
- EscalationAdvisor: 에스컬레이션 기준 로직 검증
- DisclaimerService: 면책 고지 삽입 강제 검증

### 통합 테스트

- 전체 분쟁 분석 파이프라인 (질의 -> 응답) E2E 검증
- 기존 채팅 파이프라인 영향 없음 회귀 검증
- 스트리밍 응답 정상 동작 검증

### 커버리지 목표

- 단위 테스트: 85% 이상
- 통합 테스트: 주요 시나리오 전체 커버
