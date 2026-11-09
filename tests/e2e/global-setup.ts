import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

// 브라우저 시험의 서버들을 띄우고 내린다 (BRIEF D12).
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
/** 관리자 구조 편집 시험(*.admin-catalog.spec.ts) 전용 앞단. 가격 흐름 시험(ADMIN_PORT)과 저장소를 나눈다: 두 파일이 서로 다른 속도로 같은 저장소를 게시하면 앞선 게시가 뒤 시험의 기준을 바꾼다. */
export const ADMIN_CATALOG_PORT = 3106;
/** 관리자 보장 검토 요청 시험(*.admin-review.spec.ts) 전용 앞단. 위 두 인스턴스와 저장소를 나눈다: 이 시험은 "검토 요청만 새 자료이고 나머지는 그대로"를 전후 비교로 증명하므로 다른 시험의 게시가 끼면 안 된다. */
export const ADMIN_REVIEW_PORT = 3107;
/** 관리자 매핑 검토 시험(*.admin-mapping.spec.ts) 전용 앞단. 위 세 인스턴스와 저장소를 나눈다: 이 시험은 "승인은 검토 기록일 뿐이고 공개 자료는 그대로"를 전후 비교로 증명하고 마지막에 카탈로그를 바꾸므로 다른 시험의 게시가 끼면 안 된다. */
export const ADMIN_MAPPING_PORT = 3108;
/**
 * 묶음 게시·규칙 사용 범위 흐름 시험(*.admin-bundle.spec.ts) 전용 앞단. 묶음 시연 세계(--bundle-demo: 병원 1 에 치료 C 추가, 병원 2 도 기준 묶음 사용)와 시험 전용 끝점(--test-hooks)을 켠다.
 * 이 시험은 "게시만으로는 아무 병원도 안 바뀌고, 지정한 병원만 바뀐다"를 전후 비교로 증명하므로 다른 시험의 게시·지정이 끼면 안 된다: 저장소를 따로 가진다.
 */
export const ADMIN_BUNDLE_PORT = 3109;
/**
 * 묶음 게시·규칙 사용 범위의 거절 시험(*.admin-bundle-reject.spec.ts) 전용 앞단. 위와 같은 세계·끝점이지만 인스턴스를 따로 쓴다: 거절 시험은 시험마다 /__harness/reset 으로 세계를 통째로 새로 만들어 서로의 순서에 기대지 않는데,
 * 같은 인스턴스를 흐름 시험(ADMIN_BUNDLE_PORT)과 나눠 쓰면 새로 만드는 일이 흐름 시험의 상태를 지운다.
 */
export const ADMIN_BUNDLE_REJECT_PORT = 3110;
/**
 * 묶음 중지와 병원별 재지정 시험(*.admin-bundle-suspend.spec.ts) 전용 앞단. 같은 묶음 시연 세계·시험 전용 끝점이지만 인스턴스를 따로 쓴다:
 * 이 시험은 병원 C·D 를 더하고 묶음을 중지하는 상태 변화를 순서대로 이어 가므로 다른 시험(게시 흐름·거절)의 세계와 섞이면 안 된다.
 */
export const ADMIN_BUNDLE_SUSPEND_PORT = 3111;
/**
 * 병원별 무조작 정책 설정 시험(*.admin-idle-policy.spec.ts) 전용 앞단. 기본 세계(묶음 시연 아님)와 시험 전용 끝점(--test-hooks: 감사 기록·저장소 읽기, 세계 새로 만들기)을 켠다.
 * 이 시험은 "병원 A 만 바뀌고 B 는 그대로, 가격·규칙·계산·카탈로그 버전은 그대로"를 전후 비교로 증명하고 정책을 여러 번 바꾸므로 다른 시험의 세계와 섞이면 안 된다: 저장소를 따로 가진다.
 */
export const ADMIN_IDLE_POLICY_PORT = 3112;
/**
 * 공통 기본비용 금액 수정 시험(*.admin-base-fee.spec.ts) 전용 앞단. 기본 세계와 시험 전용 끝점(--test-hooks: 저장소 읽기, 세계 새로 만들기, 기본비용 없는 병원 만들기)을 켠다.
 * 이 시험은 "게시 전 공개 계산 불변 · 게시 뒤 새 기본비용 반영 · 보장 판단/매핑 상태 불변 · 다른 병원 불변"을 전후 비교로 증명하고 카탈로그를 여러 번 게시하므로 다른 시험의 세계와 섞이면 안 된다: 저장소를 따로 가진다.
 */
export const ADMIN_BASE_FEE_PORT = 3113;
/**
 * 병원 관리자 변경 이력 조회 시험(*.admin-change-history.spec.ts) 전용 앞단. 기본 세계와 시험 전용 끝점(--test-hooks: 감사 기록·저장소 읽기, 세계 새로 만들기)을 켠다.
 * 이 시험은 두 병원의 관리자가 실제 흐름(기본비용 게시·무조작 정책 저장)을 지난 뒤 이력 화면에 그 기록이 나타나는지, 조회 전후 저장소·감사 기록·공개 계산이 그대로인지를 전후 비교로 증명하므로
 * 다른 시험의 세계와 섞이면 안 된다: 저장소를 따로 가진다.
 */
export const ADMIN_CHANGE_HISTORY_PORT = 3114;
/**
 * 숨긴 치료 다시 표시 시험(*.admin-reshow.spec.ts) 전용 앞단. 기본 세계와 시험 전용 끝점(--test-hooks: 저장소 읽기, 세계 새로 만들기, 기본비용 없는 병원 만들기)을 켠다.
 * 이 시험은 "숨김 게시 → 숨김 목록 → 다시 표시 초안(공개 상태 불변) → 미리보기 → 게시 → 키오스크 재등장"과 "보장 판단·매핑 상태·다른 병원 불변"을 전후 비교로 증명하고
 * 카탈로그를 여러 번 게시하므로 다른 시험의 세계와 섞이면 안 된다: 저장소를 따로 가진다.
 */
export const ADMIN_RESHOW_PORT = 3115;

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
  const adminCatalogUrl = `http://127.0.0.1:${ADMIN_CATALOG_PORT}/__harness/health`;
  const adminReviewUrl = `http://127.0.0.1:${ADMIN_REVIEW_PORT}/__harness/health`;
  const adminMappingUrl = `http://127.0.0.1:${ADMIN_MAPPING_PORT}/__harness/health`;
  const adminBundleUrl = `http://127.0.0.1:${ADMIN_BUNDLE_PORT}/__harness/health`;
  const adminBundleRejectUrl = `http://127.0.0.1:${ADMIN_BUNDLE_REJECT_PORT}/__harness/health`;
  const adminBundleSuspendUrl = `http://127.0.0.1:${ADMIN_BUNDLE_SUSPEND_PORT}/__harness/health`;
  const adminIdlePolicyUrl = `http://127.0.0.1:${ADMIN_IDLE_POLICY_PORT}/__harness/health`;
  const adminBaseFeeUrl = `http://127.0.0.1:${ADMIN_BASE_FEE_PORT}/__harness/health`;
  const adminChangeHistoryUrl = `http://127.0.0.1:${ADMIN_CHANGE_HISTORY_PORT}/__harness/health`;
  const adminReshowUrl = `http://127.0.0.1:${ADMIN_RESHOW_PORT}/__harness/health`;
  for (const url of [appUrl, harnessUrl, noticeUrl, adminUrl, adminCatalogUrl, adminReviewUrl, adminMappingUrl, adminBundleUrl, adminBundleRejectUrl, adminBundleSuspendUrl, adminIdlePolicyUrl, adminBaseFeeUrl, adminChangeHistoryUrl, adminReshowUrl]) {
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
  const adminCatalogHarness = spawn(
    process.execPath,
    ['--import', './tests/fixtures/engine/ts-resolve-register.mjs', 'tests/e2e/harness/server.ts', '--port', String(ADMIN_CATALOG_PORT), '--upstream', `http://127.0.0.1:${APP_PORT}`],
    { stdio: 'ignore', windowsHide: true },
  );
  const adminReviewHarness = spawn(
    process.execPath,
    ['--import', './tests/fixtures/engine/ts-resolve-register.mjs', 'tests/e2e/harness/server.ts', '--port', String(ADMIN_REVIEW_PORT), '--upstream', `http://127.0.0.1:${APP_PORT}`],
    { stdio: 'ignore', windowsHide: true },
  );
  const adminMappingHarness = spawn(
    process.execPath,
    ['--import', './tests/fixtures/engine/ts-resolve-register.mjs', 'tests/e2e/harness/server.ts', '--port', String(ADMIN_MAPPING_PORT), '--upstream', `http://127.0.0.1:${APP_PORT}`],
    { stdio: 'ignore', windowsHide: true },
  );
  const adminBundleHarness = spawn(
    process.execPath,
    ['--import', './tests/fixtures/engine/ts-resolve-register.mjs', 'tests/e2e/harness/server.ts', '--port', String(ADMIN_BUNDLE_PORT), '--upstream', `http://127.0.0.1:${APP_PORT}`, '--bundle-demo', '--test-hooks'],
    { stdio: 'ignore', windowsHide: true },
  );
  const adminBundleRejectHarness = spawn(
    process.execPath,
    ['--import', './tests/fixtures/engine/ts-resolve-register.mjs', 'tests/e2e/harness/server.ts', '--port', String(ADMIN_BUNDLE_REJECT_PORT), '--upstream', `http://127.0.0.1:${APP_PORT}`, '--bundle-demo', '--test-hooks'],
    { stdio: 'ignore', windowsHide: true },
  );
  const adminBundleSuspendHarness = spawn(
    process.execPath,
    ['--import', './tests/fixtures/engine/ts-resolve-register.mjs', 'tests/e2e/harness/server.ts', '--port', String(ADMIN_BUNDLE_SUSPEND_PORT), '--upstream', `http://127.0.0.1:${APP_PORT}`, '--bundle-demo', '--test-hooks'],
    { stdio: 'ignore', windowsHide: true },
  );
  const adminIdlePolicyHarness = spawn(
    process.execPath,
    ['--import', './tests/fixtures/engine/ts-resolve-register.mjs', 'tests/e2e/harness/server.ts', '--port', String(ADMIN_IDLE_POLICY_PORT), '--upstream', `http://127.0.0.1:${APP_PORT}`, '--test-hooks'],
    { stdio: 'ignore', windowsHide: true },
  );
  const adminBaseFeeHarness = spawn(
    process.execPath,
    ['--import', './tests/fixtures/engine/ts-resolve-register.mjs', 'tests/e2e/harness/server.ts', '--port', String(ADMIN_BASE_FEE_PORT), '--upstream', `http://127.0.0.1:${APP_PORT}`, '--test-hooks'],
    { stdio: 'ignore', windowsHide: true },
  );
  const adminChangeHistoryHarness = spawn(
    process.execPath,
    ['--import', './tests/fixtures/engine/ts-resolve-register.mjs', 'tests/e2e/harness/server.ts', '--port', String(ADMIN_CHANGE_HISTORY_PORT), '--upstream', `http://127.0.0.1:${APP_PORT}`, '--test-hooks'],
    { stdio: 'ignore', windowsHide: true },
  );
  const adminReshowHarness = spawn(
    process.execPath,
    ['--import', './tests/fixtures/engine/ts-resolve-register.mjs', 'tests/e2e/harness/server.ts', '--port', String(ADMIN_RESHOW_PORT), '--upstream', `http://127.0.0.1:${APP_PORT}`, '--test-hooks'],
    { stdio: 'ignore', windowsHide: true },
  );
  const children = [app, harness, notice, adminHarness, adminCatalogHarness, adminReviewHarness, adminMappingHarness, adminBundleHarness, adminBundleRejectHarness, adminBundleSuspendHarness, adminIdlePolicyHarness, adminBaseFeeHarness, adminChangeHistoryHarness, adminReshowHarness];
  try {
    await waitUntilUp(appUrl, app, '운영 구성 앱');
    await waitUntilUp(harnessUrl, harness, '실제 핸들러 앞단');
    await waitUntilUp(noticeUrl, notice, '시험 안내 띠 앞단');
    await waitUntilUp(adminUrl, adminHarness, '관리자 시험 앞단');
    await waitUntilUp(adminCatalogUrl, adminCatalogHarness, '관리자 구조 편집 시험 앞단');
    await waitUntilUp(adminReviewUrl, adminReviewHarness, '관리자 검토 요청 시험 앞단');
    await waitUntilUp(adminMappingUrl, adminMappingHarness, '관리자 매핑 검토 시험 앞단');
    await waitUntilUp(adminBundleUrl, adminBundleHarness, '관리자 묶음 게시 시험 앞단');
    await waitUntilUp(adminBundleRejectUrl, adminBundleRejectHarness, '관리자 묶음 게시 거절 시험 앞단');
    await waitUntilUp(adminBundleSuspendUrl, adminBundleSuspendHarness, '관리자 묶음 중지 시험 앞단');
    await waitUntilUp(adminIdlePolicyUrl, adminIdlePolicyHarness, '관리자 무조작 정책 시험 앞단');
    await waitUntilUp(adminBaseFeeUrl, adminBaseFeeHarness, '관리자 공통 기본비용 시험 앞단');
    await waitUntilUp(adminChangeHistoryUrl, adminChangeHistoryHarness, '관리자 변경 이력 시험 앞단');
    await waitUntilUp(adminReshowUrl, adminReshowHarness, '관리자 숨긴 치료 다시 표시 시험 앞단');
  } catch (error) {
    for (const child of children) child.kill();
    throw error;
  }
  return async () => {
    for (const child of children) child.kill();
  };
}
