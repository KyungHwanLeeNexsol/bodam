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

| 보험사 | 코드 | 로컬 PDF | sale_status 수집 | 크롤러 상태 | 인제스트 | DB 정책수 | 임베딩 | 최종 실행일 |
|--------|------|---------|-----------------|-----------|---------|---------|-------|-----------|
| 롯데손해보험 | lotte-insurance | 2,512 | ✅ ON_SALE:1,110 / DISC:1,220 | ✅ 수집완료 | ❌ | 0 | ❌ | - |
| AXA손해보험 | axa-general | 1,587 | ✅ ON_SALE:1,587 | ✅ 수집완료 | ❌ | 0 | ❌ | - |
| NH농협손해보험 | nh-fire | 417 | ✅ ON_SALE:62 / DISC:355 | ✅ 수집완료 | ❌ | 0 | ❌ | - |
| MG손해보험 | mg-insurance | 107 | ✅ ON_SALE:9 / DISC:98 | ✅ 수집완료 | ❌ | 0 | ❌ | - |
| 흥국화재 | heungkuk-fire | 63 | ✅ ON_SALE:53 / DISC:1 / UNK:9 | ✅ 수집완료 | ❌ | 0 | ❌ | - |
| 삼성화재 | samsung-fire | 0 | ❌ 재수집 필요 | 🔄 크롤러 개선 후 재수집 | ❌ | 0 | ❌ | - |
| 현대해상 | hyundai-marine | 0 | ❌ 재수집 필요 | 🔄 크롤러 개선 후 재수집 | ❌ | 0 | ❌ | - |
| DB손해보험 | db-insurance | 0 | ❌ 재수집 필요 | 🔄 크롤러 개선 후 재수집 | ❌ | 0 | ❌ | - |
| 메리츠화재 | meritz-fire | 0 | ❌ 재수집 필요 | 🔄 크롤러 개선 후 재수집 | ❌ | 0 | ❌ | - |
| KB손해보험 | kb-insurance | 0 | ❌ 재수집 필요 | 🔄 크롤러 개선 후 재수집 | ❌ | 0 | ❌ | - |

> **재수집 대상 5개사 삭제 완료** (2026-03-23): 전용 크롤러에 sale_status 저장 로직 추가 후 재수집 필요.
> 삼성화재는 `sale_end_dt` → `sale_status` 변환 로직 추가 고려.

## 생명보험사 (Life, 22개사)

| 보험사 | 코드 | 로컬 PDF | sale_status 수집 | 크롤러 상태 | 인제스트 | DB 정책수 | 임베딩 | 최종 실행일 |
|--------|------|---------|-----------------|-----------|---------|---------|-------|-----------|
| 삼성생명 | samsung-life | 0 | ❌ 재수집 필요 | 🔄 각사 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| 라이나생명 | lina-life | 0 | ❌ 재수집 필요 | 🔄 각사 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| 교보생명 | kyobo-life | 0 | ❌ 재수집 필요 | 🔄 각사 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| 신한라이프 | shinhan-life | 0 | ❌ 재수집 필요 | 🔄 각사 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| KB라이프생명 | kb-life | 0 | ❌ 재수집 필요 | 🔄 각사 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| DB생명 | db-life | 0 | ❌ 재수집 필요 | 🔄 각사 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| 흥국생명 | heungkuk-life | 0 | ❌ 재수집 필요 | 🔄 각사 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| 푸본현대생명 | fubon-hyundai-life | 0 | ❌ 재수집 필요 | 🔄 각사 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| 메트라이프생명 | metlife | 0 | ❌ 재수집 필요 | 🔄 각사 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| 한화생명 | hanwha-life | 0 | ❌ 재수집 필요 | 🔄 각사 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| NH농협생명 | nh-life | 0 | ❌ 재수집 필요 | 🔄 각사 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| ABL생명 | abl | 0 | ❌ 재수집 필요 | 🔄 각사 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| 동양생명 | dongyang-life | 0 | ❌ 재수집 필요 | 🔄 각사 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| KDB생명 | kdb-life | 0 | ❌ 재수집 필요 | 🔄 각사 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| 미래에셋생명 | mirae-life | 0 | ❌ 재수집 필요 | 🔄 각사 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| 교보라이프플래닛 | kyobo-lifeplanet | 0 | ❌ 재수집 필요 | 🔄 각사 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| 하나생명 | hana-life | 0 | ❌ 재수집 필요 | 🔄 각사 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| iM라이프 | im-life | 0 | ❌ 재수집 필요 | 🔄 각사 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| IBK연금보험 | ibk | 0 | ❌ 재수집 필요 | 🔄 각사 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| 처브라이프생명 | chubb-life | 0 | ❌ 재수집 필요 | 🔄 각사 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| BNP파리바카디프 | bnp-life | 0 | ❌ 재수집 필요 | 🔄 각사 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| 기타생명 | unknown-life | 0 | - | - | ❌ | 0 | ❌ | - |

> **생명보험 22개사 삭제 완료** (2026-03-23): pub.insure.or.kr은 sale_status 미제공.
> 각 보험사 공식 사이트에서 판매중/판매중지 상품을 구분하여 재수집하는 크롤러 개발 필요.

---

## 전체 요약

| 구분 | 보험사 수 | 현재 PDF | 재수집 필요 | sale_status 완전수집 | 인제스트됨 |
|------|---------|---------|-----------|-------------------|---------|
| 손해보험 | 10 | 4,686 | 5개사 | 5개사 ✅ | 0 |
| 생명보험 | 22 | 0 | 22개사 | 0개사 | 0 |
| **합계** | **32** | **4,686** | **27개사** | **5개사** | **0** |

---

## sale_status 수집 완료 보험사 (5개사)

| 보험사 | 코드 | PDF | ON_SALE | DISCONTINUED | UNKNOWN |
|--------|------|-----|---------|--------------|---------|
| 롯데손해보험 | lotte-insurance | 2,512 | 1,110 | 1,220 | 0 |
| AXA손해보험 | axa-general | 1,587 | 1,587 | 0 | 0 |
| NH농협손해보험 | nh-fire | 417 | 62 | 355 | 0 |
| MG손해보험 | mg-insurance | 107 | 9 | 98 | 0 |
| 흥국화재 | heungkuk-fire | 63 | 53 | 1 | 9 |
| **합계** | | **4,686** | **2,821** | **1,674** | **9** |

> crawl_nonlife_playwright.py 대상 보험사. 인제스트 준비 완료.

---

## 재수집 필요 보험사 (27개사)

### 손보 전용 크롤러 개선 필요 (5개사)

| 보험사 | 기존 PDF수 | 크롤러 | 필요 작업 |
|--------|-----------|--------|---------|
| 삼성화재 | 8,132 (삭제됨) | crawl_samsung_fire.py | sale_status 저장 추가 or sale_end_dt 변환 로직 |
| 현대해상 | 3,575 (삭제됨) | crawl_hyundai_marine.py | sale_status 저장 추가 |
| DB손해보험 | 2,110 (삭제됨) | crawl_db_insurance.py | sale_status 저장 추가 |
| 메리츠화재 | 542 (삭제됨) | crawl_meritz_fire.py | sale_status 저장 추가 |
| KB손해보험 | 488 (삭제됨) | crawl_kb_insurance.py | sale_status 저장 추가 |

### 생명보험 크롤러 신규 개발 필요 (22개사)

| 이유 | 대응책 |
|------|--------|
| pub.insure.or.kr이 판매상태를 제공하지 않음 | 각 보험사 공식 사이트에서 직접 수집 |
| 생명보험협회(klia.or.kr) API 조사 완료 | 별도 크롤러 개발 필요 |

---

## 실행 이력

| 날짜 | 보험사 | 작업 | 결과 | 메모 |
|------|--------|------|------|------|
| 2026-03-23 | AXA손해보험 | 인제스트 시도 | ❌ 실패 | search_vector 컬럼 누락 (migration t0u1v2w3x4y5로 수정) |
| 2026-03-23 | 전체 | DB 초기화 | ✅ 완료 | 재수집을 위한 완전 초기화 |
| 2026-03-23 | - | DB 마이그레이션 | ✅ 완료 | t0u1v2w3x4y5: search_vector TEXT NULL 추가 |
| 2026-03-23 | 전체 32개사 | 수집 현황 파악 | ✅ 완료 | 21,069 PDFs 확인, sale_status 5개사만 완전수집 |
| 2026-03-23 | 27개사 | 로컬 데이터 삭제 | ✅ 완료 | sale_status 미수집 데이터 전량 삭제, 재수집 준비 |

---

## 다음 단계

### Phase 1: 인제스트 준비 완료 (즉시 실행 가능)

```bash
# sale_status 완전수집 5개사 인제스트
python scripts/ingest_local_pdfs.py --company lotte_insurance
python scripts/ingest_local_pdfs.py --company axa_general
python scripts/ingest_local_pdfs.py --company nh_fire
python scripts/ingest_local_pdfs.py --company mg_insurance
python scripts/ingest_local_pdfs.py --company heungkuk_fire
```

### Phase 2: 크롤러 개선 후 재수집

```bash
# 손보 전용 크롤러 sale_status 추가 후 재실행
python scripts/crawl_samsung_fire.py   # sale_status 저장 로직 추가 필요
python scripts/crawl_hyundai_marine.py
python scripts/crawl_db_insurance.py
python scripts/crawl_meritz_fire.py
python scripts/crawl_kb_insurance.py
```

### Phase 3: 생명보험 재수집 (크롤러 신규 개발)

- 각 보험사 공식 사이트에서 판매중/판매중지 상품 구분 수집
- 생명보험협회 API 또는 Playwright 기반 크롤러 개발

---

## 업데이트 방법

```bash
# 인제스트 완료 후 자동 업데이트
python scripts/update_pipeline_status.py --company lotte_insurance
python scripts/update_pipeline_status.py --all
```
