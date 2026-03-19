# 보험 약관 크롤링 현황 (2026-03-19)

## 전체 수집 현황

| 구분 | 완료 | PDF 수 | 비고 |
|------|------|--------|------|
| 생명보험 (pub.insure.or.kr) | ✅ 완료 | 1,115개 | 21개 회사 |
| 삼성화재 | ✅ 완료 | 1,755개 | API 직접 호출 |
| 메리츠화재 | ✅ 완료 | 542개 | 공시실 SPA, Playwright 다운로드 |
| 현대해상 | ✅ 완료 | 526개 | ajax.xhi API + openPdf popup |
| KB손해보험 | ✅ 완료 | 481개 | 페이지네이션 + POST form |
| 흥국화재 | ✅ 완료 | 9개 | fn_filedownX → /common/download.do |
| DB손해보험 | ✅ 완료 | 127개 | AJAX Step2-3-4 API 직접 호출 |
| 나머지 손해보험 5개사 | ❌ 미완료 | 0개 | 한화, AXA, MG, NH, 롯데 |

**총 수집: ~4,555개 PDF**

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

## 완료된 손해보험 크롤러 (3개사 신규)

### 메리츠화재 (542개 PDF)
- **스크립트**: `backend/scripts/crawl_meritz_fire.py`
- **데이터 경로**: `backend/data/meritz_fire/`
- **접근 방식**: 공시실 SPA (`/disclosure/product-announcement/product-list.do`)
  - AngularJS SPA, 카테고리 클릭 시 `json.smart` API 호출
  - PDF 다운로드: `pdfDown()` → `POST /hp/fileDownload.do` (암호화된 경로)
  - Playwright 다운로드 이벤트 필수 (직접 HTTP GET 불가)
- **카테고리**: 질병보험(15), 상해보험(511), 암보험(9), 어린이보험(2), 통합보험(5)
- **실행**:
  ```bash
  cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_meritz_fire
  cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_meritz_fire --category 질병보험
  ```

### 현대해상 (526개 PDF)
- **스크립트**: `backend/scripts/crawl_hyundai_marine.py`
- **데이터 경로**: `backend/data/hyundai_marine/`
- **접근 방식**: SPA (`/serviceAction.do`) → `fn_goMenu('100932')` 공시실
  - `POST ajax.xhi` (tranId: `HHCA0310M38S`) → 전체 상품 목록 (2,289개 JSON)
  - `openPdf(clauApnflId)` → 새 탭에서 PDF 열림
  - 다운로드 URL: `/FileActionServlet/preview/0/data/...pdf`
- **필터**: prodCatCd 0302(건강), 0303(어린이), 0304(실손), 0305(암) + 일반보험 키워드
- **실행**:
  ```bash
  cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_hyundai_marine
  ```

### KB손해보험 (481개 PDF)
- **스크립트**: `backend/scripts/crawl_kb_insurance.py`
- **데이터 경로**: `backend/data/kb_insurance/`
- **접근 방식**: 서버렌더링 HTML (euc-kr 인코딩)
  - 상품목록: `CG802030001.ec` (페이지네이션: `goPage(startRow)`, 10개/페이지)
  - 상세: `CG802030002.ec` (POST form submit)
  - PDF 다운로드: `CG802030003.ec?fileNm=상품코드_회차_1.pdf` (직접 GET)
- **카테고리**: 상해보험(c), 질병보험(d), 통합보험(a), 운전자보험(b)
- **실행**:
  ```bash
  cd backend && PYTHONIOENCODING=utf-8 PYTHONPATH=. python -m scripts.crawl_kb_insurance
  ```

---

## 미완료 손해보험 (7개사)

모든 사이트가 커스텀 SPA/UI를 사용하여 개별 탐색 필요.

| 회사 ID | 회사명 | 약관 페이지 URL | 탐색 결과 |
|---------|--------|---------------|----------|
| `hanwha_general` | 한화손해보험 | `/notice/ir/product-main.do` | 상품공시실 발견, 커스텀 UI 탐색 필요 |
| `heungkuk_fire` | 흥국화재 | SPA (javascript:void(0)) | "보험상품공시" 메뉴 발견, SPA 네비게이션 필요 |
| `db_insurance` | DB손해보험 | `/FWMAIV1534.do` | AJAX Step2~5 API 발견, 사이트 로딩 느림 |
| `axa_general` | AXA손해보험 | SPA `/cui/` | "보험상품공시실" 메뉴 발견, SPA 탐색 필요 |
| `mg_insurance` | MG손해보험(예별) | `/PB031210DM.scp` | 3단계 선택 UI (장기→상해→상품), 커스텀 드롭다운 |
| `nh_fire` | NH농협손해보험 | `/announce/.../retrieveInsuranceProductsAnnounce.nhfire` | 공시정보 페이지 발견, 커스텀 탭/선택 UI |
| `lotte_insurance` | 롯데손해보험 | 확인 불가 | 메인 페이지에서 약관 링크 미발견, 추가 탐색 필요 |
| `hana_insurance` | 하나손해보험 | 사이트 다운 | 제외 |

### 남은 작업 우선순위

1. **한화손해보험**: `/notice/ir/product-main.do` 상품공시실 탐색 → 상품 목록 API 발견 → 크롤러 작성
2. **NH농협손해보험**: 공시정보 페이지 커스텀 UI 분석 → 상품 선택 자동화
3. **MG손해보험(예별)**: 3단계 커스텀 드롭다운 JS 분석 → 상품별 약관 PDF 추출
4. **흥국화재**: SPA 네비게이션 분석 → 보험상품공시 페이지 접근
5. **AXA손해보험**: SPA 약관 페이지 탐색
6. **DB손해보험**: AJAX Step API 직접 호출 방식 구현
7. **롯데손해보험**: 사이트 구조 탐색부터 시작

---

## 환경 설정

### 의존성 설치
```bash
cd backend
pip install playwright httpx
playwright install chromium
```

### Python 경로 (Windows)
```bash
/c/Users/zuge3/AppData/Local/Programs/Python/Python311/python.exe
```

### 프로젝트 구조
```
backend/
├── data/
│   ├── samsung_fire/     # 삼성화재 PDFs (1,755개)
│   ├── meritz_fire/      # 메리츠화재 PDFs (542개)
│   ├── hyundai_marine/   # 현대해상 PDFs (526개)
│   ├── kb_insurance/     # KB손해보험 PDFs (481개)
│   ├── {company_id}/     # 생명보험 PDFs (21개 회사, 1,115개)
│   └── api_discovery/    # API 탐색 결과
├── scripts/
│   ├── crawl_samsung_fire.py        # 삼성화재 (완료)
│   ├── crawl_pub_insure.py          # 생명보험 pub.insure (완료)
│   ├── crawl_meritz_fire.py         # 메리츠화재 (완료, 신규)
│   ├── crawl_hyundai_marine.py      # 현대해상 (완료, 신규)
│   ├── crawl_kb_insurance.py        # KB손해보험 (완료, 신규)
│   ├── crawl_nonlife_playwright.py  # 통합 크롤러 (구버전, 참고용)
│   └── explore_nonlife_apis.py      # API 탐색 도구
└── CRAWL_STATUS.md  # 이 파일
```
