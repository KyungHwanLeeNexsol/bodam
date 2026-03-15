## SPEC-GUIDANCE-001 Progress

- Started: 2026-03-15
- Phase 1 (Research): Complete - 코드베이스 분석 완료
- Phase 2 (Plan): Complete - 5단계 구현 계획 승인

### Completed Implementation

**G1: 기반 모델 (TAG-001~003):**
- CasePrecedent SQLAlchemy 모델 (Vector(1536), HNSW 인덱스)
- QueryIntent에 DISPUTE_GUIDANCE 추가
- IntentClassifier 시스템 프롬프트에 4번째 카테고리 추가
- Pydantic 스키마: DisputeType, EscalationLevel, AmbiguousClause, PrecedentSummary, ProbabilityScore, EvidenceStrategy, EscalationRecommendation, DisputeAnalysisRequest/Response, CasePrecedentResponse
- Alembic 마이그레이션: case_precedents 테이블
- 테스트: 79개 (24 + 38 + 17)

**G2: 판례 검색 (TAG-004):**
- PrecedentService: 벡터 검색, 키워드 검색, 하이브리드 검색
- get_by_id, get_by_case_number 조회
- 키워드 추출, 결과 병합 알고리즘
- 테스트: 27개

**G3: 분쟁 탐지 (TAG-005):**
- DisputeDetector: LLM 기반 분쟁 유형 자동 감지
- 약관 모호성 분석 (작성자 불이익 원칙)
- IntentClassifier DISPUTE_GUIDANCE 통합 검증
- 테스트: 22개

**G4: 확률/증거/에스컬레이션 (TAG-006~009):**
- ProbabilityScorer: LLM 기반 승소 확률 예측
- EvidenceAdvisor: 분쟁 유형별 필수/권장 서류 + LLM 추가 조언
- EscalationAdvisor: 에스컬레이션 단계 권장 (자체해결→보험사민원→금감원→조정→소송)
- DisclaimerGenerator: 4종 면책 고지문 (일반, 확률, 판례, 에스컬레이션)
- 테스트: 48개 (8 + 10 + 15 + 15)

**G5: API 통합 (TAG-010~011):**
- GuidanceService: 6단계 오케스트레이터 (유형감지→판례→모호성→확률→증거→에스컬레이션)
- Guidance API 라우터: 4개 엔드포인트
  - POST /api/v1/guidance/analyze (종합 분쟁 분석)
  - GET /api/v1/guidance/precedents/search (판례 검색)
  - GET /api/v1/guidance/precedents/{id} (판례 상세)
  - GET /api/v1/guidance/disclaimer (면책 고지)
- main.py 라우터 등록
- 테스트: 29개 (15 + 14)

### Status: Complete

- 전체 커밋: 6452e38
- 전체 신규 테스트: 205개
- 전체 프로젝트 테스트: 1339개 통과
- 통합 테스트는 배포 환경 구성 후 진행 (선택)
