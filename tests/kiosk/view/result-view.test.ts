import { describe, expect, it } from 'vitest';
import { buildResultView } from '../../../src/app/kiosk/view/result-view';
import { selectTotals } from '../../../src/app/kiosk/state/selectors';
import { FOUR_TREATMENTS, T_KIDNEY_SPRAY, T_PHYSIO, T_ULTRASOUND, T_XRAY, makeCatalog } from '../../fixtures/kiosk/clinic.fixture';
import { estimatedResponse, holdResponse, notCoveredResponse, resultStateWith } from '../../fixtures/kiosk/estimate.fixture';

// 결과 화면의 읽기 전용 값 (SPEC-REIMBURSEMENT-001 M6 S3a, DD-07·DD-21·DD-22, AC-013a·b·c, AC-010e, AC-019c).
// 금액은 응답(state.derived.estimate.response)에서만 나오고 보험 계산은 없다. 값이 없는 금액(null)은 "확인 필요"이고 어떤 경우에도 0원이 되지 않는다.

const stateFor = (response = estimatedResponse(), patch = {}) => resultStateWith(response, patch);

describe('정상 결과 (ESTIMATED, AC-013a)', () => {
  const view = buildResultView(stateFor(), 'NORMAL');

  it('세 금액은 응답의 값 그대로이고 이름이 구분된다: 예상 병원 결제액 / 예상 보험금 / 보험금 수령 후 예상 본인 부담', () => {
    expect(view).not.toBeNull();
    expect(view?.hospital).toMatchObject({ label: '예상 병원 결제액', text: '124,000원', known: true });
    expect(view?.payout).toMatchObject({ label: '예상 보험금', text: '114,000원', known: true });
    expect(view?.afterPayout).toMatchObject({ label: '보험금 수령 후 예상 본인 부담', text: '10,000원', known: true });
  });

  it('고정 문장: 병원 결제액·보험금·수령 후 부담의 보조 설명 (수령 후 부담은 오늘 결제액이 아니다)', () => {
    expect(view?.hospital.note).toBe('오늘 병원 창구에서 결제하는 금액입니다.');
    expect(view?.payout.note).toBe('보험사에 청구한 뒤 받는 예상 금액입니다.');
    expect(view?.afterPayout.note).toBe('보험금을 받은 뒤 남는 예상 부담액이며, 오늘 병원에 결제할 금액이 아닙니다.');
  });

  it('병원 결제액의 급여·비급여 내역은 선택 요약(selectTotals)의 값이고 합이 응답의 병원 결제액과 같을 때만 보인다 (AC-019c)', () => {
    const state = stateFor();
    const totals = selectTotals(state);
    expect(totals.total).toBe(124_000);
    expect(view?.hospital.split).toBe('급여 14,000원 + 비급여 110,000원');
    // 응답의 병원 결제액이 선택 요약과 다르면(자료가 어긋난 경우) 내역을 보이지 않는다: 합이 맞지 않는 숫자를 나란히 놓지 않는다.
    const other = estimatedResponse();
    const mismatched = buildResultView(stateFor({ ...other, result: { ...other.result, amounts: { ...other.result.amounts, hospitalPayment: 125_000 } } }), 'NORMAL');
    expect(mismatched?.hospital.text).toBe('125,000원');
    expect(mismatched?.hospital.split).toBeNull();
  });

  it('보험 조건·선택한 치료: 세대·보험사 형태는 options 응답의 label, 치료는 카탈로그 순서의 이름이다', () => {
    expect(view?.insuranceLabel).toBe('2세대(C1) · 손해보험사');
    expect(view?.treatmentNames).toEqual(FOUR_TREATMENTS.map((entry) => entry.displayName));
    expect(view?.treatmentSummary).toBe(`${FOUR_TREATMENTS.map((entry) => entry.displayName).join(', ')} (4개)`);
    expect(view?.compactCondition).toBe('2세대(C1) · 손해보험사 · 치료 4개');
  });

  it('동작은 여섯 개이고 순서가 고정이다 (AC-013e)', () => {
    expect(view?.actions).toEqual(['DOCUMENTS', 'BASIS', 'RESELECT', 'EDIT_INSURANCE', 'HOME', 'COMPLETE']);
  });

  it('보장 제외·보류 요소가 없다', () => {
    expect(view?.exclusions).toEqual([]);
    expect(view?.exclusionNotes).toEqual([]);
    expect(view?.holdGroups).toEqual([]);
  });
});

describe('테스트 데이터 표시 (AC-010e)', () => {
  it('origin 이 OPERATING 이 아니면 표시하고(TEST_FIXTURE·DEMO), OPERATING 이면 표시하지 않는다', () => {
    expect(buildResultView(stateFor(estimatedResponse({ origin: 'TEST_FIXTURE' })), 'NORMAL')?.testData).toBe(true);
    expect(buildResultView(stateFor(estimatedResponse({ origin: 'DEMO' })), 'NORMAL')?.testData).toBe(true);
    expect(buildResultView(stateFor(estimatedResponse({ origin: 'OPERATING' })), 'NORMAL')?.testData).toBe(false);
    expect(buildResultView(stateFor(notCoveredResponse({ origin: 'OPERATING' })), 'NOT_COVERED')?.testData).toBe(false);
    expect(buildResultView(stateFor(holdResponse(undefined, { origin: 'DEMO' })), 'HOLD')?.testData).toBe(true);
  });
});

describe('보장 제외 결과 (ESTIMATED_WITH_EXCLUSIONS, AC-013b)', () => {
  const view = buildResultView(stateFor(notCoveredResponse({ reason: '이 치료는 약관에서 보장하지 않습니다' })), 'NOT_COVERED');

  it('124,000 / 74,000 / 50,000 이고 제외 항목은 이름·금액·사유다', () => {
    expect(view?.hospital.text).toBe('124,000원');
    expect(view?.payout.text).toBe('74,000원');
    expect(view?.afterPayout.text).toBe('50,000원');
    expect(view?.exclusions).toEqual([{ name: FOUR_TREATMENTS[2]?.displayName, amount: '40,000원', reason: '이 치료는 약관에서 보장하지 않습니다' }]);
  });

  it('"선택한 치료가 모두 보장 대상" 문장 대신 나머지 항목 기준의 가정 문장이 있다', () => {
    expect(view?.exclusionNotes).toEqual(['나머지 항목은 보장 대상이고 한도가 남아 있다고 가정합니다.']);
    expect(JSON.stringify(view)).not.toContain('모두 보장 대상');
  });

  it('동작은 여섯 개다', () => {
    expect(view?.actions).toHaveLength(6);
  });

  it('제외 항목의 이름은 응답 줄에서 찾고, 줄에도 없으면 카탈로그에서 찾는다', () => {
    const response = notCoveredResponse();
    const noLineNames = { ...response, result: { ...response.result, lines: response.result.lines.filter((entry) => entry.treatmentId !== T_KIDNEY_SPRAY) } };
    expect(buildResultView(stateFor(noLineNames), 'NOT_COVERED')?.exclusions[0]?.name).toBe(FOUR_TREATMENTS[2]?.displayName);
  });
});

describe('보류 결과 (ON_HOLD, AC-013c)', () => {
  const response = holdResponse([
    [T_XRAY, 'MAPPING_ABSENT'],
    [T_ULTRASOUND, 'PROFILE_VALUE_MISSING'],
    [T_KIDNEY_SPRAY, 'CLASSIFICATION_NEEDS_REVIEW'],
    [T_PHYSIO, 'LINE_ORIGIN_NOT_ACCEPTED'],
  ]);
  const view = buildResultView(stateFor(response), 'HOLD');

  it('병원 결제액만 숫자이고 나머지 둘은 "확인 필요"다 — 값이 없는 금액은 0원이 되지 않는다', () => {
    expect(view?.hospital).toMatchObject({ text: '124,000원', known: true });
    expect(view?.payout).toMatchObject({ text: '확인 필요', known: false });
    expect(view?.afterPayout).toMatchObject({ text: '확인 필요', known: false });
    expect(JSON.stringify([view?.payout, view?.afterPayout])).not.toContain('0원');
  });

  it('보류 줄은 환자용 분류로 묶이고(네 분류 모두) 이름만 보인다', () => {
    expect(view?.holdGroups.map((group) => group.phrase)).toEqual([
      '표준 가정 자료가 아직 준비되지 않았습니다',
      '이 치료의 보장 분류를 검토하고 있습니다',
      '이 치료의 분류 확인이 필요합니다',
      '이 치료의 가격 자료 확인이 필요합니다',
    ]);
    expect(view?.holdGroups.map((group) => group.items)).toEqual([[FOUR_TREATMENTS[1]?.displayName], [FOUR_TREATMENTS[0]?.displayName], [FOUR_TREATMENTS[2]?.displayName], [FOUR_TREATMENTS[3]?.displayName]]);
  });

  it('내부 코드·참고 그룹 값·"N"·결과 문구 원칙이 어디에도 없다', () => {
    const serialized = JSON.stringify(view);
    expect(serialized).not.toMatch(/PROFILE_|MAPPING_|LINE_|CLASSIFICATION_|CALC_|RULE_BUNDLE|CLINIC_RULE/);
    expect(serialized).not.toContain('987');
    expect(serialized).not.toContain('referenceGroups');
    expect(serialized).not.toContain('표준 공제·한도 가정으로 계산한 예상 금액입니다');
  });

  it('동작은 정확히 네 개이고 서류 확인·계산 근거가 없다', () => {
    expect(view?.actions).toEqual(['RESELECT', 'EDIT_INSURANCE', 'HOME', 'COMPLETE']);
  });

  it('모르는 새 코드는 첫 분류로 가고 원문이 보이지 않는다', () => {
    const unknown = buildResultView(stateFor(holdResponse([[T_XRAY, 'SOME_NEW_REASON' as never]])), 'HOLD');
    expect(unknown?.holdGroups).toEqual([{ key: 'SETUP', phrase: '표준 가정 자료가 아직 준비되지 않았습니다', items: [FOUR_TREATMENTS[0]?.displayName] }]);
    expect(JSON.stringify(unknown)).not.toContain('SOME_NEW_REASON');
  });
});

describe('보여 줄 수 없는 상태는 null 이다 (0원·빈 결과를 그리지 않는다)', () => {
  it('저장된 응답이 없으면 null', () => {
    const state = stateFor();
    expect(buildResultView({ ...state, derived: { ...state.derived, estimate: { state: 'ESTIMATED' } } }, 'NORMAL')).toBeNull();
    expect(buildResultView({ ...state, derived: { ...state.derived, estimate: null } }, 'NORMAL')).toBeNull();
  });

  it('화면이 기대하는 종류와 응답의 결과 종류가 다르면 null', () => {
    expect(buildResultView(stateFor(estimatedResponse()), 'HOLD')).toBeNull();
    expect(buildResultView(stateFor(holdResponse()), 'NORMAL')).toBeNull();
    expect(buildResultView(stateFor(notCoveredResponse()), 'NORMAL')).toBeNull();
  });

  it('정상 결과인데 금액이 null 로 온 모양(계약 결함)이어도 0원이 아니라 "확인 필요"다', () => {
    const response = estimatedResponse();
    const broken = { ...response, result: { ...response.result, amounts: { ...response.result.amounts, expectedInsurancePayout: null } } };
    const view = buildResultView(stateFor(broken), 'NORMAL');
    expect(view?.payout).toMatchObject({ text: '확인 필요', known: false });
  });
});

describe('보험 조건 표시: options 응답에 없는 값은 코드를 보이지 않는다', () => {
  it('세대 label 을 찾지 못하면 그 부분은 빠진다', () => {
    const state = stateFor();
    const stripped = { ...state, clinic: { ...state.clinic, options: { ...state.clinic.options, generations: [] } } };
    const view = buildResultView(stripped, 'NORMAL');
    expect(view?.insuranceLabel).toBe('손해보험사');
    expect(JSON.stringify(view)).not.toMatch(/GEN\d|NON_LIFE/);
  });

  it('치료가 카탈로그에서 사라졌어도 (선택은 응답 기준) 이름을 응답 줄에서 쓴다', () => {
    const state = stateFor(estimatedResponse(), {});
    const emptyCatalog = { ...state, clinic: { ...state.clinic, catalog: makeCatalog({ treatments: [] }) } };
    expect(buildResultView(emptyCatalog, 'NORMAL')?.treatmentNames).toEqual(FOUR_TREATMENTS.map((entry) => entry.displayName));
  });
});

describe('읽을 수 없는 응답 칸은 빈 목록·"확인 필요"로 처리한다 (화면이 깨지거나 0원을 그리지 않는다)', () => {
  const broken = (patch: Record<string, unknown>) => {
    const response = estimatedResponse();
    return { ...response, result: { ...response.result, ...patch } } as unknown as ReturnType<typeof estimatedResponse>;
  };

  it('줄·보류 사유·제외 항목·가정 목록이 배열이 아니어도 빈 목록으로 읽는다', () => {
    const view = buildResultView(stateFor(broken({ lines: null, holdReasons: undefined, excludedItems: 'x', assumptions: {} })), 'NORMAL');
    expect(view?.exclusions).toEqual([]);
    expect(view?.exclusionNotes).toEqual([]);
    expect(view?.holdGroups).toEqual([]);
  });

  it('보장 제외 항목의 금액이 읽을 수 없는 값이면 금액 자리는 "확인 필요"이고, 이름이 어디에도 없으면 구역 이름으로 대신한다', () => {
    const response = notCoveredResponse();
    const patched = { ...response, result: { ...response.result, lines: [], excludedItems: [{ treatmentId: 'UNKNOWN_ID', amount: -5, reason: '사유', payout: 0 }], assumptions: ['REMAINING_COVERED_AND_LIMIT_REMAINS', 'REMAINING_LIMIT_ASSUMED'] } } as unknown as ReturnType<typeof notCoveredResponse>;
    const state = stateFor(patched);
    const view = buildResultView({ ...state, clinic: { ...state.clinic, catalog: makeCatalog({ treatments: [] }) } }, 'NOT_COVERED');
    expect(view?.exclusions).toEqual([{ name: '보장 제외 항목', amount: '확인 필요', reason: '사유' }]);
    // 가정 코드 둘이 모두 문장이 된다: 나머지 항목 기준 + 한도·횟수.
    expect(view?.exclusionNotes).toEqual(['나머지 항목은 보장 대상이고 한도가 남아 있다고 가정합니다.', '한도·횟수가 남아 있다고 가정합니다.']);
  });

  it('병원 결제액이 읽을 수 없는 값이면 "확인 필요"이고 급여·비급여 내역은 없다', () => {
    const response = estimatedResponse();
    const patched = { ...response, result: { ...response.result, amounts: { ...response.result.amounts, hospitalPayment: 'abc' } } } as unknown as ReturnType<typeof estimatedResponse>;
    const view = buildResultView(stateFor(patched), 'NORMAL');
    expect(view?.hospital).toMatchObject({ text: '확인 필요', known: false, split: null });
  });

  it('급여만 선택하면 비급여 줄은 적지 않고, 선택이 하나도 없으면(계약 밖) 내역이 없다', () => {
    const state = stateFor();
    const onlyBenefit = { ...state, inputs: { ...state.inputs, treatmentIds: [T_XRAY, T_ULTRASOUND] } };
    const response = estimatedResponse();
    const patched = { ...response, result: { ...response.result, amounts: { ...response.result.amounts, hospitalPayment: 14_000 } } };
    expect(buildResultView({ ...onlyBenefit, derived: { ...onlyBenefit.derived, estimate: { state: 'ESTIMATED', response: patched } } }, 'NORMAL')?.hospital.split).toBe('급여 14,000원');
    const none = { ...state, inputs: { ...state.inputs, treatmentIds: [] } };
    expect(buildResultView(none, 'NORMAL')?.hospital.split).toBeNull();
  });

  it('비급여만 선택하면 급여 줄은 적지 않는다', () => {
    const state = stateFor();
    const onlyNonBenefit = { ...state, inputs: { ...state.inputs, treatmentIds: [T_KIDNEY_SPRAY, T_PHYSIO] } };
    const response = estimatedResponse();
    const patched = { ...response, result: { ...response.result, amounts: { ...response.result.amounts, hospitalPayment: 110_000 } } };
    expect(buildResultView({ ...onlyNonBenefit, derived: { ...onlyNonBenefit.derived, estimate: { state: 'ESTIMATED', response: patched } } }, 'NORMAL')?.hospital.split).toBe('비급여 110,000원');
  });

  it('보험 조건 label 이 둘 다 없으면 한 줄 요약은 치료 수만 남는다', () => {
    const state = stateFor();
    const stripped = { ...state, clinic: { ...state.clinic, options: { ...state.clinic.options, generations: [], insurerTypes: [] } } };
    const view = buildResultView(stripped, 'NORMAL');
    expect(view?.insuranceLabel).toBeNull();
    expect(view?.compactCondition).toBe('치료 4개');
  });
});
