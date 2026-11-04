import { expect, test } from '../helpers/test';
import type { Page } from '@playwright/test';
import { makeOptions } from '../../fixtures/kiosk/clinic.fixture';
import { KIOSK_PATH, generationRadio, startButton } from '../helpers/kiosk';
import {
  TITLES,
  TREATMENT,
  bottomButton,
  checkedBoxes,
  checkedRadios,
  focusRingProblems,
  heading,
  openKiosk,
  pagerNext,
  selectTreatment,
  setLargeText,
  summaryText,
  swapOrientation,
  tabTo,
  toK01,
  toK02,
  toK02b,
  toK03,
  treatmentBox,
} from '../helpers/input';

// 가로채기 층 (BRIEF D12): 입력 1~3단계(K01 세대 · K02 형태 · K02b 원인)와 4단계의 공통 동작. 두 방향 프로젝트에서 돌고 핵심 동작은 큰 글자 보기에서도 돈다.
// AC 대응: AC-012a(단계 표시) · AC-012b(다음 비활성) · AC-012c(금지 문구·단추 없음) · AC-012d(확인 방법 보기) · AC-012g(이전 선택 유지) · AC-012h(안내 문구) · AC-012i(가입일 입력 없음)
//          · AC-015g·AC-015j(처음으로, 입력 화면 쪽) · AC-017b(큰 글자 전환·방향 전환에도 선택 유지) · AC-017d(키보드만으로 진행, 초점 표시).

const GUIDANCE = '보험증권이나 보험사 앱에서 가입일을 확인해 주세요. 확인이 어려우면 1544-8069로 문의해 주세요.';
const withGuidance = () => ({ options: makeOptions({ guidance: { generationUnknown: GUIDANCE } }) });

const isDisabled = async (page: Page, name: string): Promise<boolean> => (await bottomButton(page, name).getAttribute('aria-disabled')) === 'true';

for (const large of [false, true]) {
  test.describe(large ? '큰 글자 보기' : '일반', () => {
    test.beforeEach(async ({ page }) => {
      await openKiosk(page, withGuidance());
      if (large) await setLargeText(page, true);
    });

    test('1~3단계: 단계 표시 1/4 → 2/4 → 3/4 → 4/4 이고 고르기 전에는 "다음"이 비활성이다 (AC-012a·AC-012b)', async ({ page }) => {
      await toK01(page);
      await expect(page.locator('.kiosk-steps__counter')).toHaveText('1 / 4');
      await expect(page.getByRole('radio')).toHaveCount(5);
      expect(await checkedRadios(page)).toEqual([false, false, false, false, false]);
      expect(await isDisabled(page, '다음')).toBe(true);
      await bottomButton(page, '다음').click({ force: true });
      await expect(heading(page, TITLES.generation)).toBeVisible();

      await generationRadio(page).check();
      expect(await isDisabled(page, '다음')).toBe(false);
      await bottomButton(page, '다음').click();
      await expect(page.locator('.kiosk-steps__counter')).toHaveText('2 / 4');
      await expect(page.getByRole('radio')).toHaveCount(3);
      expect(await isDisabled(page, '다음')).toBe(true);

      await page.getByRole('radio', { name: '생명보험사' }).check();
      await bottomButton(page, '다음').click();
      await expect(page.locator('.kiosk-steps__counter')).toHaveText('3 / 4');
      await expect(page.getByRole('radio')).toHaveCount(3);
      expect(await isDisabled(page, '다음')).toBe(true);

      await page.getByRole('radio', { name: '잘 모르겠어요' }).check();
      await bottomButton(page, '다음').click();
      await expect(page.locator('.kiosk-steps__counter')).toHaveText('4 / 4');
      await expect(heading(page, TITLES.treatments)).toBeVisible();
      // 4단계에서 치료가 0개면 "예상 부담액 확인"이 비활성이다 (AC-012b).
      expect(await isDisabled(page, '예상 부담액 확인')).toBe(true);
    });

    test('"이전"으로 돌아가면 앞서 고른 값이 남아 있다 (AC-012g)', async ({ page }) => {
      await toK03(page);
      await selectTreatment(page, TREATMENT.xray);
      await bottomButton(page, '이전').click();
      await expect(heading(page, TITLES.cause)).toBeVisible();
      await expect(page.getByRole('radio', { name: '다쳐서 왔어요 (상해)' })).toBeChecked();
      await bottomButton(page, '이전').click();
      await expect(heading(page, TITLES.type)).toBeVisible();
      await expect(page.getByRole('radio', { name: '손해보험사' })).toBeChecked();
      await bottomButton(page, '이전').click();
      await expect(heading(page, TITLES.generation)).toBeVisible();
      await expect(generationRadio(page)).toBeChecked();
      // 다시 끝까지 가면 치료 선택도 남아 있다.
      for (let step = 0; step < 3; step += 1) await bottomButton(page, '다음').click();
      await expect(heading(page, TITLES.treatments)).toBeVisible();
      await expect(treatmentBox(page, TREATMENT.xray)).toBeChecked();
    });

    test('고른 카드를 바꾸면 하나만 선택되어 있다 (라디오는 한 장)', async ({ page }) => {
      await toK01(page);
      await generationRadio(page, '1세대(A·S)').check();
      await generationRadio(page, '4세대(C4)').check();
      expect(await checkedRadios(page)).toEqual([false, false, false, false, true]);
    });

    test('"세대를 모르겠어요"와 "확인 방법 보기"는 세대 확인 안내 화면을 열고 계산 요청이 없으며, 돌아가면 화면 1이다 (AC-012d·AC-012h)', async ({ page }) => {
      await toK01(page);
      await generationRadio(page, '3세대(C3)').check();
      for (const label of ['세대를 모르겠어요', '확인 방법 보기']) {
        await page.getByRole('button', { name: label }).click();
        await expect(heading(page, TITLES.generationHelp)).toBeVisible();
        const text = await page.locator('.kiosk-root').innerText();
        expect(text).toContain('1544-8069로 문의해 주세요');
        expect(text).toContain('키오스크에서 전화가 걸리지는 않습니다');
        // 링크·전화 연결이 없다: 번호는 글자일 뿐이다.
        expect(await page.locator('.kiosk-root a, .kiosk-root [href]').count()).toBe(0);
        expect(await page.locator('.kiosk-root').innerHTML()).not.toContain('tel:');
        // 안내 화면에서 누를 수 있는 것은 돌아가기 하나뿐이다(세대를 임의로 고르거나 합계만 보는 길이 없다). 큰 글자 보기 토글은 공통 상단이다.
        expect(await page.locator('.kiosk-help-screen button, .kiosk-status__actions button').allInnerTexts()).toEqual(['보험 선택으로 돌아가기']);
        await page.getByRole('button', { name: '보험 선택으로 돌아가기' }).click();
        await expect(heading(page, TITLES.generation)).toBeVisible();
        await expect(generationRadio(page, '3세대(C3)')).toBeChecked();
      }
    });

    test('금지 문구·입력이 없다: 링크·전화 연결·날짜 입력·1588·상담·"직원에게 문의" 단추·공제/한도/특약 질문·내부 코드 (AC-012c·AC-012h·AC-012i)', async ({ page }) => {
      const screens: Array<() => Promise<void>> = [
        async () => {
          await toK01(page);
        },
        async () => {
          await generationRadio(page).check();
          await bottomButton(page, '다음').click();
          await expect(heading(page, TITLES.type)).toBeVisible();
        },
        async () => {
          await page.getByRole('radio', { name: '손해보험사' }).check();
          await bottomButton(page, '다음').click();
          await expect(heading(page, TITLES.cause)).toBeVisible();
        },
        async () => {
          await page.getByRole('radio', { name: '잘 모르겠어요' }).check();
          await bottomButton(page, '다음').click();
          await expect(heading(page, TITLES.treatments)).toBeVisible();
        },
      ];
      for (const [index, go] of screens.entries()) {
        await go();
        const html = await page.locator('.kiosk-root').innerHTML();
        const text = await page.locator('.kiosk-root').innerText();
        expect(await page.locator('.kiosk-root a, .kiosk-root [href]').count(), `화면 ${index + 1} 링크`).toBe(0);
        expect(html, `화면 ${index + 1}`).not.toMatch(/tel:|1588|type="(date|datetime-local|month|week|text|tel|number|search)"/);
        expect(text, `화면 ${index + 1}`).not.toMatch(/상담|자기부담금|공제 유형|외래 한도|특약|직원에게 문의하기/);
        for (const name of await page.getByRole('button').allInnerTexts()) expect(name, `화면 ${index + 1} 단추`).not.toMatch(/문의|상담|전화/);
        expect(text, `화면 ${index + 1}`).not.toMatch(/GEN\d|NON_LIFE|MUTUAL_AID|PROFILE_|MAPPING_|LINE_|undefined|null|NaN/);
      }
    });

    test('K01 의 "가입 시기를 모르실 때" 안내는 응답 문장 그대로 글자로만 있고 "확인 방법 보기" 단추가 있다; 세대 카드는 다섯 장이고 미리 선택된 것이 없다 (AC-012h·AC-012i)', async ({ page }) => {
      await toK01(page);
      const panel = page.getByRole('region', { name: '가입 시기를 모르실 때' });
      await expect(panel).toContainText('보험증권이나 보험사 앱에서 가입일을 확인해 주세요.');
      await expect(panel).toContainText('확인이 어려우면 1544-8069로 문의해 주세요.');
      await expect(panel.getByRole('button', { name: '확인 방법 보기' })).toBeVisible();
      await expect(panel.locator('a, [href]')).toHaveCount(0);
      await expect(page.getByRole('radio')).toHaveCount(5);
      await expect(page.locator('input[type="date"], input[type="text"], input[type="number"]')).toHaveCount(0);
      expect(await checkedRadios(page)).toEqual([false, false, false, false, false]);
    });

    test('K02 의 "접수 직원에게 문의해 주세요"는 버튼이 아닌 문장이다 (AC-012c)', async ({ page }) => {
      await toK02(page);
      const sentence = page.getByText('접수 직원에게 문의해 주세요');
      await expect(sentence).toBeVisible();
      expect(await sentence.evaluate((element) => element.closest('button, a, [role="button"]'))).toBeNull();
      await expect(page.getByRole('button', { name: /문의/ })).toHaveCount(0);
    });

    test('"처음으로"는 입력이 없으면 확인 없이 시작 화면으로, 있으면 확인창을 먼저 연다 (AC-015g·AC-015j 의 입력 화면 쪽)', async ({ page }) => {
      await toK01(page);
      await bottomButton(page, '처음으로').click();
      await expect(startButton(page)).toBeVisible();
      await toK01(page);
      await generationRadio(page).check();
      await bottomButton(page, '처음으로').click();
      await expect(page.getByRole('dialog')).toContainText('선택 내용을 지우고 처음으로 돌아갈까요?');
    });

    test('큰 글자 보기와 화면 방향을 바꿔도 현재 화면과 선택이 유지되고 요청이 나가지 않는다 (AC-017b)', async ({ page }) => {
      await toK02b(page);
      await page.getByRole('radio', { name: '아파서 왔어요 (질병)' }).check();
      await setLargeText(page, !large);
      await expect(heading(page, TITLES.cause)).toBeVisible();
      await expect(page.getByRole('radio', { name: '아파서 왔어요 (질병)' })).toBeChecked();
      await swapOrientation(page);
      await expect(heading(page, TITLES.cause)).toBeVisible();
      await expect(page.getByRole('radio', { name: '아파서 왔어요 (질병)' })).toBeChecked();
      expect(await isDisabled(page, '다음')).toBe(false);
      await swapOrientation(page);
      await setLargeText(page, large);
      await expect(page.getByRole('radio', { name: '아파서 왔어요 (질병)' })).toBeChecked();
    });
  });
}

test.describe('키보드만으로 진행 (AC-017d)', () => {
  test('시작 → 1단계 → 2단계 → 3단계 → 4단계 → 확인: Tab·방향키·Space·Enter 만으로 도달하고, 화면이 바뀌면 초점이 새 화면의 제목으로 간다', async ({ page }) => {
    const api = await openKiosk(page, withGuidance());
    await startButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(heading(page, TITLES.generation)).toBeFocused();

    // 1단계: 첫 카드로 Tab, 방향키로 2세대, 다음으로 Tab 하고 Enter.
    await page.keyboard.press('Tab');
    await expect(generationRadio(page, '1세대(A·S)')).toBeFocused();
    expect(await focusRingProblems(page)).toEqual([]);
    await page.keyboard.press('ArrowDown');
    await expect(generationRadio(page, '2세대(C1)')).toBeFocused();
    await expect(generationRadio(page, '2세대(C1)')).toBeChecked();
    await tabTo(page, bottomButton(page, '다음'));
    expect(await focusRingProblems(page)).toEqual([]);
    await page.keyboard.press('Enter');
    await expect(heading(page, TITLES.type)).toBeFocused();

    // 2단계: Tab → Space 로 첫 카드 선택.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await expect(page.getByRole('radio', { name: '손해보험사' })).toBeChecked();
    await tabTo(page, bottomButton(page, '다음'));
    await page.keyboard.press('Enter');
    await expect(heading(page, TITLES.cause)).toBeFocused();

    // 3단계.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await expect(page.getByRole('radio', { name: '다쳐서 왔어요 (상해)' })).toBeChecked();
    await tabTo(page, bottomButton(page, '다음'));
    await page.keyboard.press('Enter');
    await expect(heading(page, TITLES.treatments)).toBeFocused();

    // 4단계: 확인 버튼은 비활성이라 Enter 를 눌러도 요청이 없다. 체크박스 둘을 Space 로 고르고 확인한다.
    const confirm = bottomButton(page, '예상 부담액 확인');
    await tabTo(page, confirm);
    await page.keyboard.press('Enter');
    expect(api.callsTo('estimate')).toHaveLength(0);
    await page.locator('.kiosk-input__heading').focus();
    await page.keyboard.press('Tab');
    await expect(treatmentBox(page, TREATMENT.xray)).toBeFocused();
    expect(await focusRingProblems(page)).toEqual([]);
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await expect(treatmentBox(page, TREATMENT.xray)).toBeChecked();
    await expect(treatmentBox(page, TREATMENT.ultrasound)).toBeChecked();
    await tabTo(page, confirm);
    await page.keyboard.press('Enter');
    await expect.poll(() => api.callsTo('estimate').length).toBe(1);
    const body = JSON.parse(api.callsTo('estimate')[0]?.postData ?? '{}') as { treatmentIds: string[]; generation: string; insurerType: string; cause: string };
    expect(body).toMatchObject({ generation: 'GEN2_C1', insurerType: 'NON_LIFE', cause: 'INJURY' });
    expect(body.treatmentIds.slice().sort()).toEqual(['TEST_FIXTURE_TREATMENT_1', 'TEST_FIXTURE_TREATMENT_2']);
  });

  test('각 입력 화면의 모든 조작 요소는 Tab 으로 닿고 초점 표시가 굵은 윤곽선이며 잘리지 않는다', async ({ page }, testInfo) => {
    await openKiosk(page, withGuidance());
    const problems: string[] = [];
    for (const go of [toK01, toK02, toK02b, toK03]) {
      await page.goto(KIOSK_PATH);
      await expect(startButton(page)).toBeVisible();
      await go(page);
      await page.locator('.kiosk-input__heading').focus();
      const total = await page.locator('.kiosk-input button:not([aria-disabled="true"]), .kiosk-input input').count();
      for (let step = 0; step < total; step += 1) {
        await page.keyboard.press('Tab');
        const label = await page.evaluate(() => {
          const active = document.activeElement;
          return `${active?.tagName ?? ''}:${active?.getAttribute('aria-label') ?? active?.textContent?.trim().slice(0, 20) ?? ''}`;
        });
        for (const problem of await focusRingProblems(page)) problems.push(`${testInfo.project.name} ${await page.locator('.kiosk-input__heading').innerText()} Tab ${step + 1} ${label}: ${problem}`);
      }
    }
    expect(problems).toEqual([]);
  });

  test('4단계의 "예상 부담액 확인"은 비활성 이유 문장을 접근 가능한 설명으로 가진다', async ({ page }) => {
    await openKiosk(page);
    await toK03(page);
    await expect(bottomButton(page, '예상 부담액 확인')).toHaveAccessibleDescription('치료를 1개 이상 선택하면 예상 부담액을 확인할 수 있습니다.');
    await pagerNext(page).focus();
    await expect(pagerNext(page)).toBeFocused();
  });
});

test.describe('큰 글자 보기와 방향 전환은 선택·합계·페이지 수를 보존한다 (AC-017b)', () => {
  test('치료 둘을 고른 뒤 큰 글자·방향을 바꿔도 같은 선택과 같은 합계다', async ({ page }) => {
    await openKiosk(page);
    await toK03(page);
    await selectTreatment(page, TREATMENT.xray);
    await selectTreatment(page, TREATMENT.kidney);
    expect(await summaryText(page)).toContain('50,000원');
    await setLargeText(page, true);
    expect(await summaryText(page)).toContain('50,000원');
    await expect(page.locator('.kiosk-pager__status')).toContainText('/ 3 페이지');
    await swapOrientation(page);
    expect(await summaryText(page)).toContain('50,000원');
    await setLargeText(page, false);
    await expect(page.locator('.kiosk-pager__status')).toContainText('/ 2 페이지');
    expect(await summaryText(page)).toContain('50,000원');
    await expect(page.getByRole('checkbox')).toHaveCount(4);
    expect(await checkedBoxes(page)).toEqual([true, false, true, false]);
    // 경로가 바뀌지 않는다(한 경로, 기록 항목 없음).
    expect(new URL(page.url()).pathname).toBe(new URL(KIOSK_PATH, page.url()).pathname);
  });
});
