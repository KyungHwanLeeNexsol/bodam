import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const sizes = [
  { name: 'PC', width: 1440, height: 900, touch: false, columns: 3 },
  { name: 'small laptop', width: 1280, height: 720, touch: false, columns: 3 },
  { name: 'tablet landscape', width: 1024, height: 768, touch: true, columns: 3 },
  { name: 'tablet portrait', width: 768, height: 1024, touch: true, columns: 2 },
  { name: 'split view', width: 390, height: 844, touch: true, columns: 1 },
  { name: 'narrow enlarged text', width: 320, height: 650, touch: true, columns: 1 },
];

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const root = document.documentElement;
    const shell = document.querySelector('.kiosk-root');
    return Math.max(root.scrollWidth - root.clientWidth, shell ? shell.scrollWidth - shell.clientWidth : 1);
  })).toBeLessThanOrEqual(1);
}

for (const size of sizes) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch });
    test('keeps the four choices and the original result usable', async ({ page }) => {
      await page.goto('/');
      const start = page.getByRole('button', { name: '시작하기', exact: true });
      expect((await start.boundingBox())?.height).toBeGreaterThanOrEqual(size.touch ? 54 : 48);
      await expectNoHorizontalOverflow(page);
      if (size.width === 320) {
        const toggle = page.getByRole('button', { name: '큰 글자 보기' });
        const baseFont = await start.evaluate((button) => parseFloat(getComputedStyle(button).fontSize));
        await toggle.click();
        expect(await start.evaluate((button) => parseFloat(getComputedStyle(button).fontSize))).toBeGreaterThan(baseFont);
      }
      await start.click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('내 실손보험을 선택해 주세요');
      await expect(page.getByRole('radio')).toHaveCount(5);
      await expectNoHorizontalOverflow(page);
      // A wide layout may use columns, but its cards must not create an independent scroll trap.
      const choices = page.locator('.kiosk-input__choices');
      expect(await choices.evaluate((element) => getComputedStyle(element).overflowY)).toBe('visible');
      await page.getByRole('radio', { name: '4세대(C4)', exact: true }).check();
      await page.getByRole('button', { name: '다음', exact: true }).click();
      await page.getByRole('radio', { name: '손해보험사', exact: true }).check();
      await expectNoHorizontalOverflow(page);
      await page.getByRole('button', { name: '다음', exact: true }).click();
      await page.getByRole('radio', { name: /아파서 왔어요/ }).check();
      await expectNoHorizontalOverflow(page);
      await page.getByRole('button', { name: '다음', exact: true }).click();
      await page.getByRole('checkbox', { name: '체외충격파치료', exact: true }).check();
      await expect(page.getByRole('region', { name: '선택 요약' }).getByText('100,000원', { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      for (const checkbox of await page.getByRole('group', { name: '실손보험 확인 조건' }).getByRole('checkbox').all()) {
        await checkbox.check();
      }
      await page.getByRole('button', { name: '예상 부담액 확인', exact: true }).click();
      const resultActions = page.locator('.kiosk-result-actions');
      await expect(resultActions.getByRole('button', { name: '처음으로', exact: true })).toHaveCount(0);
      await expect(resultActions.getByRole('button', { name: '치료 다시 선택', exact: true })).toBeVisible();
      await expect(resultActions.getByRole('button', { name: '보험 조건 수정', exact: true })).toBeVisible();
      const amountCards = page.locator('.kiosk-amounts');
      await expect(amountCards.getByText('30,000원', { exact: true })).toBeVisible();
      await expect(amountCards.getByText('70,000원', { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(await amountCards.evaluate((group) => getComputedStyle(group).gridTemplateColumns.split(' ').length)).toBe(size.columns);
      await page.getByRole('button', { name: '계산 근거 보기', exact: true }).click();
      await expect(page.getByRole('link', { name: /병원 비급여 공식 가격표/ })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.getByRole('button', { name: '결과로 돌아가기', exact: true }).click();
      await page.getByRole('button', { name: '보험 청구에 필요한 서류 확인', exact: true }).click();
      await expect(page.getByRole('heading', { name: '보험사에 필요한 서류를 확인해 주세요' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.getByRole('button', { name: '결과로 돌아가기', exact: true }).click();
      await resultActions.getByRole('button', { name: '이용 완료', exact: true }).click();
      await expect(page.getByRole('heading', { name: '이용해 주셔서 감사합니다', exact: true })).toBeVisible();
      await expect(amountCards).toHaveCount(0);
      await page.getByRole('button', { name: '처음 화면으로', exact: true }).click();
      await page.getByRole('button', { name: '시작하기', exact: true }).click();
      await expect(page.getByRole('radio', { name: '4세대(C4)', exact: true })).not.toBeChecked();
    });
  });
}

test('turning a tablet sideways keeps the patient selection', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/');
  await page.getByRole('button', { name: '시작하기', exact: true }).click();
  const generation = page.getByRole('radio', { name: '4세대(C4)', exact: true });
  await generation.check();
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(generation).toBeChecked();
  await expect(page.getByRole('button', { name: '다음', exact: true })).toBeEnabled();
  await expectNoHorizontalOverflow(page);
});
