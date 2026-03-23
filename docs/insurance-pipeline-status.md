# 보험 데이터 파이프라인 현황 추적

> 마지막 업데이트: 2026-03-23
> 목적: 34개 보험사 × (크롤링 → 인제스트 → DB저장 → 임베딩) 상태 추적

---

## 범례

| 기호 | 의미 |
|------|------|
| ✅ | 완료 |
| ⚠️ | 부분 완료 / 오류 있음 |
| ❌ | 미완료 |
| 🔄 | 진행 중 |
| - | 해당 없음 |

**sale_status**: ON_SALE(판매중) / DISCONTINUED(판매중지) / UNKNOWN(미확인)

---

## 손해보험사 (Non-Life, 10개사)

| 보험사 | 코드 | 로컬 PDF | 크롤러 | sale_status 수집 | 인제스트 | DB 정책수 | 청크수 | 임베딩 | 최종 실행일 |
|--------|------|---------|--------|-----------------|---------|---------|-------|-------|-----------|
| 삼성화재 | samsung-fire | 8,132 | ✅ crawl_samsung_fire.py | ⚠️ sale_end_dt만 (변환 필요) | ❌ | 0 | 0 | ❌ | - |
| 현대해상 | hyundai-marine | 3,575 | ✅ crawl_hyundai_marine.py | ❌ UNKNOWN | ❌ | 0 | 0 | ❌ | - |
| 롯데손해보험 | lotte-insurance | 2,330 | ✅ crawl_nonlife_playwright.py | ✅ ON_SALE:1,110 / DISC:1,220 | ❌ | 0 | 0 | ❌ | - |
| DB손해보험 | db-insurance | 2,110 | ✅ crawl_db_insurance.py | ❌ UNKNOWN | ❌ | 0 | 0 | ❌ | - |
| AXA손해보험 | axa-general | 1,587 | ✅ crawl_nonlife_playwright.py | ✅ ON_SALE:1,587 | ❌ | 0 | 0 | ❌ | - |
| 메리츠화재 | meritz-fire | 542 | ✅ crawl_meritz_fire.py | ❌ UNKNOWN | ❌ | 0 | 0 | ❌ | - |
| KB손해보험 | kb-insurance | 488 | ✅ crawl_kb_insurance.py | ❌ UNKNOWN | ❌ | 0 | 0 | ❌ | - |
| NH농협손해보험 | nh-fire | 417 | ✅ crawl_nonlife_playwright.py | ✅ ON_SALE:62 / DISC:355 | ❌ | 0 | 0 | ❌ | - |
| MG손해보험 | mg-insurance | 107 | ✅ crawl_nonlife_playwright.py | ✅ ON_SALE:9 / DISC:98 | ❌ | 0 | 0 | ❌ | - |
| 흥국화재 | heungkuk-fire | 63 | ✅ crawl_nonlife_playwright.py | ✅ ON_SALE:53 / DISC:1 / UNK:9 | ❌ | 0 | 0 | ❌ | - |

> **note**: crawl_nonlife_playwright.py 대상 5개사(롯데, AXA, NH농협, MG, 흥국)는 sale_status 완전 수집됨.
> 삼성화재는 sale_end_dt 필드 기반 변환 필요. 현대해상/DB/메리츠/KB는 재크롤링 필요.

## 생명보험사 (Life, 22개사)

| 보험사 | 코드 | 로컬 PDF | 크롤러 | sale_status 수집 | 인제스트 | DB 정책수 | 청크수 | 임베딩 | 최종 실행일 |
|--------|------|---------|--------|-----------------|---------|---------|-------|-------|-----------|
| 삼성생명 | samsung-life | 136 | ✅ pub.insure.or.kr | ❌ UNKNOWN (사이트 미지원) | ❌ | 0 | 0 | ❌ | - |
| 라이나생명 | lina-life | 134 | ✅ pub.insure.or.kr | ❌ UNKNOWN (사이트 미지원) | ❌ | 0 | 0 | ❌ | - |
| 교보생명 | kyobo-life | 125 | ✅ pub.insure.or.kr | ❌ UNKNOWN (사이트 미지원) | ❌ | 0 | 0 | ❌ | - |
| 신한라이프 | shinhan-life | 109 | ✅ pub.insure.or.kr | ❌ UNKNOWN (사이트 미지원) | ❌ | 0 | 0 | ❌ | - |
| KB라이프생명 | kb-life | 94 | ✅ pub.insure.or.kr | ❌ UNKNOWN (사이트 미지원) | ❌ | 0 | 0 | ❌ | - |
| DB생명 | db-life | 92 | ✅ pub.insure.or.kr | ❌ UNKNOWN (사이트 미지원) | ❌ | 0 | 0 | ❌ | - |
| 흥국생명 | heungkuk-life | 92 | ✅ pub.insure.or.kr | ❌ UNKNOWN (사이트 미지원) | ❌ | 0 | 0 | ❌ | - |
| 푸본현대생명 | fubon-hyundai-life | 91 | ✅ pub.insure.or.kr | ❌ UNKNOWN (사이트 미지원) | ❌ | 0 | 0 | ❌ | - |
| 메트라이프생명 | metlife | 89 | ✅ pub.insure.or.kr | ❌ UNKNOWN (사이트 미지원) | ❌ | 0 | 0 | ❌ | - |
| 한화생명 | hanwha-life | 83 | ✅ pub.insure.or.kr | ❌ UNKNOWN (사이트 미지원) | ❌ | 0 | 0 | ❌ | - |
| NH농협생명 | nh-life | 83 | ✅ pub.insure.or.kr | ❌ UNKNOWN (사이트 미지원) | ❌ | 0 | 0 | ❌ | - |
| ABL생명 | abl | 79 | ✅ pub.insure.or.kr | ❌ UNKNOWN (사이트 미지원) | ❌ | 0 | 0 | ❌ | - |
| 동양생명 | dongyang-life | 52 | ✅ pub.insure.or.kr | ❌ UNKNOWN (사이트 미지원) | ❌ | 0 | 0 | ❌ | - |
| KDB생명 | kdb-life | 45 | ✅ pub.insure.or.kr | ❌ UNKNOWN (사이트 미지원) | ❌ | 0 | 0 | ❌ | - |
| 미래에셋생명 | mirae-life | 45 | ✅ pub.insure.or.kr | ❌ UNKNOWN (사이트 미지원) | ❌ | 0 | 0 | ❌ | - |
| 교보라이프플래닛 | kyobo-lifeplanet | 39 | ✅ pub.insure.or.kr | ❌ UNKNOWN (사이트 미지원) | ❌ | 0 | 0 | ❌ | - |
| 하나생명 | hana-life | 34 | ✅ pub.insure.or.kr | ❌ UNKNOWN (사이트 미지원) | ❌ | 0 | 0 | ❌ | - |
| iM라이프 | im-life | 28 | ✅ pub.insure.or.kr | ❌ UNKNOWN (사이트 미지원) | ❌ | 0 | 0 | ❌ | - |
| IBK연금보험 | ibk | 24 | ✅ pub.insure.or.kr | ❌ UNKNOWN (사이트 미지원) | ❌ | 0 | 0 | ❌ | - |
| 처브라이프생명 | chubb-life | 21 | ✅ pub.insure.or.kr | ❌ UNKNOWN (사이트 미지원) | ❌ | 0 | 0 | ❌ | - |
| BNP파리바카디프 | bnp-life | 15 | ✅ pub.insure.or.kr | ❌ UNKNOWN (사이트 미지원) | ❌ | 0 | 0 | ❌ | - |
| 기타생명 | unknown-life | 1 | - | - | ❌ | 0 | 0 | ❌ | - |

> **note**: 생명보험 22개사는 모두 pub.insure.or.kr에서 수집됨. 해당 사이트는 판매상태를 제공하지 않아 sale_status=UNKNOWN.
> sale_status 수집을 위해서는 각 보험사 공식 사이트 개별 크롤러 개발 필요.

---

## 전체 요약

| 구분 | 보험사 수 | 총 PDF | 크롤링 완료 | sale_status 완전수집 | 인제스트됨 | 임베딩 완료 |
|------|---------|--------|-----------|-------------------|---------|---------|
| 손해보험 | 10 | 19,369 | 10 | 5 (playwright 대상) | 0 | 0 |
| 생명보험 | 22 | 1,677 | 22 | 0 (재크롤링 필요) | 0 | 0 |
| 기타(KLIA) | - | ~122 | - | - | 0 | 0 |
| **합계** | **32** | **~21,168** | **32** | **5** | **0** | **0** |

> 실제 수집 수치 (2026-03-23 기준 파일시스템 확인):
> - 손해보험: 삼성화재 8,132 / 현대해상 3,575 / 롯데 2,330 / DB 2,110 / AXA 1,587 / 메리츠 542 / KB 488 / NH농협 417 / MG 107 / 흥국 63
> - 생명보험: 삼성 136 / 라이나 134 / 교보 125 / 신한 109 / KB 94 / DB 92 / 흥국 92 / 푸본 91 / 메트 89 / 한화 83 / NH 83 / ABL 79 / 동양 52 / KDB 45 / 미래 45 / 교보플래닛 39 / 하나 34 / iM 28 / IBK 24 / 처브 21 / BNP 15 / 기타 1

---

## sale_status 수집 현황

### 완전 수집 완료 (5개사 — crawl_nonlife_playwright.py)

| 보험사 | PDF | ON_SALE | DISCONTINUED | UNKNOWN |
|--------|-----|---------|--------------|---------|
| 롯데손해보험 | 2,330 | 1,110 | 1,220 | 0 |
| AXA손해보험 | 1,587 | 1,587 | 0 | 0 |
| NH농협손해보험 | 417 | 62 | 355 | 0 |
| MG손해보험 | 107 | 9 | 98 | 0 |
| 흥국화재 | 63 | 53 | 1 | 9 |
| **합계** | **4,504** | **2,821** | **1,674** | **9** |

### 미수집 (개선 필요)

| 보험사 | 이유 | 해결책 |
|--------|------|--------|
| 삼성화재 | sale_end_dt 있음 (sale_status 키 없음) | extract_metadata()에서 sale_end_dt → sale_status 변환 |
| 현대해상, DB, 메리츠, KB | 전용 크롤러 sale_status 미저장 | 크롤러 업데이트 or 재크롤링 |
| 생명보험 22개사 | pub.insure.or.kr 판매상태 미제공 | 각 보험사 공식 사이트 크롤러 개발 필요 |

---

## 실행 이력

| 날짜 | 보험사 | 작업 | 결과 | 메모 |
|------|--------|------|------|------|
| 2026-03-23 | AXA손해보험 | 인제스트 시도 | ❌ 실패 | search_vector 컬럼 누락 (migration t0u1v2w3x4y5로 수정) |
| 2026-03-23 | 전체 | DB 초기화 | ✅ 완료 | 재수집을 위한 완전 초기화 |
| 2026-03-23 | - | DB 마이그레이션 | ✅ 완료 | t0u1v2w3x4y5: search_vector TEXT NULL 추가 |
| 2026-03-23 | 전체 32개사 | 크롤링 완료 확인 | ✅ 완료 | 총 21,069 PDFs 수집 확인 (파일시스템 기준) |

---

## 업데이트 방법

인제스트 완료 후 이 문서를 업데이트:

```bash
# 보험사별 DB 현황 조회 후 이 문서 자동 업데이트 (SPEC-PIPELINE-002 REQ-03)
python scripts/update_pipeline_status.py --company axa_general
python scripts/update_pipeline_status.py --all  # 전체 보험사 일괄
```
