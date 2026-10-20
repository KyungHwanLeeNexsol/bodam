import { describe, expect, it } from 'vitest';
import type { KioskEvent } from '../../../src/app/kiosk/state/events';
import { reduce } from '../../../src/app/kiosk/state/machine';
import { canGoNext, canRequestEstimate, selectTotals, selectTreatmentPage } from '../../../src/app/kiosk/state/selectors';
import type { KioskState } from '../../../src/app/kiosk/state/session-store';
import { FOUR_TREATMENTS, T_FIFTH, T_SIXTH, T_XRAY, makeCatalog } from '../../fixtures/kiosk/clinic.fixture';
import { FULL_INPUTS, makeEnv, stateAt } from '../../fixtures/kiosk/state.fixture';

// 선택자의 가장자리와 쪽 이동의 정렬. 기본 동작은 display-and-selectors.test.ts 가 본다.

const send = (state: KioskState, event: KioskEvent): KioskState => reduce(state, event, makeEnv(10_000));
const k03 = (patch: Partial<KioskState> = {}): KioskState => stateAt('K03_Treatments', { inputs: { ...FULL_INPUTS, treatmentIds: [T_XRAY] }, ...patch });

describe('selectTotals: 합산이 안전한 범위를 넘으면 조용히 틀린 숫자를 내지 않고 예외를 던진다', () => {
  it('엔진의 검사 덧셈이 거절하는 금액(카탈로그 계약 위반)이면 RangeError', () => {
    const huge = { ...FOUR_TREATMENTS[0]!, patientAmount: Number.MAX_SAFE_INTEGER };
    const catalog = makeCatalog({ treatments: [huge, { ...huge, treatmentId: 'TEST_FIXTURE_TREATMENT_HUGE_2' }] });
    const state = stateAt('K03_Treatments', { inputs: { ...FULL_INPUTS, treatmentIds: [huge.treatmentId, 'TEST_FIXTURE_TREATMENT_HUGE_2'] } }, { catalog });
    expect(() => selectTotals(state)).toThrow(RangeError);
  });
});

describe('canRequestEstimate / canGoNext 는 해당 화면에서만 참이다', () => {
  it('치료를 골랐어도 4단계가 아닌 화면에서는 "예상 부담액 확인"이 없다', () => {
    expect(canRequestEstimate(stateAt('K02b_Cause', { inputs: FULL_INPUTS }))).toBe(false);
    expect(canRequestEstimate(stateAt('K04_Result', { inputs: FULL_INPUTS }))).toBe(false);
  });

  it('"다음"은 단계가 없는 화면에서 거짓이다', () => {
    expect(canGoNext(stateAt('K00_Start', { inputs: FULL_INPUTS }))).toBe(false);
    expect(canGoNext(stateAt('Calculating', { inputs: FULL_INPUTS }))).toBe(false);
  });
});

describe('치료 목록의 쪽 이동은 쪽 경계에 맞춘다', () => {
  it('큰 글자를 켰다 끈 뒤 쪽 경계에서 벗어난 위치(2)에서도 "다음 목록"은 다음 쪽의 첫 치료(4)로 간다', () => {
    const state = k03({ treatmentPageOffset: 2 });
    expect(selectTreatmentPage(state).pageIndex).toBe(0);
    const next = send(state, { type: 'TREATMENTS_NEXT_PAGE' });
    expect(next.treatmentPageOffset).toBe(4);
    expect(selectTreatmentPage(next).items.map((item) => item.treatment.treatmentId)).toEqual([T_FIFTH, T_SIXTH]);
  });

  it('범위를 벗어난 위치(400)에서 "이전 목록"은 마지막 쪽의 앞 쪽(0)으로 간다', () => {
    const prev = send(k03({ treatmentPageOffset: 400 }), { type: 'TREATMENTS_PREV_PAGE' });
    expect(prev.treatmentPageOffset).toBe(0);
  });

  it('쪽을 넘겨도 선택한 치료는 그대로고 목록은 카탈로그 순서다', () => {
    const state = k03();
    const next = send(state, { type: 'TREATMENTS_NEXT_PAGE' });
    expect(next.inputs).toBe(state.inputs);
    expect(selectTreatmentPage(state).items.map((item) => item.treatment.order)).toEqual([1, 2, 3, 4]);
  });

  it('4단계가 아닌 화면에서는 쪽 이동을 거절한다 (목록이 없다)', () => {
    const state = stateAt('K02b_Cause');
    expect(send(state, { type: 'TREATMENTS_NEXT_PAGE' })).toBe(state);
    expect(send(state, { type: 'TREATMENTS_PREV_PAGE' })).toBe(state);
  });
});
