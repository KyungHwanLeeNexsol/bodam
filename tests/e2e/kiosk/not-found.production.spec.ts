import { expect, test } from '../helpers/test';
import { dumpStorage } from '../helpers/storage';

// 운영 구성 층 (BRIEF D12): 빌드한 앱을 운영 구성 그대로 띄운다. 운영 저장소는 비어 있어서 어떤 병원 slug 도 병원 조회 API(catalog·options)가 404 CLINIC_NOT_FOUND 이고,
// 키오스크 문서 자체는 HTTP 200 으로 내려와 화면이 "이 화면은 이용할 수 없어요" 안내를 보인다. (키오스크 주소가 404 인 것이 아니다.)
// 이 층이 증명하는 것은 "운영 경로에 시험 자료가 없고 데이터가 없다"는 사실, 시험 전용 안내(시험 데이터 안내 띠)가 운영 구성에 없다는 사실, 키오스크 문서의 응답 헤더(AC-021g)뿐이다.
// 운영 자료로 계산이 된다는 증거가 아니다.

const TEST_NOTICE = '테스트 데이터로 계산한 예시입니다. 실제 보험금 안내에 사용할 수 없습니다.';

test.describe('운영 구성: 키오스크 문서는 HTTP 200, 병원 조회 API 는 404, 화면은 이용 불가 안내', () => {
  test('찾을 수 없는 병원: 안내 화면만 보이고 시작할 길이 없다 (환자 문구에 코드·상태 번호가 없다)', async ({ page }) => {
    const catalog = page.waitForResponse((response) => response.url().endsWith('/api/clinics/no-such-clinic/catalog'));
    const document = await page.goto('/kiosk/no-such-clinic');
    // 키오스크 문서는 200 이다(주소가 404 가 아니다).
    expect(document?.status()).toBe(200);
    // 실제 운영 API 가 404 CLINIC_NOT_FOUND 로 응답한다 (가로채지 않았다).
    expect((await catalog).status()).toBe(404);
    // 화면은 catalog 와 options 를 동시에 요청하고 첫 실패(404)가 곧바로 결말을 정하며 나머지 요청을 취소한다(load-clinic-data.ts). 그래서 options 의 응답이 화면 쪽에 도착한다고
    // 가정할 수 없다(경합). options 의 운영 응답은 같은 서버에 직접 한 번 더 물어 확인한다.
    expect((await page.request.get('/api/clinics/no-such-clinic/insurance/options')).status()).toBe(404);

    await expect(page.getByRole('heading', { name: '이 화면은 이용할 수 없어요' })).toBeVisible();
    await expect(page.locator('[data-kiosk-state="NOT_FOUND"]')).toBeVisible();
    await expect(page.getByText('접수 직원에게 문의해 주세요.')).toBeVisible();
    await expect(page.getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '시작하기' })).toHaveCount(0);

    const text = await page.locator('body').innerText();
    for (const banned of ['CLINIC_NOT_FOUND', '404', 'error', 'TEST_FIXTURE']) expect(text).not.toContain(banned);
    await expect(page.locator('a')).toHaveCount(0);
  });

  test('운영 구성에는 시험 전용 안내가 없다: 시험 데이터 안내 문장도, 안내 띠·앱 틀(iframe)도 화면과 문서에 없다', async ({ page, request }) => {
    const document = await page.goto('/kiosk/no-such-clinic');
    expect(document?.status()).toBe(200);
    await expect(page.locator('[data-kiosk-state="NOT_FOUND"]')).toBeVisible();
    expect(await page.locator('body').innerText()).not.toContain(TEST_NOTICE);
    await expect(page.locator('[data-test-notice], [data-kiosk-test-data], iframe')).toHaveCount(0);
    const raw = await (await request.get('/kiosk/no-such-clinic')).text();
    for (const marker of [TEST_NOTICE, 'data-test-notice', '<iframe']) expect(raw).not.toContain(marker);
  });

  test('다른 slug(한글·특수 문자 포함)도 같다. 병원 자료가 없으므로 병원명·토글이 없다', async ({ page }) => {
    for (const slug of ['test-fixture-clinic-1', encodeURIComponent('한글 병원'), 'a%2Fb']) {
      expect((await page.goto(`/kiosk/${slug}`))?.status()).toBe(200);
      await expect(page.locator('[data-kiosk-state="NOT_FOUND"]')).toBeVisible();
      await expect(page.locator('.kiosk-hospital')).toHaveCount(0);
      await expect(page.getByRole('button', { name: '큰 글자 보기' })).toHaveCount(0);
    }
  });

  test('운영 데이터가 없는 곳에서도 브라우저 저장소에는 아무것도 쓰지 않는다', async ({ page }) => {
    await page.goto('/kiosk/no-such-clinic');
    await expect(page.locator('[data-kiosk-state="NOT_FOUND"]')).toBeVisible();
    const dump = await dumpStorage(page);
    expect(dump.localStorage).toEqual({});
    expect(dump.sessionStorage).toEqual({});
    expect(dump.cookie).toBe('');
    expect(dump.contextCookies).toEqual([]);
    expect(dump.indexedDb).toEqual({});
    expect(dump.cacheStorage).toEqual({});
    expect(dump.serviceWorkers).toEqual([]);
  });
});

test.describe('AC-021g: 키오스크 문서의 응답 헤더', () => {
  test('/kiosk/{slug} 문서는 Cache-Control: no-store 이다 (실제 next start 응답)', async ({ page }) => {
    const response = await page.goto('/kiosk/no-such-clinic');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['cache-control']).toBe('no-store');
  });

  test('다른 slug·쿼리가 붙어도 같고, API 응답도 no-store 다 (AC-021e 와 함께 본다)', async ({ request }) => {
    const document = await request.get('/kiosk/x?a=1');
    expect(document.headers()['cache-control']).toBe('no-store');
    const api = await request.get('/api/clinics/x/catalog');
    expect(api.status()).toBe(404);
    expect(api.headers()['cache-control']).toBe('no-store');
  });
});
