import { expect, test } from '../helpers/test';
import type { Page } from '@playwright/test';
import { reply } from '../helpers/api';
import type { ApiMock } from '../helpers/api';
import { makeCatalog, makeOptions } from '../../fixtures/kiosk/clinic.fixture';
import { estimatedResponse, notCoveredResponse, singleCauseDocuments } from '../../fixtures/kiosk/estimate-response.fixture';
import { KIOSK_PATH, SLUG, dialog, expectK01, expectStartScreen, startButton } from '../helpers/kiosk';
import { openKiosk } from '../helpers/input';
import { actionsOf, amountValue, calculating, confirmButton, resultRoot, submitEstimate, toFilledK03 } from '../helpers/results';
import { COMPLETE_TITLE, completeScreen, normalWith, openBasis, openDocuments, reachResult, sheetBack, sheetComplete } from '../helpers/sheets';

// 가로채기 층 (S4 B, AC-016d·AC-016c·AC-021g·BRIEF D3·D4): 브라우저 생명주기. 뒤로·앞으로·새로고침·페이지 캐시 복원은 어느 화면에서든 빈 시작 화면이고(이전 결과가 보이지 않는다),
// 키오스크 문서는 no-store 이며, 단계가 바뀌어도 기록 항목이 늘지 않고, 병원이 바뀌면 옛 컨트롤러와 옛 응답이 새 병원 화면에 닿지 못한다.
// "결과를 본 뒤"가 조건이라 결과 화면(요청 응답은 가로채기)에서 시작한다. 세션 보호의 시간 쪽(만료 초기화)은 session.intercept.spec.ts 가 본다.

const RESULT_TEXT = /124,000원|114,000원/;

/** 상단의 병원 이름(시작 화면 본문에도 한 번 더 나오므로 상단으로 좁힌다). */
const headerOf = (page: Page, name: string) => page.locator('.kiosk-header', { hasText: name });

async function reachNormalResult(page: Page, api: ApiMock): Promise<void> {
  await reachResult(page, api, estimatedResponse());
  await expect(amountValue(page, 'hospital')).toContainText('124,000');
}

async function expectNoPreviousResult(page: Page): Promise<void> {
  await expectStartScreen(page);
  await expect(resultRoot(page)).toHaveCount(0);
  expect(await page.locator('.kiosk-root').innerText()).not.toMatch(RESULT_TEXT);
}

test.describe('키오스크 문서의 응답 헤더 (AC-021g, 실제 Chrome 의 문서 요청)', () => {
  test('문서 응답은 Cache-Control: no-store 다(쿼리가 붙어도 같다). 브라우저가 페이지 캐시·HTTP 캐시로 되살릴 근거를 주지 않는다', async ({ page }) => {
    await openKiosk(page);
    const response = await page.goto(KIOSK_PATH);
    expect(response?.status()).toBe(200);
    expect(response?.headers()['cache-control']).toBe('no-store');
    const withQuery = await page.goto(`${KIOSK_PATH}?x=1`);
    expect(withQuery?.headers()['cache-control']).toBe('no-store');
  });
});

test.describe('결과를 본 뒤 뒤로·앞으로·새로고침·페이지 복원 (AC-016d)', () => {
  test('결과 화면에서 새로고침: 빈 시작 화면이고 이전 결과가 없다', async ({ page }) => {
    const api = await openKiosk(page);
    await reachNormalResult(page, api);
    await page.reload();
    await expectNoPreviousResult(page);
    // 새 세션이다: 시작하면 빈 1단계다.
    await startButton(page).click();
    await expectK01(page);
    await expect(page.getByRole('radio', { checked: true })).toHaveCount(0);
  });

  test('결과 화면에서 pageshow(persisted: true): 빈 시작 화면. persisted: false 는 아무 일도 없다', async ({ page }) => {
    const api = await openKiosk(page);
    await reachNormalResult(page, api);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })));
    await expect(resultRoot(page)).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await expectNoPreviousResult(page);
  });

  test('결과 화면에서 다른 문서로 갔다가 뒤로·앞으로·뒤로: 매번 빈 시작 화면이다 (문서는 no-store 라 복원 없이 다시 불러온다)', async ({ page }) => {
    const api = await openKiosk(page);
    await reachNormalResult(page, api);
    await page.goto('about:blank');
    await page.goBack();
    await expectNoPreviousResult(page);
    await page.goForward();
    await page.goBack();
    await expectNoPreviousResult(page);
  });

  test('계산 근거·서류·이용 완료 화면에서도 새로고침하면 빈 시작 화면이다', async ({ page }) => {
    const api = await openKiosk(page);
    await reachResult(page, api, normalWith(singleCauseDocuments()));
    await openBasis(page);
    await page.reload();
    await expectNoPreviousResult(page);
    // 가로채기 라우트는 페이지에 걸려 있어 새로고침 뒤에도 살아 있다: 같은 ApiMock 으로 다시 결과까지 간다.
    await reachResult(page, api, normalWith(singleCauseDocuments()));
    await openDocuments(page, 'documents');
    await page.reload();
    await expectNoPreviousResult(page);
  });

  test('이용 완료 화면에서 새로고침하면 빈 시작 화면이다 (이용 완료 화면이 되살아나지 않는다)', async ({ page }) => {
    const api = await openKiosk(page);
    await reachResult(page, api, estimatedResponse());
    await actionsOf(page).filter({ hasText: '이용 완료' }).click();
    await expect(completeScreen(page)).toBeVisible();
    await expect(page.getByRole('heading', { name: COMPLETE_TITLE })).toBeVisible();
    await page.reload();
    await expectStartScreen(page);
    await expect(completeScreen(page)).toHaveCount(0);
  });
});

test.describe('기록 항목과 주소: 단계가 바뀌어도 늘지 않는다 (BRIEF §0, AC-016b)', () => {
  test('시작 → 입력 네 단계 → 결과 → 근거 → 서류 → 이용 완료 → 시작: history.length 가 그대로이고 pushState·replaceState·hashchange 가 없으며 주소가 그대로다', async ({ page }) => {
    await page.addInitScript(() => {
      const calls: string[] = [];
      (window as unknown as { __nav: string[] }).__nav = calls;
      for (const name of ['pushState', 'replaceState'] as const) {
        const original = History.prototype[name] as (...args: unknown[]) => void;
        History.prototype[name] = function (this: History, ...args: unknown[]) {
          calls.push(name);
          return original.apply(this, args);
        } as never;
      }
      window.addEventListener('hashchange', () => calls.push('hashchange'));
      window.addEventListener('popstate', () => calls.push('popstate'));
    });
    const api = await openKiosk(page);
    const initialHref = page.url();
    const length = await page.evaluate(() => history.length);
    // 문서를 처음 불러올 때 프레임워크(Next)가 하는 일은 단계 이동이 아니므로 센 값에서 뺀다. 아래부터는 환자 조작이 일으키는 호출만 센다.
    await page.evaluate(() => {
      (window as unknown as { __nav: string[] }).__nav.length = 0;
    });

    const stepChecks: string[] = [];
    const snapshot = async (label: string): Promise<void> => {
      stepChecks.push(`${label}: ${String(await page.evaluate(() => history.length))} ${page.url() === initialHref ? 'same-url' : page.url()}`);
      expect(await page.evaluate(() => history.length), `${label}: history.length`).toBe(length);
      expect(page.url(), `${label}: URL`).toBe(initialHref);
    };

    await snapshot('시작');
    await toFilledK03(page);
    await snapshot('입력 네 단계 뒤(4단계)');
    await submitEstimate(page, api, reply(200, estimatedResponse({ documents: singleCauseDocuments() })));
    await expect(resultRoot(page)).toBeVisible();
    await snapshot('결과');
    await openBasis(page);
    await snapshot('계산 근거');
    await sheetBack(page).click();
    await openDocuments(page, 'documents');
    await snapshot('필요 서류');
    await sheetComplete(page).click();
    await expect(completeScreen(page)).toBeVisible();
    await snapshot('이용 완료');
    await page.getByRole('button', { name: '처음 화면으로' }).click();
    await expectStartScreen(page);
    await snapshot('다시 시작');

    expect(await page.evaluate(() => (window as unknown as { __nav: string[] }).__nav)).toEqual([]);
    // 대조군: 일곱 지점을 실제로 모두 확인했다(빈 흐름으로 통과하지 않는다).
    expect(stepChecks).toHaveLength(7);
  });
});

test.describe('병원이 바뀌거나 화면을 떠나면 옛 컨트롤러와 옛 응답은 새 화면에 닿지 못한다 (BRIEF D3)', () => {
  const OTHER = 'test-fixture-clinic-2';

  async function routeOtherClinic(page: Page): Promise<void> {
    const catalog = makeCatalog({ clinic: { slug: OTHER, displayName: 'TEST_FIXTURE 다른 의원', setting: 'OUTPATIENT_ONLY' } });
    await page.route(new RegExp(`/api/clinics/${OTHER}/catalog`), (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify(catalog) }));
    await page.route(new RegExp(`/api/clinics/${OTHER}/insurance/options`), (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify(makeOptions()) }));
  }

  test('계산 중에 클라이언트 쪽 이동으로 다른 병원 화면이 열리면: 새 병원은 빈 시작 화면이고, 옛 병원의 늦은 응답은 아무것도 바꾸지 못하며, 옛 요청은 중단된다', async ({ page }) => {
    const api = await openKiosk(page);
    await routeOtherClinic(page);
    const held = api.hold('estimate');
    await toFilledK03(page);
    await confirmButton(page).click();
    await held.arrived();
    await expect(calculating(page)).toBeVisible();

    const aborted = page.waitForEvent('requestfailed', { predicate: (request) => request.url().includes(`/api/clinics/${SLUG}/estimate`), timeout: 10_000 });
    await page.evaluate((target) => (window as unknown as { next: { router: { push: (href: string) => void } } }).next.router.push(target), `/kiosk/${OTHER}`);
    await expect(headerOf(page, 'TEST_FIXTURE 다른 의원')).toBeVisible();
    await expectStartScreen(page);
    // 옛 컨트롤러가 버려질 때 진행 중이던 요청을 중단했다(취소 없이 응답이 와도 쓰이지 않는 것은 아래).
    expect((await aborted).failure()?.errorText).toMatch(/ABORTED/i);

    // 옛 병원의 늦은 응답이 도착해도 새 병원 화면은 그대로다.
    held.release(reply(200, estimatedResponse()));
    await page.waitForTimeout(300);
    await expectStartScreen(page);
    await expect(resultRoot(page)).toHaveCount(0);
    await expect(dialog(page)).toHaveCount(0);

    // 새 병원은 독립된 세션이다: 시작하면 선택이 비어 있다.
    await startButton(page).click();
    await expectK01(page);
    await expect(page.getByRole('radio', { checked: true })).toHaveCount(0);
  });

  test('결과가 있는 화면에서 다른 병원으로 이동하면 새 병원에 이전 환자의 금액·선택이 보이지 않는다', async ({ page }) => {
    const api = await openKiosk(page);
    await routeOtherClinic(page);
    await reachNormalResult(page, api);
    await page.evaluate((target) => (window as unknown as { next: { router: { push: (href: string) => void } } }).next.router.push(target), `/kiosk/${OTHER}`);
    await expect(headerOf(page, 'TEST_FIXTURE 다른 의원')).toBeVisible();
    await expectNoPreviousResult(page);
  });

  test('다른 병원 화면으로 갔다가 돌아와도(뒤로) 옛 병원 화면은 빈 시작 화면이다', async ({ page }) => {
    const api = await openKiosk(page);
    await routeOtherClinic(page);
    await reachNormalResult(page, api);
    await page.evaluate((target) => (window as unknown as { next: { router: { push: (href: string) => void } } }).next.router.push(target), `/kiosk/${OTHER}`);
    await expect(headerOf(page, 'TEST_FIXTURE 다른 의원')).toBeVisible();
    await page.goBack();
    await expect(headerOf(page, 'TEST_FIXTURE 시험 의원')).toBeVisible();
    await expectNoPreviousResult(page);
  });
});

test.describe('초기화와 늦은 응답의 경합 (AC-016c)', () => {
  test('계산 중 "처음으로" 확인 → 다음 환자가 시작·입력한 뒤 옛 응답이 도착해도 새 화면은 바뀌지 않는다', async ({ page }) => {
    const api = await openKiosk(page);
    const held = api.hold('estimate');
    await toFilledK03(page);
    await confirmButton(page).click();
    await held.arrived();
    await page.locator('.kiosk-underlay .kiosk-bottom-actions').getByRole('button', { name: '처음으로' }).click();
    await dialog(page).getByRole('button', { name: '처음으로' }).click();
    await expectStartScreen(page);
    await startButton(page).click();
    await expectK01(page);
    await page.getByRole('radio', { name: '2세대(C1)' }).check();
    held.release(reply(200, notCoveredResponse()));
    await page.waitForTimeout(300);
    await expectK01(page);
    await expect(resultRoot(page)).toHaveCount(0);
    await expect(page.getByRole('radio', { name: '2세대(C1)' })).toBeChecked();
  });
});
