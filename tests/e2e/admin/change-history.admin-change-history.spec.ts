import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from '../helpers/test';

// 병원 관리자 변경 이력 조회 흐름 (SPEC-REIMBURSEMENT-001 M7 변경 이력): 병원 관리자(HA)가 실제 화면으로 공통 기본비용을 게시하고 무조작 시간을 저장한 뒤, 변경 이력 화면에서 그 기록을 읽는다.
// 앞단(tests/e2e/harness/server.ts, 이 파일 전용 인스턴스 ADMIN_CHANGE_HISTORY_PORT, --test-hooks)이 실제 관리자 핸들러·공개 핸들러를 시험 인증기와 시험 자료(TEST_FIXTURE)로 돌린다.
// 통신 가로채기는 마지막의 "불러오기 실패" 시험 하나에서만 쓴다(서버가 실패하는 상황을 화면이 어떻게 다루는지 보려는 것이며 서버 동작의 증거가 아니다). 나머지는 모든 요청이 실제 HTTP 로 앞단을 지난다.
// 저장소 전체 사본(/__harness/state)과 감사 기록(/__harness/audit)은 시험 전용 끝점이 주는 값을 글자 그대로 전후 비교한다.
// 한 파일 안에서 순서대로 돈다: 앞 시험의 기록을 뒤 시험이 이어받는다.
//   병원 1 HA 의 기록: 초안 저장 → 게시 → 무조작 시간 저장 (3건). 병원 2 HA 는 자기 무조작 시간을 따로 저장한다 (1건).
// 사진은 .moai/state/shots/m7-admin-change-history/ 에 남는다(육안 검토용 자료이며 시험 결과가 아니다).

test.describe.configure({ mode: 'serial' });

const CLINIC_1 = 'TEST_FIXTURE_CLINIC_1';
const CLINIC_2 = 'TEST_FIXTURE_CLINIC_2';
const SLUG_1 = 'test-fixture-clinic-1';
const HA_1 = 'TEST_FIXTURE_HA_CLINIC_1';
const HA_2 = 'TEST_FIXTURE_HA_CLINIC_2';
const FEE_ID = 'TEST_FIXTURE_BASE_FEE_A';
const T1 = 'TEST_FIXTURE_TREATMENT_1';
const AUDIT_API = '/api/admin/audit-log';
const CONDITION = { generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN' };
const historyUrl = (clinic: string): string => `/admin/${clinic}/change-history`;

const SHOTS = path.resolve('.moai/state/shots/m7-admin-change-history');
let shotCount = 0;
const shoot = async (page: Page, name: string): Promise<void> => {
  mkdirSync(SHOTS, { recursive: true });
  shotCount += 1;
  await page.screenshot({ path: path.join(SHOTS, `${String(shotCount).padStart(2, '0')}-${name}.png`), animations: 'disabled', fullPage: true });
};

interface Json {
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const rowsOf = (page: Page) => page.locator('[data-admin-changes-row]');
const rowAt = (page: Page, sequence: number) => page.locator(`[data-admin-changes-row="${sequence}"]`);

async function login(page: Page, account: string): Promise<void> {
  await page.goto('/__harness/login');
  await page.locator(`[data-test-account="${account}"]`).click();
  await expect(page).toHaveURL(/\/admin\/(?:[^/]+\/treatments|review-queue|rule-scope)$/);
}

const storeState = async (request: APIRequestContext): Promise<Json> => (await (await request.get('/__harness/state')).json()) as Json;
const auditEntries = async (request: APIRequestContext): Promise<Json[]> => ((await (await request.get('/__harness/audit')).json()) as { entries: Json[] }).entries;
const publicCatalogText = async (request: APIRequestContext): Promise<string> => (await request.get(`/api/clinics/${SLUG_1}/catalog`)).text();

async function publicEstimateText(request: APIRequestContext): Promise<string> {
  const catalog = JSON.parse(await publicCatalogText(request)) as Json;
  const options = (await (await request.get(`/api/clinics/${SLUG_1}/insurance/options`)).json()) as Json;
  const response = await request.post(`/api/clinics/${SLUG_1}/estimate`, {
    data: { catalogVersion: catalog['catalogVersion'], ruleBundleVersion: options['ruleBundleVersion'], ...CONDITION, treatmentIds: [T1] },
  });
  return response.text();
}

const currentCatalogVersion = async (request: APIRequestContext): Promise<string> =>
  ((await (await request.get(`/api/admin/clinics/${CLINIC_1}/catalog/versions`)).json()) as { versions: Array<{ id: string }> }).versions[0]!.id;

test('세계를 새로 만든다: 로그인 전 API 는 401 이고 화면은 안내만 보이며 이력이 없다', async ({ request, page }) => {
  expect((await request.post('/__harness/reset')).status()).toBe(200);
  const anonymous = await request.get(AUDIT_API);
  expect(anonymous.status()).toBe(401);
  expect(await anonymous.json()).toEqual({ error: 'UNAUTHENTICATED' });
  await page.goto(historyUrl(CLINIC_1));
  await expect(page.locator('main[data-admin-state="unauthenticated"]')).toBeVisible();
  await expect(page.locator('[data-admin-changes-list]')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(CLINIC_1);
});

test('이번 조회 범위 밖 역할(검토 담당자 · 플랫폼 운영자)은 API 가 403 이고 화면은 권한 안내만 보인다. 조작한 값으로도 열리지 않는다', async ({ page }) => {
  for (const account of ['rv-1', 'po-1']) {
    await login(page, account);
    const forged = await page.request.get(`${AUDIT_API}?clinicId=${CLINIC_1}&role=HA`, { headers: { 'x-clinic-id': CLINIC_1, 'x-role': 'HA' } });
    expect(forged.status(), account).toBe(403);
    expect(await forged.json()).toEqual({ error: 'FORBIDDEN' });
    await page.goto(historyUrl(CLINIC_1));
    await expect(page.locator('main[data-admin-state="forbidden"]')).toBeVisible();
    await expect(page.locator('[data-admin-changes-list]')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('TEST_FIXTURE');
  }
  await page.request.post('/__harness/logout', { maxRedirects: 0 }).catch(() => undefined);
});

test('병원 1 HA: 관리자 입구와 이동 줄에 변경 이력 링크가 있고, 아직 기록이 없으면 빈 목록 안내를 보인다. 읽기 전용이라 단추가 없다', async ({ page }) => {
  await login(page, 'ha-clinic-1');
  await page.goto('/admin');
  await expect(page.locator(`a[href="/admin/${CLINIC_1}/change-history"]`)).toBeVisible();
  await page.goto(`/admin/${CLINIC_1}/treatments`);
  await expect(page.locator('[data-admin-state="ready"]')).toBeVisible();
  await page.locator('[data-admin-nav-link="change-history"]').click();
  await expect(page).toHaveURL(new RegExp(`/admin/${CLINIC_1}/change-history$`));
  await expect(page.locator('main[data-admin-state="ready"][data-admin-page="change-history"]')).toBeVisible();
  await expect(page.locator('[data-admin-nav-link="change-history"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('[data-admin-changes-empty]')).toContainText('아직 없습니다');
  await expect(page.locator('[data-admin-changes-list]')).toHaveCount(0);
  await expect(page.locator('[data-admin-changes-scope]')).toContainText('모든 변경 이력이 아닙니다');
  await expect(page.locator('[data-admin-changes-scope]')).toContainText('카탈로그 초안 저장 · 카탈로그 초안 폐기 · 카탈로그 초안 게시 · 무조작 시간 저장');
  await expect(page.locator('[data-admin-changes-readonly]')).toContainText('읽기 전용');
  await expect(page.locator('main button')).toHaveCount(0); // 수정·삭제·복구는 물론 어떤 단추도 없다
  await shoot(page, 'empty');
});

test('실제 흐름: 기본비용 7,000원 초안 저장 → 미리보기 → 게시 → 무조작 시간 저장 뒤 변경 이력에 세 건이 최신순으로 나타난다', async ({ page, request }) => {
  await login(page, 'ha-clinic-1'); // 시험마다 새 브라우저 문맥이라 로그인도 시험마다 한다
  await page.goto(`/admin/${CLINIC_1}/treatments`);
  await expect(page.locator('[data-admin-state="ready"]')).toBeVisible();
  await page.locator(`[data-admin-basefee="${FEE_ID}"] input`).fill('7000');
  await button(page, '초안 저장').click();
  await expect(page.locator('[data-admin-message="ok"]')).toContainText('키오스크 가격은 아직 바뀌지 않았습니다');
  // 게시 전에 초안 revision 과 게시 확인값을 붙잡아 둔다: 이 값들이 이력 응답·화면에 없어야 한다.
  const drafts = (await storeState(request))['catalogDrafts'] as Array<[string, Json]>;
  const revision = drafts.find(([clinicId]) => clinicId === CLINIC_1)![1]['revision'] as string;
  expect(revision.length).toBeGreaterThan(5);
  await page.locator(`[data-admin-pick="${T1}"] input`).check();
  const previewed = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/catalog/preview'));
  await button(page, '미리보기 계산').click();
  const confirmation = ((await (await previewed).json()) as Json)['publishConfirmation'] as string;
  expect(confirmation).toMatch(/^[0-9a-f]{64}$/);
  const previousVersion = await currentCatalogVersion(page.request);
  await button(page, '게시').click();
  await expect(page.locator('[data-admin-message="ok"]')).toContainText('게시했습니다');
  const publishedVersion = await currentCatalogVersion(page.request);
  expect(publishedVersion).not.toBe(previousVersion);

  // 무조작 시간 저장(화면): 이용 완료 자동 복귀를 5초로.
  await page.goto(`/admin/${CLINIC_1}/idle-policy`);
  await expect(page.locator('[data-admin-state="ready"]')).toBeVisible();
  await page.locator('[data-idle-hold-enabled]').check();
  await page.locator('[data-idle-hold-seconds]').fill('5');
  await page.locator('[data-idle-save]').click();
  await expect(page.locator('[data-admin-message-code="SAVED"]')).toBeVisible();

  // 이동 줄에서 변경 이력으로.
  await page.locator('[data-admin-nav-link="change-history"]').click();
  await expect(page).toHaveURL(new RegExp(`/admin/${CLINIC_1}/change-history$`));
  await expect(page.locator('main[data-admin-state="ready"]')).toBeVisible();
  await expect(page.locator('[data-admin-clinic]')).not.toBeEmpty();
  await expect(page.locator('[data-admin-changes-list]')).toHaveAttribute('data-admin-changes-total', '3');
  expect(await rowsOf(page).evaluateAll((rows) => rows.map((row) => row.getAttribute('data-admin-changes-action')))).toEqual(['IDLE_POLICY_SAVE', 'CATALOG_DRAFT_PUBLISH', 'CATALOG_DRAFT_SAVE']);
  expect(await rowsOf(page).evaluateAll((rows) => rows.map((row) => row.getAttribute('data-admin-changes-row')))).toEqual(['3', '2', '1']);
  await shoot(page, 'three-records');

  // 시각이 같아도(시험 시계는 멈춰 있다) 번호로 순서가 갈린다. 시각은 한국 표준시 분 단위로 보인다.
  await expect(rowAt(page, 3).locator('td').nth(1)).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);

  // 초안 게시: 이전/이후는 카탈로그 버전 id, 대상은 새 카탈로그, 사유는 게시한 초안의 내용 지문을 가리킨다.
  const published = rowAt(page, 2);
  await expect(published).toContainText('카탈로그 초안 게시');
  await expect(published.locator('[data-admin-changes-before="catalog"]')).toHaveText(previousVersion);
  await expect(published.locator('[data-admin-changes-after="catalog"]')).toHaveText(publishedVersion);
  await expect(published.locator('[data-admin-changes-target]')).toHaveText(`CATALOG/${publishedVersion}`);
  await expect(published.locator('[data-admin-changes-reason]')).toContainText(/^DRAFT_OF:[0-9a-f]{64}$/);
  await expect(published.locator('[data-admin-changes-actor]')).toHaveText(HA_1);
  await expect(published.locator('[data-admin-changes-role="HA"]')).toHaveText('병원 관리자');

  // 초안 저장: 이전은 없음, 이후는 내용 지문(앞 12자), 사유는 기록되지 않았다.
  const saved = rowAt(page, 1);
  await expect(saved).toContainText('카탈로그 초안 저장');
  await expect(saved.locator('[data-admin-changes-before="none"]')).toHaveText('없음');
  await expect(saved.locator('[data-admin-changes-after="digest"]')).toHaveText(/^[0-9a-f]{12}…$/);
  await expect(saved.locator('[data-admin-changes-reason="none"]')).toHaveText('기록된 사유 없음');
  await expect(saved.locator('[data-admin-changes-target]')).toHaveText(`CATALOG_DRAFT/${CLINIC_1}`);

  // 무조작 시간 저장.
  const idle = rowAt(page, 3);
  await expect(idle).toContainText('무조작 시간 저장');
  await expect(idle.locator('[data-admin-changes-target]')).toHaveText(`CLINIC/${CLINIC_1}/IDLE_POLICY`);
  await expect(idle.locator('[data-admin-changes-after="digest"]')).toHaveText(/^[0-9a-f]{12}…$/);

  // 초안을 게시하면 서비스가 같은 카탈로그에 감사 기록을 두 건 남기지만(안쪽 CATALOG_PUBLISH) 화면에는 게시가 한 줄이다.
  const actions = (await auditEntries(request)).map((entry) => entry['action']);
  expect(actions).toContain('CATALOG_PUBLISH');
  expect(actions.filter((action) => action === 'CATALOG_DRAFT_PUBLISH')).toHaveLength(1);
  await expect(page.locator('[data-admin-changes-action="CATALOG_PUBLISH"]')).toHaveCount(0);

  // 화면에 상세 내용(금액)을 짐작해 채우지 않는다: 기록에 없는 값이다.
  await expect(page.locator('[data-admin-changes-no-detail]')).toContainText('짐작해 채우지 않습니다');
  await expect(page.locator('main button')).toHaveCount(0);

  // 서버 응답과 같은 기록이다. revision·확인값은 응답에도 화면에도 없다.
  const api = (await (await page.request.get(AUDIT_API)).json()) as Json;
  expect(api['entries'].map((entry: Json) => entry['sequence'])).toEqual([3, 2, 1]);
  const text = JSON.stringify(api);
  const dom = await page.locator('main').innerText();
  for (const secret of [revision, confirmation]) {
    expect(text).not.toContain(secret);
    expect(dom).not.toContain(secret);
  }
});

test('읽기 전용: 화면을 여러 번 열고 API 를 조작한 값으로 불러도 저장소 전체·감사 기록·공개 카탈로그·계산 결과가 그대로이고 응답이 같다', async ({ page, request }) => {
  await login(page, 'ha-clinic-1');
  const baseline = await (await page.request.get(AUDIT_API)).text();
  const before = { state: await storeState(request), audit: await auditEntries(request), catalog: await publicCatalogText(request), estimate: await publicEstimateText(request) };

  await page.goto(historyUrl(CLINIC_1));
  await expect(page.locator('main[data-admin-state="ready"]')).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-admin-changes-list]')).toBeVisible();
  const forgedAttempts = [
    { url: `${AUDIT_API}?clinicId=${CLINIC_2}`, headers: {} },
    { url: `${AUDIT_API}?clinic=${CLINIC_2}&limit=1&before=2&role=PO&actor=${HA_2}`, headers: {} },
    { url: AUDIT_API, headers: { 'x-clinic-id': CLINIC_2, 'x-role': 'PO', 'x-user-id': HA_2, authorization: 'Bearer forged' } },
  ];
  for (const attempt of forgedAttempts) {
    const response = await page.request.get(attempt.url, { headers: attempt.headers });
    expect(response.status(), attempt.url).toBe(200);
    expect(await response.text(), attempt.url).toBe(baseline);
  }
  // 쓰기 메서드는 거절되고 저장소는 그대로다.
  for (const method of ['POST', 'PUT', 'DELETE'] as const) {
    const response = await page.request.fetch(AUDIT_API, { method, data: method === 'DELETE' ? undefined : { action: 'X' } });
    expect(response.status(), method).toBe(405);
  }

  expect(await storeState(request)).toEqual(before.state);
  expect(await auditEntries(request)).toEqual(before.audit);
  expect(await publicCatalogText(request)).toBe(before.catalog);
  expect(await publicEstimateText(request)).toBe(before.estimate);
});

test('병원 2 HA: 병원 1 에 기록이 있어도 자기 병원은 빈 목록이고, 자기 기록만 보이며, 병원 1 의 주소로는 이력을 볼 수 없다', async ({ browser, page }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const second = await context.newPage();
  await login(second, 'ha-clinic-2');

  await second.goto(historyUrl(CLINIC_2));
  await expect(second.locator('main[data-admin-state="ready"]')).toBeVisible();
  await expect(second.locator('[data-admin-changes-empty]')).toBeVisible();
  const emptyApi = (await (await second.request.get(AUDIT_API)).json()) as Json;
  expect(emptyApi['entries']).toEqual([]);
  expect(emptyApi['page']).toEqual({ limit: 100, returned: 0, total: 0, truncated: false });
  expect(emptyApi['clinic']['id']).toBe(CLINIC_2);

  // 병원 2 가 자기 무조작 시간을 저장한다.
  const digest = ((await (await second.request.get(`/api/admin/clinics/${CLINIC_2}/idle-policy`)).json()) as Json)['policyDigest'] as string;
  const saved = await second.request.put(`/api/admin/clinics/${CLINIC_2}/idle-policy`, { data: { screens: {}, completionHoldSeconds: 30, expectedDigest: digest } });
  expect(saved.status()).toBe(200);
  await second.reload();
  await expect(rowsOf(second)).toHaveCount(1);
  await expect(rowAt(second, 1)).toContainText('무조작 시간 저장');
  await expect(rowAt(second, 1).locator('[data-admin-changes-actor]')).toHaveText(HA_2);
  await expect(second.locator('[data-admin-changes-list]')).toHaveAttribute('data-admin-changes-total', '1');
  await expect(second.locator('main')).not.toContainText(HA_1);
  await expect(second.locator('main')).not.toContainText(`CLINIC/${CLINIC_1}`);

  // 병원 1 의 주소: 서버가 정한 병원(병원 2)이 주소의 병원과 달라 이력을 보이지 않는다.
  await second.goto(historyUrl(CLINIC_1));
  await expect(second.locator('main[data-admin-state="mismatch"]')).toBeVisible();
  await expect(second.locator('[data-admin-changes-list]')).toHaveCount(0);
  await expect(second.locator('main')).not.toContainText(HA_1);
  await shoot(second, 'other-clinic-address');
  await context.close();

  // 병원 1 의 이력은 병원 2 의 저장으로 달라지지 않았다.
  await login(page, 'ha-clinic-1');
  await page.goto(historyUrl(CLINIC_1));
  await expect(rowsOf(page)).toHaveCount(3);
  await expect(page.locator('[data-admin-changes-list]')).toHaveAttribute('data-admin-changes-total', '3');
});

test('불러오기 실패(화면의 처리 확인: 응답을 가로챈다): 서버 오류·읽을 수 없는 본문은 불러오지 못했다는 안내와 다시 불러오기만 보이고, 다시 불러오면 이력이 나온다', async ({ page }) => {
  await login(page, 'ha-clinic-1');
  await page.route('**/api/admin/audit-log', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'INTERNAL_ERROR' }) }));
  await page.goto(historyUrl(CLINIC_1));
  await expect(page.locator('main[data-admin-state="error"]')).toBeVisible();
  await expect(page.locator('main[data-admin-state="error"] [role="alert"]')).toContainText('불러오지 못했습니다');
  await expect(page.locator('[data-admin-changes-list]')).toHaveCount(0);
  await expect(page.locator('main button')).toHaveCount(1);
  await shoot(page, 'load-failed');

  await page.unroute('**/api/admin/audit-log');
  await page.route('**/api/admin/audit-log', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: 'broken' }) }));
  const refetched = page.waitForResponse((response) => response.url().endsWith('/api/admin/audit-log'));
  await button(page, '다시 불러오기').click();
  expect((await refetched).status()).toBe(200); // 다시 요청이 실제로 나갔다
  await expect(page.locator('main[data-admin-state="error"]')).toBeVisible(); // 200 이어도 읽을 수 없는 본문이면 실패다
  await expect(page.locator('[data-admin-changes-list]')).toHaveCount(0);

  await page.unroute('**/api/admin/audit-log');
  await button(page, '다시 불러오기').click();
  await expect(page.locator('main[data-admin-state="ready"]')).toBeVisible();
  await expect(rowsOf(page)).toHaveCount(3);
});

test('건수 상한: 기록이 100건을 넘으면 가장 최근 100건만 보이고 전체 건수와 함께 안내한다. 다른 병원의 기록은 건수에 들어가지 않는다', async ({ page, browser }) => {
  await login(page, 'ha-clinic-1');
  // 병원 1 에 초안 저장 기록을 105건 더한다(저장마다 감사 기록 한 건; 금액은 게시본과 달라야 변경으로 인정된다).
  for (let index = 0; index < 105; index += 1) {
    const saved = await page.request.put(`/api/admin/clinics/${CLINIC_1}/catalog/draft`, { data: { baseFeeEdits: [{ baseFeeId: FEE_ID, amount: 8000 + (index % 2) * 1000 }] } });
    expect(saved.status()).toBe(200);
  }
  await page.goto(historyUrl(CLINIC_1));
  await expect(page.locator('main[data-admin-state="ready"]')).toBeVisible();
  await expect(rowsOf(page)).toHaveCount(100);
  await expect(page.locator('[data-admin-changes-truncated]')).toHaveText('가장 최근 100건만 보여 줍니다 (전체 108건). 더 오래된 기록은 이 화면에서 볼 수 없습니다.');
  await expect(page.locator('[data-admin-changes-list]')).toHaveAttribute('data-admin-changes-total', '108');
  const sequences = await rowsOf(page).evaluateAll((rows) => rows.map((row) => Number(row.getAttribute('data-admin-changes-row'))));
  expect(sequences[0]).toBe(108);
  expect(sequences[99]).toBe(9);
  expect(sequences).toEqual(Array.from({ length: 100 }, (_, index) => 108 - index));
  const api = (await (await page.request.get(AUDIT_API)).json()) as Json;
  expect(api['page']).toEqual({ limit: 100, returned: 100, total: 108, truncated: true });
  await shoot(page, 'truncated');

  // 병원 2 는 영향이 없다.
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const second = await context.newPage();
  await login(second, 'ha-clinic-2');
  const other = (await (await second.request.get(AUDIT_API)).json()) as Json;
  expect(other['page']).toEqual({ limit: 100, returned: 1, total: 1, truncated: false });
  await context.close();
});
