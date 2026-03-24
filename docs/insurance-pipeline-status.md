# 보험 데이터 파이프라인 현황 추적

> 마지막 업데이트: 2026-03-24
> 목적: 31개 보험사 × (크롤링 → 검증 → 인제스트 → 임베딩/DB저장 → 현황 문서 업데이트) 상태 추적
> 파이프라인 원칙: **보험사별 순차 처리** — 한 보험사를 끝까지 완료한 후 다음 보험사로

---

## 범례

| 기호 | 의미 |
|------|------|
| ✅ | 완료 |
| ⚠️ | 부분 완료 / 오류 있음 |
| ❌ | 미완료 |
| 🔄 | 크롤러 개발/개선 필요 |
| - | 해당 없음 |

**sale_status**: ON_SALE(판매중) / DISCONTINUED(판매중지) / UNKNOWN(미확인)

---

## 전체 요약

| 항목 | 수치 |
|------|------|
| 전체 보험사 | 31개 |
| 손해보험 | 10개 |
| 생명보험 | 21개 |
| 크롤링 완료 | 0개 |
| 인제스트 완료 | 0개 |
| DB 정책 수 | 0건 |
| 임베딩 완료 | 0개 |

> 전체 초기화 상태 (2026-03-24 기준)

---

## 보험사별 파이프라인 현황

| # | 보험사 | company_id | 종류 | 크롤러 | 로컬 PDF | 인제스트 | DB 정책수 | 임베딩 | 최종 실행일 | 비고 |
|---|--------|-----------|------|--------|---------|---------|---------|------|-----------|------|
| 1 | 롯데손해보험 | lotte_insurance | 손보 | 🔄 재수집 필요 | 0 | ❌ | 0 | ❌ | - | crawl_nonlife_playwright.py |
| 2 | AXA손해보험 | axa_general | 손보 | ✅ 크롤러 완료 | 0 | ❌ | 0 | ❌ | - | crawl_axa_general.py (정적 HTML, 371개 대상) |
| 3 | NH농협손해보험 | nh_fire | 손보 | 🔄 재수집 필요 | 0 | ❌ | 0 | ❌ | - | crawl_nonlife_playwright.py |
| 4 | MG손해보험 | mg_insurance | 손보 | 🔄 재수집 필요 | 0 | ❌ | 0 | ❌ | - | crawl_nonlife_playwright.py |
| 5 | 흥국화재 | heungkuk_fire | 손보 | 🔄 재수집 필요 | 0 | ❌ | 0 | ❌ | - | crawl_nonlife_playwright.py |
| 6 | 삼성화재 | samsung_fire | 손보 | 🔄 크롤러 개선 필요 | 0 | ❌ | 0 | ❌ | - | sale_status 추가 필요 |
| 7 | 현대해상 | hyundai_marine | 손보 | 🔄 크롤러 개선 필요 | 0 | ❌ | 0 | ❌ | - | sale_status 저장 추가 필요 |
| 8 | DB손해보험 | db_insurance | 손보 | 🔄 크롤러 개선 필요 | 0 | ❌ | 0 | ❌ | - | sale_status 저장 추가 필요 |
| 9 | 메리츠화재 | meritz_fire | 손보 | 🔄 크롤러 개선 필요 | 0 | ❌ | 0 | ❌ | - | sale_status 저장 추가 필요 |
| 10 | KB손해보험 | kb_insurance | 손보 | ✅ 크롤러 완료 | 0 | ❌ | 0 | ❌ | - | sale_status 필터 기반 수집 완료 |
| 11 | 삼성생명 | samsung_life | 생보 | 🔄 크롤러 개발 필요 | 0 | ❌ | 0 | ❌ | - | 공식 사이트 크롤러 신규 개발 |
| 12 | 한화생명 | hanwha_life | 생보 | 🔄 크롤러 개발 필요 | 0 | ❌ | 0 | ❌ | - | 공식 사이트 크롤러 신규 개발 |
| 13 | 교보생명 | kyobo_life | 생보 | 🔄 크롤러 개발 필요 | 0 | ❌ | 0 | ❌ | - | 공식 사이트 크롤러 신규 개발 |
| 14 | 신한라이프 | shinhan_life | 생보 | 🔄 크롤러 개발 필요 | 0 | ❌ | 0 | ❌ | - | 공식 사이트 크롤러 신규 개발 |
| 15 | KB라이프생명 | kb_life | 생보 | 🔄 크롤러 개발 필요 | 0 | ❌ | 0 | ❌ | - | 공식 사이트 크롤러 신규 개발 |
| 16 | DB생명 | db_life | 생보 | 🔄 크롤러 개발 필요 | 0 | ❌ | 0 | ❌ | - | 공식 사이트 크롤러 신규 개발 |
| 17 | 흥국생명 | heungkuk_life | 생보 | 🔄 크롤러 개발 필요 | 0 | ❌ | 0 | ❌ | - | 공식 사이트 크롤러 신규 개발 |
| 18 | 푸본현대생명 | fubon_hyundai_life | 생보 | 🔄 크롤러 개발 필요 | 0 | ❌ | 0 | ❌ | - | 공식 사이트 크롤러 신규 개발 |
| 19 | 메트라이프생명 | metlife | 생보 | 🔄 크롤러 개발 필요 | 0 | ❌ | 0 | ❌ | - | 공식 사이트 크롤러 신규 개발 |
| 20 | NH농협생명 | nh_life | 생보 | 🔄 크롤러 개발 필요 | 0 | ❌ | 0 | ❌ | - | 공식 사이트 크롤러 신규 개발 |
| 21 | ABL생명 | abl_life | 생보 | 🔄 크롤러 개발 필요 | 0 | ❌ | 0 | ❌ | - | 공식 사이트 크롤러 신규 개발 |
| 22 | 동양생명 | dongyang_life | 생보 | 🔄 크롤러 개발 필요 | 0 | ❌ | 0 | ❌ | - | 공식 사이트 크롤러 신규 개발 |
| 23 | KDB생명 | kdb_life | 생보 | 🔄 크롤러 개발 필요 | 0 | ❌ | 0 | ❌ | - | 공식 사이트 크롤러 신규 개발 |
| 24 | 미래에셋생명 | mirae_life | 생보 | 🔄 크롤러 개발 필요 | 0 | ❌ | 0 | ❌ | - | 공식 사이트 크롤러 신규 개발 |
| 25 | 교보라이프플래닛 | kyobo_lifeplanet | 생보 | 🔄 크롤러 개발 필요 | 0 | ❌ | 0 | ❌ | - | 공식 사이트 크롤러 신규 개발 |
| 26 | 하나생명 | hana_life | 생보 | 🔄 크롤러 개발 필요 | 0 | ❌ | 0 | ❌ | - | 공식 사이트 크롤러 신규 개발 |
| 27 | iM라이프 | im_life | 생보 | 🔄 크롤러 개발 필요 | 0 | ❌ | 0 | ❌ | - | 공식 사이트 크롤러 신규 개발 |
| 28 | IBK연금보험 | ibk_life | 생보 | 🔄 크롤러 개발 필요 | 0 | ❌ | 0 | ❌ | - | 공식 사이트 크롤러 신규 개발 |
| 29 | 처브라이프생명 | chubb_life | 생보 | 🔄 크롤러 개발 필요 | 0 | ❌ | 0 | ❌ | - | 공식 사이트 크롤러 신규 개발 |
| 30 | BNP파리바카디프 | bnp_life | 생보 | 🔄 크롤러 개발 필요 | 0 | ❌ | 0 | ❌ | - | 공식 사이트 크롤러 신규 개발 |
| 31 | 라이나생명 | lina_life | 생보 | 🔄 크롤러 개발 필요 | 0 | ❌ | 0 | ❌ | - | 공식 사이트 크롤러 신규 개발 |

---

## 실행 이력

| 날짜 | 보험사 | 작업 | 결과 | 메모 |
|------|--------|------|------|------|
| 2026-03-24 | AXA손해보험 | 전용 크롤러 개발 | ✅ 완료 | crawl_axa_general.py: 정적 HTML 파싱, ON_SALE 33개/DISCONTINUED 338개 (총 371개) |
| 2026-03-24 | 5개 손보사 | 로컬 데이터 삭제 | ✅ 완료 | 판매중/판매중지 정확도 개선을 위해 전량 삭제 (1~5번) |
| 2026-03-23 | AXA손해보험 | 인제스트 시도 | ❌ 실패 | search_vector 컬럼 누락 → migration t0u1v2w3x4y5로 수정 |
| 2026-03-23 | 전체 | DB 초기화 | ✅ 완료 | 재수집을 위한 완전 초기화 |
| 2026-03-23 | - | DB 마이그레이션 | ✅ 완료 | t0u1v2w3x4y5: search_vector TEXT NULL 추가 |
| 2026-03-23 | 27개사 | 로컬 데이터 삭제 | ✅ 완료 | sale_status 미수집 데이터 전량 삭제 (6~31번) |

---

## 다음 단계

### Phase 1a: AXA손해보험 — 전용 크롤러 완료, 인제스트 준비됨

```bash
bash scripts/run_ingest_pipeline.sh --company axa_general
```

### Phase 1b: 손보사 1,3~5번 — crawl_nonlife_playwright.py 순차 처리

```bash
bash scripts/run_ingest_pipeline.sh --company lotte_insurance
bash scripts/run_ingest_pipeline.sh --company nh_fire
bash scripts/run_ingest_pipeline.sh --company mg_insurance
bash scripts/run_ingest_pipeline.sh --company heungkuk_fire
```

### Phase 2: 손보사 6~10번 — 전용 크롤러 sale_status 추가 후 처리

```bash
bash scripts/run_ingest_pipeline.sh --company samsung_fire
bash scripts/run_ingest_pipeline.sh --company hyundai_marine
bash scripts/run_ingest_pipeline.sh --company db_insurance
bash scripts/run_ingest_pipeline.sh --company meritz_fire
bash scripts/run_ingest_pipeline.sh --company kb_insurance
```

### Phase 3: 생명보험 11~31번 — 공식 사이트 크롤러 신규 개발

- 각 보험사 공식 사이트에서 판매중/판매중지 상품 구분 수집
- 생명보험협회(klia.or.kr) API 또는 Playwright 기반 크롤러 개발

---

## 업데이트 방법

```bash
# 파이프라인 완료 후 자동 업데이트 (run_ingest_pipeline.sh 내부에서 자동 실행)
python scripts/update_pipeline_status.py --company lotte_insurance
python scripts/update_pipeline_status.py --all
```
