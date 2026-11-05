import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { TEST_NOTICE } from './notice';
import { HARNESS_CLINIC_SLUG, HARNESS_HOLD_CLINIC_SLUG } from './world';

// 시험 자료(TEST_FIXTURE). 사람이 직접 눈으로 보는 로컬 미리보기 실행기 (SPEC-REIMBURSEMENT-001 M6).
//  - 운영 구성 그대로 빌드한 앱(next start)과, 그 앞에서 /api/clinics/* 를 실제 핸들러(handleCatalog·handleOptions·handleEstimate)로 시험 자료(TEST_FIXTURE) 서비스에 맡기는
//    시험용 앞단 서버(tests/e2e/harness/server.ts)를 함께 띄운다. 계산 결과는 고정 응답이 아니라 실제 엔진·서버 핸들러가 시험 자료로 계산한 것이다.
//  - 앞단 서버는 --test-notice 로 띄워서, 브라우저로 여는 화면 맨 위에 시험 데이터 안내 띠를 늘 고정해 둔다(notice.ts). 앱 화면이 바뀌어도 띠는 그대로다.
//  - 운영 경로에 시험용 우회 API·서비스 교체 훅은 없다. 이 파일과 앞단 서버는 tests/ 에만 있고 src/ 는 가져오지 않는다(tests/boundary/production-no-fixtures.test.ts).
//  - 운영 구성 앱을 앞단 없이 그대로 열면 키오스크 문서는 HTTP 200 이고 병원 조회 API 가 404(운영 저장소가 비어 있어 정상 동작)라 화면에 "이용할 수 없어요" 안내가 뜬다. 아래에서 그 주소도 알려 준다.
//  - 두 서버 모두 루프백(127.0.0.1)에만 바인딩한다: 같은 네트워크의 다른 기기에서는 열 수 없다.
// 실행: `npm run preview:kiosk` (빌드 후 띄움) · 빌드를 이미 했으면 `npm run preview:kiosk:run`. 끝내려면 Ctrl+C.
// 묶음 게시·규칙 사용 범위(M7 묶음 구성)를 직접 써 보는 시연 세계는 켜야 열린다(기본 미리보기는 그대로다): `npm run preview:bundle`(빌드 후) · `npm run preview:bundle:run`, 또는 환경 변수 PREVIEW_BUNDLE_DEMO=1.
// 시연 세계는 병원 1 에 치료 C 를 더하고 병원 2 도 기준 묶음을 쓰게 한 세계다(world.ts). 시험 전용 끝점(--test-hooks)은 열지 않는다.

export const PREVIEW_APP_PORT = Number(process.env['PREVIEW_APP_PORT'] ?? 3201);
export const PREVIEW_PORT = Number(process.env['PREVIEW_PORT'] ?? 3202);
const LOOPBACK = '127.0.0.1';
const BUNDLE_DEMO = process.argv.includes('--bundle-demo') || process.env['PREVIEW_BUNDLE_DEMO'] === '1';

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

/** 묶음 시연 세계의 단계별 안내(--bundle-demo). 계정 이름은 시험 로그인 화면의 단추 이름과 같다. */
function bundleDemoLines(origin: string, kioskBase: string): string[] {
  return [
    '  [관리자] 묶음 게시 → 규칙 사용 범위 지정 → 키오스크 반영 (시연 세계: --bundle-demo, TEST_FIXTURE 시험 자료)',
    '      병원 1 에 "시험 치료 C (묶음 시험)"가 더해져 있다. 기준 묶음에는 C 의 매핑이 없어서, 지금 병원 1 키오스크에서 C 를 고르면 계산이 보류(매핑 없음)다.',
    '      병원 2 도 같은 기준 묶음을 쓴다. 아래 순서대로 하면 병원 1 에서만 C 가 계산되고 병원 2 는 그대로다. 계정을 바꿀 때는 로그인 화면(/__harness/login)으로 돌아가 다시 고른다.',
    `      0. 키오스크 병원 1  : ${kioskBase}/${HARNESS_CLINIC_SLUG} → 4세대(C4) · 손해보험사 → "시험 치료 C (묶음 시험)"만 선택해 계산하면 보류다.`,
    `      1. "병원 1 관리자 (HA)" → ${origin}/admin/TEST_FIXTURE_CLINIC_1/review-requests 에서 치료 C 에 검토를 요청한다 (보험 계산 분류는 "일반 급여" 를 고른다).`,
    '      2. "보험 기준 검토 담당자 (RV)"(rv-1) → 검토 대기열에서 C 의 "매핑 초안 작성": 보장함, 그룹 키 TEST_GROUP_BENEFIT, 적용 범위 "4세대(C4) · 손해보험사",',
    '         유효 기간 2026-01-01 ~ 2026-12-31, 약관 출처 여섯 칸은 아무 시험 값이나 채운다 → "초안 저장" → "검토 제출".',
    '      3. "보험 기준 검토 담당자 2 (RV)"(rv-2) → 같은 항목을 "승인"한다. 승인만으로는 환자 화면이 바뀌지 않는다(키오스크 C 는 여전히 보류).',
    `      4. rv-2 (또는 rv-1) → ${origin}/admin/bundles : 기준 묶음(사용 가능한 최신 묶음)이 골라져 있다. 승인된 매핑 C 를 체크 → "미리보기"(기준 묶음 항목과 "추가" 항목이 보인다) → "게시".`,
    '         "새 규칙 묶음 … 을(를) 게시했습니다. 아직 어느 병원에도 적용되지 않았습니다. …"라고 나온다. 키오스크 병원 1·2 는 아직 그대로다(C 보류).',
    `      5. "플랫폼 운영자 (PO)"(po-1) → ${origin}/admin/rule-scope (로그인하면 바로 이 화면으로 온다): 병원 1 의 "바꿀 묶음"에서 새 묶음을 고르면 "현재 … → 바꿀 …" 줄이 나온다 → "이 병원에 적용" (병원 1 한 곳만 바뀐다).`,
    `      6. 키오스크 병원 1 을 새로 열어(${kioskBase}/${HARNESS_CLINIC_SLUG}) 같은 순서로 C 를 계산하면 이제 정상 결과다. 병원 2(${kioskBase}/${HARNESS_HOLD_CLINIC_SLUG}) 는 그대로다.`,
    '      * 거절도 볼 수 있다: 승인 전 매핑은 후보에 없다 · 겹치는 매핑을 고르면 "겹치는 매핑" 문장과 함께 게시가 막힌다 · rv 계정이 규칙 사용 범위를, po 계정이 묶음 게시를 열면 권한 없음 안내(API 403)다.',
    '      * 이 시연 세계의 상태는 이 서버가 떠 있는 동안만 메모리에 있다. 처음부터 다시 하려면 Ctrl+C 후 다시 띄운다.',
    '',
  ];
}

async function main(): Promise<void> {
  const appHealth = `http://${LOOPBACK}:${PREVIEW_APP_PORT}/kiosk/preview-probe`;
  const previewHealth = `http://${LOOPBACK}:${PREVIEW_PORT}/__harness/health`;
  for (const url of [appHealth, previewHealth]) {
    if (await isUp(url)) throw new Error(`이미 쓰고 있는 주소다: ${url} (PREVIEW_APP_PORT·PREVIEW_PORT 로 다른 포트를 고른다)`);
  }
  const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(PREVIEW_APP_PORT), '-H', LOOPBACK], { stdio: ['ignore', 'ignore', 'inherit'], windowsHide: true });
  const preview = spawn(
    process.execPath,
    ['--import', './tests/fixtures/engine/ts-resolve-register.mjs', 'tests/e2e/harness/server.ts', '--port', String(PREVIEW_PORT), '--upstream', `http://${LOOPBACK}:${PREVIEW_APP_PORT}`, '--test-notice', ...(BUNDLE_DEMO ? ['--bundle-demo'] : [])],
    { stdio: ['ignore', 'ignore', 'inherit'], windowsHide: true },
  );
  const stop = (): void => {
    app.kill();
    preview.kill();
  };
  // 이 프로세스가 어떤 길로 끝나든(Ctrl+C, 오류, 정상 종료) 띄운 서버 둘을 함께 끊는다.
  process.on('exit', stop);
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
  const base = `http://${LOOPBACK}:${PREVIEW_PORT}/kiosk`;
  process.stdout.write(
    [
      '',
      '보담 키오스크 로컬 미리보기 (TEST_FIXTURE 시험 자료)',
      `  ${TEST_NOTICE}`,
      '  (이 안내는 화면 맨 위에 늘 고정되어 있다)',
      '',
      `  정상 계산 병원 : ${base}/${HARNESS_CLINIC_SLUG}`,
      '      "4세대(C4)" + "손해보험사"를 고르면 정상 결과, 다른 칸을 고르면 보류 결과가 나온다 (시험 자료에 있는 칸만 정상이다).',
      `  보류 전용 병원 : ${base}/${HARNESS_HOLD_CLINIC_SLUG}`,
      '      어떤 선택이든 보류 결과가 나온다.',
      `  운영 구성 그대로 : http://${LOOPBACK}:${PREVIEW_APP_PORT}/kiosk/아무-slug  → 문서는 HTTP 200, 병원 조회 API 는 404, 화면에는 "이용할 수 없어요" 안내 (운영 저장소가 비어 있어 정상 동작이다. 시험 안내 띠는 없다)`,
      '',
      '',
      '  [관리자] 치료 가격 수정 → 초안 저장 → 미리보기 → 게시 → 키오스크 반영 (같은 시험 병원·같은 저장소)',
      `  시험 로그인       : http://${LOOPBACK}:${PREVIEW_PORT}/__harness/login`,
      '      "병원 1 관리자 (HA)"로 들어가 가격을 고쳐 게시하면, 위 정상 계산 병원 키오스크의 가격과 계산 결과가 바뀐다.',
      '      병원 2 관리자·검토 담당자·플랫폼 운영자 계정은 병원 1 의 가격 수정 권한이 없어 거절(403)된다. 로그인하지 않으면 401 이다.',
      `  운영 구성 그대로 : http://${LOOPBACK}:${PREVIEW_APP_PORT}/admin  → 인증 공급자가 연결되지 않아 모든 관리자 요청이 401 (관리자 기능을 쓸 수 없다. 시험 로그인은 이 서버에 없다)`,
      '',
      '  [관리자] 보장 검토 요청 (병원 관리자가 요청 → 검토 담당자가 읽기 전용 대기열에서 확인)',
      `  병원 1 관리자     : "병원 1 관리자 (HA)"로 로그인 후 http://${LOOPBACK}:${PREVIEW_PORT}/admin/TEST_FIXTURE_CLINIC_1/review-requests`,
      '      게시된 치료에 보험 계산 분류 등을 제안해 검토를 요청한다. 요청은 제안 기록일 뿐이라 치료 목록·분류·키오스크 계산 결과는 바뀌지 않는다.',
      `  검토 담당자       : "보험 기준 검토 담당자 (RV)"로 로그인하면 http://${LOOPBACK}:${PREVIEW_PORT}/admin/review-queue 로 들어가 처리 전 요청을 읽는다.`,
      '      다른 계정(병원 2 관리자·플랫폼 운영자)은 병원 1 의 요청 화면과 대기열이 거절되고, 로그인하지 않으면 401 이다.',
      '',
      '  [관리자] 매핑 검토 (검토 요청 → 매핑 초안 작성 → 검토 제출 → 다른 검토 담당자의 승인 또는 반려)',
      '      1. "병원 1 관리자 (HA)"로 로그인해 검토 요청 화면에서 치료에 검토를 요청한다. 로그아웃은 로그인 화면(/__harness/login)으로 돌아가 계정을 다시 고른다.',
      '      2. "보험 기준 검토 담당자 (RV)"(rv-1)로 로그인 → 검토 대기열에서 "매핑 초안 작성"으로 초안을 만들고 "검토 제출"을 누른다.',
      '         작성자 본인에게는 "승인" 단추가 없다 (본인이 작성한 매핑은 승인할 수 없다. API 로 시도해도 403 SELF_APPROVAL_FORBIDDEN).',
      '      3. 로그아웃 후 "보험 기준 검토 담당자 2 (RV)"(rv-2)로 로그인 → 같은 항목을 "승인"하거나, 사유를 적어 "반려"한다 (사유가 비면 화면이 막고 서버도 400 이다).',
      '         승인은 검토 기록일 뿐이다: 매핑이 APPROVED 가 되고 요청이 "처리 완료"로 옮겨지지만 환자 화면(키오스크)의 치료·분류·계산은 바뀌지 않는다 (규칙 묶음 게시는 이 단계에 없다).',
      '      4. "병원 1 관리자 (HA)"로 다시 로그인해 검토 요청 화면에서 상태를 읽는다: "검토 승인됨 — 환자 화면에는 아직 반영되지 않았습니다" 또는 "반려됨"과 반려 사유.',
      '         병원 2 관리자·플랫폼 운영자·"병원 1 소속 검토 담당자 (RV, 병원에 매임)"는 이 경로가 거절(403)되고, 로그인하지 않으면 401 이다.',
      '      * 치료를 새로 추가해 게시하면 분류가 "추가 검토 필요"가 되어 계산이 보류된다. 그 치료의 매핑을 승인해도 분류는 바뀌지 않아 계산은 계속 보류다.',
      '      * 치료를 숨겨 게시한 뒤에는 그 치료의 대기 중 요청을 승인할 수 없다 (대기열에 "숨긴 치료입니다"로 보이고 승인 단추가 막힌다. 반려로 닫을 수 있다).',
      '',
      ...(BUNDLE_DEMO ? bundleDemoLines(`http://${LOOPBACK}:${PREVIEW_PORT}`, base) : ['  [관리자] 묶음 게시 · 규칙 사용 범위: 이 미리보기에는 켜져 있지 않다. 써 보려면 `npm run preview:bundle:run`(빌드를 이미 했을 때) 또는 `npm run preview:bundle` 로 시연 세계를 띄운다.', '']),
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
