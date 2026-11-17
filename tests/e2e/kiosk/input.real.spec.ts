import { expect, test } from '../helpers/test';
import type { Page } from '@playwright/test';
import { KIOSK_PATH, expectStartScreen, startButton } from '../helpers/kiosk';
import { TITLES, bottomButton, heading, setLargeText, summaryText } from '../helpers/input';

// 실제 핸들러 층 (BRIEF D12): 시험용 앞단 서버가 /api/clinics/* 를 실제 핸들러(handleCatalog·handleOptions·handleEstimate)에 시험 자료(TEST_FIXTURE) 서비스로 맡긴다.
// 실제 핸들러 논리를 시험 자료로 돌린 것이며 운영 자료 검증이 아니다. 키오스크의 입력 화면이 실제 응답 모양의 카드·치료 목록을 읽고, 선택한 값이 실제 계산 핸들러가 받는 요청으로 나가는지를 본다.
// AC 대응: AC-012a·b·f(실제 병원 자료로 4단계까지, 합계) · AC-012h(안내 문장이 실제 options 응답의 guidance 와 같다) · AC-019c(키오스크 합계가 실제 병원 자료의 금액 합과 같다 — 계산 결과 비교는 S3·M6 결과 화면에서 이어진다).

interface CatalogBody {
  catalogVersion: string | null;
  baseFees: Array<{ benefitType: 'BENEFIT' | 'NON_BENEFIT'; amount: number }>;
  treatments: Array<{ treatmentId: string; displayName: string; benefitType: 'BENEFIT' | 'NON_BENEFIT'; patientAmount: number; order: number }>;
}
interface OptionsBody {
  ruleBundleVersion: string;
  generations: Array<{ code: string; label: string; period: string }>;
  insurerTypes: Array<{ code: string; label: string }>;
  causes: Array<{ code: string; label: string }>;
  guidance: { generationUnknown: string };
}

const won = (value: number): string => `${value.toLocaleString('ko-KR')}원`;

async function open(page: Page): Promise<{ catalog: CatalogBody; options: OptionsBody }> {
  const catalogResponse = page.waitForResponse((response) => response.url().endsWith(`/api/clinics/${'test-fixture-clinic-1'}/catalog`));
  const optionsResponse = page.waitForResponse((response) => response.url().endsWith('/insurance/options'));
  await page.goto(KIOSK_PATH);
  await expectStartScreen(page);
  return { catalog: (await (await catalogResponse).json()) as CatalogBody, options: (await (await optionsResponse).json()) as OptionsBody };
}

test.describe('실제 catalog·options·estimate 핸들러로 4단계까지', () => {
  for (const large of [false, true]) {
    test(`${large ? '큰 글자 보기: ' : ''}실제 응답의 카드(세대·형태·원인)와 치료 목록·합계·가입 시기 안내가 화면에 나오고, 확인하면 실제 계산 핸들러가 같은 선택을 받는다`, async ({ page }) => {
      const { catalog, options } = await open(page);
      expect(catalog.treatments.length).toBeGreaterThan(1);
      expect(catalog.baseFees.length).toBeGreaterThan(0);
      if (large) await setLargeText(page, true);
      await startButton(page).click();
      await expect(heading(page, TITLES.generation)).toBeVisible();

      // 1단계: 카드는 실제 options 응답의 세대 그대로이고, 안내 문장은 실제 guidance 와 같다 (AC-012h).
      expect(await page.getByRole('radio').evaluateAll((inputs) => inputs.map((input) => input.getAttribute('aria-label')))).toEqual(options.generations.map((card) => card.label));
      const panel = page.getByRole('region', { name: '가입 시기를 모르실 때' });
      for (const sentence of options.guidance.generationUnknown.split(/(?<=\.)\s+/)) await expect(panel).toContainText(sentence);
      await expect(panel.locator('a, [href]')).toHaveCount(0);
      await page.getByRole('radio').nth(1).check();
      await bottomButton(page, '다음').click();

      // 2·3단계: 카드는 실제 응답의 형태·원인 그대로.
      await expect(heading(page, TITLES.type)).toBeVisible();
      expect(await page.locator('.kiosk-choice__name').allInnerTexts()).toEqual(options.insurerTypes.map((card) => card.label));
      await page.getByRole('radio').first().check();
      await bottomButton(page, '다음').click();
      await expect(heading(page, TITLES.cause)).toBeVisible();
      expect(await page.locator('.kiosk-choice__name').allInnerTexts()).toEqual(options.causes.map((card) => card.label));
      await page.getByRole('radio').first().check();
      await bottomButton(page, '다음').click();

      // 4단계: 실제 catalog 의 치료. 처음 둘을 고르면 합계는 실제 금액의 합과 같다.
      await expect(heading(page, TITLES.treatments)).toBeVisible();
      // 실제 자료에는 이름이 같은 치료가 둘 있다(시험 자료): 이름이 아니라 목록 순서(order)의 처음 둘을 쓴다. 큰 글자 보기도 한 쪽에 둘이라 첫 쪽에 모두 있다.
      const chosen = [...catalog.treatments].sort((left, right) => left.order - right.order).slice(0, 2);
      await expect(page.getByRole('checkbox')).toHaveCount(large ? 2 : Math.min(4, catalog.treatments.length));
      await page.getByRole('checkbox').nth(0).check();
      await page.getByRole('checkbox').nth(1).check();
      // 공통 기본비용이 등록된 병원은 치료를 하나 이상 고르면 그 줄이 합계에 들어간다(DD-19): 실제 응답의 baseFees 도 더해 기대값을 만든다.
      const lines = [...chosen.map((entry) => ({ benefitType: entry.benefitType, amount: entry.patientAmount })), ...catalog.baseFees];
      const benefit = lines.filter((line) => line.benefitType === 'BENEFIT').reduce((sum, line) => sum + line.amount, 0);
      const nonBenefit = lines.filter((line) => line.benefitType === 'NON_BENEFIT').reduce((sum, line) => sum + line.amount, 0);
      const summary = await summaryText(page);
      expect(summary).toContain('2개');
      expect(summary).toContain(won(benefit));
      expect(summary).toContain(won(nonBenefit));
      expect(summary).toContain(won(benefit + nonBenefit));

      // 확인: 실제 estimate 핸들러가 이 선택을 받는다.
      const estimate = page.waitForRequest((request) => request.url().endsWith('/estimate') && request.method() === 'POST');
      const estimateResponse = page.waitForResponse((response) => response.url().endsWith('/estimate'));
      await bottomButton(page, '예상 부담액 확인').click();
      const request = await estimate;
      const body = JSON.parse(request.postData() ?? '{}') as { treatmentIds: string[]; catalogVersion: string | null; ruleBundleVersion: string; generation: string };
      expect(body.treatmentIds.slice().sort()).toEqual(chosen.map((entry) => entry.treatmentId).sort());
      expect(body.catalogVersion).toBe(catalog.catalogVersion);
      expect(body.ruleBundleVersion).toBe(options.ruleBundleVersion);
      expect(body.generation).toBe(options.generations[1]?.code);
      const response = await estimateResponse;
      // 실제 핸들러가 받아들인 요청이다(계약대로 200). 결과 화면 검증은 results.real.spec.ts·sheets.real.spec.ts 가 한다.
      expect(response.status()).toBe(200);
      expect(response.headers()['cache-control']).toBe('no-store');
    });
  }
});
