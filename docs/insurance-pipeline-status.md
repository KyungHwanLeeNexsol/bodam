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
| 크롤러 완료 | 4개 (KB, AXA, NH농협, 롯데) |
| 크롤링 완료 | 0개 |
| 인제스트 완료 | 0개 |
| DB 정책 수 | 0건 |
| 임베딩 완료 | 0개 |

> 크롤러 개발 완료 4개, 수집 대기 상태 (2026-03-24 기준)

---

## 손해보험사 파이프라인 현황

| # | 보험사 | company_id | 크롤러 파일 | 크롤러 상태 | 로컬 PDF | 인제스트 | DB 정책수 | 임베딩 | 최종 실행일 | 비고 |
|---|--------|-----------|------------|------------|---------|---------|---------|------|-----------|------|
| 1 | KB손해보험 | kb_insurance | crawl_kb_insurance.py | ✅ 완료 | 0 | ❌ | 0 | ❌ | - | 필터 기반 + fallback URL 패턴 적용 |
| 2 | AXA손해보험 | axa_general | crawl_axa_general.py | ✅ 완료 | 0 | ❌ | 0 | ❌ | - | 정적 HTML, ON_SALE 33 / DISC 338 (371개) |
| 3 | NH농협손해보험 | nh_fire | crawl_nh_fire.py | ✅ 완료 | 0 | ❌ | 0 | ❌ | - | SPA 3단계, ON_SALE 87 / DISC 637+ (dry-run 확인) |
| 4 | 롯데손해보험 | lotte_insurance | crawl_lotte_insurance.py | ⚠️ 개발완료(검증필요) | 0 | ❌ | 0 | ❌ | - | SPA + iframe, dry-run 미검증 |
| 5 | MG손해보험 | mg_insurance | - | 🔄 크롤러 미개발 | 0 | ❌ | 0 | ❌ | - | 전용 크롤러 신규 개발 필요 |
| 6 | 흥국화재 | heungkuk_fire | crawl_heungkuk_fire.py | 🔄 sale_status 개선 필요 | 0 | ❌ | 0 | ❌ | - | 기존 크롤러, sale_status 미지원 |
| 7 | 삼성화재 | samsung_fire | crawl_samsung_fire.py | 🔄 sale_status 개선 필요 | 0 | ❌ | 0 | ❌ | - | 기존 크롤러, sale_status 미지원 |
| 8 | 현대해상 | hyundai_marine | crawl_hyundai_marine.py | 🔄 sale_status 개선 필요 | 0 | ❌ | 0 | ❌ | - | 기존 크롤러, sale_status 미지원 |
| 9 | DB손해보험 | db_insurance | crawl_db_insurance.py | 🔄 sale_status 개선 필요 | 0 | ❌ | 0 | ❌ | - | 기존 크롤러, sale_status 미지원 |
| 10 | 메리츠화재 | meritz_fire | crawl_meritz_fire.py | 🔄 sale_status 개선 필요 | 0 | ❌ | 0 | ❌ | - | 기존 크롤러, sale_status 미지원 |

---

## 생명보험사 파이프라인 현황

| # | 보험사 | company_id | 크롤러 파일 | 크롤러 상태 | 로컬 PDF | 인제스트 | DB 정책수 | 임베딩 | 최종 실행일 |
|---|--------|-----------|------------|------------|---------|---------|---------|------|-----------|
| 11 | 삼성생명 | samsung_life | - | 🔄 미개발 | 0 | ❌ | 0 | ❌ | - |
| 12 | 한화생명 | hanwha_life | - | 🔄 미개발 | 0 | ❌ | 0 | ❌ | - |
| 13 | 교보생명 | kyobo_life | - | 🔄 미개발 | 0 | ❌ | 0 | ❌ | - |
| 14 | 신한라이프 | shinhan_life | - | 🔄 미개발 | 0 | ❌ | 0 | ❌ | - |
| 15 | KB라이프생명 | kb_life | - | 🔄 미개발 | 0 | ❌ | 0 | ❌ | - |
| 16 | DB생명 | db_life | - | 🔄 미개발 | 0 | ❌ | 0 | ❌ | - |
| 17 | 흥국생명 | heungkuk_life | - | 🔄 미개발 | 0 | ❌ | 0 | ❌ | - |
| 18 | 푸본현대생명 | fubon_hyundai_life | - | 🔄 미개발 | 0 | ❌ | 0 | ❌ | - |
| 19 | 메트라이프생명 | metlife | - | 🔄 미개발 | 0 | ❌ | 0 | ❌ | - |
| 20 | NH농협생명 | nh_life | - | 🔄 미개발 | 0 | ❌ | 0 | ❌ | - |
| 21 | ABL생명 | abl_life | - | 🔄 미개발 | 0 | ❌ | 0 | ❌ | - |
| 22 | 동양생명 | dongyang_life | - | 🔄 미개발 | 0 | ❌ | 0 | ❌ | - |
| 23 | KDB생명 | kdb_life | - | 🔄 미개발 | 0 | ❌ | 0 | ❌ | - |
| 24 | 미래에셋생명 | mirae_life | - | 🔄 미개발 | 0 | ❌ | 0 | ❌ | - |
| 25 | 교보라이프플래닛 | kyobo_lifeplanet | - | 🔄 미개발 | 0 | ❌ | 0 | ❌ | - |
| 26 | 하나생명 | hana_life | - | 🔄 미개발 | 0 | ❌ | 0 | ❌ | - |
| 27 | iM라이프 | im_life | - | 🔄 미개발 | 0 | ❌ | 0 | ❌ | - |
| 28 | IBK연금보험 | ibk_life | - | 🔄 미개발 | 0 | ❌ | 0 | ❌ | - |
| 29 | 처브라이프생명 | chubb_life | - | 🔄 미개발 | 0 | ❌ | 0 | ❌ | - |
| 30 | BNP파리바카디프 | bnp_life | - | 🔄 미개발 | 0 | ❌ | 0 | ❌ | - |
| 31 | 라이나생명 | lina_life | - | 🔄 미개발 | 0 | ❌ | 0 | ❌ | - |

---

## 실행 이력

| 날짜 | 보험사 | 작업 | 결과 | 메모 |
|------|--------|------|------|------|
| 2026-03-24 | KB손해보험 | 크롤러 fallback 로직 추가 | ✅ 완료 | 구형 상품 날짜포함 URL 패턴 대응, 35% 실패율 해결 |
| 2026-03-24 | NH농협손해보험 | 전용 크롤러 개발 | ✅ 완료 | crawl_nh_fire.py: SPA 3단계 파싱, dry-run 확인 |
| 2026-03-24 | 롯데손해보험 | 전용 크롤러 개발 | ⚠️ 검증필요 | crawl_lotte_insurance.py: dry-run 미검증 |
| 2026-03-24 | KB손해보험 | 로컬 데이터 삭제 | ✅ 완료 | 753개 삭제, fallback 적용 크롤러로 재수집 예정 |
| 2026-03-24 | AXA손해보험 | 전용 크롤러 개발 | ✅ 완료 | crawl_axa_general.py: 정적 HTML, ON_SALE 33개/DISCONTINUED 338개 (총 371개) |
| 2026-03-24 | 5개 손보사 | 로컬 데이터 삭제 | ✅ 완료 | 판매중/판매중지 정확도 개선을 위해 전량 삭제 |
| 2026-03-23 | AXA손해보험 | 인제스트 시도 | ❌ 실패 | search_vector 컬럼 누락 → migration t0u1v2w3x4y5로 수정 |
| 2026-03-23 | 전체 | DB 초기화 | ✅ 완료 | 재수집을 위한 완전 초기화 |
| 2026-03-23 | - | DB 마이그레이션 | ✅ 완료 | t0u1v2w3x4y5: search_vector TEXT NULL 추가 |
| 2026-03-23 | 27개사 | 로컬 데이터 삭제 | ✅ 완료 | sale_status 미수집 데이터 전량 삭제 |

---

## 자동 업데이트 방법

파이프라인 완료 시 `run_ingest_pipeline.sh`의 [4/4] 단계에서 자동 실행:

```bash
# 파이프라인 실행 (완료 시 이 문서 자동 업데이트 + git push)
bash scripts/run_ingest_pipeline.sh --company kb_insurance

# 수동 업데이트
python scripts/update_pipeline_status.py --company kb_insurance
python scripts/update_pipeline_status.py --all
```

---

## 다음 진행 순서

### Phase 1: 크롤러 완료된 보험사 — 즉시 파이프라인 실행 가능

```bash
# 1. AXA손해보험 (크롤러 ✅, 371개 대상)
bash scripts/run_ingest_pipeline.sh --company axa_general

# 2. KB손해보험 (크롤러 ✅ fallback 완성)
bash scripts/run_ingest_pipeline.sh --company kb_insurance

# 3. NH농협손해보험 (크롤러 ✅, dry-run 확인됨)
bash scripts/run_ingest_pipeline.sh --company nh_fire
```

### Phase 2: 크롤러 검증 필요

```bash
# 롯데손해보험 — dry-run 먼저 검증
PYTHONIOENCODING=utf-8 PYTHONPATH=. python scripts/crawl_lotte_insurance.py --dry-run

# 검증 후
bash scripts/run_ingest_pipeline.sh --company lotte_insurance
```

### Phase 3: 크롤러 개선 필요 (sale_status 추가)

```bash
bash scripts/run_ingest_pipeline.sh --company samsung_fire
bash scripts/run_ingest_pipeline.sh --company hyundai_marine
bash scripts/run_ingest_pipeline.sh --company db_insurance
bash scripts/run_ingest_pipeline.sh --company meritz_fire
bash scripts/run_ingest_pipeline.sh --company heungkuk_fire
```

### Phase 4: 크롤러 신규 개발 필요

- `mg_insurance` — 전용 크롤러 개발
- 생명보험 21개사 — 공식 사이트 크롤러 신규 개발
