import { test } from '../helpers/test';
import { INPUT_SCREENS, reachScreen } from '../helpers/screens';
import { makeCatalog } from '../../fixtures/kiosk/clinic.fixture';
import { installClock } from '../helpers/clock';
import { dialog } from '../helpers/kiosk';
import { openKiosk, setLargeText } from '../helpers/input';
import { RESULT_SCREENS, reachResultScreen } from '../helpers/results';
import { SHEET_SCREENS, reachSheetScreen } from '../helpers/sheets';
import { SHOTS_ENABLED, shot } from '../helpers/shot';

// 화면 목록 사진 (BRIEF D12): SHOTS=1 일 때만 만든 화면 상태마다 두 방향 × 일반/큰 글자 사진을 .moai/state/shots/ 에 쓴다. SHOTS 가 없으면 건너뛴다.
// 사진은 육안 검토용 자료이고 어떤 인수 기준의 증거도 아니다(레이아웃 판정은 layout.intercept.spec.ts 가 브라우저에서 잰다). 입력 단계(S2)·결과 쪽 화면(S3a)·근거·서류·이용 완료 화면(S3b)을 같은 방식으로 만든다.

test.skip(!SHOTS_ENABLED, 'SHOTS=1 일 때만 사진을 만든다');

for (const large of [false, true]) {
  for (const screen of INPUT_SCREENS) {
    test(`${screen} ${large ? '큰 글자' : '일반'}`, async ({ page }, testInfo) => {
      const api = await openKiosk(page);
      if (large) await setLargeText(page, true);
      await reachScreen(page, api, screen);
      await shot(page, testInfo, screen, large);
    });
  }
  for (const screen of RESULT_SCREENS) {
    test(`${screen} ${large ? '큰 글자' : '일반'}`, async ({ page }, testInfo) => {
      const api = await openKiosk(page);
      if (large) await setLargeText(page, true);
      await reachResultScreen(page, api, screen);
      await shot(page, testInfo, screen, large);
    });
  }

  for (const screen of SHEET_SCREENS) {
    test(`${screen} ${large ? '큰 글자' : '일반'}`, async ({ page }, testInfo) => {
      const api = await openKiosk(page);
      if (large) await setLargeText(page, true);
      await reachSheetScreen(page, api, screen);
      if (large && screen === 'K06_Complete') await setLargeText(page, true); // 이용 완료는 큰 글자를 끄므로 이 화면에서 다시 켠다
      await shot(page, testInfo, screen, large);
    });
  }

  // S4: 시작 화면과 갱신 재시도, 입력 화면 위의 처음으로 확인창(디자인 K03_Treatments_Dialog_Reset)도 목록에 넣는다.
  test(`K00_Start ${large ? '큰 글자' : '일반'}`, async ({ page }, testInfo) => {
    await openKiosk(page);
    if (large) await setLargeText(page, true);
    await shot(page, testInfo, 'K00_Start', large);
  });

  test(`K03_Treatments_RefreshRetry ${large ? '큰 글자' : '일반'}`, async ({ page }, testInfo) => {
    const api = await openKiosk(page);
    if (large) await setLargeText(page, true);
    await reachScreen(page, api, 'K03_Treatments_RefreshFailed');
    const catalog = api.hold('catalog');
    const options = api.hold('options');
    await page.locator('[data-kiosk-refresh="failed"]').getByRole('button', { name: '다시 시도' }).click();
    await page.locator('[data-kiosk-refresh="running"]').waitFor();
    await catalog.arrived();
    await options.arrived();
    await shot(page, testInfo, 'K03_Treatments_RefreshRetry', large);
  });

  test(`K03_Treatments_Dialog_Reset ${large ? '큰 글자' : '일반'}`, async ({ page }, testInfo) => {
    const api = await openKiosk(page);
    if (large) await setLargeText(page, true);
    await reachScreen(page, api, 'K03_Treatments_Selected');
    await page.locator('.kiosk-underlay').getByRole('button', { name: '처음으로' }).click();
    await dialog(page).waitFor();
    await shot(page, testInfo, 'K03_Treatments_Dialog_Reset', large);
  });

  // 겹침창이 결과·계산 중 화면 위에 열린 모습: 무조작 경고(K04_Result_Dialog_Timeout)와 처음으로 확인창. 가짜 시계와 짧은 무조작 정책으로 연다.
  for (const [name, screen, open] of [
    ['K04_Result_Dialog_Timeout', 'K04_Result', 'timeout'],
    ['KXX_Loading_Calculating_Dialog_Reset', 'KXX_Loading_Calculating', 'reset'],
  ] as const) {
    test(`${name} ${large ? '큰 글자' : '일반'}`, async ({ page }, testInfo) => {
      await installClock(page);
      const policy = { screens: { INPUT: { warnSeconds: 100, resetSeconds: 120 }, RESULT: { warnSeconds: 5, resetSeconds: 60 }, BASIS_AND_DOCUMENTS: { warnSeconds: 160, resetSeconds: 180 }, HOLD_RESULT: { warnSeconds: 160, resetSeconds: 180 }, NOTICE_PROGRESS_ERROR: { warnSeconds: 100, resetSeconds: 120 } }, completionHoldSeconds: null };
      const api = await openKiosk(page, { catalog: makeCatalog({ idlePolicy: policy }) });
      if (large) await setLargeText(page, true);
      await reachResultScreen(page, api, screen);
      if (open === 'timeout') await page.clock.runFor(5_500);
      else await page.locator('.kiosk-underlay').getByRole('button', { name: '처음으로' }).click();
      await dialog(page).waitFor();
      await shot(page, testInfo, name, large);
    });
  }

  // 겹침창이 근거·서류 화면 위에 열린 모습(S3b).
  for (const [name, screen, open] of [
    ['K07_Documents_Dialog_Timeout', 'K07_Documents', 'timeout'],
    ['K04_Basis_Calculation_Dialog_Reset', 'K04_Basis_Calculation', 'reset'],
  ] as const) {
    test(`${name} ${large ? '큰 글자' : '일반'}`, async ({ page }, testInfo) => {
      await installClock(page);
      const policy = { screens: { INPUT: { warnSeconds: 100, resetSeconds: 120 }, RESULT: { warnSeconds: 160, resetSeconds: 180 }, BASIS_AND_DOCUMENTS: { warnSeconds: 8, resetSeconds: 60 }, HOLD_RESULT: { warnSeconds: 160, resetSeconds: 180 }, NOTICE_PROGRESS_ERROR: { warnSeconds: 100, resetSeconds: 120 } }, completionHoldSeconds: null };
      const api = await openKiosk(page, { catalog: makeCatalog({ idlePolicy: policy }) });
      if (large) await setLargeText(page, true);
      await reachSheetScreen(page, api, screen);
      if (open === 'timeout') await page.clock.runFor(9_000);
      else await page.locator('.kiosk-underlay .kiosk-sheet .kiosk-bottom-actions').getByRole('button', { name: '처음으로' }).click();
      await dialog(page).waitFor();
      await shot(page, testInfo, name, large);
    });
  }
}
