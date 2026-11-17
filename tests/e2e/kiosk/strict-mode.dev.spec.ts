import { expect, test } from '../helpers/test';
import { reply } from '../helpers/api';
import { installClock } from '../helpers/clock';
import { dialog, expectStartScreen } from '../helpers/kiosk';
import { openKiosk } from '../helpers/input';
import { confirmButton, idlePolicyWith, resultRoot, toFilledK03 } from '../helpers/results';
import { makeCatalog } from '../../fixtures/kiosk/clinic.fixture';
import { estimatedResponse } from '../../fixtures/kiosk/estimate-response.fixture';

// 개발 서버 층 (BRIEF D3, 지시서 4번): React Strict Mode 는 효과를 "만들고 → 정리하고 → 다시 만든다". 컨트롤러·구독·진행 중 요청·타이머가 그 이중 실행에서 새지 않는지 실제 Chrome 으로 본다.
// 운영 빌드는 효과를 한 번만 돌리므로 이 시험은 개발 서버(playwright.dev.config.ts)에서만 의미가 있다. 응답은 가로채기(시험 자료)다.

test('Strict Mode 가 켜져 있다: 병원 자료 불러오기 효과가 두 번 돌았다(첫 시도는 취소되고 마지막만 화면을 만든다)', async ({ page }) => {
  const api = await openKiosk(page);
  // 전제 확인: 이중 실행이 실제로 있었다. 없었다면 아래 시험은 Strict Mode 를 시험한 것이 아니다.
  expect(api.callsTo('catalog').length, '병원 자료 요청 수(Strict Mode 면 2 이상)').toBeGreaterThanOrEqual(2);
  await expectStartScreen(page);
});

test('이중 실행 뒤에도 계산 요청은 한 번만 나가고 결과가 한 번 그려진다', async ({ page }) => {
  const api = await openKiosk(page);
  await toFilledK03(page);
  api.queue('estimate', reply(200, estimatedResponse()));
  await confirmButton(page).click();
  await expect(resultRoot(page)).toBeVisible();
  expect(api.callsTo('estimate'), '계산 요청 수').toHaveLength(1);
  await expect(page.locator('[data-result]')).toHaveCount(1);
});

test('이중 실행 뒤에도 무조작 경고는 한 번, 초기화는 한 번이다(옛 컨트롤러의 타이머가 남지 않는다)', async ({ page }) => {
  await installClock(page);
  const catalog = { ...makeCatalog(), idlePolicy: idlePolicyWith({ INPUT: { warnSeconds: 20, resetSeconds: 40 } }) };
  await openKiosk(page, { catalog });
  await page.getByRole('button', { name: '시작하기' }).click();
  await page.clock.runFor(20_500);
  await expect(dialog(page), '경고창은 하나다').toHaveCount(1);
  await page.clock.runFor(20_000);
  await expectStartScreen(page);
  await expect(dialog(page)).toHaveCount(0);
  // 한참 더 지나도 옛 타이머가 되살아나 경고창이나 화면 변화를 일으키지 않는다.
  await page.clock.runFor(200_000);
  await expectStartScreen(page);
  await expect(dialog(page)).toHaveCount(0);
});
