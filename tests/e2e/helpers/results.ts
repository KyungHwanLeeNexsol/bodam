import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { HANG, reply } from './api';
import type { ApiMock, Behavior, Held } from './api';
import { TREATMENT, bottomButton, selectTreatment, toK03 } from './input';
import type { CatalogDto } from '../../../src/app/kiosk/state/api-types';
import { DD10_SCREENS, makeCatalog } from '../../fixtures/kiosk/clinic.fixture';
import { estimatedResponse, holdResponse, notCoveredResponse, withAmounts } from '../../fixtures/kiosk/estimate-response.fixture';

// 시험 자료(TEST_FIXTURE). 결과 쪽 화면(S3a: 계산 중·결과 셋·통신 오류)을 브라우저로 시험하는 공통 도구: 입력을 채우고 계산을 일으키고 화면 상태를 찾는다.
// 화면 이름은 환자에게 보이지 않으므로 기능 표지(data-result·data-kiosk-state)·제목·버튼 이름으로 찾는다. 응답 본문은 가로채기 층의 시험 자료(estimate-response.fixture)다.

export const RESULT_TITLE = '선택한 조건의 예상 금액입니다';

/** 시험 병원 자료에서 디자인 예시와 같은 합계(급여 14,000 + 비급여 110,000 = 124,000)가 되는 네 치료. */
export const FOUR_TREATMENTS = [TREATMENT.xray, TREATMENT.ultrasound, TREATMENT.kidney, TREATMENT.physio] as const;

export const resultRoot = (page: Page): Locator => page.locator('[data-result]');
export const calculating = (page: Page): Locator => page.locator('[data-kiosk-state="CALCULATING"]');
export const networkError = (page: Page): Locator => page.locator('[data-kiosk-state="NETWORK_ERROR"]');
export const amountCard = (page: Page, tone: 'hospital' | 'payout' | 'after'): Locator => page.locator(`[data-kiosk-amount="${tone}"]`);
export const amountValue = (page: Page, tone: 'hospital' | 'payout' | 'after'): Locator => amountCard(page, tone).locator('.kiosk-amount__value');
export const actionsOf = (page: Page): Locator => page.locator('.kiosk-result-actions').getByRole('button');
export const testDataNotice = (page: Page): Locator => page.locator('[data-kiosk-test-data]');

/** 네 치료를 모두 고른 4단계(치료 목록은 쪽으로 나뉘므로 쪽을 넘기며 고른다). */
export async function toFilledK03(page: Page): Promise<void> {
  await toK03(page);
  for (const name of FOUR_TREATMENTS) await selectTreatment(page, name);
}

export const confirmButton = (page: Page): Locator => bottomButton(page, '예상 부담액 확인');

/** 응답을 정해 두고 "예상 부담액 확인"을 누른다. 응답을 정하지 않으면 끝내 오지 않는 응답(계산 중에 머문다)이다. */
export async function submitEstimate(page: Page, api: ApiMock, behavior?: Behavior): Promise<void> {
  if (behavior !== undefined) api.queue('estimate', behavior);
  await confirmButton(page).click();
}

export type ResultScreenName = 'KXX_Loading_Calculating' | 'K04_Result' | 'K04_Result_NotCovered' | 'K04_Result_Hold' | 'K04_Result_LongAmounts' | 'KXX_Error_Network';

export const RESULT_SCREENS: readonly ResultScreenName[] = ['KXX_Loading_Calculating', 'K04_Result', 'K04_Result_NotCovered', 'K04_Result_Hold', 'K04_Result_LongAmounts', 'KXX_Error_Network'];

/** 아주 큰 금액(10억 단위): 카드 안에서 줄어들어 들어가는지 본다. 병원 결제액이 선택 요약과 달라 급여·비급여 내역은 나오지 않는다. */
export const LONG_AMOUNTS = { hospitalPayment: 1_234_567_890, expectedInsurancePayout: 1_034_567_890, expectedOutOfPocketAfterPayout: 200_000_000 } as const;

/** 이름이 가리키는 화면까지 간다. 화면 방향·큰 글자 보기는 호출하는 시험이 정한다. */
export async function reachResultScreen(page: Page, api: ApiMock, screen: ResultScreenName): Promise<void> {
  await toFilledK03(page);
  switch (screen) {
    case 'KXX_Loading_Calculating':
      await submitEstimate(page, api, HANG);
      await expect(calculating(page)).toBeVisible();
      return;
    case 'K04_Result':
      await submitEstimate(page, api, reply(200, estimatedResponse()));
      await expect(resultRoot(page)).toHaveAttribute('data-result', 'normal');
      return;
    case 'K04_Result_NotCovered':
      await submitEstimate(page, api, reply(200, notCoveredResponse()));
      await expect(resultRoot(page)).toHaveAttribute('data-result', 'not-covered');
      return;
    case 'K04_Result_Hold':
      await submitEstimate(
        page,
        api,
        reply(
          200,
          holdResponse([
            [TREATMENT_ID.xray, 'MAPPING_ABSENT'],
            [TREATMENT_ID.ultrasound, 'PROFILE_VALUE_MISSING'],
            [TREATMENT_ID.kidney, 'CLASSIFICATION_NEEDS_REVIEW'],
            [TREATMENT_ID.physio, 'LINE_ORIGIN_NOT_ACCEPTED'],
          ]),
        ),
      );
      await expect(resultRoot(page)).toHaveAttribute('data-result', 'hold');
      return;
    case 'K04_Result_LongAmounts':
      await submitEstimate(page, api, reply(200, withAmounts(estimatedResponse(), LONG_AMOUNTS)));
      await expect(resultRoot(page)).toHaveAttribute('data-result', 'normal');
      return;
    case 'KXX_Error_Network':
      await submitEstimate(page, api, reply(500, { error: 'INTERNAL_ERROR' }));
      await expect(networkError(page)).toBeVisible();
      return;
  }
}

/** 치료 id: 시험 병원 자료(tests/fixtures/kiosk/clinic.fixture)의 순서와 같다. */
export const TREATMENT_ID = {
  xray: 'TEST_FIXTURE_TREATMENT_1',
  ultrasound: 'TEST_FIXTURE_TREATMENT_2',
  kidney: 'TEST_FIXTURE_TREATMENT_3',
  physio: 'TEST_FIXTURE_TREATMENT_4',
} as const;

/** 마크업 속 글을 한 줄로 합친 화면 전체의 글(공백 정리). */
export async function screenText(page: Page): Promise<string> {
  return (await page.locator('.kiosk-screen').innerText()).replace(/\s+/g, ' ').trim();
}

// ───────────── 겹침창 위의 결말 (AC-015l~p) ─────────────

/** 겹침창이 열려 있어도 밑 화면(inert 덮개 안)을 찾는다: 겹침창 아래에서는 역할 조회가 밑 화면을 보지 못한다. */
export const under = (page: Page, selector: string): Locator => page.locator(`.kiosk-underlay ${selector}`);
export const underCalculating = (page: Page): Locator => under(page, '[data-kiosk-state="CALCULATING"]');
export const underError = (page: Page): Locator => under(page, '[data-kiosk-state="NETWORK_ERROR"]');
export const underResult = (page: Page, kind: 'normal' | 'not-covered' | 'hold'): Locator => under(page, `[data-result="${kind}"]`);
export const underTreatments = (page: Page): Locator => under(page, '[data-input="treatments"]');

export const resetDialog = (page: Page): Locator => page.getByRole('dialog').filter({ hasText: '선택 내용을 지우고 처음으로 돌아갈까요?' });
export const timeoutDialog = (page: Page): Locator => page.getByRole('dialog').filter({ hasText: '계속 사용하시겠어요?' });

/** 화면 종류별 무조작 정책(초). 시험이 정한 값만 바꾸고 나머지는 DD-10 표의 값이다. 계산 요청의 제한은 15초(주입 불가)라 경고·초기화를 그 앞뒤로 둘 수 있다. */
export function idlePolicyWith(overrides: Partial<Record<'INPUT' | 'RESULT' | 'BASIS_AND_DOCUMENTS' | 'HOLD_RESULT' | 'NOTICE_PROGRESS_ERROR', { warnSeconds: number; resetSeconds: number }>>): NonNullable<CatalogDto['idlePolicy']> {
  return { screens: { ...DD10_SCREENS, ...overrides }, completionHoldSeconds: null };
}

/** 입력을 채우고 계산을 일으켜, 응답을 시험이 풀어 줄 때까지 붙잡힌 계산 중 화면까지 간다. */
export async function openCalculating(page: Page, api: ApiMock): Promise<Held> {
  const held = api.hold('estimate');
  await toFilledK03(page);
  await confirmButton(page).click();
  await held.arrived();
  await expect(calculating(page)).toBeVisible();
  return held;
}

// ───────────── 운영 자료 모양(짧은 이름): 한 화면에 들어가는지 (DD-12) ─────────────

export const SHORT_NAMES: Readonly<Record<string, string>> = {
  [TREATMENT_ID.xray]: 'X-ray',
  [TREATMENT_ID.ultrasound]: '초음파',
  [TREATMENT_ID.kidney]: '신장분사치료',
  [TREATMENT_ID.physio]: '물리치료',
};

/** 시험 병원 자료의 치료 이름을 운영 병원처럼 짧게 한 병원 자료(치료 여섯, 앞의 넷만 이름이 바뀐다). */
export function shortNamedCatalog(): CatalogDto {
  const base = makeCatalog();
  return { ...base, treatments: base.treatments.map((entry) => ({ ...entry, displayName: SHORT_NAMES[entry.treatmentId] ?? entry.displayName })) };
}

/** 첫 쪽의 치료 넷을 순서대로 고른다(일반 글자는 한 쪽에 넷이다). 이름이 아니라 위치로 고르므로 짧은 이름 병원 자료에도 쓴다. */
export async function pickFirstFour(page: Page): Promise<void> {
  const boxes = page.getByRole('checkbox');
  await expect(boxes).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) await boxes.nth(index).check();
}

/** 본문이 스크롤 없이 한 화면에 들어가는가(내용 높이 ≤ 보이는 높이). */
export async function bodyFits(page: Page): Promise<{ fits: boolean; scrollHeight: number; clientHeight: number }> {
  return page.locator('.kiosk-result__body').evaluate((element) => ({ fits: element.scrollHeight <= element.clientHeight + 1, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
}
