import { expect, test } from '../helpers/test';
import type { Page } from '@playwright/test';
import { ABORT, reply, replyRaw } from '../helpers/api';
import type { ApiMock } from '../helpers/api';
import { installClock } from '../helpers/clock';
import { platformFonts } from '../helpers/fonts';
import { MARKER_PREFIX, findUuids, installMarkerIds } from '../helpers/ids';
import { dumpStorage } from '../helpers/storage';
import { KIOSK_PATH, dialog, expectStartScreen, startButton } from '../helpers/kiosk';
import { TITLES, TREATMENT, bottomButton, expectLayoutClean, focusRingProblems, heading, openKiosk, selectTreatment, setLargeText, summaryText, swapOrientation, tabTo, toK03 } from '../helpers/input';
import {
  FOUR_TREATMENTS,
  RESULT_TITLE,
  SHORT_NAMES,
  TREATMENT_ID,
  actionsOf,
  amountCard,
  amountValue,
  bodyFits,
  calculating,
  confirmButton,
  networkError,
  openCalculating,
  pickFirstFour,
  reachResultScreen,
  resultRoot,
  screenText,
  shortNamedCatalog,
  submitEstimate,
  testDataNotice,
  toFilledK03,
} from '../helpers/results';
import { estimatedResponse, holdResponse, notCoveredResponse, renamed, withAmounts } from '../../fixtures/kiosk/estimate-response.fixture';

// 가로채기 층 (SPEC-REIMBURSEMENT-001 M6 S3a, BRIEF D12): 계산 중 · 결과 셋 · 통신 오류 화면의 내용과 동작을 실제 Chrome 에서 본다. 응답은 시험이 정한다(가로채기). 운영 자료도 실제 핸들러도 아니다.
// AC 대응: AC-013a(정상) · AC-013b(보장 제외) · AC-013c(보류) · AC-013d(오류) · AC-013e(여섯 동작) · AC-013f(금지 표현) · AC-010e(테스트 데이터) · AC-014e/g/h/i 의 결과 쪽(전환해도 결과·금액 유지, 요청 없음)
//          · AC-015f 의 이용 종료 · AC-015g/j("처음으로") · AC-016c(응답 전 초기화·다음 환자 뒤의 늦은 응답) · AC-019c(미리보기 합계 = 결과의 병원 결제액).
// 겹침창 위에서 결말이 도착하는 경우(AC-015l~p)는 results-overlays.intercept.spec.ts 가 본다. 근거·서류·이용 완료 화면의 내용은 sheets.intercept.spec.ts 가 보고, 여기서는 그리로 가는 길과 도착한 화면의 표지까지만 본다(S3b 로 임시 화면이 사라졌다).

const standaloneZero = (text: string): boolean => /(?<![\d,])0원/.test(text.replace('예상 보험금이 0원이라는 뜻이 아닙니다', ''));
const FORBIDDEN_TEXT = /환자분의 실손은|오늘 [^ ]* ?만 내면 됩니다|PROFILE_|MAPPING_|LINE_|CLASSIFICATION_|CALC_RANGE|RULE_BUNDLE|CLINIC_RULE|VERSION_MISMATCH|INTERNAL_ERROR|\b[45]\d\d\b|1588|tel:/;

async function noLinks(page: Page): Promise<void> {
  await expect(page.locator('.kiosk-root a, .kiosk-root [href]')).toHaveCount(0);
}

test.describe('계산 중 (KXX_Loading_Calculating)', () => {
  test('"예상 부담액 확인" → 계산 중: 상태 안내, 비활성 "이전"·"계산 중…", 요청은 하나이고 눌러도 새 요청이 없다', async ({ page }) => {
    const api = await openKiosk(page);
    await toFilledK03(page);
    await confirmButton(page).click();
    await expect(calculating(page)).toBeVisible();
    await expect(calculating(page).getByRole('status')).toBeVisible();
    const text = await screenText(page);
    expect(text).toContain('예상 금액을 계산하고 있습니다');
    expect(text).toContain('잠시만 기다려 주세요.');
    expect(text).toContain('계산이 끝나면 결과 화면으로 넘어갑니다.');
    expect(text).toContain('계산 중에는 버튼이 비활성화되어 중복 실행되지 않습니다.');
    await expect(page.locator('[data-kiosk-primary]')).toBeFocused();

    const buttons = page.locator('.kiosk-bottom-actions').getByRole('button');
    expect(await buttons.allInnerTexts()).toEqual(['처음으로', '이전', '계산 중…']);
    await expect(buttons.nth(0)).not.toHaveAttribute('aria-disabled', 'true');
    await expect(buttons.nth(1)).toHaveAttribute('aria-disabled', 'true');
    await expect(buttons.nth(2)).toHaveAttribute('aria-disabled', 'true');

    // 비활성 버튼은 눌러도 새 요청도 화면 이동도 없다.
    await buttons.nth(1).click({ force: true });
    await buttons.nth(2).click({ force: true });
    await expect(calculating(page)).toBeVisible();
    expect(api.callsTo('estimate')).toHaveLength(1);
    expect(await page.locator('.kiosk-screen').innerText()).not.toMatch(/\d원/);
  });

  test('계산 중에 큰 글자 보기·화면 방향을 바꿔도 계산 중에 머물고 요청이 새로 나가지 않는다', async ({ page }) => {
    const api = await openKiosk(page);
    await toFilledK03(page);
    await confirmButton(page).click();
    await expect(calculating(page)).toBeVisible();
    await setLargeText(page, true);
    await expect(calculating(page)).toBeVisible();
    await swapOrientation(page);
    await expect(calculating(page)).toBeVisible();
    await setLargeText(page, false);
    await expect(calculating(page)).toBeVisible();
    expect(api.callsTo('estimate')).toHaveLength(1);
  });

  test('계산 중의 "처음으로": 입력이 있으므로 확인창이 뜨고, 계속 이용하면 계산 중 그대로다 (계산 요청은 그대로 하나)', async ({ page }) => {
    await installClock(page);
    const api = await openKiosk(page);
    await openCalculating(page, api);
    await page.locator('.kiosk-bottom-actions').getByRole('button', { name: '처음으로' }).click();
    await expect(dialog(page)).toContainText('선택 내용을 지우고 처음으로 돌아갈까요?');
    await dialog(page).getByRole('button', { name: '계속 이용' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(calculating(page)).toBeVisible();
    expect(api.callsTo('estimate')).toHaveLength(1);
  });
});

test.describe('정상 결과 K04_Result (AC-013a·e·f)', () => {
  test('세 금액·고정 문구·보험 조건·여섯 동작이 기획서 §4 그대로 보인다', async ({ page }, testInfo) => {
    const api = await openKiosk(page);
    await toFilledK03(page);
    await submitEstimate(page, api, reply(200, estimatedResponse()));
    await expect(resultRoot(page)).toHaveAttribute('data-result', 'normal');
    await expect(page.locator('[data-kiosk-primary]')).toBeFocused();
    await expect(page.getByRole('heading', { name: RESULT_TITLE })).toBeVisible();

    // 세 금액: 이름·금액·보조 설명 (DOM 순서 = 눈에 보이는 순서)
    expect(await page.locator('[data-kiosk-amount]').evaluateAll((cards) => cards.map((card) => card.getAttribute('data-kiosk-amount')))).toEqual(['hospital', 'payout', 'after']);
    await expect(amountCard(page, 'hospital')).toContainText('예상 병원 결제액');
    await expect(amountValue(page, 'hospital')).toHaveText('124,000원');
    await expect(amountCard(page, 'hospital')).toContainText('오늘 병원 창구에서 결제하는 금액입니다.');
    await expect(amountCard(page, 'payout')).toContainText('예상 보험금');
    await expect(amountValue(page, 'payout')).toHaveText('114,000원');
    await expect(amountCard(page, 'after')).toContainText('보험금 수령 후 예상 본인 부담');
    await expect(amountValue(page, 'after')).toHaveText('10,000원');
    await expect(amountCard(page, 'after')).toContainText('보험금을 받은 뒤 남는 예상 부담액이며, 오늘 병원에 결제할 금액이 아닙니다.');

    const text = await screenText(page);
    expect(text).toContain('예시 계산');
    expect(text).toContain('표준 공제·한도 가정으로 계산한 예상 금액입니다. 실제 지급액은 가입 담보와 보험사 심사 결과에 따라 달라집니다. 자세한 계산 과정은 아래 ‘계산 근거 보기’에서 확인하세요.');
    expect(text).toContain('입력하신 세대·보험사 형태와 표준 가정을 기준으로 예상 금액을 안내합니다. 개인별 부담보, 면책·보장기간, 잔여 한도·횟수, 치료 목적 및 심사 결과에 따라 실제 지급액이 달라질 수 있습니다.');
    expect(text).toContain('2세대(C1) · 손해보험사');
    expect(text).not.toMatch(FORBIDDEN_TEXT);
    expect(standaloneZero(text)).toBe(false);
    await noLinks(page);

    // 여섯 동작 (AC-013e)
    expect(await actionsOf(page).allInnerTexts()).toEqual(['보험 청구에 필요한 서류 확인', '계산 근거 보기', '치료 다시 선택', '보험 조건 수정', '처음으로', '이용 완료']);

    // 방향별 보험 조건 표현: 세로는 표와 급여·비급여 내역, 가로는 한 줄 요약 (디자인 K04_Result / L_K04_Result)
    if (testInfo.project.name.endsWith('landscape')) {
      expect(text).toContain('2세대(C1) · 손해보험사 · 치료 4개');
      await expect(page.locator('.kiosk-conditions')).toHaveCount(0);
    } else {
      expect(text).toContain('급여 14,000원 + 비급여 110,000원');
      for (const name of FOUR_TREATMENTS) expect(text).toContain(name);
    }
  });

  test('미리보기 합계(선택 요약)가 결과의 병원 결제액과 같다 (AC-019c, 가로채기 층)', async ({ page }) => {
    const api = await openKiosk(page);
    await toFilledK03(page);
    expect(await summaryText(page)).toContain('124,000원');
    await submitEstimate(page, api, reply(200, estimatedResponse()));
    await expect(amountValue(page, 'hospital')).toHaveText('124,000원');
  });

  test('요청은 선택한 네 치료와 입력만 싣는다 (금액 필드·시도 식별자 없음)', async ({ page }) => {
    const api = await openKiosk(page);
    await toFilledK03(page);
    await submitEstimate(page, api, reply(200, estimatedResponse()));
    await expect(resultRoot(page)).toBeVisible();
    const [call] = api.callsTo('estimate');
    const body = JSON.parse(call?.postData ?? '{}') as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['catalogVersion', 'cause', 'generation', 'insurerType', 'ruleBundleVersion', 'treatmentIds']);
    expect((body.treatmentIds as string[]).slice().sort()).toEqual(Object.values(TREATMENT_ID).sort());
  });
});

test.describe('테스트 데이터 표시 (AC-010e)', () => {
  test('운영이 아닌 응답(TEST_FIXTURE·DEMO)에는 화면 맨 위에 표시가 있고 OPERATING 에는 없다 (세 결과 종류)', async ({ page }) => {
    const api = await openKiosk(page);
    await toFilledK03(page);
    for (const [origin, shown] of [['TEST_FIXTURE', true], ['DEMO', true], ['OPERATING', false]] as const) {
      await submitEstimate(page, api, reply(200, estimatedResponse({ origin })));
      await expect(resultRoot(page)).toBeVisible();
      if (shown) {
        await expect(testDataNotice(page)).toBeVisible();
        await expect(testDataNotice(page)).toHaveText('테스트 데이터로 계산한 예시입니다. 실제 보험금 안내에 사용할 수 없습니다.');
        // 화면 맨 위: 상단 머리글 바로 아래, 결과 막대보다 위
        const notice = await testDataNotice(page).boundingBox();
        const bar = await page.locator('.kiosk-result-bar').boundingBox();
        expect((notice?.y ?? 9999) + (notice?.height ?? 0)).toBeLessThanOrEqual((bar?.y ?? 0) + 1);
      } else {
        await expect(testDataNotice(page)).toHaveCount(0);
        expect(await screenText(page)).not.toContain('테스트 데이터');
      }
      // 다시 확인하려고 치료 다시 선택으로 돌아간다 (결과·선택 유지는 아래 동작 시험이 본다).
      await actionsOf(page).filter({ hasText: '치료 다시 선택' }).click();
      await expect(heading(page, TITLES.treatments)).toBeVisible();
    }
    for (const [response, kind] of [[notCoveredResponse({ origin: 'OPERATING' }), 'not-covered'], [holdResponse(undefined, { origin: 'OPERATING' }), 'hold']] as const) {
      await submitEstimate(page, api, reply(200, response));
      await expect(resultRoot(page)).toHaveAttribute('data-result', kind);
      await expect(testDataNotice(page)).toHaveCount(0);
      await actionsOf(page).filter({ hasText: '치료 다시 선택' }).click();
      await expect(heading(page, TITLES.treatments)).toBeVisible();
    }
    for (const response of [notCoveredResponse({ origin: 'DEMO' }), holdResponse(undefined, { origin: 'TEST_FIXTURE' })]) {
      await submitEstimate(page, api, reply(200, response));
      await expect(testDataNotice(page)).toBeVisible();
      await actionsOf(page).filter({ hasText: '치료 다시 선택' }).click();
      await expect(heading(page, TITLES.treatments)).toBeVisible();
    }
  });
});

test.describe('보장 제외 결과 K04_Result_NotCovered (AC-013b)', () => {
  test('124,000 / 74,000 / 50,000, 제외 항목·사유, 나머지 항목 기준의 가정 문장, 여섯 동작', async ({ page }) => {
    const api = await openKiosk(page);
    await toFilledK03(page);
    await submitEstimate(page, api, reply(200, notCoveredResponse({ reason: '약관에서 보장하지 않는 치료입니다' })));
    await expect(resultRoot(page)).toHaveAttribute('data-result', 'not-covered');
    await expect(amountValue(page, 'hospital')).toHaveText('124,000원');
    await expect(amountValue(page, 'payout')).toHaveText('74,000원');
    await expect(amountValue(page, 'after')).toHaveText('50,000원');
    const panel = page.locator('[data-kiosk-panel="exclusion"]');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('aria-label', '보장 제외 항목');
    await expect(panel).toContainText(TREATMENT.kidney);
    await expect(panel).toContainText('40,000원');
    await expect(panel).toContainText('약관에서 보장하지 않는 치료입니다');
    await expect(panel).toContainText('나머지 항목은 보장 대상이고 한도가 남아 있다고 가정합니다.');
    const text = await screenText(page);
    expect(text).not.toContain('모두 보장 대상');
    expect(text).not.toContain('디자인 예시');
    expect(text).toContain('예시 계산');
    expect(text).toContain('일부 항목 보장 제외');
    expect(text).toContain('표준 공제·한도 가정으로 계산한 예상 금액입니다.');
    expect(text).not.toMatch(FORBIDDEN_TEXT);
    expect(standaloneZero(text)).toBe(false);
    expect(await actionsOf(page).allInnerTexts()).toEqual(['보험 청구에 필요한 서류 확인', '계산 근거 보기', '치료 다시 선택', '보험 조건 수정', '처음으로', '이용 완료']);
  });
});

test.describe('보류 결과 K04_Result_Hold (AC-013c)', () => {
  test('병원 결제액만 숫자이고 나머지 둘은 "확인 필요", 분류 문구로 묶인 보류 줄, 네 동작뿐이다', async ({ page }) => {
    const api = await openKiosk(page);
    await reachResultScreen(page, api, 'K04_Result_Hold');
    await expect(amountValue(page, 'hospital')).toHaveText('124,000원');
    await expect(amountValue(page, 'payout')).toHaveText('확인 필요');
    await expect(amountValue(page, 'after')).toHaveText('확인 필요');
    await expect(amountCard(page, 'payout')).toHaveAttribute('data-known', 'false');
    const text = await screenText(page);
    // 네 분류 문구가 보류 줄을 묶는다.
    for (const phrase of ['표준 가정 자료가 아직 준비되지 않았습니다', '이 치료의 보장 분류를 검토하고 있습니다', '이 치료의 분류 확인이 필요합니다', '이 치료의 가격 자료 확인이 필요합니다']) expect(text).toContain(phrase);
    // 결과 문구 원칙은 없고 개인 계약 조건 문장만 있다.
    expect(text).not.toContain('표준 공제·한도 가정으로 계산한 예상 금액입니다');
    expect(text).not.toContain('예시 계산');
    expect(text).toContain('개인별 부담보, 면책·보장기간, 잔여 한도·횟수, 치료 목적 및 심사 결과에 따라 실제 지급액이 달라질 수 있습니다.');
    expect(text).toContain('보험금을 받은 뒤 남는 예상 부담액이며, 오늘 병원에 결제할 금액이 아닙니다.');
    // 내부 코드·참고 그룹 값(987,654)·"N" 이 없다.
    expect(text).not.toMatch(FORBIDDEN_TEXT);
    expect(text).not.toContain('987,654');
    expect(standaloneZero(text)).toBe(false);
    await noLinks(page);
    // 동작은 정확히 넷이고 서류·근거가 없다.
    expect(await actionsOf(page).allInnerTexts()).toEqual(['치료 다시 선택', '보험 조건 수정', '처음으로', '이용 완료']);
    await expect(page.getByRole('button', { name: '보험 청구에 필요한 서류 확인' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '계산 근거 보기' })).toHaveCount(0);
  });

  test('모르는 새 보류 코드는 첫 분류 문구로 보이고 코드는 화면에 없다', async ({ page }) => {
    const api = await openKiosk(page);
    await toFilledK03(page);
    await submitEstimate(page, api, reply(200, holdResponse([[TREATMENT_ID.xray, 'BRAND_NEW_CODE' as never]])));
    await expect(resultRoot(page)).toHaveAttribute('data-result', 'hold');
    const text = await screenText(page);
    expect(text).toContain('표준 가정 자료가 아직 준비되지 않았습니다');
    expect(text).not.toContain('BRAND_NEW_CODE');
  });
});

test.describe('결과 화면의 동작 (AC-013e·AC-014e·g·h·i 의 결과 쪽, AC-015f·g·j)', () => {
  test('"치료 다시 선택": 선택·합계가 그대로인 4단계이고 새 계산 요청이 없다', async ({ page }) => {
    const api = await openKiosk(page);
    await toFilledK03(page);
    const before = await summaryText(page);
    await submitEstimate(page, api, reply(200, estimatedResponse()));
    await expect(resultRoot(page)).toBeVisible();
    await actionsOf(page).filter({ hasText: '치료 다시 선택' }).click();
    await expect(heading(page, TITLES.treatments)).toBeVisible();
    expect(await summaryText(page)).toBe(before);
    expect(api.callsTo('estimate')).toHaveLength(1);
    // 선택은 유지되어 있다: 첫 쪽의 넷이 모두 선택된 상태가 아니라 선택한 네 치료가 요약에 있다.
    expect(await summaryText(page)).toContain('4개');
  });

  test('치료 원인만 바꾸고 다시 확인하면 금액 블록은 바이트까지 같다 (AC-014c 의 결과 쪽: 요청은 원인만 다르다. 서류 목록의 새 산출은 sheets.intercept.spec.ts)', async ({ page }) => {
    const api = await openKiosk(page);
    await toFilledK03(page);
    await submitEstimate(page, api, reply(200, estimatedResponse()));
    await expect(resultRoot(page)).toHaveAttribute('data-result', 'normal');
    const amountsBefore = await page.locator('.kiosk-amounts').innerHTML();
    await actionsOf(page).filter({ hasText: '보험 조건 수정' }).click();
    await expect(heading(page, TITLES.generation)).toBeVisible();
    await bottomButton(page, '다음').click();
    await bottomButton(page, '다음').click();
    await expect(heading(page, TITLES.cause)).toBeVisible();
    await page.getByRole('radio', { name: '아파서 왔어요 (질병)' }).check();
    await bottomButton(page, '다음').click();
    await expect(heading(page, TITLES.treatments)).toBeVisible();
    await submitEstimate(page, api, reply(200, estimatedResponse()));
    await expect(resultRoot(page)).toHaveAttribute('data-result', 'normal');
    expect(await page.locator('.kiosk-amounts').innerHTML()).toBe(amountsBefore);
    const [first, second] = api.callsTo('estimate').map((call) => JSON.parse(call.postData ?? '{}') as Record<string, unknown>);
    expect(first?.cause).toBe('INJURY');
    expect(second?.cause).toBe('ILLNESS');
    expect({ ...second, cause: 'INJURY' }).toEqual(first);
  });

  test('"보험 조건 수정": 선택이 유지된 1단계이고 새 계산 요청이 없다', async ({ page }) => {
    const api = await openKiosk(page);
    await toFilledK03(page);
    await submitEstimate(page, api, reply(200, estimatedResponse()));
    await actionsOf(page).filter({ hasText: '보험 조건 수정' }).click();
    await expect(heading(page, TITLES.generation)).toBeVisible();
    await expect(page.getByRole('radio', { name: '2세대(C1)' })).toBeChecked();
    expect(api.callsTo('estimate')).toHaveLength(1);
  });

  test('"보험 청구에 필요한 서류 확인": 원인이 상해·질병이면 K07_Documents, 모름이면 K07_Documents_Unknown 으로 가고(보장 제외 결과도 같다), 새 요청이 없다', async ({ page }) => {
    const api = await openKiosk(page);
    await toFilledK03(page);
    await submitEstimate(page, api, reply(200, notCoveredResponse()));
    await actionsOf(page).filter({ hasText: '보험 청구에 필요한 서류 확인' }).click();
    await expect(page.locator('[data-sheet="documents"]')).toBeVisible();
    await expect(page.locator('[data-kiosk-primary]')).toBeFocused();
    expect(api.callsTo('estimate')).toHaveLength(1);
  });

  test('원인 모름: "서류 확인"은 K07_Documents_Unknown 이다', async ({ page }) => {
    const api = await openKiosk(page);
    await toK03(page, '잘 모르겠어요');
    for (const name of FOUR_TREATMENTS) await selectTreatment(page, name);
    await submitEstimate(page, api, reply(200, estimatedResponse()));
    await expect(resultRoot(page)).toBeVisible();
    await actionsOf(page).filter({ hasText: '보험 청구에 필요한 서류 확인' }).click();
    await expect(page.locator('[data-sheet="documents-unknown"]')).toBeVisible();
  });

  test('"계산 근거 보기": 근거 화면으로 가고 새 요청이 없다', async ({ page }) => {
    const api = await openKiosk(page);
    await toFilledK03(page);
    await submitEstimate(page, api, reply(200, estimatedResponse()));
    await actionsOf(page).filter({ hasText: '계산 근거 보기' }).click();
    await expect(page.locator('[data-sheet="basis"]')).toBeVisible();
    expect(api.callsTo('estimate')).toHaveLength(1);
  });

  test('보류 결과의 "치료 다시 선택"·"보험 조건 수정"도 같다 (선택 유지, 요청 없음)', async ({ page }) => {
    const api = await openKiosk(page);
    await toFilledK03(page);
    await submitEstimate(page, api, reply(200, holdResponse()));
    await actionsOf(page).filter({ hasText: '치료 다시 선택' }).click();
    await expect(heading(page, TITLES.treatments)).toBeVisible();
    expect(await summaryText(page)).toContain('4개');
    await submitEstimate(page, api, reply(200, holdResponse()));
    await actionsOf(page).filter({ hasText: '보험 조건 수정' }).click();
    await expect(heading(page, TITLES.generation)).toBeVisible();
    await expect(page.getByRole('radio', { name: '2세대(C1)' })).toBeChecked();
  });

  test('"처음으로"(입력 있음): 확인창, 계속 이용하면 결과가 그대로이고 처음으로를 확인하면 이용 완료 화면 없이 시작 화면이다', async ({ page }) => {
    const api = await openKiosk(page);
    await toFilledK03(page);
    await submitEstimate(page, api, reply(200, estimatedResponse()));
    await actionsOf(page).filter({ hasText: '처음으로' }).click();
    await expect(dialog(page)).toContainText('선택 내용을 지우고 처음으로 돌아갈까요?');
    await dialog(page).getByRole('button', { name: '계속 이용' }).click();
    await expect(resultRoot(page)).toBeVisible();
    await expect(amountValue(page, 'hospital')).toHaveText('124,000원');
    // 초점은 눌렀던 "처음으로" 버튼으로 돌아온다.
    await expect(actionsOf(page).filter({ hasText: '처음으로' })).toBeFocused();
    await actionsOf(page).filter({ hasText: '처음으로' }).click();
    await dialog(page).getByRole('button', { name: '처음으로' }).click();
    await expectStartScreen(page);
    await expect(page.getByText('이용해 주셔서 감사합니다')).toHaveCount(0);
  });

  test('"이용 완료": 먼저 전체 삭제한 뒤 이용 완료 화면으로 간다 (결과·금액이 화면에 남지 않는다)', async ({ page }) => {
    const api = await openKiosk(page);
    await toFilledK03(page);
    await submitEstimate(page, api, reply(200, estimatedResponse()));
    await actionsOf(page).filter({ hasText: '이용 완료' }).click();
    await expect(page.locator('[data-kiosk-state="COMPLETE"]')).toBeVisible();
    const text = await page.locator('.kiosk-root').innerText();
    expect(text).not.toMatch(/124,000|114,000|10,000원/);
  });

  test('큰 글자 보기·화면 방향을 바꿔도 같은 결과(금액·동작)이고 새 요청이 없다 (AC-013e, AC-014h·i 의 결과 쪽)', async ({ page }) => {
    const api = await openKiosk(page);
    await toFilledK03(page);
    await submitEstimate(page, api, reply(200, notCoveredResponse()));
    await expect(resultRoot(page)).toHaveAttribute('data-result', 'not-covered');
    const read = async (): Promise<string[]> => [await amountValue(page, 'hospital').innerText(), await amountValue(page, 'payout').innerText(), await amountValue(page, 'after').innerText(), (await actionsOf(page).allInnerTexts()).join('|')];
    const base = await read();
    await setLargeText(page, true);
    expect(await read()).toEqual(base);
    await swapOrientation(page);
    expect(await read()).toEqual(base);
    await setLargeText(page, false);
    await swapOrientation(page);
    expect(await read()).toEqual(base);
    expect(api.callsTo('estimate')).toHaveLength(1);
    await expect(resultRoot(page)).toHaveAttribute('data-result', 'not-covered');
  });
});

test.describe('한 화면에 들어간다 (운영 자료·일반 글자·짧은 이름, DD-12)', () => {
  for (const [name, make, kind] of [
    ['정상', () => estimatedResponse({ origin: 'OPERATING' }), 'normal'],
    ['보장 제외', () => notCoveredResponse({ origin: 'OPERATING' }), 'not-covered'],
    ['보류(한 분류)', () => holdResponse(undefined, { origin: 'OPERATING' }), 'hold'],
  ] as const) {
    test(`${name}: 본문이 스크롤 없이 한 화면에 들어가고 동작 막대와 겹치지 않는다`, async ({ page }) => {
      const api = await openKiosk(page, { catalog: shortNamedCatalog() });
      await toK03(page);
      await pickFirstFour(page);
      await submitEstimate(page, api, reply(200, renamed(make(), SHORT_NAMES)));
      await expect(resultRoot(page)).toHaveAttribute('data-result', kind);
      const fit = await bodyFits(page);
      expect(fit, `본문 ${fit.scrollHeight} > 보이는 높이 ${fit.clientHeight}`).toMatchObject({ fits: true });
      await expectLayoutClean(page, `${name} 운영 자료`);
    });
  }
});

test.describe('통신 오류 KXX_Error_Network (AC-013d)', () => {
  test('5xx: 오류 화면(코드·금액 없음)과 "다시 시도"·"이용 종료", "다시 시도"는 같은 입력으로 새 요청을 보내 결과를 얻는다', async ({ page }) => {
    const api = await openKiosk(page);
    await toFilledK03(page);
    await submitEstimate(page, api, reply(500, { error: 'INTERNAL_ERROR' }));
    await expect(networkError(page)).toBeVisible();
    await expect(page.locator('[data-kiosk-primary]')).toBeFocused();
    const text = await screenText(page);
    expect(text).toContain('계산하지 못했어요');
    expect(text).toContain('통신 오류');
    expect(text).toContain('통신 오류로 보험 계산 정보를 불러오지 못했습니다.');
    expect(text).toContain('계속 안 되면 접수 직원에게 문의해 주세요.');
    expect(text).not.toMatch(FORBIDDEN_TEXT);
    expect(text).not.toMatch(/\d[\d,]*원(?!이라는)/);
    await noLinks(page);
    expect((await page.locator('.kiosk-bottom-actions').getByRole('button').allInnerTexts()).slice().sort()).toEqual(['다시 시도', '이용 종료']);
    await expect(page.getByRole('button', { name: /접수 직원/ })).toHaveCount(0);

    await submitRetry(page, api);
    await expect(resultRoot(page)).toHaveAttribute('data-result', 'normal');
    const [first, second] = api.callsTo('estimate');
    expect(second?.postData).toBe(first?.postData);
    expect(api.callsTo('estimate')).toHaveLength(2);
  });

  async function submitRetry(page: Page, api: ApiMock): Promise<void> {
    api.queue('estimate', reply(200, estimatedResponse()));
    await page.locator('.kiosk-bottom-actions').getByRole('button', { name: '다시 시도' }).click();
  }

  for (const [name, behavior] of [
    ['404 CLINIC_NOT_FOUND', reply(404, { error: 'CLINIC_NOT_FOUND' })],
    ['400 INVALID_REQUEST', reply(400, { error: 'INVALID_REQUEST' })],
    ['422 UNSUPPORTED_GENERATION', reply(422, { error: 'UNSUPPORTED_GENERATION' })],
    ['502 (본문 없음)', replyRaw(502, 'Bad Gateway')],
    ['연결 실패', ABORT],
    ['200 인데 JSON 이 아님', replyRaw(200, '<html>not json</html>')],
    ['200 인데 결과가 비어 있음', reply(200, {})],
    ['200 인데 금액이 음수', reply(200, withAmounts(estimatedResponse(), { hospitalPayment: -1, expectedInsurancePayout: 1, expectedOutOfPocketAfterPayout: 1 }))],
    ['200 인데 정상 결과의 보험금이 null', reply(200, withAmounts(estimatedResponse(), { hospitalPayment: 124_000, expectedInsurancePayout: null, expectedOutOfPocketAfterPayout: null }))],
    ['200 인데 보류 결과의 보험금이 숫자', reply(200, withAmounts(holdResponse(), { hospitalPayment: 124_000, expectedInsurancePayout: 1, expectedOutOfPocketAfterPayout: 2 }))],
  ] as const) {
    test(`${name}: 결과를 만들지 않고 오류 화면이다 (0원·빈 결과 없음)`, async ({ page }) => {
      const api = await openKiosk(page);
      await toFilledK03(page);
      await submitEstimate(page, api, behavior);
      await expect(networkError(page)).toBeVisible();
      await expect(resultRoot(page)).toHaveCount(0);
      expect(await screenText(page)).not.toMatch(/\d[\d,]*원(?!이라는)/);
    });
  }

  test('요청 제한(15초) 안에 응답이 없으면 오류 화면이 되고, 그 뒤 도착한 응답은 반영되지 않는다', async ({ page }) => {
    await installClock(page);
    const api = await openKiosk(page);
    const held = await openCalculating(page, api);
    await page.clock.runFor(14_000);
    await expect(calculating(page)).toBeVisible();
    await page.clock.runFor(1_500);
    await expect(networkError(page)).toBeVisible();
    held.release(reply(200, estimatedResponse()));
    await page.clock.runFor(500);
    await expect(networkError(page)).toBeVisible();
    await expect(resultRoot(page)).toHaveCount(0);
  });

  test('"이용 종료": 먼저 전체 삭제한 뒤 이용 완료 화면으로 간다 (선택이 남지 않는다)', async ({ page }) => {
    const api = await openKiosk(page);
    await toFilledK03(page);
    await submitEstimate(page, api, reply(500, { error: 'INTERNAL_ERROR' }));
    await page.locator('.kiosk-bottom-actions').getByRole('button', { name: '이용 종료' }).click();
    await expect(page.locator('[data-kiosk-state="COMPLETE"]')).toBeVisible();
  });

  test('422 NO_TREATMENT_SELECTED: 오류 화면이 아니라 4단계로 돌아간다 (결과 없음)', async ({ page }) => {
    const api = await openKiosk(page);
    await toFilledK03(page);
    await submitEstimate(page, api, reply(422, { error: 'NO_TREATMENT_SELECTED' }));
    await expect(heading(page, TITLES.treatments)).toBeVisible();
    await expect(resultRoot(page)).toHaveCount(0);
    await expect(networkError(page)).toHaveCount(0);
  });

  test('큰 글자 보기·방향 전환 중에도 오류 화면에 머물고 새 요청이 없다', async ({ page }) => {
    const api = await openKiosk(page);
    await toFilledK03(page);
    await submitEstimate(page, api, reply(500, { error: 'INTERNAL_ERROR' }));
    await expect(networkError(page)).toBeVisible();
    await setLargeText(page, true);
    await swapOrientation(page);
    await expect(networkError(page)).toBeVisible();
    expect(api.callsTo('estimate')).toHaveLength(1);
  });
});

test.describe('응답 전에 처음으로 → 다음 환자 → 늦은 응답 (AC-016c)', () => {
  test('초기화 확정·다음 환자 시작 뒤 도착한 늦은 결과는 새 세션 화면을 바꾸지 못한다', async ({ page }) => {
    await installClock(page);
    const api = await openKiosk(page);
    const held = await openCalculating(page, api);
    await page.locator('.kiosk-bottom-actions').getByRole('button', { name: '처음으로' }).click();
    await dialog(page).getByRole('button', { name: '처음으로' }).click();
    await expectStartScreen(page);
    await startButton(page).click();
    await expect(heading(page, TITLES.generation)).toBeVisible();
    held.release(reply(200, estimatedResponse()));
    await page.clock.runFor(500);
    await expect(heading(page, TITLES.generation)).toBeVisible();
    await expect(resultRoot(page)).toHaveCount(0);
    expect(await page.locator('.kiosk-root').innerText()).not.toContain('124,000');
    // 새 세션의 선택은 비어 있다.
    expect(await page.getByRole('radio').evaluateAll((inputs) => inputs.some((input) => (input as HTMLInputElement).checked))).toBe(false);
  });
});

test.describe('결과 화면의 포커스와 키보드', () => {
  test('결과 화면은 키보드만으로 모든 동작에 닿는다 (Tab 순서 = 화면 순서)', async ({ page }) => {
    const api = await openKiosk(page);
    await toFilledK03(page);
    await submitEstimate(page, api, reply(200, estimatedResponse()));
    await expect(resultRoot(page)).toBeVisible();
    const names = ['보험 청구에 필요한 서류 확인', '계산 근거 보기', '치료 다시 선택', '보험 조건 수정', '처음으로', '이용 완료'];
    const visited: string[] = [];
    for (let guard = 0; guard < 20 && visited.length < names.length; guard += 1) {
      await page.keyboard.press('Tab');
      const label = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText.trim() ?? '');
      if (names.includes(label) && !visited.includes(label)) visited.push(label);
    }
    expect(visited).toEqual(names);
  });

  test('초점이 있는 동작은 굵은 윤곽선이 잘리지 않고 보인다', async ({ page }) => {
    const api = await openKiosk(page);
    await toFilledK03(page);
    await submitEstimate(page, api, reply(200, estimatedResponse()));
    // :focus-visible 은 키보드 초점에만 그려진다: Tab 으로 각 동작에 닿아 윤곽선을 잰다(굵기·화면 안·조상에 잘리지 않음).
    for (const name of ['보험 청구에 필요한 서류 확인', '계산 근거 보기', '처음으로', '이용 완료']) {
      await tabTo(page, actionsOf(page).filter({ hasText: name }));
      expect(await focusRingProblems(page), name).toEqual([]);
    }
  });

  test('시작 주소로 다시 들어가면 결과가 없다 (새로고침은 빈 세션)', async ({ page }) => {
    const api = await openKiosk(page);
    await toFilledK03(page);
    await submitEstimate(page, api, reply(200, estimatedResponse()));
    await expect(resultRoot(page)).toBeVisible();
    await page.reload();
    await expectStartScreen(page);
    expect(page.url()).toContain(KIOSK_PATH);
    await expect(resultRoot(page)).toHaveCount(0);
  });
});

test.describe('글꼴: 결과 화면도 Pretendard 로 그린다 (DD-12, 기획서 §13.1)', () => {
  test('금액·제목·안내·동작의 글자를 그린 글꼴이 웹 글꼴 Pretendard 이다 (CDP 로 읽은 실제 글꼴)', async ({ page }) => {
    const api = await openKiosk(page);
    await toFilledK03(page);
    await submitEstimate(page, api, reply(200, estimatedResponse()));
    await expect(resultRoot(page)).toBeVisible();
    for (const selector of ['.kiosk-result__title', '.kiosk-amount__value', '.kiosk-notice__text p', '.kiosk-result-actions__button--documents']) {
      const fonts = await platformFonts(page, selector);
      expect(fonts.length, selector).toBeGreaterThan(0);
      expect(
        fonts.every((font) => font.familyName.startsWith('Pretendard') && font.isCustomFont),
        `${selector}: ${JSON.stringify(fonts)}`,
      ).toBe(true);
    }
    expect(await page.locator('.kiosk-root').evaluate((element) => getComputedStyle(element).fontFamily)).toBe('Pretendard, "Noto Sans KR", "Malgun Gothic", sans-serif');
  });
});

test.describe('아주 큰 금액은 카드 안에 들어간다', () => {
  test('1,234,567,890원: 글자가 줄어 카드 안에 있고 넘치지 않는다', async ({ page }) => {
    const api = await openKiosk(page);
    await toFilledK03(page);
    await submitEstimate(page, api, reply(200, withAmounts(estimatedResponse(), { hospitalPayment: 1_234_567_890, expectedInsurancePayout: 1_034_567_890, expectedOutOfPocketAfterPayout: 200_000_000 })));
    await expect(amountValue(page, 'hospital')).toHaveText('1,234,567,890원');
    for (const tone of ['hospital', 'payout', 'after'] as const) {
      const fits = await amountValue(page, tone).evaluate((element) => element.scrollWidth <= element.clientWidth + 1);
      expect(fits, tone).toBe(true);
    }
    await expectLayoutClean(page, '긴 금액');
  });
});

test.describe('영속 저장소·주소·문서·요청 (AC-016a·AC-016b·AC-016m 의 결과 쪽)', () => {
  test('계산 오류 → 다시 시도 → 결과 → 보류 결과 → 처음으로까지 진행해도 저장소 덤프가 같고 표지 식별자가 저장소·주소·문서·요청 어디에도 없다', async ({ page }) => {
    await installMarkerIds(page);
    const api = await openKiosk(page);
    const before = await dumpStorage(page);

    await toFilledK03(page);
    await submitEstimate(page, api, reply(500, { error: 'INTERNAL_ERROR' }));
    await expect(networkError(page)).toBeVisible();
    api.queue('estimate', reply(200, estimatedResponse()));
    await page.locator('.kiosk-bottom-actions').getByRole('button', { name: '다시 시도' }).click();
    await expect(resultRoot(page)).toHaveAttribute('data-result', 'normal');
    await actionsOf(page).filter({ hasText: '치료 다시 선택' }).click();
    await submitEstimate(page, api, reply(200, holdResponse()));
    await expect(resultRoot(page)).toHaveAttribute('data-result', 'hold');
    await actionsOf(page).filter({ hasText: '처음으로' }).click();
    await dialog(page).getByRole('button', { name: '처음으로' }).click();
    await expectStartScreen(page);

    const after = await dumpStorage(page);
    expect(after).toEqual(before);
    expect(after.localStorage).toEqual({});
    expect(after.sessionStorage).toEqual({});
    expect(after.indexedDb).toEqual({});
    expect(after.cacheStorage).toEqual({});
    expect(after.serviceWorkers).toEqual([]);
    expect(after.cookie).toBe('');
    expect(JSON.stringify(after)).not.toContain(MARKER_PREFIX);
    expect(page.url()).not.toContain(MARKER_PREFIX);
    const url = new URL(page.url());
    expect(url.pathname + url.search + url.hash).toBe(KIOSK_PATH);
    expect(await page.evaluate(() => document.documentElement.outerHTML)).not.toContain(MARKER_PREFIX);
    // 요청(주소·헤더·본문)에 표지 식별자가 없다. 대조군: 발급기는 세션·계산 시도마다 실제로 쓰였다(그 뒤의 다음 값이 충분히 크다).
    expect(api.calls.length).toBeGreaterThanOrEqual(5);
    for (const call of api.calls) expect(call.url + JSON.stringify(call.headers) + (call.postData ?? '')).not.toContain(MARKER_PREFIX);
    const next = await page.evaluate(() => crypto.randomUUID());
    expect(Number(next.slice(-4))).toBeGreaterThan(6);
  });

  test('실제 발급기로도 결과까지 진행한 뒤 저장소 덤프에 UUID 형식 문자열이 새로 생기지 않고, 요청·주소에도 없다', async ({ page }) => {
    const api = await openKiosk(page);
    const before = await dumpStorage(page);
    await toFilledK03(page);
    await submitEstimate(page, api, reply(200, estimatedResponse()));
    await expect(resultRoot(page)).toBeVisible();
    const after = await dumpStorage(page);
    expect(after).toEqual(before);
    expect(findUuids(JSON.stringify(after))).toEqual([]);
    expect(findUuids(page.url())).toEqual([]);
    expect(findUuids(await page.evaluate(() => document.documentElement.outerHTML))).toEqual([]);
    for (const call of api.calls) expect(findUuids(call.url + JSON.stringify(call.headers) + (call.postData ?? ''))).toEqual([]);
  });

  test('결과 화면의 DOM 에는 계산 시도·세션 식별자를 담은 속성이 없다 (표지 값·requestId 이름 모두)', async ({ page }) => {
    await installMarkerIds(page);
    const api = await openKiosk(page);
    await toFilledK03(page);
    await submitEstimate(page, api, reply(200, estimatedResponse()));
    await expect(resultRoot(page)).toBeVisible();
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    expect(html).not.toMatch(/ID-TEST|requestId|refreshId|sessionId|data-request|data-session/);
  });
});
