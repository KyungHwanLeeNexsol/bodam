import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/test';

// 관리자 흐름 (SPEC-REIMBURSEMENT-001 M7 첫 기능): 기존 가격 확인 → 관리자 수정 → 초안 저장 → 키오스크의 기존 가격 유지 → 미리보기 → 게시 → 새 카탈로그와 계산 결과 반영.
// 앞단(tests/e2e/harness/server.ts, 이 파일 전용 인스턴스)이 관리자 핸들러·공개 핸들러를 시험 인증기와 시험 자료(TEST_FIXTURE)로 돌린다. 관리자 화면과 키오스크가 같은 저장소를 본다.
// 통신 가로채기는 쓰지 않는다: 모든 요청이 실제 HTTP 로 앞단을 지난다(시험 로그인은 앞단이 시험 계정으로 세션을 만드는 길이고 운영 구성에는 없다).
// 한 파일 안에서 순서대로 돈다: 게시가 같은 저장소의 가격을 바꾸므로 뒤 시험이 앞 시험의 결과를 이어받는다.

test.describe.configure({ mode: 'serial' });

const CLINIC_ID = 'TEST_FIXTURE_CLINIC_1';
const KIOSK = '/kiosk/test-fixture-clinic-1';
const T1 = 'TEST_FIXTURE_TREATMENT_1';
const SHOTS = path.resolve('.moai/state/shots/m7-admin');
const shoot = async (page: Page, name: string): Promise<void> => {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled', fullPage: true });
};

const row = (page: Page, treatmentId: string) => page.locator(`[data-admin-row="${treatmentId}"]`);
const priceInput = (page: Page, treatmentId: string) => row(page, treatmentId).locator('input');
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function login(page: Page, account: string): Promise<void> {
  await page.goto('/__harness/login');
  await page.locator(`[data-test-account="${account}"]`).click();
}

/** 키오스크에서 4세대 · 손해보험사 · 첫 원인 · 첫 치료 하나로 계산해 결과의 병원 결제액 글자를 돌려준다. */
async function kioskHospitalPayment(page: Page): Promise<string> {
  await page.goto(KIOSK);
  await page.getByRole('button', { name: '시작하기' }).click();
  await page.getByRole('radio', { name: '4세대(C4)' }).check();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByRole('radio', { name: '손해보험사' }).check();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: '예상 부담액 확인' }).click();
  await expect(page.locator('[data-result="normal"]')).toBeVisible();
  return (await page.locator('[data-kiosk-amount="hospital"] .kiosk-amount__value').innerText()).trim();
}

async function kioskCatalogPrices(page: Page): Promise<number[]> {
  const body = (await (await page.request.get('/api/clinics/test-fixture-clinic-1/catalog')).json()) as { catalogVersion: string; treatments: Array<{ patientAmount: number }> };
  return body.treatments.map((entry) => entry.patientAmount);
}

test('로그인 전: 가격 관리 화면은 안내만 보이고, 관리자 API 는 401 이다', async ({ page }) => {
  await page.goto(`/admin/${CLINIC_ID}/treatments`);
  await expect(page.locator('[data-admin-state="unauthenticated"]')).toBeVisible();
  await expect(page.getByRole('button')).toHaveCount(0);
  expect((await page.request.get(`/api/admin/clinics/${CLINIC_ID}/treatments`)).status()).toBe(401);
  await page.goto('/__harness/login');
  await expect(page.getByRole('heading', { name: '보담 관리자 시험 로그인' })).toBeVisible();
  await shoot(page, '1-login');
});

test('권한 없는 계정: 검토 담당자(RV)·플랫폼 운영자(PO)·다른 병원의 관리자는 이 병원의 가격 관리에서 거절(403)되고 아무것도 바뀌지 않는다', async ({ page }) => {
  const pricesBefore = await kioskCatalogPrices(page);
  for (const account of ['rv-1', 'po-1', 'ha-clinic-2']) {
    await login(page, account);
    await page.goto(`/admin/${CLINIC_ID}/treatments`);
    await expect(page.locator('[data-admin-state="forbidden"]')).toBeVisible();
    await expect(page.locator('[data-admin-state] .admin-banner--error')).toContainText('권한이 없습니다');
    await expect(page.locator('input')).toHaveCount(0);
    // API 도 같다: 쓰기 시도는 403 이고 키오스크 가격은 그대로다.
    const attempt = await page.request.put(`/api/admin/clinics/${CLINIC_ID}/catalog/draft`, { data: { priceEdits: [{ treatmentId: T1, patientAmount: 1 }] } });
    expect(attempt.status(), account).toBe(403);
    expect((await page.request.post(`/api/admin/clinics/${CLINIC_ID}/catalog/publish`, { data: { draftDigest: 'x' } })).status(), account).toBe(403);
  }
  expect(await kioskCatalogPrices(page)).toEqual(pricesBefore);
  // 로그아웃으로 세션을 없앤다.
  await page.request.post('/__harness/logout', { maxRedirects: 0 }).catch(() => undefined);
});

test('병원 1 관리자: 기존 가격 확인 → 수정 → 초안 저장 → 키오스크는 기존 가격 유지', async ({ page, browser }) => {
  await login(page, 'ha-clinic-1');
  await expect(page).toHaveURL(new RegExp(`/admin/${CLINIC_ID}/treatments$`));
  await expect(page.locator('[data-admin-state="ready"]')).toBeVisible();
  await expect(page.locator('[data-admin-clinic]')).toHaveText('TEST_FIXTURE 시험 의원');
  await expect(row(page, T1).locator('[data-admin-current]')).toHaveText('10,000원');
  await expect(row(page, 'TEST_FIXTURE_TREATMENT_2').locator('[data-admin-current]')).toHaveText('10,000원');
  await expect(page.locator('[data-admin-draft="none"]')).toBeVisible();
  const versionBefore = (await page.locator('[data-admin-catalog-version]').innerText()).trim();
  await expect(button(page, '초안 저장')).toBeDisabled();
  await expect(button(page, '게시')).toBeDisabled();
  await shoot(page, '2-prices-before');

  // 잘못된 입력은 화면에서 먼저 막는다(서버도 다시 막는다).
  await priceInput(page, T1).fill('abc');
  await expect(row(page, T1).getByRole('alert')).toContainText('0 이상의 정수');
  await expect(button(page, '초안 저장')).toBeDisabled();
  await priceInput(page, T1).fill('-5');
  await expect(button(page, '초안 저장')).toBeDisabled();

  await priceInput(page, T1).fill('12000');
  await expect(row(page, T1)).toHaveAttribute('data-changed', 'true');
  await expect(button(page, '초안 저장')).toBeEnabled();
  await button(page, '초안 저장').click();
  await expect(page.locator('[data-admin-message="ok"]')).toContainText('키오스크 가격은 아직 바뀌지 않았습니다');
  await expect(page.locator('[data-admin-draft="saved"]')).toBeVisible();
  // 저장했지만 게시 전: 게시 단추는 미리보기를 보기 전까지 비활성이다.
  await expect(button(page, '게시')).toBeDisabled();
  await shoot(page, '3-draft-saved');

  // 키오스크(다른 브라우저 창)는 기존 가격과 기존 카탈로그 버전이다.
  const kioskContext = await browser.newContext({ viewport: { width: 1080, height: 1920 }, locale: 'ko-KR' });
  const kiosk = await kioskContext.newPage();
  const catalog = (await (await kiosk.request.get('/api/clinics/test-fixture-clinic-1/catalog')).json()) as { catalogVersion: string; treatments: Array<{ patientAmount: number }> };
  expect(catalog.catalogVersion).toBe(versionBefore);
  expect(catalog.treatments.map((entry) => entry.patientAmount)).toEqual([10_000, 10_000]);
  expect(await kioskHospitalPayment(kiosk)).toBe('15,000원'); // 치료 10,000 + 공통 기본비용 5,000
  await kioskContext.close();

  // 화면을 새로 열어도 초안은 서버에 남아 있다(가격 입력이 초안 값으로 채워진다).
  await page.reload();
  await expect(priceInput(page, T1)).toHaveValue('12000');
  await expect(page.locator('[data-admin-draft="saved"]')).toBeVisible();
});

test('미리보기: 같은 엔진으로 현재와 초안 계산을 나란히 보이고, 미리보기 뒤에만 게시할 수 있다', async ({ page }) => {
  await login(page, 'ha-clinic-1');
  await expect(page.locator('[data-admin-draft="saved"]')).toBeVisible();
  await expect(button(page, '게시')).toBeDisabled();
  await expect(page.getByLabel('세대')).toBeVisible();
  await button(page, '미리보기 계산').click();
  const preview = page.locator('[data-admin-preview]');
  await expect(preview).toBeVisible();
  await expect(preview.locator(`[data-admin-change="${T1}"]`)).toContainText('10,000원 → 12,000원');
  await expect(preview.locator('[data-admin-compare="state"]')).toContainText('정상 계산');
  await expect(preview.locator('[data-admin-compare="hospital"]')).toContainText('15,000원');
  await expect(preview.locator('[data-admin-compare="hospital"]')).toContainText('17,000원');
  // 금액은 서버가 계산한 값이다. 0원으로 채우지 않고, 모르는 값은 "확인 필요"로 보인다.
  expect(await preview.innerText()).not.toMatch(/\b0원/);
  await expect(button(page, '게시')).toBeEnabled();
  await shoot(page, '4-preview');
  // 입력을 바꾸면 미리보기를 다시 봐야 한다(초안과 입력이 다르면 게시할 수 없다).
  await priceInput(page, T1).fill('13000');
  await expect(button(page, '게시')).toBeDisabled();
  await expect(button(page, '미리보기 계산')).toBeDisabled();
  await priceInput(page, T1).fill('12000');
  await expect(button(page, '미리보기 계산')).toBeEnabled();
});

test('게시: 새 카탈로그 버전이 만들어지고 키오스크의 가격과 계산 결과가 새 값으로 바뀐다', async ({ page, browser }) => {
  await login(page, 'ha-clinic-1');
  const versionBefore = (await page.locator('[data-admin-catalog-version]').innerText()).trim();
  await button(page, '미리보기 계산').click();
  await expect(page.locator('[data-admin-preview]')).toBeVisible();
  await button(page, '게시').click();
  await expect(page.locator('[data-admin-message="ok"]')).toContainText('게시했습니다');
  const versionAfter = (await page.locator('[data-admin-catalog-version]').innerText()).trim();
  expect(versionAfter).not.toBe(versionBefore);
  await expect(row(page, T1).locator('[data-admin-current]')).toHaveText('12,000원');
  await expect(page.locator('[data-admin-draft="none"]')).toBeVisible();
  await expect(page.locator(`[data-admin-version="${versionAfter}"][data-current="true"]`)).toBeVisible();
  await expect(page.locator(`[data-admin-version="${versionBefore}"][data-current="false"]`)).toBeVisible();
  await expect(page.locator(`[data-admin-version="${versionAfter}"]`)).toContainText('가격 변경 1건');
  await shoot(page, '5-published');

  const kioskContext = await browser.newContext({ viewport: { width: 1080, height: 1920 }, locale: 'ko-KR' });
  const kiosk = await kioskContext.newPage();
  const catalog = (await (await kiosk.request.get('/api/clinics/test-fixture-clinic-1/catalog')).json()) as { catalogVersion: string; treatments: Array<{ patientAmount: number }> };
  expect(catalog.catalogVersion).toBe(versionAfter);
  expect(catalog.treatments.map((entry) => entry.patientAmount)).toEqual([12_000, 10_000]);
  expect(await kioskHospitalPayment(kiosk)).toBe('17,000원'); // 치료 12,000 + 공통 기본비용 5,000: 미리보기가 보인 값과 같다
  await shoot(kiosk, '6-kiosk-after');
  await kioskContext.close();
});

test('게시 뒤에는 초안이 없고 같은 초안을 다시 게시할 수 없다 (409 DRAFT_ABSENT), 가격을 바꾸지 않은 저장은 거절된다', async ({ page }) => {
  await login(page, 'ha-clinic-1');
  const absent = await page.request.post(`/api/admin/clinics/${CLINIC_ID}/catalog/publish`, { data: { draftDigest: 'x' } });
  expect(absent.status()).toBe(409);
  expect(await absent.json()).toEqual({ error: 'CONFLICT', reason: 'DRAFT_ABSENT' });
  const noChange = await page.request.put(`/api/admin/clinics/${CLINIC_ID}/catalog/draft`, { data: { priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }] } });
  expect(noChange.status()).toBe(400);
  expect((await noChange.json()).defects).toContainEqual({ code: 'NO_PRICE_CHANGE', path: 'priceEdits' });
  // 다른 병원·치료 id, 잘못된 가격은 400 이고 저장되지 않는다.
  for (const body of [
    { priceEdits: [{ treatmentId: 'TEST_FIXTURE_OTHER_TREATMENT_1', patientAmount: 1_000 }] },
    { priceEdits: [{ treatmentId: T1, patientAmount: -1 }] },
    { priceEdits: [{ treatmentId: T1, patientAmount: 1_000.5 }] },
    { priceEdits: [{ treatmentId: T1, patientAmount: 1_000, benefitType: 'NON_BENEFIT' }] },
  ]) {
    expect((await page.request.put(`/api/admin/clinics/${CLINIC_ID}/catalog/draft`, { data: body })).status()).toBe(400);
  }
  await page.goto(`/admin/${CLINIC_ID}/treatments`);
  await expect(page.locator('[data-admin-draft="none"]')).toBeVisible();
});

test('초안 버리기: 저장한 초안을 버려도 키오스크 가격은 그대로다', async ({ page }) => {
  await login(page, 'ha-clinic-1');
  const pricesBefore = await kioskCatalogPrices(page);
  await priceInput(page, 'TEST_FIXTURE_TREATMENT_2').fill('9000');
  await button(page, '초안 저장').click();
  await expect(page.locator('[data-admin-draft="saved"]')).toBeVisible();
  expect(await kioskCatalogPrices(page)).toEqual(pricesBefore);
  await button(page, '초안 버리기').click();
  await expect(page.locator('[data-admin-message="ok"]')).toContainText('초안을 버렸습니다');
  await expect(page.locator('[data-admin-draft="none"]')).toBeVisible();
  await expect(priceInput(page, 'TEST_FIXTURE_TREATMENT_2')).toHaveValue('10000');
  expect(await kioskCatalogPrices(page)).toEqual(pricesBefore);
});
