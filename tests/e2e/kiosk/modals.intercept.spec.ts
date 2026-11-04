import { expect, test } from '../helpers/test';
import type { Locator, Page } from '@playwright/test';
import type { ApiMock } from '../helpers/api';
import { makeCatalog } from '../../fixtures/kiosk/clinic.fixture';
import { installClock } from '../helpers/clock';
import { dialog, underlayHome } from '../helpers/kiosk';
import { openKiosk } from '../helpers/input';
import { reachScreen } from '../helpers/screens';
import type { InputScreenName } from '../helpers/screens';
import { reachResultScreen, resetDialog, timeoutDialog } from '../helpers/results';
import type { ResultScreenName } from '../helpers/results';
import { reachSheetScreen } from '../helpers/sheets';
import type { SheetScreenName } from '../helpers/sheets';

// 가로채기 층 (S4 D4, AC-017d): 겹침창 둘(ResetConfirm·TimeoutDialog)의 모달 의미·초점 가두기·Escape·초점 복귀를 "밑 화면의 모든 종류"에서 본다.
// overlays.intercept.spec.ts 는 입력 화면(K01) 하나에서 같은 약속을 자세히 본다. 여기서는 같은 약속이 계산 중·결과 셋·통신 오류·계산 근거·서류·세대 확인 안내 위에서도 지켜지는지 넓힌다.
//  - 한 번에 하나만 열린다(role=dialog 가 항상 1개). 밑 화면은 inert·aria-hidden. 처음 초점은 안전한 쪽 단추. Tab·Shift+Tab 은 창 안에서만 돈다.
//  - ResetConfirm: Escape = 취소, 닫으면 열기 전 "처음으로" 단추로 돌아온다. TimeoutDialog: Escape 는 무시, "계속 사용할게요" 뒤 열기 전 초점 요소(없으면 화면의 대표 제목)로 돌아온다.
// 무조작 경고는 모든 화면 종류를 5초로 줄인 병원 정책(catalog.idlePolicy)과 가짜 시계로 연다.

type Reach = (page: Page, api: ApiMock) => Promise<void>;

interface Entry {
  readonly name: string;
  readonly reach: Reach;
  /** "처음으로" 단추가 있는 화면(ResetConfirm 을 열 수 있다). 통신 오류·세대 확인 안내 화면에는 없다. */
  readonly hasHome: boolean;
}

const input = (name: InputScreenName, hasHome = true): Entry => ({ name, hasHome, reach: (page, api) => reachScreen(page, api, name) });
const result = (name: ResultScreenName, hasHome = true): Entry => ({ name, hasHome, reach: (page, api) => reachResultScreen(page, api, name) });
const sheet = (name: SheetScreenName): Entry => ({ name, hasHome: true, reach: (page, api) => reachSheetScreen(page, api, name) });

const ENTRIES: readonly Entry[] = [
  input('K01_Generation_Selected'),
  input('K01_Generation_Unknown', false),
  input('K02_Type_Selected'),
  input('K02b_Cause_Selected'),
  input('K03_Treatments_Selected'),
  result('KXX_Loading_Calculating'),
  result('K04_Result'),
  result('K04_Result_NotCovered'),
  result('K04_Result_Hold'),
  result('KXX_Error_Network', false),
  sheet('K04_Basis_Calculation'),
  sheet('K07_Documents'),
  sheet('K07_Documents_Unknown'),
];

const WARN_SECONDS = 5;
const policy = (() => {
  const each = { warnSeconds: WARN_SECONDS, resetSeconds: 300 };
  return { screens: { INPUT: each, RESULT: each, BASIS_AND_DOCUMENTS: each, HOLD_RESULT: each, NOTICE_PROGRESS_ERROR: each }, completionHoldSeconds: null };
})();

const dialogs = (page: Page): Locator => page.locator('[role="dialog"]');

/** 지금 초점이 창 안에 있는가. */
const focusInsideDialog = (page: Page): Promise<boolean> => page.evaluate(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement) === true);

async function expectModalBasics(page: Page): Promise<void> {
  await expect(dialogs(page)).toHaveCount(1);
  await expect(dialog(page)).toHaveAttribute('aria-modal', 'true');
  await expect(page.locator('.kiosk-underlay')).toHaveAttribute('inert', '');
  await expect(page.locator('.kiosk-underlay')).toHaveAttribute('aria-hidden', 'true');
  expect(await focusInsideDialog(page), '창이 열리면 초점이 창 안으로 옮겨져야 한다').toBe(true);
}

async function expectTrap(page: Page): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    await page.keyboard.press('Tab');
    expect(await focusInsideDialog(page), `Tab ${String(index + 1)}번째: 초점이 창 밖으로 나갔다`).toBe(true);
  }
  for (let index = 0; index < 3; index += 1) {
    await page.keyboard.press('Shift+Tab');
    expect(await focusInsideDialog(page), `Shift+Tab ${String(index + 1)}번째: 초점이 창 밖으로 나갔다`).toBe(true);
  }
}

test.beforeEach(async ({ page }) => {
  await installClock(page);
});

for (const entry of ENTRIES) {
  test.describe(`${entry.name} 위의 겹침창`, () => {
    if (entry.hasHome) {
      test('ResetConfirm: 한 번에 하나, 밑 화면 inert, 초점 가두기, Escape = 취소, 열기 전 "처음으로" 단추로 초점 복귀', async ({ page }) => {
        const api = await openKiosk(page);
        await entry.reach(page, api);
        const opener = underlayHome(page);
        await opener.click();
        await expect(resetDialog(page)).toBeVisible();
        await expectModalBasics(page);
        await expectTrap(page);
        await page.keyboard.press('Escape');
        await expect(dialogs(page)).toHaveCount(0);
        await expect(page.locator('.kiosk-underlay')).not.toHaveAttribute('inert', '');
        await expect(opener).toBeFocused();
      });
    }

    test('TimeoutDialog: 한 번에 하나, 밑 화면 inert, 초점 가두기, Escape 무시, "계속 사용할게요" 뒤 열기 전 초점(없으면 대표 제목)으로 복귀', async ({ page }) => {
      const api = await openKiosk(page, { catalog: makeCatalog({ idlePolicy: policy }) });
      await entry.reach(page, api);
      // 열기 전 초점 요소를 잡아 둔다(없으면 body). 창이 닫힌 뒤 같은 요소여야 한다.
      const hadFocus = await page.evaluate(() => {
        const active = document.activeElement;
        const mark = active !== null && active !== document.body && !active.hasAttribute('data-kiosk-primary');
        (window as unknown as { __prior: Element | null }).__prior = mark ? active : null;
        return mark;
      });
      await page.clock.runFor((WARN_SECONDS + 1) * 1000);
      await expect(timeoutDialog(page)).toBeVisible();
      await expectModalBasics(page);
      await expect(dialog(page).getByRole('button', { name: '계속 사용할게요' })).toBeFocused();
      await expectTrap(page);
      await page.keyboard.press('Escape');
      await expect(timeoutDialog(page)).toBeVisible();
      await expect(dialogs(page)).toHaveCount(1);

      await dialog(page).getByRole('button', { name: '계속 사용할게요' }).click();
      await expect(dialogs(page)).toHaveCount(0);
      await expect(page.locator('.kiosk-underlay')).not.toHaveAttribute('inert', '');
      if (hadFocus) {
        expect(await page.evaluate(() => document.activeElement === (window as unknown as { __prior: Element | null }).__prior), '열리기 전에 초점이 있던 요소로 돌아와야 한다').toBe(true);
      } else {
        await expect(page.locator('[data-kiosk-primary]')).toBeFocused();
      }
    });
  });
}
