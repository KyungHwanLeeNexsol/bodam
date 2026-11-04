import { expect, test } from '../helpers/test';
import { installClock } from '../helpers/clock';
import { SLUG as HARNESS_CLINIC_SLUG, dialog, expectK01, expectStartScreen, isLandscape, root, startButton } from '../helpers/kiosk';

// 실제 핸들러 층 (BRIEF D12): 시험용 앞단 서버가 /api/clinics/* 를 실제 핸들러(handleCatalog·handleOptions)에 시험 자료(TEST_FIXTURE) 서비스로 맡긴다.
// 실제 핸들러의 논리를 시험 자료로 돌린 것이며 운영 자료 검증이 아니다. 키오스크가 실제 서버 응답 모양(병원 자료·무조작 정책·헤더)을 읽을 수 있는지를 본다.

const PATH = `/kiosk/${HARNESS_CLINIC_SLUG}`;

test.describe('실제 catalog·options 응답으로 시작', () => {
  test('시작 화면: 병원명은 실제 catalog 핸들러의 clinic.displayName, 서비스명은 serviceDisplayName 이다', async ({ page }, testInfo) => {
    const catalog = page.waitForResponse((response) => response.url().endsWith(`/api/clinics/${HARNESS_CLINIC_SLUG}/catalog`));
    const options = page.waitForResponse((response) => response.url().endsWith(`/api/clinics/${HARNESS_CLINIC_SLUG}/insurance/options`));
    await page.goto(PATH);
    await expectStartScreen(page);

    const catalogResponse = await catalog;
    const optionsResponse = await options;
    expect(catalogResponse.status()).toBe(200);
    expect(optionsResponse.status()).toBe(200);
    // 실제 핸들러가 만든 응답: 모든 응답이 no-store, JSON.
    for (const response of [catalogResponse, optionsResponse]) {
      expect(response.headers()['cache-control']).toBe('no-store');
      expect(response.headers()['content-type']).toContain('application/json');
    }
    const body = (await catalogResponse.json()) as { clinic: { displayName: string }; serviceDisplayName: string; idlePolicy: { screens: Record<string, { warnSeconds: number }> } };
    await expect(page.locator('.kiosk-hospital__name')).toHaveText(body.clinic.displayName);
    await expect(page.locator('h1')).toHaveText(body.serviceDisplayName);
    expect(body.idlePolicy.screens.INPUT?.warnSeconds).toBe(100);
    await expect(root(page)).toHaveAttribute('data-orientation', isLandscape(testInfo) ? 'landscape' : 'portrait');
  });

  test('실제 응답의 규칙 묶음 상태와 카드 목록(세대 5·형태 3·원인 3)으로 시작해 다음 화면이 열린다', async ({ page }) => {
    await page.goto(PATH);
    await expectStartScreen(page);
    await startButton(page).click();
    await expectK01(page);
    expect(await page.getByRole('radio').evaluateAll((inputs) => inputs.map((input) => input.getAttribute('aria-label')))).toEqual(['1세대(A·S)', '2세대(C1)', '2.5세대(C2)', '3세대(C3)', '4세대(C4)']);
  });

  test('모르는 병원은 실제 핸들러의 404 CLINIC_NOT_FOUND 로 병원 없음 화면이다', async ({ page, request }) => {
    const catalog = page.waitForResponse((response) => response.url().endsWith('/api/clinics/unknown-clinic/catalog'));
    await page.goto('/kiosk/unknown-clinic');
    const response = await catalog;
    expect(response.status()).toBe(404);
    expect(response.headers()['cache-control']).toBe('no-store');
    // 키오스크는 404 본문을 읽지 않는다(상태 번호만 본다). 본문은 같은 실제 핸들러에 직접 물어 확인한다.
    const direct = await request.get('/api/clinics/unknown-clinic/catalog');
    expect(direct.status()).toBe(404);
    expect(await direct.json()).toEqual({ error: 'CLINIC_NOT_FOUND' });
    await expect(page.locator('[data-kiosk-state="NOT_FOUND"]')).toBeVisible();
    expect(await page.locator('body').innerText()).not.toContain('CLINIC_NOT_FOUND');
  });

  test('실제 정책(입력 100초 경고·120초 초기화)대로 경고창이 열리고 "계속 사용할게요"로 닫힌다', async ({ page }) => {
    await installClock(page);
    await page.goto(PATH);
    await expectStartScreen(page);
    await startButton(page).click();
    await expectK01(page);
    await page.clock.runFor(99_000);
    await expect(dialog(page)).toHaveCount(0);
    await page.clock.runFor(1_500);
    await expect(dialog(page)).toContainText('계속 사용하시겠어요?');
    await dialog(page).getByRole('button', { name: '계속 사용할게요' }).click();
    await expect(dialog(page)).toHaveCount(0);
  });

  test('키오스크 문서도 같은 서버에서 no-store 로 내려온다 (프록시를 거쳐도 헤더가 유지된다)', async ({ page }) => {
    const response = await page.goto(PATH);
    expect(response?.headers()['cache-control']).toBe('no-store');
  });
});
