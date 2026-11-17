import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { expect, test } from '../helpers/test';

// 관리자 구조 편집 흐름 (SPEC-REIMBURSEMENT-001 M7): 새 치료 추가 · 숨김 · 표시 순서를 초안 저장 → 미리보기 → 게시로 키오스크에 반영한다.
// 앞단(tests/e2e/harness/server.ts, 이 파일 전용 인스턴스 ADMIN_CATALOG_PORT)이 실제 관리자 핸들러·공개 핸들러를 시험 인증기와 시험 자료(TEST_FIXTURE)로 돌린다. 관리자 화면과 키오스크가 같은 저장소를 본다.
// 통신 가로채기는 쓰지 않는다: 모든 요청이 실제 HTTP 로 앞단을 지난다. 이 파일은 가격 흐름 시험(price-flow.admin.spec.ts)과 저장소를 나눠 쓰므로 순서에 상관없이 돈다.
// 한 파일 안에서 순서대로 돈다: 앞 시험의 초안·게시 결과를 뒤 시험이 이어받는다.
//   초안 1 = 새 치료 C 추가 + 치료 B 숨김 + 치료 A 가격 10,000 → 11,000 + 표시 순서 [C, A]   (시험 2~8)
//   초안 2 = 순서만 바꾸기 (게시된 목록 [C, A] → [A, C])                                       (시험 9)
// 시험 자료의 이름은 TEST_FIXTURE 로 시작하는 가짜 값이다. 사진은 .moai/state/shots/m7-admin-catalog/ 에 남는다(육안 검토용 자료이며 시험 결과가 아니다).

test.describe.configure({ mode: 'serial' });

const CLINIC_ID = 'TEST_FIXTURE_CLINIC_1';
const SLUG = 'test-fixture-clinic-1';
const KIOSK = `/kiosk/${SLUG}`;
const API = `/api/admin/clinics/${CLINIC_ID}`;
const T1 = 'TEST_FIXTURE_TREATMENT_1';
const T2 = 'TEST_FIXTURE_TREATMENT_2';
const NAME_A = 'TEST_FIXTURE 시험 치료 A (급여)';
const NAME_B = 'TEST_FIXTURE 시험 치료 B (비급여)';
const NAME_C = 'TEST_FIXTURE 시험 치료 C (새로 추가)';
const NEW_KEY = 'new-1';
const NOT_ISSUED = 'a'.repeat(64);
const CONDITION = { generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'UNKNOWN' };

const SHOTS = path.resolve('.moai/state/shots/m7-admin-catalog');
let shotCount = 0;
const shoot = async (page: Page, name: string): Promise<void> => {
  mkdirSync(SHOTS, { recursive: true });
  shotCount += 1;
  await page.screenshot({ path: path.join(SHOTS, `${String(shotCount).padStart(2, '0')}-${name}.png`), animations: 'disabled', fullPage: true });
};

interface Json {
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}
interface CatalogJson {
  catalogVersion: string;
  treatments: Array<{ treatmentId: string; displayName: string; patientAmount: number; order: number; benefitType: string }>;
}

const row = (page: Page, key: string) => page.locator(`[data-admin-row="${key}"]`);
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const pick = (page: Page, treatmentId: string) => page.locator(`[data-admin-pick="${treatmentId}"] input`);
const rowKeys = async (page: Page): Promise<string[]> => page.locator('[data-admin-list="working"] [data-admin-row]').evaluateAll((rows) => rows.map((entry) => entry.getAttribute('data-admin-row') ?? ''));
const previewRequest = (page: Page) => page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/catalog/preview'));
const previewResponse = (page: Page) => page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/catalog/preview'));

async function login(page: Page, account: string): Promise<void> {
  await page.goto('/__harness/login');
  await page.locator(`[data-test-account="${account}"]`).click();
  // 플랫폼 단위 검토 담당자(rv-1)는 병원 가격 관리가 아니라 검토 대기열로 들어간다(시험 앞단의 로그인 이동). 나머지 계정은 소속 병원의 가격 관리다.
  await expect(page).toHaveURL(/\/admin\/(?:[^/]+\/treatments|review-queue|rule-scope)$/);
}

async function adminReady(page: Page): Promise<void> {
  await login(page, 'ha-clinic-1');
  await expect(page.locator('[data-admin-state="ready"]')).toBeVisible();
}

const publicCatalog = async (request: APIRequestContext): Promise<CatalogJson> => (await (await request.get(`/api/clinics/${SLUG}/catalog`)).json()) as CatalogJson;
const publicOptions = async (request: APIRequestContext): Promise<Json> => (await request.get(`/api/clinics/${SLUG}/insurance/options`)).json() as Promise<Json>;
const adminList = async (request: APIRequestContext): Promise<Json> => (await request.get(`${API}/treatments`)).json() as Promise<Json>;
const serverDraft = async (request: APIRequestContext): Promise<Json | null> => ((await adminList(request)).draft ?? null) as Json | null;
const names = (catalog: CatalogJson): string[] => catalog.treatments.map((entry) => entry.displayName);

/** 서버가 저장해 둔 초안을 PUT 본문 모양으로(내용은 그대로, 새 저장 한 번). */
const bodyOf = (draft: Json): Json => ({ priceEdits: draft['priceEdits'], additions: draft['additions'], deactivations: draft['deactivations'], order: draft['order'] });

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

/** 치료 선택 화면에 보이는 치료 이름들(보이는 순서). 접근 가능한 이름 대신 라벨 글자를 읽는다. */
async function kioskNames(page: Page): Promise<string[]> {
  return page.getByRole('checkbox').evaluateAll((boxes) =>
    boxes.map((box) => {
      const labelled = (box.getAttribute('aria-labelledby') ?? '')
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ');
      return (box.getAttribute('aria-label') ?? (labelled.trim() !== '' ? labelled : (box.closest('label')?.textContent ?? ''))).replace(/\s+/g, ' ').trim();
    }),
  );
}

/** 키오스크 새 창에서 치료 이름 목록을 읽는다. */
async function kioskList(browser: Browser, shotName?: string): Promise<string[]> {
  const context = await browser.newContext({ viewport: { width: 1080, height: 1920 }, locale: 'ko-KR' });
  const kiosk = await context.newPage();
  await kioskToTreatments(kiosk);
  const listed = await kioskNames(kiosk);
  if (shotName !== undefined) await shoot(kiosk, shotName);
  await context.close();
  return listed;
}

interface KioskOutcome {
  kind: string | null;
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
    kind: await kiosk.locator('[data-result]').getAttribute('data-result'),
    state: body.result.state,
    hospital: body.result.amounts.hospitalPayment,
    payout: body.result.amounts.expectedInsurancePayout,
    payoutKnown: await kiosk.locator('[data-kiosk-amount="payout"]').getAttribute('data-known'),
  };
  if (shotName !== undefined) await shoot(kiosk, shotName);
  await context.close();
  return outcome;
}

/** 새 치료 입력칸을 채운다 (모든 칸이 올바른 값). */
async function fillNewTreatment(page: Page): Promise<void> {
  await page.getByLabel('이름', { exact: true }).fill(NAME_C);
  await page.getByLabel('설명 (선택)', { exact: true }).fill('TEST_FIXTURE 새 치료 설명');
  await page.getByRole('combobox', { name: '급여 구분' }).selectOption('NON_BENEFIT');
  await page.getByLabel('가격 (원)', { exact: true }).fill('8000');
  await page.getByLabel('치료 코드', { exact: true }).fill('TEST_FIXTURE_NEW_TC');
  await page.getByLabel('행위 코드 (쉼표로 구분, 비워도 됨)', { exact: true }).fill('TEST_FIXTURE_NEW_PROC_A, TEST_FIXTURE_NEW_PROC_B');
  await page.getByLabel('조직 검사 포함', { exact: true }).check();
  await page.getByLabel('환자 유형', { exact: true }).fill('TEST_FIXTURE_PATIENT');
  await page.getByLabel('가정', { exact: true }).fill('TEST_FIXTURE_ASSUMPTION');
  await page.getByLabel('기준일 (YYYY-MM-DD)', { exact: true }).fill('2026-11-01');
  await page.getByLabel('적용일 (YYYY-MM-DD)', { exact: true }).fill('2026-11-01');
}

const positionOf = (page: Page, key: string) => row(page, key).locator('[data-admin-position]');

/** 초안 1 을 화면에서 만든다: 새 치료 C 추가 → 치료 B 숨기기 → C 를 A 위로 → A 가격 11,000. 저장은 하지 않는다. */
async function composeDraftOne(page: Page): Promise<void> {
  await fillNewTreatment(page);
  await button(page, '목록에 추가').click();
  await expect(row(page, NEW_KEY)).toBeVisible();
  await button(page, `${NAME_B} 숨기기`).click();
  await button(page, `${NAME_C} 위로 이동`).click();
  await row(page, T1).locator('input').fill('11000');
}

test('사전 상태: 키오스크 목록은 치료 A, B 순서이고 관리자 화면도 같은 목록을 보인다', async ({ page, browser }) => {
  rmSync(SHOTS, { recursive: true, force: true });
  const catalog = await publicCatalog(page.request);
  expect(names(catalog)).toEqual([NAME_A, NAME_B]);
  expect(catalog.treatments.map((entry) => [entry.treatmentId, entry.patientAmount, entry.order])).toEqual([[T1, 10_000, 1], [T2, 10_000, 2]]);
  expect(await kioskList(browser, 'kiosk-before')).toEqual([expect.stringContaining('시험 치료 A (급여)'), expect.stringContaining('시험 치료 B (비급여)')]);

  await adminReady(page);
  expect(await rowKeys(page)).toEqual([T1, T2]);
  await expect(positionOf(page, T1)).toHaveText('1');
  await expect(positionOf(page, T2)).toHaveText('2');
  await expect(row(page, T1)).toContainText(NAME_A);
  await expect(row(page, T2)).toContainText(NAME_B);
  await expect(row(page, T1).locator('[data-admin-badge="none"]')).toHaveText('변경 없음');
  // 양 끝 줄은 더 못 움직인다: 첫 줄은 위로, 마지막 줄은 아래로 단추가 꺼진다.
  await expect(button(page, `${NAME_A} 위로 이동`)).toBeDisabled();
  await expect(button(page, `${NAME_A} 아래로 이동`)).toBeEnabled();
  await expect(button(page, `${NAME_B} 아래로 이동`)).toBeDisabled();
  await expect(button(page, `${NAME_B} 위로 이동`)).toBeEnabled();
  await expect(button(page, '초안 저장')).toBeDisabled();
  await expect(button(page, '게시')).toBeDisabled();
  await expect(page.locator('[data-admin-add-note]')).toContainText("새 치료는 보장 검토 전까지 보험금이 계산되지 않고 '계산 보류'로 나옵니다");
  await shoot(page, 'admin-before');
  // 숨기기는 게시한 뒤에는 "숨긴 치료" 영역에서 다시 표시할 수 있다는 안내가 목록 위에 있다.
  await expect(page.locator('.admin-note').first()).toContainText('숨긴 치료는 게시한 뒤에 아래 "숨긴 치료"에서 다시 표시할 수 있습니다');

  // 모든 치료를 숨기는 초안은 서버가 거절한다(최소 한 개는 남아야 한다): 저장은 되지 않고, 이유가 보이며, 입력은 화면에 남고, 공개 목록은 그대로다.
  const catalogBefore = await publicCatalog(page.request);
  await button(page, `${NAME_A} 숨기기`).click();
  await button(page, `${NAME_B} 숨기기`).click();
  await expect(row(page, T1)).toHaveAttribute('data-hidden', 'true');
  await expect(row(page, T2)).toHaveAttribute('data-hidden', 'true');
  await button(page, '초안 저장').click();
  const banner = page.locator('[data-admin-message="error"]');
  await expect(banner).toContainText('모든 치료를 숨길 수는 없습니다. 최소 한 개는 게시된 채로 남아야 합니다.');
  await expect(banner).toContainText('초안은 바뀌지 않았고');
  expect(await banner.innerText()).not.toContain('NO_TREATMENT_REMAINS');
  await expect(row(page, T1)).toHaveAttribute('data-hidden', 'true');
  await expect(page.locator('[data-admin-draft="none"]')).toBeVisible();
  expect(await serverDraft(page.request)).toBeNull();
  expect(await publicCatalog(page.request)).toEqual(catalogBefore);
  await shoot(page, 'hide-all-rejected');
});

test('화면에서 새 치료 추가 · 숨기기 · 순서 · 가격을 고쳐 초안으로 저장한다: 저장만으로는 키오스크도 공개 자료도 바뀌지 않는다', async ({ page, browser }) => {
  const catalogBefore = await publicCatalog(page.request);
  const optionsBefore = await publicOptions(page.request);

  await adminReady(page);

  // 입력칸 검사는 화면에서 먼저 한다: 비워 두거나 틀린 칸이 있으면 목록에 더해지지 않고 칸마다 이유가 보인다. 서버로 가는 요청도 없다.
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') writes.push(`${request.method()} ${request.url()}`);
  });
  await button(page, '목록에 추가').click();
  await expect(page.getByRole('alert').filter({ hasText: '비워 둘 수 없습니다' })).toHaveCount(4);
  await expect(page.getByRole('alert').filter({ hasText: '정수(원)만' })).toHaveCount(1);
  await expect(page.getByRole('alert').filter({ hasText: 'YYYY-MM-DD' })).toHaveCount(2);
  expect(await rowKeys(page)).toEqual([T1, T2]);
  await page.getByLabel('이름', { exact: true }).fill(NAME_C);
  await page.getByLabel('적용일 (YYYY-MM-DD)', { exact: true }).fill('2026-02-30');
  await button(page, '목록에 추가').click();
  await expect(page.getByLabel('적용일 (YYYY-MM-DD)', { exact: true }).locator('xpath=ancestor::div[1]').getByRole('alert')).toContainText('달력에 있는 날짜');
  expect(writes).toEqual([]);

  // 올바른 값으로 더한다: 새 치료는 목록 맨 아래에 "새 치료" 표시와 함께 놓이고 아직 저장 전이다.
  await fillNewTreatment(page);
  await button(page, '목록에 추가').click();
  await expect(page.locator('[data-admin-add-status="ok"]')).toContainText('아직 저장 전입니다');
  expect(await rowKeys(page)).toEqual([T1, T2, NEW_KEY]);
  await expect(row(page, NEW_KEY).locator('[data-admin-badge="new"]')).toHaveText('새 치료');
  await expect(row(page, NEW_KEY).locator('[data-admin-new-price]')).toHaveText('8,000원');
  await expect(positionOf(page, NEW_KEY)).toHaveText('3');
  await expect(page.getByLabel('이름', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('조직 검사 포함', { exact: true })).not.toBeChecked();

  // 치료 B 숨기기: 취소선·"숨김 예정" 글자로 표시되고 가격 칸이 잠기며 순서 단추도 꺼진다. 뒤 줄의 번호가 당겨진다.
  await button(page, `${NAME_B} 숨기기`).click();
  await expect(row(page, T2)).toHaveAttribute('data-hidden', 'true');
  await expect(row(page, T2).locator('[data-admin-badge="hidden"]')).toHaveText('숨김 예정');
  await expect(row(page, T2).locator('input')).toBeDisabled();
  await expect(button(page, `${NAME_B} 위로 이동`)).toBeDisabled();
  await expect(button(page, `${NAME_B} 아래로 이동`)).toBeDisabled();
  await expect(button(page, `${NAME_B} 숨김 취소`)).toBeVisible();
  await expect(positionOf(page, T2)).toHaveText('-');
  await expect(positionOf(page, NEW_KEY)).toHaveText('2');
  expect(await row(page, T2).locator('.admin-name').evaluate((element) => getComputedStyle(element).textDecorationLine)).toBe('line-through');

  // 순서 옮기기는 키보드로도 된다: 단추에 초점을 두고 Enter.
  const moveUp = button(page, `${NAME_C} 위로 이동`);
  await moveUp.focus();
  await page.keyboard.press('Enter');
  expect(await rowKeys(page)).toEqual([NEW_KEY, T1, T2]);
  await expect(positionOf(page, NEW_KEY)).toHaveText('1');
  await expect(positionOf(page, T1)).toHaveText('2');
  await expect(moveUp).toBeDisabled();

  await row(page, T1).locator('input').fill('11000');
  await expect(row(page, T1).locator('[data-admin-badge="changed"]')).toHaveText('변경');
  await expect(page.locator('[data-admin-working-summary]')).toHaveText('화면에서 고친 내용: 가격 변경 1건 · 추가 1건 · 숨김 1건 · 순서 변경');
  await expect(button(page, '초안 저장')).toBeEnabled();
  await shoot(page, 'admin-edited');

  await button(page, '초안 저장').click();
  await expect(page.locator('[data-admin-message="ok"]')).toContainText('키오스크 가격은 아직 바뀌지 않았습니다');
  await expect(page.locator('[data-admin-draft="saved"]')).toBeVisible();
  // 저장한 내용과 화면이 구조까지 같으면 다시 저장할 수 없다(새 치료·숨김·순서까지 비교한다). 미리보기는 열린다.
  await expect(button(page, '초안 저장')).toBeDisabled();
  await expect(button(page, '미리보기 계산')).toBeEnabled();
  await expect(button(page, '게시')).toBeDisabled();
  await shoot(page, 'admin-draft-saved');

  // 서버에 저장된 초안: 새 치료는 표시 필드 열 가지뿐이고 분류·출처·치료 id 는 없다(서버가 게시 때 정한다).
  const draft = (await serverDraft(page.request)) as Json;
  expect(draft['priceEdits']).toEqual([{ treatmentId: T1, patientAmount: 11_000 }]);
  expect(draft['deactivations']).toEqual([T2]);
  expect(draft['order']).toEqual([NEW_KEY, T1]);
  expect(draft['additions']).toHaveLength(1);
  expect(draft['additions'][0]).toEqual({
    draftKey: NEW_KEY,
    displayName: NAME_C,
    description: 'TEST_FIXTURE 새 치료 설명',
    benefitType: 'NON_BENEFIT',
    patientAmount: 8_000,
    treatmentCode: 'TEST_FIXTURE_NEW_TC',
    procedureCodes: ['TEST_FIXTURE_NEW_PROC_A', 'TEST_FIXTURE_NEW_PROC_B'],
    documentFlags: { imaging: false, biopsy: true, opinionRequired: false },
    amountCondition: { patientType: 'TEST_FIXTURE_PATIENT', assumption: 'TEST_FIXTURE_ASSUMPTION', referenceDate: '2026-11-01' },
    effectiveDate: '2026-11-01',
  });
  expect(writes.filter((entry) => !entry.includes('/catalog/draft'))).toEqual([]);

  // 화면을 새로 열어도 같은 모습으로 복원된다.
  await page.reload();
  await expect(page.locator('[data-admin-state="ready"]')).toBeVisible();
  expect(await rowKeys(page)).toEqual([NEW_KEY, T1, T2]);
  await expect(row(page, T2)).toHaveAttribute('data-hidden', 'true');
  await expect(row(page, T1).locator('input')).toHaveValue('11000');
  await expect(positionOf(page, NEW_KEY)).toHaveText('1');
  await expect(positionOf(page, T1)).toHaveText('2');
  await expect(page.locator('[data-admin-draft="saved"]')).toBeVisible();
  await expect(button(page, '초안 저장')).toBeDisabled();
  await shoot(page, 'admin-after-reload');

  // 공개 자료(카탈로그·선택지 JSON)와 키오스크 화면은 저장 전과 완전히 같다.
  expect(await publicCatalog(page.request)).toEqual(catalogBefore);
  expect(await publicOptions(page.request)).toEqual(optionsBefore);
  expect(await kioskList(browser, 'kiosk-after-save')).toEqual([expect.stringContaining('시험 치료 A (급여)'), expect.stringContaining('시험 치료 B (비급여)')]);
});

test('화면을 거치지 않고 API 로 직접 게시하려 해도 미리보기 확인값이 없으면 서버가 거절한다: 공개 자료와 초안은 그대로다', async ({ page }) => {
  await adminReady(page);
  const catalogBefore = await publicCatalog(page.request);
  const draftBefore = await serverDraft(page.request);
  expect(draftBefore).not.toBeNull();

  const wrong = await page.request.post(`${API}/catalog/publish`, { data: { publishConfirmation: NOT_ISSUED } });
  expect(wrong.status()).toBe(409);
  expect(await wrong.json()).toEqual({ error: 'CONFLICT', reason: 'PREVIEW_REQUIRED' });
  // 목록 응답에 실린 초안 지문은 게시 권한이 아니다(상태 비교용 표지일 뿐).
  const digest = (draftBefore as Json)['draftDigest'] as string;
  const withDigest = await page.request.post(`${API}/catalog/publish`, { data: { publishConfirmation: digest } });
  expect(withDigest.status()).toBe(409);
  expect(await withDigest.json()).toEqual({ error: 'CONFLICT', reason: 'PREVIEW_REQUIRED' });
  expect((await page.request.post(`${API}/catalog/publish`, { data: { draftDigest: digest } })).status()).toBe(400);
  expect((await page.request.post(`${API}/catalog/publish`, { data: {} })).status()).toBe(400);

  expect(await publicCatalog(page.request)).toEqual(catalogBefore);
  expect(await serverDraft(page.request)).toEqual(draftBefore);
});

test('접근 거절: 검토 담당자(RV)·플랫폼 운영자(PO)·다른 병원 관리자는 403, 로그인하지 않으면 401 이고 초안과 공개 자료는 그대로다', async ({ page, browser }) => {
  await adminReady(page);
  const catalogBefore = await publicCatalog(page.request);
  const draftBefore = await serverDraft(page.request);
  expect(draftBefore).not.toBeNull();
  const attempts: Array<[string, string, unknown?]> = [
    ['PUT', `${API}/catalog/draft`, { priceEdits: [{ treatmentId: T1, patientAmount: 1 }], deactivations: [T1], additions: [], order: null }],
    ['POST', `${API}/catalog/preview`, CONDITION],
    ['POST', `${API}/catalog/publish`, { publishConfirmation: NOT_ISSUED }],
    ['DELETE', `${API}/catalog/draft`],
    ['GET', `${API}/treatments`],
  ];

  for (const account of ['rv-1', 'po-1', 'ha-clinic-2']) {
    await login(page, account);
    for (const [method, url, data] of attempts) {
      const response = await page.request.fetch(url, { method, ...(data === undefined ? {} : { data }) });
      expect(response.status(), `${account} ${method} ${url}`).toBe(403);
      expect(await response.json()).toEqual({ error: 'FORBIDDEN' });
    }
    await page.goto(`/admin/${CLINIC_ID}/treatments`);
    await expect(page.locator('[data-admin-state="forbidden"]')).toBeVisible();
    await expect(page.locator('input')).toHaveCount(0);
    await expect(page.getByRole('button')).toHaveCount(0);
    if (account === 'rv-1') await shoot(page, 'forbidden');
  }

  const anonymous = await browser.newContext();
  for (const [method, url, data] of attempts) {
    const response = await anonymous.request.fetch(url, { method, ...(data === undefined ? {} : { data }) });
    expect(response.status(), `anonymous ${method} ${url}`).toBe(401);
    expect(await response.json()).toEqual({ error: 'UNAUTHENTICATED' });
  }
  const anonymousPage = await anonymous.newPage();
  await anonymousPage.goto(`/admin/${CLINIC_ID}/treatments`);
  await expect(anonymousPage.locator('[data-admin-state="unauthenticated"]')).toBeVisible();
  await expect(anonymousPage.getByRole('button')).toHaveCount(0);
  await anonymous.close();

  // 관리자로 돌아와 보면 거절된 시도가 아무것도 바꾸지 않았다.
  await login(page, 'ha-clinic-1');
  expect(await serverDraft(page.request)).toEqual(draftBefore);
  expect(await publicCatalog(page.request)).toEqual(catalogBefore);
});

test('미리보기: 추가·숨김·가격을 변경 내역과 목록으로 보이고, 새 치료는 계산 보류이며 보험금 숫자가 없다. 숨길 치료는 계산 대상으로 고를 수 없다', async ({ page }) => {
  await adminReady(page);
  // 계산할 치료: 가격을 바꾼 A 는 고정, 숨길 B 는 제안조차 되지 않는다. 새 치료는 아직 치료가 아니라 고를 수 없다.
  await expect(pick(page, T1)).toBeChecked();
  await expect(pick(page, T1)).toBeDisabled();
  await expect(page.locator(`[data-admin-pick="${T1}"]`)).toContainText('가격 변경 · 항상 포함');
  await expect(page.locator(`[data-admin-pick="${T2}"]`)).toHaveCount(0);
  await expect(page.locator('[data-admin-pick]')).toHaveCount(1);

  const [request, response] = await Promise.all([previewRequest(page), previewResponse(page), button(page, '미리보기 계산').click()]);
  expect((request.postDataJSON() as Json)['treatmentIds']).toEqual([T1]);
  const body = (await response.json()) as Json;
  expect(body['before']).not.toBeNull();
  expect(body['changes'].added[0].calculation).toEqual({ state: 'ON_HOLD', lineState: 'ON_HOLD', holdReasons: ['CLASSIFICATION_NEEDS_REVIEW'] });
  expect(JSON.stringify(body['changes'].added)).not.toMatch(/ayout|OutOfPocket|amounts/);

  const preview = page.locator('[data-admin-preview]');
  await expect(preview).toBeVisible();
  await expect(preview.locator(`[data-admin-change="${T1}"]`)).toContainText('10,000원 → 11,000원');
  const added = preview.locator(`[data-admin-added="${NEW_KEY}"]`);
  await expect(added).toContainText(NAME_C);
  await expect(added).toContainText('비급여');
  const addedState = added.locator('[data-admin-added-state]');
  await expect(addedState).toContainText('계산 보류');
  await expect(addedState).toContainText('보장 분류가 아직 검토되지 않았습니다');
  await expect(addedState).toContainText('예상 보험금: 확인 필요');
  // 새 치료의 계산 줄에는 숫자가 한 글자도 없다(보험금을 보이지 않는다).
  expect(await addedState.innerText()).not.toMatch(/\d/);
  await expect(preview.locator(`[data-admin-deactivated="${T2}"]`)).toContainText(NAME_B);
  await expect(preview.locator(`[data-admin-deactivated="${T2}"]`)).toContainText('키오스크 목록에서 빠집니다. 숨긴 치료는 게시한 뒤 "숨긴 치료"에서 다시 표시할 수 있습니다');
  // 남는 기존 치료가 하나뿐이라 "순서 변경"은 없다(새 치료가 끼어들어 번호가 밀린 것은 순서 변경이 아니다).
  await expect(preview.locator('[data-admin-reordered]')).toHaveCount(0);

  const rowsOf = (side: 'before' | 'after') => preview.locator(`[data-admin-preview-list="${side}"] [data-admin-preview-row]`).evaluateAll((items) => items.map((item) => item.getAttribute('data-admin-preview-row')));
  expect(await rowsOf('before')).toEqual([T1, T2]);
  expect(await rowsOf('after')).toEqual([`NEW:${NEW_KEY}`, T1]);
  await expect(preview.locator(`[data-admin-preview-list="after"] [data-admin-preview-row="NEW:${NEW_KEY}"]`)).toContainText('새 치료');
  await expect(preview.locator(`[data-admin-preview-list="after"] [data-admin-preview-row="${T1}"]`)).toContainText('11,000원');
  await expect(preview.locator(`[data-admin-preview-list="before"] [data-admin-preview-row="${T2}"]`)).toContainText(NAME_B);

  // 가격을 바꾼 치료가 있어 금액 비교 표도 나온다 (치료 10,000 → 11,000 + 공통 기본비용 5,000).
  await expect(preview.locator('[data-admin-compare="state"]')).toContainText('정상 계산');
  await expect(preview.locator('[data-admin-compare="hospital"]')).toContainText('15,000원');
  await expect(preview.locator('[data-admin-compare="hospital"]')).toContainText('16,000원');
  await expect(button(page, '게시')).toBeEnabled();
  await shoot(page, 'preview');
});

test('미리보기를 본 뒤 초안이 바뀌면 다시 미리보기를 해야 게시할 수 있다: 옛 확인값은 서버도 거절한다', async ({ page }) => {
  await adminReady(page);
  const catalogBefore = await publicCatalog(page.request);
  const [response] = await Promise.all([previewResponse(page), button(page, '미리보기 계산').click()]);
  const oldConfirmation = ((await response.json()) as Json)['publishConfirmation'] as string;
  await expect(page.locator('[data-admin-preview]')).toBeVisible();
  await expect(button(page, '게시')).toBeEnabled();

  // 화면에서 B 의 숨김을 풀면 미리보기가 사라지고 게시·미리보기 계산이 꺼진다(저장한 초안과 화면이 달라졌다).
  await button(page, `${NAME_B} 숨김 취소`).click();
  await expect(page.locator('[data-admin-preview]')).toHaveCount(0);
  await expect(button(page, '게시')).toBeDisabled();
  await expect(button(page, '미리보기 계산')).toBeDisabled();
  await expect(button(page, '초안 저장')).toBeEnabled();
  await expect(row(page, T2).locator('[data-admin-badge="none"]')).toBeVisible();
  // 숨김을 푼 B 는 가격 칸이 다시 열리고 계산 대상으로도 고를 수 있게 된다(저장한 뒤에).
  await button(page, '초안 저장').click();
  await expect(page.locator('[data-admin-message="ok"]')).toBeVisible();
  await expect(page.locator(`[data-admin-pick="${T2}"]`)).toHaveCount(1);
  await expect(button(page, '게시')).toBeDisabled();

  // 저장이 새 초안을 만들었으므로 앞 초안의 확인값을 그대로 보내도 서버가 거절한다.
  const replay = await page.request.post(`${API}/catalog/publish`, { data: { publishConfirmation: oldConfirmation } });
  expect(replay.status()).toBe(409);
  expect(await replay.json()).toEqual({ error: 'CONFLICT', reason: 'PREVIEW_REQUIRED' });
  expect(await publicCatalog(page.request)).toEqual(catalogBefore);

  // 다시 B 를 숨기고 저장 → 미리보기를 새로 해야 게시 단추가 열린다.
  await button(page, `${NAME_B} 숨기기`).click();
  await button(page, '초안 저장').click();
  await expect(page.locator('[data-admin-message="ok"]')).toBeVisible();
  await expect(button(page, '게시')).toBeDisabled();
  await button(page, '미리보기 계산').click();
  await expect(page.locator('[data-admin-preview]')).toBeVisible();
  await expect(button(page, '게시')).toBeEnabled();
  const replayAgain = await page.request.post(`${API}/catalog/publish`, { data: { publishConfirmation: oldConfirmation } });
  expect(replayAgain.status()).toBe(409);
  expect(await publicCatalog(page.request)).toEqual(catalogBefore);
});

test('게시가 서버에서 거절되면(다른 창이 같은 초안을 다시 저장) 아무것도 바뀌지 않고 입력은 화면에 남는다', async ({ page }) => {
  await adminReady(page);
  const catalogBefore = await publicCatalog(page.request);
  const versionBefore = (await page.locator('[data-admin-catalog-version]').innerText()).trim();
  await button(page, '미리보기 계산').click();
  await expect(page.locator('[data-admin-preview]')).toBeVisible();
  await expect(button(page, '게시')).toBeEnabled();

  // 다른 창(같은 관리자)이 내용은 같은 초안을 다시 저장한다: 서버가 보는 초안 버전이 달라져 앞의 확인값이 무효가 된다.
  const draftBefore = (await serverDraft(page.request)) as Json;
  const resave = await page.request.put(`${API}/catalog/draft`, { data: bodyOf(draftBefore) });
  expect(resave.status()).toBe(200);

  await button(page, '게시').click();
  const banner = page.locator('[data-admin-message="error"]');
  await expect(banner).toContainText('미리보기를 다시 실행한 뒤 게시');
  await expect(banner).toContainText('아무것도 게시되지 않았고 키오스크는 그대로입니다');
  await expect(banner).toContainText('입력한 내용은 화면에 그대로 남아 있습니다');
  await expect(page.locator('[data-admin-preview]')).toHaveCount(0);
  await expect(button(page, '게시')).toBeDisabled();
  await shoot(page, 'publish-rejected');

  // 공개 자료·게시 버전·초안은 그대로이고, 화면의 입력(새 치료·숨김·순서·가격)도 그대로다.
  expect(await publicCatalog(page.request)).toEqual(catalogBefore);
  await expect(page.locator('[data-admin-catalog-version]')).toHaveText(versionBefore);
  const draftAfter = (await serverDraft(page.request)) as Json;
  expect(bodyOf(draftAfter)).toEqual(bodyOf(draftBefore));
  expect(await rowKeys(page)).toEqual([NEW_KEY, T1, T2]);
  await expect(row(page, T2)).toHaveAttribute('data-hidden', 'true');
  await expect(row(page, T1).locator('input')).toHaveValue('11000');
  await expect(button(page, '초안 저장')).toBeDisabled();

  // 미리보기를 다시 하면 게시할 수 있는 상태로 돌아온다.
  await button(page, '미리보기 계산').click();
  await expect(page.locator('[data-admin-preview]')).toBeVisible();
  await expect(button(page, '게시')).toBeEnabled();
});

test('게시: 새 목록·순서가 키오스크에 반영된다 (숨긴 치료는 사라지고, 새 치료는 고를 수 있지만 계산은 보류, 기존 치료는 그대로 계산된다)', async ({ page, browser }) => {
  await adminReady(page);
  const versionBefore = (await page.locator('[data-admin-catalog-version]').innerText()).trim();
  await button(page, '미리보기 계산').click();
  await expect(page.locator('[data-admin-preview]')).toBeVisible();
  await button(page, '게시').click();
  await expect(page.locator('[data-admin-message="ok"]')).toContainText('게시했습니다');
  const versionAfter = (await page.locator('[data-admin-catalog-version]').innerText()).trim();
  expect(versionAfter).not.toBe(versionBefore);
  await expect(page.locator('[data-admin-draft="none"]')).toBeVisible();

  // 공개 카탈로그: [새 치료 C, A] 순서이고 B 는 없다. 새 치료는 서버가 만든 치료 id 를 받았다.
  const catalog = await publicCatalog(page.request);
  expect(catalog.catalogVersion).toBe(versionAfter);
  expect(names(catalog)).toEqual([NAME_C, NAME_A]);
  expect(catalog.treatments.map((entry) => [entry.patientAmount, entry.order, entry.benefitType])).toEqual([[8_000, 1, 'NON_BENEFIT'], [11_000, 2, 'BENEFIT']]);
  expect(catalog.treatments[1]?.treatmentId).toBe(T1);
  expect(catalog.treatments[0]?.treatmentId).not.toBe(NEW_KEY);
  expect(JSON.stringify(catalog)).not.toMatch(/NEEDS_REVIEW|calcClass|treatmentCode|procedureCodes/);

  // 관리자 화면: 게시된 목록이 같은 모습이고 이력에 변경 요약이 남는다.
  const newId = catalog.treatments[0]?.treatmentId as string;
  expect(await rowKeys(page)).toEqual([newId, T1]);
  await expect(row(page, newId)).toContainText(NAME_C);
  await expect(row(page, newId).locator('[data-admin-current]')).toHaveText('8,000원');
  await expect(positionOf(page, newId)).toHaveText('1');
  await expect(positionOf(page, T1)).toHaveText('2');
  await expect(row(page, T1).locator('[data-admin-current]')).toHaveText('11,000원');
  await expect(page.locator(`[data-admin-version="${versionAfter}"][data-current="true"]`)).toContainText('추가 1건 · 숨김 1건 · 가격 변경 1건');
  await shoot(page, 'published');

  // 키오스크: 새 목록과 순서.
  const listed = await kioskList(browser, 'kiosk-after-publish');
  expect(listed).toHaveLength(2);
  expect(listed[0]).toContain('시험 치료 C (새로 추가)');
  expect(listed[1]).toContain('시험 치료 A (급여)');
  expect(listed.join(' ')).not.toContain('시험 치료 B');

  // 새 치료만 고르면 보류 결과이고 보험금이 없다. 기존 치료 A 는 11,000 + 기본비용 5,000 으로 정상 계산된다. 둘을 함께 골라도 전체가 보류다.
  const onlyNew = await kioskCalculate(browser, [/시험 치료 C/], 'kiosk-new-treatment-hold');
  expect(onlyNew).toMatchObject({ kind: 'hold', state: 'ON_HOLD', payout: null, payoutKnown: 'false' });
  const onlyExisting = await kioskCalculate(browser, [/시험 치료 A/], 'kiosk-existing-normal');
  expect(onlyExisting).toMatchObject({ kind: 'normal', state: 'ESTIMATED', hospital: 16_000 });
  expect(onlyExisting.payout).not.toBeNull();
  const both = await kioskCalculate(browser, [/시험 치료 C/, /시험 치료 A/]);
  expect(both).toMatchObject({ kind: 'hold', state: 'ON_HOLD', payout: null });
});

test('순서만 바꾼 초안도 저장·미리보기·게시된다: 금액 비교는 만들지 않고 목록과 변경 내역만 보인다', async ({ page, browser }) => {
  await adminReady(page);
  const catalogBefore = await publicCatalog(page.request);
  const [newId, existingId] = catalogBefore.treatments.map((entry) => entry.treatmentId) as [string, string];
  expect(existingId).toBe(T1);

  await button(page, `${NAME_A} 위로 이동`).click();
  expect(await rowKeys(page)).toEqual([T1, newId]);
  // 남는 기존 치료끼리 순위가 바뀐 줄에 "순서 바뀜"이 붙는다 (이번에는 둘 다 남는다).
  await expect(row(page, T1).locator('[data-admin-badge="moved"]')).toHaveText('순서 바뀜');
  await expect(row(page, newId).locator('[data-admin-badge="moved"]')).toHaveText('순서 바뀜');
  await expect(page.locator('[data-admin-working-summary]')).toHaveText('화면에서 고친 내용: 순서 변경');
  await button(page, '초안 저장').click();
  await expect(page.locator('[data-admin-message="ok"]')).toBeVisible();
  expect(await publicCatalog(page.request)).toEqual(catalogBefore);

  const [request, response] = await Promise.all([previewRequest(page), previewResponse(page), button(page, '미리보기 계산').click()]);
  expect(Object.keys(request.postDataJSON() as Json).sort()).toEqual(['cause', 'generation', 'insurerType']);
  const body = (await response.json()) as Json;
  expect(body['before']).toBeNull();
  expect(body['after']).toBeNull();
  const preview = page.locator('[data-admin-preview]');
  await expect(preview).toBeVisible();
  await expect(preview.locator('[data-admin-no-compare]')).toBeVisible();
  await expect(preview.locator('[data-admin-compare="hospital"]')).toHaveCount(0);
  await expect(preview.locator(`[data-admin-reordered="${T1}"]`)).toContainText('2번째 → 1번째');
  await expect(preview.locator(`[data-admin-reordered="${newId}"]`)).toContainText('1번째 → 2번째');
  await expect(preview.locator('[data-admin-added]')).toHaveCount(0);
  await expect(preview.locator('[data-admin-deactivated]')).toHaveCount(0);
  await shoot(page, 'preview-order-only');

  await button(page, '게시').click();
  await expect(page.locator('[data-admin-message="ok"]')).toContainText('게시했습니다');
  const versionAfter = (await page.locator('[data-admin-catalog-version]').innerText()).trim();
  await expect(page.locator(`[data-admin-version="${versionAfter}"]`)).toContainText('순서 변경 2건');
  const catalog = await publicCatalog(page.request);
  expect(names(catalog)).toEqual([NAME_A, NAME_C]);
  expect(catalog.treatments.map((entry) => entry.order)).toEqual([1, 2]);
  expect(catalog.treatments.map((entry) => entry.patientAmount)).toEqual([11_000, 8_000]);
  expect(await rowKeys(page)).toEqual([T1, newId]);
  const listed = await kioskList(browser, 'kiosk-after-reorder');
  expect(listed[0]).toContain('시험 치료 A (급여)');
  expect(listed[1]).toContain('시험 치료 C (새로 추가)');
});

test('서버가 거절한 저장은 입력을 지우지 않고 이유를 말한다. 초안 버리기는 화면을 게시된 상태로 되돌린다', async ({ page }) => {
  await adminReady(page);
  const catalogBefore = await publicCatalog(page.request);
  // 화면 검사는 통과하지만(숫자) 서버의 안전 한도를 넘는 가격: 서버가 400 으로 거절한다.
  await row(page, T1).locator('input').fill('2000000000');
  await button(page, '초안 저장').click();
  const banner = page.locator('[data-admin-message="error"]');
  await expect(banner).toContainText('입력값이 올바르지 않습니다');
  await expect(banner).toContainText('초안은 바뀌지 않았고, 입력한 내용은 화면에 그대로 남아 있습니다');
  expect(await banner.innerText()).not.toMatch(/VALUE_INVALID|INVALID_REQUEST/);
  await expect(row(page, T1).locator('input')).toHaveValue('2000000000');
  await expect(page.locator('[data-admin-draft="none"]')).toBeVisible();
  expect(await serverDraft(page.request)).toBeNull();
  expect(await publicCatalog(page.request)).toEqual(catalogBefore);
  await shoot(page, 'save-rejected');

  // 고쳐서 저장한 뒤 초안 버리기: 가격·숨김·순서가 모두 게시된 상태로 돌아온다.
  await row(page, T1).locator('input').fill('9000');
  const newId = catalogBefore.treatments.find((entry) => entry.displayName === NAME_C)?.treatmentId as string;
  await button(page, `${NAME_C} 숨기기`).click();
  await expect(row(page, newId)).toHaveAttribute('data-hidden', 'true');
  await button(page, '초안 저장').click();
  await expect(page.locator('[data-admin-draft="saved"]')).toBeVisible();
  expect(((await serverDraft(page.request)) as Json)['deactivations']).toEqual([newId]);
  await button(page, '초안 버리기').click();
  await expect(page.locator('[data-admin-message="ok"]')).toContainText('초안을 버렸습니다');
  await expect(page.locator('[data-admin-draft="none"]')).toBeVisible();
  await expect(row(page, T1).locator('input')).toHaveValue('11000');
  await expect(row(page, T1)).toHaveAttribute('data-hidden', 'false');
  await expect(row(page, newId)).toHaveAttribute('data-hidden', 'false');
  expect(await rowKeys(page)).toEqual([T1, newId]);
  expect(await publicCatalog(page.request)).toEqual(catalogBefore);
});
