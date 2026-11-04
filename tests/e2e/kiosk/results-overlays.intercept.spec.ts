import { expect, test } from '../helpers/test';
import type { Locator, Page } from '@playwright/test';
import { MISMATCH_409, NOT_PUBLISHED_422, reply } from '../helpers/api';
import type { ApiMock, Behavior, Held } from '../helpers/api';
import { installClock, swallowLongTimers } from '../helpers/clock';
import { makeCatalog, makeOptions } from '../../fixtures/kiosk/clinic.fixture';
import { estimatedResponse, holdResponse, notCoveredResponse } from '../../fixtures/kiosk/estimate-response.fixture';
import { dialog, expectStartScreen } from '../helpers/kiosk';
import { TITLES, heading, openKiosk } from '../helpers/input';
import { calculating, idlePolicyWith, networkError, openCalculating, resetDialog, resultRoot, timeoutDialog, under, underCalculating, underError, underResult, underTreatments } from '../helpers/results';

// 가로채기 층 (SPEC-REIMBURSEMENT-001 M6 S3a, BRIEF D8·D12, design.md DD-07 "겹침창이 열려 있는 동안 도착하는 요청 결말"): ResetConfirm·TimeoutDialog 가 계산 중 화면 위에 열려 있을 때 계산 결말이 도착하는 경우를
// 실제 Chrome 과 가짜 시계로 본다. 응답은 시험이 붙잡았다가 정한 시점에 푼다(끝내 오지 않는 응답·늦은 응답 포함).
// AC 대응: AC-015l(ResetConfirm 취소와 응답, 두 순서 모두 같은 끝 화면) · AC-015m(초기화 확정 뒤 응답은 버려짐) · AC-015n(무조작 초기화와 응답) · AC-015o(TimeoutDialog "계속 사용할게요"와 응답) · AC-015p(겹침창이 열린 동안의 요청 만료).
// 상태 기계의 정리 규칙(타이머 수·abort 호출·같은 시도의 늦은 호출)은 단위 시험(M5)이 증명하고, 여기는 환자가 보는 화면과 겹침창 동작·초점·무조작 시간을 본다.
// 계산 요청의 시간 제한은 15초(주입 불가)이므로 경고·초기화 시각은 병원 정책(catalog.idlePolicy)으로 그 앞뒤에 둔다.

const homeOnCalculating = (page: Page): Locator => page.locator('.kiosk-underlay .kiosk-bottom-actions').getByRole('button', { name: '처음으로' });
const NOTICE = (warnSeconds: number, resetSeconds: number) => ({ catalog: makeCatalog({ idlePolicy: idlePolicyWith({ NOTICE_PROGRESS_ERROR: { warnSeconds, resetSeconds } }) }) });

async function boot(page: Page, mock?: Parameters<typeof openKiosk>[1]): Promise<{ api: ApiMock; held: Held }> {
  await installClock(page);
  const api = await openKiosk(page, mock);
  const held = await openCalculating(page, api);
  return { api, held };
}

async function openReset(page: Page): Promise<void> {
  await homeOnCalculating(page).click();
  await expect(resetDialog(page)).toBeVisible();
}

const spent = (page: Page): Promise<void> => page.clock.runFor(300);

type Outcome = { readonly name: string; readonly behavior: Behavior; readonly settled: (page: Page) => Locator; readonly refresh?: true };

const OUTCOMES: readonly Outcome[] = [
  { name: '200 정상', behavior: reply(200, estimatedResponse()), settled: (page) => underResult(page, 'normal') },
  { name: '200 보장 제외', behavior: reply(200, notCoveredResponse()), settled: (page) => underResult(page, 'not-covered') },
  { name: '200 보류', behavior: reply(200, holdResponse()), settled: (page) => underResult(page, 'hold') },
  { name: '500 오류', behavior: reply(500, { error: 'INTERNAL_ERROR' }), settled: underError },
  { name: '409 버전 불일치', behavior: reply(409, MISMATCH_409), settled: underTreatments, refresh: true },
  { name: '422 게시 내려감', behavior: reply(422, NOT_PUBLISHED_422), settled: underTreatments, refresh: true },
];

test.describe('AC-015l: ResetConfirm 이 열린 계산 중 화면 위에 결말이 도착한다', () => {
  for (const outcome of OUTCOMES) {
    test(`${outcome.name}: 취소 전에 도착 → 밑 화면이 바뀌고 확인창은 열린 채이며, 취소하면 계산 중이 아니라 최신 화면이다`, async ({ page }) => {
      const { api, held } = await boot(page);
      await openReset(page);
      const catalogHold = outcome.refresh === true ? api.hold('catalog') : null;
      const optionsHold = outcome.refresh === true ? api.hold('options') : null;
      held.release(outcome.behavior);
      await expect(outcome.settled(page)).toBeVisible();
      await expect(underCalculating(page)).toHaveCount(0);
      // 확인창은 자동으로 닫히거나 확인되지 않는다.
      await expect(resetDialog(page)).toBeVisible();
      await expect(page.locator('.kiosk-underlay')).toHaveAttribute('inert', '');
      if (catalogHold !== null && optionsHold !== null) {
        // 갱신이 진행 중이다: 확인 버튼은 비활성이고 다시 받는 두 요청이 나갔다.
        await catalogHold.arrived();
        await optionsHold.arrived();
        await expect(under(page, '[data-kiosk-refresh="running"]')).toBeVisible();
        catalogHold.release(reply(200, makeCatalog()));
        optionsHold.release(reply(200, makeOptions()));
        await expect(under(page, '[data-kiosk-refresh="running"]')).toHaveCount(0);
      }
      await resetDialog(page).getByRole('button', { name: '계속 이용' }).click();
      await expect(dialog(page)).toHaveCount(0);
      await expect(calculating(page)).toHaveCount(0);
      await expect(outcome.settled(page).first()).toBeVisible();
      // 열기 전에 초점이 있던 계산 중의 "처음으로" 단추는 이미 사라졌다: 초점은 지금 화면의 대표 제목으로 간다 (D8).
      await expect(page.locator('[data-kiosk-primary]')).toBeFocused();
      expect(api.callsTo('estimate')).toHaveLength(1);
    });

    test(`${outcome.name}: 취소한 뒤에 도착해도 끝 화면이 같다 (계산 중에 머물다 결말로 바뀐다)`, async ({ page }) => {
      const { api, held } = await boot(page);
      await openReset(page);
      await resetDialog(page).getByRole('button', { name: '계속 이용' }).click();
      await expect(dialog(page)).toHaveCount(0);
      await expect(calculating(page)).toBeVisible();
      held.release(outcome.behavior);
      // 409·422 의 갱신 두 GET 은 기본 응답(같은 병원 자료)으로 곧바로 끝난다.
      await expect(outcome.settled(page).first()).toBeVisible();
      await expect(calculating(page)).toHaveCount(0);
      expect(api.callsTo('estimate')).toHaveLength(1);
    });
  }

  test('서버 결말은 무조작 남은 시간을 바꾸지 않는다: 확인창을 연 터치에서 센 결과 화면 경고 시각(160초)에 TimeoutDialog 가 확인창을 대신한다', async ({ page }) => {
    const { held } = await boot(page);
    await openReset(page);
    await page.clock.runFor(10_000);
    held.release(reply(200, estimatedResponse()));
    await expect(underResult(page, 'normal')).toBeVisible();
    // 응답이 시간을 다시 시작했다면 경고는 10초 늦은 170초 지점이다. 163초 지점에 이미 열려 있어야 하고, 155초 지점에는 아직 열려 있지 않아야 한다.
    await page.clock.runFor(145_000);
    await expect(resetDialog(page)).toBeVisible();
    await expect(timeoutDialog(page)).toHaveCount(0);
    await page.clock.runFor(8_000);
    await expect(timeoutDialog(page)).toBeVisible();
    await expect(resetDialog(page)).toHaveCount(0);
    await expect(underResult(page, 'normal')).toBeVisible();
  });
});

test.describe('AC-015m: 초기화가 확정된 뒤 도착한 이전 시도의 결말은 반영되지 않는다', () => {
  for (const outcome of OUTCOMES.filter((entry) => entry.name !== '422 게시 내려감')) {
    test(`${outcome.name}: ResetConfirm 의 "처음으로" 뒤 도착 → 새 세션 시작 화면 그대로, 저장소 비어 있고, 다시 받기도 시작되지 않는다`, async ({ page }) => {
      const { api, held } = await boot(page);
      await openReset(page);
      await resetDialog(page).getByRole('button', { name: '처음으로' }).click();
      await expectStartScreen(page);
      await expect(page.getByText('이용해 주셔서 감사합니다')).toHaveCount(0);
      const before = { catalog: api.callsTo('catalog').length, options: api.callsTo('options').length };
      held.release(outcome.behavior);
      await spent(page);
      await expectStartScreen(page);
      await expect(dialog(page)).toHaveCount(0);
      await expect(resultRoot(page)).toHaveCount(0);
      expect(await page.locator('.kiosk-root').innerText()).not.toMatch(/124,000|계산하고 있습니다|계산하지 못했어요/);
      // 409·422 뒤의 catalog·options 다시 받기도 시작되지 않는다.
      expect({ catalog: api.callsTo('catalog').length, options: api.callsTo('options').length }).toEqual(before);
    });
  }

  test('반대 순서(결과가 먼저 반영된 뒤 확인): 결과는 세션 삭제와 함께 지워지고 끝 상태가 같은 시작 화면이다', async ({ page }) => {
    const { held } = await boot(page);
    await openReset(page);
    held.release(reply(200, estimatedResponse()));
    await expect(underResult(page, 'normal')).toBeVisible();
    await resetDialog(page).getByRole('button', { name: '처음으로' }).click();
    await expectStartScreen(page);
    await expect(resultRoot(page)).toHaveCount(0);
  });

  test('TimeoutDialog 안의 "처음으로": 확인창 없이 바로 시작 화면이고, 그 뒤 도착한 200·409 는 반영되지 않는다', async ({ page }) => {
    const { api, held } = await boot(page, NOTICE(5, 60));
    await page.clock.runFor(5_500);
    await expect(timeoutDialog(page)).toBeVisible();
    await timeoutDialog(page).getByRole('button', { name: '처음으로' }).click();
    await expectStartScreen(page);
    await expect(resetDialog(page)).toHaveCount(0);
    const before = api.callsTo('catalog').length;
    held.release(reply(409, MISMATCH_409));
    await spent(page);
    await expectStartScreen(page);
    expect(api.callsTo('catalog').length).toBe(before);
  });

  test('모킹한 AbortController.abort() 가 아무 일도 하지 않아도 같다 (취소가 아니라 활성 요청 해제와 세션 불일치로 막힌다)', async ({ page }) => {
    await installClock(page);
    await page.addInitScript(() => {
      AbortController.prototype.abort = () => undefined;
    });
    const api = await openKiosk(page);
    const held = await openCalculating(page, api);
    await openReset(page);
    await resetDialog(page).getByRole('button', { name: '처음으로' }).click();
    await expectStartScreen(page);
    held.release(reply(200, estimatedResponse()));
    await spent(page);
    await expectStartScreen(page);
    await expect(resultRoot(page)).toHaveCount(0);
  });
});

test.describe('AC-015n: 무조작 초기화와 결말', () => {
  test('TimeoutDialog 가 열린 뒤 초기화 시각 전에 200 이 도착: 밑 화면은 결과가 되지만 확인창은 열린 채이고 초기화 시각은 그대로여서 그 시각에 시작 화면이 된다', async ({ page }) => {
    const { held } = await boot(page, NOTICE(3, 10));
    await page.clock.runFor(3_500);
    await expect(timeoutDialog(page)).toBeVisible();
    const countdown = timeoutDialog(page).locator('.kiosk-countdown__value');
    const first = Number(await countdown.innerText());
    expect(first).toBeLessThanOrEqual(7);
    await page.clock.runFor(2_000);
    held.release(reply(200, estimatedResponse()));
    await expect(underResult(page, 'normal')).toBeVisible();
    await expect(timeoutDialog(page)).toBeVisible();
    // 응답이 초기화 시각을 늘리지 않았다: 남은 시간은 계속 줄어든다.
    const second = Number(await countdown.innerText());
    expect(second).toBeLessThan(first);
    await page.clock.runFor(5_000);
    await expectStartScreen(page);
    await expect(resultRoot(page)).toHaveCount(0);
    await expect(dialog(page)).toHaveCount(0);
  });

  test('초기화 시각이 지난 뒤 도착한 200 은 버려진다 (이미 시작 화면)', async ({ page }) => {
    const { held } = await boot(page, NOTICE(3, 10));
    await page.clock.runFor(10_500);
    await expectStartScreen(page);
    held.release(reply(200, estimatedResponse()));
    await spent(page);
    await expectStartScreen(page);
    await expect(resultRoot(page)).toHaveCount(0);
  });

  for (const [name, behavior] of [['200', reply(200, estimatedResponse())], ['409', reply(409, MISMATCH_409)]] as const) {
    test(`초기화 시각이 지났지만 타이머 콜백이 아직 돌지 않은 때(타이머 지연) ${name} 가 도착: 만료 초기화가 먼저이고 결과는 새 세션에 쓰이지 않으며 다시 받기도 시작되지 않는다`, async ({ page }) => {
      await installClock(page);
      // 긴 타이머(초기화·요청 제한)는 울리지 않게 해서 "시계는 갔는데 콜백이 늦는" 상황을 만든다. 경고(3초)는 짧아서 정상으로 돈다.
      await swallowLongTimers(page, 6_500);
      const api = await openKiosk(page, NOTICE(3, 10));
      const held = await openCalculating(page, api);
      await page.clock.runFor(3_500);
      await expect(timeoutDialog(page)).toBeVisible();
      await page.clock.fastForward(12_000);
      // 초기화 시각(10초)을 넘겼지만 초기화 타이머가 울리지 않아 화면은 아직 옛 화면이다.
      await expect(timeoutDialog(page)).toBeVisible();
      const before = api.callsTo('catalog').length;
      held.release(behavior);
      await expectStartScreen(page);
      await expect(resultRoot(page)).toHaveCount(0);
      await expect(dialog(page)).toHaveCount(0);
      await spent(page);
      expect(api.callsTo('catalog').length).toBe(before);
    });
  }
});

test.describe('AC-015o: TimeoutDialog 의 "계속 사용할게요"와 결말', () => {
  test('응답이 먼저 도착: 밑 화면이 결과가 되고, "계속 사용할게요" 뒤에는 계산 중이 아니라 결과 화면이다. 시간은 결과 화면의 값(160/180초)으로 다시 센다', async ({ page }) => {
    const { held } = await boot(page, NOTICE(5, 60));
    await page.clock.runFor(5_500);
    await expect(timeoutDialog(page)).toBeVisible();
    held.release(reply(200, estimatedResponse()));
    await expect(underResult(page, 'normal')).toBeVisible();
    await expect(timeoutDialog(page)).toBeVisible();
    await timeoutDialog(page).getByRole('button', { name: '계속 사용할게요' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(resultRoot(page)).toHaveAttribute('data-result', 'normal');
    await expect(calculating(page)).toHaveCount(0);
    // 다시 센 시간: 결과 화면의 경고 160초. 158초 지점에는 없고 162초 지점에는 열려 있다.
    await page.clock.runFor(158_000);
    await expect(dialog(page)).toHaveCount(0);
    await page.clock.runFor(4_000);
    await expect(timeoutDialog(page)).toBeVisible();
  });

  test('"계속 사용할게요"가 먼저: 계산 중에 머물다가 응답이 오면 결과 화면이 된다', async ({ page }) => {
    const { held } = await boot(page, NOTICE(5, 60));
    await page.clock.runFor(5_500);
    await timeoutDialog(page).getByRole('button', { name: '계속 사용할게요' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(calculating(page)).toBeVisible();
    held.release(reply(200, holdResponse()));
    await expect(resultRoot(page)).toHaveAttribute('data-result', 'hold');
    await expect(calculating(page)).toHaveCount(0);
  });

  test('응답만으로는 무조작 시간이 다시 시작하지 않는다: 열린 TimeoutDialog 의 남은 시간은 응답이 와도 계속 준다', async ({ page }) => {
    const { held } = await boot(page, NOTICE(5, 60));
    await page.clock.runFor(5_500);
    const countdown = timeoutDialog(page).locator('.kiosk-countdown__value');
    const before = Number(await countdown.innerText());
    await page.clock.runFor(3_000);
    held.release(reply(200, estimatedResponse()));
    await expect(underResult(page, 'normal')).toBeVisible();
    await page.clock.runFor(2_000);
    expect(Number(await countdown.innerText())).toBeLessThanOrEqual(before - 5);
  });

  test('닫힌 뒤 초점은 사라진 계산 중 단추가 아니라 지금 화면의 대표 제목이다 (결과 화면)', async ({ page }) => {
    const { held } = await boot(page, NOTICE(5, 60));
    await page.clock.runFor(5_500);
    held.release(reply(200, estimatedResponse()));
    await expect(underResult(page, 'normal')).toBeVisible();
    await timeoutDialog(page).getByRole('button', { name: '계속 사용할게요' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('[data-kiosk-primary]')).toBeFocused();
  });
});

test.describe('AC-015p: 겹침창이 열려 있는 동안의 요청 만료', () => {
  test('ResetConfirm 이 열린 채 요청 제한(15초)에 닿으면 밑 화면이 오류 화면이 되고, 취소하면 계산 중이 아니라 오류 화면이다. 만료 뒤 도착한 응답은 버려진다', async ({ page }) => {
    const { held } = await boot(page);
    await openReset(page);
    await page.clock.runFor(15_500);
    await expect(underError(page)).toBeVisible();
    await expect(resetDialog(page)).toBeVisible();
    await resetDialog(page).getByRole('button', { name: '계속 이용' }).click();
    await expect(networkError(page)).toBeVisible();
    await expect(calculating(page)).toHaveCount(0);
    expect((await page.locator('.kiosk-bottom-actions').getByRole('button').allInnerTexts()).slice().sort()).toEqual(['다시 시도', '이용 종료']);
    held.release(reply(200, estimatedResponse()));
    await spent(page);
    await expect(networkError(page)).toBeVisible();
    await expect(resultRoot(page)).toHaveCount(0);
  });

  test('제한이 경고 시간 이상이면(경고 5초) TimeoutDialog 가 열린 채 만료된다: 밑 화면이 오류 화면이고, "계속 사용할게요" 뒤 오류 화면이다. 만료는 시간을 다시 시작하지 않는다', async ({ page }) => {
    const { held } = await boot(page, NOTICE(5, 60));
    await page.clock.runFor(5_500);
    await expect(timeoutDialog(page)).toBeVisible();
    const countdown = timeoutDialog(page).locator('.kiosk-countdown__value');
    const before = Number(await countdown.innerText());
    await page.clock.runFor(10_000);
    await expect(underError(page)).toBeVisible();
    await expect(timeoutDialog(page)).toBeVisible();
    expect(Number(await countdown.innerText())).toBeLessThanOrEqual(before - 9);
    await timeoutDialog(page).getByRole('button', { name: '계속 사용할게요' }).click();
    await expect(networkError(page)).toBeVisible();
    held.release(reply(200, estimatedResponse()));
    await spent(page);
    await expect(networkError(page)).toBeVisible();
  });

  test('제한이 경고 시간보다 짧고 환자 조작이 없으면(기본 정책 100초) 겹침창 없이 만료된다 (대조군)', async ({ page }) => {
    await boot(page);
    await page.clock.runFor(15_500);
    await expect(networkError(page)).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    expect(await heading(page, TITLES.treatments).count()).toBe(0);
  });
});
