import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

// 브라우저 시험의 서버 두 개를 띄우고 내린다 (BRIEF D12).
//  - 운영 구성 앱: `next start`(먼저 `next build` 가 되어 있어야 한다). 키오스크 문서는 200 이고 병원 조회 API(catalog·options)는 어떤 slug 든 404 이다(운영 저장소가 비어 있다).
//  - 실제 핸들러 앞단: tests/e2e/harness/server.ts. /api/clinics/* 는 실제 핸들러가 시험 자료(TEST_FIXTURE)로 응답하고 나머지는 위 앱으로 넘긴다.
// Playwright 의 webServer 설정을 쓰지 않는 까닭: Windows 에서 종료가 자식 프로세스의 출력 통로를 기다리며 1분 넘게 걸렸다(cmd.exe 를 거치는 spawn).
// 여기서는 node 를 곧바로 spawn 하므로 종료는 프로세스 하나를 끊는 일이다. 이미 쓰는 포트가 있으면 시험을 시작하지 않는다(다른 서버를 시험하지 않는다).

export const APP_PORT = 3101;
export const HARNESS_PORT = 3102;
/** 미리보기와 같은 --test-notice 앞단(고정 안내 띠 + 앱 틀). 같은 운영 구성 앱(APP_PORT)을 업스트림으로 쓴다. *.preview.spec.ts 만 이 주소를 쓴다. */
export const NOTICE_PORT = 3104;
/** 관리자 흐름 시험(*.admin.spec.ts) 전용 앞단. 저장소를 따로 가진다: 관리자 시험이 게시로 가격을 바꾸므로 다른 시험의 앞단(HARNESS_PORT)과 섞이지 않게 한다. */
export const ADMIN_PORT = 3105;

async function isUp(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1_500) });
    return true;
  } catch {
    return false;
  }
}

async function waitUntilUp(url: string, child: ChildProcess, label: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${label} 서버가 먼저 종료되었다(코드 ${String(child.exitCode)})`);
    if (await isUp(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} 서버가 제때 뜨지 않았다: ${url}`);
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const appUrl = `http://127.0.0.1:${APP_PORT}/kiosk/e2e-probe`;
  const harnessUrl = `http://127.0.0.1:${HARNESS_PORT}/__harness/health`;
  const noticeUrl = `http://127.0.0.1:${NOTICE_PORT}/__harness/health`;
  const adminUrl = `http://127.0.0.1:${ADMIN_PORT}/__harness/health`;
  for (const url of [appUrl, harnessUrl, noticeUrl, adminUrl]) {
    if (await isUp(url)) throw new Error(`이미 쓰고 있는 주소다(다른 서버를 시험하지 않는다): ${url}`);
  }
  const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(APP_PORT)], { stdio: 'ignore', windowsHide: true });
  const harness = spawn(process.execPath, ['--import', './tests/fixtures/engine/ts-resolve-register.mjs', 'tests/e2e/harness/server.ts', '--port', String(HARNESS_PORT), '--upstream', `http://127.0.0.1:${APP_PORT}`], {
    stdio: 'ignore',
    windowsHide: true,
  });
  const notice = spawn(
    process.execPath,
    ['--import', './tests/fixtures/engine/ts-resolve-register.mjs', 'tests/e2e/harness/server.ts', '--port', String(NOTICE_PORT), '--upstream', `http://127.0.0.1:${APP_PORT}`, '--test-notice'],
    { stdio: 'ignore', windowsHide: true },
  );
  const adminHarness = spawn(
    process.execPath,
    ['--import', './tests/fixtures/engine/ts-resolve-register.mjs', 'tests/e2e/harness/server.ts', '--port', String(ADMIN_PORT), '--upstream', `http://127.0.0.1:${APP_PORT}`],
    { stdio: 'ignore', windowsHide: true },
  );
  try {
    await waitUntilUp(appUrl, app, '운영 구성 앱');
    await waitUntilUp(harnessUrl, harness, '실제 핸들러 앞단');
    await waitUntilUp(noticeUrl, notice, '시험 안내 띠 앞단');
    await waitUntilUp(adminUrl, adminHarness, '관리자 시험 앞단');
  } catch (error) {
    app.kill();
    harness.kill();
    notice.kill();
    adminHarness.kill();
    throw error;
  }
  return async () => {
    app.kill();
    harness.kill();
    notice.kill();
    adminHarness.kill();
  };
}
