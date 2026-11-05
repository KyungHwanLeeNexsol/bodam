import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from '@playwright/test';
import { expect, test } from '../helpers/test';
import { CLINIC_1, CLINIC_2, OTHER_TREATMENT, SLUG_1, SLUG_2, TREATMENT_A, auditLog, changedStateKeys, closeAll, json, kioskToTreatments, openAs, publicSnapshot, resetWorld, stateText } from '../helpers/bundle-flow';
import type { Json, PublicSnapshot, Session } from '../helpers/bundle-flow';
import { installClock } from '../helpers/clock';
import { TITLES, heading } from '../helpers/input';
import { dialog, expectStartScreen, startButton } from '../helpers/kiosk';
import { actionsOf } from '../helpers/results';

// 병원별 무조작 정책 설정 (SPEC-REIMBURSEMENT-001 M7 병원별 무조작 정책 설정, AC-023d · AC-023f · AC-023g · AC-022a · AC-015i): 실제 Chrome, 실제 HTTP(요청 가로채기 없음 — 응답이 끊기는 상황만 page.route 로 만든다), 기본 세계 + 시험 전용 끝점(--test-hooks).
// 세계: 병원 A(=병원 1, 규칙 묶음 있음)·병원 B(=병원 2). 두 병원 모두 정책을 저장한 적이 없다. 긴 대기는 모두 가짜 시계(page.clock)로 보내고 운영 시간(기본값)은 줄이지 않는다.
// 증명하려는 것:
//   - 병원 A 의 관리자(HA)가 화면에서 화면 종류별 시간과 이용 완료 자동 복귀를 고쳐 저장하면 서버 값을 다시 읽어 보이고, 병원 B 는 그대로이다. 직접 설정한 종류/기본값을 따르는 종류가 표시로 구분된다.
//   - 저장은 전체 교체이지만 화면이 다른 설정을 잃게 하지 않는다: 두 번째 저장에도 앞서 직접 설정한 종류와 자동 복귀 값이 그대로 다시 보내지고, "기본값으로 되돌리기" 를 누른 종류만 기본값으로 돌아간다.
//   - 잘못된 값(간격 < 20초 · 소수 · 0 초 복귀)은 서버가 거절하고 화면이 어느 값이 왜 틀렸는지 알리며, 저장소 전체 사본과 감사 기록이 한 글자도 바뀌지 않고 입력은 남는다.
//   - completionHoldSeconds: null(자동 복귀 없음)과 양의 정수(1초 포함 — 20초 하한 없음)가 저장되고, 키오스크의 이용 완료 화면이 그대로 따른다.
//   - 응답이 끊기거나 서버 오류이면 저장 실패로 단정하지 않고 서버 값을 다시 읽어 입력과 같은지 알린다(저장됨 / 저장 안 됨 / 확인 못 함 → 다시 확인).
//   - 새로 연 키오스크만 바뀐 시간(경고·초기화·이용 완료 자동 복귀)을 쓴다: 저장 전에 열어 둔 키오스크는 그대로 기본값으로 동작하고(실시간으로 밀어 넣지 않는다), 정책이 없는 병원 B 는 기본값이다. 초기화되면 환자 입력이 지워진다.
//   - 가격·보장 규칙·계산 결과·카탈로그 버전은 설정 저장으로 바뀌지 않는다(공개 응답 글자 비교, 저장소에서 달라진 영역은 감사 기록과 정책뿐).
//   - 인증 없음/다른 병원/검토 담당자는 화면에서 안내만 보이고, 직접 보낸 쓰기는 401·403 으로 거절되어 저장소가 그대로이다.
// 한 파일 안에서 순서대로 돈다. 사진은 .moai/state/shots/m7-idle/ 에 남는다(육안 검토용).

test.describe.configure({ mode: 'serial' });

const SHOTS = path.resolve('.moai/state/shots/m7-idle');
async function shoot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled', fullPage: true });
}

const KINDS = ['INPUT', 'RESULT', 'BASIS_AND_DOCUMENTS', 'HOLD_RESULT', 'NOTICE_PROGRESS_ERROR'] as const;
type Kind = (typeof KINDS)[number];
const DEFAULTS: Record<Kind, [number, number]> = { INPUT: [100, 120], RESULT: [160, 180], BASIS_AND_DOCUMENTS: [160, 180], HOLD_RESULT: [160, 180], NOTICE_PROGRESS_ERROR: [100, 120] };

const policyApi = (clinicId: string): string => `/api/admin/clinics/${clinicId}/idle-policy`;
const policyPage = (clinicId: string): string => `/admin/${clinicId}/idle-policy`;

// ───────────────────────── 화면 도우미 ─────────────────────────

const warnInput = (page: Page, kind: Kind) => page.locator(`[data-idle-warn="${kind}"]`);
const resetInput = (page: Page, kind: Kind) => page.locator(`[data-idle-reset="${kind}"]`);
const sourceOf = (page: Page, kind: Kind) => page.locator(`[data-idle-source="${kind}"]`);
const saveButton = (page: Page) => page.locator('[data-idle-save]');
const holdToggle = (page: Page) => page.locator('[data-idle-hold-enabled]');
const holdInput = (page: Page) => page.locator('[data-idle-hold-seconds]');
const messageOf = (page: Page, code: string) => page.locator(`[data-admin-message][data-admin-message-code="${code}"]`);

async function gotoPolicy(page: Page, clinicId: string = CLINIC_1): Promise<void> {
  await page.goto(policyPage(clinicId));
  await expect(page.locator('main[data-admin-state="ready"][data-admin-page="idle-policy"]')).toBeVisible();
}

async function expectRow(page: Page, kind: Kind, warn: number, reset: number, source: 'default' | 'custom'): Promise<void> {
  await expect(warnInput(page, kind), `${kind} 경고`).toHaveValue(String(warn));
  await expect(resetInput(page, kind), `${kind} 초기화`).toHaveValue(String(reset));
  await expect(sourceOf(page, kind), `${kind} 표시`).toHaveAttribute('data-idle-source-kind', source);
}

async function setRow(page: Page, kind: Kind, warn: string, reset: string): Promise<void> {
  await warnInput(page, kind).fill(warn);
  await resetInput(page, kind).fill(reset);
}

async function serverPolicy(session: Session, clinicId: string = CLINIC_1): Promise<Json> {
  const response = await session.context.request.get(policyApi(clinicId));
  expect(response.status()).toBe(200);
  return json(response);
}

// ───────────────────────── 키오스크 도우미(가짜 시계) ─────────────────────────

async function openKioskContext(browser: Browser): Promise<Session> {
  const context = await browser.newContext({ viewport: { width: 1080, height: 1920 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const page = await context.newPage();
  await installClock(page);
  return { context, page };
}

/** 가짜 시계를 지금 시각에서 멈춘다: 이후 시간은 시험이 runFor 로 보낸 만큼만 흐른다(실제 시간이 경고 시각을 먼저 넘기지 않는다). */
async function pauseClock(page: Page): Promise<void> {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1_000);
}

/** 입력 단계(세대 선택)까지 가서 환자 입력 하나를 넣고 시계를 멈춘다. */
async function kioskAtInput(browser: Browser, slug: string): Promise<Session> {
  const session = await openKioskContext(browser);
  const { page } = session;
  await page.goto(`/kiosk/${slug}`);
  await expectStartScreen(page);
  await startButton(page).click();
  await expect(heading(page, TITLES.generation)).toBeVisible();
  await page.getByRole('radio').first().check();
  await expect(page.getByRole('radio').first()).toBeChecked();
  await pauseClock(page);
  return session;
}

/** 입력 단계에서 환자가 만지지 않으면 경고창이 (warn)초에, 초기화가 (reset)초에 일어난다. 실제 경과(약 1초)를 감안해 경계에서 2초 이상 떨어져 본다. */
async function expectIdleSchedule(page: Page, warn: number, reset: number): Promise<void> {
  await page.clock.runFor((warn - 4) * 1000);
  await expect(dialog(page), `경고 4초 전(${String(warn - 4)}초)에는 경고창이 없다`).toHaveCount(0);
  await page.clock.runFor(6_000);
  await expect(dialog(page), `경고 시각(${String(warn)}초) 뒤에는 경고창이 있다`).toHaveCount(1);
  await expect(dialog(page)).toContainText('계속 사용하시겠어요?');
  await page.clock.runFor((reset - warn - 8) * 1000);
  await expect(dialog(page), `초기화 4초 전(${String(reset - 4)}초)에는 경고창이 아직 열려 있다`).toHaveCount(1);
  await page.clock.runFor(6_000);
  await expectStartScreen(page);
  await expect(dialog(page)).toHaveCount(0);
  // 초기화되면 환자 입력이 지워진다: 다시 시작하면 세대 선택이 비어 있다.
  await startButton(page).click();
  await expect(heading(page, TITLES.generation)).toBeVisible();
  await expect(page.getByRole('radio').first()).not.toBeChecked();
  for (const box of await page.getByRole('radio').all()) await expect(box).not.toBeChecked();
}

/** 이용 완료 화면(K06)까지 간다. 시계는 가짜(멈추지 않음)이고, 도착하면 멈춘다. */
async function kioskAtComplete(browser: Browser): Promise<Session> {
  const session = await openKioskContext(browser);
  const { page } = session;
  await kioskToTreatments(page, SLUG_1);
  await page.getByRole('checkbox').nth(0).check();
  await page.getByRole('checkbox').nth(1).check();
  await page.getByRole('button', { name: '예상 부담액 확인' }).click();
  await expect(page.locator('[data-result]')).toBeVisible();
  await actionsOf(page).filter({ hasText: '이용 완료' }).click();
  await expect(page.locator('[data-kiosk-state="COMPLETE"]')).toBeVisible();
  await pauseClock(page);
  return session;
}

// ───────────────────────── 기준선 ─────────────────────────

const withoutPolicy = (call: { body: Json }): string => {
  const { idlePolicy: _ignored, ...rest } = call.body;
  return JSON.stringify(rest);
};

let baselineState = '';
let baselineAudit = 0;
let baselineA: PublicSnapshot;
let baselineB: PublicSnapshot;
let ha: Session;

test('S0 세계 만들기와 기준선: 두 병원 모두 정책을 저장한 적이 없다', async ({ browser, request }) => {
  await resetWorld(request);
  baselineState = await stateText(request);
  baselineAudit = (await auditLog(request)).length;
  baselineA = await publicSnapshot(request, SLUG_1, [TREATMENT_A]);
  baselineB = await publicSnapshot(request, SLUG_2, [OTHER_TREATMENT]);
  expect(baselineA.estimate.body['result']['state']).toBe('ESTIMATED');
  for (const snapshot of [baselineA, baselineB]) {
    expect(snapshot.catalog.body['idlePolicy']['completionHoldSeconds']).toBeNull();
    for (const kind of KINDS) expect(snapshot.catalog.body['idlePolicy']['screens'][kind]).toEqual({ warnSeconds: DEFAULTS[kind][0], resetSeconds: DEFAULTS[kind][1] });
  }
  ha = await openAs(browser, 'ha-clinic-1');
});

test('S1 첫 화면: 이동 줄에서 열리고, 다섯 종류가 모두 기본값으로 표시되며 저장할 것이 없다', async () => {
  const { page } = ha;
  await expect(page.locator('[data-admin-nav-link="idle-policy"]')).toBeVisible();
  await page.locator('[data-admin-nav-link="idle-policy"]').click();
  await expect(page.locator('main[data-admin-state="ready"][data-admin-page="idle-policy"]')).toBeVisible();
  await expect(page.locator('[data-admin-nav-link="idle-policy"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('[data-admin-user]')).toHaveText('TEST_FIXTURE_HA_CLINIC_1');
  for (const kind of KINDS) {
    await expectRow(page, kind, DEFAULTS[kind][0], DEFAULTS[kind][1], 'default');
    await expect(page.locator(`[data-idle-default="${kind}"]`)).toContainText(`기본 ${String(DEFAULTS[kind][0])}초 / ${String(DEFAULTS[kind][1])}초`);
    await expect(page.locator(`[data-idle-revert="${kind}"]`)).toBeDisabled();
  }
  await expect(holdToggle(page)).not.toBeChecked();
  await expect(holdInput(page)).toBeDisabled();
  await expect(page.locator('[data-idle-hold-state]')).toHaveText('자동 복귀 없음');
  await expect(saveButton(page)).toBeDisabled();
  await expect(page.locator('[data-idle-dirty]')).toHaveAttribute('data-idle-dirty', 'false');
  await expect(page.locator('[data-idle-apply-note]')).toContainText('처음 화면으로 돌아가는 것만으로는 다시 읽지 않습니다');
  await shoot(page, '01-default');
});

test('S2 (AC-023f·AC-023g) 일부만 고쳐 저장: 서버 값을 다시 읽어 보이고, 병원 B·가격·규칙·계산·카탈로그 버전은 그대로이며, 저장 전에 열어 둔 키오스크는 기본값 그대로다', async ({ browser, request }) => {
  // 저장 전에 열어 둔 키오스크(병원 A): 입력 단계에서 환자 입력이 하나 있고 시계가 멈춰 있다.
  const oldKiosk = await kioskAtInput(browser, SLUG_1);
  const { page } = ha;

  await setRow(page, 'INPUT', '20', '40');
  await holdToggle(page).check();
  await holdInput(page).fill('5');
  await expect(sourceOf(page, 'INPUT')).toHaveAttribute('data-idle-source-kind', 'custom');
  await expect(sourceOf(page, 'RESULT')).toHaveAttribute('data-idle-source-kind', 'default');
  await expect(page.locator('[data-idle-dirty]')).toHaveAttribute('data-idle-dirty', 'true');
  await expect(saveButton(page)).toBeEnabled();
  await saveButton(page).click();

  await expect(messageOf(page, 'SAVED')).toBeVisible();
  await expect(messageOf(page, 'SAVED')).toContainText('서버에 저장된 값을 다시 읽어');
  await expectRow(page, 'INPUT', 20, 40, 'custom');
  for (const kind of KINDS.filter((entry) => entry !== 'INPUT')) await expectRow(page, kind, DEFAULTS[kind][0], DEFAULTS[kind][1], 'default');
  await expect(holdToggle(page)).toBeChecked();
  await expect(holdInput(page)).toHaveValue('5');
  await expect(page.locator('[data-idle-hold-state]')).toHaveText('5초 뒤 자동으로 복귀');
  await expect(saveButton(page)).toBeDisabled();
  await shoot(page, '02-saved-partial');

  // 서버가 가진 값과 감사 기록.
  const stored = await serverPolicy(ha);
  expect(stored['customizedScreens']).toEqual(['INPUT']);
  expect(stored['idlePolicy']['completionHoldSeconds']).toBe(5);
  expect(stored['idlePolicy']['screens']['INPUT']).toEqual({ warnSeconds: 20, resetSeconds: 40 });
  const audit = await auditLog(request);
  expect(audit).toHaveLength(baselineAudit + 1);
  expect(audit.at(-1)).toMatchObject({ action: 'IDLE_POLICY_SAVE', actorId: 'TEST_FIXTURE_HA_CLINIC_1', role: 'HA', target: `CLINIC/${CLINIC_1}/IDLE_POLICY` });
  // 바뀐 저장소 영역은 감사 기록과 정책뿐이다 (치료·가격·카탈로그·규칙 묶음·범위·병원 기록은 그대로).
  expect(changedStateKeys(baselineState, await stateText(request))).toEqual(['auditLog', 'idlePolicies']);

  // 공개 응답: A 의 idlePolicy 만 바뀌고 나머지(catalogVersion·치료·가격)·선택지·계산은 글자 그대로 같다. B 는 전체가 같다.
  const nowA = await publicSnapshot(request, SLUG_1, [TREATMENT_A]);
  expect(nowA.catalog.body['idlePolicy']['completionHoldSeconds']).toBe(5);
  expect(nowA.catalog.body['idlePolicy']['screens']['INPUT']).toEqual({ warnSeconds: 20, resetSeconds: 40 });
  expect(withoutPolicy(nowA.catalog)).toBe(withoutPolicy(baselineA.catalog));
  expect(nowA.catalog.body['catalogVersion']).toBe(baselineA.catalog.body['catalogVersion']);
  expect(nowA.options.text).toBe(baselineA.options.text);
  expect(nowA.estimate.text).toBe(baselineA.estimate.text);
  const nowB = await publicSnapshot(request, SLUG_2, [OTHER_TREATMENT]);
  expect(nowB.catalog.text).toBe(baselineB.catalog.text);
  expect(nowB.options.text).toBe(baselineB.options.text);
  expect(nowB.estimate.text).toBe(baselineB.estimate.text);

  // 저장 전에 열어 둔 키오스크는 새 시간(20초)이 아니라 열 때의 기본값(경고 100초)을 그대로 쓴다: 실시간으로 밀어 넣지 않는다.
  await oldKiosk.page.clock.runFor(30_000);
  await expect(dialog(oldKiosk.page), '저장 뒤 30초: 새 경고 시간(20초)이 지났지만 이미 열린 키오스크는 바뀌지 않는다').toHaveCount(0);
  await oldKiosk.page.clock.runFor(72_000);
  await expect(dialog(oldKiosk.page), '102초: 열 때의 기본 경고 시간(100초)에 경고창이 열린다').toHaveCount(1);
  // 기본 초기화 시간(120초)에 처음 화면으로 돌아간다. 처음 화면으로 돌아가기만으로는 바뀐 정책을 다시 읽지 않는다: 다시 시작해도 여전히 열 때의 값(경고 100초)이다.
  await oldKiosk.page.clock.runFor(20_000);
  await expectStartScreen(oldKiosk.page);
  await startButton(oldKiosk.page).click();
  await expect(heading(oldKiosk.page, TITLES.generation)).toBeVisible();
  await oldKiosk.page.getByRole('radio').first().check();
  await oldKiosk.page.clock.runFor(30_000);
  await expect(dialog(oldKiosk.page), '다시 시작한 뒤 30초: 새 경고 시간(20초)이 지났지만 처음 화면을 거쳐도 열 때의 값 그대로다').toHaveCount(0);
  await closeAll(oldKiosk);

  // 정책이 없는 병원 B 의 키오스크는 기본값(경고 100초 · 초기화 120초)이다.
  const kioskB = await kioskAtInput(browser, SLUG_2);
  await expectIdleSchedule(kioskB.page, 100, 120);
  await closeAll(kioskB);

  // 지금 새로 연 병원 A 의 키오스크는 바뀐 시간(경고 20초 · 초기화 40초)을 쓰고, 초기화되면 환자 입력이 지워진다.
  const kioskA = await kioskAtInput(browser, SLUG_1);
  await expectIdleSchedule(kioskA.page, 20, 40);
  await closeAll(kioskA);
});

test('S3 (AC-023f) 두 번째 저장도 다른 설정을 잃지 않는다: 앞서 직접 설정한 종류와 자동 복귀 값이 그대로 다시 보내진다', async ({ request }) => {
  const { page } = ha;
  await setRow(page, 'RESULT', '50', '80');
  await expect(saveButton(page)).toBeEnabled();
  await saveButton(page).click();
  await expect(messageOf(page, 'SAVED')).toBeVisible();
  await expectRow(page, 'INPUT', 20, 40, 'custom');
  await expectRow(page, 'RESULT', 50, 80, 'custom');
  await expect(holdInput(page)).toHaveValue('5');
  const stored = await serverPolicy(ha);
  expect(stored['customizedScreens']).toEqual(['INPUT', 'RESULT']);
  expect(stored['idlePolicy']['completionHoldSeconds']).toBe(5);
  expect(stored['idlePolicy']['screens']['INPUT']).toEqual({ warnSeconds: 20, resetSeconds: 40 });
  expect((await auditLog(request)).length).toBe(baselineAudit + 2);
  await shoot(page, '03-saved-second');
});

test('S4 (AC-023f) "기본값으로 되돌리기": 누른 종류만 기본값으로 돌아가고 나머지는 그대로다 (생략한 종류는 기본값이 되는 PUT 전체 교체의 정확한 반영)', async () => {
  const { page } = ha;
  await page.locator('[data-idle-revert="INPUT"]').click();
  await expectRow(page, 'INPUT', 100, 120, 'default');
  await expect(page.locator('[data-idle-reverted="INPUT"]')).toContainText('저장하면 기본값으로 돌아갑니다');
  await expectRow(page, 'RESULT', 50, 80, 'custom');
  await expect(saveButton(page)).toBeEnabled();
  await saveButton(page).click();
  await expect(messageOf(page, 'SAVED')).toBeVisible();
  await expectRow(page, 'INPUT', 100, 120, 'default');
  await expectRow(page, 'RESULT', 50, 80, 'custom');
  await expect(page.locator('[data-idle-reverted="INPUT"]')).toHaveCount(0);
  const stored = await serverPolicy(ha);
  expect(stored['customizedScreens']).toEqual(['RESULT']);
  expect(stored['idlePolicy']['completionHoldSeconds']).toBe(5);
  await shoot(page, '04-reverted');
});

test('S5 (AC-023d·AC-023f) 잘못된 값은 서버가 거절하고 화면이 어느 값이 왜 틀렸는지 알린다: 저장소·감사 기록은 한 글자도 바뀌지 않고 입력은 남는다', async ({ request }) => {
  const { page } = ha;
  const stateBefore = await stateText(request);
  const auditBefore = (await auditLog(request)).length;
  const storedBefore = JSON.stringify(await serverPolicy(ha));
  const expectUntouched = async (): Promise<void> => {
    expect(await stateText(request)).toBe(stateBefore);
    expect((await auditLog(request)).length).toBe(auditBefore);
    expect(JSON.stringify(await serverPolicy(ha))).toBe(storedBefore);
  };

  // 간격 10초(< 20초)
  await setRow(page, 'HOLD_RESULT', '100', '110');
  await expect(page.locator('[data-idle-hint="HOLD_RESULT"]')).toContainText('20초 이상');
  await expect(saveButton(page)).toBeEnabled();
  await saveButton(page).click();
  await expect(messageOf(page, 'HTTP_400')).toBeVisible();
  await expect(messageOf(page, 'HTTP_400')).toContainText('보류 결과');
  await expect(messageOf(page, 'HTTP_400')).toContainText('20초 이상 길어야 합니다');
  await expect(messageOf(page, 'HTTP_400')).toContainText('저장되지 않았고 서버의 설정은 그대로입니다');
  await expect(warnInput(page, 'HOLD_RESULT')).toHaveValue('100');
  await expect(resetInput(page, 'HOLD_RESULT')).toHaveValue('110');
  await shoot(page, '05-rejected-lead');
  await expectUntouched();

  // 경고 = 초기화
  await setRow(page, 'HOLD_RESULT', '120', '120');
  await saveButton(page).click();
  await expect(messageOf(page, 'HTTP_400')).toContainText('20초 이상 길어야 합니다');
  await expectUntouched();

  // 정수가 아닌 값
  await setRow(page, 'HOLD_RESULT', '90.5', '150');
  await expect(page.locator('[data-idle-hint="HOLD_RESULT"]')).toContainText('0 이상의 정수');
  await saveButton(page).click();
  await expect(messageOf(page, 'HTTP_400')).toContainText('경고 시간은 0 이상의 정수');
  await expectUntouched();

  // 비어 있는 칸(서버가 비어 있는 값을 거절한다)
  await setRow(page, 'HOLD_RESULT', '', '150');
  await saveButton(page).click();
  await expect(messageOf(page, 'HTTP_400')).toBeVisible();
  await expectUntouched();

  // 자동 복귀 0초(양의 정수가 아님)
  await page.locator('[data-idle-reload]').click();
  await expect(page.locator('[data-idle-dirty]')).toHaveAttribute('data-idle-dirty', 'false');
  await holdInput(page).fill('0');
  await expect(page.locator('[data-idle-hold-hint]')).toContainText('1 이상의 정수');
  await saveButton(page).click();
  await expect(messageOf(page, 'HTTP_400')).toContainText('이용 완료 자동 복귀 시간은 1 이상의 정수');
  await expectUntouched();

  // 자동 복귀를 켰는데 비워 둠: 화면이 기본 시간을 만들어 채우지 않고 서버가 거절한다.
  await holdInput(page).fill('');
  await saveButton(page).click();
  await expect(messageOf(page, 'HTTP_400')).toBeVisible();
  await expectUntouched();

  // 서버 값 다시 읽기로 입력을 버린다.
  await page.locator('[data-idle-reload]').click();
  await expect(holdInput(page)).toHaveValue('5');
  await expectRow(page, 'HOLD_RESULT', 160, 180, 'default');
});

test('S5b 낡은 화면은 다른 창에서 저장된 설정을 덮어쓰지 않는다: 저장 직전에 서버 값이 달라졌으면 아무것도 저장하지 않고 서버 값을 다시 보인다 (AC-023f)', async ({ browser, request }) => {
  const { page } = ha;
  // 같은 계정의 두 번째 창이 먼저 저장한다.
  const other = await openAs(browser, 'ha-clinic-1');
  await gotoPolicy(other.page);
  await setRow(other.page, 'HOLD_RESULT', '170', '200');
  await saveButton(other.page).click();
  await expect(messageOf(other.page, 'SAVED')).toBeVisible();
  const auditAfterOther = (await auditLog(request)).length;
  const serverAfterOther = JSON.stringify(await serverPolicy(ha));
  const stateAfterOther = await stateText(request);

  // 이 창은 그 사이를 모른 채 다른 종류만 고쳐 저장한다: PUT 이 전체 교체라 그대로 보내면 HOLD_RESULT 설정이 지워진다.
  await setRow(page, 'NOTICE_PROGRESS_ERROR', '95', '160');
  await expect(sourceOf(page, 'HOLD_RESULT')).toHaveAttribute('data-idle-source-kind', 'default');
  await saveButton(page).click();
  await expect(messageOf(page, 'SERVER_CHANGED')).toBeVisible();
  await expect(messageOf(page, 'SERVER_CHANGED')).toContainText('아무것도 저장하지 않았고');
  // 서버 값은 두 번째 창이 저장한 그대로이고(저장소 전체 사본·감사 기록 불변), 이 창은 서버 값을 다시 읽어 보인다(입력은 지워졌다).
  expect(await stateText(request)).toBe(stateAfterOther);
  expect((await auditLog(request)).length).toBe(auditAfterOther);
  expect(JSON.stringify(await serverPolicy(ha))).toBe(serverAfterOther);
  await expectRow(page, 'HOLD_RESULT', 170, 200, 'custom');
  await expectRow(page, 'NOTICE_PROGRESS_ERROR', 100, 120, 'default');
  await expect(saveButton(page)).toBeDisabled();
  await shoot(page, '05b-server-changed');
  // 다시 고쳐 저장하면 두 설정이 모두 남는다.
  await setRow(page, 'NOTICE_PROGRESS_ERROR', '95', '160');
  await saveButton(page).click();
  await expect(messageOf(page, 'SAVED')).toBeVisible();
  expect((await serverPolicy(ha))['customizedScreens']).toEqual(expect.arrayContaining(['RESULT', 'HOLD_RESULT', 'NOTICE_PROGRESS_ERROR']));
  await closeAll(other);
});

test('S6 (AC-023d·AC-023g) completionHoldSeconds: null(자동 복귀 없음)과 양의 정수(1초 포함, 20초 하한 없음)가 저장되고, 새로 연 키오스크의 이용 완료 화면이 그대로 따른다', async ({ browser, request }) => {
  const { page } = ha;
  // null: 자동 복귀를 끈다.
  await holdToggle(page).uncheck();
  await expect(holdInput(page)).toBeDisabled();
  await saveButton(page).click();
  await expect(messageOf(page, 'SAVED')).toBeVisible();
  await expect(page.locator('[data-idle-hold-state]')).toHaveText('자동 복귀 없음');
  expect((await serverPolicy(ha))['idlePolicy']['completionHoldSeconds']).toBeNull();
  expect((await publicSnapshot(request, SLUG_1, [TREATMENT_A])).catalog.body['idlePolicy']['completionHoldSeconds']).toBeNull();
  const none = await kioskAtComplete(browser);
  await none.page.clock.runFor(600_000);
  await expect(none.page.locator('[data-kiosk-state="COMPLETE"]'), '자동 복귀 없음: 10분이 지나도 이용 완료 화면에 머문다').toBeVisible();
  await closeAll(none);

  // 1초: 20초 하한이 없다.
  await holdToggle(page).check();
  await expect(holdInput(page)).toHaveValue('');
  await holdInput(page).fill('1');
  await saveButton(page).click();
  await expect(messageOf(page, 'SAVED')).toBeVisible();
  expect((await serverPolicy(ha))['idlePolicy']['completionHoldSeconds']).toBe(1);

  // 5초: 새로 연 키오스크가 이용 완료 5초 뒤 처음 화면으로 돌아간다.
  await holdInput(page).fill('5');
  await saveButton(page).click();
  await expect(messageOf(page, 'SAVED')).toBeVisible();
  await expect(page.locator('[data-idle-hold-state]')).toHaveText('5초 뒤 자동으로 복귀');
  expect((await serverPolicy(ha))['idlePolicy']['completionHoldSeconds']).toBe(5);
  const five = await kioskAtComplete(browser);
  await five.page.clock.runFor(3_000);
  await expect(five.page.locator('[data-kiosk-state="COMPLETE"]'), '3초: 아직 이용 완료 화면').toBeVisible();
  await five.page.clock.runFor(4_000);
  await expectStartScreen(five.page);
  await closeAll(five);
  await shoot(page, '06-hold-five');
});

test('S7 (AC-023f) 응답이 끊기거나 서버 오류이면 저장 실패로 단정하지 않고 서버 값을 다시 읽어 알린다', async ({ request }) => {
  const { page } = ha;
  const url = `**${policyApi(CLINIC_1)}`;
  const base = JSON.stringify((await serverPolicy(ha))['idlePolicy']);
  const auditBefore = (await auditLog(request)).length;

  // (가) 요청이 서버에 닿기 전에 끊김 → 다시 읽어 보니 저장되지 않음. 입력은 남고 다시 저장할 수 있다.
  await page.route(url, async (route) => {
    if (route.request().method() === 'PUT') await route.abort('failed');
    else await route.continue();
  });
  await setRow(page, 'BASIS_AND_DOCUMENTS', '170', '200');
  await saveButton(page).click();
  await expect(messageOf(page, 'LOST_NOT_SAVED')).toBeVisible();
  await expect(messageOf(page, 'LOST_NOT_SAVED')).toContainText('저장되어 있지 않습니다');
  await expect(warnInput(page, 'BASIS_AND_DOCUMENTS')).toHaveValue('170');
  await expect(saveButton(page)).toBeEnabled();
  expect(JSON.stringify((await serverPolicy(ha))['idlePolicy'])).toBe(base);
  expect((await auditLog(request)).length).toBe(auditBefore);
  await shoot(page, '07-lost-not-saved');

  // (나) 서버가 저장했는데 응답이 끊김 → 다시 읽어 보니 입력한 값이 저장되어 있음.
  await page.unroute(url);
  await page.route(url, async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await saveButton(page).click();
  await expect(messageOf(page, 'LOST_CONFIRMED')).toBeVisible();
  await expect(messageOf(page, 'LOST_CONFIRMED')).toContainText('방금 입력한 값이 저장되어 있습니다');
  await expectRow(page, 'BASIS_AND_DOCUMENTS', 170, 200, 'custom');
  await expect(saveButton(page)).toBeDisabled();
  expect((await serverPolicy(ha))['customizedScreens']).toContain('BASIS_AND_DOCUMENTS');
  expect((await auditLog(request)).length).toBe(auditBefore + 1);
  await shoot(page, '08-lost-confirmed');

  // (다) 서버 오류(500) → 저장 여부를 단정하지 않고 다시 읽는다. 서버에 닿지 않았으니 저장되지 않음.
  await page.unroute(url);
  await page.route(url, async (route) => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"INTERNAL_ERROR"}' });
    else await route.continue();
  });
  await setRow(page, 'NOTICE_PROGRESS_ERROR', '90', '150');
  await saveButton(page).click();
  await expect(messageOf(page, 'LOST_NOT_SAVED')).toBeVisible();
  await expect(warnInput(page, 'NOTICE_PROGRESS_ERROR')).toHaveValue('90');
  expect((await auditLog(request)).length).toBe(auditBefore + 1);

  // (라) 응답이 끊기고 다시 읽는 것도 실패 → 확인하지 못했다고 알리고 "서버 값 다시 확인" 을 준다. 서버는 실제로 저장했다.
  await page.unroute(url);
  // 저장 직전 확인(읽기)은 통과시키고, 서버가 저장한 직후부터 읽기를 막는다: 응답이 끊기고 그 뒤 다시 읽는 것도 실패하는 상황.
  let blockRead = false;
  await page.route(url, async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fetch();
      blockRead = true;
      await route.abort('failed');
    } else if (blockRead) await route.abort('failed');
    else await route.continue();
  });
  await saveButton(page).click();
  await expect(messageOf(page, 'LOST_UNVERIFIED')).toBeVisible();
  await expect(messageOf(page, 'LOST_UNVERIFIED')).toContainText('저장에 성공했을 수도, 실패했을 수도 있습니다');
  await expect(page.locator('[data-idle-recheck]')).toBeVisible();
  await expect(warnInput(page, 'NOTICE_PROGRESS_ERROR')).toHaveValue('90');
  await page.locator('[data-idle-recheck]').click();
  await expect(messageOf(page, 'RECHECK_FAILED')).toBeVisible();
  blockRead = false;
  await page.locator('[data-idle-recheck]').click();
  await expect(messageOf(page, 'LOST_CONFIRMED')).toBeVisible();
  await expect(page.locator('[data-idle-recheck]')).toHaveCount(0);
  await expectRow(page, 'NOTICE_PROGRESS_ERROR', 90, 150, 'custom');
  expect((await auditLog(request)).length).toBe(auditBefore + 2);
  await shoot(page, '09-lost-unverified-recovered');
  await page.unroute(url);

  // (마) 저장 직전에 서버 값을 읽지 못하면 저장하지 않는다(낡은 화면으로 덮어쓸 수 있어서): 서버·감사 기록 불변, 입력은 남는다.
  const stateBeforePrecheck = await stateText(request);
  await page.route(url, async (route) => {
    if (route.request().method() === 'GET') await route.abort('failed');
    else await route.continue();
  });
  await setRow(page, 'HOLD_RESULT', '175', '205');
  await saveButton(page).click();
  await expect(messageOf(page, 'PRECHECK_FAILED')).toBeVisible();
  await expect(warnInput(page, 'HOLD_RESULT')).toHaveValue('175');
  expect(await stateText(request)).toBe(stateBeforePrecheck);
  await page.unroute(url);
});

test('S7b 응답이 끝내 오지 않아도 화면이 무한히 기다리지 않고 서버 값을 다시 읽어 알린다 (AC-023f)', async ({ request }) => {
  test.setTimeout(75_000);
  const { page } = ha;
  const url = `**${policyApi(CLINIC_1)}`;
  await page.locator('[data-idle-reload]').click();
  await expect(page.locator('[data-idle-dirty]')).toHaveAttribute('data-idle-dirty', 'false');
  const auditBefore = (await auditLog(request)).length;
  // 저장 요청은 서버에 닿지 않고 응답도 끝내 오지 않는다(핸들러가 아무것도 하지 않는다).
  await page.route(url, async (route) => {
    if (route.request().method() === 'PUT') return;
    await route.continue();
  });
  await setRow(page, 'HOLD_RESULT', '176', '206');
  await saveButton(page).click();
  await expect(saveButton(page)).toBeDisabled();
  await expect(messageOf(page, 'LOST_NOT_SAVED')).toBeVisible({ timeout: 40_000 });
  await expect(warnInput(page, 'HOLD_RESULT')).toHaveValue('176');
  await expect(saveButton(page)).toBeEnabled();
  expect((await auditLog(request)).length).toBe(auditBefore);
  await page.unroute(url);
});

test('S8 (AC-022a·AC-023f) 접근: 인증 없음·다른 병원 관리자·검토 담당자는 안내만 보고 직접 보낸 쓰기도 거절되며, 병원 B 의 관리자는 B 만 바꾼다', async ({ browser, request }) => {
  const valid = { screens: { INPUT: { warnSeconds: 30, resetSeconds: 60 } }, completionHoldSeconds: 9 };
  const before = await stateText(request);
  const policyOfA = JSON.stringify((await serverPolicy(ha))['idlePolicy']);

  const anonymous = await openAs(browser, null);
  await anonymous.page.goto(policyPage(CLINIC_1));
  await expect(anonymous.page.locator('main[data-admin-state="unauthenticated"]')).toBeVisible();
  expect((await anonymous.context.request.put(policyApi(CLINIC_1), { data: valid })).status()).toBe(401);
  expect((await anonymous.context.request.get(policyApi(CLINIC_1))).status()).toBe(401);

  const rv = await openAs(browser, 'rv-1');
  await rv.page.goto(policyPage(CLINIC_1));
  await expect(rv.page.locator('main[data-admin-state="forbidden"]')).toBeVisible();
  expect((await rv.context.request.put(policyApi(CLINIC_1), { data: valid })).status()).toBe(403);

  const po = await openAs(browser, 'po-1');
  expect((await po.context.request.put(policyApi(CLINIC_1), { data: valid })).status()).toBe(403);

  const ha2 = await openAs(browser, 'ha-clinic-2');
  await ha2.page.goto(policyPage(CLINIC_1));
  await expect(ha2.page.locator('main[data-admin-state="forbidden"]')).toBeVisible();
  expect((await ha2.context.request.put(policyApi(CLINIC_1), { data: valid })).status()).toBe(403);
  expect((await ha2.context.request.get(policyApi(CLINIC_1))).status()).toBe(403);
  await shoot(ha2.page, '10-forbidden');
  expect(await stateText(request)).toBe(before);

  // 병원 B 의 관리자는 자기 병원만 바꾼다: B 가 바뀌고 A 는 그대로이다.
  await gotoPolicy(ha2.page, CLINIC_2);
  await expectRow(ha2.page, 'INPUT', 100, 120, 'default');
  await setRow(ha2.page, 'INPUT', '30', '60');
  await saveButton(ha2.page).click();
  await expect(messageOf(ha2.page, 'SAVED')).toBeVisible();
  await expectRow(ha2.page, 'INPUT', 30, 60, 'custom');
  expect((await serverPolicy(ha2, CLINIC_2))['customizedScreens']).toEqual(['INPUT']);
  expect(JSON.stringify((await serverPolicy(ha))['idlePolicy'])).toBe(policyOfA);
  expect((await publicSnapshot(request, SLUG_2, [OTHER_TREATMENT])).catalog.body['idlePolicy']['screens']['INPUT']).toEqual({ warnSeconds: 30, resetSeconds: 60 });
  await closeAll(anonymous, rv, po, ha2);
});

test('S9 (AC-015i) 마무리: 이 파일의 모든 저장을 거친 뒤에도 가격·보장 규칙·계산·카탈로그 버전은 처음과 글자 그대로 같다', async ({ request }) => {
  const nowA = await publicSnapshot(request, SLUG_1, [TREATMENT_A]);
  expect(withoutPolicy(nowA.catalog)).toBe(withoutPolicy(baselineA.catalog));
  expect(nowA.options.text).toBe(baselineA.options.text);
  expect(nowA.estimate.text).toBe(baselineA.estimate.text);
  const nowB = await publicSnapshot(request, SLUG_2, [OTHER_TREATMENT]);
  expect(withoutPolicy(nowB.catalog)).toBe(withoutPolicy(baselineB.catalog));
  expect(nowB.options.text).toBe(baselineB.options.text);
  expect(nowB.estimate.text).toBe(baselineB.estimate.text);
  // 달라진 저장소 영역은 정책과 감사 기록뿐이다.
  expect(changedStateKeys(baselineState, await stateText(request))).toEqual(['auditLog', 'idlePolicies']);
  const saves = (await auditLog(request)).slice(baselineAudit);
  expect(saves.every((entry) => entry['action'] === 'IDLE_POLICY_SAVE')).toBe(true);
  await closeAll(ha);
});
