import { expect, test } from '../helpers/test';
import { INPUT_SCREENS, reachScreen } from '../helpers/screens';
import { auditLayout, expectLayoutClean, openKiosk, setLargeText } from '../helpers/input';
import { RESULT_SCREENS, reachResultScreen } from '../helpers/results';
import { SHEET_SCREENS, reachSheetScreen } from '../helpers/sheets';

// 가로채기 층 (BRIEF D12): 입력 단계 화면 전부와 결과 쪽 화면(S3a: 계산 중·결과 셋·긴 금액·통신 오류), 근거·서류·이용 완료 화면(S3b)을 두 방향(프로젝트) × 일반/큰 글자에서 브라우저로 잰다 (AC-017a·AC-017b·AC-017f 의 터치 영역, AC-020i 의 "잘림 없음").
// 잘림·겹침·화면 밖·가려짐·터치 영역 72px 은 auditLayout(helpers/input.ts)이 실제 레이아웃에서 잰다. 서버 렌더링 문자열로는 잴 수 없다.

for (const large of [false, true]) {
  test.describe(`레이아웃 감사 - ${large ? '큰 글자 보기' : '일반'}`, () => {
    for (const screen of INPUT_SCREENS) {
      test(`${screen}: 잘림·겹침·화면 밖·가려짐 없음, 조작 요소 72px 이상`, async ({ page }, testInfo) => {
        const api = await openKiosk(page);
        if (large) await setLargeText(page, true);
        await reachScreen(page, api, screen);
        await expectLayoutClean(page, `${screen} ${testInfo.project.name} ${large ? 'large' : 'normal'}`);
      });
    }
    for (const screen of RESULT_SCREENS) {
      test(`${screen}: 금액·안내·버튼이 잘리거나 겹치거나 화면 밖으로 나가지 않고, 조작 요소는 72px 이상`, async ({ page }, testInfo) => {
        const api = await openKiosk(page);
        if (large) await setLargeText(page, true);
        await reachResultScreen(page, api, screen);
        await expectLayoutClean(page, `${screen} ${testInfo.project.name} ${large ? 'large' : 'normal'}`);
      });
    }
    for (const screen of SHEET_SCREENS) {
      test(`${screen}: 표·서류 줄·안내·버튼이 잘리거나 겹치거나 화면 밖으로 나가지 않고, 조작 요소는 72px 이상`, async ({ page }, testInfo) => {
        const api = await openKiosk(page);
        if (large) await setLargeText(page, true);
        await reachSheetScreen(page, api, screen);
        // 이용 완료는 전체 삭제로 큰 글자가 꺼지므로(상태 기계) 이 화면에서 다시 켠다: 큰 글자의 이용 완료 화면을 잰다.
        if (large && screen === 'K06_Complete') await setLargeText(page, true);
        await expectLayoutClean(page, `${screen} ${testInfo.project.name} ${large ? 'large' : 'normal'}`);
      });
    }
  });
}

test.describe('화면 전환 뒤에도 큰 글자·방향을 유지하고 잘림이 없다', () => {
  test('큰 글자를 켠 채 K01 → K03 까지 이동해도 큰 글자가 유지되고 모든 화면이 깨끗하다', async ({ page }) => {
    const api = await openKiosk(page);
    await setLargeText(page, true);
    for (const screen of ['K01_Generation_Empty', 'K02_Type_Empty', 'K02b_Cause_Empty', 'K03_Treatments_Empty'] as const) {
      if (screen === 'K01_Generation_Empty') await reachScreen(page, api, screen);
      await expect(page.locator('.kiosk-root')).toHaveAttribute('data-large-text', 'true');
      await expectLayoutClean(page, screen);
      if (screen !== 'K03_Treatments_Empty') {
        await page.locator('.kiosk-input__choices input').first().check();
        await page.locator('.kiosk-bottom-actions').getByRole('button', { name: '다음', exact: true }).click();
      }
    }
  });
});

test.describe('감사 도구 자체 점검', () => {
  // 감사가 아무것도 못 찾는 도구라면 위의 통과는 아무 뜻이 없다: 일부러 깨뜨린 화면에서 문제를 찾아내는지 본다.
  const BREAKS: Array<[string, string, string]> = [
    ['겹침', '.kiosk-bottom-actions .kiosk-button { position: absolute !important; left: 0; bottom: 0; width: 300px; }', 'overlap'],
    ['터치 영역', '.kiosk-bottom-actions .kiosk-button { min-height: 0 !important; height: 40px !important; }', 'touch-target'],
    ['화면 밖', '.kiosk-bottom-actions { position: fixed; left: 0; top: 100%; width: 100%; }', 'off-screen'],
    ['잘림', '.kiosk-input__heading { height: 20px; overflow: hidden; }', 'clipped-y'],
    ['가려짐', '.kiosk-input__body::after { content: ""; position: fixed; inset: 0; z-index: 9; }', 'covered'],
  ];
  for (const [name, css, kind] of BREAKS) {
    test(`${name}: 깨뜨린 화면에서 "${kind}" 를 찾아낸다`, async ({ page }) => {
      const api = await openKiosk(page);
      await reachScreen(page, api, 'K03_Treatments_Selected');
      expect(await auditLayout(page)).toEqual([]);
      await page.addStyleTag({ content: css });
      const kinds = (await auditLayout(page)).map((problem) => problem.kind);
      expect(kinds).toContain(kind);
    });
  }

  // 결과 화면: 금액·안내·버튼·터치 영역을 일부러 깨뜨려 감사가 그것을 찾아내는지 본다 (AC-017: 금액이 잘리거나 겹치는 결함이 초록으로 통과하지 않는다).
  const RESULT_BREAKS: Array<[string, string, string]> = [
    ['금액이 카드 밖으로 넘침', '.kiosk-amount__value { font-size: 260px !important; }', 'content-overflow-x'],
    ['안내와 금액 카드가 포개짐', '.kiosk-notice { position: absolute !important; top: 520px; left: 40px; width: 900px; }', 'block-overlap'],
    ['동작 버튼이 겹침', '.kiosk-result-actions .kiosk-button { position: absolute !important; left: 0; bottom: 0; width: 300px; }', 'overlap'],
    ['동작 버튼 터치 영역', '.kiosk-result-actions .kiosk-button { min-height: 0 !important; height: 40px !important; }', 'touch-target'],
    ['금액이 잘림', '.kiosk-amount__value { height: 10px; overflow: hidden; }', 'clipped-y'],
    ['동작 막대가 화면 밖', '.kiosk-result-actions { position: fixed; left: 0; top: 100%; width: 100%; }', 'off-screen'],
  ];
  for (const [name, css, kind] of RESULT_BREAKS) {
    test(`결과 화면 - ${name}: 깨뜨린 화면에서 "${kind}" 를 찾아낸다`, async ({ page }) => {
      const api = await openKiosk(page);
      await reachResultScreen(page, api, 'K04_Result');
      expect(await auditLayout(page)).toEqual([]);
      await page.addStyleTag({ content: css });
      const kinds = (await auditLayout(page)).map((problem) => problem.kind);
      expect(kinds).toContain(kind);
    });
  }

  // 근거·서류 화면(S3b): 서류 줄·표·동작 막대를 일부러 깨뜨려 감사가 찾아내는지 본다 (잘림·겹침이 초록으로 통과하지 않는다).
  const SHEET_BREAKS: Array<[string, string, string, string]> = [
    ['서류 줄이 서로 포개짐', 'K07_Documents', '.kiosk-doc-list { display: block !important; } .kiosk-doc { position: absolute !important; left: 48px; top: 700px; width: 600px; }', 'block-overlap'],
    ['동작 버튼이 겹침', 'K07_Documents', '.kiosk-sheet .kiosk-bottom-actions .kiosk-button { position: absolute !important; left: 0; bottom: 0; width: 300px; }', 'overlap'],
    ['동작 버튼 터치 영역', 'K07_Documents', '.kiosk-sheet .kiosk-bottom-actions .kiosk-button { min-height: 0 !important; height: 40px !important; }', 'touch-target'],
    ['동작 막대가 화면 밖', 'K04_Basis_Calculation', '.kiosk-sheet .kiosk-bottom-actions { position: fixed; left: 0; top: 100%; width: 100%; }', 'off-screen'],
    ['표가 카드 밖으로 넘침', 'K04_Basis_Calculation', '.kiosk-table { min-width: 2400px; }', 'content-overflow-x'],
    ['본문이 동작 막대 밑으로 들어감', 'K04_Basis_Calculation', '.kiosk-sheet__body { margin-bottom: -200px; }', 'body-under-footer'],
    ['쪽 넘김 단추 터치 영역', 'K07_Documents', '.kiosk-pager__button { min-height: 0 !important; height: 40px !important; }', 'touch-target'],
  ];
  for (const [name, screen, css, kind] of SHEET_BREAKS) {
    test(`근거·서류 화면 - ${name}: 깨뜨린 화면에서 "${kind}" 를 찾아낸다`, async ({ page }) => {
      const api = await openKiosk(page);
      if (name.startsWith('쪽 넘김')) await setLargeText(page, true);
      await reachSheetScreen(page, api, screen as 'K07_Documents' | 'K04_Basis_Calculation');
      expect(await auditLayout(page)).toEqual([]);
      await page.addStyleTag({ content: css });
      const kinds = (await auditLayout(page)).map((problem) => problem.kind);
      expect(kinds).toContain(kind);
    });
  }
});
