import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { expect, test } from '../helpers/test';

// 공통 기본비용 금액 수정 흐름 (SPEC-REIMBURSEMENT-001 M7): 화면에서 기본비용 금액 수정 → 초안 저장 → 키오스크 계산 불변 → 미리보기 없이 게시 거절 → 미리보기(계산할 치료 선택) → 게시 → 새 기본비용이 병원 결제액에 반영.
// 앞단(tests/e2e/harness/server.ts, 이 파일 전용 인스턴스 ADMIN_BASE_FEE_PORT, --test-hooks)이 실제 관리자 핸들러·공개 핸들러를 시험 인증기와 시험 자료(TEST_FIXTURE)로 돌린다. 관리자 화면과 키오스크가 같은 저장소를 본다.
// 통신 가로채기는 쓰지 않는다: 모든 요청이 실제 HTTP 로 앞단을 지난다. 보장 판단 필드·매핑 상태는 시험 전용 끝점(/__harness/state)이 주는 저장소 사본으로 전후를 글자 그대로 비교한다.
// 한 파일 안에서 순서대로 돈다: 앞 시험의 초안·게시 결과를 뒤 시험이 이어받는다.
//   시험 3~7: 기본비용 5,000 → 7,000 (치료 A 로 계산: 병원 결제액 15,000 → 17,000)
//   시험 8  : 치료 A 가격 12,000 + 기본비용 7,000 → 8,000 + 치료 B 숨김 (치료 A 로 계산: 20,000)
//   시험 9  : 기본비용이 없는 병원
// 사진은 .moai/state/shots/m7-admin-base-fee/ 에 남는다(육안 검토용 자료이며 시험 결과가 아니다).

test.describe.configure({ mode: 'serial' });

const CLINIC_ID = 'TEST_FIXTURE_CLINIC_1';
const SLUG = 'test-fixture-clinic-1';
const OTHER_SLUG = 'test-fixture-clinic-2';
const KIOSK = `/kiosk/${SLUG}`;
const API = `/api/admin/clinics/${CLINIC_ID}`;
const FEE_ID = 'TEST_FIXTURE_BASE_FEE_A';
const OTHER_FEE_ID = 'TEST_FIXTURE_FEE_OTHER_1';
const T1 = 'TEST_FIXTURE_TREATMENT_1';
const T2 = 'TEST_FIXTURE_TREATMENT_2';
const NAME_A = /시험 치료 A/;
const NOT_ISSUED = 'a'.repeat(64);
const CONDITION = { generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN' };

const SHOTS = path.resolve('.moai/state/shots/m7-admin-base-fee');
let shotCount = 0;
const shoot = async (page: Page, name: string): Promise<void> => {
  mkdirSync(SHOTS, { recursive: true });
  shotCount += 1;
  await page.screenshot({ path: path.join(SHOTS, `${String(shotCount).padStart(2, '0')}-${name}.png`), animations: 'disabled', fullPage: true });
};

interface Json {
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const feeRow = (page: Page) => page.locator(`[data-admin-basefee="${FEE_ID}"]`);
const feeInput = (page: Page) => feeRow(page).locator('input');
const priceInput = (page: Page, treatmentId: string) => page.locator(`[data-admin-row="${treatmentId}"] input`);
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const pick = (page: Page, treatmentId: string) => page.locator(`[data-admin-pick="${treatmentId}"] input`);
const previewResponse = (page: Page) => page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/catalog/preview'));

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
const publicCatalog = async (request: APIRequestContext, slug = SLUG): Promise<Json> => (await (await request.get(`/api/clinics/${slug}/catalog`)).json()) as Json;
const adminList = async (request: APIRequestContext): Promise<Json> => (await request.get(`${API}/treatments`)).json() as Promise<Json>;

/** 서버가 알리는 지금의 공개 현재 버전으로 치료 하나(T1)를 계산한 병원 결제액. catalogVersion 을 주면 그 버전으로 보낸다(옛 버전 요청 시험). */
async function publicEstimate(request: APIRequestContext, treatmentIds: string[], catalogVersion?: string): Promise<{ status: number; body: Json }> {
  const catalog = await publicCatalog(request);
  const options = (await (await request.get(`/api/clinics/${SLUG}/insurance/options`)).json()) as Json;
  const response = await request.post(`/api/clinics/${SLUG}/estimate`, {
    data: { catalogVersion: catalogVersion ?? catalog['catalogVersion'], ruleBundleVersion: options['ruleBundleVersion'], ...CONDITION, treatmentIds },
  });
  return { status: response.status(), body: (await response.json()) as Json };
}

const hospitalOf = (outcome: { body: Json }): number => (outcome.body['result'] as Json)['amounts']['hospitalPayment'] as number;

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

/** 지금 공개 카탈로그가 알리는 공통 기본비용 금액(키오스크가 선택 요약에 합산하는 값). */
async function publicFeeAmount(request: APIRequestContext): Promise<unknown> {
  return ((await publicCatalog(request))['baseFees'] as Json[]).find((fee) => fee['baseFeeId'] === FEE_ID)?.['amount'];
}

/** 병원 1 이 아닌 병원의 공통 기본비용 기록(저장소 사본의 글자 그대로). */
const otherClinicFees = (state: Json): unknown[] => (state['baseFees'] as Array<[string, Json]>).filter(([, fee]) => fee['clinicId'] !== CLINIC_ID);

/** 키오스크에서 치료 A 하나를 골라 계산하고 병원 결제액(서버 응답)과 화면에 보이는 병원 결제액 글자, 그리고 치료 선택 화면의 총 예상 결제액(기본비용 합산) 글자를 돌려준다. */
async function kioskCalculateA(browser: Browser, shotName?: string): Promise<{ hospital: number; shown: string; summary: string }> {
  const context = await browser.newContext({ viewport: { width: 1080, height: 1920 }, locale: 'ko-KR' });
  const kiosk = await context.newPage();
  await kioskToTreatments(kiosk);
  await kiosk.getByRole('checkbox', { name: NAME_A }).check();
  const summaryTotal = kiosk.locator('.kiosk-summary__total');
  await expect(summaryTotal).not.toHaveClass(/--muted/); // 고른 치료가 있어 합계가 0 이 아닌 상태
  const summary = (await summaryTotal.innerText()).trim();
  const response = kiosk.waitForResponse((entry) => entry.url().endsWith('/estimate') && entry.request().method() === 'POST');
  await kiosk.getByRole('button', { name: '예상 부담액 확인' }).click();
  const body = (await (await response).json()) as { result: { state: string; amounts: { hospitalPayment: number } } };
  await expect(kiosk.locator('[data-result]')).toBeVisible();
  const shown = (await kiosk.locator('[data-kiosk-amount="hospital"] .kiosk-amount__value').innerText()).trim();
  expect(body.result.state).toBe('ESTIMATED');
  if (shotName !== undefined) await shoot(kiosk, shotName);
  await context.close();
  return { hospital: body.result.amounts.hospitalPayment, shown, summary };
}

test('세계를 새로 만든다 (이 파일의 시작 상태): 기본 세계의 병원 1 은 치료 둘과 기본비용 5,000원이다', async ({ request }) => {
  expect((await request.post('/__harness/reset')).status()).toBe(200);
  expect((await request.get(`${API}/treatments`)).status()).toBe(401); // 로그인 전 (아래 시험이 로그인한다)
  const estimate = await publicEstimate(request, [T1]);
  expect(estimate.status).toBe(200);
  expect(hospitalOf(estimate)).toBe(15_000);
});

test('로그인 전은 401, 권한 없는 계정(검토 담당자·플랫폼 운영자·다른 병원 관리자)은 기본비용 초안 저장이 403 이고 저장소는 그대로다', async ({ page }) => {
  expect((await page.request.put(`${API}/catalog/draft`, { data: { baseFeeEdits: [{ baseFeeId: FEE_ID, amount: 7_000 }] } })).status()).toBe(401);
  const before = await storeState(page.request);
  for (const account of ['rv-1', 'po-1', 'ha-clinic-2']) {
    await login(page, account);
    const attempt = await page.request.put(`${API}/catalog/draft`, { data: { baseFeeEdits: [{ baseFeeId: FEE_ID, amount: 7_000 }] } });
    expect(attempt.status(), account).toBe(403);
    expect((await page.request.post(`${API}/catalog/publish`, { data: { publishConfirmation: NOT_ISSUED } })).status(), account).toBe(403);
  }
  expect(await storeState(page.request)).toEqual(before);
  await page.request.post('/__harness/logout', { maxRedirects: 0 }).catch(() => undefined);
});

test('병원 1 관리자: 기본비용 표(현재 5,000원)를 보고, 잘못된 금액은 화면에서 먼저 막히며, 7,000원으로 고쳐 초안을 저장한다. 키오스크 계산은 그대로 15,000원이다', async ({ page, browser }) => {
  await adminReady(page);
  await expect(page.locator('[data-admin-basefee-section]')).toBeVisible();
  await expect(feeRow(page).locator('[data-admin-basefee-current]')).toHaveText('5,000원');
  await expect(page.locator('[data-admin-basefee-note]')).toContainText('금액만 바꿀 수 있고');
  await expect(button(page, '초안 저장')).toBeDisabled();
  await shoot(page, 'before');

  for (const bad of ['abc', '-5', '1.5', '']) {
    await feeInput(page).fill(bad);
    await expect(feeRow(page).getByRole('alert')).toContainText('0 이상의 정수');
    await expect(button(page, '초안 저장')).toBeDisabled();
  }
  await feeInput(page).fill('7000');
  await expect(feeRow(page)).toHaveAttribute('data-changed', 'true');
  await expect(page.locator('[data-admin-working-summary]')).toContainText('기본비용 변경 1건');
  await expect(button(page, '초안 저장')).toBeEnabled();
  await button(page, '초안 저장').click();
  await expect(page.locator('[data-admin-message="ok"]')).toContainText('키오스크 가격은 아직 바뀌지 않았습니다');
  await expect(page.locator('[data-admin-draft="saved"]')).toBeVisible();
  await shoot(page, 'draft-saved');

  // 서버가 저장한 초안에 기본비용 수정이 담겼고, 공개 카탈로그·계산·키오스크는 그대로다.
  const draft = (await adminList(page.request))['draft'] as Json;
  expect(draft['baseFeeEdits']).toEqual([{ baseFeeId: FEE_ID, amount: 7_000 }]);
  expect(hospitalOf(await publicEstimate(page.request, [T1]))).toBe(15_000);
  const kiosk = await kioskCalculateA(browser);
  expect(kiosk.hospital).toBe(15_000);
  expect(kiosk.shown).toBe('15,000원');
  // 초안만 저장했으므로 공개 카탈로그의 기본비용과 치료 선택 화면의 총 예상 결제액(치료 10,000 + 기본비용 5,000)도 그대로다.
  expect(await publicFeeAmount(page.request)).toBe(5_000);
  expect(kiosk.summary).toBe('15,000원');
  // 게시는 아직 막혀 있다.
  await expect(button(page, '게시')).toBeDisabled();
});

test('미리보기 없이는 게시할 수 없다: 화면 단추는 비활성이고, API 로 직접 게시해도(발급된 적 없는 값 · 저장 응답의 지문) 서버가 거절하며 저장소·공개 계산이 그대로다', async ({ page }) => {
  await adminReady(page);
  await expect(button(page, '게시')).toBeDisabled();
  const listed = (await (await page.request.get(`${API}/treatments`)).json()) as { draft: { draftDigest: string; baseFeeEdits: unknown[] } };
  expect(listed.draft.baseFeeEdits).toHaveLength(1);
  const before = await storeState(page.request);
  const notIssued = await page.request.post(`${API}/catalog/publish`, { data: { publishConfirmation: NOT_ISSUED } });
  expect(notIssued.status()).toBe(409);
  expect(await notIssued.json()).toEqual({ error: 'CONFLICT', reason: 'PREVIEW_REQUIRED' });
  const digest = await page.request.post(`${API}/catalog/publish`, { data: { publishConfirmation: listed.draft.draftDigest } });
  expect(digest.status()).toBe(409);
  expect((await page.request.post(`${API}/catalog/publish`, { data: { draftDigest: listed.draft.draftDigest } })).status()).toBe(400);
  expect(await storeState(page.request)).toEqual(before);
  expect(hospitalOf(await publicEstimate(page.request, [T1]))).toBe(15_000);
});

test('계산할 치료 없이는 미리보기가 안 된다: 화면은 단추를 막고 안내하며, API 는 400 BASE_FEE_PREVIEW_NEEDS_TREATMENT 이고 게시 확인값을 내지 않는다', async ({ page }) => {
  await adminReady(page);
  await expect(page.locator('[data-admin-draft="saved"]')).toBeVisible();
  await expect(button(page, '미리보기 계산')).toBeDisabled();
  await expect(page.locator('[data-admin-preview-needs-treatment]')).toContainText('계산할 치료를 하나 이상 골라 주세요');
  await shoot(page, 'preview-needs-treatment');

  const before = await storeState(page.request);
  const omitted = await page.request.post(`${API}/catalog/preview`, { data: CONDITION });
  expect(omitted.status()).toBe(400);
  const omittedBody = (await omitted.json()) as Json;
  expect(omittedBody['defects']).toContainEqual({ code: 'BASE_FEE_PREVIEW_NEEDS_TREATMENT', path: 'request.treatmentIds' });
  expect(JSON.stringify(omittedBody)).not.toContain('publishConfirmation');
  expect((await page.request.post(`${API}/catalog/preview`, { data: { ...CONDITION, treatmentIds: [] } })).status()).toBe(400);
  expect(await storeState(page.request)).toEqual(before);
});

test('치료 A 를 골라 미리보기를 보면 현재 게시본 15,000원과 초안 적용본 17,000원이 나란히 나오고 변경 내역에 기본비용이 나온다. 그 뒤 게시한다', async ({ page, browser }) => {
  await adminReady(page);
  await pick(page, T1).check();
  await expect(button(page, '미리보기 계산')).toBeEnabled();
  const [response] = await Promise.all([previewResponse(page), button(page, '미리보기 계산').click()]);
  expect(response.status()).toBe(200);
  const preview = (await response.json()) as Json;
  expect(preview['request'].treatmentIds).toEqual([T1]);
  expect(preview['changes'].baseFeeChanges).toEqual([{ baseFeeId: FEE_ID, displayName: expect.any(String), before: 5_000, after: 7_000 }]);

  await expect(page.locator(`[data-admin-basefee-change="${FEE_ID}"]`)).toContainText('5,000원 → 7,000원');
  await expect(page.locator('[data-admin-compare="hospital"]')).toContainText('15,000원');
  await expect(page.locator('[data-admin-compare="hospital"]')).toContainText('17,000원');
  await shoot(page, 'preview');

  // 미리보기는 읽기만 한다: 아직 키오스크는 15,000원이다.
  expect(hospitalOf(await publicEstimate(page.request, [T1]))).toBe(15_000);
  const itemsBefore = await storeState(page.request);
  const otherFeesBefore = otherClinicFees(itemsBefore);
  expect(otherFeesBefore.length).toBeGreaterThan(0); // 비교 대상이 비어 있으면 아래 "다른 병원 불변" 비교가 아무것도 보지 못한다
  expect(await publicFeeAmount(page.request)).toBe(5_000);
  const otherBefore = await publicCatalog(page.request, OTHER_SLUG);
  const versionBefore = (await publicCatalog(page.request))['catalogVersion'] as string;

  await expect(button(page, '게시')).toBeEnabled();
  await button(page, '게시').click();
  await expect(page.locator('[data-admin-message="ok"]')).toContainText('게시했습니다');
  await expect(feeRow(page).locator('[data-admin-basefee-current]')).toHaveText('7,000원');
  await expect(page.locator('[data-admin-draft="none"]')).toBeVisible();
  await expect(page.locator('[data-admin-version]').first()).toContainText('기본비용 변경');
  await shoot(page, 'published');

  // 새 기본비용이 공개 계산에 반영된다(서버 응답과 키오스크 화면 모두).
  const versionAfter = (await publicCatalog(page.request))['catalogVersion'] as string;
  expect(versionAfter).not.toBe(versionBefore);
  expect(hospitalOf(await publicEstimate(page.request, [T1]))).toBe(17_000);
  const kiosk = await kioskCalculateA(browser, 'kiosk-after');
  expect(kiosk.hospital).toBe(17_000);
  expect(kiosk.shown).toBe('17,000원');
  // 공개 카탈로그의 기본비용 금액과 치료 선택 화면의 총 예상 결제액(치료 10,000 + 기본비용 7,000)도 새 금액이다.
  expect(await publicFeeAmount(page.request)).toBe(7_000);
  expect(kiosk.summary).toBe('17,000원');

  // 보장 판단·매핑 상태는 그대로다: 항목 버전·항목 상태 기록이 전후 같다.
  const itemsAfter = await storeState(page.request);
  expect(itemsAfter['itemVersions']).toEqual(itemsBefore['itemVersions']);
  expect(itemsAfter['itemStates']).toEqual(itemsBefore['itemStates']);
  // 같은 baseFeeId 의 새 버전: 옛 버전 기록은 남고 보장 판단 필드는 같다.
  const fees = (itemsAfter['baseFees'] as Array<[string, Json]>).map(([, fee]) => fee).filter((fee) => fee['baseFeeId'] === FEE_ID);
  expect(fees).toHaveLength(2);
  expect(fees.map((fee) => fee['amount']).sort()).toEqual([5_000, 7_000]);
  expect(new Set(fees.map((fee) => `${String(fee['code'])}|${String(fee['benefitType'])}|${String(fee['displayName'])}`)).size).toBe(1);
  // 다른 병원은 그대로다: 공개 카탈로그와 그 병원의 기본비용 기록.
  expect(await publicCatalog(page.request, OTHER_SLUG)).toEqual(otherBefore);
  expect(otherClinicFees(itemsAfter)).toEqual(otherFeesBefore);
});

test('옛 카탈로그 버전을 든 계산 요청은 게시 뒤 409 이고, 다른 병원의 기본비용 id 로는 초안을 저장할 수 없다', async ({ page }) => {
  await adminReady(page);
  // 게시 직전의 카탈로그 버전은 변경 이력의 둘째 줄이다.
  const versions = ((await (await page.request.get(`${API}/catalog/versions`)).json()) as { versions: Array<{ id: string; current: boolean }> }).versions;
  const previous = versions.find((version) => !version.current)!;
  expect((await publicEstimate(page.request, [T1], previous.id)).status).toBe(409);
  expect((await publicEstimate(page.request, [T1])).status).toBe(200);

  const before = await storeState(page.request);
  const foreign = await page.request.put(`${API}/catalog/draft`, { data: { baseFeeEdits: [{ baseFeeId: OTHER_FEE_ID, amount: 1 }] } });
  expect(foreign.status()).toBe(400);
  expect(((await foreign.json()) as Json)['defects']).toContainEqual({ code: 'BASE_FEE_NOT_IN_CATALOG', path: 'baseFeeEdits[0].baseFeeId' });
  expect(await storeState(page.request)).toEqual(before);
});

test('치료 수정·숨김과 기본비용 수정이 한 초안으로 함께 저장되고, 화면을 다시 열어도 함께 복원되며, 함께 게시된다 (치료 A 로 계산: 12,000 + 8,000 = 20,000원)', async ({ page, browser }) => {
  await adminReady(page);
  await priceInput(page, T1).fill('12000');
  await feeInput(page).fill('8000');
  await page.locator(`[data-admin-row="${T2}"] [data-admin-hide]`).click(); // 치료 B 숨기기
  await expect(page.locator(`[data-admin-row="${T2}"]`)).toHaveAttribute('data-hidden', 'true');
  await expect(page.locator('[data-admin-working-summary]')).toContainText('가격 변경 1건');
  await expect(page.locator('[data-admin-working-summary]')).toContainText('기본비용 변경 1건');
  await expect(page.locator('[data-admin-working-summary]')).toContainText('숨김 1건');
  await button(page, '초안 저장').click();
  await expect(page.locator('[data-admin-message="ok"]')).toBeVisible();

  const draft = (await adminList(page.request))['draft'] as Json;
  expect(draft['priceEdits']).toEqual([{ treatmentId: T1, patientAmount: 12_000 }]);
  expect(draft['baseFeeEdits']).toEqual([{ baseFeeId: FEE_ID, amount: 8_000 }]);
  expect(draft['deactivations']).toEqual([T2]);

  // 화면을 다시 열어도 둘 다 복원된다.
  await page.reload();
  await expect(page.locator('[data-admin-state="ready"]')).toBeVisible();
  await expect(priceInput(page, T1)).toHaveValue('12000');
  await expect(feeInput(page)).toHaveValue('8000');
  await expect(page.locator(`[data-admin-row="${T2}"]`)).toHaveAttribute('data-hidden', 'true');
  await expect(button(page, '초안 저장')).toBeDisabled(); // 서버 초안과 같다
  // 가격을 바꾼 치료 A 는 계산에 고정으로 들어가므로 따로 고르지 않아도 미리보기가 된다.
  await expect(button(page, '미리보기 계산')).toBeEnabled();
  const [response] = await Promise.all([previewResponse(page), button(page, '미리보기 계산').click()]);
  const preview = (await response.json()) as Json;
  expect(preview['request'].treatmentIds).toEqual([T1]);
  expect(preview['after'].result.amounts.hospitalPayment).toBe(20_000);
  await shoot(page, 'combined-preview');
  await button(page, '게시').click();
  await expect(page.locator('[data-admin-message="ok"]')).toContainText('게시했습니다');

  expect(hospitalOf(await publicEstimate(page.request, [T1]))).toBe(20_000);
  const catalog = await publicCatalog(page.request);
  expect((catalog['treatments'] as Json[]).map((row) => [row['treatmentId'], row['patientAmount']])).toEqual([[T1, 12_000]]);
  const kiosk = await kioskCalculateA(browser);
  expect(kiosk.hospital).toBe(20_000);
  expect(kiosk.shown).toBe('20,000원');
  expect(await publicFeeAmount(page.request)).toBe(8_000);
  expect(kiosk.summary).toBe('20,000원'); // 치료 12,000 + 기본비용 8,000
});

test('감사 기록: 초안 저장·게시가 각각 남고, 기본비용 수정이 든 게시는 CATALOG_DRAFT_PUBLISH 로 기록된다', async ({ request }) => {
  const audit = (await (await request.get('/__harness/audit')).json()) as { entries: Array<{ action: string }> };
  const actions = audit.entries.map((entry) => entry.action);
  expect(actions.filter((action) => action === 'CATALOG_DRAFT_PUBLISH')).toHaveLength(2);
  // 초안 저장은 두 흐름(기본비용만 · 치료와 함께)에서 한 번씩이다. 거절된 시도는 감사 기록을 남기지 않는다.
  expect(actions.filter((action) => action === 'CATALOG_DRAFT_SAVE')).toHaveLength(2);
});

test('기본비용이 없는 병원: 화면은 "등록된 항목이 없다"고 보이고, 기본비용 수정 저장은 400 이다. 치료 가격 수정은 그대로 된다', async ({ page }) => {
  expect((await page.request.post('/__harness/test/remove-base-fees')).status()).toBe(200);
  await adminReady(page);
  await expect(page.locator('[data-admin-basefee-none]')).toContainText('등록된 공통 기본비용이 없습니다');
  await expect(page.locator('[data-admin-basefee-list]')).toHaveCount(0);
  await shoot(page, 'no-base-fee');

  const before = await storeState(page.request);
  const attempt = await page.request.put(`${API}/catalog/draft`, { data: { baseFeeEdits: [{ baseFeeId: FEE_ID, amount: 1 }] } });
  expect(attempt.status()).toBe(400);
  expect(((await attempt.json()) as Json)['defects']).toContainEqual({ code: 'BASE_FEE_NOT_IN_CATALOG', path: 'baseFeeEdits[0].baseFeeId' });
  expect(await storeState(page.request)).toEqual(before);

  await priceInput(page, T1).fill('13000');
  await button(page, '초안 저장').click();
  await expect(page.locator('[data-admin-message="ok"]')).toBeVisible();
  expect(((await adminList(page.request))['draft'] as Json)['baseFeeEdits']).toEqual([]);
});
