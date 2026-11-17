import { expect, test } from '../helpers/test';
import type { Page } from '@playwright/test';
import { MISMATCH_409, NOT_PUBLISHED_422, ABORT, reply } from '../helpers/api';
import type { ApiMock, Held } from '../helpers/api';
import { makeCatalog } from '../../fixtures/kiosk/clinic.fixture';
import { installClock } from '../helpers/clock';
import { dialog, startButton } from '../helpers/kiosk';
import {
  TITLES,
  TREATMENT,
  bottomButton,
  checkedBoxes,
  estimateTreatmentIds,
  expectLayoutClean,
  goToTreatmentPage,
  heading,
  openKiosk,
  refreshNotice,
  selectTreatment,
  setLargeText,
  summaryText,
  toK03,
  treatmentBox,
} from '../helpers/input';
import { refreshedCatalog, refreshedOptions, startRefresh } from '../helpers/screens';

// 가로채기 층 (BRIEF D12): 409·422 뒤 자료 갱신의 화면 표시 (D5, DD-09). 응답을 시험이 붙잡았다 풀어 주므로 진행 중·성공·실패·늦은 응답을 정확히 만든다.
// AC 대응: AC-020b(409·422 → 같은 화면에서 갱신, 옛 값으로 결과 없음) · AC-020c(갱신 중 확인 불가, 계산 요청 0건) · AC-020d(한 단계로 반영, 한쪽만 도착하면 반영 없음)
//          · AC-020e(실패 → 인라인 안내·"다시 시도"가 갱신을 먼저) · AC-020g(1)(확정된 초기화 뒤 결과 무시) · AC-020h(겹침창 위에서의 도착·닫은 뒤의 상태) · AC-020i(잠금·진행 표시·성공/실패 안내, 두 방향·큰 글자)
// 상태 기계의 내부 규칙(경합·늦은 결과의 정리·타이머 수)은 단위 시험(M5)이 증명하고 여기는 화면에 보이는 결과를 본다.

const PICK = async (page: Page): Promise<void> => {
  await selectTreatment(page, TREATMENT.xray);
  await selectTreatment(page, TREATMENT.physio);
};

async function prepare(page: Page, large: boolean, mock?: Parameters<typeof openKiosk>[1]): Promise<ApiMock> {
  const api = await openKiosk(page, mock);
  if (large) await setLargeText(page, true);
  await toK03(page);
  await PICK(page);
  return api;
}

const confirmButton = (page: Page) => bottomButton(page, '예상 부담액 확인');
const bodyText = (page: Page): Promise<string> => page.locator('.kiosk-root').innerText();
const INTERNALS = /VERSION_MISMATCH|TREATMENT_NOT_PUBLISHED|INTERNAL_ERROR|NO_TREATMENT|HTTP|\b40\d\b|\b42\d\b|\b50\d\b/;

for (const large of [false, true]) {
  test.describe(large ? '큰 글자 보기' : '일반', () => {
    for (const [name, rejected] of [
      ['409 VERSION_MISMATCH', reply(409, MISMATCH_409)],
      ['422 TREATMENT_NOT_PUBLISHED', reply(422, NOT_PUBLISHED_422)],
    ] as const) {
      test.describe(name, () => {
        async function begin(page: Page): Promise<{ api: ApiMock; catalog: Held; options: Held }> {
          const api = await prepare(page, large);
          api.queue('estimate', rejected);
          const catalog = api.hold('catalog');
          const options = api.hold('options');
          await confirmButton(page).click();
          await expect(refreshNotice(page, 'running')).toBeVisible();
          await catalog.arrived();
          await options.arrived();
          return { api, catalog, options };
        }

        test('갱신 중: 같은 화면 안에서 진행 표시가 보이고 치료 카드·"이전"·확인 버튼이 잠긴다 (AC-020b·AC-020c·AC-020i)', async ({ page }) => {
          const { api } = await begin(page);
          await expect(heading(page, TITLES.treatments)).toBeVisible();
          await expect(refreshNotice(page, 'running')).toContainText('가격과 보험 기준을 다시 확인하고 있어요');
          await expect(refreshNotice(page, 'running')).toContainText('확인이 끝나면 예상 부담액 확인을 다시 눌러 주세요.');
          expect(await page.getByRole('checkbox').evaluateAll((inputs) => inputs.every((input) => input.getAttribute('aria-disabled') === 'true'))).toBe(true);
          await expect(bottomButton(page, '이전')).toHaveAttribute('aria-disabled', 'true');
          await expect(confirmButton(page)).toHaveAttribute('aria-disabled', 'true');

          // 잠긴 조작은 눌러도 아무 일이 없다.
          const before = await summaryText(page);
          const visibleBox = page.getByRole('checkbox').first();
          const wasChecked = await visibleBox.isChecked();
          await visibleBox.click({ force: true });
          expect(await visibleBox.isChecked()).toBe(wasChecked);
          expect(await summaryText(page)).toBe(before);
          await bottomButton(page, '이전').click({ force: true });
          await confirmButton(page).click({ force: true });
          await page.waitForTimeout(300);
          await expect(heading(page, TITLES.treatments)).toBeVisible();
          expect(api.callsTo('estimate')).toHaveLength(1);
          // 갱신은 병원 자료 두 개를 한 번씩만 다시 받는다(처음 불러오기 + 갱신).
          expect(api.callsTo('catalog')).toHaveLength(2);
          expect(api.callsTo('options')).toHaveLength(2);
          expect(await bodyText(page)).not.toMatch(INTERNALS);
        });

        test('갱신 중에도 "처음으로"·쪽 넘김·큰 글자 전환은 동작한다 (AC-020i)', async ({ page }) => {
          await begin(page);
          // 쪽 넘김
          await goToTreatmentPage(page, 2);
          await goToTreatmentPage(page, 1);
          // 큰 글자 전환: 같은 화면·같은 선택·진행 표시 유지
          const summary = await summaryText(page);
          await setLargeText(page, !large);
          await expect(refreshNotice(page, 'running')).toBeVisible();
          expect(await summaryText(page)).toBe(summary);
          await setLargeText(page, large);
          // 처음으로
          await bottomButton(page, '처음으로').click();
          await expect(dialog(page)).toContainText('선택 내용을 지우고 처음으로 돌아갈까요?');
          await dialog(page).getByRole('button', { name: '계속 이용' }).click();
          await expect(dialog(page)).toHaveCount(0);
          await expect(refreshNotice(page, 'running')).toBeVisible();
        });

        test('성공: 한 단계로 반영된다 - 내려간 치료는 안내와 함께 빠지고 새 합계가 보이며 확인 버튼이 켜지고 자동으로 계산하지 않는다 (AC-020b·AC-020d·AC-020i)', async ({ page }) => {
          const { api, catalog, options } = await begin(page);
          // 한쪽만 도착하면 아무것도 반영되지 않는다(AC-020d 1·2).
          const before = await summaryText(page);
          catalog.release(reply(200, refreshedCatalog()));
          await page.waitForTimeout(400);
          await expect(refreshNotice(page, 'running')).toBeVisible();
          expect(await summaryText(page)).toBe(before);
          await expect(confirmButton(page)).toHaveAttribute('aria-disabled', 'true');
          // 둘 다 도착하면 한 번에 반영된다.
          options.release(reply(200, refreshedOptions()));
          await expect(refreshNotice(page, 'removed')).toBeVisible();
          await expect(refreshNotice(page, 'removed')).toContainText('더 이상 선택할 수 없는 치료를 목록에서 뺐어요');
          await expect(refreshNotice(page, 'removed')).toContainText(TREATMENT.physio);
          await expect(refreshNotice(page, 'removed')).toContainText('가격이 바뀌었을 수 있으니 예상 부담액 확인을 다시 눌러 주세요.');
          // 선택에서 물리치료가 빠지고 X-ray 의 새 가격이 합계에 반영된다.
          const summary = await summaryText(page);
          expect(summary).toContain('1개');
          expect(summary).toContain('12,000원');
          await expect(page.getByRole('checkbox', { name: TREATMENT.physio })).toHaveCount(0);
          await goToTreatmentPage(page, 1);
          await expect(treatmentBox(page, TREATMENT.xray)).toBeChecked();
          await expect(confirmButton(page)).not.toHaveAttribute('aria-disabled', 'true');
          expect(await page.getByRole('checkbox').evaluateAll((inputs) => inputs.some((input) => input.getAttribute('aria-disabled') === 'true'))).toBe(false);
          // 자동으로 결과로 가지 않는다: 계산 요청은 처음 거절된 것 하나뿐이고 화면은 그대로다.
          await page.waitForTimeout(500);
          expect(api.callsTo('estimate')).toHaveLength(1);
          await expect(heading(page, TITLES.treatments)).toBeVisible();
          expect(await bodyText(page)).not.toMatch(INTERNALS);
          // 환자가 다시 확인해야 결과 요청이 나가고, 그 요청은 새 버전과 남은 선택만 담는다.
          await confirmButton(page).click();
          await expect.poll(() => api.callsTo('estimate').length).toBe(2);
          expect(estimateTreatmentIds(api)[1]).toEqual(['TEST_FIXTURE_TREATMENT_1']);
          expect(JSON.parse(api.callsTo('estimate')[1]?.postData ?? '{}')).toMatchObject({ catalogVersion: 'TEST_FIXTURE_CATALOG_V2', ruleBundleVersion: 'TEST_FIXTURE_BUNDLE_V2' });
        });

        test('실패: 인라인 안내와 "다시 시도"가 보이고 확인 버튼은 꺼져 있으며 선택·합계는 갱신 전 그대로이고 내부 코드가 없다 (AC-020e·AC-020i)', async ({ page }) => {
          const { api, catalog, options } = await begin(page);
          const before = await summaryText(page);
          catalog.release(reply(200, refreshedCatalog()));
          options.release(reply(500, { error: 'INTERNAL_ERROR' }));
          await expect(refreshNotice(page, 'failed')).toBeVisible();
          await expect(refreshNotice(page, 'failed')).toHaveAttribute('role', 'alert');
          await expect(refreshNotice(page, 'failed')).toContainText('최신 정보를 불러오지 못했어요');
          await expect(refreshNotice(page, 'failed').getByRole('button', { name: '다시 시도' })).toBeVisible();
          await expect(confirmButton(page)).toHaveAttribute('aria-disabled', 'true');
          // 도착한 한쪽(새 catalog)도 쓰이지 않았다: 합계·선택이 그대로다.
          expect(await summaryText(page)).toBe(before);
          expect(await bodyText(page)).not.toMatch(INTERNALS);
          expect(await bodyText(page)).not.toMatch(/(^|[^\d,])0원 확인/);
          await expect(heading(page, TITLES.treatments)).toBeVisible();
          expect(api.callsTo('estimate')).toHaveLength(1);
          // 실패 상태의 확인 버튼을 눌러도 계산 요청이 없다.
          await confirmButton(page).click({ force: true });
          await page.waitForTimeout(300);
          expect(api.callsTo('estimate')).toHaveLength(1);
        });

        test('"다시 시도"는 계산이 아니라 갱신을 먼저 실행하고, 다시 실패하면 다시 실패 안내이며, 성공한 뒤에야 확인이 가능하다 (AC-020e)', async ({ page }) => {
          const { api, catalog, options } = await begin(page);
          catalog.release(reply(500, { error: 'INTERNAL_ERROR' }));
          options.release(reply(200, refreshedOptions()));
          await expect(refreshNotice(page, 'failed')).toBeVisible();

          // 첫 재시도: 다시 실패
          let retryCatalog = api.hold('catalog');
          let retryOptions = api.hold('options');
          await refreshNotice(page, 'failed').getByRole('button', { name: '다시 시도' }).click();
          await expect(refreshNotice(page, 'running')).toBeVisible();
          // 눌렀던 버튼이 사라져도 초점은 안내 안에 남는다(키보드 사용자가 문서 처음으로 쫓겨나지 않는다).
          expect(await page.evaluate(() => document.activeElement?.closest('[data-kiosk-refresh]') !== null)).toBe(true);
          await retryCatalog.arrived();
          await retryOptions.arrived();
          expect(api.callsTo('estimate')).toHaveLength(1);
          await expect(confirmButton(page)).toHaveAttribute('aria-disabled', 'true');
          retryCatalog.release(reply(200, refreshedCatalog()));
          retryOptions.release(ABORT);
          await expect(refreshNotice(page, 'failed')).toBeVisible();

          // 둘째 재시도: 성공
          retryCatalog = api.hold('catalog');
          retryOptions = api.hold('options');
          await refreshNotice(page, 'failed').getByRole('button', { name: '다시 시도' }).click();
          await expect(refreshNotice(page, 'running')).toBeVisible();
          await retryCatalog.arrived();
          await retryOptions.arrived();
          retryCatalog.release(reply(200, refreshedCatalog()));
          retryOptions.release(reply(200, refreshedOptions()));
          await expect(refreshNotice(page, 'removed')).toBeVisible();
          // 지금까지 계산 요청은 처음 거절된 하나뿐이다. 환자가 다시 눌러야 두 번째가 나간다.
          expect(api.callsTo('estimate')).toHaveLength(1);
          await expect(confirmButton(page)).not.toHaveAttribute('aria-disabled', 'true');
          await confirmButton(page).click();
          await expect.poll(() => api.callsTo('estimate').length).toBe(2);
          expect(JSON.parse(api.callsTo('estimate')[1]?.postData ?? '{}')).toMatchObject({ catalogVersion: 'TEST_FIXTURE_CATALOG_V2' });
        });

        test('겹침창 위에서의 도착 (처음으로 확인창): 밑 화면에 곧바로 반영되고 창은 그대로이며, 닫으면 최신 갱신 상태를 본다 (AC-020h)', async ({ page }) => {
          const { catalog, options } = await begin(page);
          await bottomButton(page, '처음으로').click();
          await expect(dialog(page)).toBeVisible();
          catalog.release(reply(200, refreshedCatalog()));
          options.release(reply(200, refreshedOptions()));
          // 창은 열려 있고 밑 화면(inert)이 이미 갱신되어 있다.
          await expect(page.locator('.kiosk-underlay [data-kiosk-refresh="removed"]')).toBeAttached();
          await expect(dialog(page)).toBeVisible();
          await dialog(page).getByRole('button', { name: '계속 이용' }).click();
          await expect(dialog(page)).toHaveCount(0);
          await expect(refreshNotice(page, 'removed')).toBeVisible();
          await expect(confirmButton(page)).not.toHaveAttribute('aria-disabled', 'true');
          expect(await summaryText(page)).toContain('12,000원');
        });

        test('겹침창 위에서의 실패 도착: 닫은 뒤 실패 안내와 "다시 시도", 확인 버튼은 꺼져 있다 (AC-020h)', async ({ page }) => {
          const { catalog, options } = await begin(page);
          await bottomButton(page, '처음으로').click();
          await expect(dialog(page)).toBeVisible();
          catalog.release(reply(500, { error: 'INTERNAL_ERROR' }));
          options.release(reply(200, refreshedOptions()));
          await expect(page.locator('.kiosk-underlay [data-kiosk-refresh="failed"]')).toBeAttached();
          await dialog(page).getByRole('button', { name: '계속 이용' }).click();
          await expect(refreshNotice(page, 'failed').getByRole('button', { name: '다시 시도' })).toBeVisible();
          await expect(confirmButton(page)).toHaveAttribute('aria-disabled', 'true');
        });

        test('아직 진행 중인 채 창을 닫으면 확인 버튼은 계속 꺼져 있고, 그 뒤 도착한 결과가 반영된다 (AC-020h)', async ({ page }) => {
          const { catalog, options } = await begin(page);
          await bottomButton(page, '처음으로').click();
          await dialog(page).getByRole('button', { name: '계속 이용' }).click();
          await expect(refreshNotice(page, 'running')).toBeVisible();
          await expect(confirmButton(page)).toHaveAttribute('aria-disabled', 'true');
          catalog.release(reply(200, refreshedCatalog()));
          options.release(reply(200, refreshedOptions()));
          await expect(refreshNotice(page, 'removed')).toBeVisible();
        });

        test('확정된 초기화 뒤에 도착한 갱신 결과는 반영되지 않는다: 시작 화면이 그대로다 (AC-020g 1)', async ({ page }) => {
          const { api, catalog, options } = await begin(page);
          await bottomButton(page, '처음으로').click();
          await dialog(page).getByRole('button', { name: '처음으로' }).click();
          await expect(startButton(page)).toBeVisible();
          catalog.release(reply(200, refreshedCatalog()));
          options.release(reply(200, refreshedOptions()));
          await page.waitForTimeout(500);
          await expect(startButton(page)).toBeVisible();
          await expect(page.locator('[data-kiosk-refresh]')).toHaveCount(0);
          await expect(dialog(page)).toHaveCount(0);
          expect(api.callsTo('estimate')).toHaveLength(1);
          // 새 세션은 빈 세션이다: 시작하면 1단계가 빈 선택이다.
          await startButton(page).click();
          await expect(heading(page, TITLES.generation)).toBeVisible();
          expect(await page.getByRole('radio').evaluateAll((inputs) => inputs.some((input) => (input as HTMLInputElement).checked))).toBe(false);
        });

        test('진행 중·실패·성공 세 상태에서 두 방향·큰 글자 모두 잘림·겹침·화면 밖이 없다 (AC-020i·AC-017a·AC-017b)', async ({ page }, testInfo) => {
          const { catalog, options } = await begin(page);
          await expectLayoutClean(page, `running ${testInfo.project.name} ${large ? 'large' : 'normal'}`);
          catalog.release(reply(500, { error: 'INTERNAL_ERROR' }));
          options.release(reply(200, refreshedOptions()));
          await expect(refreshNotice(page, 'failed')).toBeVisible();
          await expectLayoutClean(page, `failed ${testInfo.project.name} ${large ? 'large' : 'normal'}`);
        });
      });
    }

    test('갱신이 시간 제한 안에 끝나지 않으면 실패 안내가 된다 (AC-020e 의 시간 제한)', async ({ page }) => {
      await installClock(page);
      const api = await openKiosk(page);
      if (large) await setLargeText(page, true);
      await toK03(page);
      await PICK(page);
      api.queue('estimate', reply(409, MISMATCH_409));
      // 두 GET 이 끝내 오지 않는다.
      api.queue('catalog', { kind: 'hang' });
      api.queue('options', { kind: 'hang' });
      await confirmButton(page).click();
      await expect(refreshNotice(page, 'running')).toBeVisible();
      await page.clock.runFor(14_000);
      await expect(refreshNotice(page, 'running')).toBeVisible();
      await page.clock.runFor(2_000);
      await expect(refreshNotice(page, 'failed')).toBeVisible();
      await expect(confirmButton(page)).toHaveAttribute('aria-disabled', 'true');
      expect(api.callsTo('estimate')).toHaveLength(1);
    });

    test('겹침창 위에서의 도착 (무조작 경고창): 밑 화면에 반영되고 창은 그대로이며 "계속 사용할게요" 뒤 최신 상태를 본다 (AC-020h)', async ({ page }) => {
      await installClock(page);
      // 경고(5초)가 갱신 시간 제한(15초)보다 먼저 오도록 입력 화면 정책을 줄인다. 초기화는 12초다.
      const catalog = makeCatalog({ idlePolicy: { screens: { INPUT: { warnSeconds: 5, resetSeconds: 12 } }, completionHoldSeconds: null } });
      const api = await openKiosk(page, { catalog });
      if (large) await setLargeText(page, true);
      await toK03(page);
      await PICK(page);
      api.queue('estimate', reply(409, MISMATCH_409));
      const heldCatalog = api.hold('catalog');
      const heldOptions = api.hold('options');
      await confirmButton(page).click();
      await expect(refreshNotice(page, 'running')).toBeVisible();
      await heldCatalog.arrived();
      await heldOptions.arrived();
      await page.clock.runFor(5_500);
      await expect(dialog(page)).toContainText('계속 사용하시겠어요?');
      heldCatalog.release(reply(200, { ...refreshedCatalog(), idlePolicy: catalog.idlePolicy }));
      heldOptions.release(reply(200, refreshedOptions()));
      await expect(page.locator('.kiosk-underlay [data-kiosk-refresh="removed"]')).toBeAttached();
      await expect(dialog(page)).toBeVisible();
      await dialog(page).getByRole('button', { name: '계속 사용할게요' }).click();
      await expect(dialog(page)).toHaveCount(0);
      await expect(refreshNotice(page, 'removed')).toBeVisible();
      await expect(confirmButton(page)).not.toHaveAttribute('aria-disabled', 'true');
      expect(await summaryText(page)).toContain('12,000원');
      expect(await summaryText(page)).toContain('1개');
      await goToTreatmentPage(page, 1);
      expect(await checkedBoxes(page)).toContain(true);
    });
  });
}
