import { expect, test } from '../helpers/test';
import type { FrameLocator, Page } from '@playwright/test';
import { installClock } from '../helpers/clock';
import { SLUG } from '../helpers/kiosk';
import { TEST_NOTICE } from '../harness/notice';
import { TITLES } from '../helpers/input';

// 미리보기 층 (SPEC-REIMBURSEMENT-001 M6, 2026-11-04 소유자 지시): 사람이 보는 미리보기와 같은 앞단(--test-notice)을 거친다. 앞단이 키오스크 문서를 "고정 안내 띠 + 앱 틀(iframe)"로 감싸므로
// "테스트 데이터로 계산한 예시입니다. 실제 보험금 안내에 사용할 수 없습니다."가 계산 응답 전·통신 오류·초기화·이용 완료를 포함한 모든 화면에서 같은 자리에 보인다.
// 계산은 *.real 과 같은 실제 핸들러(handleCatalog·handleOptions·handleEstimate)와 시험 자료(TEST_FIXTURE)다. 통신 오류와 응답 지연은 page.route 로 만든 것이라 가로채기 층의 증거다.
// 운영 구성(next start 를 앞단 없이 연 것)에 안내 띠가 없다는 것은 not-found.production.spec.ts 가 본다.

const PATH = `/kiosk/${SLUG}`;
const app = (page: Page): FrameLocator => page.frameLocator('iframe.preview-app');
const notice = (page: Page) => page.locator('[data-test-notice]');

interface Geometry {
  y: number;
  x: number;
  width: number;
  height: number;
}

async function noticeGeometry(page: Page): Promise<Geometry> {
  const box = await notice(page).boundingBox();
  expect(box).not.toBeNull();
  return box as Geometry;
}

/** 안내 띠가 지금 화면에 온전히 있다: 문장이 그대로이고, 맨 위 같은 자리·같은 크기이며, 잘리지 않고, 앱 틀과 겹치지 않는다. */
async function expectNoticeFixed(page: Page, baseline: Geometry, where: string): Promise<void> {
  await expect(notice(page), where).toHaveText(TEST_NOTICE);
  await expect(notice(page), where).toBeInViewport({ ratio: 1 });
  const box = await noticeGeometry(page);
  expect(box.y, `${where}: 맨 위`).toBe(0);
  expect(box.x, `${where}: 왼쪽`).toBe(baseline.x);
  expect(box.width, `${where}: 너비`).toBe(baseline.width);
  expect(box.height, `${where}: 높이`).toBe(baseline.height);
  expect(await notice(page).evaluate((element) => element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1), `${where}: 글이 잘리지 않음`).toBe(true);
  // 앱 틀은 띠 바로 아래에서 시작해 화면 끝까지 간다(띠가 앱을 가리지 않는다).
  const frame = await page.locator('iframe.preview-app').boundingBox();
  expect(frame).not.toBeNull();
  expect(Math.abs((frame as Geometry).y - (box.y + box.height)), `${where}: 틀 시작`).toBeLessThanOrEqual(1);
  const viewport = page.viewportSize() as { width: number; height: number };
  expect(Math.abs((frame as Geometry).y + (frame as Geometry).height - viewport.height), `${where}: 틀 끝`).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth && document.documentElement.scrollHeight <= document.documentElement.clientHeight), `${where}: 바깥 문서가 넘치지 않음`).toBe(true);
}

async function next(page: Page): Promise<void> {
  await app(page).getByRole('button', { name: '다음', exact: true }).click();
}

async function openToTreatments(page: Page): Promise<void> {
  const kiosk = app(page);
  await kiosk.getByRole('button', { name: '시작하기' }).click();
  await expect(kiosk.getByRole('heading', { name: TITLES.generation })).toBeVisible();
  await kiosk.getByRole('radio', { name: '4세대(C4)' }).check();
  await next(page);
  await expect(kiosk.getByRole('heading', { name: TITLES.type })).toBeVisible();
  await kiosk.getByRole('radio', { name: '손해보험사' }).check();
  await next(page);
  await expect(kiosk.getByRole('heading', { name: TITLES.cause })).toBeVisible();
  await kiosk.getByRole('radio').first().check();
  await next(page);
  await expect(kiosk.getByRole('heading', { name: TITLES.treatments })).toBeVisible();
  await kiosk.getByRole('checkbox').nth(0).check();
  await kiosk.getByRole('checkbox').nth(1).check();
}

test.describe('시험 데이터 안내는 처음부터 끝까지 같은 자리에 있다', () => {
  test('계산 응답 전(병원 자료 지연) → 입력 → 계산 → 결과 → 이용 완료: 모든 단계에서 안내 띠가 그대로다', async ({ page }) => {
    // 병원 자료(catalog) 응답을 붙잡아, 앱이 아직 아무 응답도 받지 못한 순간을 만든다.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/clinics/*/catalog', async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto(PATH, { waitUntil: 'commit' });
    await expect(notice(page)).toBeVisible();
    const baseline = await noticeGeometry(page);
    await expectNoticeFixed(page, baseline, '병원 자료 응답 전');
    await expect(app(page).getByRole('button', { name: '시작하기' })).toHaveCount(0);
    // 틀 안 문서는 같은 주소이며 쿼리 같은 것이 붙지 않는다(세션 값도 주소에 없다).
    expect(await page.locator('iframe.preview-app').getAttribute('src')).toBe(PATH);
    release();

    const kiosk = app(page);
    await expect(kiosk.getByRole('button', { name: '시작하기' })).toBeVisible();
    await expectNoticeFixed(page, baseline, '시작');

    await openToTreatments(page);
    await expectNoticeFixed(page, baseline, '치료 선택');

    // 계산을 붙잡아 "계산 중"에도 띠가 있는지 본다.
    let releaseEstimate: () => void = () => undefined;
    const estimateGate = new Promise<void>((resolve) => {
      releaseEstimate = resolve;
    });
    await page.route('**/estimate', async (route) => {
      await estimateGate;
      await route.continue();
    });
    await kiosk.getByRole('button', { name: '예상 부담액 확인' }).click();
    await expect(kiosk.locator('[data-kiosk-state="CALCULATING"]')).toBeVisible();
    await expectNoticeFixed(page, baseline, '계산 중');
    releaseEstimate();

    await expect(kiosk.locator('[data-result="normal"]')).toBeVisible();
    await expectNoticeFixed(page, baseline, '정상 결과');
    // 금액은 실제 핸들러가 시험 자료로 계산한 값이다(0원이나 빈 값이 아님).
    await expect(kiosk.locator('[data-kiosk-amount="payout"] .kiosk-amount__value')).toHaveText(/^[1-9][\d,]*원$/);

    await kiosk.getByRole('button', { name: '계산 근거 보기' }).click();
    await expect(kiosk.locator('[data-sheet]')).toBeVisible();
    await expectNoticeFixed(page, baseline, '계산 근거');
    await kiosk.locator('.kiosk-sheet .kiosk-bottom-actions').getByRole('button', { name: '이용 완료' }).click();
    await expect(kiosk.locator('[data-kiosk-state="COMPLETE"]')).toBeVisible();
    await expectNoticeFixed(page, baseline, '이용 완료');
  });

  test('통신 오류(5xx) 화면과 다시 시도 뒤 결과에서도 안내 띠가 있다', async ({ page }) => {
    let attempts = 0;
    await page.route('**/estimate', async (route) => {
      attempts += 1;
      if (attempts === 1) await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"INTERNAL_ERROR"}' });
      else await route.continue();
    });
    await page.goto(PATH);
    const baseline = await noticeGeometry(page);
    await openToTreatments(page);
    const kiosk = app(page);
    await kiosk.getByRole('button', { name: '예상 부담액 확인' }).click();
    await expect(kiosk.locator('[data-kiosk-state="NETWORK_ERROR"]')).toBeVisible();
    await expectNoticeFixed(page, baseline, '통신 오류');
    await kiosk.getByRole('button', { name: '다시 시도' }).click();
    await expect(kiosk.locator('[data-result="normal"]')).toBeVisible();
    await expectNoticeFixed(page, baseline, '다시 시도 뒤 결과');
    expect(attempts).toBe(2);
  });

  test('초기화(처음으로 → 확인)와 무조작 자동 초기화 뒤 시작 화면에서도 안내 띠가 있다', async ({ page }) => {
    await installClock(page);
    await page.goto(PATH);
    const baseline = await noticeGeometry(page);
    const kiosk = app(page);
    await kiosk.getByRole('button', { name: '시작하기' }).click();
    await expect(kiosk.getByRole('heading', { name: TITLES.generation })).toBeVisible();
    await kiosk.getByRole('radio', { name: '2세대(C1)' }).check();

    // 환자가 직접 "처음으로": 확인창이 열린 동안에도, 확인한 뒤에도 띠가 있다.
    await kiosk.getByRole('button', { name: '처음으로' }).click();
    await expect(kiosk.getByRole('dialog')).toBeVisible();
    await expectNoticeFixed(page, baseline, '초기화 확인창');
    await kiosk.getByRole('dialog').getByRole('button', { name: '처음으로' }).click();
    await expect(kiosk.getByRole('button', { name: '시작하기' })).toBeVisible();
    await expectNoticeFixed(page, baseline, '초기화 뒤');

    // 아무 조작이 없을 때: 100초에 경고, 120초에 처음 화면 (제어 가능한 가짜 시계로 흘려 보냄).
    await kiosk.getByRole('button', { name: '시작하기' }).click();
    await expect(kiosk.getByRole('heading', { name: TITLES.generation })).toBeVisible();
    await page.clock.runFor(101_000);
    await expect(kiosk.getByRole('dialog')).toContainText('계속 사용하시겠어요?');
    await expectNoticeFixed(page, baseline, '무조작 경고');
    await page.clock.runFor(21_000);
    await expect(kiosk.getByRole('button', { name: '시작하기' })).toBeVisible();
    await expectNoticeFixed(page, baseline, '무조작 자동 초기화 뒤');
  });

  test('병원이 없을 때(실제 핸들러 404)도 안내 띠가 있고 앱은 이용할 수 없다는 안내만 보인다', async ({ page }) => {
    await page.goto('/kiosk/no-such-clinic');
    await expect(app(page).locator('[data-kiosk-state="NOT_FOUND"]')).toBeVisible();
    await expectNoticeFixed(page, await noticeGeometry(page), '병원 없음');
  });

  test('관리자 화면(시험 로그인 뒤 가격 관리)에서도 안내 띠가 같은 자리에 고정되고, 앱 틀 안에서 관리자 화면이 쿠키 로그인으로 동작한다', async ({ page, browser }) => {
    await page.goto('/__harness/login');
    await expect(notice(page)).toHaveText(TEST_NOTICE);
    await page.locator('[data-test-account="ha-clinic-1"]').click();
    await expect(page).toHaveURL(/\/admin\/TEST_FIXTURE_CLINIC_1\/treatments$/);
    const baseline = await noticeGeometry(page);
    await expectNoticeFixed(page, baseline, '관리자 화면');
    await expect(app(page).locator('[data-admin-state="ready"]')).toBeVisible();
    await expect(app(page).locator('[data-admin-clinic]')).toHaveText('TEST_FIXTURE 시험 의원');
    // 로그인하지 않은 새 맥락에서는 같은 주소가 로그인 필요 안내이고 띠는 그대로다.
    const origin = new URL(page.url()).origin;
    const other = await browser.newContext({ viewport: page.viewportSize() as { width: number; height: number } });
    const anonymous = await other.newPage();
    await anonymous.goto(`${origin}/admin/TEST_FIXTURE_CLINIC_1/treatments`);
    await expect(anonymous.frameLocator('iframe.preview-app').locator('[data-admin-state="unauthenticated"]')).toBeVisible();
    await expect(anonymous.locator('[data-test-notice]')).toHaveText(TEST_NOTICE);
    await other.close();
  });

  test('앞단은 브라우저 화면 이동에만 틀을 씌운다: 스크립트·curl 같은 요청은 앱 문서를 그대로 받고 응답 헤더는 no-store 다', async ({ page, request }) => {
    // 틀 안 앱 문서의 요청(같은 주소, iframe 요청)을 따로 잡는다.
    const innerDocument = page.waitForResponse((response) => response.url().endsWith(PATH) && response.request().frame() !== page.mainFrame());
    const top = await page.goto(PATH);
    expect(top?.status()).toBe(200);
    expect(top?.headers()['cache-control']).toBe('no-store');
    const inner = await innerDocument;
    expect(inner.status()).toBe(200);
    expect(inner.headers()['cache-control']).toBe('no-store'); // AC-021g: 틀 안 앱 문서도 프록시를 거쳐 no-store 다
    expect(await inner.text()).not.toContain('data-test-notice');
    const raw = await request.get(PATH);
    expect(raw.status()).toBe(200);
    expect(raw.headers()['cache-control']).toBe('no-store');
    expect(await raw.text()).not.toContain('data-test-notice');
  });
});
