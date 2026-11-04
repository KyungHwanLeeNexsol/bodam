import { expect, test } from '../helpers/test';
import { MISMATCH_409, reply } from '../helpers/api';
import { refreshedCatalog, refreshedOptions } from '../helpers/screens';
import {
  TITLES,
  TREATMENT,
  bottomButton,
  checkedBoxes,
  currentPage,
  estimateTreatmentIds,
  goToTreatmentPage,
  heading,
  openKiosk,
  pagerNext,
  pagerPrevious,
  pagerStatus,
  refreshNotice,
  selectTreatment,
  setLargeText,
  summaryText,
  toK03,
  treatmentBox,
} from '../helpers/input';

// 가로채기 층 (BRIEF D12): K03 치료 선택 (두 방향 프로젝트 × 일반/큰 글자).
// AC 대응: AC-012b(0개면 비활성) · AC-012e(쪽 넘김·거듭 눌러도 수량 없음) · AC-012f(예시 4종 합계) · AC-014d(쪽 넘김·큰 글자 전환은 계산 요청 없음) · AC-019c(합계는 선택자 값, 화면은 값만 보임)
//          · AC-017b(큰 글자에서 공간이 모자란 목록은 페이지로 나뉘고 선택이 유지된다).

for (const large of [false, true]) {
  test.describe(large ? '큰 글자 보기' : '일반', () => {
    const perPage = large ? 2 : 4;

    test.beforeEach(async ({ page }) => {
      await openKiosk(page);
      if (large) await setLargeText(page, true);
      await toK03(page);
    });

    test(`한 쪽에 카드 ${perPage}장, 급여/비급여 표시와 이름·설명·가격이 응답 그대로이고 쪽 번호가 맞다 (DD-12)`, async ({ page }) => {
      await expect(page.getByRole('checkbox')).toHaveCount(perPage);
      await expect(pagerStatus(page)).toHaveText(`1 / ${Math.ceil(6 / perPage)} 페이지`);
      const first = page.locator('.kiosk-choice--treatment').first();
      await expect(first).toContainText('급여');
      await expect(first).toContainText(TREATMENT.xray);
      await expect(first).toContainText('10,000원');
      await expect(first).toContainText('환자 예상 결제액');
      await expect(first).toContainText('TEST_FIXTURE 설명 TEST_FIXTURE X-ray');
      await goToTreatmentPage(page, 2);
      await expect(page.locator('.kiosk-choice--treatment').first()).toContainText(large ? TREATMENT.kidney : TREATMENT.fifth);
      await expect(page.locator('.kiosk-choice--treatment').first()).toContainText('비급여');
      // 내부 코드·치료 식별자는 화면에 나오지 않는다.
      expect(await page.locator('.kiosk-root').innerText()).not.toMatch(/TEST_FIXTURE_TREATMENT|BENEFIT|treatmentId/);
    });

    test('쪽을 넘겼다 돌아와도 선택이 유지되고 합계·개수가 그대로이며 요청이 나가지 않는다 (AC-012e·AC-014d)', async ({ page }) => {
      const api = await openKiosk(page);
      if (large) await setLargeText(page, true);
      await toK03(page);
      const calls = api.calls.length;
      await selectTreatment(page, TREATMENT.xray);
      await selectTreatment(page, TREATMENT.fifth);
      const summary = await summaryText(page);
      expect(summary).toContain('2개');
      expect(summary).toContain('15,000원');
      await goToTreatmentPage(page, 1);
      await expect(treatmentBox(page, TREATMENT.xray)).toBeChecked();
      expect(await summaryText(page)).toBe(summary);
      await pagerNext(page).click();
      await expect(pagerStatus(page)).not.toContainText('1 /');
      await pagerPrevious(page).click();
      await expect(treatmentBox(page, TREATMENT.xray)).toBeChecked();
      expect(await summaryText(page)).toBe(summary);
      expect(api.calls.length).toBe(calls);
    });

    test('첫 쪽에서 "이전 목록", 끝 쪽에서 "다음 목록"은 aria-disabled 이고 눌러도 쪽이 바뀌지 않는다', async ({ page }) => {
      await expect(pagerPrevious(page)).toHaveAttribute('aria-disabled', 'true');
      await pagerPrevious(page).click({ force: true });
      expect(await currentPage(page)).toBe(1);
      await goToTreatmentPage(page, Math.ceil(6 / perPage));
      await expect(pagerNext(page)).toHaveAttribute('aria-disabled', 'true');
      await pagerNext(page).click({ force: true });
      expect(await currentPage(page)).toBe(Math.ceil(6 / perPage));
    });

    test('이미 고른 카드를 거듭 눌러도 수량이 늘지 않는다: 누를 때마다 선택·해제가 번갈아 일어난다 (AC-012e)', async ({ page }) => {
      const box = treatmentBox(page, TREATMENT.xray);
      for (let round = 0; round < 3; round += 1) {
        await box.click();
        await expect(box).toBeChecked();
        expect(await summaryText(page)).toContain('1개');
        await box.click();
        await expect(box).not.toBeChecked();
        expect(await summaryText(page)).toContain('0개');
      }
    });

    test('치료를 고르기 전에는 "예상 부담액 확인"이 비활성이고 이유 문장이 보이며 눌러도 계산 요청이 없다 (AC-012b)', async ({ page }) => {
      const api = await openKiosk(page);
      if (large) await setLargeText(page, true);
      await toK03(page);
      const confirm = bottomButton(page, '예상 부담액 확인');
      await expect(confirm).toHaveAttribute('aria-disabled', 'true');
      await expect(page.getByText('치료를 1개 이상 선택하면 예상 부담액을 확인할 수 있습니다.')).toBeVisible();
      await confirm.click({ force: true });
      await page.waitForTimeout(300);
      expect(api.callsTo('estimate')).toHaveLength(0);
      expect(await summaryText(page)).toContain('0개');
      expect(await summaryText(page)).toContain('0원');
      // 치료를 고르면 이유 문장은 사라지고 버튼이 켜진다.
      await selectTreatment(page, TREATMENT.xray);
      await expect(confirm).not.toHaveAttribute('aria-disabled', 'true');
      await expect(page.getByText('치료를 1개 이상 선택하면')).toHaveCount(0);
      // 다시 해제하면 비활성으로 돌아간다.
      await selectTreatment(page, TREATMENT.xray, false);
      await expect(confirm).toHaveAttribute('aria-disabled', 'true');
    });

    test('예시 네 가지를 모두 고르면 선택 4개, 급여 14,000원 · 비급여 110,000원, 총 예상 결제액 124,000원이 즉시 보인다 (AC-012f·AC-019c)', async ({ page }) => {
      for (const name of [TREATMENT.xray, TREATMENT.ultrasound, TREATMENT.kidney, TREATMENT.physio]) await selectTreatment(page, name);
      const summary = await summaryText(page);
      expect(summary).toContain('4개');
      expect(summary).toContain('14,000원');
      expect(summary).toContain('110,000원');
      expect(summary).toContain('124,000원');
      // 하나를 풀면 합계가 바로 줄어든다.
      await selectTreatment(page, TREATMENT.physio, false);
      expect(await summaryText(page)).toContain('54,000원');
      expect(await summaryText(page)).toContain('3개');
    });

    test('"예상 부담액 확인"은 계산 요청을 하나 보내고 본문은 선택한 치료·세대·형태·원인과 병원 자료 버전을 담는다', async ({ page }) => {
      const api = await openKiosk(page);
      if (large) await setLargeText(page, true);
      await toK03(page);
      await selectTreatment(page, TREATMENT.kidney);
      await selectTreatment(page, TREATMENT.xray);
      await bottomButton(page, '예상 부담액 확인').click();
      await expect.poll(() => api.callsTo('estimate').length).toBe(1);
      expect(estimateTreatmentIds(api)[0]?.slice().sort()).toEqual(['TEST_FIXTURE_TREATMENT_1', 'TEST_FIXTURE_TREATMENT_3']);
      const body = JSON.parse(api.callsTo('estimate')[0]?.postData ?? '{}') as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(['catalogVersion', 'cause', 'generation', 'insurerType', 'ruleBundleVersion', 'treatmentIds']);
      expect(body).toMatchObject({ catalogVersion: 'TEST_FIXTURE_CATALOG_V1', ruleBundleVersion: 'TEST_FIXTURE_BUNDLE_V1', generation: 'GEN2_C1', insurerType: 'NON_LIFE', cause: 'INJURY' });
      // 요청이 나간 뒤에는 이 화면의 카드·버튼이 보이지 않는다(계산 중 화면으로 넘어갔다).
      await expect(heading(page, TITLES.treatments)).toHaveCount(0);
    });

    test('쪽을 넘겨 고른 치료도 같은 요청에 들어간다 (선택은 쪽에 묶이지 않는다)', async ({ page }) => {
      const api = await openKiosk(page);
      if (large) await setLargeText(page, true);
      await toK03(page);
      await selectTreatment(page, TREATMENT.xray);
      await selectTreatment(page, TREATMENT.sixth);
      await bottomButton(page, '예상 부담액 확인').click();
      await expect.poll(() => api.callsTo('estimate').length).toBe(1);
      expect(estimateTreatmentIds(api)[0]?.slice().sort()).toEqual(['TEST_FIXTURE_TREATMENT_1', 'TEST_FIXTURE_TREATMENT_6']);
    });
  });
}

test.describe('쪽 넘김은 선택 목록의 카드를 서로 섞지 않는다', () => {
  test('큰 글자 보기에서 한 쪽 두 장씩 세 쪽이고 쪽마다 카드가 다르다', async ({ page }) => {
    await openKiosk(page);
    await setLargeText(page, true);
    await toK03(page);
    const seen: string[] = [];
    for (let target = 1; target <= 3; target += 1) {
      await goToTreatmentPage(page, target);
      seen.push(...(await page.locator('.kiosk-choice--treatment .kiosk-choice__name').allInnerTexts()));
    }
    expect(seen).toEqual([TREATMENT.xray, TREATMENT.ultrasound, TREATMENT.kidney, TREATMENT.physio, TREATMENT.fifth, TREATMENT.sixth]);
    expect(await checkedBoxes(page)).toEqual([false, false]);
  });

  test('갱신 뒤 목록이 줄어 현재 쪽이 없어지면 쪽이 범위 안으로 보정된다 (쪽 번호가 범위를 벗어나지 않는다)', async ({ page }) => {
    const api = await openKiosk(page);
    await toK03(page);
    await selectTreatment(page, TREATMENT.xray);
    await goToTreatmentPage(page, 2);
    api.queue('estimate', reply(409, MISMATCH_409));
    const catalog = api.hold('catalog');
    const options = api.hold('options');
    await bottomButton(page, '예상 부담액 확인').click();
    await expect(refreshNotice(page, 'running')).toBeVisible();
    await catalog.arrived();
    await options.arrived();
    // 새 자료는 치료가 세 개뿐이라 쪽이 하나뿐이다. 둘째 쪽에 있던 환자는 범위 안의 쪽을 본다.
    catalog.release(reply(200, { ...refreshedCatalog(), treatments: refreshedCatalog().treatments.slice(0, 3) }));
    options.release(reply(200, refreshedOptions()));
    await expect(refreshNotice(page, 'running')).toHaveCount(0);
    await expect(pagerStatus(page)).toHaveText('1 / 1 페이지');
    await expect(page.getByRole('checkbox')).toHaveCount(3);
    await expect(treatmentBox(page, TREATMENT.xray)).toBeChecked();
  });
});
