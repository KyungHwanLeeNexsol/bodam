import { defineConfig } from '@playwright/test';
import { ADMIN_CATALOG_PORT, ADMIN_PORT, ADMIN_REVIEW_PORT, APP_PORT, HARNESS_PORT, NOTICE_PORT } from './tests/e2e/global-setup';

// 브라우저 시험 설정 (SPEC-REIMBURSEMENT-001 M6, BRIEF D12). 설치된 실제 Chrome(channel: 'chrome')으로 돌린다: 브라우저 바이너리를 내려받지 않는다.
// 시험은 세 층으로 나뉘고 파일 이름이 층을 정한다. 서로 다른 것을 증명하므로 보고에서도 따로 센다.
//  - *.production.spec.ts : 운영 구성 그대로 빌드한 앱을 직접 띄운다(next start). 운영 자료가 없으므로 키오스크 문서는 200 이어도 병원 조회 API 는 어떤 slug 든 404 이고 화면은 이용 불가 안내를 보인다. 그것이 증명하는 전부다.
//  - *.intercept.spec.ts  : 같은 빌드 앱에 page.route 로 /api/clinics/** 를 시험 자료로 가로채 응답한다. 409·422·5xx·시간 초과·늦은 응답·끝내 오지 않는 응답을 정확히 만든다.
//  - *.real.spec.ts       : 시험용 앞단 서버(tests/e2e/harness)가 /api/clinics/* 를 실제 핸들러(handleCatalog·handleOptions·handleEstimate)에 시험 자료(TEST_FIXTURE) 서비스로 맡기고
//                           나머지는 빌드 앱으로 넘긴다. 실제 핸들러 논리를 시험 자료로 돌리는 것이며 운영 자료 검증이 아니다.
// 화면 크기는 세로 1080×1920 과 가로 1920×1080(임시 검토 크기), 배율 1 이다. 빌드(`next build`)를 먼저 해야 한다: `npm run test:e2e` 가 한다.

const PORTRAIT = { width: 1080, height: 1920 } as const;
const LANDSCAPE = { width: 1920, height: 1080 } as const;

const chrome = { channel: 'chrome', headless: true, deviceScaleFactor: 1, locale: 'ko-KR', timezoneId: 'Asia/Seoul' } as const;

export default defineConfig({
  testDir: 'tests/e2e',
  // 결과 파일은 git 이 보지 않는 곳에 둔다(.moai/state/ 는 .gitignore).
  outputDir: '.moai/state/e2e-output',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 3,
  retries: 0,
  reporter: [['list']],
  // 서버 둘(운영 구성 앱, 실제 핸들러 앞단)은 전역 준비가 띄우고 내린다.
  globalSetup: './tests/e2e/global-setup.ts',
  projects: [
    { name: 'production', testMatch: /.*\.production\.spec\.ts/, use: { ...chrome, baseURL: `http://127.0.0.1:${APP_PORT}`, viewport: PORTRAIT } },
    { name: 'intercept-portrait', testMatch: /.*\.intercept\.spec\.ts/, use: { ...chrome, baseURL: `http://127.0.0.1:${APP_PORT}`, viewport: PORTRAIT } },
    { name: 'intercept-landscape', testMatch: /.*\.intercept\.spec\.ts/, use: { ...chrome, baseURL: `http://127.0.0.1:${APP_PORT}`, viewport: LANDSCAPE } },
    { name: 'real-portrait', testMatch: /.*\.real\.spec\.ts/, use: { ...chrome, baseURL: `http://127.0.0.1:${HARNESS_PORT}`, viewport: PORTRAIT } },
    { name: 'real-landscape', testMatch: /.*\.real\.spec\.ts/, use: { ...chrome, baseURL: `http://127.0.0.1:${HARNESS_PORT}`, viewport: LANDSCAPE } },
    //  - *.preview.spec.ts    : 사람이 보는 미리보기와 같은 앞단(--test-notice, 고정 안내 띠 + 앱 틀)을 거친다. 계산은 *.real 과 같은 실제 핸들러다.
    { name: 'preview-portrait', testMatch: /.*\.preview\.spec\.ts/, use: { ...chrome, baseURL: `http://127.0.0.1:${NOTICE_PORT}`, viewport: PORTRAIT } },
    { name: 'preview-landscape', testMatch: /.*\.preview\.spec\.ts/, use: { ...chrome, baseURL: `http://127.0.0.1:${NOTICE_PORT}`, viewport: LANDSCAPE } },
    //  - *.admin.spec.ts      : 관리자 가격 수정 흐름(M7 첫 기능). 저장소를 따로 가진 앞단(ADMIN_PORT)이 실제 관리자 핸들러·공개 핸들러를 시험 인증기·시험 자료로 돌린다. PC 화면 크기이고 파일 안에서 순서대로 돈다.
    { name: 'admin', testMatch: /.*\.admin\.spec\.ts/, use: { ...chrome, baseURL: `http://127.0.0.1:${ADMIN_PORT}`, viewport: { width: 1280, height: 900 } } },
    //  - *.admin-catalog.spec.ts : 관리자 구조 편집 흐름(M7: 새 치료 추가 · 숨김 · 표시 순서). 위와 같은 앞단이지만 저장소를 따로 가진 인스턴스(ADMIN_CATALOG_PORT)라 가격 흐름 시험과 순서에 상관없이 돈다.
    { name: 'admin-catalog', testMatch: /.*\.admin-catalog\.spec\.ts/, use: { ...chrome, baseURL: `http://127.0.0.1:${ADMIN_CATALOG_PORT}`, viewport: { width: 1280, height: 900 } } },
    //  - *.admin-review.spec.ts  : 보장 검토 요청 흐름(M7: 병원 관리자가 요청 → 검토 담당자가 읽기 전용 대기열에서 확인). 위와 같은 앞단이지만 저장소를 따로 가진 인스턴스(ADMIN_REVIEW_PORT)다.
    //                              요청은 제안 기록일 뿐이라 공개 카탈로그·보험 선택지·계산·관리자 치료 목록이 전후로 같음을 함께 본다.
    { name: 'admin-review', testMatch: /.*\.admin-review\.spec\.ts/, use: { ...chrome, baseURL: `http://127.0.0.1:${ADMIN_REVIEW_PORT}`, viewport: { width: 1280, height: 900 } } },
  ],
});
