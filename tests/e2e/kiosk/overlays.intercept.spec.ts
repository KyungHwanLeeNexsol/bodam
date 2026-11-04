import { expect, test } from '../helpers/test';
import type { Locator, Page } from '@playwright/test';
import { makeCatalog } from '../../fixtures/kiosk/clinic.fixture';
import { mockClinicApi } from '../helpers/api';
import { installClock } from '../helpers/clock';
import { KIOSK_PATH, dialog, expectK01, expectStartScreen, generationRadio, root, startButton, underlayHome } from '../helpers/kiosk';

// 가로채기 층 (BRIEF D8·D12): 겹침창 둘(ResetConfirm·TimeoutDialog)의 모달 의미·초점 가두기·초점 복귀·키보드, 그리고 DD-07·DD-13 의 전이를 실제 Chrome 과 가짜 시계로 본다.
// 환자 입력이 있어야 ResetConfirm 이 뜨므로 1단계의 세대 카드를 먼저 고른다. 무조작 정책(경고·초기화 시각)은 catalog.idlePolicy 에서 온다(주입).
// AC-015e·g·j·k 의 브라우저 쪽 일부를 닫는다. 서버 응답이 겹침창 위에 도착하는 경우(AC-015l~p)는 results-overlays.intercept.spec.ts 가 본다.

const CARD = '2세대(C1)';
const generation = (page: Page): Locator => generationRadio(page, CARD);
const homeButton = (page: Page): Locator => underlayHome(page);
const resetDialog = (page: Page): Locator => dialog(page).filter({ hasText: '선택 내용을 지우고 처음으로 돌아갈까요?' });
const timeoutDialog = (page: Page): Locator => dialog(page).filter({ hasText: '계속 사용하시겠어요?' });

async function begin(page: Page): Promise<void> {
  await page.goto(KIOSK_PATH);
  await expectStartScreen(page);
  await startButton(page).click();
  await expectK01(page);
}

async function beginWithInput(page: Page): Promise<void> {
  await begin(page);
  await generation(page).check();
  await expect(generation(page)).toBeFocused();
}

/** 화면에 열렸던 대화상자 제목을 순서대로 기록한다 (두 겹침창이 동시에 열린 순간, ResetConfirm 이 열린 적 없음을 나중에 증명하려고). */
async function recordDialogs(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    let maxAtOnce = 0;
    (window as unknown as { __dialogs: { seen: string[]; maxAtOnce: () => number } }).__dialogs = { seen, maxAtOnce: () => maxAtOnce };
    new MutationObserver(() => {
      const open = document.querySelectorAll('[role="dialog"]');
      maxAtOnce = Math.max(maxAtOnce, open.length);
      for (const element of open) {
        const title = element.querySelector('h2')?.textContent ?? '';
        if (seen[seen.length - 1] !== title) seen.push(title);
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

const dialogHistory = (page: Page): Promise<{ seen: string[]; maxAtOnce: number }> =>
  page.evaluate(() => {
    const recorded = (window as unknown as { __dialogs: { seen: string[]; maxAtOnce: () => number } }).__dialogs;
    return { seen: recorded.seen, maxAtOnce: recorded.maxAtOnce() };
  });

const focusedText = (page: Page): Promise<string> => page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText.trim() ?? '');

test.beforeEach(async ({ page }) => {
  await installClock(page);
  await mockClinicApi(page);
  await recordDialogs(page);
});

test.describe('ResetConfirm: 처음으로 확인창 (AC-015g·AC-015j)', () => {
  test('입력이 없으면 확인창 없이 바로 시작 화면이다 (AC-015j)', async ({ page }) => {
    await begin(page);
    await homeButton(page).click();
    await expectStartScreen(page);
    await expect(dialog(page)).toHaveCount(0);
    expect((await dialogHistory(page)).seen).toEqual([]);
  });

  test('입력이 있으면 확인창이 먼저 뜬다: 모달 의미, 이름·설명, 밑 화면 inert, 처음 초점은 "계속 이용"', async ({ page }) => {
    await beginWithInput(page);
    await homeButton(page).click();
    const confirm = resetDialog(page);
    await expect(confirm).toBeVisible();
    await expect(confirm).toHaveAttribute('aria-modal', 'true');
    await expect(confirm).toHaveAccessibleName('선택 내용을 지우고 처음으로 돌아갈까요?');
    await expect(confirm).toHaveAccessibleDescription('지금까지 선택한 보험 조건과 치료가 모두 지워집니다.');
    await expect(page.locator('.kiosk-underlay')).toHaveAttribute('inert', '');
    await expect(page.locator('.kiosk-underlay')).toHaveAttribute('aria-hidden', 'true');
    await expect(confirm.getByRole('button', { name: '계속 이용' })).toBeFocused();
    expect(await confirm.getByRole('button').allInnerTexts()).toEqual(['계속 이용', '처음으로']);
    // 밑 화면의 버튼은 누를 수도 초점을 줄 수도 없다.
    expect(await page.evaluate(() => document.querySelector('.kiosk-underlay')?.contains(document.activeElement))).toBe(false);
  });

  test('Tab·Shift+Tab 은 창 안에서만 돈다 (포커스 가두기)', async ({ page }) => {
    await beginWithInput(page);
    await homeButton(page).click();
    await expect(resetDialog(page)).toBeVisible();
    const order: string[] = [await focusedText(page)];
    for (let index = 0; index < 5; index += 1) {
      await page.keyboard.press('Tab');
      order.push(await focusedText(page));
    }
    expect(order).toEqual(['계속 이용', '처음으로', '계속 이용', '처음으로', '계속 이용', '처음으로']);
    await page.keyboard.press('Shift+Tab');
    expect(await focusedText(page)).toBe('계속 이용');
    await page.keyboard.press('Shift+Tab');
    expect(await focusedText(page)).toBe('처음으로');
  });

  test('"계속 이용" = 취소: 선택·화면이 그대로이고 초점은 열기 전 "처음으로" 버튼으로 돌아간다', async ({ page }) => {
    await beginWithInput(page);
    await homeButton(page).focus();
    await homeButton(page).click();
    await resetDialog(page).getByRole('button', { name: '계속 이용' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expectK01(page);
    await expect(homeButton(page)).toBeFocused();
    await expect(page.locator('.kiosk-underlay')).not.toHaveAttribute('inert', '');
  });

  test('Escape = 취소와 같다. 초점은 열기 전 버튼으로 돌아간다', async ({ page }) => {
    await beginWithInput(page);
    await homeButton(page).click();
    await expect(resetDialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expectK01(page);
    await expect(homeButton(page)).toBeFocused();
  });

  test('"처음으로" = 확인: 전체 삭제 후 시작 화면(이용 완료 화면을 거치지 않는다). 초점은 시작 화면의 대표 제목으로 간다', async ({ page }) => {
    await beginWithInput(page);
    await homeButton(page).click();
    await resetDialog(page).getByRole('button', { name: '처음으로' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expectStartScreen(page);
    await expect(page.locator('[data-kiosk-primary]')).toBeFocused();
    await expect(page.getByText('이용해 주셔서 감사합니다')).toHaveCount(0);
    // 새 세션: 다시 시작하면 빈 K01 이다 (이전 선택이 남지 않는다는 상태 쪽 증거는 단위 시험이 본다).
    await startButton(page).click();
    await expectK01(page);
  });

  test('키보드만으로 확인창을 열고(Enter) 닫을 수 있다', async ({ page }) => {
    await beginWithInput(page);
    await homeButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(resetDialog(page)).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toHaveCount(0);
    await expect(homeButton(page)).toBeFocused();
  });
});

test.describe('TimeoutDialog: 무조작 경고 (AC-015e·AC-015k)', () => {
  test('입력 화면 무입력 100초(기본 정책)에 열린다: 남은 시간·두 버튼·모달 의미. 밑 화면은 그대로 있고 inert 다', async ({ page }) => {
    await beginWithInput(page);
    await page.clock.runFor(99_000);
    await expect(dialog(page)).toHaveCount(0);
    await page.clock.runFor(1_500);
    const warning = timeoutDialog(page);
    await expect(warning).toBeVisible();
    await expect(warning).toHaveAttribute('aria-modal', 'true');
    await expect(warning).toHaveAccessibleName('계속 사용하시겠어요?');
    await expect(warning.locator('.kiosk-countdown__value')).toHaveText(/^(20|19)$/);
    await expect(warning).toContainText('남은 시간');
    expect(await warning.getByRole('button').allInnerTexts()).toEqual(['처음으로', '계속 사용할게요']);
    // 겹침창이 열려 있는 동안 밑 화면은 접근성 트리에서 숨겨져(aria-hidden) 역할 조회에 잡히지 않으므로 DOM 으로 확인한다.
    await expect(page.locator('.kiosk-underlay h1')).toHaveText('내 실손보험을 선택해 주세요');
    await expect(page.locator('.kiosk-underlay')).toHaveAttribute('inert', '');
    await expect(warning.getByRole('button', { name: '계속 사용할게요' })).toBeFocused();
  });

  test('남은 시간은 줄어든다(표시 전용: 사건이 없다). Escape 는 무시하고, Tab 은 창 안에서 돈다', async ({ page }) => {
    await beginWithInput(page);
    await page.clock.runFor(100_500);
    const value = timeoutDialog(page).locator('.kiosk-countdown__value');
    await expect(value).toHaveText(/^(20|19)$/);
    const first = Number(await value.innerText());
    await page.clock.runFor(5_000);
    const second = Number(await value.innerText());
    expect(second).toBeLessThanOrEqual(first - 4);
    await page.keyboard.press('Escape');
    await expect(timeoutDialog(page)).toBeVisible();
    await page.keyboard.press('Tab');
    expect(await focusedText(page)).toBe('처음으로');
    await page.keyboard.press('Tab');
    expect(await focusedText(page)).toBe('계속 사용할게요');
    await page.keyboard.press('Shift+Tab');
    expect(await focusedText(page)).toBe('처음으로');
  });

  test('"계속 사용할게요": 닫히고 시간을 처음부터 다시 센다 (반복 연장). 초점은 열리기 전 요소로 돌아간다', async ({ page }) => {
    await beginWithInput(page);
    for (let round = 0; round < 3; round += 1) {
      // 첫 회는 100초 뒤, 그다음은 연장한 시각에서 99초를 보낸 뒤 1.5초만 더 보낸다(그래야 연장한 시각부터 100초다).
      await page.clock.runFor(round === 0 ? 100_500 : 1_500);
      await expect(timeoutDialog(page)).toBeVisible();
      await timeoutDialog(page).getByRole('button', { name: '계속 사용할게요' }).click();
      await expect(dialog(page)).toHaveCount(0);
      await expectK01(page);
      await expect(generation(page)).toBeFocused();
      // 연장한 시각부터 다시 센다: 99초 뒤에는 아직 열리지 않는다.
      await page.clock.runFor(99_000);
      await expect(dialog(page)).toHaveCount(0);
    }
  });

  test('열리기 전에 초점이 없었으면 지금 화면의 대표 제목으로 돌아간다', async ({ page }) => {
    await begin(page);
    await page.clock.runFor(100_500);
    await expect(timeoutDialog(page)).toBeVisible();
    await timeoutDialog(page).getByRole('button', { name: '계속 사용할게요' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('[data-kiosk-primary]')).toBeFocused();
  });

  test('경고 안의 "처음으로": 확인창 없이 바로 시작 화면 (입력이 있어도, AC-015e)', async ({ page }) => {
    await beginWithInput(page);
    await page.clock.runFor(100_500);
    await timeoutDialog(page).getByRole('button', { name: '처음으로' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expectStartScreen(page);
    const history = await dialogHistory(page);
    expect(history.seen).toEqual(['계속 사용하시겠어요?']);
    expect(history.maxAtOnce).toBe(1);
    await expect(page.getByText('이용해 주셔서 감사합니다')).toHaveCount(0);
  });

  test('아무도 만지지 않으면 120초에 시작 화면으로 초기화된다 (경고창이 열린 채로)', async ({ page }) => {
    await beginWithInput(page);
    await page.clock.runFor(100_500);
    await expect(timeoutDialog(page)).toBeVisible();
    await page.clock.runFor(20_000);
    await expect(dialog(page)).toHaveCount(0);
    await expectStartScreen(page);
  });

  test('시작 화면에는 무조작 타이머가 없다 (지울 환자 데이터가 없다)', async ({ page }) => {
    await page.goto(KIOSK_PATH);
    await expectStartScreen(page);
    await page.clock.runFor(10 * 60_000);
    await expectStartScreen(page);
    await expect(dialog(page)).toHaveCount(0);
  });

  test('경고 시점은 병원 정책(catalog.idlePolicy)에서 온다: 입력 30초 경고·45초 초기화이면 남은 시간은 15초다', async ({ page }) => {
    await mockClinicApi(page, {
      catalog: makeCatalog({
        idlePolicy: {
          screens: {
            INPUT: { warnSeconds: 30, resetSeconds: 45 },
            RESULT: { warnSeconds: 160, resetSeconds: 180 },
            BASIS_AND_DOCUMENTS: { warnSeconds: 160, resetSeconds: 180 },
            HOLD_RESULT: { warnSeconds: 160, resetSeconds: 180 },
            NOTICE_PROGRESS_ERROR: { warnSeconds: 100, resetSeconds: 120 },
          },
          completionHoldSeconds: null,
        },
      }),
    });
    await beginWithInput(page);
    await page.clock.runFor(29_000);
    await expect(dialog(page)).toHaveCount(0);
    await page.clock.runFor(1_500);
    await expect(timeoutDialog(page)).toBeVisible();
    await expect(timeoutDialog(page).locator('.kiosk-countdown__value')).toHaveText(/^(15|14)$/);
    // 경고창의 안내 문장은 병원 정책과 상관없는 두 문장뿐이다 (디자인 예시의 100초·160초 수치를 싣지 않는다).
    const text = await timeoutDialog(page).innerText();
    expect(text).not.toMatch(/100초|160초/);
    await page.clock.runFor(15_000);
    await expectStartScreen(page);
  });
});

test.describe('두 겹침창이 겹칠 때 (AC-015k)', () => {
  test('ResetConfirm 이 열린 채 경고 시점이 되면 TimeoutDialog 가 대신 열린다 (동시에 둘이 열린 순간이 없다). "계속 사용할게요" 뒤에는 ResetConfirm 이 아니라 밑 화면이다', async ({ page }) => {
    await beginWithInput(page);
    await homeButton(page).focus();
    await homeButton(page).click();
    await expect(resetDialog(page)).toBeVisible();
    await page.clock.runFor(100_500);
    await expect(timeoutDialog(page)).toBeVisible();
    await expect(resetDialog(page)).toHaveCount(0);
    await timeoutDialog(page).getByRole('button', { name: '계속 사용할게요' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expectK01(page);
    // 초점은 두 겹침창이 열리기 전의 처음 위치("처음으로" 버튼)로 돌아간다.
    await expect(homeButton(page)).toBeFocused();
    const history = await dialogHistory(page);
    expect(history.seen).toEqual(['선택 내용을 지우고 처음으로 돌아갈까요?', '계속 사용하시겠어요?']);
    expect(history.maxAtOnce).toBe(1);
  });

  test('ResetConfirm 을 열어 둔 시간은 초기화를 늦추지 않는다: 열기 직전 터치에서 120초에 초기화된다', async ({ page }) => {
    await beginWithInput(page);
    await homeButton(page).click();
    await expect(resetDialog(page)).toBeVisible();
    await page.clock.runFor(100_500);
    await expect(timeoutDialog(page)).toBeVisible();
    await page.clock.runFor(20_000);
    await expectStartScreen(page);
    await expect(dialog(page)).toHaveCount(0);
  });
});

test.describe('겹침창과 큰 글자 보기', () => {
  test('겹침창이 열려 있으면 밑 화면의 "큰 글자 보기"는 눌러도 바뀌지 않는다 (inert)', async ({ page }) => {
    await beginWithInput(page);
    await homeButton(page).click();
    await expect(resetDialog(page)).toBeVisible();
    await expect(root(page)).toHaveAttribute('data-large-text', 'false');
    await page.locator('.kiosk-toggle').click({ force: true });
    await expect(root(page)).toHaveAttribute('data-large-text', 'false');
  });

  test('큰 글자 보기를 켜면 겹침창의 글자와 버튼도 커지고 기능은 같다', async ({ page }) => {
    await beginWithInput(page);
    await page.getByRole('button', { name: '큰 글자 보기' }).click();
    await homeButton(page).click();
    const confirm = resetDialog(page);
    await expect(confirm).toBeVisible();
    const size = await confirm.locator('.kiosk-dialog__title').evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    expect(size).toBeGreaterThan(40);
    for (const name of ['계속 이용', '처음으로']) {
      const box = await confirm.getByRole('button', { name }).boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(72);
    }
    const viewport = page.viewportSize();
    const dialogBox = await confirm.boundingBox();
    expect((dialogBox?.y ?? 0) + (dialogBox?.height ?? 0)).toBeLessThanOrEqual(viewport?.height ?? 0);
    expect(dialogBox?.y).toBeGreaterThanOrEqual(0);
  });
});
