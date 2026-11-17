import { expect, test } from '../helpers/test';
import type { Page } from '@playwright/test';
import { reply } from '../helpers/api';
import { installClock } from '../helpers/clock';
import { platformFonts } from '../helpers/fonts';
import { MARKER_PREFIX, installMarkerIds } from '../helpers/ids';
import { dumpStorage } from '../helpers/storage';
import { KIOSK_PATH, dialog, expectStartScreen, startButton } from '../helpers/kiosk';
import { TITLES, expectLayoutClean, heading, openKiosk, setLargeText, summaryText, swapOrientation, tabTo } from '../helpers/input';
import { actionsOf, amountValue, idlePolicyWith, resetDialog, resultRoot, screenText, submitEstimate, timeoutDialog, toFilledK03, under } from '../helpers/results';
import {
  BASIS_TITLE,
  COMPLETE_TITLE,
  DOCS_TITLE,
  basisSheet,
  completeScreen,
  docLine,
  docLines,
  docsPagerNext,
  docsPagerPrevious,
  docsPagerStatus,
  docsSheet,
  normalWith,
  notCoveredWith,
  openBasis,
  openDocuments,
  reachResult,
  reachSheetScreen,
  requiredDocLines,
  sheet,
  sheetBack,
  sheetComplete,
  sheetFooter,
  sheetHome,
  singleCauseDocuments,
  unknownCauseDocuments,
  visibleDocKeys,
  visibleDocs,
  wideUnknownDocuments,
} from '../helpers/sheets';
import type { Cause } from '../helpers/sheets';
import { makeCatalog } from '../../fixtures/kiosk/clinic.fixture';
import { estimatedResponse, holdResponse, notCoveredResponse } from '../../fixtures/kiosk/estimate-response.fixture';
import { DOCUMENT_LINE_KEYS } from '../../../src/engine/types';

// 가로채기 층 (SPEC-REIMBURSEMENT-001 M6 S3b, BRIEF D12): 계산 근거 · 필요 서류 · 이용 완료 화면을 실제 Chrome 에서 본다. 응답은 시험이 정한다(가로채기). 운영 자료도 실제 핸들러도 아니다.
// AC 대응: AC-014f(근거 내용) · AC-013f(근거 화면 금지 표현) · AC-014e(결과로 돌아가기: 들어온 결과 종류, 복귀 시점의 최신 방향·큰 글자) · AC-014g(서류 분기) · AC-014h·i(큰 글자·방향 전환과 복귀, 요청 없음)
//          · AC-014c(원인을 바꾸면 서류만 새로 산출) · AC-007g(서류 규칙 없음) · AC-007i(쪽 나눔: 줄이 빠지거나 반복되지 않고 체크·사유 유지) · AC-007h(원인 모름의 전용 줄 여럿)
//          · AC-015f(이용 완료 화면: 비운 뒤, 자동 복귀 = completionHoldSeconds, null 이면 수동만) · AC-010e(근거·서류의 테스트 데이터 표시) · AC-015b·g·j·k(근거·서류 위의 겹침창) · AC-016a·m(영속 저장소·식별자).
// 응답의 서류·근거 값이 화면에 그대로 나오는지를 본다. 값은 시험 자료(TEST_FIXTURE)다.

const FORBIDDEN_TEXT = /환자분의 실손은|오늘 [^ ]* ?만 내면 됩니다|PROFILE_|MAPPING_|LINE_|CLASSIFICATION_|CALC_RANGE|RULE_BUNDLE|CLINIC_RULE|VERSION_MISMATCH|INTERNAL_ERROR|1588|1544|tel:|디자인 예시|undefined|NaN|null/;
const standaloneZero = (text: string): boolean => /(?<![\d,])0원/.test(text);
const isLandscape = (name: string): boolean => name.endsWith('landscape');

async function noLinks(page: Page): Promise<void> {
  await expect(page.locator('.kiosk-root a, .kiosk-root [href]')).toHaveCount(0);
}

const NINE = [...DOCUMENT_LINE_KEYS];

// ───────────────────────────── 계산 근거 ─────────────────────────────

test.describe('계산 근거 K04_Basis_Calculation (AC-014f, AC-013f, AC-010e)', () => {
  test('정상 결과: 입력 확인·치료 표·"(가정)" 공제·한도·약관 출처·가정·확인하지 않은 전제가 응답의 값으로 보이고 금지 표현이 없다', async ({ page }, testInfo) => {
    const api = await openKiosk(page);
    await reachResult(page, api, estimatedResponse());
    await openBasis(page);
    await expect(page.locator('[data-kiosk-primary]')).toBeFocused();
    await expect(heading(page, BASIS_TITLE)).toBeVisible();
    const text = await screenText(page);
    expect(text).toContain('계산 근거');
    expect(text).toContain('예시 계산');
    expect(text).toContain('테스트 데이터로 계산한 예시입니다. 실제 보험금 안내에 사용할 수 없습니다.'); // 시험 자료의 출처 표시 (AC-010e)

    // 입력으로 확인한 것: 보험 조건·치료 원인(세로는 표, 가로는 한 줄)과 치료 표
    if (isLandscape(testInfo.project.name)) expect(text).toContain('2세대(C1) · 손해보험사 · 상해 · 치료 4개');
    else {
      expect(text).toContain('보험 조건');
      expect(text).toContain('2세대(C1) · 손해보험사');
      expect(text).toContain('치료 원인 상해');
    }
    const rows = page.locator('[data-basis-table="treatments"] tbody tr');
    await expect(rows).toHaveCount(4);
    expect((await rows.allInnerTexts()).map((row) => row.replace(/\s+/g, ' ').trim())).toEqual([
      'TEST_FIXTURE X-ray 급여 10,000원 보장 대상',
      'TEST_FIXTURE 초음파 급여 4,000원 보장 대상',
      'TEST_FIXTURE 신장분사치료 비급여 40,000원 보장 대상',
      'TEST_FIXTURE 물리치료 비급여 70,000원 보장 대상',
    ]);
    await expect(page.locator('[data-basis-table="treatments"] tfoot')).toContainText('예상 병원 결제액 합계');
    await expect(page.locator('[data-basis-table="treatments"] tfoot')).toContainText('124,000원');

    // 가정으로 적용한 것·계산 과정: "(가정)" 이 붙은 공제·한도와 응답의 예상 보험금
    const steps = page.locator('[data-basis-table="steps"]');
    await expect(steps).toContainText('보장 대상 치료비 합계');
    await expect(steps).toContainText('124,000원');
    await expect(steps).toContainText('공제(가정)');
    await expect(steps).toContainText('- 10,000원');
    await expect(steps).toContainText('지급한도(가정)');
    await expect(steps).toContainText('250,000원');
    await expect(steps.locator('tfoot')).toContainText('예상 보험금');
    await expect(steps.locator('tfoot')).toContainText('114,000원');

    // 약관 출처(문서·개정일·조항)는 글자뿐이다. 확인자·확인일·효력일은 없다.
    await expect(page.locator('[data-kiosk-panel="sources"]')).toContainText('TEST_FIXTURE 약관 문서 A · 2026.01.01 개정 · 제12조 (보상하는 의료비)');
    expect(text).not.toMatch(/TEST_FIXTURE_VERIFIER|2026-01-02/);

    // 가정과 확인하지 않은 전제
    await expect(page.locator('[data-kiosk-panel="assumptions"]')).toContainText('환자에게 묻지 않고 2세대(C1) · 손해보험사 표준 가정값을 적용했습니다.');
    await expect(page.locator('[data-kiosk-panel="assumptions"]')).toContainText('선택한 치료가 모두 보장 대상이고 한도가 남아 있다고 가정했습니다.');
    await expect(page.locator('[data-kiosk-panel="assumptions"]')).toContainText('개인별 공제·한도·특약·잔여 한도·면책 기간·부담보는 묻거나 조회하지 않았습니다.');
    expect(text).toContain('입력하신 세대·보험사 형태와 표준 가정을 기준으로 예상 금액을 안내합니다.');

    // 금지 표현·디자인 예시 문장·링크 없음
    expect(text).not.toMatch(FORBIDDEN_TEXT);
    expect(standaloneZero(text)).toBe(false);
    await noLinks(page);
    await expect(page.locator('[data-kiosk-panel="exclusion"]')).toHaveCount(0);

    // 하단 동작
    expect(await sheetFooter(page).allInnerTexts()).toEqual(['처음으로', '결과로 돌아가기', '이용 완료']);
    expect(api.callsTo('estimate')).toHaveLength(1);
  });

  test('보장 제외 결과: 제외 항목은 "보장 제외"이고 사유와 나머지 항목 기준의 가정이 함께 보이며, 보장 대상 치료비 합계에서 빠진다', async ({ page }) => {
    const api = await openKiosk(page);
    await reachResult(page, api, notCoveredResponse({ reason: '약관에서 보장하지 않는 치료입니다' }));
    await openBasis(page);
    const rows = page.locator('[data-basis-table="treatments"] tbody tr');
    expect((await rows.allInnerTexts()).map((row) => row.replace(/\s+/g, ' ').trim())).toEqual([
      'TEST_FIXTURE X-ray 급여 10,000원 보장 대상',
      'TEST_FIXTURE 초음파 급여 4,000원 보장 대상',
      'TEST_FIXTURE 신장분사치료 비급여 40,000원 보장 제외',
      'TEST_FIXTURE 물리치료 비급여 70,000원 보장 대상',
    ]);
    const panel = page.locator('[data-kiosk-panel="exclusion"]');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('TEST_FIXTURE 신장분사치료');
    await expect(panel).toContainText('40,000원');
    await expect(panel).toContainText('약관에서 보장하지 않는 치료입니다');
    await expect(page.locator('[data-kiosk-panel="assumptions"]')).toContainText('나머지 항목은 보장 대상이고 한도가 남아 있다고 가정합니다.');
    const steps = page.locator('[data-basis-table="steps"]');
    await expect(steps).toContainText('84,000원');
    await expect(steps.locator('tfoot')).toContainText('74,000원');
    const text = await screenText(page);
    expect(text).not.toContain('선택한 치료가 모두 보장 대상');
    expect(text).not.toMatch(FORBIDDEN_TEXT);
    expect(standaloneZero(text)).toBe(false);
  });

  test('테스트 데이터 표시: 운영 자료로 계산한 결과의 근거에는 표시가 없다 (AC-010e)', async ({ page }) => {
    const api = await openKiosk(page);
    await reachResult(page, api, estimatedResponse({ origin: 'OPERATING' }));
    await openBasis(page);
    await expect(page.locator('[data-kiosk-test-data]')).toHaveCount(0);
    expect(await screenText(page)).not.toContain('테스트 데이터');
  });

  test('단계 기록·출처가 응답에 없으면 공제·한도 표와 출처 패널을 그리지 않고 없는 값을 지어내지 않는다', async ({ page }) => {
    const api = await openKiosk(page);
    await reachResult(page, api, estimatedResponse({ basis: { ruleBundleId: null, profile: null, steps: [] } }));
    await openBasis(page);
    await expect(page.locator('[data-basis-table="treatments"]')).toBeVisible();
    await expect(page.locator('[data-basis-table="steps"]')).toHaveCount(0);
    await expect(page.locator('[data-kiosk-panel="sources"]')).toHaveCount(0);
    expect(await screenText(page)).not.toMatch(FORBIDDEN_TEXT);
  });

  test('글자·글꼴: 제목·표·패널의 글자를 그린 글꼴이 웹 글꼴 Pretendard 이다', async ({ page }) => {
    const api = await openKiosk(page);
    await reachResult(page, api, estimatedResponse());
    await openBasis(page);
    for (const selector of ['.kiosk-sheet__title', '.kiosk-table td', '.kiosk-panel__note', '.kiosk-source__item']) {
      const fonts = await platformFonts(page, selector);
      expect(fonts.length, selector).toBeGreaterThan(0);
      expect(fonts.every((font) => font.familyName.startsWith('Pretendard') && font.isCustomFont), `${selector}: ${JSON.stringify(fonts)}`).toBe(true);
    }
  });

  test('본문이 넘치면 스크롤되고(큰 글자) 하단 동작은 늘 보인다: 스크롤해도 "이용 완료"에 닿는다', async ({ page }) => {
    const api = await openKiosk(page);
    await setLargeText(page, true);
    await reachResult(page, api, notCoveredResponse());
    await openBasis(page);
    const scroll = await page.locator('.kiosk-sheet__body').evaluate((element) => ({ scrollable: element.scrollHeight > element.clientHeight, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
    expect(scroll.scrollHeight).toBeGreaterThanOrEqual(scroll.clientHeight);
    // 동작 막대는 본문 밖에 고정이다: 본문을 끝까지 내려도 같은 자리에 있다.
    const before = await sheetComplete(page).boundingBox();
    await page.locator('.kiosk-sheet__body').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const after = await sheetComplete(page).boundingBox();
    expect(after?.y).toBe(before?.y);
    await expect(sheetComplete(page)).toBeVisible();
    // 맨 아래까지 내리면 안내 막대(마지막 요소)가 보인다.
    await expect(page.locator('.kiosk-sheet__body .kiosk-notice')).toBeInViewport();
  });
});

// ───────────────────────────── 결과로 돌아가기 ─────────────────────────────

const RESULT_KINDS = [
  { name: '정상', response: () => normalWith(singleCauseDocuments()), kind: 'normal' },
  { name: '보장 제외', response: () => notCoveredWith(singleCauseDocuments()), kind: 'not-covered' },
] as const;

test.describe('"결과로 돌아가기": 들어온 결과 종류로 돌아가고 선택·결과·금액이 그대로다 (AC-014e)', () => {
  for (const { name, response, kind } of RESULT_KINDS) {
    for (const entry of ['근거', '서류'] as const) {
      test(`${name} 결과 → ${entry} → 결과로 돌아가기: ${name} 결과이고 금액·선택이 그대로이며 새 요청이 없다`, async ({ page }) => {
        const api = await openKiosk(page);
        await reachResult(page, api, response());
        const before = await Promise.all([amountValue(page, 'hospital').innerText(), amountValue(page, 'payout').innerText(), amountValue(page, 'after').innerText()]);
        if (entry === '근거') await openBasis(page);
        else await openDocuments(page, 'documents');
        await sheetBack(page).click();
        await expect(resultRoot(page)).toHaveAttribute('data-result', kind);
        await expect(page.locator('[data-kiosk-primary]')).toBeFocused();
        expect(await Promise.all([amountValue(page, 'hospital').innerText(), amountValue(page, 'payout').innerText(), amountValue(page, 'after').innerText()])).toEqual(before);
        expect(await actionsOf(page).allInnerTexts()).toEqual(['보험 청구에 필요한 서류 확인', '계산 근거 보기', '치료 다시 선택', '보험 조건 수정', '처음으로', '이용 완료']);
        // 선택은 그대로다: 치료 다시 선택으로 가면 요약이 같다.
        await actionsOf(page).filter({ hasText: '치료 다시 선택' }).click();
        await expect(heading(page, TITLES.treatments)).toBeVisible();
        expect(await summaryText(page)).toContain('124,000원');
        expect(api.callsTo('estimate')).toHaveLength(1);
      });
    }
  }

  test('원인 모름 서류 화면에서도 결과로 돌아간다 (보장 제외 결과)', async ({ page }) => {
    const api = await openKiosk(page);
    await reachResult(page, api, notCoveredWith(unknownCauseDocuments()), 'UNKNOWN');
    await openDocuments(page, 'documents-unknown');
    await sheetBack(page).click();
    await expect(resultRoot(page)).toHaveAttribute('data-result', 'not-covered');
    expect(api.callsTo('estimate')).toHaveLength(1);
  });
});

const SHEETS: ReadonlyArray<{ name: string; cause: Cause; open: (page: Page) => Promise<void>; marker: string; response: () => ReturnType<typeof normalWith> }> = [
  { name: '계산 근거', cause: 'INJURY', open: openBasis, marker: 'basis', response: () => estimatedResponse() },
  { name: '필요 서류', cause: 'INJURY', open: (page) => openDocuments(page, 'documents'), marker: 'documents', response: () => normalWith(singleCauseDocuments()) },
  { name: '필요 서류(원인 모름)', cause: 'UNKNOWN', open: (page) => openDocuments(page, 'documents-unknown'), marker: 'documents-unknown', response: () => normalWith(unknownCauseDocuments()) },
];

test.describe('근거·서류 화면에서 큰 글자 보기·화면 방향을 바꾸고 돌아가기 (AC-014h·AC-014i)', () => {
  for (const entry of SHEETS) {
    test(`${entry.name}: 큰 글자를 켜도 그 화면에 머물고, 켠 채 돌아가면 결과 화면에 그 설정이 남으며, 새 요청이 없다 (AC-014h)`, async ({ page }) => {
      const api = await openKiosk(page);
      await reachResult(page, api, entry.response(), entry.cause);
      await entry.open(page);
      await setLargeText(page, true);
      await expect(page.locator(`[data-sheet="${entry.marker}"]`)).toBeVisible();
      await setLargeText(page, false);
      await expect(page.locator(`[data-sheet="${entry.marker}"]`)).toBeVisible();
      await setLargeText(page, true);
      await expect(page.locator(`[data-sheet="${entry.marker}"]`)).toBeVisible();
      await sheetBack(page).click();
      await expect(resultRoot(page)).toHaveAttribute('data-result', 'normal');
      await expect(page.locator('.kiosk-root')).toHaveAttribute('data-large-text', 'true');
      await expect(amountValue(page, 'hospital')).toHaveText('124,000원');
      expect(api.callsTo('estimate')).toHaveLength(1);
    });

    test(`${entry.name}: 큰 글자를 켰다가 다시 끄고 돌아가면 결과 화면은 일반 글자다 (들어올 때 값이 아니라 복귀 시점의 값)`, async ({ page }) => {
      const api = await openKiosk(page);
      await setLargeText(page, true);
      await reachResult(page, api, entry.response(), entry.cause);
      await entry.open(page);
      await expect(page.locator('.kiosk-root')).toHaveAttribute('data-large-text', 'true');
      await setLargeText(page, false);
      await sheetBack(page).click();
      await expect(resultRoot(page)).toBeVisible();
      await expect(page.locator('.kiosk-root')).toHaveAttribute('data-large-text', 'false');
      expect(api.callsTo('estimate')).toHaveLength(1);
    });

    test(`${entry.name}: 화면 방향을 바꿔도 그 화면에 머물고, 돌아가면 결과 화면이 바뀐 방향이다 (선택·금액 그대로, 요청 없음, AC-014i)`, async ({ page }, testInfo) => {
      const api = await openKiosk(page);
      await reachResult(page, api, entry.response(), entry.cause);
      await entry.open(page);
      const start = isLandscape(testInfo.project.name) ? 'landscape' : 'portrait';
      const next = await swapOrientation(page);
      expect(next).not.toBe(start);
      await expect(page.locator(`[data-sheet="${entry.marker}"]`)).toBeVisible();
      await sheetBack(page).click();
      await expect(resultRoot(page)).toBeVisible();
      await expect(page.locator('.kiosk-root')).toHaveAttribute('data-orientation', next);
      await expect(amountValue(page, 'hospital')).toHaveText('124,000원');
      // 반대로 되돌려도 같다.
      await openAgain(page, entry.marker);
      await swapOrientation(page);
      await sheetBack(page).click();
      await expect(page.locator('.kiosk-root')).toHaveAttribute('data-orientation', start);
      await expect(resultRoot(page)).toHaveAttribute('data-result', 'normal');
      expect(api.callsTo('estimate')).toHaveLength(1);
    });
  }

  async function openAgain(page: Page, marker: string): Promise<void> {
    if (marker === 'basis') await openBasis(page);
    else await openDocuments(page, marker === 'documents' ? 'documents' : 'documents-unknown');
  }
});

// ───────────────────────────── 필요 서류 ─────────────────────────────

test.describe('필요 서류 K07_Documents (AC-007g, AC-014c·g)', () => {
  test('아홉 줄이 고정 순서로 모두 있고, 필요한 줄만 체크·사유가 있다. 청구 기준·안내 문구가 기획서 §4 그대로다', async ({ page }, testInfo) => {
    const api = await openKiosk(page);
    await reachResult(page, api, normalWith(singleCauseDocuments()));
    await openDocuments(page, 'documents');
    await expect(page.locator('[data-kiosk-primary]')).toBeFocused();
    await expect(heading(page, DOCS_TITLE)).toBeVisible();
    expect(await visibleDocKeys(page)).toEqual(NINE);
    await expect(requiredDocLines(page)).toHaveCount(5);
    const docs = await visibleDocs(page);
    expect(docs.filter((doc) => doc.required).map((doc) => doc.key)).toEqual(['OUTPATIENT_CONFIRMATION', 'RECEIPT_AND_ITEMIZED', 'INITIAL_EXAM_RECORD', 'MEDICAL_OPINION', 'IMAGING_READING']);
    // 필요한 줄은 사유를 가지고 필요 없는 줄은 사유가 없다.
    expect(docs.filter((doc) => doc.required).every((doc) => doc.reasons.length >= 1)).toBe(true);
    expect(docs.filter((doc) => !doc.required).every((doc) => doc.reasons.length === 0)).toBe(true);
    const text = await screenText(page);
    for (const name of ['진단서', '통원확인서', '진료확인서', '영수증 · 세부내역서', '초진기록지', '입퇴원확인서', '소견서', '판독지', '조직검사결과지']) expect(text).toContain(name);
    expect(text).toContain('필요 서류 안내');
    expect(text).toContain('예시 기준');
    expect(text).toContain('서류 9가지 중 이번 청구에 필요한 항목에 체크했습니다.');
    expect(text).toContain('서류는 병원 원무과에서 발급합니다. 보험사와 상품에 따라 추가 서류를 요구할 수 있습니다.');
    expect(text).toContain('X-ray · 초음파 검사가 있어 필요합니다.');
    if (isLandscape(testInfo.project.name)) expect(text).toContain('상해 · 손해보험사 · 통원 · 치료 4개');
    else {
      expect(text).toContain('청구 기준 상해 · 손해보험사 · 통원');
      expect(text).toContain('선택한 치료 TEST_FIXTURE X-ray, TEST_FIXTURE 초음파, TEST_FIXTURE 신장분사치료, TEST_FIXTURE 물리치료 (4개)');
    }
    expect(text).not.toMatch(FORBIDDEN_TEXT);
    await noLinks(page);
    // 필요 여부가 색만이 아니라 글로도 알려진다 (화면 낭독기용 글).
    expect(await page.locator('.kiosk-doc .kiosk-sr-only').allTextContents()).toHaveLength(9);
    expect(await sheetFooter(page).allInnerTexts()).toEqual(['처음으로', '결과로 돌아가기', '이용 완료']);
    expect(api.callsTo('estimate')).toHaveLength(1);
  });

  test('쪽 넘김이 없다 (일반 글자: 아홉 줄이 한 화면)', async ({ page }) => {
    const api = await openKiosk(page);
    await reachSheetScreen(page, api, 'K07_Documents');
    await expect(page.locator('.kiosk-sheet__pager')).toHaveCount(0);
  });

  for (const [kindName, build] of [
    ['정상', normalWith],
    ['보장 제외', notCoveredWith],
  ] as const) {
    for (const [cause, expected] of [
      ['INJURY', 'documents'],
      ['ILLNESS', 'documents'],
      ['UNKNOWN', 'documents-unknown'],
    ] as const) {
      test(`분기: ${kindName} 결과 · 원인 ${cause} → ${expected === 'documents' ? 'K07_Documents' : 'K07_Documents_Unknown'} (결과 종류와 무관, AC-014g)`, async ({ page }) => {
        const api = await openKiosk(page);
        await reachResult(page, api, build(cause === 'UNKNOWN' ? unknownCauseDocuments() : singleCauseDocuments()), cause);
        await openDocuments(page, expected);
        await expect(docsSheet(page)).toHaveAttribute('data-sheet', expected);
        expect(api.callsTo('estimate')).toHaveLength(1);
        await expect(docLines(page)).toHaveCount(9);
      });
    }
  }

  test('치료 원인만 바꿔 다시 확인하면 금액 블록은 같고 서류 목록이 새로 산출된다 (AC-014c)', async ({ page }) => {
    const api = await openKiosk(page);
    await reachResult(page, api, normalWith(singleCauseDocuments()), 'INJURY');
    const amountsBefore = await page.locator('.kiosk-amounts').innerHTML();
    await openDocuments(page, 'documents');
    const injury = await visibleDocs(page);
    expect(injury.find((doc) => doc.key === 'INITIAL_EXAM_RECORD')?.required).toBe(true);
    expect(injury.find((doc) => doc.key === 'DIAGNOSIS_CERT')?.required).toBe(false);
    await sheetBack(page).click();
    await actionsOf(page).filter({ hasText: '보험 조건 수정' }).click();
    await expect(heading(page, TITLES.generation)).toBeVisible();
    await page.locator('.kiosk-bottom-actions').getByRole('button', { name: '다음', exact: true }).click();
    await page.locator('.kiosk-bottom-actions').getByRole('button', { name: '다음', exact: true }).click();
    await expect(heading(page, TITLES.cause)).toBeVisible();
    await page.getByRole('radio', { name: '아파서 왔어요 (질병)' }).check();
    await page.locator('.kiosk-bottom-actions').getByRole('button', { name: '다음', exact: true }).click();
    await expect(heading(page, TITLES.treatments)).toBeVisible();
    // 원인이 바뀌면 이전 결과·서류는 지워졌고, 다시 확인한 응답의 새 서류가 보인다 (금액은 같다).
    const illnessDocuments = singleCauseDocuments({
      lines: [
        docLine('DIAGNOSIS_CERT', true, ['병명과 치료 내용을 확인합니다.']),
        docLine('OUTPATIENT_CONFIRMATION', true, ['통원 치료 기준 · 진료받은 날짜를 확인합니다.']),
        docLine('TREATMENT_CONFIRMATION', false),
        docLine('RECEIPT_AND_ITEMIZED', true, ['반드시 함께 제출합니다. 결제 사실과 항목별 금액을 확인합니다.']),
        docLine('INITIAL_EXAM_RECORD', false),
        docLine('ADMISSION_DISCHARGE_CONFIRMATION', false),
        docLine('MEDICAL_OPINION', true, ['신장분사치료가 보험사 재량 항목이라 필요합니다.']),
        docLine('IMAGING_READING', true, ['X-ray · 초음파 검사가 있어 필요합니다.']),
        docLine('BIOPSY_RESULT', false),
      ],
    });
    await submitEstimate(page, api, reply(200, normalWith(illnessDocuments)));
    await expect(resultRoot(page)).toHaveAttribute('data-result', 'normal');
    expect(await page.locator('.kiosk-amounts').innerHTML()).toBe(amountsBefore);
    await openDocuments(page, 'documents');
    const illness = await visibleDocs(page);
    expect(illness.find((doc) => doc.key === 'DIAGNOSIS_CERT')?.required).toBe(true);
    expect(illness.find((doc) => doc.key === 'INITIAL_EXAM_RECORD')?.required).toBe(false);
    expect(illness).not.toEqual(injury);
    const [first, second] = api.callsTo('estimate').map((call) => JSON.parse(call.postData ?? '{}') as Record<string, unknown>);
    expect(first?.cause).toBe('INJURY');
    expect(second?.cause).toBe('ILLNESS');
  });
});

test.describe('필요 서류: 규칙을 쓸 수 없음 (AC-007g)', () => {
  test('RULES_UNAVAILABLE: 서류 목록 대신 안내 문구이고 서류 줄·체크가 없으며, 돌아가기·이용 완료·처음으로와 결과의 여섯 동작이 그대로다', async ({ page }) => {
    const api = await openKiosk(page);
    await reachSheetScreen(page, api, 'K07_Documents_RulesUnavailable');
    await expect(docLines(page)).toHaveCount(0);
    await expect(page.locator('[data-docs-unavailable]')).toBeVisible();
    const text = await screenText(page);
    expect(text).toContain('필요 서류 목록을 안내하지 못했어요');
    expect(text).toContain('접수 직원에게 문의해 주세요.');
    expect(text).not.toContain('서류 9가지 중');
    expect(text).not.toMatch(FORBIDDEN_TEXT);
    // 안내 문구는 문장이다: 문의 버튼·링크가 없다.
    await expect(page.getByRole('button', { name: /직원|문의/ })).toHaveCount(0);
    await noLinks(page);
    expect(await sheetFooter(page).allInnerTexts()).toEqual(['처음으로', '결과로 돌아가기', '이용 완료']);
    await sheetBack(page).click();
    await expect(resultRoot(page)).toHaveAttribute('data-result', 'normal');
    expect(await actionsOf(page).allInnerTexts()).toEqual(['보험 청구에 필요한 서류 확인', '계산 근거 보기', '치료 다시 선택', '보험 조건 수정', '처음으로', '이용 완료']);
  });

  test('줄이 빠진 서류(깨진 목록)도 일부만 보이지 않고 안내 문구다', async ({ page }) => {
    const api = await openKiosk(page);
    const full = singleCauseDocuments();
    if (full.state !== 'AVAILABLE') throw new Error('시험 자료');
    await reachResult(page, api, normalWith({ ...full, lines: full.lines.slice(2) }));
    await openDocuments(page, 'documents');
    await expect(docLines(page)).toHaveCount(0);
    await expect(page.locator('[data-docs-unavailable]')).toBeVisible();
  });
});

test.describe('필요 서류 K07_Documents_Unknown 원인 모름 (AC-007h·i)', () => {
  test('공통 묶음과 분기 묶음(상해·질병)이 머리글과 함께 보이고 아홉 줄이 한 번씩이며, 안내 문장은 실제 전용 줄 이름을 따른다', async ({ page }) => {
    const api = await openKiosk(page);
    await reachSheetScreen(page, api, 'K07_Documents_Unknown');
    await expect(page.locator('[data-kiosk-primary]')).toBeFocused();
    const keys = await visibleDocKeys(page);
    expect([...keys].sort()).toEqual([...NINE].sort());
    expect(new Set(keys).size).toBe(9);
    const text = await screenText(page);
    expect(text).toContain('치료 원인을 고르지 않으셔서 상해일 때와 질병일 때를 나눠서 안내합니다.');
    expect(text).toContain('상해 또는 질병 (선택 안 함)');
    expect(text).toContain('공통으로 필요한 서류');
    expect(text).toContain('치료 원인에 따라 추가되는 서류 (해당하는 쪽만 받으세요)');
    expect(text).toContain('다쳐서 오셨다면 (상해)');
    expect(text).toContain('아파서 오셨다면 (질병)');
    expect(text).toContain('다쳐서 오셨으면 초진기록지, 아파서 오셨으면 진단서를 함께 받으세요. 서류는 병원 원무과에서 발급하며, 보험사와 상품에 따라 추가 서류를 요구할 수 있습니다.');
    // 범위: 상해 전용 = 초진기록지, 질병 전용 = 진단서
    await expect(page.locator('[data-doc-group="INJURY_ONLY"] [data-doc-line]')).toHaveCount(1);
    await expect(page.locator('[data-doc-group="INJURY_ONLY"] [data-doc-line="INITIAL_EXAM_RECORD"]')).toHaveCount(1);
    await expect(page.locator('[data-doc-group="ILLNESS_ONLY"] [data-doc-line="DIAGNOSIS_CERT"]')).toHaveCount(1);
    await expect(page.locator('[data-doc-group="COMMON"] [data-doc-line]')).toHaveCount(7);
    expect(text).not.toMatch(FORBIDDEN_TEXT);
    await noLinks(page);
  });

  test('전용 줄이 상해 2 · 질병 3 이고 사유가 여러 줄·길어도 아홉 줄이 한 번씩 보이고(쪽이 나뉘면 이어서) 사유가 모두 보인다 (AC-007h·i)', async ({ page }) => {
    const api = await openKiosk(page);
    await reachSheetScreen(page, api, 'K07_Documents_Unknown_Wide');
    const keys = await visibleDocKeys(page);
    expect([...keys].sort()).toEqual([...NINE].sort());
    await expect(page.locator('[data-doc-group="INJURY_ONLY"] [data-doc-line]')).toHaveCount(2);
    await expect(page.locator('[data-doc-group="ILLNESS_ONLY"] [data-doc-line]')).toHaveCount(3);
    // 공통 줄의 사유 둘이 모두 있고, 질병 전용 줄의 사유 둘도 모두 있다.
    await expect(page.locator('[data-doc-line="RECEIPT_AND_ITEMIZED"] .kiosk-doc__reason')).toHaveCount(2);
    await expect(page.locator('[data-doc-line="BIOPSY_RESULT"] .kiosk-doc__reason')).toHaveCount(2);
    await expectLayoutClean(page, '원인 모름(전용 줄 여럿)');
    expect(await screenText(page)).toContain('다쳐서 오셨으면 초진기록지·입퇴원확인서, 아파서 오셨으면 진단서·소견서·조직검사결과지를 함께 받으세요.');
  });

  test('상해 전용 0줄 · 질병 전용 4줄: 상해 머리글이 없고 질병 묶음만 있다. 전용 줄이 하나도 없으면 분기 머리글도 없다', async ({ page }) => {
    const api = await openKiosk(page);
    const illnessOnly = ['DIAGNOSIS_CERT', 'MEDICAL_OPINION', 'BIOPSY_RESULT', 'IMAGING_READING'].map((line) => ({ line, required: true, reasons: [`${line} 사유`], scope: 'ILLNESS_ONLY' as const }));
    await reachResult(page, api, normalWith(unknownCauseDocuments({ injuryOnly: [], illnessOnly: illnessOnly as never })), 'UNKNOWN');
    await openDocuments(page, 'documents-unknown');
    expect([...(await visibleDocKeys(page))].sort()).toEqual([...NINE].sort());
    const text = await screenText(page);
    expect(text).toContain('아파서 오셨다면 (질병)');
    expect(text).not.toContain('다쳐서 오셨다면 (상해)');

    await sheetBack(page).click();
    await actionsOf(page).filter({ hasText: '치료 다시 선택' }).click();
    await submitEstimate(page, api, reply(200, normalWith(unknownCauseDocuments({ injuryOnly: [], illnessOnly: [] }))));
    await openDocuments(page, 'documents-unknown');
    expect(await screenText(page)).not.toContain('치료 원인에 따라 추가되는 서류');
    expect(await visibleDocKeys(page)).toHaveLength(9);
  });
});

// ───────────────────────────── 쪽 나눔 ─────────────────────────────

test.describe('쪽 나눔: 큰 글자 보기에서 줄이 빠지거나 반복되지 않는다 (AC-007i)', () => {
  for (const screen of ['K07_Documents', 'K07_Documents_Unknown', 'K07_Documents_Unknown_Wide'] as const) {
    test(`${screen}: 쪽을 앞으로 넘기며 본 줄이 아홉 줄 한 번씩이고 체크·사유가 쪽 나눔 전과 같으며, 뒤로 넘겨도 같다. 요청이 나가지 않는다`, async ({ page }) => {
      const api = await openKiosk(page);
      await reachSheetScreen(page, api, screen);
      const baseline = await visibleDocs(page);
      expect(baseline).toHaveLength(9);
      await setLargeText(page, true);
      await expect(docsPagerStatus(page)).toContainText('1 /');
      await expect(docsPagerPrevious(page)).toHaveAttribute('aria-disabled', 'true');
      const forward: Array<{ key: string; required: boolean; reasons: string[] }> = [];
      const pageCount = Number(/\/ (\d+) 페이지/.exec(await docsPagerStatus(page).innerText())?.[1] ?? Number.NaN);
      expect(pageCount).toBeGreaterThanOrEqual(2);
      for (let index = 0; index < pageCount; index += 1) {
        await expect(docsPagerStatus(page)).toContainText(`${index + 1} /`);
        const current = await visibleDocs(page);
        expect(current.length, `쪽 ${index + 1}`).toBeGreaterThan(0);
        forward.push(...current);
        if (index < pageCount - 1) await docsPagerNext(page).click();
      }
      await expect(docsPagerNext(page)).toHaveAttribute('aria-disabled', 'true');
      // 쪽을 이으면 아홉 줄이 한 번씩이고(손실·반복 없음), 줄마다 체크와 사유가 쪽 나눔 전과 같다.
      expect(forward.map((doc) => doc.key).sort()).toEqual([...NINE].sort());
      expect(new Set(forward.map((doc) => doc.key)).size).toBe(9);
      for (const doc of forward) expect(doc, doc.key).toEqual(baseline.find((item) => item.key === doc.key));
      // 뒤로 넘기며 같은 쪽을 다시 본다.
      const backward: string[][] = [];
      for (let index = pageCount - 1; index >= 0; index -= 1) {
        await expect(docsPagerStatus(page)).toContainText(`${index + 1} /`);
        backward.unshift(await visibleDocKeys(page));
        if (index > 0) await docsPagerPrevious(page).click();
      }
      expect(backward.flat().sort()).toEqual([...NINE].sort());
      await expect(docsPagerPrevious(page)).toHaveAttribute('aria-disabled', 'true');
      expect(api.callsTo('estimate')).toHaveLength(1);
    });
  }

  test('큰 글자를 켰다 끄면 쪽 나눔이 사라지고 아홉 줄이 한 화면에 다시 보이며, 보던 쪽에서 끄면 보던 줄이 보인다', async ({ page }) => {
    const api = await openKiosk(page);
    await reachSheetScreen(page, api, 'K07_Documents');
    const baseline = await visibleDocs(page);
    await setLargeText(page, true);
    await docsPagerNext(page).click();
    const secondPageFirst = (await visibleDocKeys(page))[0];
    await setLargeText(page, false);
    await expect(page.locator('.kiosk-sheet__pager')).toHaveCount(0);
    expect(await visibleDocs(page)).toEqual(baseline);
    expect(NINE).toContain(secondPageFirst);
    // 다시 켜면 처음 쪽이 아니라 보던 줄(둘째 쪽 첫 줄)이 든 쪽이다.
    await setLargeText(page, true);
    expect(await visibleDocKeys(page)).toContain(secondPageFirst);
  });

  test('화면 방향을 바꿔도 줄이 빠지거나 반복되지 않는다 (큰 글자, 쪽을 넘기며)', async ({ page }) => {
    const api = await openKiosk(page);
    await reachSheetScreen(page, api, 'K07_Documents_Unknown_Wide');
    await setLargeText(page, true);
    await swapOrientation(page);
    const seen: string[] = [];
    for (let guard = 0; guard < 12; guard += 1) {
      seen.push(...(await visibleDocKeys(page)));
      if ((await docsPagerNext(page).count()) === 0 || (await docsPagerNext(page).getAttribute('aria-disabled')) === 'true') break;
      await docsPagerNext(page).click();
    }
    expect([...seen].sort()).toEqual([...NINE].sort());
  });

  test('쪽 넘김 단추는 터치 영역 72px 이상이고 키보드로 닿는다', async ({ page }) => {
    const api = await openKiosk(page);
    await reachSheetScreen(page, api, 'K07_Documents');
    await setLargeText(page, true);
    const box = await docsPagerNext(page).boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(72);
    expect(box?.height).toBeGreaterThanOrEqual(72);
    await tabTo(page, docsPagerNext(page));
    await page.keyboard.press('Enter');
    await expect(docsPagerStatus(page)).toContainText('2 /');
  });
});

// ───────────────────────────── 하단 동작 ─────────────────────────────

test.describe('근거·서류 화면의 "처음으로"·"이용 완료"', () => {
  for (const entry of SHEETS) {
    test(`${entry.name}: "처음으로"(입력 있음)는 확인창이고 계속 이용하면 그 화면이 그대로이며, 확인하면 이용 완료 화면 없이 시작 화면이다`, async ({ page }) => {
      const api = await openKiosk(page);
      await reachResult(page, api, entry.response(), entry.cause);
      await entry.open(page);
      await sheetHome(page).click();
      await expect(resetDialog(page)).toBeVisible();
      await resetDialog(page).getByRole('button', { name: '계속 이용' }).click();
      await expect(dialog(page)).toHaveCount(0);
      await expect(page.locator(`[data-sheet="${entry.marker}"]`)).toBeVisible();
      await expect(sheetHome(page)).toBeFocused();
      await sheetHome(page).click();
      await resetDialog(page).getByRole('button', { name: '처음으로' }).click();
      await expectStartScreen(page);
      await expect(completeScreen(page)).toHaveCount(0);
      await expect(sheet(page)).toHaveCount(0);
    });

    test(`${entry.name}: "이용 완료"는 먼저 비운 뒤 이용 완료 화면이고 이전 선택·금액이 화면에 없다`, async ({ page }) => {
      const api = await openKiosk(page);
      await reachResult(page, api, entry.response(), entry.cause);
      await entry.open(page);
      await sheetComplete(page).click();
      await expect(completeScreen(page)).toBeVisible();
      await expect(sheet(page)).toHaveCount(0);
      const text = await page.locator('.kiosk-root').innerText();
      expect(text).not.toMatch(/124,000|114,000|10,000원|TEST_FIXTURE X-ray|서류 9가지/);
    });
  }
});

// ───────────────────────────── 이용 완료 ─────────────────────────────

const holdPolicy = (completionHoldSeconds: number | null) => ({ catalog: makeCatalog({ idlePolicy: { ...idlePolicyWith({}), completionHoldSeconds } }) });

test.describe('이용 완료 K06_Complete (AC-015f)', () => {
  test('화면 구성: 감사 문구·지워졌다는 안내·다음 환자 안내와 "처음 화면으로" 버튼 하나, 초점은 제목, 선택·금액 없음', async ({ page }) => {
    const api = await openKiosk(page, holdPolicy(10));
    await reachSheetScreen(page, api, 'K06_Complete');
    await expect(page.locator('[data-kiosk-primary]')).toBeFocused();
    await expect(heading(page, COMPLETE_TITLE)).toBeVisible();
    const text = await page.locator('.kiosk-root').innerText();
    expect(text).toContain('선택하신 보험 조건과 치료 내용은 모두 지워졌습니다.');
    expect(text).toContain('잠시 후 첫 화면으로 돌아갑니다.');
    expect(text).toContain('다음 환자에게 이전 선택 내용과 금액이 보이지 않습니다.');
    expect(text).not.toMatch(/\d[\d,]*원|TEST_FIXTURE X-ray/);
    expect(await page.locator('.kiosk-screen').getByRole('button').allInnerTexts()).toEqual(['처음 화면으로']);
    expect(text).not.toMatch(FORBIDDEN_TEXT);
    await noLinks(page);
    expect(api.callsTo('estimate')).toHaveLength(1);
  });

  test('"처음 화면으로": 새 세션의 시작 화면이고 이전 선택이 남아 있지 않으며 큰 글자는 꺼진다. 화면 방향은 유지된다', async ({ page }) => {
    const api = await openKiosk(page);
    await setLargeText(page, true);
    await reachResult(page, api, estimatedResponse());
    await sheetCompleteViaResult(page);
    await expect(page.locator('.kiosk-root')).toHaveAttribute('data-large-text', 'false');
    const orientation = await page.locator('.kiosk-root').getAttribute('data-orientation');
    await page.getByRole('button', { name: '처음 화면으로' }).click();
    await expectStartScreen(page);
    await expect(page.locator('.kiosk-root')).toHaveAttribute('data-orientation', orientation ?? '');
    await startButton(page).click();
    await expect(heading(page, TITLES.generation)).toBeVisible();
    expect(await page.getByRole('radio').evaluateAll((inputs) => inputs.some((input) => (input as HTMLInputElement).checked))).toBe(false);
  });

  async function sheetCompleteViaResult(page: Page): Promise<void> {
    await actionsOf(page).filter({ hasText: '이용 완료' }).click();
    await expect(completeScreen(page)).toBeVisible();
  }

  test('화면 방향을 바꿔 둔 채 이용 완료: 이용 완료 화면과 다음 시작 화면이 같은 방향이다', async ({ page }) => {
    const api = await openKiosk(page);
    await reachResult(page, api, estimatedResponse());
    const next = await swapOrientation(page);
    await sheetCompleteViaResult(page);
    await expect(page.locator('.kiosk-root')).toHaveAttribute('data-orientation', next);
    await page.getByRole('button', { name: '처음 화면으로' }).click();
    await expectStartScreen(page);
    await expect(page.locator('.kiosk-root')).toHaveAttribute('data-orientation', next);
  });

  test('completionHoldSeconds=5: 안내 문장이 자동 복귀를 말하고, 4.5초에는 그대로이며 5초 뒤 시작 화면이 된다', async ({ page }) => {
    await installClock(page);
    const api = await openKiosk(page, holdPolicy(5));
    await reachResult(page, api, estimatedResponse());
    await sheetCompleteViaResult(page);
    expect(await page.locator('.kiosk-root').innerText()).toContain('잠시 후 첫 화면으로 돌아갑니다.');
    await page.clock.runFor(4_000);
    await expect(completeScreen(page)).toBeVisible();
    await page.clock.runFor(2_000);
    await expectStartScreen(page);
    await expect(completeScreen(page)).toHaveCount(0);
  });

  test('completionHoldSeconds=null: 자동 복귀가 없다 — 아주 오래 두어도(하루) 이용 완료 화면이고, 10초를 대신 쓰지 않으며, 버튼으로만 떠난다', async ({ page }) => {
    await installClock(page);
    const api = await openKiosk(page, holdPolicy(null));
    await reachResult(page, api, estimatedResponse());
    await sheetCompleteViaResult(page);
    const text = await page.locator('.kiosk-root').innerText();
    expect(text).not.toContain('잠시 후');
    expect(text).toContain('‘처음 화면으로’');
    await page.clock.runFor(12_000); // 10초 기본값을 대신 쓴다면 여기서 시작 화면이 된다
    await expect(completeScreen(page)).toBeVisible();
    await page.clock.fastForward(24 * 60 * 60 * 1000);
    await page.clock.runFor(1_000);
    await expect(completeScreen(page)).toBeVisible();
    await expect(page.getByRole('button', { name: '처음 화면으로' })).toBeVisible();
    await page.getByRole('button', { name: '처음 화면으로' }).click();
    await expectStartScreen(page);
  });

  test('정책이 없는 병원(completionHoldSeconds 가 응답에 없음)도 자동 복귀가 없다', async ({ page }) => {
    await installClock(page);
    const api = await openKiosk(page, { catalog: makeCatalog({ idlePolicy: undefined as never }) });
    await reachResult(page, api, estimatedResponse());
    await sheetCompleteViaResult(page);
    await page.clock.runFor(60_000);
    await expect(completeScreen(page)).toBeVisible();
  });

  test('통신 오류의 "이용 종료"도 같은 이용 완료 화면이다 (먼저 비운 뒤)', async ({ page }) => {
    const api = await openKiosk(page, holdPolicy(null));
    await toFilledK03(page);
    await submitEstimate(page, api, reply(500, { error: 'INTERNAL_ERROR' }));
    await page.locator('.kiosk-bottom-actions').getByRole('button', { name: '이용 종료' }).click();
    await expect(completeScreen(page)).toBeVisible();
    expect(await page.locator('.kiosk-screen').innerText()).not.toMatch(/TEST_FIXTURE|\d[\d,]*원/);
  });

  test('새로고침하면 시작 화면이다 (이용 완료 화면이 복원되지 않는다)', async ({ page }) => {
    const api = await openKiosk(page);
    await reachResult(page, api, estimatedResponse());
    await sheetCompleteViaResult(page);
    await page.reload();
    await expectStartScreen(page);
    expect(page.url()).toContain(KIOSK_PATH);
  });
});

// ───────────────────────────── 겹침창 ─────────────────────────────

const OVERLAY_POLICY = (extra: Parameters<typeof idlePolicyWith>[0] = {}) => ({ catalog: makeCatalog({ idlePolicy: idlePolicyWith({ BASIS_AND_DOCUMENTS: { warnSeconds: 20, resetSeconds: 60 }, ...extra }) }) });

test.describe('근거·서류 화면 위의 겹침창 (AC-015b·g·j·k, DD-07)', () => {
  for (const entry of SHEETS) {
    test(`${entry.name}: 무조작 경고(20초)에 TimeoutDialog 가 뜨고 밑 화면이 그대로이며, "계속 사용할게요"로 그 화면에 돌아온다. 더 두면 초기화 시각(60초)에 시작 화면이고 결과가 남지 않는다`, async ({ page }) => {
      await installClock(page);
      const api = await openKiosk(page, OVERLAY_POLICY());
      await reachResult(page, api, entry.response(), entry.cause);
      await entry.open(page);
      await page.clock.runFor(20_500);
      await expect(timeoutDialog(page)).toBeVisible();
      await expect(under(page, `[data-sheet="${entry.marker}"]`)).toBeVisible();
      await expect(page.locator('.kiosk-underlay')).toHaveAttribute('inert', '');
      await timeoutDialog(page).getByRole('button', { name: '계속 사용할게요' }).click();
      await expect(dialog(page)).toHaveCount(0);
      await expect(page.locator(`[data-sheet="${entry.marker}"]`)).toBeVisible();
      expect(await page.locator('.kiosk-underlay :focus').count()).toBe(1);
      // 연장한 시각부터 다시 센다: 55초 뒤에도 그 화면, 그 뒤 초기화.
      await page.clock.runFor(45_000);
      await expect(dialog(page)).toBeVisible();
      await page.clock.runFor(25_000);
      await expectStartScreen(page);
      await expect(dialog(page)).toHaveCount(0);
      expect(await page.locator('.kiosk-root').innerText()).not.toMatch(/124,000|TEST_FIXTURE X-ray|서류 9가지/);
      await expect(completeScreen(page)).toHaveCount(0);
    });
  }

  test('쪽을 넘긴 큰 글자 서류 화면: ResetConfirm 을 열었다 취소해도 보던 쪽이 그대로이고 줄이 빠지거나 반복되지 않는다', async ({ page }) => {
    const api = await openKiosk(page);
    await reachSheetScreen(page, api, 'K07_Documents');
    await setLargeText(page, true);
    await docsPagerNext(page).click();
    await expect(docsPagerStatus(page)).toContainText('2 /');
    const before = await visibleDocs(page);
    await sheetHome(page).click();
    await expect(resetDialog(page)).toBeVisible();
    await resetDialog(page).getByRole('button', { name: '계속 이용' }).click();
    await expect(docsPagerStatus(page)).toContainText('2 /');
    expect(await visibleDocs(page)).toEqual(before);
    await expect(sheetHome(page)).toBeFocused();
  });

  test('쪽을 넘긴 큰 글자 서류 화면: TimeoutDialog 의 "계속 사용할게요" 뒤에도 보던 쪽이다', async ({ page }) => {
    await installClock(page);
    const api = await openKiosk(page, OVERLAY_POLICY());
    await reachSheetScreen(page, api, 'K07_Documents');
    await setLargeText(page, true);
    await docsPagerNext(page).click();
    const before = await visibleDocs(page);
    await page.clock.runFor(20_500);
    await expect(timeoutDialog(page)).toBeVisible();
    await timeoutDialog(page).getByRole('button', { name: '계속 사용할게요' }).click();
    await expect(docsPagerStatus(page)).toContainText('2 /');
    expect(await visibleDocs(page)).toEqual(before);
  });
});

// ───────────────────────────── 영속 저장소·식별자·글꼴·키보드 ─────────────────────────────

test.describe('영속 저장소·주소·문서 (AC-016a·AC-016m 의 근거·서류·이용 완료 쪽)', () => {
  test('결과 → 근거 → 서류 → 이용 완료 → 처음 화면으로 까지 진행해도 저장소 덤프가 같고 표지 식별자가 어디에도 없다', async ({ page }) => {
    await installMarkerIds(page);
    const api = await openKiosk(page);
    const before = await dumpStorage(page);
    await reachResult(page, api, normalWith(singleCauseDocuments()));
    await openBasis(page);
    await sheetBack(page).click();
    await openDocuments(page, 'documents');
    await setLargeText(page, true);
    await docsPagerNext(page).click();
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    expect(html).not.toContain(MARKER_PREFIX);
    expect(html).not.toMatch(/requestId|refreshId|sessionId|data-request|data-session/);
    await sheetComplete(page).click();
    await expect(completeScreen(page)).toBeVisible();
    await page.getByRole('button', { name: '처음 화면으로' }).click();
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
    const url = new URL(page.url());
    expect(url.pathname + url.search + url.hash).toBe(KIOSK_PATH);
    for (const call of api.calls) expect(call.url + JSON.stringify(call.headers) + (call.postData ?? '')).not.toContain(MARKER_PREFIX);
    // 근거·서류·이용 완료를 오가는 동안 계산 요청은 처음 하나뿐이다.
    expect(api.callsTo('estimate')).toHaveLength(1);
  });
});

test.describe('키보드·글꼴', () => {
  test('근거·서류 화면은 키보드만으로 하단 동작 셋에 닿는다 (Tab 순서 = 화면 순서)', async ({ page }) => {
    const api = await openKiosk(page);
    await reachSheetScreen(page, api, 'K07_Documents');
    const visited: string[] = [];
    for (let guard = 0; guard < 20 && visited.length < 3; guard += 1) {
      await page.keyboard.press('Tab');
      const label = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText.trim() ?? '');
      if (['처음으로', '결과로 돌아가기', '이용 완료'].includes(label) && !visited.includes(label)) visited.push(label);
    }
    expect(visited).toEqual(['처음으로', '결과로 돌아가기', '이용 완료']);
  });

  test('서류 이름·사유의 글꼴이 웹 글꼴 Pretendard 이다', async ({ page }) => {
    const api = await openKiosk(page);
    await reachSheetScreen(page, api, 'K07_Documents');
    for (const selector of ['.kiosk-sheet__title', '.kiosk-doc__name', '.kiosk-doc__reason', '.kiosk-docs__hint']) {
      const fonts = await platformFonts(page, selector);
      expect(fonts.length, selector).toBeGreaterThan(0);
      expect(fonts.every((font) => font.familyName.startsWith('Pretendard') && font.isCustomFont), `${selector}: ${JSON.stringify(fonts)}`).toBe(true);
    }
  });

  test('이용 완료 화면의 글꼴이 웹 글꼴 Pretendard 이다', async ({ page }) => {
    const api = await openKiosk(page);
    await reachSheetScreen(page, api, 'K06_Complete');
    for (const selector of ['.kiosk-status__title', '.kiosk-status__body', '.kiosk-complete__start']) {
      const fonts = await platformFonts(page, selector);
      expect(fonts.every((font) => font.familyName.startsWith('Pretendard') && font.isCustomFont), `${selector}: ${JSON.stringify(fonts)}`).toBe(true);
    }
  });
});

test.describe('근거·서류·이용 완료 화면의 레이아웃 (일반·큰 글자, 이 방향의 프로젝트)', () => {
  test('근거 화면(일반 글자, 운영 자료 모양: 테스트 데이터 표시 없음): 정상 결과의 본문이 스크롤 없이 한 화면에 들어간다', async ({ page }) => {
    const api = await openKiosk(page);
    await reachResult(page, api, estimatedResponse({ origin: 'OPERATING' }));
    await openBasis(page);
    const fit = await page.locator('.kiosk-sheet__body').evaluate((element) => ({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
    expect(fit.scrollHeight, `본문 ${fit.scrollHeight} > 보이는 높이 ${fit.clientHeight}`).toBeLessThanOrEqual(fit.clientHeight + 1);
    await expectLayoutClean(page, '근거 일반 글자');
  });

  test('서류 화면(일반 글자, 운영 자료 모양): 아홉 줄이 스크롤 없이 한 화면에 들어간다', async ({ page }) => {
    const api = await openKiosk(page);
    await reachResult(page, api, normalWith(singleCauseDocuments({ origin: 'OPERATING' }), 'OPERATING'));
    await openDocuments(page, 'documents');
    const fit = await page.locator('.kiosk-sheet__body').evaluate((element) => ({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
    expect(fit.scrollHeight, `본문 ${fit.scrollHeight} > 보이는 높이 ${fit.clientHeight}`).toBeLessThanOrEqual(fit.clientHeight + 1);
    await expectLayoutClean(page, '서류 일반 글자');
  });

  test('원인 모름 서류 화면(일반 글자, 운영 자료 모양, 디자인 예시 구성 7+1+1): 스크롤 없이 한 화면에 들어간다', async ({ page }) => {
    const api = await openKiosk(page);
    await reachResult(page, api, normalWith(unknownCauseDocuments({ origin: 'OPERATING' }), 'OPERATING'), 'UNKNOWN');
    await openDocuments(page, 'documents-unknown');
    const fit = await page.locator('.kiosk-sheet__body').evaluate((element) => ({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
    expect(fit.scrollHeight, `본문 ${fit.scrollHeight} > 보이는 높이 ${fit.clientHeight}`).toBeLessThanOrEqual(fit.clientHeight + 1);
    await expectLayoutClean(page, '서류 모름 일반 글자');
  });

  test('이용 완료 화면: 잘림·겹침 없이 한 화면에 들어간다', async ({ page }) => {
    const api = await openKiosk(page);
    await reachSheetScreen(page, api, 'K06_Complete');
    await expectLayoutClean(page, '이용 완료');
  });
});

test.describe('근거 화면이 보지 못하는 결과 (방어)', () => {
  test('보류 결과에는 근거·서류로 가는 버튼이 없다', async ({ page }) => {
    const api = await openKiosk(page);
    await toFilledK03(page);
    await submitEstimate(page, api, reply(200, holdResponse()));
    await expect(resultRoot(page)).toHaveAttribute('data-result', 'hold');
    await expect(page.getByRole('button', { name: '계산 근거 보기' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '보험 청구에 필요한 서류 확인' })).toHaveCount(0);
    await expect(basisSheet(page)).toHaveCount(0);
  });
});
