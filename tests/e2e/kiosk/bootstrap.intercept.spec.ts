import { expect, test } from '../helpers/test';
import type { Page } from '@playwright/test';
import { makeCatalog, makeOptions } from '../../fixtures/kiosk/clinic.fixture';
import { ABORT, HANG, mockClinicApi, reply, replyRaw } from '../helpers/api';
import { installClock } from '../helpers/clock';
import { KIOSK_PATH, SLUG, expectStartScreen, isLandscape, root, startButton } from '../helpers/kiosk';

// 가로채기 층 (BRIEF D12): 시작 단계의 병원 자료 받기. 가로챈 응답으로 화면을 시험한 것이며 운영 자료나 실제 핸들러의 증거가 아니다.
// 비정상 상태 네 가지(불러오는 중·병원 없음·불러오기 실패와 다시 시도·치료 없음)와 정상(READY), 응답 형태 검사(엄격한 읽기)를 실제 Chrome 에서 본다.

const state = (page: Page, name: string) => page.locator(`[data-kiosk-state="${name}"]`);

test.describe('받는 동안', () => {
  test('불러오는 중 화면이 보이고 시작할 길이 없다. 응답이 오면 시작 화면이 된다 (두 GET 모두 한 번씩)', async ({ page }) => {
    const api = await mockClinicApi(page);
    const held = api.hold('catalog');
    await page.goto(KIOSK_PATH, { waitUntil: 'commit' });
    await held.arrived();

    await expect(state(page, 'LOADING')).toBeVisible();
    await expect(page.getByRole('status')).toContainText('병원 정보를 불러오고 있어요');
    await expect(startButton(page)).toHaveCount(0);
    // 컨트롤러가 없으므로 병원명·큰 글자 토글도 없다.
    await expect(page.getByRole('button')).toHaveCount(0);

    held.release(reply(200, makeCatalog()));
    await expectStartScreen(page);
    expect(api.callsTo('catalog')).toHaveLength(1);
    expect(api.callsTo('options')).toHaveLength(1);
  });

  test('요청은 익명 GET 두 건이다: 본문·쿠키·시도 식별자 없음, 주소는 병원 slug 뿐', async ({ page }) => {
    const api = await mockClinicApi(page);
    await page.goto(KIOSK_PATH);
    await expectStartScreen(page);
    const urls = api.calls.map((call) => new URL(call.url).pathname + new URL(call.url).search).sort();
    expect(urls).toEqual([`/api/clinics/${SLUG}/catalog`, `/api/clinics/${SLUG}/insurance/options`]);
    for (const call of api.calls) {
      expect(call.method).toBe('GET');
      expect(call.postData).toBeNull();
      expect(call.headers.cookie).toBeUndefined();
      expect(call.headers.authorization).toBeUndefined();
    }
  });
});

test.describe('정상과 비정상 상태', () => {
  test('READY: 규칙 묶음이 중지(SUSPENDED)여도 시작 화면이다 (계산이 보류로 끝나는 일이다)', async ({ page }) => {
    await mockClinicApi(page, { options: makeOptions({ ruleBundleStatus: 'SUSPENDED' }) });
    await page.goto(KIOSK_PATH);
    await expectStartScreen(page);
  });

  test('NOT_FOUND: 404 는 병원 없음 화면이고 버튼이 없다', async ({ page }) => {
    const api = await mockClinicApi(page);
    api.setDefault('catalog', reply(404, { error: 'CLINIC_NOT_FOUND' }));
    api.setDefault('options', reply(404, { error: 'CLINIC_NOT_FOUND' }));
    await page.goto(KIOSK_PATH);
    await expect(state(page, 'NOT_FOUND')).toBeVisible();
    await expect(page.getByRole('heading', { name: '이 화면은 이용할 수 없어요' })).toBeVisible();
    await expect(page.getByRole('button')).toHaveCount(0);
  });

  test('NOT_FOUND: 한쪽만 404 이고 다른 쪽이 끝내 오지 않아도 바로 병원 없음이다', async ({ page }) => {
    const api = await mockClinicApi(page);
    api.setDefault('catalog', reply(404, { error: 'CLINIC_NOT_FOUND' }));
    api.setDefault('options', HANG);
    await page.goto(KIOSK_PATH);
    await expect(state(page, 'NOT_FOUND')).toBeVisible();
  });

  const failures: Array<[string, () => ReturnType<typeof reply>]> = [
    ['500', () => reply(500, { error: 'INTERNAL_ERROR' })],
    ['503', () => reply(503, {})],
    ['401', () => reply(401, {})],
    ['깨진 JSON', () => replyRaw(200, '{ not json')],
    ['계약과 다른 모양(치료 목록이 문자열)', () => reply(200, { ...makeCatalog(), treatments: 'none' })],
    ['다른 병원의 응답(slug 불일치)', () => reply(200, makeCatalog({ clinic: { slug: 'test-fixture-clinic-2', displayName: 'TEST_FIXTURE 다른 의원', setting: 'OUTPATIENT_ONLY' } }))],
  ];

  for (const [name, failing] of failures) {
    test(`LOAD_FAILED: catalog ${name}`, async ({ page }) => {
      const api = await mockClinicApi(page);
      api.setDefault('catalog', failing());
      await page.goto(KIOSK_PATH);
      await expect(state(page, 'LOAD_FAILED')).toBeVisible();
      await expect(startButton(page)).toHaveCount(0);
      await expect(page.getByRole('button', { name: '다시 시도' })).toBeVisible();
    });
  }

  test('LOAD_FAILED: options 가 계약과 다른 모양(세대 카드가 비어 있음)이면 일부만 맞는 자료로 열지 않는다', async ({ page }) => {
    const api = await mockClinicApi(page);
    api.setDefault('options', reply(200, { ...makeOptions(), generations: [] }));
    await page.goto(KIOSK_PATH);
    await expect(state(page, 'LOAD_FAILED')).toBeVisible();
    await expect(startButton(page)).toHaveCount(0);
  });

  test('LOAD_FAILED: 연결 실패(abort)', async ({ page }) => {
    const api = await mockClinicApi(page);
    api.setDefault('options', ABORT);
    await page.goto(KIOSK_PATH);
    await expect(state(page, 'LOAD_FAILED')).toBeVisible();
  });

  test('LOAD_FAILED 화면: 통신 오류 막대, "접수 직원에게 문의해 주세요" 문장(버튼 아님), 코드·상태 번호 없음', async ({ page }) => {
    const api = await mockClinicApi(page);
    api.setDefault('catalog', reply(500, { error: 'INTERNAL_ERROR' }));
    await page.goto(KIOSK_PATH);
    await expect(state(page, 'LOAD_FAILED')).toBeVisible();
    await expect(page.getByText('통신 오류', { exact: true })).toBeVisible();
    await expect(page.getByText('계속 안 되면 접수 직원에게 문의해 주세요.')).toBeVisible();
    await expect(page.getByRole('button')).toHaveCount(1);
    const text = await page.locator('body').innerText();
    for (const banned of ['INTERNAL_ERROR', '500', '0원']) expect(text).not.toContain(banned);
    await expect(page.locator('a')).toHaveCount(0);
  });

  test('"다시 시도"는 받기를 처음부터 다시 한다: 불러오는 중을 거쳐 성공하면 시작 화면이 된다', async ({ page }) => {
    const api = await mockClinicApi(page);
    api.queue('catalog', reply(500, {}));
    await page.goto(KIOSK_PATH);
    await expect(state(page, 'LOAD_FAILED')).toBeVisible();
    const held = api.hold('options');
    await page.getByRole('button', { name: '다시 시도' }).click();
    await held.arrived();
    await expect(state(page, 'LOADING')).toBeVisible();
    held.release(reply(200, makeOptions()));
    await expectStartScreen(page);
    // 처음 시도 두 건(catalog 500 + options 200) + 다시 시도 두 건.
    expect(api.callsTo('catalog')).toHaveLength(2);
    expect(api.callsTo('options')).toHaveLength(2);
  });

  test('다시 시도가 또 실패하면 다시 실패 화면이다 (무한 대기가 없다)', async ({ page }) => {
    const api = await mockClinicApi(page);
    api.setDefault('catalog', reply(503, {}));
    await page.goto(KIOSK_PATH);
    await expect(state(page, 'LOAD_FAILED')).toBeVisible();
    await page.getByRole('button', { name: '다시 시도' }).click();
    await expect(state(page, 'LOAD_FAILED')).toBeVisible();
    expect(api.callsTo('catalog').length).toBeGreaterThanOrEqual(2);
  });

  test('시간 제한(15초, 가짜 시계): 한쪽이 끝내 응답하지 않으면 불러오기 실패다. 실제로 기다리지 않는다', async ({ page }) => {
    await installClock(page);
    const api = await mockClinicApi(page);
    api.setDefault('options', HANG);
    await page.goto(KIOSK_PATH);
    await expect(state(page, 'LOADING')).toBeVisible();
    await page.clock.runFor(14_000);
    await expect(state(page, 'LOADING')).toBeVisible();
    await page.clock.runFor(2_000);
    await expect(state(page, 'LOAD_FAILED')).toBeVisible();
  });

  test('NO_TREATMENTS: 치료가 없으면 안내 화면이고 시작할 수 없다. 병원명은 보인다', async ({ page }) => {
    await mockClinicApi(page, { catalog: makeCatalog({ treatments: [] }) });
    await page.goto(KIOSK_PATH);
    await expect(state(page, 'NO_TREATMENTS')).toBeVisible();
    await expect(page.getByRole('heading', { name: '지금은 안내할 수 있는 치료가 없어요' })).toBeVisible();
    await expect(page.getByText('접수 직원에게 문의해 주세요.')).toBeVisible();
    await expect(startButton(page)).toHaveCount(0);
    await expect(page.getByRole('button')).toHaveCount(0);
    await expect(page.locator('.kiosk-hospital__name')).toHaveText('TEST_FIXTURE 시험 의원');
  });

  test('NO_TREATMENTS: 게시한 카탈로그가 없으면(catalogVersion null) 치료가 있어도 시작할 수 없다', async ({ page }) => {
    await mockClinicApi(page, { catalog: makeCatalog({ catalogVersion: null }) });
    await page.goto(KIOSK_PATH);
    await expect(state(page, 'NO_TREATMENTS')).toBeVisible();
    await expect(startButton(page)).toHaveCount(0);
  });

  test('비정상 상태에서는 어느 것도 선택·계산할 수 없고 저장소에 쓰지 않는다 (컨트롤러가 없다)', async ({ page }) => {
    const api = await mockClinicApi(page);
    api.setDefault('catalog', reply(500, {}));
    await page.goto(KIOSK_PATH);
    await expect(state(page, 'LOAD_FAILED')).toBeVisible();
    await page.mouse.click(100, 400);
    await page.keyboard.press('Enter');
    await expect(state(page, 'LOAD_FAILED')).toBeVisible();
    expect(api.callsTo('estimate')).toHaveLength(0);
    expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  });

  test('방향 표지: 루트의 data-orientation 이 뷰포트를 따른다 (자료를 받는 중에도)', async ({ page }, testInfo) => {
    const api = await mockClinicApi(page);
    const held = api.hold('catalog');
    await page.goto(KIOSK_PATH, { waitUntil: 'commit' });
    await held.arrived();
    await expect(root(page)).toHaveAttribute('data-orientation', isLandscape(testInfo) ? 'landscape' : 'portrait');
    await expect(root(page)).toHaveAttribute('data-large-text', 'false');
    held.release(reply(200, makeCatalog()));
    await expectStartScreen(page);
    await expect(root(page)).toHaveAttribute('data-orientation', isLandscape(testInfo) ? 'landscape' : 'portrait');
  });
});
