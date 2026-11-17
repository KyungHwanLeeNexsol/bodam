import { describe, expect, it } from 'vitest';
import { applyInputs, createInitialState, hasPatientInput, resetSession, SCREEN_STATES } from '../../../src/app/kiosk/state/session-store';
import type { KioskState } from '../../../src/app/kiosk/state/session-store';
import { T_XRAY, makeCatalog, makeOptions } from '../../fixtures/kiosk/clinic.fixture';
import { EMPTY_PATIENT_INPUTS, FULL_INPUTS, makeEnv, resultSessionAt, sequenceIds } from '../../fixtures/kiosk/state.fixture';

// 세션 저장소(메모리에만 있는 환자 상태): 초기 상태, 초기화(전체 삭제), 입력 유무, 입력 변경. design.md DD-08·DD-09·DD-13.
// 닫는 AC 는 없고 모든 AC 시험이 이 함수들 위에 선다.

describe('createInitialState', () => {
  const env = makeEnv(4_200, sequenceIds('INIT'));
  const state = createInitialState({ catalog: makeCatalog(), options: makeOptions() }, env);

  it('K00_Start 의 빈 세션이다: 입력·파생 데이터·복귀 정보·갱신·활성 요청이 모두 비어 있다', () => {
    expect(state.screen).toBe('K00_Start');
    expect(state.overlay).toEqual({ kind: 'NONE' });
    expect(state.sessionId).toBe('INIT-1');
    expect(state.inputs).toEqual(EMPTY_PATIENT_INPUTS);
    expect(state.inputRevision).toBe(0);
    expect(state.derived).toEqual({ estimate: null, documents: null, basis: null, returnContext: null });
    expect(state.refreshState).toBe('NONE');
    expect(state.activeRequest).toBeNull();
    expect(state.activeRefresh).toBeNull();
    expect(state.treatmentPageOffset).toBe(0);
    expect(state.lastInteractionAt).toBe(4_200);
    expect(state.sessionStartedAt).toBe(4_200);
    expect(state.display).toEqual({ largeText: false, orientation: 'PORTRAIT' });
  });

  it('환자 상태는 이 객체 안에만 있다: 키는 정해진 목록뿐이고 저장소 이름이 들어 있지 않다', () => {
    expect(Object.keys(state).sort()).toEqual(
      ['activeRefresh', 'activeRequest', 'clinic', 'derived', 'display', 'inputRevision', 'inputs', 'lastInteractionAt', 'overlay', 'refreshNotice', 'refreshState', 'screen', 'sessionId', 'sessionStartedAt', 'treatmentPageOffset'].sort(),
    );
  });

  it('15개 화면 상태를 모두 가진다 (DD-07 상태 표)', () => {
    expect([...SCREEN_STATES].sort()).toEqual(
      ['K00_Start', 'K01_Generation', 'K01_Generation_Unknown', 'K02_Type', 'K02b_Cause', 'K03_Treatments', 'Calculating', 'K04_Result', 'K04_Result_NotCovered', 'K04_Result_Hold', 'KXX_Error_Network', 'K04_Basis_Calculation', 'K07_Documents', 'K07_Documents_Unknown', 'K06_Complete'].sort(),
    );
    expect(SCREEN_STATES).toHaveLength(15);
  });
});

describe('resetSession: 전체 삭제 = 세션 초기화 (새 sessionId)', () => {
  const rich: KioskState = resultSessionAt('K04_Result_NotCovered', {
    overlay: { kind: 'TIMEOUT_DIALOG', openedAt: 1, resetAt: 2 },
    display: { largeText: true, orientation: 'LANDSCAPE' },
    refreshState: 'FAILED',
    treatmentPageOffset: 4,
    derived: { estimate: { state: 'ESTIMATED_WITH_EXCLUSIONS' }, documents: { marker: 'D' }, basis: { marker: 'B' }, returnContext: { resultVariant: 'NOT_COVERED' } },
  });

  it.each(['K00_Start', 'K06_Complete'] as const)('%s 로 지운다: 환자 입력·파생 데이터·복귀 정보·겹침창·갱신 상태가 비고 큰 글자는 꺼지며 화면 방향 관찰값과 병원 자료는 남는다', (destination) => {
    const env = makeEnv(88_000, sequenceIds('RESET'));
    const next = resetSession(rich, env, destination);
    expect(next.screen).toBe(destination);
    expect(next.sessionId).toBe('RESET-1');
    expect(next.inputs).toEqual(EMPTY_PATIENT_INPUTS);
    expect(next.inputRevision).toBe(0);
    expect(next.derived).toEqual({ estimate: null, documents: null, basis: null, returnContext: null });
    expect(next.overlay).toEqual({ kind: 'NONE' });
    expect(next.refreshState).toBe('NONE');
    expect(next.activeRequest).toBeNull();
    expect(next.activeRefresh).toBeNull();
    expect(next.treatmentPageOffset).toBe(0);
    expect(next.display).toEqual({ largeText: false, orientation: 'LANDSCAPE' });
    expect(next.lastInteractionAt).toBe(88_000);
    expect(next.sessionStartedAt).toBe(88_000);
    expect(next.clinic).toBe(rich.clinic);
  });

  it('입력 객체를 바꾸지 않는다 (이전 상태는 그대로 남는다)', () => {
    resetSession(rich, makeEnv(1), 'K00_Start');
    expect(rich.inputs).toEqual(FULL_INPUTS);
    expect(rich.sessionId).toBe('SESSION-1');
  });
});

describe('hasPatientInput: 세대·형태·원인·치료 가운데 하나라도 있으면 "진행 중"이다 (plan.md §E #36)', () => {
  it.each([
    ['아무것도 없음', EMPTY_PATIENT_INPUTS, false],
    ['세대', { ...EMPTY_PATIENT_INPUTS, generation: 'GEN3_C3' as const }, true],
    ['형태', { ...EMPTY_PATIENT_INPUTS, insurerType: 'NON_LIFE' as const }, true],
    ['원인', { ...EMPTY_PATIENT_INPUTS, cause: 'ILLNESS' as const }, true],
    ['치료', { ...EMPTY_PATIENT_INPUTS, treatmentIds: [T_XRAY] }, true],
  ])('%s → %s', (_name, inputs, expected) => {
    expect(hasPatientInput(inputs)).toBe(expected);
  });
});

describe('applyInputs: 값이 다를 때만 파생 데이터를 지우고 inputRevision 을 1 올린다 (DD-08)', () => {
  const base = resultSessionAt('K01_Generation', { inputRevision: 7 });

  it('같은 입력이면 같은 상태를 돌려준다', () => {
    expect(applyInputs(base, { ...base.inputs })).toBe(base);
  });

  it('다른 입력이면 새 상태: 입력이 바뀌고 파생 데이터가 지워지며 inputRevision 이 8 이 된다', () => {
    const next = applyInputs(base, { ...base.inputs, cause: 'UNKNOWN' });
    expect(next.inputs.cause).toBe('UNKNOWN');
    expect(next.derived).toEqual({ estimate: null, documents: null, basis: null, returnContext: null });
    expect(next.inputRevision).toBe(8);
    expect(base.derived.estimate).not.toBeNull();
  });
});
