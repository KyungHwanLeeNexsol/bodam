import { expect, test } from '../helpers/test';
import {
  CLINIC_1,
  CLINIC_2,
  CLINIC_3,
  CLINIC_4,
  NAME_A,
  NAME_OTHER,
  OTHER_TREATMENT,
  SLUG_1,
  SLUG_2,
  SLUG_3,
  SLUG_4,
  TREATMENT_A,
  TREATMENT_C,
  addScopeClinics,
  approvedMapping,
  assignViaApi,
  auditLog,
  baseRow,
  bundleOverview,
  changedStateKeys,
  closeAll,
  estimateWith,
  excerpt,
  gotoBundles,
  gotoScope,
  json,
  kioskCalculate,
  lineOf,
  newestBaseId,
  note,
  openAs,
  publicSnapshot,
  publishViaApi,
  resetNote,
  resetWorld,
  scopeClinicPath,
  scopeOverview,
  scopeRow,
  shoot,
  stateText,
  suspendOpen,
  suspendUrl,
} from '../helpers/bundle-flow';
import type { Json, Session } from '../helpers/bundle-flow';

// 묶음 중지와 병원별 재지정 (SPEC-REIMBURSEMENT-001 M7 묶음 중지, AC-025f · DD-14 · DD-17): 실제 Chrome, 실제 HTTP(요청 가로채기 없음), 묶음 시연 세계(--bundle-demo) + 시험 전용 끝점(--test-hooks).
// 세계: 병원 A(=병원 1)·B(=병원 2)는 기준 묶음 X 를 쓴다. 시험이 정상 묶음 Y(X 에 매핑 C 를 더한 묶음)를 게시하고, 병원 C 는 Y 를 쓰며, 병원 D 는 예전에 X 를 썼다가 지금은 Y 를 쓴다.
//   (병원 C·D 는 시험 전용 끝점이 병원 기록만 더한 것이고 범위는 실제 PO 관리자 API 로 지정한다. 카탈로그가 없어 키오스크 계산은 A·B 만 한다.)
// 증명하려는 것:
//   - 검토 담당자(RV)가 화면에서 사유와 함께 X 를 중지하면 영향 병원 목록에는 지금 X 를 쓰는 A·B 만 나온다(C 와 지난 이력만 있는 D 는 없다). 사유가 없으면 단추가 닫혀 있다.
//   - 중지는 묶음의 가용성만 바꾼다: 저장소에서 달라진 영역은 감사 기록과 가용성 기록뿐이고(묶음 내용 · 항목 상태 · 병원별 지정 그대로), 감사 기록에 수행자 · 시각 · 사유 · 이전/이후 상태 · 영향 병원 수가 남는다.
//   - 중지 직후 A·B 가 기존 버전(X)으로 계산해도 409 가 아니라 200 ON_HOLD / RULE_BUNDLE_SUSPENDED 이다(HTTP 와 키오스크 화면).
//   - 화면을 연 뒤 X 가 중지된 것을 모르는 PO 가 X 를 지정하면 서버가 409 BUNDLE_NOT_ACTIVE 로 거절하고 지정 · 이력 · 감사 기록은 그대로이며 화면이 최신 상태로 다시 불러온다.
//   - PO 가 A 만 정상 묶음 Y 로 재지정하면 A 만 복구된다: A 의 옛 버전(X) 요청은 409 VERSION_MISMATCH, Y 요청은 계산되고, B 는 계속 X(중지)라 보류다.
//   - 권한 위반 · 빈 사유 · 중복 중지 · 없는 묶음 · 중지된 묶음 지정은 모두 거절되고 저장소 전체 사본과 감사 기록이 한 글자도 바뀌지 않는다. 되살리기 · 자동 교체 · 병원 하나만 즉시 멈추는 경로는 없다.
// 한 파일 안에서 순서대로 돈다. 사진은 .moai/state/shots/m7-bundle/ 에 남고(육안 검토용), 실행 기록은 KIOSK_E2E_EVIDENCE_DIR 을 정했을 때만 쌓인다(helpers/evidence.ts).

test.describe.configure({ mode: 'serial' });

const LOG = 'bundle-suspend-log.txt';
/** 키오스크에서 병원 A 의 치료 C(묶음 시연 세계에서 더해진 치료)를 고르는 이름. */
const PICK_C = /시험 치료 C/;
const REASON = 'TEST_FIXTURE 약관 개정으로 묶음 중지';

let x = '';
let y = '';
/** 중지 전에 열어 둔 PO 의 규칙 사용 범위 화면: 이 화면은 X 가 아직 사용 가능하다고 믿고 있다. */
let poStale: Session | null = null;
let stateBeforeSuspend = '';
let auditBeforeSuspend = 0;
let auditAfterSuspend = 0;
let baselineA: { status: number; state: string } = { status: 0, state: '' };

const holdReasons = (call: { body: Json }): string[] => [...new Set(((call.body['result'] as Json)['lines'] as Json[]).map((line) => String(line['holdReason'])))];

test('S0 세계 만들기와 기준선: A·B 는 X, C·D 는 Y 를 쓴다. PO 화면을 중지 전에 열어 둔다', async ({ browser, request }) => {
  await resetWorld(request);
  resetNote(LOG);
  note('# M7 묶음 중지 브라우저 시험(admin-bundle-suspend) 흐름 기록 — 실제 Chrome, 실제 HTTP(요청 가로채기 없음), 묶음 시연 세계(--bundle-demo)');
  const ha = await openAs(browser, 'ha-clinic-1');
  const rv1 = await openAs(browser, 'rv-1');
  const rv2 = await openAs(browser, 'rv-2');
  const po = await openAs(browser, 'po-1');
  try {
    x = await newestBaseId(rv2);
    const mapping = await approvedMapping({ ha, rv1, rv2 }, TREATMENT_C);
    y = await publishViaApi(rv2, x, [{ id: mapping.id, version: mapping.version }]);
    expect(y).not.toBe(x);

    await addScopeClinics(request);
    await assignViaApi(po, CLINIC_3, y, null);
    await assignViaApi(po, CLINIC_4, x, null);
    await assignViaApi(po, CLINIC_4, y, x);

    const scope = await scopeOverview(po);
    expect((scope['clinics'] as Json[]).map((clinic) => [clinic['clinicId'], (clinic['current'] as Json)['bundleId'], (clinic['current'] as Json)['status']])).toEqual([
      [CLINIC_1, x, 'ACTIVE'],
      [CLINIC_2, x, 'ACTIVE'],
      [CLINIC_3, y, 'ACTIVE'],
      [CLINIC_4, y, 'ACTIVE'],
    ]);
    note(`세계: X=${x} (A=${SLUG_1}, B=${SLUG_2} 사용), Y=${y} (C=${SLUG_3} 사용, D=${SLUG_4} 는 X 를 쓰다가 Y 로 옮김)`);

    // 기준선: 중지 전 A 는 정상 계산, B 도 보류가 아니다.
    const a = await publicSnapshot(ha.context.request, SLUG_1, [TREATMENT_A]);
    expect(a.estimate.status).toBe(200);
    expect(lineOf(a.estimate, TREATMENT_A).state).toBe('ESTIMATED');
    baselineA = { status: a.estimate.status, state: String(lineOf(a.estimate, TREATMENT_A)['state']) };
    const b = await publicSnapshot(ha.context.request, SLUG_2, [OTHER_TREATMENT]);
    expect(b.estimate.status).toBe(200);
    expect(holdReasons(b.estimate)).not.toContain('RULE_BUNDLE_SUSPENDED');

    stateBeforeSuspend = await stateText(request);
    auditBeforeSuspend = (await auditLog(request)).length;

    // PO 화면을 지금(세계를 다 만든 뒤, 중지 전에) 새로 열어 둔다: 병원 4 줄이 Y 를 보이고 X 는 고를 수 있는 묶음이다.
    poStale = po;
    await gotoScope(po);
    await expect(scopeRow(po.page, CLINIC_4)).toHaveAttribute('data-admin-scope-current', y);
    await expect(po.page.locator(`select[data-admin-scope-select="${CLINIC_4}"] option[value="${x}"]`)).toBeEnabled();
    note(`기준선: A[치료 A] ${baselineA.status} ${baselineA.state}, B 보류 아님. 감사 기록 ${String(auditBeforeSuspend)}건. PO 화면을 중지 전에 열어 둠(X 선택 가능)`);
  } finally {
    await closeAll(ha, rv1, rv2);
  }
});

test('S1 RV 화면: 사유 없이는 중지할 수 없고, 사유와 함께 중지하면 영향 병원은 A·B 뿐이다(C·D 는 없다). 감사 기록과 가용성 기록만 늘고 묶음 내용·항목 상태·병원별 지정은 그대로다', async ({ browser, request }) => {
  const rv2 = await openAs(browser, 'rv-2');
  try {
    const page = rv2.page;
    await gotoBundles(rv2);

    // 기준 묶음 표: X 는 A·B, Y 는 C·D 가 쓰고 있다. 중지 조작은 사용 가능한 두 묶음 모두에 있다.
    await expect(baseRow(page, x).locator('[data-admin-base-clinics]')).toContainText(SLUG_1);
    await expect(baseRow(page, x).locator('[data-admin-base-clinics]')).toContainText(SLUG_2);
    await expect(baseRow(page, x).locator('[data-admin-base-clinics]')).not.toContainText(SLUG_3);
    await expect(baseRow(page, y).locator('[data-admin-base-clinics]')).toContainText(SLUG_3);
    await expect(baseRow(page, y).locator('[data-admin-base-clinics]')).toContainText(SLUG_4);
    await expect(suspendOpen(page, x)).toBeVisible();
    await expect(suspendOpen(page, y)).toBeVisible();

    // 중지 확인 전: 지금 이 묶음을 쓰는 병원이 보이고(A·B 뿐), 사유가 비었거나 공백뿐이면 확정이 닫혀 있다.
    await suspendOpen(page, x).click();
    const form = page.locator(`[data-admin-suspend="${x}"]`);
    await expect(form).toBeVisible();
    await expect(form.locator('[data-admin-suspend-clinics]')).toContainText(SLUG_1);
    await expect(form.locator('[data-admin-suspend-clinics]')).toContainText(SLUG_2);
    await expect(form.locator('[data-admin-suspend-clinics]')).not.toContainText(SLUG_3);
    await expect(form.locator('[data-admin-suspend-clinics]')).not.toContainText(SLUG_4);
    await expect(form.locator('[data-admin-suspend-note]')).toContainText('다시 사용 가능으로 되돌리거나 다른 묶음으로 자동으로 바꾸는 기능은 없습니다');
    const confirm = page.locator('button[data-admin-action="suspend-confirm"]');
    await expect(confirm).toBeDisabled();
    await expect(form.locator('[data-admin-suspend-hint]')).toContainText('사유를 적어야 중지할 수 있습니다');
    await form.locator('textarea[data-admin-suspend-reason]').fill('   ');
    await expect(confirm).toBeDisabled();
    await shoot(page, 'suspend-1-form-empty-reason');

    // 취소하면 아무것도 보내지 않는다. 다시 열어 사유를 적는다.
    const writes: string[] = [];
    page.on('request', (entry) => {
      if (entry.method() !== 'GET') writes.push(`${entry.method()} ${new URL(entry.url()).pathname}`);
    });
    await page.locator('button[data-admin-action="suspend-cancel"]').click();
    await expect(form).toHaveCount(0);
    expect(writes).toEqual([]);
    expect(await stateText(request)).toBe(stateBeforeSuspend);
    await suspendOpen(page, x).click();
    await page.locator('textarea[data-admin-suspend-reason]').fill(REASON);
    await expect(confirm).toBeEnabled();
    await shoot(page, 'suspend-2-form-ready');

    // 중지 확정: 요청은 POST rule-bundles/{X}/suspend 하나다.
    const suspended = page.waitForResponse((entry) => entry.request().method() === 'POST' && entry.url().endsWith(`/api/admin/rule-bundles/${encodeURIComponent(x)}/suspend`));
    await confirm.click();
    const response = await suspended;
    expect(response.status()).toBe(200);
    const body = (await response.json()) as Json;
    expect(response.request().postDataJSON()).toEqual({ reason: REASON });
    expect(body['bundle']).toEqual({ id: x, status: 'SUSPENDED' });
    expect(body['affectedClinics']).toEqual([
      { clinicId: CLINIC_1, slug: SLUG_1 },
      { clinicId: CLINIC_2, slug: SLUG_2 },
    ]);
    expect(body['suspension']).toMatchObject({ by: 'TEST_FIXTURE_RV_PERSON_2', role: 'RV', reason: REASON, previousStatus: 'ACTIVE' });
    expect(typeof (body['suspension'] as Json)['at']).toBe('string');
    expect(writes).toEqual([`POST /api/admin/rule-bundles/${x}/suspend`]);

    // 화면: 결과 문장 · 결과 영역의 영향 병원 목록(A·B 뿐) · X 는 중지됨(중지 단추 없음), Y 는 그대로.
    const message = page.locator('[data-admin-message="ok"]');
    await expect(message).toHaveAttribute('data-admin-message-code', 'SUSPENDED');
    await expect(message).toHaveAttribute('data-admin-suspended', x);
    await expect(message).toContainText('병원 2곳의 계산은 보류됩니다');
    await expect(message).toContainText('묶음 내용과 병원별 지정은 바뀌지 않았습니다');
    const result = page.locator(`[data-admin-suspend-result="${x}"]`);
    await expect(result.locator('li[data-admin-affected-clinic]')).toHaveCount(2);
    await expect(result.locator(`li[data-admin-affected-clinic="${SLUG_1}"]`)).toBeVisible();
    await expect(result.locator(`li[data-admin-affected-clinic="${SLUG_2}"]`)).toBeVisible();
    await expect(result.locator(`li[data-admin-affected-clinic="${SLUG_3}"]`)).toHaveCount(0);
    await expect(result.locator(`li[data-admin-affected-clinic="${SLUG_4}"]`)).toHaveCount(0);
    await expect(result.locator('[data-admin-suspend-result-reason]')).toContainText(REASON);
    await expect(baseRow(page, x)).toHaveAttribute('data-admin-base-status', 'SUSPENDED');
    await expect(suspendOpen(page, x)).toHaveCount(0);
    await expect(baseRow(page, y)).toHaveAttribute('data-admin-base-status', 'ACTIVE');
    await expect(suspendOpen(page, y)).toBeVisible();
    await expect(page.locator(`input[data-admin-base-radio="${x}"]`)).toBeDisabled();
    await shoot(page, 'suspend-3-result-affected-clinics');
    note(`중지(rv-2, 화면): X=${x} 사유="${REASON}" → 영향 병원 ${JSON.stringify(body['affectedClinics'])} (C=${SLUG_3}, D=${SLUG_4} 없음)`);

    // 저장소: 달라진 영역은 감사 기록과 가용성 기록뿐이다(묶음 내용 · 항목 상태 · 병원별 지정 · 범위 이력은 그대로).
    const after = await stateText(request);
    expect(changedStateKeys(stateBeforeSuspend, after)).toEqual(['auditLog', 'bundleEvents']);
    const audit = await auditLog(request);
    expect(audit).toHaveLength(auditBeforeSuspend + 1);
    expect(audit.at(-1)).toMatchObject({
      action: 'BUNDLE_SUSPEND',
      target: `BUNDLE/${x}`,
      actorId: 'TEST_FIXTURE_RV_PERSON_2',
      role: 'RV',
      beforeVersion: 'ACTIVE',
      afterVersion: 'SUSPENDED',
      reason: REASON,
      affectedClinicCount: 2,
    });
    expect(typeof (audit.at(-1) as Json)['at']).toBe('string');
    auditAfterSuspend = audit.length;
    note(`감사 기록 +1: ${JSON.stringify(audit.at(-1))}`);
    note(`저장소에서 달라진 영역 = ${JSON.stringify(changedStateKeys(stateBeforeSuspend, after))} (묶음 내용 · 항목 상태 · 병원별 지정 그대로)`);

    // 새로고침해도 같은 상태가 보인다(서버 상태).
    await page.reload();
    await expect(baseRow(page, x)).toHaveAttribute('data-admin-base-status', 'SUSPENDED');
    expect(((await bundleOverview(rv2))['bases'] as Json[]).map((base) => [base['bundleId'], base['status']]).sort()).toEqual([[x, 'SUSPENDED'], [y, 'ACTIVE']].sort());
  } finally {
    await closeAll(rv2);
  }
});

test('S2 중지 직후: A·B 가 기존 버전(X)으로 계산해도 409 가 아니라 200 ON_HOLD / RULE_BUNDLE_SUSPENDED (HTTP 와 키오스크 화면). 옵션은 SUSPENDED 를 가리키고 병원별 지정은 그대로다', async ({ browser }) => {
  const ha = await openAs(browser, 'ha-clinic-1');
  const po = await openAs(browser, 'po-1');
  try {
    const a = await publicSnapshot(ha.context.request, SLUG_1, [TREATMENT_A]);
    const b = await publicSnapshot(ha.context.request, SLUG_2, [OTHER_TREATMENT]);
    for (const [name, snapshot] of [['A', a], ['B', b]] as const) {
      expect(snapshot.options.body, `${name} 보험 선택지`).toMatchObject({ ruleBundleVersion: x, ruleBundleStatus: 'SUSPENDED' });
      expect(snapshot.estimate.status, `${name} 계산 상태`).toBe(200);
      expect((snapshot.estimate.body['result'] as Json)['state'], `${name} 결과`).toBe('ON_HOLD');
      expect(holdReasons(snapshot.estimate), `${name} 보류 사유`).toEqual(['RULE_BUNDLE_SUSPENDED']);
      expect((snapshot.estimate.body['versions'] as Json)['ruleBundleStatus']).toBe('SUSPENDED');
    }
    note(`중지 직후 HTTP: A ${String(a.estimate.status)} ${String((a.estimate.body['result'] as Json)['state'])} ${JSON.stringify(holdReasons(a.estimate))} / B ${String(b.estimate.status)} ${String((b.estimate.body['result'] as Json)['state'])} ${JSON.stringify(holdReasons(b.estimate))}`);

    // 키오스크 화면: 같은 병원의 환자 화면도 보류로 끝난다.
    const kioskA = await kioskCalculate(browser, SLUG_1, NAME_A, 'suspend-4-kiosk-a-on-hold');
    const kioskB = await kioskCalculate(browser, SLUG_2, NAME_OTHER, 'suspend-5-kiosk-b-on-hold');
    expect(kioskA.state).toBe('ON_HOLD');
    expect(kioskB.state).toBe('ON_HOLD');
    note(`중지 직후 키오스크: A ${kioskA.state}(${String(kioskA.kind)}) / B ${kioskB.state}(${String(kioskB.kind)})`);

    // PO 개요: A·B 는 아직 X(중지됨)를 쓰고, C·D 는 Y(사용 가능). 자동으로 옮겨진 병원은 없다.
    const scope = await scopeOverview(po);
    expect((scope['clinics'] as Json[]).map((clinic) => [clinic['clinicId'], (clinic['current'] as Json)['bundleId'], (clinic['current'] as Json)['status']])).toEqual([
      [CLINIC_1, x, 'SUSPENDED'],
      [CLINIC_2, x, 'SUSPENDED'],
      [CLINIC_3, y, 'ACTIVE'],
      [CLINIC_4, y, 'ACTIVE'],
    ]);
    expect((scope['bundles'] as Json[]).map((bundle) => [bundle['bundleId'], bundle['status']]).sort()).toEqual([[x, 'SUSPENDED'], [y, 'ACTIVE']].sort());
  } finally {
    await closeAll(ha, po);
  }
});

test('S3 PO 의 낡은 화면: 중지 전에 연 화면에서 X 를 병원 D 에 지정하면 서버가 409 BUNDLE_NOT_ACTIVE 로 거절한다. 지정 · 이력 · 감사 기록은 그대로이고 화면은 최신 상태를 다시 불러온다', async ({ request }) => {
  expect(poStale).not.toBeNull();
  const po = poStale as Session;
  const page = po.page;
  // 이 화면은 중지 전에 열렸다: X 가 아직 고를 수 있는 묶음으로 보인다.
  const select = page.locator(`select[data-admin-scope-select="${CLINIC_4}"]`);
  await expect(select.locator(`option[value="${x}"]`)).toBeEnabled();
  await select.selectOption(x);
  const confirm = page.locator(`button[data-admin-scope-confirm="${CLINIC_4}"]`);
  await expect(confirm).toBeEnabled();
  const stateBefore = await stateText(request);

  const attempted = page.waitForResponse((entry) => entry.request().method() === 'POST' && entry.url().endsWith(`/api/admin/rule-scope/clinics/${CLINIC_4}`));
  await confirm.click();
  const response = await attempted;
  expect(response.status()).toBe(409);
  expect(await response.json()).toEqual({ error: 'CONFLICT', reason: 'BUNDLE_NOT_ACTIVE' });

  const row = scopeRow(page, CLINIC_4);
  const message = row.locator('[data-admin-message="error"]');
  await expect(message).toHaveAttribute('data-admin-message-code', 'BUNDLE_NOT_ACTIVE');
  await expect(message).toContainText('중지되었거나');
  await expect(message).toContainText('이 병원의 지정은 바뀌지 않았습니다');
  await expect(message).not.toContainText('BUNDLE_NOT_ACTIVE');
  // 화면이 서버의 최신 상태로 다시 불러와졌다: X 는 이제 고를 수 없고, 병원 D 는 그대로 Y 다.
  await expect(select.locator(`option[value="${x}"]`)).toBeDisabled();
  await expect(row).toHaveAttribute('data-admin-scope-current', y);
  await expect(scopeRow(page, CLINIC_1).locator('[data-admin-scope-current-status="SUSPENDED"]')).toBeVisible();
  await shoot(page, 'suspend-6-po-stale-conflict');

  expect(await stateText(request)).toBe(stateBefore);
  expect(await auditLog(request)).toHaveLength(auditAfterSuspend);
  note(`PO 낡은 화면에서 X 를 병원 D 에 지정 → 409 BUNDLE_NOT_ACTIVE, 저장소 전체 사본 그대로, 감사 기록 ${String(auditAfterSuspend)}건 그대로, 화면은 최신 상태로 다시 불러옴(X 선택 불가)`);
});

test('S4 복구: PO 가 병원 A 만 정상 묶음 Y 로 재지정한다. A 의 옛 버전(X) 요청은 409, Y 요청은 계산되고, B 는 계속 X(중지)라 보류이며 감사 기록은 A 한 건만 늘었다', async ({ browser, request }) => {
  expect(poStale).not.toBeNull();
  const po = poStale as Session;
  const page = po.page;
  const ha = await openAs(browser, 'ha-clinic-1');
  try {
    const rowA = scopeRow(page, CLINIC_1);
    const rowB = scopeRow(page, CLINIC_2);
    // A·B 는 중지된 X 를 쓰고 있다고 보이고, 안내가 사용 가능한 묶음으로 다시 지정하라고 말한다.
    await expect(rowA.locator('[data-admin-scope-current-status="SUSPENDED"]')).toBeVisible();
    await expect(rowA.locator('[data-admin-scope-current-note]')).toContainText('사용 가능한 묶음으로 다시 지정해 주세요');
    await expect(rowB.locator('[data-admin-scope-current-status="SUSPENDED"]')).toBeVisible();
    await expect(page.locator(`select[data-admin-scope-select="${CLINIC_1}"] option[value="${x}"]`)).toBeDisabled();

    await page.locator(`select[data-admin-scope-select="${CLINIC_1}"]`).selectOption(y);
    await expect(rowA.locator('[data-admin-scope-change]')).toBeVisible();
    const auditBefore = (await auditLog(request)).length;
    const assigned = page.waitForResponse((entry) => entry.request().method() === 'POST' && entry.url().endsWith(`/api/admin/rule-scope/clinics/${CLINIC_1}`));
    await page.locator(`button[data-admin-scope-confirm="${CLINIC_1}"]`).click();
    expect((await assigned).status()).toBe(200);
    await expect(rowA.locator('[data-admin-message="ok"]')).toHaveAttribute('data-admin-message-code', 'ASSIGNED');
    await expect(rowA).toHaveAttribute('data-admin-scope-current', y);
    await expect(rowA.locator('[data-admin-scope-current-status="ACTIVE"]')).toBeVisible();
    // B 줄은 그대로 X(중지됨)다.
    await expect(rowB).toHaveAttribute('data-admin-scope-current', x);
    await expect(rowB.locator('[data-admin-scope-current-status="SUSPENDED"]')).toBeVisible();
    await shoot(page, 'suspend-7-po-reassigned-a-only');

    // HTTP: A 는 Y 를 가리키고, 옛 버전(X)을 본 요청은 409 VERSION_MISMATCH, Y 요청은 계산된다. B 는 같은 X 요청이 계속 보류다.
    const options = await ha.context.request.get(`/api/clinics/${SLUG_1}/insurance/options`);
    expect(await json(options)).toMatchObject({ ruleBundleVersion: y, ruleBundleStatus: 'ACTIVE' });
    const catalogA = ((await json(await ha.context.request.get(`/api/clinics/${SLUG_1}/catalog`)))['catalogVersion']) as string;
    const stale = await estimateWith(ha.context.request, SLUG_1, catalogA, x, [TREATMENT_A, TREATMENT_C]);
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: 'VERSION_MISMATCH', latest: { ruleBundleVersion: y, ruleBundleStatus: 'ACTIVE' }, changes: { ruleChanged: true } });
    const recovered = await estimateWith(ha.context.request, SLUG_1, catalogA, y, [TREATMENT_A, TREATMENT_C]);
    expect(recovered.status).toBe(200);
    expect(lineOf(recovered, TREATMENT_A).state).toBe('ESTIMATED');
    expect(lineOf(recovered, TREATMENT_C).state).toBe('ESTIMATED');
    const catalogB = ((await json(await ha.context.request.get(`/api/clinics/${SLUG_2}/catalog`)))['catalogVersion']) as string;
    const stillHeld = await estimateWith(ha.context.request, SLUG_2, catalogB, x, [OTHER_TREATMENT]);
    expect(stillHeld.status).toBe(200);
    expect(holdReasons(stillHeld)).toEqual(['RULE_BUNDLE_SUSPENDED']);
    note(`재지정 뒤 HTTP: A 옛 버전(X) ${String(stale.status)} VERSION_MISMATCH(최신=Y), A Y ${String(recovered.status)} ESTIMATED, B X ${String(stillHeld.status)} ${JSON.stringify(holdReasons(stillHeld))}`);

    // 키오스크 화면: A 는 치료 C 까지 정상 계산(Y 에는 C 의 매핑이 있다), B 는 계속 보류다.
    const kioskA = await kioskCalculate(browser, SLUG_1, PICK_C, 'suspend-8-kiosk-a-recovered');
    const kioskB = await kioskCalculate(browser, SLUG_2, NAME_OTHER, 'suspend-9-kiosk-b-still-on-hold');
    expect(kioskA.state).toBe('ESTIMATED');
    expect(kioskB.state).toBe('ON_HOLD');
    note(`재지정 뒤 키오스크: A ${kioskA.state} / B ${kioskB.state}`);

    // 감사 기록: 재지정 한 건(A, X → Y)뿐이다. X 는 끝까지 중지로 남고 가용성 기록은 ACTIVE → SUSPENDED 두 건이다.
    const audit = await auditLog(request);
    expect(audit).toHaveLength(auditBefore + 1);
    expect(audit.at(-1)).toMatchObject({ action: 'CLINIC_SCOPE_ASSIGN', target: `CLINIC/${CLINIC_1}`, beforeVersion: x, afterVersion: y, role: 'PO' });
    const scope = await scopeOverview(po);
    expect((scope['clinics'] as Json[]).map((clinic) => [clinic['clinicId'], (clinic['current'] as Json)['bundleId'], (clinic['current'] as Json)['status']])).toEqual([
      [CLINIC_1, y, 'ACTIVE'],
      [CLINIC_2, x, 'SUSPENDED'],
      [CLINIC_3, y, 'ACTIVE'],
      [CLINIC_4, y, 'ACTIVE'],
    ]);
    // 저장소 사본의 bundleEvents 는 [묶음 id, 사건 배열] 쌍의 목록이다.
    const eventsByBundle = new Map((JSON.parse(await stateText(request)) as { bundleEvents: Array<[string, Json[]]> }).bundleEvents);
    expect((eventsByBundle.get(x) ?? []).map((event) => event['status'])).toEqual(['ACTIVE', 'SUSPENDED']);
    expect((eventsByBundle.get(y) ?? []).map((event) => event['status'])).toEqual(['ACTIVE']);
  } finally {
    await closeAll(ha, po);
  }
});

test('S5 거절: 권한 위반 · 빈 사유 · 중복 중지 · 없는 묶음 · 중지된 묶음 지정 · 되살리기와 병원별 긴급 중지 경로는 모두 거절되고 저장소 전체 사본과 감사 기록이 한 글자도 바뀌지 않는다', async ({ browser, request }) => {
  const anonymous = await openAs(browser, null);
  const ha = await openAs(browser, 'ha-clinic-1');
  const po = await openAs(browser, 'po-1');
  const rv1 = await openAs(browser, 'rv-1');
  const bound = await openAs(browser, 'rv-clinic-1');
  try {
    const before = await stateText(request);
    const auditBefore = (await auditLog(request)).length;
    const cases: Array<[string, Session, string, unknown, number, Json]> = [
      ['인증 없음', anonymous, suspendUrl(y), { reason: REASON }, 401, { error: 'UNAUTHENTICATED' }],
      ['병원 관리자(HA)', ha, suspendUrl(y), { reason: REASON }, 403, { error: 'FORBIDDEN' }],
      ['플랫폼 운영자(PO)', po, suspendUrl(y), { reason: REASON }, 403, { error: 'FORBIDDEN' }],
      ['병원에 매인 RV', bound, suspendUrl(y), { reason: REASON }, 403, { error: 'FORBIDDEN' }],
      ['빈 사유', rv1, suspendUrl(y), { reason: '' }, 400, { error: 'INVALID_REQUEST', defects: [{ code: 'EMPTY', path: 'reason' }] }],
      ['공백뿐인 사유', rv1, suspendUrl(y), { reason: '   ' }, 400, { error: 'INVALID_REQUEST', defects: [{ code: 'EMPTY', path: 'reason' }] }],
      ['사유 키 없음', rv1, suspendUrl(y), {}, 400, { error: 'INVALID_REQUEST', defects: [{ code: 'VALUE_MISSING', path: 'reason' }] }],
      ['중복 중지(이미 중지된 X)', rv1, suspendUrl(x), { reason: '다시 중지' }, 409, { error: 'CONFLICT', reason: 'BUNDLE_NOT_ACTIVE' }],
      ['없는 묶음', rv1, suspendUrl('TEST_FIXTURE_NO_SUCH_BUNDLE'), { reason: REASON }, 404, { error: 'NOT_FOUND' }],
      ['되살리기 경로', rv1, `/api/admin/rule-bundles/${encodeURIComponent(x)}/activate`, { reason: REASON }, 404, { error: 'NOT_FOUND' }],
      ['병원 긴급 중지 경로(범위)', po, `/api/admin/rule-scope/clinics/${CLINIC_1}/suspend`, { reason: REASON }, 404, { error: 'NOT_FOUND' }],
      ['병원 긴급 중지 경로(병원)', ha, `/api/admin/clinics/${CLINIC_1}/suspend`, { reason: REASON }, 404, { error: 'NOT_FOUND' }],
      // PO: 중지된 묶음 X 를 병원 C 에 지정(화면이 본 현재 범위 Y 는 맞다) → 묶음이 ACTIVE 가 아니라 409.
      ['중지된 묶음 지정(PO)', po, scopeClinicPath(CLINIC_3), { ruleBundleVersionId: x, expectedCurrentBundleId: y }, 409, { error: 'CONFLICT', reason: 'BUNDLE_NOT_ACTIVE' }],
    ];
    for (const [name, session, path, data, status, expected] of cases) {
      const response = await session.context.request.post(path, { data });
      const text = await response.text();
      expect(response.status(), `${name}: ${excerpt(text, 200)}`).toBe(status);
      expect(JSON.parse(text) as Json, name).toEqual(expected);
      expect(await stateText(request), `${name} 뒤 저장소 사본`).toBe(before);
    }
    expect(await auditLog(request)).toHaveLength(auditBefore);
    note(`거절 ${String(cases.length)}건(인증 없음 · 권한 · 빈 사유 · 중복 중지 · 없는 묶음 · 되살리기·병원 긴급 중지 경로 · 중지된 묶음 지정): 모두 기대한 상태 번호이고 저장소 전체 사본 · 감사 기록(${String(auditBefore)}건)이 그대로`);
  } finally {
    await closeAll(anonymous, ha, po, rv1, bound);
  }
});
