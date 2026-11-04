import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

// 브라우저 시험의 서버 두 개를 띄우고 내린다 (BRIEF D12).
//  - 운영 구성 앱: `next start`(먼저 `next build` 가 되어 있어야 한다). 모든 병원 slug 가 404 이다.
//  - 실제 핸들러 앞단: tests/e2e/harness/server.ts. /api/clinics/* 는 실제 핸들러가 시험 자료(TEST_FIXTURE)로 응답하고 나머지는 위 앱으로 넘긴다.
// Playwright 의 webServer 설정을 쓰지 않는 까닭: Windows 에서 종료가 자식 프로세스의 출력 통로를 기다리며 1분 넘게 걸렸다(cmd.exe 를 거치는 spawn).
// 여기서는 node 를 곧바로 spawn 하므로 종료는 프로세스 하나를 끊는 일이다. 이미 쓰는 포트가 있으면 시험을 시작하지 않는다(다른 서버를 시험하지 않는다).

export const APP_PORT = 3101;
export const HARNESS_PORT = 3102;

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
  for (const url of [appUrl, harnessUrl]) {
    if (await isUp(url)) throw new Error(`이미 쓰고 있는 주소다(다른 서버를 시험하지 않는다): ${url}`);
  }
  const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(APP_PORT)], { stdio: 'ignore', windowsHide: true });
  const harness = spawn(process.execPath, ['--import', './tests/fixtures/engine/ts-resolve-register.mjs', 'tests/e2e/harness/server.ts', '--port', String(HARNESS_PORT), '--upstream', `http://127.0.0.1:${APP_PORT}`], {
    stdio: 'ignore',
    windowsHide: true,
  });
  try {
    await waitUntilUp(appUrl, app, '운영 구성 앱');
    await waitUntilUp(harnessUrl, harness, '실제 핸들러 앞단');
  } catch (error) {
    app.kill();
    harness.kill();
    throw error;
  }
  return async () => {
    app.kill();
    harness.kill();
  };
}
