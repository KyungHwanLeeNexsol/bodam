import { defineConfig } from '@playwright/test';
import { DEV_PORT } from './tests/e2e/global-setup-dev';

// 개발 서버(React Strict Mode 켜짐) 브라우저 시험 설정 (SPEC-REIMBURSEMENT-001 M6). 운영 빌드 시험(playwright.config.ts)과 따로 돌린다: `npm run test:e2e:strict`.
// *.dev.spec.ts 만 읽는다. 응답은 가로채기(page.route)로 시험 자료를 돌려주므로 운영 자료 검증이 아니다.

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /.*\.dev\.spec\.ts/,
  outputDir: '.moai/state/e2e-output-dev',
  // 개발 서버는 첫 요청에서 화면을 컴파일하므로 시간 제한을 넉넉히 둔다.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './tests/e2e/global-setup-dev.ts',
  projects: [
    {
      name: 'strict-dev-portrait',
      use: { channel: 'chrome', headless: true, deviceScaleFactor: 1, locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: `http://localhost:${DEV_PORT}`, viewport: { width: 1080, height: 1920 } },
    },
  ],
});
