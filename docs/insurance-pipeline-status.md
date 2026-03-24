# 보험 데이터 파이프라인 현황 추적

> 마지막 업데이트: 2026-03-24
> 목적: 32개 보험사 × (크롤링 → 인제스트 → 임베딩/DB저장 → 현황 문서 업데이트) 상태 추적
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

| 구분 | 보험사 수 | 로컬 PDF | 크롤링 완료 | 인제스트 | DB 정책수 | 임베딩 |
|------|---------|---------|-----------|---------|---------|------|
| 손해보험 | 10 | 0 | 0 | 0 | 0 | 0 |
| 생명보험 | 21 | 0 | 0 | 0 | 0 | 0 |
| **합계** | **31** | **0** | **0** | **0** | **0** | **0** |

> 전체 초기화 상태 (2026-03-24 기준)

---

## 손해보험사 (Non-Life, 10개사)

### Group A — crawl_nonlife_playwright.py 대상 (5개사)
> 판매중/판매중지 정확도 검증 후 재수집 예정

| 보험사 | company_id | 로컬 PDF | 크롤러 상태 | 인제스트 | DB 정책수 | 임베딩 | 최종 실행일 |
|--------|-----------|---------|-----------|---------|---------|------|-----------|
| 롯데손해보험 | lotte_insurance | 0 | 🔄 정확도 검증 필요 | ❌ | 0 | ❌ | - |
| AXA손해보험 | axa_general | 0 | 🔄 정확도 검증 필요 | ❌ | 0 | ❌ | - |
| NH농협손해보험 | nh_fire | 0 | 🔄 정확도 검증 필요 | ❌ | 0 | ❌ | - |
| MG손해보험 | mg_insurance | 0 | 🔄 정확도 검증 필요 | ❌ | 0 | ❌ | - |
| 흥국화재 | heungkuk_fire | 0 | 🔄 정확도 검증 필요 | ❌ | 0 | ❌ | - |

### Group B — 전용 크롤러 개선 필요 (5개사)
> sale_status 저장 로직 추가 후 재수집 필요

| 보험사 | company_id | 크롤러 파일 | 필요 작업 | 인제스트 | DB 정책수 | 임베딩 | 최종 실행일 |
|--------|-----------|-----------|---------|---------|---------|------|-----------|
| 삼성화재 | samsung_fire | crawl_samsung_fire.py | sale_status 추가 or sale_end_dt 변환 | ❌ | 0 | ❌ | - |
| 현대해상 | hyundai_marine | crawl_hyundai_marine.py | sale_status 저장 추가 | ❌ | 0 | ❌ | - |
| DB손해보험 | db_insurance | crawl_db_insurance.py | sale_status 저장 추가 | ❌ | 0 | ❌ | - |
| 메리츠화재 | meritz_fire | crawl_meritz_fire.py | sale_status 저장 추가 | ❌ | 0 | ❌ | - |
| KB손해보험 | kb_insurance | crawl_kb_insurance.py | sale_status 저장 추가 | ❌ | 0 | ❌ | - |

---

## 생명보험사 (Life, 21개사)
> pub.insure.or.kr은 sale_status 미제공 → 각 보험사 공식 사이트 크롤러 신규 개발 필요

| 보험사 | company_id | 크롤러 상태 | 인제스트 | DB 정책수 | 임베딩 | 최종 실행일 |
|--------|-----------|-----------|---------|---------|------|-----------|
| 삼성생명 | samsung_life | 🔄 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| 한화생명 | hanwha_life | 🔄 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| 교보생명 | kyobo_life | 🔄 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| 신한라이프 | shinhan_life | 🔄 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| KB라이프생명 | kb_life | 🔄 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| DB생명 | db_life | 🔄 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| 흥국생명 | heungkuk_life | 🔄 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| 푸본현대생명 | fubon_hyundai_life | 🔄 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| 메트라이프생명 | metlife | 🔄 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| NH농협생명 | nh_life | 🔄 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| ABL생명 | abl_life | 🔄 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| 동양생명 | dongyang_life | 🔄 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| KDB생명 | kdb_life | 🔄 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| 미래에셋생명 | mirae_life | 🔄 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| 교보라이프플래닛 | kyobo_lifeplanet | 🔄 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| 하나생명 | hana_life | 🔄 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| iM라이프 | im_life | 🔄 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| IBK연금보험 | ibk_life | 🔄 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| 처브라이프생명 | chubb_life | 🔄 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| BNP파리바카디프 | bnp_life | 🔄 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |
| 라이나생명 | lina_life | 🔄 공식 사이트 크롤러 개발 필요 | ❌ | 0 | ❌ | - |

---

## 실행 이력

| 날짜 | 보험사 | 작업 | 결과 | 메모 |
|------|--------|------|------|------|
| 2026-03-24 | 5개 손보사 | 로컬 데이터 삭제 | ✅ 완료 | 판매중/판매중지 정확도 개선을 위해 전량 삭제 (Group A 전체) |
| 2026-03-23 | AXA손해보험 | 인제스트 시도 | ❌ 실패 | search_vector 컬럼 누락 → migration t0u1v2w3x4y5로 수정 |
| 2026-03-23 | 전체 | DB 초기화 | ✅ 완료 | 재수집을 위한 완전 초기화 |
| 2026-03-23 | - | DB 마이그레이션 | ✅ 완료 | t0u1v2w3x4y5: search_vector TEXT NULL 추가 |
| 2026-03-23 | 27개사 | 로컬 데이터 삭제 | ✅ 완료 | sale_status 미수집 데이터 전량 삭제 (Group B + 생명보험) |

---

## 다음 단계

### Phase 1: Group A 손보사 — 크롤러 정확도 검증 후 순차 처리

```bash
# 보험사 1개씩 전체 파이프라인 실행
bash scripts/run_ingest_pipeline.sh --company lotte_insurance
bash scripts/run_ingest_pipeline.sh --company axa_general
bash scripts/run_ingest_pipeline.sh --company nh_fire
bash scripts/run_ingest_pipeline.sh --company mg_insurance
bash scripts/run_ingest_pipeline.sh --company heungkuk_fire
```

### Phase 2: Group B 손보사 — 전용 크롤러 sale_status 추가 후 처리

```bash
# 각 크롤러에 sale_status 저장 로직 추가 후
bash scripts/run_ingest_pipeline.sh --company samsung_fire
bash scripts/run_ingest_pipeline.sh --company hyundai_marine
bash scripts/run_ingest_pipeline.sh --company db_insurance
bash scripts/run_ingest_pipeline.sh --company meritz_fire
bash scripts/run_ingest_pipeline.sh --company kb_insurance
```

### Phase 3: 생명보험 21개사 — 공식 사이트 크롤러 신규 개발

- 각 보험사 공식 사이트에서 판매중/판매중지 상품 구분 수집
- 생명보험협회(klia.or.kr) API 또는 Playwright 기반 크롤러 개발

---

## 업데이트 방법

```bash
# 파이프라인 완료 후 자동 업데이트 (run_ingest_pipeline.sh 내부에서 자동 실행)
python scripts/update_pipeline_status.py --company lotte_insurance
python scripts/update_pipeline_status.py --all
```
