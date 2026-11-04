import { expect, test } from '../helpers/test';
import type { Locator, Page } from '@playwright/test';
import { mockClinicApi } from '../helpers/api';
import { installClock, swallowLongTimers } from '../helpers/clock';
import { KIOSK_PATH, dialog, expectK01, expectStartScreen, generationRadio, startButton, underlayHome } from '../helpers/kiosk';

// 가로채기 층 (BRIEF D4·D12): 세션의 브라우저 쪽 경계. 만료된 세션은 어떤 환자 조작보다 먼저 지운다(5e6fb05), 뒤로·앞으로·새로고침·페이지 복원은 빈 세션이다(AC-016d).
// 환자 입력이 있어야 의미가 있어 1단계의 세대 카드 선택을 쓴다.

const generation = (page: Page): Locator => generationRadio(page);
const homeButton = (page: Page): Locator => underlayHome(page);

async function beginWithInput(page: Page): Promise<void> {
  await page.goto(KIOSK_PATH);
  await expectStartScreen(page);
  await startButton(page).click();
  await expectK01(page);
  await generation(page).check();
}

test.beforeEach(async ({ page }) => {
  await mockClinicApi(page);
});

test.describe('만료된 세션은 환자 조작보다 먼저 지운다 (5e6fb05)', () => {
  test('대조군: 만료 전에는 같은 "처음으로" 터치가 확인창을 연다', async ({ page }) => {
    await installClock(page);
    await swallowLongTimers(page);
    await beginWithInput(page);
    await page.clock.fastForward(60_000);
    await homeButton(page).click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText('선택 내용을 지우고 처음으로 돌아갈까요?');
  });

  test('초기화 시각(120초)이 지났지만 타이머 콜백이 아직 돌지 않았을 때(절전·느린 기기) 환자의 첫 터치는 세션을 잇지 못하고 새 빈 시작 화면을 연다', async ({ page }) => {
    await installClock(page);
    // 긴 타이머는 울리지 않게 해서 "시계는 갔는데 콜백이 늦는" 상황을 만든다. 화면은 아직 옛 입력 화면이다.
    await swallowLongTimers(page);
    await beginWithInput(page);
    await page.clock.fastForward(125_000);
    await expectK01(page);
    await expect(dialog(page)).toHaveCount(0);

    await homeButton(page).click();
    // "처음으로" 사건이 옛 세션에 적용되었다면 확인창이 떴을 것이다. 만료 초기화가 먼저라 새 시작 화면이고 확인창은 없다.
    await expectStartScreen(page);
    await expect(dialog(page)).toHaveCount(0);
  });

  test('다른 버튼을 눌러도 같다: 만료 뒤 카드 선택 터치는 선택이 아니라 새 시작 화면이다', async ({ page }) => {
    await installClock(page);
    await swallowLongTimers(page);
    await beginWithInput(page);
    await page.clock.fastForward(125_000);
    await generationRadio(page, '4세대(C4)').click();
    await expectStartScreen(page);
  });

  test('키 입력으로도 같다: 만료 뒤 첫 키 입력이 세션을 지운다', async ({ page }) => {
    await installClock(page);
    await swallowLongTimers(page);
    await beginWithInput(page);
    await page.clock.fastForward(125_000);
    await page.keyboard.press('Shift');
    await expectStartScreen(page);
  });

  test('만료 직전(119초)에는 세션이 이어진다 (경계 대조군)', async ({ page }) => {
    await installClock(page);
    await swallowLongTimers(page);
    await beginWithInput(page);
    await page.clock.fastForward(119_000);
    await homeButton(page).click();
    await expect(dialog(page)).toBeVisible();
  });
});

test.describe('뒤로·앞으로·새로고침·페이지 복원 (AC-016d)', () => {
  test('pageshow persisted(페이지 캐시 복원)는 빈 시작 화면이다. persisted 가 아니면 아무 일도 없다', async ({ page }) => {
    await beginWithInput(page);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })));
    await expectK01(page);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await expectStartScreen(page);
    await expect(dialog(page)).toHaveCount(0);
  });

  test('새로고침은 빈 시작 화면이다 (이전 입력이 복원되지 않는다)', async ({ page }) => {
    await beginWithInput(page);
    await page.reload();
    await expectStartScreen(page);
  });

  test('다른 문서로 갔다가 뒤로 가기: 빈 시작 화면이다 (no-store 라 복원 대신 다시 불러온다)', async ({ page }) => {
    await beginWithInput(page);
    await page.goto('about:blank');
    await page.goBack();
    await expectStartScreen(page);
    expect(page.url()).toContain(KIOSK_PATH);
    await page.goForward();
    await page.goBack();
    await expectStartScreen(page);
  });

  test('단계를 지나는 동안 기록 항목이 쌓이지 않으므로 뒤로 가기는 키오스크 밖으로 나간다 (한 단계 뒤로 가는 길이 없다)', async ({ page }) => {
    await page.goto('about:blank');
    await page.goto(KIOSK_PATH);
    await expectStartScreen(page);
    await startButton(page).click();
    await expectK01(page);
    await generation(page).click();
    await page.goBack();
    expect(page.url()).toBe('about:blank');
  });
});
