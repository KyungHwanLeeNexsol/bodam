import { expect, test } from '../helpers/test';
import { installClock } from '../helpers/clock';
import { dialog, expectStartScreen } from '../helpers/kiosk';
import { expectLayoutClean, openKiosk, setLargeText } from '../helpers/input';
import { resetDialog, timeoutDialog } from '../helpers/results';
import { docsPagerNext, docsPagerStatus, normalWith, openDocuments, reachResult, reachSheetScreen, sheetBack, sheetHome, singleCauseDocuments, unknownCauseDocuments, visibleDocKeys } from '../helpers/sheets';
import { DOCUMENT_LINE_KEYS } from '../../../src/engine/types';

// 가로채기 층 (SPEC-REIMBURSEMENT-001 M6 S3b, BRIEF D8·D12): 근거·서류 화면 위의 겹침창과 쪽 넘김의 보강 시험.
// sheets.intercept.spec.ts 가 내용·복귀·이용 완료·겹침창의 기본 동작을 보고, 여기는 기본 정책 시간(160/180초, AC-015b), 겹침창의 초점 가둠, 쪽을 넘길 때 본문 스크롤 위치를 본다.

test.describe('근거·서류 화면의 무조작 정책: 기본값은 결과 화면과 같은 160초 경고·180초 초기화 (AC-015b)', () => {
  for (const screen of ['K04_Basis_Calculation', 'K07_Documents', 'K07_Documents_Unknown'] as const) {
    test(`${screen}: 155초에는 겹침창이 없고 162초에 경고, 더 두면 180초에 시작 화면이며 이용 완료 화면을 거치지 않는다`, async ({ page }) => {
      await installClock(page);
      const api = await openKiosk(page);
      await reachSheetScreen(page, api, screen);
      await page.clock.runFor(155_000);
      await expect(dialog(page)).toHaveCount(0);
      await page.clock.runFor(7_000);
      await expect(timeoutDialog(page)).toBeVisible();
      await page.clock.runFor(20_000);
      await expectStartScreen(page);
      await expect(page.getByText('이용해 주셔서 감사합니다')).toHaveCount(0);
    });
  }
});

test.describe('근거·서류 화면 위 ResetConfirm: 초점이 확인창 안에 갇히고 닫으면 "처음으로" 로 돌아온다', () => {
  for (const screen of ['K04_Basis_Calculation', 'K07_Documents'] as const) {
    test(`${screen}: Tab 을 여러 번 눌러도 초점이 확인창 밖으로 나가지 않는다`, async ({ page }) => {
      const api = await openKiosk(page);
      await reachSheetScreen(page, api, screen);
      await sheetHome(page).click();
      await expect(resetDialog(page)).toBeVisible();
      for (let count = 0; count < 8; count += 1) {
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null), `Tab ${count + 1}번째`).toBe(true);
      }
      await page.keyboard.press('Shift+Tab');
      expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true);
      await resetDialog(page).getByRole('button', { name: '계속 이용' }).click();
      await expect(sheetHome(page)).toBeFocused();
    });
  }
});

test.describe('큰 글자 보기의 서류 화면(운영 자료 모양, 디자인 예시 구성): 쪽마다 스크롤 없이 한 화면에 들어간다 (AC-007i, DD-12)', () => {
  for (const unknown of [false, true]) {
    test(`${unknown ? '원인 모름(7+1+1)' : '단일 원인'}: 모든 쪽의 본문이 보이는 높이 안에 있고 레이아웃이 깨끗하다`, async ({ page }) => {
      const api = await openKiosk(page);
      await reachResult(page, api, normalWith(unknown ? unknownCauseDocuments({ origin: 'OPERATING' }) : singleCauseDocuments({ origin: 'OPERATING' }), 'OPERATING'), unknown ? 'UNKNOWN' : 'INJURY');
      await openDocuments(page, unknown ? 'documents-unknown' : 'documents');
      await setLargeText(page, true);
      const seen: string[] = [];
      for (let guard = 0; guard < 12; guard += 1) {
        const fit = await page.locator('.kiosk-sheet__body').evaluate((element) => ({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
        expect(fit.scrollHeight, `쪽 ${guard + 1}: 본문 ${fit.scrollHeight} > 보이는 높이 ${fit.clientHeight}`).toBeLessThanOrEqual(fit.clientHeight + 1);
        await expectLayoutClean(page, `큰 글자 서류 쪽 ${guard + 1}`);
        seen.push(...(await visibleDocKeys(page)));
        if ((await docsPagerNext(page).getAttribute('aria-disabled')) === 'true') break;
        await docsPagerNext(page).click();
      }
      expect([...seen].sort()).toEqual([...DOCUMENT_LINE_KEYS].sort());
    });
  }
});

test.describe('쪽을 넘기면 본문이 맨 위로 돌아간다 (AC-007i)', () => {
  test('앞 쪽을 아래까지 내려 읽은 뒤 "다음 목록"을 눌러도 새 쪽의 첫 줄이 보인다', async ({ page }) => {
    const api = await openKiosk(page);
    await reachSheetScreen(page, api, 'K07_Documents_Unknown_Wide');
    await setLargeText(page, true);
    const body = page.locator('.kiosk-sheet__body');
    await body.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    expect(await body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await docsPagerNext(page).click();
    await expect(docsPagerStatus(page)).toContainText('2 /');
    expect(await body.evaluate((element) => element.scrollTop)).toBe(0);
    expect((await visibleDocKeys(page)).length).toBeGreaterThan(0);
  });
});

test.describe('가로형 원인 모름 서류의 쪽: 분기 묶음만 있는 쪽도 줄이 빠지지 않는다', () => {
  test('큰 글자로 모든 쪽을 앞으로 넘기면 아홉 줄이 한 번씩이고 분기 머리글은 분기 줄이 있는 쪽에만 있다', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.endsWith('landscape'), '가로형에서만 본다');
    const api = await openKiosk(page);
    await reachSheetScreen(page, api, 'K07_Documents_Unknown_Wide');
    await setLargeText(page, true);
    const seen: string[] = [];
    for (let guard = 0; guard < 12; guard += 1) {
      const keys = await visibleDocKeys(page);
      seen.push(...keys);
      const branchLines = await page.locator('.kiosk-doc-branch [data-doc-line]').count();
      expect(await page.locator('.kiosk-doc-branch').count(), `쪽 ${guard + 1}`).toBe(branchLines > 0 ? 1 : 0);
      if ((await docsPagerNext(page).getAttribute('aria-disabled')) === 'true') break;
      await docsPagerNext(page).click();
    }
    expect([...seen].sort()).toEqual([...DOCUMENT_LINE_KEYS].sort());
    await sheetBack(page).click();
  });
});
