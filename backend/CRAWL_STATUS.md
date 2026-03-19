# 보험 약관 크롤링 현황 (2026-03-19)

## 전체 수집 현황

| 구분 | 완료 | PDF 수 | 비고 |
|------|------|--------|------|
| 생명보험 (pub.insure.or.kr) | ✅ 완료 | 1,115개 | 21개 회사 |
| 삼성화재 | ✅ 완료 | 1,755개 | API 직접 호출 |
| 나머지 손해보험 11개사 | ❌ 미완료 | 0개 | Playwright 크롤러 작성 완료, 테스트 필요 |

**총 수집: ~2,870개 PDF**

---

## 완료된 크롤링

### 1. 생명보험 (pub.insure.or.kr)
- **스크립트**: `backend/scripts/crawl_pub_insure.py`
- **데이터 경로**: `backend/data/{company_id}/`
- **수집 현황**:
  | 회사 | PDF 수 |
  |------|--------|
  | lina_life | 134 |
  | kyobo_life | 79 |
  | samsung_life | 76 |
  | heungkuk_life | 74 |
  | kb_life | 72 |
  | shinhan_life | 62 |
  | nh | 59 |
  | abl | 59 |
  | aia | 55 |
  | hanwha_life | 49 |
  | metlife | 47 |
  | fubon_hyundai_life | 45 |
  | mirae_life | 43 |
  | dongyang_life | 40 |
  | kyobo_lifeplanet | 31 |
  | kdb | 27 |
  | hana_life | 26 |
  | im_life | 20 |
  | chubb_life | 19 |
  | bnp_life | 13 |
  | db (DB생명) | 84 |

### 2. 삼성화재 (samsung_fire)
- **스크립트**: `backend/scripts/crawl_samsung_fire.py`
- **데이터 경로**: `backend/data/samsung_fire/`
- **API 엔드포인트**: `POST https://www.samsungfire.com/vh/data/VH.HDIF0103.do`
- **PDF 기본 URL**: `https://www.samsungfire.com`
- **필터 조건**:
  - `prdGun=장기` AND `prdGb` in {건강, 상해, 종합, 자녀, 통합, 통합형}
  - OR `prdGun=일반보험` AND `prdGb` in {상해, 종합}
  - `saleEnDt >= '20230101'`
- **실행 명령**:
  ```bash
  cd backend && PYTHONPATH=. python -m scripts.crawl_samsung_fire
  ```

---

## 미완료 손해보험 (11개사)

### 크롤러 파일
- **`backend/scripts/crawl_nonlife_playwright.py`** - 11개사 통합 Playwright 크롤러 (작성 완료)
- **`backend/scripts/explore_nonlife_apis.py`** - API 탐색 스크립트

### 실행 방법
```bash
# 단일 회사 테스트
cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_nonlife_playwright --company db_insurance

# 특정 회사 목록 실행
cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_nonlife_playwright --companies hyundai_marine,kb_insurance

# 전체 실행
cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_nonlife_playwright
```

### 회사별 API 패턴 (탐색 완료)

| 회사 ID | 회사명 | API 패턴 | 상태 |
|---------|--------|---------|------|
| `hyundai_marine` | 현대해상 | SPA: `POST /serviceAction.do`, `ajax.xhi` 엔드포인트, `fn_goMenu()` 네비게이션 | 패턴 발견, 크롤러 작성 완료 |
| `db_insurance` | DB손해보험 | AJAX Steps: `/insuPcPbanFindProductStep2_AX.do` ~ Step5, PDF: `/cYakgwanDown.do?FilePath=InsProduct/` | 패턴 발견, 크롤러 작성 완료, 0 PDF 수집 (버그 있음) |
| `kb_insurance` | KB손해보험 | SPA: `https://www.kbinsure.co.kr`, 약관 페이지 탐색 필요 | 크롤러 작성 완료 |
| `meritz_fire` | 메리츠화재 | `https://www.meritzfire.com/customer/publicTerms/list.do` | 크롤러 작성 완료 |
| `hanwha_general` | 한화손해보험 | `https://www.hwgeneralins.com` (200 OK 확인) | 크롤러 작성 완료 |
| `heungkuk_fire` | 흥국화재 | `https://www.heungkukfire.co.kr` | 크롤러 작성 완료 |
| `axa_general` | AXA손해보험 | `https://www.axa.co.kr/cui/` | 크롤러 작성 완료 |
| `mg_insurance` | MG손해보험(예별) | `https://www.yebyeol.co.kr/PB031210DM.scp` | 크롤러 작성 완료 |
| `nh_fire` | NH농협손해보험 | `https://www.nhfire.co.kr` | 크롤러 작성 완료 |
| `lotte_insurance` | 롯데손해보험 | `https://www.lotteins.co.kr` | 크롤러 작성 완료 |
| `hana_insurance` | 하나손해보험 | `https://www.hanaworldwide.com` (사이트 다운) | 제외됨 |

---

## 다음 PC에서 이어서 할 작업

### 1. DB손보 크롤러 버그 수정 (우선순위 높음)
DB손보 크롤러가 0 PDF를 수집. 문제: DOM 클릭 타이밍 이슈.
해결 방안: AJAX 엔드포인트 직접 호출 방식으로 변경
```
POST https://www.idbins.com/insuPcPbanFindProductStep2_AX.do
POST https://www.idbins.com/insuPcPbanFindProductStep3_AX.do
POST https://www.idbins.com/insuPcPbanFindProductStep4_AX.do
POST https://www.idbins.com/insuPcPbanFindProductStep5_AX.do
```
최종 PDF URL 패턴: `/cYakgwanDown.do?FilePath=InsProduct/{filename}`

### 2. 각 회사별 크롤러 실행 및 테스트
```bash
# 한 회사씩 테스트하면서 확인
cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_nonlife_playwright --company hyundai_marine
```

### 3. 현대해상 추가 탐색 필요
- `fn_goMenu('보험약관')` 메뉴 ID 확인 필요
- 올바른 tranId 파악 필요

### 4. 데이터 임베딩 파이프라인 연결
- 수집된 PDF를 RAG 파이프라인에 투입
- `backend/scripts/` 내 임베딩 배치 스크립트 활용

---

## 환경 설정

### 의존성 설치
```bash
cd backend
pip install playwright httpx
playwright install chromium
```

### 프로젝트 구조
```
backend/
├── data/
│   ├── samsung_fire/     # 삼성화재 PDFs (1,755개)
│   ├── {company_id}/     # 생명보험 PDFs (21개 회사)
│   └── api_discovery/    # API 탐색 결과
├── scripts/
│   ├── crawl_samsung_fire.py     # 삼성화재 (완료)
│   ├── crawl_pub_insure.py       # 생명보험 pub.insure (완료)
│   ├── crawl_nonlife_playwright.py  # 나머지 손해보험 11개사 (진행중)
│   └── explore_nonlife_apis.py   # API 탐색 도구
└── CRAWL_STATUS.md  # 이 파일
```

---

## Git 상태
- **현재 브랜치**: main
- **원격보다 6커밋 앞서있음** (push 필요)
- 마지막 커밋: `ec9098c ci: GitHub Actions 매일 임베딩 배치 워크플로우 추가`
