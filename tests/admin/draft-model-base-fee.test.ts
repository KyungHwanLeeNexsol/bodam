import { describe, expect, it } from 'vitest';
import type { BaseFeeRow, DraftView, TreatmentRow } from '../../src/app/admin/api-types';
import { baseFeeViews, bodyOfDraft, draftBodyOf, isEmptyBody, previewSelection, restoreWorking, sameBody, summaryOf, toggleHidden } from '../../src/app/admin/draft-model';

// 관리자 화면의 공통 기본비용 금액 수정 계산 (화면 코드 밖의 순수 함수). 시험 자료(TEST_FIXTURE)만 쓴다.
// 서버가 정한 규칙(현재 금액과 같은 수정은 변경이 아니다, 본문은 치료·기본비용·구조 편집을 함께 담는다)을 화면이 같은 모양으로 따르는지 본다.

const ROWS: TreatmentRow[] = [
  { treatmentId: 'T1', displayName: '이름 T1', description: '', benefitType: 'BENEFIT', treatmentCode: 'C1', procedureCodes: [], patientAmount: 10_000, priceCondition: '', order: 1 },
  { treatmentId: 'T2', displayName: '이름 T2', description: '', benefitType: 'BENEFIT', treatmentCode: 'C2', procedureCodes: [], patientAmount: 10_000, priceCondition: '', order: 2 },
];
const FEES: BaseFeeRow[] = [
  { baseFeeId: 'FEE_B', displayName: '기본 진찰료 B', benefitType: 'BENEFIT', amount: 3_000 },
  { baseFeeId: 'FEE_A', displayName: '기본 진찰료 A', benefitType: 'NON_BENEFIT', amount: 5_000 },
];

const draftOf = (overrides: Partial<DraftView> = {}): DraftView => ({
  baseCatalogVersionId: 'V1',
  priceEdits: [],
  baseFeeEdits: [],
  additions: [],
  deactivations: [],
  order: null,
  updatedAt: '2026-11-01T00:00:00.000Z',
  updatedBy: 'TEST_FIXTURE_HA',
  draftDigest: 'd'.repeat(64),
  stale: false,
  ...overrides,
});

const fresh = () => restoreWorking(ROWS, null, FEES);

describe('restoreWorking: 기본비용 금액', () => {
  it('초안이 없으면 게시된 금액 그대로이고 바뀐 것이 없다', () => {
    const working = fresh();
    expect(working.baseFeeTexts).toEqual({ FEE_B: '3000', FEE_A: '5000' });
    expect(isEmptyBody(draftBodyOf(working, ROWS, FEES).body)).toBe(true);
  });

  it('저장된 초안의 기본비용 수정을 채운다 (수정이 없는 기본비용은 게시된 금액)', () => {
    const working = restoreWorking(ROWS, draftOf({ baseFeeEdits: [{ baseFeeId: 'FEE_A', amount: 6_000 }] }), FEES);
    expect(working.baseFeeTexts).toEqual({ FEE_B: '3000', FEE_A: '6000' });
  });

  it('기본비용 목록을 넘기지 않으면 기본비용 글자는 비어 있다 (기본비용이 없는 병원)', () => {
    expect(restoreWorking(ROWS, null).baseFeeTexts).toEqual({});
    expect(draftBodyOf(restoreWorking(ROWS, null), ROWS).body.baseFeeEdits).toEqual([]);
  });
});

describe('draftBodyOf: 기본비용 수정이 PUT 본문에 함께 실린다', () => {
  it('현재 금액과 같은 금액은 수정이 아니다. 바뀐 금액은 baseFeeId 코드 포인트 순으로 나간다', () => {
    const working = { ...fresh(), baseFeeTexts: { FEE_B: '3500', FEE_A: '5000' } };
    expect(draftBodyOf(working, ROWS, FEES).body.baseFeeEdits).toEqual([{ baseFeeId: 'FEE_B', amount: 3_500 }]);
    const both = { ...fresh(), baseFeeTexts: { FEE_B: '3500', FEE_A: '5001' } };
    expect(draftBodyOf(both, ROWS, FEES).body.baseFeeEdits).toEqual([
      { baseFeeId: 'FEE_A', amount: 5_001 },
      { baseFeeId: 'FEE_B', amount: 3_500 },
    ]);
  });

  it('금액 글자가 음수·소수·문자·빈 칸이면 invalid 이고 수정으로 나가지 않는다 (서버는 그 위에서 다시 검사한다)', () => {
    for (const text of ['-1', '1.5', 'abc', '', ' ', '1e3']) {
      const result = draftBodyOf({ ...fresh(), baseFeeTexts: { FEE_B: text, FEE_A: '5000' } }, ROWS, FEES);
      expect(result.invalid, JSON.stringify(text)).toBe(true);
      expect(result.body.baseFeeEdits, JSON.stringify(text)).toEqual([]);
    }
  });

  it('치료 가격 수정·숨김과 기본비용 수정이 한 본문에 함께 담긴다 (기본비용 수정이 치료 수정을 지우지 않는다)', () => {
    const working = toggleHidden({ ...fresh(), priceTexts: { T1: '12000', T2: '10000' }, baseFeeTexts: { FEE_B: '3000', FEE_A: '6000' } }, 'T2');
    const { body, invalid } = draftBodyOf(working, ROWS, FEES);
    expect(invalid).toBe(false);
    expect(body).toMatchObject({
      priceEdits: [{ treatmentId: 'T1', patientAmount: 12_000 }],
      baseFeeEdits: [{ baseFeeId: 'FEE_A', amount: 6_000 }],
      deactivations: ['T2'],
    });
    expect(isEmptyBody(body)).toBe(false);
    // 기본비용만 바뀌어도 빈 본문이 아니다.
    expect(isEmptyBody(draftBodyOf({ ...fresh(), baseFeeTexts: { FEE_B: '3001', FEE_A: '5000' } }, ROWS, FEES).body)).toBe(false);
  });
});

describe('저장된 초안과 구조 비교', () => {
  it('저장 직후의 서버 초안과 화면 본문이 같으면 같은 본문이고, 기본비용 금액이 다르면 다르다', () => {
    const working = { ...fresh(), baseFeeTexts: { FEE_B: '3000', FEE_A: '6000' } };
    const { body } = draftBodyOf(working, ROWS, FEES);
    const saved = draftOf({ baseFeeEdits: [{ baseFeeId: 'FEE_A', amount: 6_000 }] });
    expect(sameBody(body, bodyOfDraft(saved))).toBe(true);
    expect(sameBody(body, bodyOfDraft(draftOf({ baseFeeEdits: [{ baseFeeId: 'FEE_A', amount: 6_001 }] })))).toBe(false);
    expect(sameBody(body, bodyOfDraft(draftOf()))).toBe(false);
  });

  it('기본비용 수정의 나열 순서가 달라도 같은 본문이다', () => {
    const left = draftOf({ baseFeeEdits: [{ baseFeeId: 'FEE_B', amount: 1 }, { baseFeeId: 'FEE_A', amount: 2 }] });
    const right = draftOf({ baseFeeEdits: [{ baseFeeId: 'FEE_A', amount: 2 }, { baseFeeId: 'FEE_B', amount: 1 }] });
    expect(sameBody(bodyOfDraft(left), bodyOfDraft(right))).toBe(true);
  });
});

describe('baseFeeViews · summaryOf · previewSelection', () => {
  it('줄 보기: 바뀐 줄·잘못된 입력 줄을 가린다', () => {
    const views = baseFeeViews({ ...fresh(), baseFeeTexts: { FEE_B: '3500', FEE_A: 'x' } }, FEES);
    expect(views.map((view) => [view.baseFeeId, view.amountChanged, view.amountInvalid, view.currentAmount])).toEqual([
      ['FEE_B', true, false, 3_000],
      ['FEE_A', false, true, 5_000],
    ]);
  });

  it('요약은 기본비용 변경 건수를 센다', () => {
    const { body } = draftBodyOf({ ...fresh(), baseFeeTexts: { FEE_B: '3500', FEE_A: '6000' } }, ROWS, FEES);
    expect(summaryOf(body)).toEqual({ priceChanged: 0, baseFeeChanged: 2, added: 0, hidden: 0, reordered: false });
  });

  it('기본비용만 바꾼 저장된 초안은 치료를 하나 골라야 한다 (needsTreatment). 고르면 풀리고, 가격을 바꾼 치료가 있으면 이미 포함된다', () => {
    const feeOnly = draftOf({ baseFeeEdits: [{ baseFeeId: 'FEE_A', amount: 6_000 }] });
    expect(previewSelection(ROWS, feeOnly, {})).toMatchObject({ treatmentIds: [], needsTreatment: true });
    expect(previewSelection(ROWS, feeOnly, { T2: true })).toMatchObject({ treatmentIds: ['T2'], needsTreatment: false });
    const withPrice = draftOf({ baseFeeEdits: [{ baseFeeId: 'FEE_A', amount: 6_000 }], priceEdits: [{ treatmentId: 'T1', patientAmount: 12_000 }] });
    expect(previewSelection(ROWS, withPrice, {})).toMatchObject({ treatmentIds: ['T1'], needsTreatment: false });
    // 기본비용 수정이 없으면 계산할 치료가 없어도 된다(목록 미리보기).
    expect(previewSelection(ROWS, draftOf({ deactivations: ['T2'] }), {})).toMatchObject({ treatmentIds: [], needsTreatment: false });
    expect(previewSelection(ROWS, null, {})).toMatchObject({ needsTreatment: false });
  });

  it('숨길 치료만 남은 선택으로는 풀리지 않는다 (숨길 치료는 고를 수 없다)', () => {
    const draft = draftOf({ baseFeeEdits: [{ baseFeeId: 'FEE_A', amount: 6_000 }], deactivations: ['T1'] });
    const selection = previewSelection(ROWS, draft, { T1: true });
    expect(selection.offered.map((row) => row.treatmentId)).toEqual(['T2']);
    expect(selection).toMatchObject({ treatmentIds: [], needsTreatment: true });
  });
});
