import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { APIRequestContext, APIResponse, Browser, BrowserContext, Page } from '@playwright/test';
import { expect, test } from '../helpers/test';

// 관리자 보장 검토 요청 흐름 (SPEC-REIMBURSEMENT-001 M7): 병원 관리자(HA)가 게시된 치료에 검토를 요청하고, 검토 담당자(RV, 플랫폼 단위 소속)가 읽기 전용 대기열에서 확인한다.
// 앞단(tests/e2e/harness/server.ts, 이 파일 전용 인스턴스 ADMIN_REVIEW_PORT)이 실제 관리자 핸들러·공개 핸들러를 시험 인증기와 시험 자료(TEST_FIXTURE)로 돌린다. 통신 가로채기는 쓰지 않는다: 모든 요청이 실제 HTTP 로 앞단을 지난다.
// 증명하려는 것: 요청은 제안 기록일 뿐이다 — 요청이 쌓이는 동안 공개 카탈로그·보험 선택지·같은 조건의 계산 결과·관리자 치료 목록은 전후로 완전히 같고, 새로 생기는 자료는 검토 요청뿐이다.
//   증명하지 못하는 것: 운영 인증(운영 구성은 별도 층 unavailable.production.spec.ts), 매핑·규칙 묶음 처리(이 단계에 없다), 실제 병원 자료.
// 한 파일 안에서 순서대로 돈다: 앞 시험이 만든 요청을 뒤 시험이 이어받는다. 시작 상태는 "치료 A 에 요청이 없다"이다.
//   BEFORE 기록 → 병원 1 관리자가 치료 A 에 요청(화면) → 거절 사례(API) → 검토 담당자가 대기열 확인(화면) → 접근 거절(화면) → AFTER 기록 = BEFORE(열린 요청은 치료 A 하나) → 치료 B 충돌 화면 → 마지막에 치료 B 를 숨겨 숨긴 치료 거절을 본다.
//   BEFORE/AFTER 비교는 앞 시험들만 덮는다: 뒤의 두 시험은 치료 B 에 요청을 더하거나 카탈로그를 바꾸기 때문이다.
// 사진은 .moai/state/shots/m7-review-request/ 에 남는다(육안 검토용 자료이며 시험 결과가 아니다).

test.describe.configure({ mode: 'serial' });

const CLINIC_1 = 'TEST_FIXTURE_CLINIC_1';
const CLINIC_2 = 'TEST_FIXTURE_CLINIC_2';
const SLUG = 'test-fixture-clinic-1';
const API_1 = `/api/admin/clinics/${CLINIC_1}`;
const API_2 = `/api/admin/clinics/${CLINIC_2}`;
const QUEUE = '/api/admin/review-queue';
const T1 = 'TEST_FIXTURE_TREATMENT_1';
const T2 = 'TEST_FIXTURE_TREATMENT_2';
const NAME_A = 'TEST_FIXTURE 시험 치료 A (급여)';
const NAME_B = 'TEST_FIXTURE 시험 치료 B (비급여)';
const CLINIC_NAME = 'TEST_FIXTURE 시험 의원';
const HA_1_USER = 'TEST_FIXTURE_HA_CLINIC_1';
const CONDITION = { generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN' };
const PROPOSED = { benefitType: 'NON_BENEFIT', procedureCodes: ['TEST_FIXTURE_PROPOSED_PROC_A', 'TEST_FIXTURE_PROPOSED_PROC_B'], calcClass: 'MAJOR_THREE_NON_BENEFIT' };

const SHOTS = path.resolve('.moai/state/shots/m7-review-request');
let shotCount = 0;
const shoot = async (page: Page, name: string): Promise<void> => {
  mkdirSync(SHOTS, { recursive: true });
  shotCount += 1;
  await page.screenshot({ path: path.join(SHOTS, `${String(shotCount).padStart(2, '0')}-${name}.png`), animations: 'disabled', fullPage: true });
};

interface Json {
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** 요청이 바꾸지 않아야 하는 것들의 기록: 공개 카탈로그, 보험 선택지, 같은 조건의 계산 결과, 관리자 치료 목록. */
interface Snapshot {
  catalog: Json;
  options: Json;
  estimateStatus: number;
  estimate: Json;
  adminTreatments: Json;
}

async function login(page: Page, account: string): Promise<void> {
  await page.goto('/__harness/login');
  await page.locator(`[data-test-account="${account}"]`).click();
  // 플랫폼 단위 검토 담당자(rv-1)는 검토 대기열로, 나머지는 소속 병원의 가격 관리로 들어간다.
  await expect(page).toHaveURL(/\/admin\/(?:[^/]+\/treatments|review-queue)$/);
}

interface Session {
  context: BrowserContext;
  page: Page;
}

async function openAs(browser: Browser, account: string | null): Promise<Session> {
  const context = await browser.newContext();
  const page = await context.newPage();
  if (account !== null) await login(page, account);
  return { context, page };
}

const json = async (response: APIResponse): Promise<Json> => (await response.json()) as Json;

/** 병원 관리자(HA 1)의 쿠키를 가진 요청 문맥으로 BEFORE/AFTER 기록을 만든다. */
async function capture(request: APIRequestContext): Promise<Snapshot> {
  const catalog = await json(await request.get(`/api/clinics/${SLUG}/catalog`));
  const options = await json(await request.get(`/api/clinics/${SLUG}/insurance/options`));
  const estimateResponse = await request.post(`/api/clinics/${SLUG}/estimate`, {
    data: { catalogVersion: catalog['catalogVersion'], ruleBundleVersion: options['ruleBundleVersion'], ...CONDITION, treatmentIds: [T1, T2] },
  });
  const adminResponse = await request.get(`${API_1}/treatments`);
  expect(adminResponse.status()).toBe(200);
  return { catalog, options, estimateStatus: estimateResponse.status(), estimate: await json(estimateResponse), adminTreatments: await json(adminResponse) };
}

const submitUrl = (apiBase: string, treatmentId: string): string => `${apiBase}/treatments/${encodeURIComponent(treatmentId)}/review-requests`;

/** 저장 상태 관찰: 검토 담당자가 보는 대기열 + 두 병원 관리자가 각자 보는 요청 목록. 거절된 시도 뒤에 이 관찰이 그대로여야 한다. */
async function observe(rv: Session, ha1: Session, ha2: Session): Promise<Json> {
  return {
    queue: await json(await rv.context.request.get(QUEUE)),
    clinic1: await json(await ha1.context.request.get(`${API_1}/review-requests`)),
    clinic2: await json(await ha2.context.request.get(`${API_2}/review-requests`)),
  };
}

let before: Snapshot;
let requestId = '';

test('BEFORE: 공개 카탈로그·보험 선택지·계산 결과·관리자 치료 목록을 기록하고, 요청이 하나도 없음을 확인한다', async ({ page, browser }) => {
  rmSync(SHOTS, { recursive: true, force: true });
  await login(page, 'ha-clinic-1');
  before = await capture(page.request);
  expect((before.catalog['treatments'] as Json[]).map((entry) => entry['displayName'])).toEqual([NAME_A, NAME_B]);
  expect(before.estimateStatus).toBe(200);
  expect(await json(await page.request.get(`${API_1}/review-requests`))).toEqual({ reviewRequests: [] });
  const rv = await openAs(browser, 'rv-1');
  expect(await json(await rv.context.request.get(QUEUE))).toEqual({ queue: [] });
  await rv.context.close();
});

test('병원 1 관리자: 입구와 이동 줄로 검토 요청 화면에 들어가 치료 A 에 검토를 요청한다 (보험 계산 분류를 고르지 않으면 보내지 않는다)', async ({ page }) => {
  await login(page, 'ha-clinic-1');
  // 입구 화면은 치료 관리(가격)와 검토 요청 두 링크를 보인다(대기열 링크는 검토 담당자 전용이라 없다).
  await page.goto('/admin');
  await expect(page.locator('[data-admin-state="ready"]')).toBeVisible();
  await expect(page.getByRole('link', { name: `검토 요청 — ${CLINIC_1}` })).toBeVisible();
  await expect(page.getByRole('link', { name: `치료 관리 — ${CLINIC_1}` })).toBeVisible();
  await expect(page.getByRole('link', { name: '검토 대기열' })).toHaveCount(0);

  // 치료 관리(가격) 화면의 이동 줄에서 검토 요청 화면으로 간다.
  await page.goto(`/admin/${CLINIC_1}/treatments`);
  await expect(page.locator('[data-admin-state="ready"]')).toBeVisible();
  await page.locator('[data-admin-nav]').getByRole('link', { name: '검토 요청' }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${CLINIC_1}/review-requests$`));
  await expect(page.locator('[data-admin-page="review-requests"]')).toBeVisible();
  await expect(page.locator('[data-admin-clinic]')).toHaveText(CLINIC_NAME);
  await expect(page.locator('[data-admin-review-note]')).toContainText('제안일 뿐입니다');

  // 게시된 치료만 후보로 보이고 요청이 없다.
  const rows = page.locator('[data-admin-review-row]');
  await expect(rows).toHaveCount(2);
  await expect(page.locator(`[data-admin-review-row="${T1}"]`)).toContainText(NAME_A);
  await expect(page.locator(`[data-admin-review-row="${T2}"]`)).toContainText(NAME_B);
  for (const treatmentId of [T1, T2]) {
    await expect(page.locator(`[data-admin-review-row="${treatmentId}"] [data-admin-review-status]`)).toHaveText('요청 없음');
    await expect(page.locator(`[data-admin-review-row="${treatmentId}"] [data-admin-review-status]`)).toHaveAttribute('data-admin-review-status', 'NONE');
  }
  await expect(page.locator('[data-admin-review-sent-empty]')).toBeVisible();
  await shoot(page, 'ha-list-before');

  // 쓰기 요청이 나갔는지 센다: 분류를 고르지 않은 제출은 서버로 가지 않는다.
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') writes.push(`${request.method()} ${request.url()}`);
  });
  await page.getByRole('button', { name: `${NAME_A} 검토 요청`, exact: true }).click();
  const form = page.locator(`[data-admin-review-form="${T1}"]`);
  await expect(form).toBeVisible();
  // 급여 구분과 행위 코드는 치료의 지금 값으로 채워져 있고, 보험 계산 분류는 고르지 않은 상태다.
  await expect(form.getByRole('combobox', { name: '급여 구분' })).toHaveValue('BENEFIT');
  await expect(form.getByRole('combobox', { name: '보험 계산 분류' })).toHaveValue('');
  await form.getByRole('button', { name: '검토 요청 보내기' }).click();
  await expect(form.getByRole('alert')).toContainText('보험 계산 분류를 골라 주세요');
  expect(writes).toEqual([]);

  // 제안 값을 채운다.
  await form.getByRole('combobox', { name: '급여 구분' }).selectOption(PROPOSED.benefitType);
  await form.getByRole('textbox').fill(PROPOSED.procedureCodes.join(', '));
  await form.getByRole('combobox', { name: '보험 계산 분류' }).selectOption(PROPOSED.calcClass);
  await expect(form.getByRole('alert')).toHaveCount(0);
  await shoot(page, 'ha-form-filled');

  const response = page.waitForResponse((entry) => entry.request().method() === 'POST' && entry.url().endsWith(`/treatments/${T1}/review-requests`));
  await form.getByRole('button', { name: '검토 요청 보내기' }).click();
  const posted = await response;
  expect(posted.status()).toBe(200);
  const created = (await posted.json()) as Json;
  requestId = created['reviewRequest']['id'] as string;
  expect(created['reviewRequest']).toMatchObject({ treatmentId: T1, proposed: PROPOSED, status: 'REVIEW_REQUESTED', requestedBy: HA_1_USER });

  // 결과: 안내, 행의 상태, 막힌 단추, 보낸 요청 표. 요청은 제안일 뿐이라 치료 목록 값은 그대로다.
  await expect(page.locator('[data-admin-message="ok"]')).toContainText('바뀌지 않았습니다');
  await expect(page.locator(`[data-admin-review-form="${T1}"]`)).toHaveCount(0);
  const rowA = page.locator(`[data-admin-review-row="${T1}"]`);
  await expect(rowA.locator('[data-admin-review-status]')).toHaveText('검토 요청됨 (대기 중)');
  await expect(rowA.getByRole('button', { name: `${NAME_A} 검토 요청`, exact: true })).toBeDisabled();
  await expect(rowA.locator('[data-admin-review-blocked]')).toHaveText('이미 검토 중인 요청이 있습니다');
  await expect(rowA.locator('td').first()).toHaveText('급여'); // 지금 값(급여)은 그대로다: 제안(비급여)은 치료 목록을 바꾸지 않는다
  const rowB = page.locator(`[data-admin-review-row="${T2}"]`);
  await expect(rowB.locator('[data-admin-review-status]')).toHaveText('요청 없음');
  await expect(rowB.getByRole('button', { name: `${NAME_B} 검토 요청`, exact: true })).toBeEnabled();
  const sent = page.locator(`[data-admin-review-sent-item="${requestId}"]`);
  await expect(sent).toContainText(NAME_A);
  await expect(sent).toContainText('비급여');
  await expect(sent).toContainText('TEST_FIXTURE_PROPOSED_PROC_A, TEST_FIXTURE_PROPOSED_PROC_B');
  await expect(sent).toContainText('3대 비급여');
  await expect(sent.locator('[data-admin-review-sent-status]')).toHaveText('검토 요청됨 (대기 중)');
  expect(writes).toHaveLength(1);
  await shoot(page, 'ha-request-sent');

  // 새로 읽어도 그대로다(서버에서 읽는다).
  await page.reload();
  await expect(page.locator('[data-admin-page="review-requests"]')).toBeVisible();
  await expect(page.locator(`[data-admin-review-row="${T1}"] [data-admin-review-status]`)).toHaveText('검토 요청됨 (대기 중)');
  await expect(page.locator(`[data-admin-review-sent-item="${requestId}"]`)).toBeVisible();
  await expect(page.locator('[data-admin-review-sent-item]')).toHaveCount(1);
  await expect(page.locator(`[data-admin-review-row="${T1}"]`).getByRole('button', { name: `${NAME_A} 검토 요청`, exact: true })).toBeDisabled();
  await shoot(page, 'ha-after-reload');
});

test('거절: 중복 · 없는 치료 · 다른 병원 치료 · 위조·잘못된 본문 · 권한 없는 계정 · 인증 없음 · 잘못된 방법 — 모두 응답과 함께 저장 상태가 그대로다', async ({ browser }) => {
  const ha1 = await openAs(browser, 'ha-clinic-1');
  const ha2 = await openAs(browser, 'ha-clinic-2');
  const rv = await openAs(browser, 'rv-1');
  const po = await openAs(browser, 'po-1');
  const anonymous = await openAs(browser, null);
  try {
    const other = await json(await ha2.context.request.get(`${API_2}/treatments`));
    const otherTreatmentId = (other['treatments'] as Json[])[0]?.['treatmentId'] as string;
    expect(otherTreatmentId).toBeTruthy();
    const stateBefore = await observe(rv, ha1, ha2);
    expect(stateBefore['queue']['queue']).toHaveLength(1);
    expect(stateBefore['clinic1']['reviewRequests']).toHaveLength(1);
    expect(stateBefore['clinic2']['reviewRequests']).toEqual([]);
    const body = { proposed: PROPOSED };
    const post = (session: Session, url: string, data?: unknown): Promise<APIResponse> => session.context.request.fetch(url, { method: 'POST', ...(data === undefined ? {} : { data }) });

    // 1. 같은 치료에 열린 요청이 있으면 409 — 다른 분류로 다시 보내도 같다.
    const duplicate = await post(ha1, submitUrl(API_1, T1), { proposed: { ...PROPOSED, calcClass: 'NEEDS_REVIEW' } });
    expect(duplicate.status()).toBe(409);
    expect(await json(duplicate)).toEqual({ error: 'CONFLICT', reason: 'REVIEW_ALREADY_REQUESTED' });
    expect(duplicate.headers()['cache-control']).toBe('no-store');
    expect(await observe(rv, ha1, ha2)).toEqual(stateBefore);

    // 2. 없는 치료 · 다른 병원의 치료 → 같은 400 (다른 병원 자료의 존재를 드러내지 않는다).
    const notInCatalog = { error: 'INVALID_REQUEST', defects: [{ code: 'TREATMENT_NOT_IN_CATALOG', path: 'treatmentId' }] };
    for (const treatmentId of ['TEST_FIXTURE_NO_SUCH_TREATMENT', otherTreatmentId]) {
      const response = await post(ha1, submitUrl(API_1, treatmentId), body);
      expect(response.status(), treatmentId).toBe(400);
      expect(await json(response), treatmentId).toEqual(notInCatalog);
    }
    expect(await observe(rv, ha1, ha2)).toEqual(stateBefore);

    // 3. 위조·잘못된 본문 → 400 + 어긋난 경로. 서버가 정하는 값(요청자·병원·역할·상태)은 본문으로 보낼 길이 없다.
    const bad: Array<[string, unknown, string]> = [
      ['없는 분류', { proposed: { ...PROPOSED, calcClass: 'NO_SUCH_CLASS' } }, 'proposed.calcClass'],
      ['공백뿐인 행위 코드', { proposed: { ...PROPOSED, procedureCodes: ['TEST_FIXTURE_PROC', '   '] } }, 'proposed.procedureCodes[1]'],
      ['요청자 위조', { ...body, requestedBy: 'TEST_FIXTURE_FORGED' }, 'request.requestedBy'],
      ['역할 위조', { ...body, role: 'RV' }, 'request.role'],
      ['병원 위조', { ...body, clinicId: CLINIC_2 }, 'request.clinicId'],
      ['상태 위조', { ...body, status: 'APPROVED' }, 'request.status'],
      ['proposed 안의 병원 위조', { proposed: { ...PROPOSED, clinicId: CLINIC_2 } }, 'proposed.clinicId'],
    ];
    for (const [name, data, defectPath] of bad) {
      const response = await post(ha1, submitUrl(API_1, T2), data);
      expect(response.status(), name).toBe(400);
      const parsed = await json(response);
      expect(parsed['error'], name).toBe('INVALID_REQUEST');
      expect(parsed['defects'].map((defect: Json) => defect['path']), name).toContain(defectPath);
    }
    const notJson = await ha1.context.request.fetch(submitUrl(API_1, T2), { method: 'POST', headers: { 'content-type': 'application/json' }, data: Buffer.from('{not json') });
    expect(notJson.status()).toBe(400);
    expect(await json(notJson)).toEqual({ error: 'INVALID_REQUEST', defects: [{ code: 'NOT_JSON', path: 'request' }] });
    // 헤더로 역할·병원을 주장해도 달라지지 않는다.
    const spoofed = await ha2.context.request.fetch(submitUrl(API_1, T2), { method: 'POST', data: body, headers: { 'x-role': 'HA', 'x-clinic-id': CLINIC_1 } });
    expect(spoofed.status()).toBe(403);
    expect(await observe(rv, ha1, ha2)).toEqual(stateBefore);

    // 4. 권한: 다른 병원 HA · RV · PO 는 병원 1 의 제출·목록이 403. HA 가 다른 병원 경로로 보내도 403.
    const forbidden = { error: 'FORBIDDEN' };
    for (const [name, session] of [['ha-clinic-2', ha2], ['rv-1', rv], ['po-1', po]] as const) {
      const submitted = await post(session, submitUrl(API_1, T2), body);
      expect(submitted.status(), `${name} 제출`).toBe(403);
      expect(await json(submitted)).toEqual(forbidden);
      const listed = await session.context.request.get(`${API_1}/review-requests`);
      expect(listed.status(), `${name} 목록`).toBe(403);
      expect(await json(listed)).toEqual(forbidden);
    }
    const crossClinic = await post(ha1, submitUrl(API_2, otherTreatmentId), body);
    expect(crossClinic.status()).toBe(403);
    expect(await json(crossClinic)).toEqual(forbidden);
    expect(await observe(rv, ha1, ha2)).toEqual(stateBefore);

    // 5. 대기열은 플랫폼 단위 검토 담당자만: 병원 관리자(1·2)·PO 는 403.
    for (const [name, session] of [['ha-clinic-1', ha1], ['ha-clinic-2', ha2], ['po-1', po]] as const) {
      const response = await session.context.request.get(QUEUE);
      expect(response.status(), `${name} 대기열`).toBe(403);
      expect(await json(response)).toEqual(forbidden);
    }
    // 병원에 묶인 RV 소속은 이 앞단의 시험 계정에 없어 브라우저 층에서는 만들지 못한다(서버 통합 시험이 본다).

    // 6. 인증 없음 → 401 (제출·목록·대기열), 응답은 no-store.
    for (const [method, url, data] of [['POST', submitUrl(API_1, T2), body], ['GET', `${API_1}/review-requests`, undefined], ['GET', QUEUE, undefined]] as const) {
      const response = await anonymous.context.request.fetch(url, { method, ...(data === undefined ? {} : { data }) });
      expect(response.status(), `${method} ${url}`).toBe(401);
      expect(await json(response)).toEqual({ error: 'UNAUTHENTICATED' });
      expect(response.headers()['cache-control']).toBe('no-store');
    }

    // 7. 잘못된 방법 → 405 (인증된 요청에서만).
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
      expect((await ha1.context.request.fetch(submitUrl(API_1, T2), { method })).status(), `${method} 제출 경로`).toBe(405);
    }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect((await ha1.context.request.fetch(`${API_1}/review-requests`, { method })).status(), `${method} 목록 경로`).toBe(405);
      expect((await rv.context.request.fetch(QUEUE, { method })).status(), `${method} 대기열 경로`).toBe(405);
    }

    // 모든 거절 뒤에도 열린 요청은 정확히 하나이고 내용은 처음 그대로다.
    const stateAfter = await observe(rv, ha1, ha2);
    expect(stateAfter).toEqual(stateBefore);
    expect(stateAfter['queue']['queue']).toHaveLength(1);
    expect(stateAfter['queue']['queue'][0]).toMatchObject({ id: requestId, treatmentId: T1, status: 'REVIEW_REQUESTED', proposed: PROPOSED });
  } finally {
    for (const session of [ha1, ha2, rv, po, anonymous]) await session.context.close();
  }
});

test('검토 담당자: 로그인하면 검토 대기열로 들어가 처리 전 요청을 현재 게시값과 제안값을 나란히 읽는다 (처리 동작이 없다)', async ({ page }) => {
  const published = (before.adminTreatments['treatments'] as Json[]).find((entry) => entry['treatmentId'] === T1) as Json;

  await login(page, 'rv-1');
  await expect(page).toHaveURL(/\/admin\/review-queue$/);
  await expect(page.locator('[data-admin-page="review-queue"]')).toBeVisible();
  await expect(page.locator('[data-admin-queue-note]')).toContainText('확인만');
  // 거절된 시도가 아무리 많아도 열린 요청은 정확히 하나다.
  const rows = page.locator('[data-admin-queue-row]');
  await expect(rows).toHaveCount(1);

  // 치료 A 의 요청 행: 병원 · 치료 · 요청자 · 상태 · 현재값 · 제안값.
  const rowA = page.locator(`[data-admin-queue-row="${requestId}"]`);
  await expect(rowA.locator('[data-admin-queue-clinic]')).toHaveText(CLINIC_NAME);
  await expect(rowA.locator('[data-admin-queue-treatment]')).toHaveText(NAME_A);
  await expect(rowA.locator('[data-admin-queue-requester]')).toHaveText(HA_1_USER);
  await expect(rowA.locator('[data-admin-queue-requested-at]')).not.toHaveText('');
  await expect(rowA.locator('[data-admin-queue-status]')).toHaveText('검토 요청됨 (대기 중)');
  const current = rowA.locator('[data-admin-queue-values="current"]');
  const proposed = rowA.locator('[data-admin-queue-values="proposed"]');
  await expect(current).toContainText('현재 게시값');
  await expect(current.locator('[data-admin-queue-field="benefit"]')).toHaveText(published['benefitType'] === 'BENEFIT' ? '급여' : '비급여');
  await expect(current.locator('[data-admin-queue-field="procedures"]')).toHaveText((published['procedureCodes'] as string[]).join(', '));
  await expect(current.locator('[data-admin-queue-field="calcClass"]')).toHaveText(/^(일반 급여|일반 비급여|3대 비급여|추가 검토 필요)$/);
  await expect(proposed).toContainText('병원이 제안한 값');
  await expect(proposed.locator('[data-admin-queue-field="benefit"]')).toHaveText('비급여');
  await expect(proposed.locator('[data-admin-queue-field="procedures"]')).toHaveText('TEST_FIXTURE_PROPOSED_PROC_A, TEST_FIXTURE_PROPOSED_PROC_B');
  await expect(proposed.locator('[data-admin-queue-field="calcClass"]')).toHaveText('3대 비급여');
  await expect(current.locator('[data-differs]')).toHaveCount(0);
  expect(await proposed.locator('[data-differs="true"]').count()).toBeGreaterThanOrEqual(2);

  // 읽기 전용: 단추도 입력칸도 없고, 처리 동작 문구도 없다.
  await expect(page.locator('main').getByRole('button')).toHaveCount(0);
  await expect(page.locator('main input, main select, main textarea, main form')).toHaveCount(0);
  const text = await page.locator('main').innerText();
  expect(text).not.toMatch(/승인하기|반려하기|매핑 만들기|규칙 묶음|게시하기/);
  await shoot(page, 'rv-queue');

  // 입구 화면: 검토 담당자에게는 대기열 링크만 있다(병원 링크 없음).
  await page.goto('/admin');
  await expect(page.locator('[data-admin-state="ready"]')).toBeVisible();
  await expect(page.getByRole('link', { name: '검토 대기열' })).toBeVisible();
  await expect(page.locator('main').getByRole('link')).toHaveCount(1);
  await expect(page.locator('main .admin-banner')).toHaveCount(0);
});

test('접근 거절 화면: 병원 관리자·PO 는 대기열이, 검토 담당자·PO·다른 병원 관리자는 병원 1 의 검토 요청 화면이 거절되고 단추·입력칸이 없다. 인증이 없으면 로그인 안내다', async ({ page, browser }) => {
  for (const account of ['ha-clinic-1', 'ha-clinic-2', 'po-1']) {
    await login(page, account);
    await page.goto('/admin/review-queue');
    await expect(page.locator('[data-admin-state="forbidden"]')).toBeVisible();
    await expect(page.locator('[data-admin-state] .admin-banner--error')).toHaveText('검토 담당자만 볼 수 있습니다');
    await expect(page.getByRole('button')).toHaveCount(0);
    await expect(page.locator('input')).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toMatch(/TEST_FIXTURE 시험 의원|TEST_FIXTURE_PROPOSED/);
    if (account === 'ha-clinic-1') await shoot(page, 'queue-forbidden-ha');
  }
  for (const account of ['rv-1', 'po-1', 'ha-clinic-2']) {
    await login(page, account);
    await page.goto(`/admin/${CLINIC_1}/review-requests`);
    await expect(page.locator('[data-admin-state="forbidden"]')).toBeVisible();
    await expect(page.locator('[data-admin-state] .admin-banner--error')).toContainText('권한이 없습니다');
    await expect(page.locator('input')).toHaveCount(0);
    await expect(page.getByRole('button')).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toMatch(/TEST_FIXTURE_PROPOSED/);
    if (account === 'rv-1') await shoot(page, 'requests-forbidden-rv');
  }
  // 병원 관리자 입구는 검토 담당자 링크를 만들지 않고, 소속이 없는 신원(PO)에는 안내만 보인다.
  await login(page, 'po-1');
  await page.goto('/admin');
  await expect(page.locator('[data-admin-state="ready"]')).toBeVisible();
  await expect(page.locator('main').getByRole('link')).toHaveCount(0);

  const anonymous = await openAs(browser, null);
  for (const url of ['/admin/review-queue', `/admin/${CLINIC_1}/review-requests`]) {
    await anonymous.page.goto(url);
    await expect(anonymous.page.locator('[data-admin-state="unauthenticated"]')).toBeVisible();
    await expect(anonymous.page.getByRole('button')).toHaveCount(0);
    await expect(anonymous.page.locator('input')).toHaveCount(0);
  }
  await anonymous.context.close();
});

test('AFTER: 요청이 쌓인 뒤에도 공개 카탈로그·보험 선택지·같은 조건의 계산 결과·관리자 치료 목록은 BEFORE 와 완전히 같다 (새 자료는 검토 요청뿐)', async ({ page, browser }) => {
  await login(page, 'ha-clinic-1');
  const after = await capture(page.request);
  expect(after.catalog).toEqual(before.catalog);
  expect(after.options).toEqual(before.options);
  expect(after.estimateStatus).toBe(before.estimateStatus);
  expect(after.estimate).toEqual(before.estimate);
  expect(after.adminTreatments).toEqual(before.adminTreatments);
  // 키오스크 문서가 보는 공개 자료 어디에도 제안한 값의 흔적이 없다.
  expect(JSON.stringify([after.catalog, after.options, after.estimate])).not.toContain('TEST_FIXTURE_PROPOSED');

  // 새로 생긴 자료는 검토 요청 하나뿐이다(치료 A, 열린 요청). 거절된 시도는 아무것도 남기지 않았다.
  const rv = await openAs(browser, 'rv-1');
  const queue = (await json(await rv.context.request.get(QUEUE)))['queue'] as Json[];
  expect(queue.map((entry) => [entry['id'], entry['treatmentId'], entry['status']])).toEqual([[requestId, T1, 'REVIEW_REQUESTED']]);
  await rv.context.close();
});

test('화면의 서버 거절 문장: 열어 둔 사이에 같은 치료의 요청이 다른 세션에서 만들어졌다면(409) 안내가 뜨고 요청은 늘지 않으며 입력이 남는다 (치료 B)', async ({ page, browser }) => {
  // 이 시험부터는 BEFORE/AFTER 비교가 끝났다. 치료 B 로 화면을 열어 두고 입력까지 채운 뒤, 같은 병원의 다른 세션이 치료 B 에 먼저 요청을 보낸다.
  await login(page, 'ha-clinic-1');
  await page.goto(`/admin/${CLINIC_1}/review-requests`);
  await page.getByRole('button', { name: `${NAME_B} 검토 요청`, exact: true }).click();
  const form = page.locator(`[data-admin-review-form="${T2}"]`);
  await form.getByRole('textbox').fill('TEST_FIXTURE_LATE_PROC');
  await form.getByRole('combobox', { name: '보험 계산 분류' }).selectOption('NEEDS_REVIEW');

  const other = await openAs(browser, 'ha-clinic-1');
  const first = await other.context.request.post(submitUrl(API_1, T2), { data: { proposed: { benefitType: 'NON_BENEFIT', procedureCodes: [], calcClass: 'GENERAL_NON_BENEFIT' } } });
  expect(first.status()).toBe(200);
  await other.context.close();

  await form.getByRole('button', { name: '검토 요청 보내기' }).click();
  await expect(page.locator('[data-admin-message="error"]')).toContainText('이미 검토 중인 요청이 있습니다');
  await expect(page.locator('[data-admin-message="error"]')).toContainText('요청은 만들어지지 않았고');
  // 화면의 상태도 서버와 맞춰진다(치료 B 가 이제 검토 요청됨). 입력한 내용은 그대로다.
  await expect(page.locator(`[data-admin-review-row="${T2}"] [data-admin-review-status]`)).toHaveText('검토 요청됨 (대기 중)');
  await expect(form.getByRole('textbox')).toHaveValue('TEST_FIXTURE_LATE_PROC');
  const list = await json(await page.request.get(`${API_1}/review-requests`));
  expect(list['reviewRequests'].filter((entry: Json) => entry['treatmentId'] === T2)).toHaveLength(1);
  await shoot(page, 'ha-conflict-message');
});

test('숨긴 치료: 치료 B 를 숨겨 게시하면 요청 후보 목록에서 빠지고 그 치료로 보내는 요청은 400 이다. 이미 있던 요청은 대기열에 남는다 (이 시험은 마지막이다)', async ({ page, browser }) => {
  await login(page, 'ha-clinic-1');
  // 기존 흐름(초안 → 미리보기 → 게시)으로 치료 B 를 숨긴다. 이 게시는 위 BEFORE/AFTER 비교가 끝난 뒤에만 한다.
  expect((await page.request.put(`${API_1}/catalog/draft`, { data: { deactivations: [T2] } })).status()).toBe(200);
  const preview = await page.request.post(`${API_1}/catalog/preview`, { data: CONDITION });
  expect(preview.status()).toBe(200);
  const published = await page.request.post(`${API_1}/catalog/publish`, { data: { publishConfirmation: (await json(preview))['publishConfirmation'] } });
  expect(published.status()).toBe(200);

  const hidden = await page.request.post(submitUrl(API_1, T2), { data: { proposed: PROPOSED } });
  expect(hidden.status()).toBe(400);
  expect(await json(hidden)).toEqual({ error: 'INVALID_REQUEST', defects: [{ code: 'TREATMENT_NOT_IN_CATALOG', path: 'treatmentId' }] });

  await page.goto(`/admin/${CLINIC_1}/review-requests`);
  await expect(page.locator('[data-admin-page="review-requests"]')).toBeVisible();
  await expect(page.locator('[data-admin-review-row]')).toHaveCount(1);
  await expect(page.locator(`[data-admin-review-row="${T1}"]`)).toBeVisible();
  await expect(page.locator(`[data-admin-review-row="${T2}"]`)).toHaveCount(0);
  await shoot(page, 'ha-hidden-not-offered');

  // 숨기기 전에 낸 치료 B 의 요청은 닫히지 않고 대기열에 남고, 병원이 제안한 값도 그대로 보인다.
  // 관찰(서버 동작): 대기열의 "현재 게시값"(current)은 현재 카탈로그가 담은 치료 버전에서 읽으므로 숨긴 치료도 마지막으로 게시한 값이 채워진다
  // (치료의 active 를 보지 않는다). 그래서 이 행에서는 "현재 게시 목록에 없음" 문구가 나오지 않는다 — 문구가 나오는 null 경로는 단위 시험(currentLines(null))이 본다.
  const rv = await openAs(browser, 'rv-1');
  await expect(rv.page.locator('[data-admin-queue-row]')).toHaveCount(2);
  const hiddenRow = rv.page.locator('[data-admin-queue-row]', { hasText: NAME_B });
  await expect(hiddenRow.locator('[data-admin-queue-values="current"]')).toBeVisible();
  await expect(hiddenRow.locator('[data-admin-queue-values="proposed"] [data-admin-queue-field="calcClass"]')).toHaveText('일반 비급여');
  await shoot(rv.page, 'rv-queue-hidden-treatment');
  await rv.context.close();
});
