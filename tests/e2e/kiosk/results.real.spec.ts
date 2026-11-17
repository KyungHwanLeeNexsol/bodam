import { expect, test } from '../helpers/test';
import type { Page } from '@playwright/test';
import { expectStartScreen, startButton } from '../helpers/kiosk';
import { TITLES, bottomButton, expectLayoutClean, heading, setLargeText, summaryText } from '../helpers/input';
import { actionsOf, amountValue, resultRoot, screenText, testDataNotice } from '../helpers/results';

// 실제 핸들러 층 (SPEC-REIMBURSEMENT-001 M6 S3a, BRIEF D12): 시험용 앞단 서버가 /api/clinics/* 를 실제 핸들러(handleCatalog·handleOptions·handleEstimate)에 시험 자료(TEST_FIXTURE) 서비스로 맡긴다.
// 실제 핸들러 논리를 시험 자료의 세계로 돌린 것이며 운영 자료 검증이 아니다. 결과 화면이 실제 계산 응답을 그대로 그리는지(금액·보류 분류·테스트 데이터 표시)를 본다.
//  - 병원 1: 규칙 묶음이 있어 정상(ESTIMATED) 응답. 병원 2: 규칙 사용 범위가 없어 보류(ON_HOLD) 응답.
// AC 대응: AC-013a·c(실제 응답으로 그린 정상·보류 결과) · AC-010e(실제 응답의 origin 에 따른 표시) · AC-019c(키오스크 선택 요약의 합계 = 실제 서버가 센 병원 결제액).

const HOLD_SLUG = 'test-fixture-clinic-2';
const OK_SLUG = 'test-fixture-clinic-1';

interface EstimateBody {
  origin: string;
  result: {
    state: string;
    amounts: { hospitalPayment: number; expectedInsurancePayout: number | null; expectedOutOfPocketAfterPayout: number | null };
    holdReasons: Array<{ treatmentId: string; code: string }>;
    lines: Array<{ displayName: string }>;
  };
}

const won = (value: number): string => `${value.toLocaleString('ko-KR')}원`;

/** 병원의 입력 4단계를 채우고 확인 직전까지 간다: 세대는 generationIndex 번째 카드(4 = 4세대(C4)), 보험사 형태·원인은 첫 카드(손해보험사·상해), 치료는 앞에서 picks 개. */
async function fillToConfirm(page: Page, slug: string, picks: number, large: boolean, generationIndex: number): Promise<void> {
  await page.goto(`/kiosk/${slug}`);
  await expectStartScreen(page);
  if (large) await setLargeText(page, true);
  await startButton(page).click();
  await expect(heading(page, TITLES.generation)).toBeVisible();
  await page.getByRole('radio').nth(generationIndex).check();
  await bottomButton(page, '다음').click();
  await expect(heading(page, TITLES.type)).toBeVisible();
  await page.getByRole('radio').first().check();
  await bottomButton(page, '다음').click();
  await expect(heading(page, TITLES.cause)).toBeVisible();
  await page.getByRole('radio').first().check();
  await bottomButton(page, '다음').click();
  await expect(heading(page, TITLES.treatments)).toBeVisible();
  for (let index = 0; index < picks; index += 1) await page.getByRole('checkbox').nth(index).check();
}

async function confirm(page: Page): Promise<EstimateBody> {
  const response = page.waitForResponse((entry) => entry.url().endsWith('/estimate') && entry.request().method() === 'POST');
  await bottomButton(page, '예상 부담액 확인').click();
  const reply = await response;
  expect(reply.status()).toBe(200);
  expect(reply.headers()['cache-control']).toBe('no-store');
  return (await reply.json()) as EstimateBody;
}

for (const large of [false, true]) {
  test.describe(large ? '큰 글자 보기' : '일반', () => {
    test('병원 1 (규칙 묶음 있음): 실제 정상 응답이 결과 화면에 그대로 그려지고, 선택 요약의 합계는 서버가 센 병원 결제액과 같다', async ({ page }) => {
      await fillToConfirm(page, OK_SLUG, 2, large, 4);
      const preview = await summaryText(page);
      const body = await confirm(page);
      expect(body.result.state).toBe('ESTIMATED');
      await expect(resultRoot(page)).toHaveAttribute('data-result', 'normal');
      const { hospitalPayment, expectedInsurancePayout, expectedOutOfPocketAfterPayout } = body.result.amounts;
      expect(expectedInsurancePayout).not.toBeNull();
      await expect(amountValue(page, 'hospital')).toHaveText(won(hospitalPayment));
      await expect(amountValue(page, 'payout')).toHaveText(won(expectedInsurancePayout as number));
      await expect(amountValue(page, 'after')).toHaveText(won(expectedOutOfPocketAfterPayout as number));
      // AC-019c: 확인 직전 선택 요약(엔진 sumLineAmounts)의 총 예상 결제액 = 실제 서버의 병원 결제액.
      expect(preview).toContain(won(hospitalPayment));
      // AC-010e: 실제 응답의 origin 이 운영이 아니므로 표시가 있다 (코드 값은 화면에 없다).
      expect(body.origin).not.toBe('OPERATING');
      await expect(testDataNotice(page)).toBeVisible();
      const text = await screenText(page);
      // 표시는 고정 문구뿐이다: 응답의 origin 값(코드)을 싣지 않는다. (시험 병원 자료의 치료 이름에도 TEST_FIXTURE 가 있어 표시 요소만 본다.)
      expect((await testDataNotice(page).innerText()).trim()).toBe('테스트 데이터로 계산한 예시입니다. 실제 보험금 안내에 사용할 수 없습니다.');
      expect(text).not.toMatch(/\bOPERATING\b|\bDEMO\b/);
      expect(text).toContain('표준 공제·한도 가정으로 계산한 예상 금액입니다.');
      expect(await actionsOf(page).allInnerTexts()).toEqual(['보험 청구에 필요한 서류 확인', '계산 근거 보기', '치료 다시 선택', '보험 조건 수정', '처음으로', '이용 완료']);
      await expectLayoutClean(page, `실제 정상 결과 ${large ? 'large' : 'normal'}`);
    });

    test('병원 2 (규칙 사용 범위 없음): 실제 보류 응답 — 병원 결제액만 숫자이고 나머지는 "확인 필요", 환자용 분류 문구만 보이고 내부 코드가 없다', async ({ page }) => {
      await fillToConfirm(page, HOLD_SLUG, 1, large, 4);
      const body = await confirm(page);
      expect(body.result.state).toBe('ON_HOLD');
      expect(body.result.amounts.expectedInsurancePayout).toBeNull();
      await expect(resultRoot(page)).toHaveAttribute('data-result', 'hold');
      await expect(amountValue(page, 'hospital')).toHaveText(won(body.result.amounts.hospitalPayment));
      await expect(amountValue(page, 'payout')).toHaveText('확인 필요');
      await expect(amountValue(page, 'after')).toHaveText('확인 필요');
      const text = await screenText(page);
      expect(text).toContain('표준 가정 자료가 아직 준비되지 않았습니다');
      expect(text).not.toMatch(/CLINIC_RULE_SCOPE_ABSENT|RULE_BUNDLE|PROFILE_|MAPPING_|LINE_|referenceGroups/);
      expect(text).not.toContain('표준 공제·한도 가정으로 계산한 예상 금액입니다');
      expect(text).toContain('개인별 부담보, 면책·보장기간, 잔여 한도·횟수, 치료 목적 및 심사 결과에 따라 실제 지급액이 달라질 수 있습니다.');
      expect(await actionsOf(page).allInnerTexts()).toEqual(['치료 다시 선택', '보험 조건 수정', '처음으로', '이용 완료']);
      await expectLayoutClean(page, `실제 보류 결과 ${large ? 'large' : 'normal'}`);
    });
  });
}
