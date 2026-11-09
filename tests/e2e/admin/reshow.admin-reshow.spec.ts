import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { expect, test } from '../helpers/test';

// 숨긴 치료 다시 표시 흐름 (SPEC-REIMBURSEMENT-001 M7): 치료 숨김 게시 → 숨긴 치료 목록 → 다시 표시 초안(공개 상태 불변) → 미리보기 → 게시 → 키오스크에 다시 나타난다.
// 앞단(tests/e2e/harness/server.ts, 이 파일 전용 인스턴스 ADMIN_RESHOW_PORT, --test-hooks)이 실제 관리자 핸들러·공개 핸들러를 시험 인증기와 시험 자료(TEST_FIXTURE)로 돌린다. 관리자 화면과 키오스크가 같은 저장소를 본다.
// 통신 가로채기는 쓰지 않는다: 모든 요청이 실제 HTTP 로 앞단을 지난다. 보장 판단 필드·매핑 상태·다른 병원은 시험 전용 끝점(/__harness/state)이 주는 저장소 사본으로 전후를 글자 그대로 비교한다.
// 한 파일 안에서 순서대로 돈다: 앞 시험의 초안·게시 결과를 뒤 시험이 이어받는다.
//   시험 2 : 치료 B 숨김 게시                                          시험 6 : 새 치료 C(분류 검토 전) 추가 → 숨김 → 다시 표시 → 계속 계산 보류
//   시험 3 : 다시 표시 + 치료 A 가격 11,000 을 한 초안으로 저장            시험 7 : 옛 카탈로그 버전 409 (맨 마지막: 카탈로그를 서버 쪽에서 바꾼다)
//   시험 4 : 미리보기 없이 게시 거절                                     시험 5 : 미리보기 → 게시 → 키오스크 재등장
// 시험 자료의 이름은 TEST_FIXTURE 로 시작하는 가짜 값이다. 사진은 .moai/state/shots/m7-admin-reshow/ 에 남는다(육안 검토용 자료이며 시험 결과가 아니다).

test.describe.configure({ mode: 'serial' });

const CLINIC_ID = 'TEST_FIXTURE_CLINIC_1';
const SLUG = 'test-fixture-clinic-1';
const OTHER_SLUG = 'test-fixture-clinic-2';
const KIOSK = `/kiosk/${SLUG}`;
const API = `/api/admin/clinics/${CLINIC_ID}`;
const T1 = 'TEST_FIXTURE_TREATMENT_1';
const T2 = 'TEST_FIXTURE_TREATMENT_2';
const NAME_A = 'TEST_FIXTURE 시험 치료 A (급여)';
const NAME_B = 'TEST_FIXTURE 시험 치료 B (비급여)';
const NAME_C = 'TEST_FIXTURE 시험 치료 C (새로 추가)';
const NOT_ISSUED = 'a'.repeat(64);
const CONDITION = { generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN' };

const SHOTS = path.resolve('.moai/state/shots/m7-admin-reshow');
let shotCount = 0;
const shoot = async (page: Page, name: string): Promise<void> => {
  mkdirSync(SHOTS, { recursive: true });
  shotCount += 1;
  await page.screenshot({ path: path.join(SHOTS, `${String(shotCount).padStart(2, '0')}-${name}.png`), animations: 'disabled', fullPage: true });
};

interface Json {
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const row = (page: Page, key: string) => page.locator(`[data-admin-row="${key}"]`);
const hiddenRow = (page: Page, treatmentId: string) => page.locator(`[data-admin-hidden-row="${treatmentId}"]`);
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const rowKeys = async (page: Page): Promise<string[]> => page.locator('[data-admin-list="working"] [data-admin-row]').evaluateAll((rows) => rows.map((entry) => entry.getAttribute('data-admin-row') ?? ''));
const previewResponse = (page: Page) => page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/catalog/preview'));
const publishResponse = (page: Page) => page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/catalog/publish'));

async function login(page: Page, account: string): Promise<void> {
  await page.goto('/__harness/login');
  await page.locator(`[data-test-account="${account}"]`).click();
  await expect(page).toHaveURL(/\/admin\/(?:[^/]+\/treatments|review-queue|rule-scope)$/);
}

async function adminReady(page: Page): Promise<void> {
  await login(page, 'ha-clinic-1');
  await expect(page.locator('[data-admin-state="ready"]')).toBeVisible();
}

const storeState = async (request: APIRequestContext): Promise<Json> => (await (await request.get('/__harness/state')).json()) as Json;
const changedKeys = (before: Json, after: Json): string[] =>
  Object.keys(after)
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .sort();
const publicCatalog = async (request: APIRequestContext, slug = SLUG): Promise<Json> => (await (await request.get(`/api/clinics/${slug}/catalog`)).json()) as Json;
const adminList = async (request: APIRequestContext): Promise<Json> => (await request.get(`${API}/treatments`)).json() as Promise<Json>;
const serverDraft = async (request: APIRequestContext): Promise<Json | null> => ((await adminList(request)).draft ?? null) as Json | null;
const publicNames = async (request: APIRequestContext): Promise<string[]> => ((await publicCatalog(request)).treatments as Json[]).map((entry) => entry['displayName'] as string);
const publicRows = async (request: APIRequestContext): Promise<Array<[string, number, number]>> =>
  ((await publicCatalog(request)).treatments as Json[]).map((entry) => [entry['treatmentId'] as string, entry['patientAmount'] as number, entry['order'] as number]);

/** 저장소 사본에서 한 병원 밖의 치료 기록(다른 병원 불변 비교용)과 한 키의 항목들을 글자로 뽑는다. */
const otherClinicTreatments = (state: Json): string => JSON.stringify((state['treatments'] as Array<[string, Json]>).filter(([, treatment]) => treatment['clinicId'] !== CLINIC_ID));
const entriesOf = (state: Json, key: string, filter: (value: Json) => boolean): string => JSON.stringify((state[key] as Array<[string, Json]>).filter(([, value]) => filter(value)));

async function publicEstimate(request: APIRequestContext, treatmentIds: string[]): Promise<{ status: number; body: Json }> {
  const catalog = await publicCatalog(request);
  const options = (await (await request.get(`/api/clinics/${SLUG}/insurance/options`)).json()) as Json;
  const response = await request.post(`/api/clinics/${SLUG}/estimate`, {
    data: { catalogVersion: catalog['catalogVersion'], ruleBundleVersion: options['ruleBundleVersion'], ...CONDITION, treatmentIds },
  });
  return { status: response.status(), body: (await response.json()) as Json };
}

/** 키오스크에서 4세대 · 손해보험사 · 첫 원인까지 입력하고 치료 선택 화면에서 멈춘다. */
async function kioskToTreatments(page: Page): Promise<void> {
  await page.goto(KIOSK);
  await page.getByRole('button', { name: '시작하기' }).click();
  await page.getByRole('radio', { name: '4세대(C4)' }).check();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByRole('radio', { name: '손해보험사' }).check();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(page.getByRole('heading', { name: '확인할 치료를 선택해 주세요' })).toBeVisible();
}

/** 키오스크 새 창에서 치료 선택 화면에 보이는 치료 이름들(보이는 순서)을 읽는다. */
async function kioskList(browser: Browser, shotName?: string): Promise<string[]> {
  const context = await browser.newContext({ viewport: { width: 1080, height: 1920 }, locale: 'ko-KR' });
  const kiosk = await context.newPage();
  await kioskToTreatments(kiosk);
  const listed = await kiosk.getByRole('checkbox').evaluateAll((boxes) =>
    boxes.map((box) => {
      const labelled = (box.getAttribute('aria-labelledby') ?? '')
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ');
      return (box.getAttribute('aria-label') ?? (labelled.trim() !== '' ? labelled : (box.closest('label')?.textContent ?? ''))).replace(/\s+/g, ' ').trim();
    }),
  );
  if (shotName !== undefined) await shoot(kiosk, shotName);
  await context.close();
  return listed;
}

interface KioskOutcome {
  state: string;
  hospital: number;
  payout: number | null;
  payoutKnown: string | null;
}

/** 키오스크에서 이름(정규식)으로 치료를 골라 계산하고 서버 응답과 화면 표지를 돌려준다. */
async function kioskCalculate(browser: Browser, picks: RegExp[], shotName?: string): Promise<KioskOutcome> {
  const context = await browser.newContext({ viewport: { width: 1080, height: 1920 }, locale: 'ko-KR' });
  const kiosk = await context.newPage();
  await kioskToTreatments(kiosk);
  for (const name of picks) await kiosk.getByRole('checkbox', { name }).check();
  const response = kiosk.waitForResponse((entry) => entry.url().endsWith('/estimate') && entry.request().method() === 'POST');
  await kiosk.getByRole('button', { name: '예상 부담액 확인' }).click();
  const body = (await (await response).json()) as { result: { state: string; amounts: { hospitalPayment: number; expectedInsurancePayout: number | null } } };
  await expect(kiosk.locator('[data-result]')).toBeVisible();
  const outcome: KioskOutcome = {
    state: body.result.state,
    hospital: body.result.amounts.hospitalPayment,
    payout: body.result.amounts.expectedInsurancePayout,
    payoutKnown: await kiosk.locator('[data-kiosk-amount="payout"]').getAttribute('data-known'),
  };
  if (shotName !== undefined) await shoot(kiosk, shotName);
  await context.close();
  return outcome;
}

/** 화면의 초안 저장 → 미리보기 → 게시를 차례로 누른다. 각 단계가 성공했는지 본다(미리보기 응답 200, 게시 응답 200). */
async function saveThenPreviewThenPublish(page: Page): Promise<Json> {
  await button(page, '초안 저장').click();
  await expect(page.locator('[data-admin-message="ok"]')).toContainText('초안을 저장했습니다');
  const preview = previewResponse(page);
  await button(page, '미리보기 계산').click();
  expect((await preview).status()).toBe(200);
  await expect(page.locator('[data-admin-preview]')).toBeVisible();
  const published = publishResponse(page);
  await button(page, '게시').click();
  const response = await published;
  expect(response.status()).toBe(200);
  await expect(page.locator('[data-admin-message="ok"]')).toContainText('게시했습니다');
  return (await response.json()) as Json;
}

/** 새 치료 입력칸을 채운다 (모든 칸이 올바른 값). */
async function fillNewTreatment(page: Page): Promise<void> {
  await page.getByLabel('이름', { exact: true }).fill(NAME_C);
  await page.getByLabel('설명 (선택)', { exact: true }).fill('TEST_FIXTURE 새 치료 설명');
  await page.getByRole('combobox', { name: '급여 구분' }).selectOption('NON_BENEFIT');
  await page.getByLabel('가격 (원)', { exact: true }).fill('8000');
  await page.getByLabel('치료 코드', { exact: true }).fill('TEST_FIXTURE_NEW_TC');
  await page.getByLabel('행위 코드 (쉼표로 구분, 비워도 됨)', { exact: true }).fill('TEST_FIXTURE_NEW_PROC_A');
  await page.getByLabel('환자 유형', { exact: true }).fill('TEST_FIXTURE_PATIENT');
  await page.getByLabel('가정', { exact: true }).fill('TEST_FIXTURE_ASSUMPTION');
  await page.getByLabel('기준일 (YYYY-MM-DD)', { exact: true }).fill('2026-11-01');
  await page.getByLabel('적용일 (YYYY-MM-DD)', { exact: true }).fill('2026-11-01');
}

// 시험 사이에 이어받는 값.
let baselineB: Json | null = null;
let otherCatalogBefore: Json | null = null;
let otherTreatmentsBefore = '';

test('사전 상태: 세계를 새로 만들고, 병원 1 은 치료 A·B 를 보이며 숨긴 치료가 없다. 로그인 전은 401 이다', async ({ page, request, browser }) => {
  rmSync(SHOTS, { recursive: true, force: true });
  expect((await request.post('/__harness/reset')).status()).toBe(200);
  expect((await request.get(`${API}/treatments`)).status()).toBe(401);
  expect(await publicNames(request)).toEqual([NAME_A, NAME_B]);
  const estimate = await publicEstimate(request, [T2]);
  expect(estimate.status).toBe(200);
  expect(estimate.body['result']['state']).toBe('ESTIMATED');
  baselineB = estimate.body['result'] as Json; // 숨기기 전의 치료 B 계산(다시 표시 뒤에도 같아야 한다)
  otherCatalogBefore = await publicCatalog(request, OTHER_SLUG);
  otherTreatmentsBefore = otherClinicTreatments(await storeState(request));

  await adminReady(page);
  expect(await rowKeys(page)).toEqual([T1, T2]);
  expect((await adminList(page.request))['hiddenTreatments']).toEqual([]);
  await expect(page.locator('[data-admin-hidden-none]')).toHaveText('숨긴 치료가 없습니다.');
  await expect(page.locator('[data-admin-hidden-section]')).toContainText('보장 승인이나 분류 변경이 아니므로');
  expect(await kioskList(browser)).toHaveLength(2);
  await shoot(page, 'before');
});

test('치료 B 를 숨겨 게시한다: 키오스크에서 빠지고, 관리자 "숨긴 치료" 영역과 숨김 목록 조회에 나온다', async ({ page, browser }) => {
  await adminReady(page);
  await button(page, `${NAME_B} 숨기기`).click();
  await expect(row(page, T2)).toHaveAttribute('data-hidden', 'true');
  await saveThenPreviewThenPublish(page);

  expect(await publicNames(page.request)).toEqual([NAME_A]);
  expect(await kioskList(browser)).toEqual([expect.stringContaining('시험 치료 A (급여)')]);
  expect(await rowKeys(page)).toEqual([T1]);
  // 숨김 목록 조회: 서버가 현재 카탈로그가 버전을 담은 숨긴 치료를 알린다.
  const hidden = (await adminList(page.request))['hiddenTreatments'] as Json[];
  expect(hidden.map((entry) => [entry['treatmentId'], entry['patientAmount'], entry['order']])).toEqual([[T2, 10_000, 2]]);
  await expect(hiddenRow(page, T2)).toBeVisible();
  await expect(hiddenRow(page, T2)).toContainText(NAME_B);
  await expect(hiddenRow(page, T2).locator('[data-admin-hidden-price]')).toHaveText('10,000원');
  await expect(hiddenRow(page, T2).locator('[data-admin-reshow]')).toHaveAttribute('data-admin-reshow', 'off');
  await expect(page.locator('[data-admin-version]').first()).toContainText('숨김 1건');
  await shoot(page, 'hidden-published');
});

test('다시 표시 + 치료 A 가격 11,000 을 한 초안으로 저장한다: 저장만으로는 키오스크도 공개 자료도 저장소의 치료 기록도 바뀌지 않는다', async ({ page, browser }) => {
  const catalogBefore = await publicCatalog(page.request);
  const stateBefore = await storeState(page.request);

  await adminReady(page);
  await hiddenRow(page, T2).locator('[data-admin-reshow]').click();
  // 다시 표시한 치료는 남는 기존 치료 뒤에 한 줄로 들어오고, 가격 입력칸이 없으며, 취소 단추가 있다.
  expect(await rowKeys(page)).toEqual([T1, T2]);
  await expect(row(page, T2)).toHaveAttribute('data-reshown', 'true');
  await expect(row(page, T2).locator('[data-admin-position]')).toHaveText('2');
  await expect(row(page, T2).locator('[data-admin-badge="reshown"]')).toHaveText('다시 표시 예정');
  await expect(row(page, T2).locator('[data-admin-reshown-price]')).toHaveText('10,000원');
  await expect(row(page, T2).locator('input')).toHaveCount(0);
  await expect(row(page, T2).locator('[data-admin-reshow="on"]')).toHaveText('다시 표시 취소');
  await expect(hiddenRow(page, T2).locator('[data-admin-badge="reshown"]')).toBeVisible();
  await expect(page.locator('[data-admin-working-summary]')).toContainText('다시 표시 1건');
  // 다시 표시한 치료 위에 아무 숨김 단추도 없고, 가격은 다른 치료(A)만 고친다.
  await row(page, T1).locator('input').fill('11000');
  await expect(page.locator('[data-admin-working-summary]')).toContainText('가격 변경 1건 · 다시 표시 1건');
  await shoot(page, 'reshow-selected');

  await button(page, '초안 저장').click();
  await expect(page.locator('[data-admin-message="ok"]')).toContainText('초안을 저장했습니다');
  await expect(page.locator('[data-admin-draft="saved"]')).toBeVisible();
  const draft = await serverDraft(page.request);
  expect(draft).toMatchObject({ reactivations: [T2], priceEdits: [{ treatmentId: T1, patientAmount: 11_000 }], deactivations: [], additions: [], order: null, stale: false });

  // 공개 상태 불변: 공개 카탈로그·키오스크 목록·치료 기록이 그대로다. 바뀐 것은 초안과 감사 기록뿐이다.
  expect(await publicCatalog(page.request)).toEqual(catalogBefore);
  expect(await kioskList(browser)).toHaveLength(1);
  expect(changedKeys(stateBefore, await storeState(page.request))).toEqual(['auditLog', 'catalogDrafts']);
  const stored = await storeState(page.request);
  expect(entriesOf(stored, 'treatments', (t) => t['id'] === T2)).toBe(entriesOf(stateBefore, 'treatments', (t) => t['id'] === T2));
  await shoot(page, 'reshow-saved');
});

test('미리보기 없이는 게시할 수 없다: 화면 게시 단추는 꺼져 있고, 서버는 틀린 확인값을 409 PREVIEW_REQUIRED 로 거절하며 아무것도 바뀌지 않는다', async ({ page, browser }) => {
  await adminReady(page);
  // 저장된 초안이 화면에 복원된다: 다시 표시 줄과 가격 수정.
  expect(await rowKeys(page)).toEqual([T1, T2]);
  await expect(row(page, T2)).toHaveAttribute('data-reshown', 'true');
  await expect(row(page, T1).locator('input')).toHaveValue('11000');
  await expect(button(page, '게시')).toBeDisabled();

  const before = await storeState(page.request);
  const catalogBefore = await publicCatalog(page.request);
  for (const wrong of [NOT_ISSUED, 'b'.repeat(64)]) {
    const attempt = await page.request.post(`${API}/catalog/publish`, { data: { publishConfirmation: wrong } });
    expect(attempt.status()).toBe(409);
    expect(await attempt.json()).toEqual({ error: 'CONFLICT', reason: 'PREVIEW_REQUIRED' });
  }
  expect((await page.request.post(`${API}/catalog/publish`, { data: {} })).status()).toBe(400);
  expect(await storeState(page.request)).toEqual(before);
  expect(await publicCatalog(page.request)).toEqual(catalogBefore);
  expect(await publicNames(page.request)).toEqual([NAME_A]);
  expect(await kioskList(browser)).toHaveLength(1);
});

test('미리보기 → 게시 → 키오스크에 다시 나타난다: 같은 치료·같은 가격·숨기기 전과 같은 계산, 보장 판단·매핑 상태·다른 병원은 그대로', async ({ page, browser }) => {
  await adminReady(page);
  const stateBefore = await storeState(page.request);

  const preview = previewResponse(page);
  await button(page, '미리보기 계산').click();
  const response = await preview;
  expect(response.status()).toBe(200);
  const body = (await response.json()) as Json;
  // 미리보기는 읽기만 한다: 저장소 전체가 그대로, 공개 목록도 그대로.
  expect(await storeState(page.request)).toEqual(stateBefore);
  expect(await publicNames(page.request)).toEqual([NAME_A]);

  expect(body['beforeList'].map((entry: Json) => entry['treatmentId'])).toEqual([T1]);
  expect(body['afterList'].map((entry: Json) => [entry['treatmentId'], entry['position']])).toEqual([[T1, 1], [T2, 2]]);
  expect(body['changes']['reactivated']).toEqual([
    { treatmentId: T2, displayName: NAME_B, patientAmount: 10_000, benefitType: 'NON_BENEFIT', position: 2, calculation: { state: 'ESTIMATED', lineState: 'ESTIMATED', holdReasons: [] } },
  ]);
  // 화면: 변경 내역에 "다시 표시"와 "가격 변경"이 함께 보이고, 목록 비교에 다시 표시 표지가 붙는다.
  const reactivated = page.locator(`[data-admin-reactivated="${T2}"]`);
  await expect(reactivated).toBeVisible();
  await expect(reactivated).toContainText(NAME_B);
  await expect(reactivated).toContainText('게시 뒤 2번째');
  await expect(reactivated.locator('[data-admin-reactivated-state]')).toHaveAttribute('data-admin-reactivated-state', 'ESTIMATED');
  await expect(page.locator('[data-admin-reactivated-note]')).toContainText('보장 승인이 아닙니다');
  await expect(page.locator(`[data-admin-change="${T1}"]`)).toContainText('10,000원 → 11,000원');
  await expect(page.locator('[data-admin-preview-list="after"] [data-admin-preview-reshown]')).toHaveCount(1);
  await expect(page.locator('[data-admin-preview-list="before"] [data-admin-preview-row]')).toHaveCount(1);
  await shoot(page, 'preview');

  const statePublish = await storeState(page.request);
  const published = publishResponse(page);
  await button(page, '게시').click();
  const publishedBody = (await (await published).json()) as Json;
  await expect(page.locator('[data-admin-message="ok"]')).toContainText('게시했습니다');
  expect(publishedBody['changeSummary']).toMatchObject({ priceChangedTreatmentIds: [T1], reactivatedTreatmentIds: [T2], addedTreatmentIds: [], removedTreatmentIds: [] });

  // 공개 목록: 같은 치료 B 가 같은 가격으로 두 번째에 다시 나타나고, A 는 새 가격이다.
  expect(await publicRows(page.request)).toEqual([[T1, 11_000, 1], [T2, 10_000, 2]]);
  expect(await publicNames(page.request)).toEqual([NAME_A, NAME_B]);
  expect(await kioskList(browser, 'kiosk-after')).toHaveLength(2);
  // 숨기기 전과 같은 엔진 판정: 치료 B 하나의 계산 결과가 숨기기 전 그대로다.
  const after = await publicEstimate(page.request, [T2]);
  expect(after.status).toBe(200);
  expect(after.body['result']).toEqual(baselineB);
  const shown = await kioskCalculate(browser, [/시험 치료 B/], 'kiosk-calc-b');
  expect(shown.state).toBe('ESTIMATED');
  expect(shown.hospital).toBe((baselineB as Json)['amounts']['hospitalPayment']);

  // 화면: 숨긴 치료 영역은 비고, 초안은 닫히고, 게시 이력에 다시 표시가 보인다.
  await expect(page.locator('[data-admin-hidden-none]')).toBeVisible();
  await expect(page.locator('[data-admin-draft="none"]')).toBeVisible();
  expect(await rowKeys(page)).toEqual([T1, T2]);
  await expect(row(page, T2)).toHaveAttribute('data-reshown', 'false');
  await expect(page.locator('[data-admin-version]').first()).toContainText('다시 표시 1건');
  await expect(page.locator('[data-admin-version]').first()).toContainText('가격 변경 1건');
  await shoot(page, 'published');

  // 보장 판단·매핑 상태 불변: 치료 B 의 치료 버전 기록과 항목(매핑) 저장소는 한 글자도 안 바뀌었다. 바뀐 것은 카탈로그·병원 포인터·치료 기록(active)·치료 A 의 새 가격 버전·초안·감사 기록뿐이다.
  const stateAfter = await storeState(page.request);
  expect(changedKeys(statePublish, stateAfter)).toEqual(['auditLog', 'catalogDrafts', 'catalogVersions', 'clinics', 'treatmentVersions', 'treatments']);
  expect(entriesOf(stateAfter, 'treatmentVersions', (v) => v['treatmentId'] === T2)).toBe(entriesOf(statePublish, 'treatmentVersions', (v) => v['treatmentId'] === T2));
  for (const key of Object.keys(statePublish).filter((name) => !['auditLog', 'catalogDrafts', 'catalogVersions', 'clinics', 'treatmentVersions', 'treatments'].includes(name))) {
    expect(JSON.stringify(stateAfter[key]), key).toBe(JSON.stringify(statePublish[key]));
  }
  // 다른 병원은 그대로다.
  expect(await publicCatalog(page.request, OTHER_SLUG)).toEqual(otherCatalogBefore);
  expect(otherClinicTreatments(stateAfter)).toBe(otherTreatmentsBefore);
});

test('검토가 남은 치료(새로 추가한 치료 C)는 숨겼다 다시 표시해도 분류가 그대로이고 키오스크 계산은 계속 보류다', async ({ page, request, browser }) => {
  await adminReady(page);
  // 1) 새 치료 C 를 더해 게시한다(분류는 서버가 NEEDS_REVIEW 로 정한다).
  await fillNewTreatment(page);
  await button(page, '목록에 추가').click();
  await saveThenPreviewThenPublish(page);
  const idC = ((await publicCatalog(request))['treatments'] as Json[]).map((entry) => entry['treatmentId'] as string).find((id) => id !== T1 && id !== T2)!;
  expect(await publicNames(request)).toEqual([NAME_A, NAME_B, NAME_C]);
  const heldBefore = await kioskCalculate(browser, [/새로 추가/]);
  expect(heldBefore.state).toBe('ON_HOLD');

  // 2) 숨겨 게시한다.
  await button(page, `${NAME_C} 숨기기`).click();
  await saveThenPreviewThenPublish(page);
  expect(await publicNames(request)).toEqual([NAME_A, NAME_B]);
  await expect(hiddenRow(page, idC)).toBeVisible();

  // 3) 다시 표시 초안을 저장하고 미리보기에서 엔진의 보류 판단을 본다.
  const stateBeforeReshow = await storeState(request);
  await hiddenRow(page, idC).locator('[data-admin-reshow]').click();
  await expect(row(page, idC)).toHaveAttribute('data-reshown', 'true');
  expect(await rowKeys(page)).toEqual([T1, T2, idC]);
  await button(page, '초안 저장').click();
  await expect(page.locator('[data-admin-message="ok"]')).toContainText('초안을 저장했습니다');
  const preview = previewResponse(page);
  await button(page, '미리보기 계산').click();
  const previewBody = (await (await preview).json()) as Json;
  expect(previewBody['changes']['reactivated'][0]).toMatchObject({ treatmentId: idC, calculation: { state: 'ON_HOLD', lineState: 'ON_HOLD', holdReasons: ['CLASSIFICATION_NEEDS_REVIEW'] } });
  const held = page.locator(`[data-admin-reactivated="${idC}"]`);
  await expect(held).toContainText('계산 보류');
  await expect(held).toContainText('보장 분류가 아직 검토되지 않았습니다');
  await expect(held.locator('[data-admin-reactivated-state]')).toHaveAttribute('data-admin-reactivated-state', 'ON_HOLD');
  await shoot(page, 'preview-on-hold');

  // 4) 게시하면 다시 나타나지만 계산은 계속 보류이고 보험금이 없다.
  const published = publishResponse(page);
  await button(page, '게시').click();
  expect((await published).status()).toBe(200);
  await expect(page.locator('[data-admin-message="ok"]')).toContainText('게시했습니다');
  expect(await publicNames(request)).toEqual([NAME_A, NAME_B, NAME_C]);
  const heldAfter = await kioskCalculate(browser, [/새로 추가/], 'kiosk-calc-c-on-hold');
  expect(heldAfter.state).toBe('ON_HOLD');
  expect(heldAfter.payout).toBeNull();
  const live = await publicEstimate(request, [idC]);
  expect(live.body['result']['holdReasons']).toContainEqual({ treatmentId: idC, code: 'CLASSIFICATION_NEEDS_REVIEW' });
  expect(live.body['result']['amounts']['expectedInsurancePayout']).toBeNull();

  // 분류·매핑·승인 지문은 그대로: 치료 C 의 치료 버전과 항목 저장소는 다시 표시 전후가 같다.
  const stateAfterReshow = await storeState(request);
  expect(entriesOf(stateAfterReshow, 'treatmentVersions', (v) => v['treatmentId'] === idC)).toBe(entriesOf(stateBeforeReshow, 'treatmentVersions', (v) => v['treatmentId'] === idC));
  expect(JSON.stringify(stateAfterReshow['itemVersions'])).toBe(JSON.stringify(stateBeforeReshow['itemVersions']));
  expect(entriesOf(stateAfterReshow, 'treatmentVersions', (v) => v['treatmentId'] === idC)).toContain('NEEDS_REVIEW');
});

test('옛 카탈로그 버전 위의 다시 표시 초안은 409 로 게시되지 않는다: 미리보기를 본 뒤 카탈로그가 바뀌면 숨긴 상태 그대로이고 초안이 오래됨으로 보인다', async ({ page, request }) => {
  await adminReady(page);
  // 치료 B 를 다시 숨겨 게시한 뒤, 다시 표시 초안을 저장하고 미리보기를 본다.
  await button(page, `${NAME_B} 숨기기`).click();
  await saveThenPreviewThenPublish(page);
  await hiddenRow(page, T2).locator('[data-admin-reshow]').click();
  await button(page, '초안 저장').click();
  await expect(page.locator('[data-admin-message="ok"]')).toContainText('초안을 저장했습니다');
  const preview = previewResponse(page);
  await button(page, '미리보기 계산').click();
  expect((await preview).status()).toBe(200);
  await expect(button(page, '게시')).toBeEnabled();

  // 다른 곳에서 카탈로그가 바뀐다(시험 전용 끝점: 실제 게시 서비스로 기본비용 없는 카탈로그를 게시). 초안은 건드리지 않는다.
  expect((await request.post('/__harness/test/remove-base-fees')).status()).toBe(200);
  const before = await storeState(request);
  const published = publishResponse(page);
  await button(page, '게시').click();
  expect((await published).status()).toBe(409);
  await expect(page.locator('[data-admin-message="error"]')).toContainText('초안을 저장한 뒤 게시 카탈로그가 바뀌었습니다');
  await expect(page.locator('[data-admin-message="error"]')).toContainText('아무것도 게시되지 않았고 키오스크는 그대로입니다');
  await expect(page.locator('[data-admin-draft="stale"]')).toBeVisible();
  await expect(button(page, '게시')).toBeDisabled();
  // 거절된 게시는 아무것도 쓰지 않았다: 저장소 전체가 그대로이고 치료 B 는 숨긴 채다.
  expect(await storeState(request)).toEqual(before);
  expect(await publicNames(request)).not.toContain(NAME_B);
  expect(((await serverDraft(page.request)) as Json)['stale']).toBe(true);
  // 미리보기도 같은 이유로 거절한다(관리자 API 라서 로그인한 page.request 로 부른다).
  const again = await page.request.post(`${API}/catalog/preview`, { data: CONDITION });
  expect(again.status()).toBe(409);
  expect(await again.json()).toEqual({ error: 'CONFLICT', reason: 'DRAFT_STALE' });
  await shoot(page, 'stale-draft');
});
