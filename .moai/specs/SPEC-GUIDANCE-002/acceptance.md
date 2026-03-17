---
id: SPEC-GUIDANCE-002
document: acceptance
version: 1.0.0
status: completed
created: 2026-03-17
updated: 2026-03-17
author: zuge3
---

# SPEC-GUIDANCE-002: 인수 기준

## 인수 기준 달성 현황: 18/18 (100%)

| ACC | 설명 | 상태 |
|-----|------|------|
| ACC-01 | IntentClassifier.classify() 호출 | Complete |
| ACC-02 | metadata_["intent"] 저장 | Complete |
| ACC-03 | 분류기 오류 시 general_qa 폴백 | Complete |
| ACC-04 | dispute_guidance → analyze_dispute() 호출 | Complete |
| ACC-05 | metadata_["guidance"] 직렬화 저장 | Complete |
| ACC-06 | guidance 오류 시 채팅 정상 반환 | Complete |
| ACC-07 | confidence < 0.6 시 guidance 스킵 | Complete |
| ACC-08 | SSE guidance 이벤트 | Complete |
| ACC-09 | sources → guidance → done 순서 | Complete |
| ACC-10 | Guidance 메타데이터 스키마 | Complete |
| ACC-11 | GuidanceCard 기본 접힘 | Complete |
| ACC-12 | 헤더에 분쟁 유형 + 라벨 | Complete |
| ACC-13 | 펼침 시 판례/확률/증거/에스컬레이션 | Complete |
| ACC-14 | 면책 고지 항상 표시 | Complete |
| ACC-15 | MessageMetadata guidance 필드 | Complete |
| ACC-16 | GuidanceData 인터페이스 정의 | Complete |
| ACC-17 | SSEEvent guidance 케이스 | Complete |
| ACC-18 | StreamingMessage guidance 렌더링 | Complete |

## 테스트 검증

- Backend: 29 tests (13 new + 16 existing) - All passing
- Frontend: 132 tests (8 new + 124 existing) - All passing
