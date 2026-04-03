# SPEC-JIT-001 Research Notes

## 코드베이스 분석 요약

### 핵심 발견사항

1. **PDF 업로드 엔드포인트 스켈레톤** (`backend/app/api/v1/pdf.py`)
   - `POST /api/v1/pdf/upload` 존재하나 미구현
   - `POST /api/v1/pdf/{pdf_id}/analyze` 존재하나 미구현
   - 바로 완성 가능한 상태

2. **pymupdf 설치됨** (`backend/pyproject.toml`)
   - 버전: 1.24.0
   - PDF 텍스트 추출에 즉시 사용 가능

3. **Redis 운영 중** (Celery 브로커 + 캐시)
   - 세션 문서 캐싱에 활용 가능
   - 기존 캐시 레이어 재활용

4. **Gemini 2.0 Flash 1M 컨텍스트**
   - 약관 100페이지 ≈ 50K 토큰 → 전체 컨텍스트 전달 가능
   - 임베딩 불필요

5. **pgvector DB 데이터 0건**
   - 전환 비용: 0
   - 기존 스키마 유지 (향후 하이브리드 옵션 보존)

6. **playwright 설치됨** (크롤러용)
   - PolicyDocumentFinder에서 금감원/보험사 사이트 접근 시 활용

### 재활용 가능한 기존 코드

- `ChatService.handle_message()`: 구조 유지, RAG 소스만 교체
- `LLMRouter`: 변경 없음
- `RedisClient` (기존 캐시): SessionDocumentStore에 재활용
- `chat_session` 모델: 컬럼 2개만 추가

### 기술 스택 결정

| 결정 | 선택 | 이유 |
|------|------|------|
| PDF 파싱 | pymupdf | 이미 설치, 성능 우수 |
| 섹션 추출 | Gemini 1M (기본) / BM25 (대용량) | 비용/정확도 균형 |
| 세션 저장 | Redis TTL | 기존 인프라 재활용 |
| URL 탐색 | FSS → 직접 → 웹검색 | 신뢰도 순 |

### 금감원 공시 시스템 분석
- URL: https://www.fss.or.kr
- 약관 공시 DB 접근 가능 (playwright 필요)
- 모든 보험사 약관 의무 등록 → 신뢰할 수 있는 1순위 소스

### 주요 보험사 약관 페이지 (직접 접근 가능한 10개사)
1. 삼성화재: https://www.samsungfire.com
2. 현대해상: https://www.hi.co.kr
3. KB손보: https://www.kbinsure.co.kr
4. DB손보: https://www.idbins.com
5. 메리츠화재: https://www.meritzfire.com
6. 삼성생명: https://www.samsunglife.com
7. 교보생명: https://www.kyobo.co.kr
8. 한화생명: https://www.hanwhlife.com
9. 신한라이프: https://www.shinhanlife.co.kr
10. NH농협생명: https://www.nhlife.co.kr
