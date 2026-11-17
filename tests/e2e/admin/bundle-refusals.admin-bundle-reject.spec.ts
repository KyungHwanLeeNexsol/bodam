import type { APIRequestContext, APIResponse } from '@playwright/test';
import { expect, test } from '../helpers/test';
import {
  CLINIC_1,
  CLINIC_2,
  PREVIEW_PATH,
  PUBLISH_PATH,
  REJECT_LOG_FILE,
  TREATMENT_A,
  TREATMENT_B,
  TREATMENT_C,
  approvedMapping,
  auditLog,
  bundleOverview,
  candidateRow,
  changeCoverage,
  closeAll,
  draftMapping,
  excerpt,
  fiveRoutes,
  gotoBundles,
  gotoScope,
  newestBaseId,
  note,
  openAs,
  openRoles,
  previewButton,
  previewConfirmation,
  publishButton,
  publishViaApi,
  refBody,
  requestReview,
  resetNote,
  resetWorld,
  scopeClinicPath,
  scopeRow,
  shoot,
  stateText,
  submitMapping,
  unapprovedMapping,
} from '../helpers/bundle-flow';
import type { Json, MappingRef, Session } from '../helpers/bundle-flow';

// 묶음 게시 · 규칙 사용 범위의 거절 (SPEC-REIMBURSEMENT-001 M7 묶음 구성). 두 화면과 다섯 API(RV: 개요 · 미리보기 · 게시, PO: 개요 · 지정)가 거절해야 할 때 거절하고, 거절은 저장 상태를 한 글자도 바꾸지 않음을 본다.
// 앞단(tests/e2e/harness/server.ts, 이 파일 전용 인스턴스 ADMIN_BUNDLE_REJECT_PORT)은 묶음 시연 세계(--bundle-demo)와 시험 전용 끝점(--test-hooks)을 켠 실제 관리자·공개 핸들러다. 통신 가로채기는 쓰지 않는다.
// 시험마다 /__harness/reset 으로 세계(저장소·시계·로그인 세션)를 통째로 새로 만들어 서로의 순서에 기대지 않는다(한 인스턴스를 쓰므로 파일 안에서는 순서대로 돈다).
// 거절마다: 거절 직전에 저장소 전체 사본(/__harness/state: 묶음·항목 상태·범위 이력·병원·카탈로그·감사 기록 모두)을 글자 그대로 떠 두고, 거절된 시도 뒤의 사본과 같음을 확인한다. 감사 기록도 사본에 들어 있어 거절은 감사 기록을 늘리지 않는다.
// 정직한 한계(서버가 실제로 내는 값을 본 그대로 적는다):
//   - 승인되지 않은 매핑(초안·검토 제출됨)을 게시하는 경로: 미리보기는 200 이고 결함(ITEM_STATE_NOT_PUBLISHABLE)을 담되 확인값은 null 이다(기록도 쓰지 않는다). 결함 있는 구성은 어떤 미리보기도 확인값을 내주지 않으므로 HTTP 로는 유효한 확인값을 얻을 수 없고,
//     게시는 400(결함)이 아니라 409 PREVIEW_REQUIRED 로 거절된다. 400 의 결함 목록은 "확인값을 받은 뒤에 구성이 바뀐" 경우(아래 FINGERPRINT_STALE)에만 HTTP 로 닿는다. 확인값은 서버가 발급해 기록한 값이라 입력에서 계산해 만들 수도 없다
//     (그 우회는 tests/api/admin-bundle-confirmation.test.ts 가 재현·차단을 확인한다). 기록이 있어도 게시 전제가 막는다는 것은 서비스 시험(tests/server/bundle-compose.test.ts)이 서버에 기록을 심어 본다.
//   - 겹치는 매핑 게시도 같다: 겹침이 확인값 확인보다 먼저 판정되므로 아무 확인값으로도 409 MAPPING_CONFLICT 이다.
//   - 깨끗한 미리보기는 서버에 확인값 기록 하나를 남긴다(저장소 사본의 bundleConfirmations). 그래서 "저장소 사본이 그대로"를 확인하는 구간은 깨끗한 미리보기를 받은 뒤에 거절 전 사본을 뜬다.
// 사진은 .moai/state/shots/m7-bundle/ 에 남고(육안 검토용 자료이며 시험 결과가 아니다), 관찰한 응답의 기록(bundle-reject-log.txt)은 환경 변수 KIOSK_E2E_EVIDENCE_DIR 을 정했을 때만 그 폴더에 쌓인다(helpers/evidence.ts).

test.describe.configure({ mode: 'serial' });

const NOT_ISSUED = 'a'.repeat(64);
const COVERAGE_SCOPE_OTHER = [{ generation: 'GEN3_C3', insurerType: 'NON_LIFE' }];
/** 기준 묶음에 들어 있는 치료 A 의 매핑(시험 자료: 묶음 시연 세계의 기준 묶음). */
const BASE_MAPPING_OF_A: MappingRef = { id: 'TEST_FIXTURE_MAPPING_TEST_FIXTURE_TREATMENT_1', version: 'v1' };

/** 응답 하나: 상태·본문·no-store 를 확인하고 기록에 남긴다. */
async function expectRefused(label: string, response: Pick<APIResponse, 'status' | 'headers' | 'json'>, status: number, body?: Json): Promise<Json> {
  const parsed = (await response.json()) as Json;
  expect(response.status(), `${label}: ${JSON.stringify(parsed)}`).toBe(status);
  if (body !== undefined) expect(parsed, label).toEqual(body);
  expect(response.headers()['cache-control'], label).toBe('no-store');
  note(`${label} → ${String(status)} ${excerpt(JSON.stringify(parsed), 260)}`, REJECT_LOG_FILE);
  return parsed;
}

const expectUnchanged = async (request: APIRequestContext, before: string, label: string): Promise<void> => {
  expect(await stateText(request) === before, `${label}: 저장소 사본이 거절 전과 같다`).toBe(true);
};

test('S0 (준비) 기록을 비운다', () => {
  resetNote(REJECT_LOG_FILE);
  note('# M7 묶음 구성 거절 시험(admin-bundle-reject) 기록 — 실제 Chrome, 실제 HTTP, 시험마다 세계를 새로 만든다. 모든 거절은 저장소 전체 사본(감사 기록 포함)이 거절 전과 같음을 함께 확인했다.', REJECT_LOG_FILE);
});

test('R-a 로그인 없음: 다섯 API 는 401 UNAUTHENTICATED(위조 쿠키·헤더도 같다), 두 화면은 안내만 보이고 단추·입력칸이 없다', async ({ browser, request }) => {
  await resetWorld(request);
  const roles = await openRoles(browser);
  const anonymous = await openAs(browser, null);
  try {
    const baseId = await newestBaseId(roles.rv1);
    const mapping = await approvedMapping(roles, TREATMENT_C);
    const before = await stateText(request);
    const spoof = { cookie: 'bodam_test_session=TEST_FIXTURE_SESSION_1_rv-1; role=RV', 'x-role': 'RV', 'x-clinic-id': CLINIC_1, authorization: 'Bearer RV' };
    for (const route of fiveRoutes(baseId, mapping)) {
      for (const [kind, headers] of [['일반', {}], ['위조 쿠키·헤더', spoof]] as const) {
        const response = await request.fetch(`${route.path}?role=${route.role}&clinicId=${CLINIC_1}`, { method: route.method, headers, ...(route.data === undefined ? {} : { data: route.data }) });
        await expectRefused(`로그인 없음 · ${route.name} · ${kind}`, response, 401, { error: 'UNAUTHENTICATED' });
      }
    }
    for (const path of ['/admin/bundles', '/admin/rule-scope']) {
      await anonymous.page.goto(path);
      await expect(anonymous.page.locator('[data-admin-state="unauthenticated"]')).toBeVisible();
      await expect(anonymous.page.locator('[data-admin-state] .admin-banner--error')).toContainText('로그인이 필요합니다');
      await expect(anonymous.page.getByRole('button')).toHaveCount(0);
      await expect(anonymous.page.locator('input, select, textarea')).toHaveCount(0);
      const text = await anonymous.page.locator('body').innerText();
      expect(text, `${path} 에 자료가 새지 않는다`).not.toMatch(/TEST_FIXTURE_BUNDLE|TEST_FIXTURE 시험 치료|TEST_FIXTURE 시험 의원|TEST_FIXTURE_MAPPING|TEST_FIXTURE_RV|TEST_FIXTURE_PO/);
      if (path === '/admin/bundles') await shoot(anonymous.page, 'bundle-9-unauthenticated');
    }
    await expectUnchanged(request, before, '로그인 없음');
  } finally {
    await closeAll(roles.ha, roles.rv1, roles.rv2, anonymous);
  }
});

test('R-b 잘못된 역할: 병원 관리자·병원에 매인 검토 담당자·운영자는 RV 경로가, 검토 담당자·병원 관리자는 PO 경로가 403 FORBIDDEN 이고, 화면은 forbidden 안내만 보인다', async ({ browser, request }) => {
  await resetWorld(request);
  const roles = await openRoles(browser);
  const sessions = {
    'ha-clinic-1': roles.ha,
    'ha-clinic-2': await openAs(browser, 'ha-clinic-2'),
    'rv-clinic-1': await openAs(browser, 'rv-clinic-1'),
    'po-1': await openAs(browser, 'po-1'),
  };
  try {
    const baseId = await newestBaseId(roles.rv1);
    const mapping = await approvedMapping(roles, TREATMENT_C);
    const before = await stateText(request);
    // RV 경로는 병원 관리자(양쪽 병원)·병원에 매인 검토 담당자·운영자가, PO 경로는 병원 관리자(양쪽 병원)·병원에 매인 검토 담당자·플랫폼 검토 담당자 둘이 열지 못한다.
    const rvDenied: Array<[string, Session]> = [['ha-clinic-1', sessions['ha-clinic-1']], ['ha-clinic-2', sessions['ha-clinic-2']], ['rv-clinic-1', sessions['rv-clinic-1']], ['po-1', sessions['po-1']]];
    const poDenied: Array<[string, Session]> = [['ha-clinic-1', sessions['ha-clinic-1']], ['ha-clinic-2', sessions['ha-clinic-2']], ['rv-clinic-1', sessions['rv-clinic-1']], ['rv-1', roles.rv1], ['rv-2', roles.rv2]];
    for (const route of fiveRoutes(baseId, mapping)) {
      for (const [account, session] of route.role === 'RV' ? rvDenied : poDenied) {
        const response = await session.context.request.fetch(route.path, { method: route.method, ...(route.data === undefined ? {} : { data: route.data }) });
        await expectRefused(`${account} · ${route.name}`, response, 403, { error: 'FORBIDDEN' });
      }
    }
    await expectUnchanged(request, before, '잘못된 역할(API)');

    // 화면: 접근할 수 없는 역할은 forbidden 안내만 보고, 단추·입력칸이 없고, 자료가 보이지 않는다.
    const pages: Array<[string, string, Session[], string]> = [
      ['/admin/bundles', '규칙 묶음을 게시할 권한이 없습니다', [sessions['ha-clinic-1'], sessions['rv-clinic-1'], sessions['po-1']], 'bundle-10-forbidden-po-bundles'],
      ['/admin/rule-scope', '병원의 규칙 사용 범위를 지정할 권한이 없습니다', [roles.rv1, roles.rv2, sessions['ha-clinic-1']], 'bundle-10-forbidden-rv-scope'],
    ];
    for (const [path, message, viewers, shotName] of pages) {
      for (const [index, viewer] of viewers.entries()) {
        await viewer.page.goto(path);
        await expect(viewer.page.locator('[data-admin-state="forbidden"]')).toBeVisible();
        await expect(viewer.page.locator('[data-admin-state] .admin-banner--error')).toContainText(message);
        await expect(viewer.page.getByRole('button')).toHaveCount(0);
        await expect(viewer.page.locator('input, select, textarea')).toHaveCount(0);
        expect(await viewer.page.locator('body').innerText(), `${path} 에 자료가 새지 않는다`).not.toMatch(/TEST_FIXTURE_BUNDLE|TEST_FIXTURE 시험 치료|TEST_FIXTURE_MAPPING/);
        if (index === 0 || (path === '/admin/rule-scope' && viewer === roles.rv1)) await shoot(viewer.page, shotName);
      }
    }
    await expectUnchanged(request, before, '잘못된 역할(화면)');
    note('화면: /admin/bundles 는 ha-clinic-1·rv-clinic-1·po-1 에게, /admin/rule-scope 는 rv-1·rv-2·ha-clinic-1 에게 data-admin-state=forbidden, 단추·입력칸 없음', REJECT_LOG_FILE);
  } finally {
    await closeAll(roles.ha, roles.rv1, roles.rv2, sessions['ha-clinic-2'], sessions['rv-clinic-1'], sessions['po-1']);
  }
});

test('R-c 승인되지 않은 매핑(초안 · 검토 제출됨)은 후보에 없고, 참조를 직접 보내면 미리보기는 결함(확인값 null), 게시는 409 PREVIEW_REQUIRED 로 거절된다', async ({ browser, request }) => {
  await resetWorld(request);
  const roles = await openRoles(browser);
  try {
    const baseId = await newestBaseId(roles.rv1);
    // C 는 초안만, B 는 검토 제출까지(승인 전). 어느 쪽도 후보가 아니다. B 의 매핑은 기준 묶음의 B 매핑과 겹치지 않는 칸(3세대 · 손해보험사)으로 만들어, 거절 이유가 "겹침"이 아니라 "승인 전"임을 분명히 한다.
    const draft = await unapprovedMapping(roles, TREATMENT_C, false);
    const submitted = await unapprovedMapping(roles, TREATMENT_B, true, { scope: COVERAGE_SCOPE_OTHER });
    const before = await stateText(request);
    expect((await bundleOverview(roles.rv2))['candidates']).toEqual([]);

    await gotoBundles(roles.rv2);
    await expect(roles.rv2.page.locator('[data-admin-candidates-empty]')).toBeVisible();
    await expect(roles.rv2.page.locator('[data-admin-candidate]')).toHaveCount(0);
    await expect(roles.rv2.page.locator('[data-admin-candidate-check]')).toHaveCount(0);
    await expect(previewButton(roles.rv2.page)).toBeDisabled();
    await expect(publishButton(roles.rv2.page)).toBeDisabled();

    for (const [name, ref] of [['초안(C)', draft], ['검토 제출됨(B)', submitted]] as const) {
      const preview = await roles.rv2.context.request.post(PREVIEW_PATH, { data: { baseBundleId: baseId, mappings: [refBody(ref)] } });
      const body = await expectRefused(`미리보기 · ${name}`, preview, 200);
      expect(body['publishConfirmation']).toBeNull();
      expect((body['defects'] as Json[]).map((defect) => defect['code'])).toContain('ITEM_STATE_NOT_PUBLISHABLE');
      expect(body['defects']).toContainEqual(expect.objectContaining({ code: 'ITEM_STATE_NOT_PUBLISHABLE' }));
      const publish = await roles.rv2.context.request.post(PUBLISH_PATH, { data: { baseBundleId: baseId, mappings: [refBody(ref)], publishConfirmation: NOT_ISSUED } });
      await expectRefused(`게시(아무 확인값) · ${name}`, publish, 409, { error: 'CONFLICT', reason: 'PREVIEW_REQUIRED' });
    }
    await expectUnchanged(request, before, '승인되지 않은 매핑');
    await shoot(roles.rv2.page, 'bundle-11-no-unapproved-candidates');
  } finally {
    await closeAll(roles.ha, roles.rv1, roles.rv2);
  }
});

test('R-d 승인 뒤 치료 정보가 바뀐 매핑: 미리보기를 본 뒤 바뀌면 게시는 400 FINGERPRINT_STALE 로 거절되고 화면이 한국어 거절 안내를 보인다. 바뀐 뒤의 후보는 STALE 경고, 미리보기는 결함과 확인값 null 이다', async ({ browser, request }) => {
  await resetWorld(request);
  const roles = await openRoles(browser);
  try {
    const baseId = await newestBaseId(roles.rv1);
    const mapping = await approvedMapping(roles, TREATMENT_C);
    await gotoBundles(roles.rv2);
    const page = roles.rv2.page;
    const row = candidateRow(page, mapping);
    await expect(row).toHaveAttribute('data-admin-candidate-fingerprint', 'CURRENT');
    await row.locator('[data-admin-candidate-check]').check();
    const previewed = page.waitForResponse((entry) => entry.request().method() === 'POST' && entry.url().endsWith('/api/admin/bundle-publish/preview'));
    await previewButton(page).click();
    const oldConfirmation = ((await (await previewed).json()) as Json)['publishConfirmation'] as string;
    expect(oldConfirmation).toMatch(/^[0-9a-f]{64}$/);
    await expect(publishButton(page)).toBeEnabled();

    // 미리보기를 본 뒤 승인된 매핑의 치료 정보(치료 코드, 보장 판단 필드)가 바뀐다 — 화면은 모른다.
    const changed = await changeCoverage(request);
    note(`치료 C 의 치료 코드를 ${String(changed['treatmentCode'])} 로 바꿈(시험 전용 끝점)`, REJECT_LOG_FILE);
    const before = await stateText(request);

    // 화면에서 게시를 누르면 서버가 거절한다: 400, 결함 FINGERPRINT_STALE. 화면은 한국어 거절 문장과 "아무것도 게시되지 않았고" 로 끝낸다.
    const published = page.waitForResponse((entry) => entry.request().method() === 'POST' && entry.url().endsWith('/api/admin/bundle-publish'));
    await publishButton(page).click();
    const refusal = await published;
    const refusalBody = await expectRefused('게시(화면) · 승인 뒤 치료 정보가 바뀜', refusal, 400);
    expect(refusalBody['error']).toBe('INVALID_REQUEST');
    expect(refusalBody['defects']).toContainEqual(expect.objectContaining({ code: 'FINGERPRINT_STALE' }));
    const message = page.locator('[data-admin-message="error"]');
    await expect(message).toBeVisible();
    await expect(message).toContainText('승인한 뒤 치료 정보가 바뀌어 게시할 수 없습니다');
    await expect(message).toContainText('아무것도 게시되지 않았고');
    await expect(message).not.toContainText('FINGERPRINT_STALE');
    note(`화면의 거절 문장: ${(await message.innerText()).trim()}  (data-admin-message-code=${String(await message.getAttribute('data-admin-message-code'))})`, REJECT_LOG_FILE);
    // 거절 뒤 화면은 서버의 현재 상태를 다시 읽는다: 후보가 STALE 경고를 달고, 게시는 닫혀 있다.
    await expect(row).toHaveAttribute('data-admin-candidate-fingerprint', 'STALE');
    await expect(row.locator('[data-admin-candidate-warning]')).toContainText('승인한 뒤 치료 정보가 바뀌었습니다');
    await expect(publishButton(page)).toBeDisabled();

    // 다시 미리보기: 결함이 보이고 확인값은 null(게시는 열리지 않는다).
    if (!(await row.locator('[data-admin-candidate-check]').isChecked())) await row.locator('[data-admin-candidate-check]').check();
    const again = page.waitForResponse((entry) => entry.request().method() === 'POST' && entry.url().endsWith('/api/admin/bundle-publish/preview'));
    await previewButton(page).click();
    const againBody = (await (await again).json()) as Json;
    expect(againBody['publishConfirmation']).toBeNull();
    expect(againBody['defects']).toContainEqual(expect.objectContaining({ code: 'FINGERPRINT_STALE' }));
    await expect(page.locator('[data-admin-preview]')).toHaveAttribute('data-admin-preview-publishable', 'false');
    await expect(page.locator('[data-admin-preview-defect="FINGERPRINT_STALE"]')).toContainText('다시 검토·승인이 필요합니다');
    await expect(publishButton(page)).toBeDisabled();
    await expect(page.locator('[data-admin-publish-hint]')).toContainText('게시를 막는 문제가 있어 게시할 수 없습니다');
    await shoot(page, 'bundle-12-stale-fingerprint');

    // API 로 직접: 예전 확인값도(400 FINGERPRINT_STALE), 아무 확인값도(409 PREVIEW_REQUIRED) 게시하지 못한다.
    const old = await roles.rv2.context.request.post(PUBLISH_PATH, { data: { baseBundleId: baseId, mappings: [refBody(mapping)], publishConfirmation: oldConfirmation } });
    const oldBody = await expectRefused('게시(API) · 예전 확인값', old, 400);
    expect(oldBody['defects']).toContainEqual(expect.objectContaining({ code: 'FINGERPRINT_STALE' }));
    const anyConfirmation = await roles.rv2.context.request.post(PUBLISH_PATH, { data: { baseBundleId: baseId, mappings: [refBody(mapping)], publishConfirmation: NOT_ISSUED } });
    await expectRefused('게시(API) · 아무 확인값', anyConfirmation, 409, { error: 'CONFLICT', reason: 'PREVIEW_REQUIRED' });
    await expectUnchanged(request, before, '승인 뒤 치료 정보가 바뀐 매핑');
  } finally {
    await closeAll(roles.ha, roles.rv1, roles.rv2);
  }
});

test('R-e 겹치는 매핑: 기준 묶음의 매핑과 겹치거나 함께 고른 매핑끼리 겹치면 미리보기가 겹침 문장을 보이고(확인값 null) 게시가 닫히며, API 게시는 409 MAPPING_CONFLICT 로 거절된다', async ({ browser, request }) => {
  await resetWorld(request);
  const roles = await openRoles(browser);
  try {
    const baseId = await newestBaseId(roles.rv1);
    // 치료 A: 기준 묶음에 이미 같은 칸(4세대 · 손해보험사)의 매핑이 있다 → 겹친다. 치료 C: 같은 칸을 덮는 승인된 매핑 둘 → 둘이 서로 겹친다.
    const a = await approvedMapping(roles, TREATMENT_A);
    const c1 = await approvedMapping(roles, TREATMENT_C);
    const c2 = await approvedMapping(roles, TREATMENT_C);
    await gotoBundles(roles.rv2);
    const page = roles.rv2.page;
    await expect(page.locator('[data-admin-candidate]')).toHaveCount(3);
    const before = await stateText(request);

    // 기준 묶음과 겹침.
    await candidateRow(page, a).locator('[data-admin-candidate-check]').check();
    const previewed = page.waitForResponse((entry) => entry.request().method() === 'POST' && entry.url().endsWith('/api/admin/bundle-publish/preview'));
    await previewButton(page).click();
    const body = (await (await previewed).json()) as Json;
    expect(body['publishConfirmation']).toBeNull();
    expect(body['conflicts']).toHaveLength(1);
    expect((body['conflicts'] as Json[])[0]).toMatchObject({ treatmentId: TREATMENT_A, conflictsWith: [expect.objectContaining({ source: 'BASE' })] });
    const preview = page.locator('[data-admin-preview]');
    await expect(preview).toHaveAttribute('data-admin-preview-publishable', 'false');
    await expect(preview.locator('[data-admin-preview-conflict]')).toHaveCount(1);
    await expect(preview.locator('[data-admin-preview-conflict]')).toContainText('기준 묶음의 매핑');
    await expect(preview.locator('[data-admin-preview-conflict]')).toContainText('적용 범위(4세대(C4) · 손해보험사)가 겹칩니다');
    await expect(preview.locator('[data-admin-preview-clean]')).toHaveCount(0);
    await expect(publishButton(page)).toBeDisabled();
    await expect(page.locator('[data-admin-publish-hint]')).toContainText('게시를 막는 문제가 있어 게시할 수 없습니다');
    await shoot(page, 'bundle-7-conflict');
    note(`화면(기준 묶음과 겹침): ${(await preview.locator('[data-admin-preview-conflict]').innerText()).trim()}`, REJECT_LOG_FILE);
    const apiBase = await roles.rv2.context.request.post(PUBLISH_PATH, { data: { baseBundleId: baseId, mappings: [refBody(a)], publishConfirmation: NOT_ISSUED } });
    await expectRefused('게시(API) · 기준 묶음과 겹침', apiBase, 409, { error: 'CONFLICT', reason: 'MAPPING_CONFLICT' });

    // 함께 고른 매핑끼리 겹침.
    await candidateRow(page, a).locator('[data-admin-candidate-check]').uncheck();
    await candidateRow(page, c1).locator('[data-admin-candidate-check]').check();
    await candidateRow(page, c2).locator('[data-admin-candidate-check]').check();
    await previewButton(page).click();
    await expect(page.locator('[data-admin-preview-conflict]')).toHaveCount(2);
    await expect(page.locator('[data-admin-preview]')).toContainText('함께 고른 매핑');
    await expect(page.locator('[data-admin-preview]')).toHaveAttribute('data-admin-preview-publishable', 'false');
    await expect(publishButton(page)).toBeDisabled();
    await shoot(page, 'bundle-7b-conflict-between-chosen');
    const apiBoth = await roles.rv2.context.request.post(PUBLISH_PATH, { data: { baseBundleId: baseId, mappings: [refBody(c1), refBody(c2)], publishConfirmation: NOT_ISSUED } });
    await expectRefused('게시(API) · 함께 고른 매핑끼리 겹침', apiBoth, 409, { error: 'CONFLICT', reason: 'MAPPING_CONFLICT' });

    // 대조: 겹치지 않는 하나만 고르면 같은 화면에서 깨끗한 미리보기(확인값 있음)가 나온다.
    await candidateRow(page, c2).locator('[data-admin-candidate-check]').uncheck();
    const clean = page.waitForResponse((entry) => entry.request().method() === 'POST' && entry.url().endsWith('/api/admin/bundle-publish/preview'));
    await previewButton(page).click();
    expect(((await (await clean).json()) as Json)['publishConfirmation']).toMatch(/^[0-9a-f]{64}$/);
    await expect(page.locator('[data-admin-preview][data-admin-preview-publishable="true"]')).toBeVisible();
    // 겹침 거절은 아무것도 쓰지 않았고, 마지막 깨끗한 미리보기가 확인값 기록 하나를 더했을 뿐이다.
    const afterClean = JSON.parse(await stateText(request)) as Record<string, unknown>;
    const beforeClean = JSON.parse(before) as Record<string, unknown>;
    expect(Object.keys(afterClean).filter((key) => JSON.stringify(afterClean[key]) !== JSON.stringify(beforeClean[key])).sort()).toEqual(['bundleConfirmations']);
    expect((afterClean['bundleConfirmations'] as unknown[]).length - (beforeClean['bundleConfirmations'] as unknown[]).length).toBe(1);
  } finally {
    await closeAll(roles.ha, roles.rv1, roles.rv2);
  }
});

test('R-f 낡은 확인값: 다른 구성의 확인값·다른 관리자의 확인값·임의 확인값은 409 PREVIEW_REQUIRED 이고, 기준 묶음에 이미 있는 매핑은 409 MAPPING_ALREADY_IN_BASE 다', async ({ browser, request }) => {
  await resetWorld(request);
  const roles = await openRoles(browser);
  try {
    const baseId = await newestBaseId(roles.rv1);
    const one = await approvedMapping(roles, TREATMENT_C);
    // 같은 치료 C 의 둘째 매핑이지만 다른 칸(3세대 · 손해보험사)이라 첫째와 겹치지 않는다.
    const secondRequest = await requestReview(roles.ha, TREATMENT_C);
    const second: MappingRef = await draftMapping(roles.rv1, secondRequest, { scope: COVERAGE_SCOPE_OTHER });
    await submitMapping(roles.rv1, second, secondRequest);
    const approvedSecond = await roles.rv2.context.request.post(`/api/admin/mappings/${encodeURIComponent(second.id)}/versions/${encodeURIComponent(second.version)}/approve`, { data: { reviewRequestId: secondRequest } });
    expect(approvedSecond.status()).toBe(200);
    // 깨끗한 미리보기가 서버에 확인값 기록을 남기므로, 거절 전 사본은 미리보기를 받은 뒤에 뜬다.
    const confirmationForOne = await previewConfirmation(roles.rv2, baseId, [one]);
    const before = await stateText(request);
    // 다른 구성(둘을 함께)에 한 개의 확인값.
    const otherSet = await roles.rv2.context.request.post(PUBLISH_PATH, { data: { baseBundleId: baseId, mappings: [refBody(one), refBody(second)], publishConfirmation: confirmationForOne } });
    await expectRefused('게시 · 다른 구성의 확인값', otherSet, 409, { error: 'CONFLICT', reason: 'PREVIEW_REQUIRED' });
    // 다른 관리자의 확인값(rv-2 가 받은 값을 rv-1 이 쓴다).
    const otherAdmin = await roles.rv1.context.request.post(PUBLISH_PATH, { data: { baseBundleId: baseId, mappings: [refBody(one)], publishConfirmation: confirmationForOne } });
    await expectRefused('게시 · 다른 관리자의 확인값', otherAdmin, 409, { error: 'CONFLICT', reason: 'PREVIEW_REQUIRED' });
    // 임의 확인값과 확인값 없음(본문 형식 오류는 400).
    const random = await roles.rv2.context.request.post(PUBLISH_PATH, { data: { baseBundleId: baseId, mappings: [refBody(one)], publishConfirmation: NOT_ISSUED } });
    await expectRefused('게시 · 임의 확인값', random, 409, { error: 'CONFLICT', reason: 'PREVIEW_REQUIRED' });
    const missing = await roles.rv2.context.request.post(PUBLISH_PATH, { data: { baseBundleId: baseId, mappings: [refBody(one)] } });
    await expectRefused('게시 · 확인값 없음', missing, 400, { error: 'INVALID_REQUEST', defects: [{ code: 'VALUE_MISSING', path: 'publishConfirmation' }] });
    await expectUnchanged(request, before, '낡은 확인값');
    // 기준 묶음에 이미 들어 있는 매핑(치료 A 의 기준 매핑)을 고르면 미리보기·게시 모두 409.
    const existing = BASE_MAPPING_OF_A;
    const alreadyPreview = await roles.rv2.context.request.post(PREVIEW_PATH, { data: { baseBundleId: baseId, mappings: [refBody(existing)] } });
    await expectRefused('미리보기 · 기준 묶음에 이미 있는 매핑', alreadyPreview, 409, { error: 'CONFLICT', reason: 'MAPPING_ALREADY_IN_BASE' });
    const alreadyPublish = await roles.rv2.context.request.post(PUBLISH_PATH, { data: { baseBundleId: baseId, mappings: [refBody(existing)], publishConfirmation: NOT_ISSUED } });
    await expectRefused('게시 · 기준 묶음에 이미 있는 매핑', alreadyPublish, 409, { error: 'CONFLICT', reason: 'MAPPING_ALREADY_IN_BASE' });
    await expectUnchanged(request, before, '기준 묶음에 이미 있는 매핑');
    // 거절된 시도는 확인값을 소비하지 않았다: 받은 사람(rv-2)이 같은 구성으로 그대로 게시할 수 있다.
    const stillValid = await roles.rv2.context.request.post(PUBLISH_PATH, { data: { baseBundleId: baseId, mappings: [refBody(one)], publishConfirmation: confirmationForOne } });
    expect(stillValid.status(), await stillValid.text()).toBe(200);
    note('거절된 시도(다른 구성·다른 관리자·임의 값)는 확인값을 소비하지 않았다 → 받은 rv-2 가 같은 구성으로 게시 200', REJECT_LOG_FILE);
  } finally {
    await closeAll(roles.ha, roles.rv1, roles.rv2);
  }
});

test('R-g 낡은 화면(SCOPE_CHANGED): 같은 병원을 연 두 운영자 화면 중 하나가 먼저 지정하면, 나중 화면의 지정은 409 로 거절되고 화면이 한국어 안내와 함께 실제 현재 적용본을 다시 보인다. 범위 이력은 거절로 늘지 않는다', async ({ browser, request }) => {
  await resetWorld(request);
  const roles = await openRoles(browser);
  const poA = await openAs(browser, 'po-1');
  const poB = await openAs(browser, 'po-1');
  try {
    const baseId = await newestBaseId(roles.rv1);
    // 새 묶음 둘: 치료 C 의 다른 칸 매핑 하나씩(기준 묶음 + 각각).
    const c1 = await approvedMapping(roles, TREATMENT_C);
    const c2 = await approvedMapping(roles, TREATMENT_C, { scope: COVERAGE_SCOPE_OTHER });
    const bundle1 = await publishViaApi(roles.rv2, baseId, [c1]);
    const bundle2 = await publishViaApi(roles.rv2, baseId, [c2]);
    expect(new Set([baseId, bundle1, bundle2]).size).toBe(3);

    // 두 화면 모두 병원 1 의 현재 적용본 = 기준 묶음을 읽는다.
    await gotoScope(poA);
    await gotoScope(poB);
    for (const viewer of [poA, poB]) await expect(scopeRow(viewer.page, CLINIC_1)).toHaveAttribute('data-admin-scope-current', baseId);

    // 화면 A 가 먼저 지정한다.
    await poA.page.locator(`select[data-admin-scope-select="${CLINIC_1}"]`).selectOption(bundle1);
    const firstAssign = poA.page.waitForResponse((entry) => entry.request().method() === 'POST' && entry.url().endsWith(scopeClinicPath(CLINIC_1)));
    await poA.page.locator(`button[data-admin-scope-confirm="${CLINIC_1}"]`).click();
    expect((await firstAssign).status()).toBe(200);
    await expect(scopeRow(poA.page, CLINIC_1)).toHaveAttribute('data-admin-scope-current', bundle1);

    // 화면 B(낡은 화면: 아직 기준 묶음이 현재 적용본인 줄)가 다른 묶음을 지정하려 한다.
    await expect(scopeRow(poB.page, CLINIC_1)).toHaveAttribute('data-admin-scope-current', baseId);
    await poB.page.locator(`select[data-admin-scope-select="${CLINIC_1}"]`).selectOption(bundle2);
    const before = await stateText(request);
    const auditBefore = (await auditLog(request)).length;
    const second = poB.page.waitForResponse((entry) => entry.request().method() === 'POST' && entry.url().endsWith(scopeClinicPath(CLINIC_1)));
    await poB.page.locator(`button[data-admin-scope-confirm="${CLINIC_1}"]`).click();
    const refusal = await second;
    await expectRefused('지정(화면 B, 낡은 화면)', refusal, 409, { error: 'CONFLICT', reason: 'SCOPE_CHANGED' });
    expect(refusal.request().postDataJSON()).toEqual({ ruleBundleVersionId: bundle2, expectedCurrentBundleId: baseId });
    const message = scopeRow(poB.page, CLINIC_1).locator('[data-admin-message="error"]');
    await expect(message).toHaveAttribute('data-admin-message-code', 'SCOPE_CHANGED');
    await expect(message).toContainText('현재 적용본이 화면을 불러온 뒤 다른 곳에서 바뀌었습니다');
    await expect(message).toContainText('최신 상태를 다시 불러왔으니');
    await expect(message).not.toContainText('SCOPE_CHANGED');
    // 화면이 서버의 실제 현재 적용본(화면 A 가 지정한 묶음 1)을 다시 보이고, 고르던 값은 비워졌다.
    await expect(scopeRow(poB.page, CLINIC_1)).toHaveAttribute('data-admin-scope-current', bundle1);
    await expect(poB.page.locator(`select[data-admin-scope-select="${CLINIC_1}"]`)).toHaveValue('');
    await expect(poB.page.locator(`button[data-admin-scope-confirm="${CLINIC_1}"]`)).toBeDisabled();
    await shoot(poB.page, 'bundle-8-scope-changed');
    note(`화면의 거절 문장: ${(await message.innerText()).trim()}`, REJECT_LOG_FILE);

    // 거절된 시도는 아무것도 바꾸지 않았다: 저장소 사본·감사 기록·병원 2 의 범위가 그대로다.
    await expectUnchanged(request, before, 'SCOPE_CHANGED');
    expect((await auditLog(request)).length).toBe(auditBefore);
    await expect(scopeRow(poB.page, CLINIC_2)).toHaveAttribute('data-admin-scope-current', baseId);
    // 범위 이력의 지정 기록 수: 병원 1 지정(처음 기준 묶음 + 화면 A 의 지정)과 병원 2 의 기준 묶음 지정. 거절된 화면 B 의 시도는 더하지 않았다.
    const history = JSON.stringify((JSON.parse(await stateText(request)) as Json)['scopeHistory']);
    const assignments = (history.match(/"assignedAt"/g) ?? []).length;
    expect(assignments).toBe(3);
    note(`범위 이력의 지정 기록 ${String(assignments)}건(병원 1: 기준 묶음 + 화면 A 의 지정, 병원 2: 기준 묶음) — 거절된 화면 B 의 시도는 더하지 않았다(거절 전 사본과 글자 그대로 같다)`, REJECT_LOG_FILE);
  } finally {
    await closeAll(roles.ha, roles.rv1, roles.rv2, poA, poB);
  }
});

test('R-h 없는 병원·묶음·매핑: 지정은 404 NOT_FOUND(병원 없음 · 묶음 없음), 낡은 현재 범위는 409 SCOPE_CHANGED, 미리보기·게시는 404(기준 묶음 없음 · 매핑 없음)이고 저장 상태가 그대로다', async ({ browser, request }) => {
  await resetWorld(request);
  const roles = await openRoles(browser);
  const po = await openAs(browser, 'po-1');
  try {
    const baseId = await newestBaseId(roles.rv1);
    const mapping = await approvedMapping(roles, TREATMENT_C);
    const newBundle = await publishViaApi(roles.rv2, baseId, [mapping]);
    const before = await stateText(request);
    const post = (session: { context: { request: APIRequestContext } }, path: string, data: unknown): Promise<APIResponse> => session.context.request.post(path, { data });

    await expectRefused('지정 · 없는 병원', await post(po, scopeClinicPath('TEST_FIXTURE_NO_SUCH_CLINIC'), { ruleBundleVersionId: newBundle, expectedCurrentBundleId: null }), 404, { error: 'NOT_FOUND' });
    await expectRefused('지정 · 없는 묶음', await post(po, scopeClinicPath(CLINIC_1), { ruleBundleVersionId: 'TEST_FIXTURE_NO_SUCH_BUNDLE', expectedCurrentBundleId: baseId }), 404, { error: 'NOT_FOUND' });
    await expectRefused('지정 · 병원 2 에 없는 묶음 · 현재 범위를 null 로 봄', await post(po, scopeClinicPath(CLINIC_2), { ruleBundleVersionId: newBundle, expectedCurrentBundleId: null }), 409, { error: 'CONFLICT', reason: 'SCOPE_CHANGED' });
    await expectRefused('지정 · 병원 1 의 현재 범위를 잘못 봄', await post(po, scopeClinicPath(CLINIC_1), { ruleBundleVersionId: newBundle, expectedCurrentBundleId: newBundle }), 409, { error: 'CONFLICT', reason: 'SCOPE_CHANGED' });
    await expectRefused('미리보기 · 없는 기준 묶음', await post(roles.rv2, PREVIEW_PATH, { baseBundleId: 'TEST_FIXTURE_NO_SUCH_BUNDLE', mappings: [refBody(mapping)] }), 404, { error: 'NOT_FOUND' });
    await expectRefused('미리보기 · 없는 매핑', await post(roles.rv2, PREVIEW_PATH, { baseBundleId: baseId, mappings: [{ id: 'TEST_FIXTURE_NO_SUCH_MAPPING', version: '1' }] }), 404, { error: 'NOT_FOUND' });
    await expectRefused('게시 · 없는 기준 묶음', await post(roles.rv2, PUBLISH_PATH, { baseBundleId: 'TEST_FIXTURE_NO_SUCH_BUNDLE', mappings: [refBody(mapping)], publishConfirmation: NOT_ISSUED }), 404, { error: 'NOT_FOUND' });
    await expectRefused('게시 · 없는 매핑', await post(roles.rv2, PUBLISH_PATH, { baseBundleId: baseId, mappings: [{ id: 'TEST_FIXTURE_NO_SUCH_MAPPING', version: '1' }], publishConfirmation: NOT_ISSUED }), 404, { error: 'NOT_FOUND' });
    // 본문에 역할·병원 같은 값을 실어 보내도 읽지 않고 400 이다.
    await expectRefused('지정 · 본문에 병원 id', await post(po, scopeClinicPath(CLINIC_2), { ruleBundleVersionId: newBundle, expectedCurrentBundleId: baseId, clinicId: CLINIC_1 }), 400, {
      error: 'INVALID_REQUEST',
      defects: [{ code: 'UNKNOWN_FIELD', path: 'request.clinicId' }],
    });
    await expectUnchanged(request, before, '없는 병원·묶음·매핑');
    // 화면 쪽: 두 병원 줄이 모두 기준 묶음을 가리키고 있다(거절된 시도가 아무것도 바꾸지 않았다).
    await gotoScope(po);
    await expect(scopeRow(po.page, CLINIC_1)).toHaveAttribute('data-admin-scope-current', baseId);
    await expect(scopeRow(po.page, CLINIC_2)).toHaveAttribute('data-admin-scope-current', baseId);
  } finally {
    await closeAll(roles.ha, roles.rv1, roles.rv2, po);
  }
});
