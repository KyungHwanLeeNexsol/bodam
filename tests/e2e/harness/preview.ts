import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { HARNESS_CLINIC_SLUG, HARNESS_HOLD_CLINIC_SLUG } from './world';

// 시험 자료(TEST_FIXTURE). 사람이 직접 눈으로 보는 로컬 미리보기 실행기 (SPEC-REIMBURSEMENT-001 M6).
//  - 운영 구성 그대로 빌드한 앱(next start)과, 그 앞에서 /api/clinics/* 를 실제 핸들러(handleCatalog·handleOptions·handleEstimate)로 시험 자료(TEST_FIXTURE) 서비스에 맡기는
//    시험용 앞단 서버(tests/e2e/harness/server.ts)를 함께 띄운다. 계산 결과는 고정 응답이 아니라 실제 엔진·서버 핸들러가 시험 자료로 계산한 것이다.
//  - 운영 경로에 시험용 우회 API·서비스 교체 훅은 없다. 이 파일과 앞단 서버는 tests/ 에만 있고 src/ 는 가져오지 않는다(tests/boundary/production-no-fixtures.test.ts).
//  - 운영 구성 앱을 앞단 없이 그대로 열면 모든 병원 slug 가 404 이다(운영 저장소가 비어 있기 때문이며 정상 동작이다). 아래에서 그 주소도 알려 준다.
// 실행: `npm run preview:kiosk` (빌드 후 띄움) · 빌드를 이미 했으면 `npm run preview:kiosk:run`. 끝내려면 Ctrl+C.

export const PREVIEW_APP_PORT = Number(process.env['PREVIEW_APP_PORT'] ?? 3201);
export const PREVIEW_PORT = Number(process.env['PREVIEW_PORT'] ?? 3202);
const NOTICE = '테스트 데이터로 계산한 예시입니다. 실제 보험금 안내에 사용할 수 없습니다.';

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
    if (child.exitCode !== null) throw new Error(`${label} 서버가 먼저 종료되었다(코드 ${String(child.exitCode)}). 빌드(next build)를 먼저 했는지 확인한다.`);
    if (await isUp(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} 서버가 제때 뜨지 않았다: ${url}`);
}

async function main(): Promise<void> {
  const appHealth = `http://127.0.0.1:${PREVIEW_APP_PORT}/kiosk/preview-probe`;
  const previewHealth = `http://127.0.0.1:${PREVIEW_PORT}/__harness/health`;
  for (const url of [appHealth, previewHealth]) {
    if (await isUp(url)) throw new Error(`이미 쓰고 있는 주소다: ${url} (PREVIEW_APP_PORT·PREVIEW_PORT 로 다른 포트를 고른다)`);
  }
  const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(PREVIEW_APP_PORT)], { stdio: ['ignore', 'ignore', 'inherit'], windowsHide: true });
  const preview = spawn(
    process.execPath,
    ['--import', './tests/fixtures/engine/ts-resolve-register.mjs', 'tests/e2e/harness/server.ts', '--port', String(PREVIEW_PORT), '--upstream', `http://127.0.0.1:${PREVIEW_APP_PORT}`],
    { stdio: ['ignore', 'ignore', 'inherit'], windowsHide: true },
  );
  const stop = (): void => {
    app.kill();
    preview.kill();
  };
  process.on('SIGINT', () => {
    stop();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    stop();
    process.exit(0);
  });
  try {
    await waitUntilUp(appHealth, app, '운영 구성 앱');
    await waitUntilUp(previewHealth, preview, '미리보기 앞단');
  } catch (error) {
    stop();
    throw error;
  }
  const base = `http://127.0.0.1:${PREVIEW_PORT}/kiosk`;
  process.stdout.write(
    [
      '',
      '보담 키오스크 로컬 미리보기 (TEST_FIXTURE 시험 자료)',
      `  ${NOTICE}`,
      '',
      `  정상 계산 병원 : ${base}/${HARNESS_CLINIC_SLUG}`,
      '      "4세대(C4)" + "손해보험사"를 고르면 정상 결과, 다른 칸을 고르면 보류 결과가 나온다 (시험 자료에 있는 칸만 정상이다).',
      `  보류 전용 병원 : ${base}/${HARNESS_HOLD_CLINIC_SLUG}`,
      '      어떤 선택이든 보류 결과가 나온다.',
      `  운영 구성 그대로 : http://127.0.0.1:${PREVIEW_APP_PORT}/kiosk/아무-slug  → 404 (운영 저장소가 비어 있어 정상 동작이다)`,
      '',
      '  끝내려면 Ctrl+C',
      '',
    ].join('\n'),
  );
  await new Promise<void>(() => {
    // 서버가 떠 있는 동안 계속 기다린다(Ctrl+C 로 끝낸다).
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`미리보기를 시작하지 못했다: ${String(error)}\n`);
  process.exit(1);
});
