import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { reply } from './api';
import type { ApiMock } from './api';
import { selectTreatment, toK03 } from './input';
import { FOUR_TREATMENTS, actionsOf, resultRoot, submitEstimate } from './results';
import { docLine, estimatedResponse, notCoveredResponse, singleCauseDocuments, unknownCauseDocuments } from '../../fixtures/kiosk/estimate-response.fixture';
import type { EstimateResponseDto } from '../../../src/app/kiosk/state/api-types';
import type { DocumentLine, DocumentsResult } from '../../../src/engine/types';

// 시험 자료(TEST_FIXTURE). 계산 근거 · 필요 서류 · 이용 완료 화면(S3b)을 브라우저로 시험하는 공통 도구: 결과까지 가고, 근거·서류 화면으로 들어가고, 화면 목록을 만든다.
// 화면 이름은 환자에게 보이지 않으므로 기능 표지(data-sheet·data-kiosk-state)·제목·버튼 이름으로 찾는다. 응답 본문은 가로채기 층의 시험 자료(estimate-response.fixture)다.

export const BASIS_TITLE = '예상 금액을 이렇게 계산했습니다';
export const DOCS_TITLE = '청구에 필요한 서류입니다';
export const COMPLETE_TITLE = '이용해 주셔서 감사합니다';

export type Cause = 'INJURY' | 'ILLNESS' | 'UNKNOWN';
const CAUSE_LABEL: Readonly<Record<Cause, string>> = { INJURY: '다쳐서 왔어요 (상해)', ILLNESS: '아파서 왔어요 (질병)', UNKNOWN: '잘 모르겠어요' };

export const sheet = (page: Page): Locator => page.locator('[data-sheet]');
export const basisSheet = (page: Page): Locator => page.locator('[data-sheet="basis"]');
export const docsSheet = (page: Page): Locator => page.locator('[data-sheet="documents"], [data-sheet="documents-unknown"]');
export const completeScreen = (page: Page): Locator => page.locator('[data-kiosk-state="COMPLETE"]');
export const docLines = (page: Page): Locator => page.locator('[data-doc-line]');
export const requiredDocLines = (page: Page): Locator => page.locator('[data-doc-line][data-required="true"]');
export const sheetFooter = (page: Page): Locator => page.locator('.kiosk-sheet .kiosk-bottom-actions').getByRole('button');
export const sheetBack = (page: Page): Locator => page.locator('.kiosk-sheet .kiosk-bottom-actions').getByRole('button', { name: '결과로 돌아가기' });
export const sheetComplete = (page: Page): Locator => page.locator('.kiosk-sheet .kiosk-bottom-actions').getByRole('button', { name: '이용 완료' });
export const sheetHome = (page: Page): Locator => page.locator('.kiosk-sheet .kiosk-bottom-actions').getByRole('button', { name: '처음으로' });
export const docsPagerNext = (page: Page): Locator => page.locator('.kiosk-sheet__pager').getByRole('button', { name: /다음 목록/ });
export const docsPagerPrevious = (page: Page): Locator => page.locator('.kiosk-sheet__pager').getByRole('button', { name: /이전 목록/ });
export const docsPagerStatus = (page: Page): Locator => page.locator('.kiosk-sheet__pager .kiosk-pager__status');

/** 화면에 보이는 서류 줄의 키(DOM 순서). */
export async function visibleDocKeys(page: Page): Promise<string[]> {
  return docLines(page).evaluateAll((items) => items.map((item) => item.getAttribute('data-doc-line') ?? ''));
}

/** 서류 줄의 (키, 필요 여부, 사유 글) — 쪽을 넘겨도 줄이 빠지거나 반복되지 않는지·체크와 사유가 유지되는지 본다. */
export async function visibleDocs(page: Page): Promise<Array<{ key: string; required: boolean; reasons: string[] }>> {
  return docLines(page).evaluateAll((items) =>
    items.map((item) => ({
      key: item.getAttribute('data-doc-line') ?? '',
      required: item.getAttribute('data-required') === 'true',
      reasons: Array.from(item.querySelectorAll('.kiosk-doc__reason')).map((reason) => reason.textContent ?? ''),
    })),
  );
}

/** 입력을 채우고 계산해 결과 화면까지 간다(치료 넷). `response` 가 결과 종류를 정한다. */
export async function reachResult(page: Page, api: ApiMock, response: EstimateResponseDto, cause: Cause = 'INJURY'): Promise<void> {
  await toK03(page, CAUSE_LABEL[cause]);
  for (const name of FOUR_TREATMENTS) await selectTreatment(page, name);
  await submitEstimate(page, api, reply(200, response));
  await expect(resultRoot(page)).toBeVisible();
}

export async function openBasis(page: Page): Promise<void> {
  await actionsOf(page).filter({ hasText: '계산 근거 보기' }).click();
  await expect(basisSheet(page)).toBeVisible();
}

export async function openDocuments(page: Page, expected: 'documents' | 'documents-unknown'): Promise<void> {
  await actionsOf(page).filter({ hasText: '보험 청구에 필요한 서류 확인' }).click();
  await expect(page.locator(`[data-sheet="${expected}"]`)).toBeVisible();
}

// ───────────── 서류 시험 자료 ─────────────

/** 상해 전용 둘·질병 전용 셋(AC-007h)과 긴 사유·여러 사유가 있는 원인 모름 서류: 한 화면에 들어가기 가장 어려운 구성이다. */
export function wideUnknownDocuments(): DocumentsResult {
  const long = (text: string): string => `${text} 보험사와 상품에 따라 제출 방법과 시기가 다를 수 있어 접수 창구에서 한 번 더 확인해 주세요.`;
  const injuryOnly: DocumentLine[] = [docLine('INITIAL_EXAM_RECORD', true, [long('다친 경위와 최초 진료 내용을 확인합니다.')], 'INJURY_ONLY'), docLine('ADMISSION_DISCHARGE_CONFIRMATION', true, ['입원 여부를 확인합니다.'], 'INJURY_ONLY')];
  const illnessOnly: DocumentLine[] = [
    docLine('DIAGNOSIS_CERT', true, [long('병명과 치료 내용을 확인합니다.')], 'ILLNESS_ONLY'),
    docLine('MEDICAL_OPINION', true, ['소견이 필요한 치료가 있습니다.'], 'ILLNESS_ONLY'),
    docLine('BIOPSY_RESULT', true, ['조직검사 결과를 확인합니다.', '검사 날짜가 보이는 서류를 받아 주세요.'], 'ILLNESS_ONLY'),
  ];
  const common: DocumentLine[] = [
    docLine('RECEIPT_AND_ITEMIZED', true, ['반드시 함께 제출합니다. 결제 사실과 항목별 금액을 확인합니다.', long('상해일 때와 질병일 때 모두 같은 서류가 필요합니다.')], 'COMMON'),
    docLine('OUTPATIENT_CONFIRMATION', true, ['통원 치료 기준 · 진료받은 날짜를 확인합니다.'], 'COMMON'),
    docLine('IMAGING_READING', true, [long('영상 검사가 있어 필요합니다.')], 'COMMON'),
    docLine('TREATMENT_CONFIRMATION', false, undefined, 'COMMON'),
  ];
  return unknownCauseDocuments({ common, injuryOnly, illnessOnly });
}

/** 응답의 서류만 바꾼 정상 결과 응답. */
export const normalWith = (documents: DocumentsResult | null, origin: 'OPERATING' | 'TEST_FIXTURE' = 'TEST_FIXTURE'): EstimateResponseDto => estimatedResponse({ documents, origin });
export const notCoveredWith = (documents: DocumentsResult | null): EstimateResponseDto => notCoveredResponse({ documents });
export { docLine, singleCauseDocuments, unknownCauseDocuments };

// ───────────── 화면 목록 (레이아웃 감사·사진 목록) ─────────────

export const SHEET_SCREENS = [
  'K04_Basis_Calculation',
  'K04_Basis_Calculation_NotCovered',
  'K07_Documents',
  'K07_Documents_Unknown',
  'K07_Documents_Unknown_Wide',
  'K07_Documents_RulesUnavailable',
  'K06_Complete',
] as const;
export type SheetScreenName = (typeof SHEET_SCREENS)[number];

/** 이름이 가리키는 화면까지 간다. 화면 방향·큰 글자 보기는 호출하는 시험이 정한다. */
export async function reachSheetScreen(page: Page, api: ApiMock, screen: SheetScreenName): Promise<void> {
  switch (screen) {
    case 'K04_Basis_Calculation':
      await reachResult(page, api, estimatedResponse());
      await openBasis(page);
      return;
    case 'K04_Basis_Calculation_NotCovered':
      await reachResult(page, api, notCoveredResponse({ reason: '약관에서 보장하지 않는 치료입니다' }));
      await openBasis(page);
      return;
    case 'K07_Documents':
      await reachResult(page, api, normalWith(singleCauseDocuments()));
      await openDocuments(page, 'documents');
      return;
    case 'K07_Documents_Unknown':
      await reachResult(page, api, normalWith(unknownCauseDocuments()), 'UNKNOWN');
      await openDocuments(page, 'documents-unknown');
      return;
    case 'K07_Documents_Unknown_Wide':
      await reachResult(page, api, normalWith(wideUnknownDocuments()), 'UNKNOWN');
      await openDocuments(page, 'documents-unknown');
      return;
    case 'K07_Documents_RulesUnavailable':
      await reachResult(page, api, normalWith({ state: 'RULES_UNAVAILABLE' }));
      await openDocuments(page, 'documents');
      return;
    case 'K06_Complete':
      await reachResult(page, api, estimatedResponse());
      await actionsOf(page).filter({ hasText: '이용 완료' }).click();
      await expect(completeScreen(page)).toBeVisible();
      return;
  }
}
