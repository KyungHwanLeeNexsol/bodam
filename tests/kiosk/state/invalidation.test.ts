import { describe, expect, it } from 'vitest';
import type { KioskEvent } from '../../../src/app/kiosk/state/events';
import { reduce } from '../../../src/app/kiosk/state/machine';
import { applyInputs, hasPatientInput } from '../../../src/app/kiosk/state/session-store';
import type { DerivedData, KioskState, PatientInputs } from '../../../src/app/kiosk/state/session-store';
import { T_FIFTH, T_KIDNEY_SPRAY, T_SIXTH, T_ULTRASOUND, T_XRAY } from '../../fixtures/kiosk/clinic.fixture';
import { EMPTY_PATIENT_INPUTS, FULL_INPUTS, makeEnv, resultSessionAt, sequenceIds } from '../../fixtures/kiosk/state.fixture';

// DD-08 "입력 변경과 파생 데이터 무효화" 표의 행을 한 줄씩 시험한다. 닫는 AC: AC-014a, AC-014b, AC-014d. 증거: AC-014e(복귀 정보).
// 열 이름은 표와 같다: 세대·형태·원인·치료·파생 데이터·ReturnContext·큰 글자·무조작 시간.

const NOW = 9_000;
const BEFORE = 1_000;
// 새 세션 식별자는 시험 자료가 만든 SESSION-n 과 겹치지 않는 NEW-n 이다(겹치면 "새 sessionId" 대조가 헛돈다).
const ENV = makeEnv(NOW, sequenceIds('NEW'));
const RETURN_CONTEXT = { resultVariant: 'NOT_COVERED' } as const;
const FILLED: DerivedData = { estimate: { state: 'ESTIMATED_WITH_EXCLUSIONS' }, documents: { marker: 'DOCUMENTS' }, basis: { marker: 'BASIS' }, returnContext: RETURN_CONTEXT };
const CLEARED: DerivedData = { estimate: null, documents: null, basis: null, returnContext: null };

/** 파생 데이터가 모두 차 있고 큰 글자가 켜져 있으며 마지막 조작이 BEFORE 인 세션. */
function filled(screen: KioskState['screen'], inputs: PatientInputs = FULL_INPUTS): KioskState {
  return resultSessionAt(screen, { inputs, derived: FILLED, display: { largeText: true, orientation: 'PORTRAIT' }, lastInteractionAt: BEFORE, inputRevision: 4 });
}

const send = (state: KioskState, event: KioskEvent): KioskState => reduce(state, event, ENV);

/** 복귀 정보만 비운 세션: 근거·서류 진입이 복귀 정보를 새로 기록하는지 보려는 것이다. */
function withoutReturnContext(state: KioskState): KioskState {
  return { ...state, derived: { ...state.derived, returnContext: null } };
}

interface Row {
  name: string;
  state: KioskState;
  event: KioskEvent;
  /** 입력값 열: 기대하는 입력. */
  inputs: PatientInputs;
  /** 파생 데이터·ReturnContext 열. */
  derived: 'KEEP' | 'CLEAR';
  /** ReturnContext 열이 파생 데이터와 따로 갖는 기대값(없으면 파생 데이터 열을 따른다). */
  returnContext?: KioskState['derived']['returnContext'];
  revisionDelta: 0 | 1;
  largeText: boolean;
  /** 무조작 시간 열: 다시 시작(NOW) 또는 그대로(BEFORE). */
  clock: 'RESTART' | 'KEEP';
}

const ROWS: Row[] = [
  { name: '세대를 다른 값으로', state: filled('K01_Generation'), event: { type: 'SELECT_GENERATION', code: 'GEN4_C4' }, inputs: { ...FULL_INPUTS, generation: 'GEN4_C4' }, derived: 'CLEAR', revisionDelta: 1, largeText: true, clock: 'RESTART' },
  { name: '형태를 다른 값으로', state: filled('K02_Type'), event: { type: 'SELECT_INSURER_TYPE', code: 'MUTUAL_AID' }, inputs: { ...FULL_INPUTS, insurerType: 'MUTUAL_AID' }, derived: 'CLEAR', revisionDelta: 1, largeText: true, clock: 'RESTART' },
  { name: '원인을 다른 값으로', state: filled('K02b_Cause'), event: { type: 'SELECT_CAUSE', code: 'ILLNESS' }, inputs: { ...FULL_INPUTS, cause: 'ILLNESS' }, derived: 'CLEAR', revisionDelta: 1, largeText: true, clock: 'RESTART' },
  { name: '치료 추가', state: filled('K03_Treatments'), event: { type: 'TOGGLE_TREATMENT', treatmentId: T_ULTRASOUND }, inputs: { ...FULL_INPUTS, treatmentIds: [T_XRAY, T_KIDNEY_SPRAY, T_ULTRASOUND] }, derived: 'CLEAR', revisionDelta: 1, largeText: true, clock: 'RESTART' },
  { name: '치료 해제', state: filled('K03_Treatments'), event: { type: 'TOGGLE_TREATMENT', treatmentId: T_XRAY }, inputs: { ...FULL_INPUTS, treatmentIds: [T_KIDNEY_SPRAY] }, derived: 'CLEAR', revisionDelta: 1, largeText: true, clock: 'RESTART' },
  { name: '같은 값 다시 선택 (세대)', state: filled('K01_Generation'), event: { type: 'SELECT_GENERATION', code: 'GEN2_C1' }, inputs: FULL_INPUTS, derived: 'KEEP', revisionDelta: 0, largeText: true, clock: 'RESTART' },
  { name: '같은 값 다시 선택 (형태)', state: filled('K02_Type'), event: { type: 'SELECT_INSURER_TYPE', code: 'NON_LIFE' }, inputs: FULL_INPUTS, derived: 'KEEP', revisionDelta: 0, largeText: true, clock: 'RESTART' },
  { name: '같은 값 다시 선택 (원인)', state: filled('K02b_Cause'), event: { type: 'SELECT_CAUSE', code: 'INJURY' }, inputs: FULL_INPUTS, derived: 'KEEP', revisionDelta: 0, largeText: true, clock: 'RESTART' },
  { name: '목록 페이지 이동', state: filled('K03_Treatments'), event: { type: 'TREATMENTS_NEXT_PAGE' }, inputs: FULL_INPUTS, derived: 'KEEP', revisionDelta: 0, largeText: true, clock: 'RESTART' },
  { name: '이전 (입력 단계 이동)', state: filled('K03_Treatments'), event: { type: 'PREV' }, inputs: FULL_INPUTS, derived: 'KEEP', revisionDelta: 0, largeText: true, clock: 'RESTART' },
  { name: '다음 (입력 단계 이동)', state: filled('K01_Generation'), event: { type: 'NEXT' }, inputs: FULL_INPUTS, derived: 'KEEP', revisionDelta: 0, largeText: true, clock: 'RESTART' },
  { name: '큰 글자 전환', state: filled('K04_Result_NotCovered'), event: { type: 'TOGGLE_LARGE_TEXT' }, inputs: FULL_INPUTS, derived: 'KEEP', revisionDelta: 0, largeText: false, clock: 'RESTART' },
  { name: '화면 방향 변경', state: filled('K04_Result_NotCovered'), event: { type: 'ORIENTATION_CHANGED', orientation: 'LANDSCAPE' }, inputs: FULL_INPUTS, derived: 'KEEP', revisionDelta: 0, largeText: true, clock: 'KEEP' },
  { name: '계산 근거 진입', state: withoutReturnContext(filled('K04_Result_NotCovered')), event: { type: 'OPEN_BASIS' }, inputs: FULL_INPUTS, derived: 'KEEP', returnContext: RETURN_CONTEXT, revisionDelta: 0, largeText: true, clock: 'RESTART' },
  { name: '필요 서류 진입', state: withoutReturnContext(filled('K04_Result_NotCovered')), event: { type: 'OPEN_DOCUMENTS' }, inputs: FULL_INPUTS, derived: 'KEEP', returnContext: RETURN_CONTEXT, revisionDelta: 0, largeText: true, clock: 'RESTART' },
  { name: '결과로 돌아가기', state: filled('K07_Documents'), event: { type: 'RETURN_TO_RESULT' }, inputs: FULL_INPUTS, derived: 'KEEP', returnContext: RETURN_CONTEXT, revisionDelta: 0, largeText: true, clock: 'RESTART' },
];

describe('DD-08 표의 행', () => {
  it.each(ROWS)('$name', (row) => {
    const next = send(row.state, row.event);
    expect(next).not.toBe(row.state);
    expect(next.inputs).toEqual(row.inputs);
    if (row.derived === 'CLEAR') {
      expect(next.derived).toEqual(CLEARED);
    } else {
      expect(next.derived.estimate).toBe(row.state.derived.estimate);
      expect(next.derived.documents).toBe(row.state.derived.documents);
      expect(next.derived.basis).toBe(row.state.derived.basis);
      expect(next.derived.returnContext).toEqual(row.returnContext ?? row.state.derived.returnContext);
    }
    expect(next.inputRevision).toBe(row.state.inputRevision + row.revisionDelta);
    expect(next.display.largeText).toBe(row.largeText);
    expect(next.lastInteractionAt).toBe(row.clock === 'RESTART' ? NOW : BEFORE);
    expect(next.sessionId).toBe(row.state.sessionId);
  });

  const RESET_ROWS: Array<[string, KioskEvent, KioskState]> = [
    ['처음으로(입력이 없을 때 즉시)', { type: 'REQUEST_HOME' }, resultSessionAt('K01_Generation', { inputs: EMPTY_PATIENT_INPUTS, derived: FILLED, display: { largeText: true, orientation: 'LANDSCAPE' } })],
    ['이용 완료', { type: 'COMPLETE_USE' }, filled('K04_Result_NotCovered')],
    ['새로고침·페이지 캐시 복원', { type: 'PAGE_RESTORED' }, filled('K07_Documents')],
  ];

  it.each(RESET_ROWS)('%s: 선택값·파생 데이터·ReturnContext 모두 삭제, 큰 글자는 꺼짐, 새 sessionId', (_name, event, state) => {
    const next = send(state, event);
    expect(next.inputs).toEqual(EMPTY_PATIENT_INPUTS);
    expect(next.derived).toEqual(CLEARED);
    expect(next.display.largeText).toBe(false);
    expect(next.sessionId).not.toBe(state.sessionId);
    expect(next.inputRevision).toBe(0);
    expect(hasPatientInput(next.inputs)).toBe(false);
  });
});

describe('입력 변경의 세부', () => {
  it('값이 바뀔 때마다 inputRevision 이 정확히 1 씩 오른다', () => {
    let state = filled('K01_Generation');
    state = send(state, { type: 'SELECT_GENERATION', code: 'GEN1_AS' });
    state = send(state, { type: 'SELECT_GENERATION', code: 'GEN3_C3' });
    state = send(state, { type: 'SELECT_GENERATION', code: 'GEN3_C3' });
    expect(state.inputRevision).toBe(6);
  });

  it('치료 선택은 집합이라 같은 묶음이면 순서가 달라도 같은 값이다 (applyInputs)', () => {
    const state = filled('K03_Treatments');
    const swapped = applyInputs(state, { ...state.inputs, treatmentIds: [T_KIDNEY_SPRAY, T_XRAY] });
    expect(swapped).toBe(state);
    const different = applyInputs(state, { ...state.inputs, treatmentIds: [T_KIDNEY_SPRAY] });
    expect(different.inputRevision).toBe(state.inputRevision + 1);
    const larger = applyInputs(state, { ...state.inputs, treatmentIds: [T_XRAY, T_KIDNEY_SPRAY, T_FIFTH] });
    expect(larger.inputRevision).toBe(state.inputRevision + 1);
    const sameSize = applyInputs(state, { ...state.inputs, treatmentIds: [T_XRAY, T_SIXTH] });
    expect(sameSize.inputRevision).toBe(state.inputRevision + 1);
  });

  it('원인만 바꿔도 금액 쪽(치료 선택)은 건드리지 않고 파생 데이터만 지운다 (원인은 계산에 들어가지 않고 서류에만 쓰인다)', () => {
    const next = send(filled('K02b_Cause'), { type: 'SELECT_CAUSE', code: 'UNKNOWN' });
    expect(next.inputs.treatmentIds).toEqual(FULL_INPUTS.treatmentIds);
    expect(next.derived).toEqual(CLEARED);
  });
});

describe('AC-014a·AC-014b·AC-014d 시나리오', () => {
  it('AC-014a: 결과 → "보험 조건 수정" → 세대를 다른 값으로 바꾸면 파생 데이터가 지워지고 inputRevision 이 1 오른다', () => {
    const atResult = filled('K04_Result_NotCovered');
    const atBasis = send(atResult, { type: 'OPEN_BASIS' });
    const back = send(atBasis, { type: 'RETURN_TO_RESULT' });
    const edit = send(back, { type: 'EDIT_INSURANCE' });
    expect(edit.screen).toBe('K01_Generation');
    expect(edit.derived.estimate).not.toBeNull();
    const changed = send(edit, { type: 'SELECT_GENERATION', code: 'GEN3_C3' });
    expect(changed.derived).toEqual(CLEARED);
    expect(changed.inputRevision).toBe(atResult.inputRevision + 1);
  });

  it('AC-014a: 지운 뒤에는 "예상 부담액 확인"(M5.B)을 다시 누르기 전에는 결과·근거·서류 화면에 갈 수 없다 (도달 가능한 화면 전수 탐색)', () => {
    const cleared = send(filled('K01_Generation'), { type: 'SELECT_GENERATION', code: 'GEN3_C3' });
    expect(cleared.derived).toEqual(CLEARED);
    const events: KioskEvent[] = [
      { type: 'SELECT_GENERATION', code: 'GEN1_AS' },
      { type: 'SELECT_GENERATION', code: 'GEN2_C1' },
      { type: 'SELECT_INSURER_TYPE', code: 'NON_LIFE' },
      { type: 'SELECT_CAUSE', code: 'INJURY' },
      { type: 'SELECT_CAUSE', code: 'UNKNOWN' },
      { type: 'TOGGLE_TREATMENT', treatmentId: T_XRAY },
      { type: 'TOGGLE_TREATMENT', treatmentId: T_ULTRASOUND },
      { type: 'NEXT' },
      { type: 'PREV' },
      { type: 'TREATMENTS_NEXT_PAGE' },
      { type: 'TREATMENTS_PREV_PAGE' },
      { type: 'OPEN_GENERATION_HELP' },
      { type: 'CLOSE_GENERATION_HELP' },
      { type: 'OPEN_DOCUMENTS' },
      { type: 'OPEN_BASIS' },
      { type: 'RETURN_TO_RESULT' },
      { type: 'RESELECT_TREATMENTS' },
      { type: 'EDIT_INSURANCE' },
      { type: 'REQUEST_HOME' },
      { type: 'CANCEL_RESET' },
      { type: 'CONFIRM_RESET' },
      { type: 'START' },
      { type: 'TOGGLE_LARGE_TEXT' },
      { type: 'INTERACTION' },
    ];
    const key = (s: KioskState) => JSON.stringify([s.screen, s.overlay.kind, s.inputs.generation, s.inputs.insurerType, s.inputs.cause, [...s.inputs.treatmentIds].sort(), s.derived.estimate !== null]);
    const seen = new Set<string>([key(cleared)]);
    const screens = new Set<string>([cleared.screen]);
    let frontier: KioskState[] = [cleared];
    for (let depth = 0; depth < 12 && frontier.length > 0; depth += 1) {
      const next: KioskState[] = [];
      for (const state of frontier) {
        for (const event of events) {
          const result = send(state, event);
          const k = key(result);
          if (!seen.has(k)) {
            seen.add(k);
            screens.add(result.screen);
            next.push(result);
          }
        }
      }
      frontier = next;
    }
    expect(seen.size).toBeGreaterThan(30);
    expect([...screens].sort()).toEqual(['K00_Start', 'K01_Generation', 'K01_Generation_Unknown', 'K02_Type', 'K02b_Cause', 'K03_Treatments']);
  });

  it('AC-014b: 결과가 나온 세션에서 치료를 하나 더 고르거나 빼면 AC-014a 와 같이 파생 데이터가 지워진다', () => {
    const reselect = send(filled('K04_Result_NotCovered'), { type: 'RESELECT_TREATMENTS' });
    const added = send(reselect, { type: 'TOGGLE_TREATMENT', treatmentId: T_FIFTH });
    expect(added.derived).toEqual(CLEARED);
    expect(added.inputRevision).toBe(5);
    const removed = send(reselect, { type: 'TOGGLE_TREATMENT', treatmentId: T_XRAY });
    expect(removed.derived).toEqual(CLEARED);
    expect(removed.inputRevision).toBe(5);
  });

  it('AC-014d: 같은 값을 다시 고르거나, 목록 페이지를 넘기거나, 큰 글자를 켜고 끄면 결과가 그대로 남는다', () => {
    const atResult = filled('K04_Result_NotCovered');
    const toggledOn = send(atResult, { type: 'TOGGLE_LARGE_TEXT' });
    const toggledOff = send(toggledOn, { type: 'TOGGLE_LARGE_TEXT' });
    expect(toggledOff.derived).toBe(atResult.derived);
    expect(toggledOff.inputRevision).toBe(atResult.inputRevision);

    const reselect = send(atResult, { type: 'RESELECT_TREATMENTS' });
    const paged = send(send(reselect, { type: 'TREATMENTS_NEXT_PAGE' }), { type: 'TREATMENTS_PREV_PAGE' });
    expect(paged.derived).toBe(atResult.derived);
    expect(paged.inputRevision).toBe(atResult.inputRevision);

    const edit = send(atResult, { type: 'EDIT_INSURANCE' });
    const same = send(edit, { type: 'SELECT_GENERATION', code: 'GEN2_C1' });
    expect(same.derived).toBe(atResult.derived);
    expect(same.inputRevision).toBe(atResult.inputRevision);
    const back = send(send(send(send(same, { type: 'NEXT' }), { type: 'NEXT' }), { type: 'NEXT' }), { type: 'PREV' });
    expect(back.derived).toBe(atResult.derived);
  });
});
