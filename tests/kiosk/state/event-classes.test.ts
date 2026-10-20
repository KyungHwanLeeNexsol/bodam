import { describe, expect, it } from 'vitest';
import type { KioskEvent, KioskEventType } from '../../../src/app/kiosk/state/events';
import { EVENT_SPECS, reduce } from '../../../src/app/kiosk/state/machine';
import type { KioskState } from '../../../src/app/kiosk/state/session-store';
import { T_PHYSIO, makeCatalog, makeOptions } from '../../fixtures/kiosk/clinic.fixture';
import { FULL_INPUTS, makeEnv, resultSessionAt, stateAt } from '../../fixtures/kiosk/state.fixture';

// AC-015d 의 구조: 무조작 시간을 다시 세는 것은 환자 사건(PATIENT)뿐이고, 시스템 사건(SYSTEM: 화면 방향 관찰, 시계 사건, 페이지 복원, 그리고 M5.B·C 가
// 더할 서버 응답·시간 초과·자료 갱신 결말)은 시계를 건드리지 않는다. 사건 종류마다 분류를 적게 한 EVENT_SPECS 는 `Record<KioskEventType, …>` 라서
// 새 사건을 더하면서 분류를 빠뜨리면 컴파일이 막고, 이 시험은 모든 분류의 동작을 사건 하나씩 확인한다.

const BEFORE = 1_000;
const NOW = 9_000;

const rich = (screen: KioskState['screen'], patch: Partial<KioskState> = {}): KioskState =>
  resultSessionAt(screen, { lastInteractionAt: BEFORE, derived: { estimate: { state: 'ESTIMATED' }, documents: null, basis: null, returnContext: { resultVariant: 'NORMAL' } }, ...patch });

/** 계산 중인 세션: 활성 요청이 있다. 결말 사건은 이 시도의 requestId 를 실어야 받아들여진다. */
const calculating = (): KioskState => {
  const base = rich('Calculating');
  return { ...base, activeRequest: { requestId: 'RID-SAMPLE-0001', sessionId: base.sessionId, inputRevision: base.inputRevision } };
};

/** 갱신이 진행 중인 세션: 활성 갱신이 있다. 결말 사건은 이 시도의 refreshId 를 실어야 받아들여진다. */
const refreshing = (): KioskState => {
  const base = rich('K03_Treatments', { refreshState: 'RUNNING' });
  return { ...base, activeRefresh: { refreshId: 'RFR-SAMPLE-0001', sessionId: base.sessionId, inputRevision: base.inputRevision, reason: 'VERSION_MISMATCH' } };
};

/** 사건 종류마다 그 사건을 받아들이는 (상태, 시각) 한 쌍. Record 라서 모든 종류가 있어야 컴파일된다. */
const SAMPLES: Record<KioskEventType, { event: KioskEvent; state: KioskState; now?: number }> = {
  START: { event: { type: 'START' }, state: stateAt('K00_Start', { lastInteractionAt: BEFORE }) },
  SELECT_GENERATION: { event: { type: 'SELECT_GENERATION', code: 'GEN1_AS' }, state: rich('K01_Generation') },
  SELECT_INSURER_TYPE: { event: { type: 'SELECT_INSURER_TYPE', code: 'LIFE' }, state: rich('K02_Type') },
  SELECT_CAUSE: { event: { type: 'SELECT_CAUSE', code: 'ILLNESS' }, state: rich('K02b_Cause') },
  TOGGLE_TREATMENT: { event: { type: 'TOGGLE_TREATMENT', treatmentId: T_PHYSIO }, state: rich('K03_Treatments') },
  NEXT: { event: { type: 'NEXT' }, state: rich('K01_Generation') },
  PREV: { event: { type: 'PREV' }, state: rich('K03_Treatments') },
  TREATMENTS_NEXT_PAGE: { event: { type: 'TREATMENTS_NEXT_PAGE' }, state: rich('K03_Treatments') },
  TREATMENTS_PREV_PAGE: { event: { type: 'TREATMENTS_PREV_PAGE' }, state: rich('K03_Treatments', { treatmentPageOffset: 4 }) },
  OPEN_GENERATION_HELP: { event: { type: 'OPEN_GENERATION_HELP' }, state: rich('K01_Generation') },
  CLOSE_GENERATION_HELP: { event: { type: 'CLOSE_GENERATION_HELP' }, state: rich('K01_Generation_Unknown') },
  OPEN_DOCUMENTS: { event: { type: 'OPEN_DOCUMENTS' }, state: rich('K04_Result') },
  OPEN_BASIS: { event: { type: 'OPEN_BASIS' }, state: rich('K04_Result') },
  RETURN_TO_RESULT: { event: { type: 'RETURN_TO_RESULT' }, state: rich('K04_Basis_Calculation') },
  RESELECT_TREATMENTS: { event: { type: 'RESELECT_TREATMENTS' }, state: rich('K04_Result') },
  EDIT_INSURANCE: { event: { type: 'EDIT_INSURANCE' }, state: rich('K04_Result') },
  REQUEST_HOME: { event: { type: 'REQUEST_HOME' }, state: rich('K04_Result') },
  CONFIRM_RESET: { event: { type: 'CONFIRM_RESET' }, state: rich('K04_Result', { overlay: { kind: 'RESET_CONFIRM' } }) },
  CANCEL_RESET: { event: { type: 'CANCEL_RESET' }, state: rich('K04_Result', { overlay: { kind: 'RESET_CONFIRM' } }) },
  CONTINUE_USING: { event: { type: 'CONTINUE_USING' }, state: rich('K04_Result', { overlay: { kind: 'TIMEOUT_DIALOG', openedAt: 5_000, resetAt: 99_000 } }) },
  COMPLETE_USE: { event: { type: 'COMPLETE_USE' }, state: rich('K04_Result') },
  BACK_TO_START: { event: { type: 'BACK_TO_START' }, state: stateAt('K06_Complete', { lastInteractionAt: BEFORE }) },
  TOGGLE_LARGE_TEXT: { event: { type: 'TOGGLE_LARGE_TEXT' }, state: rich('K04_Result') },
  INTERACTION: { event: { type: 'INTERACTION' }, state: rich('K04_Result') },
  REQUEST_ESTIMATE: { event: { type: 'REQUEST_ESTIMATE' }, state: rich('K03_Treatments') },
  ESTIMATE_RESPONDED: { event: { type: 'ESTIMATE_RESPONDED', requestId: 'RID-SAMPLE-0001', status: 500, body: { error: 'INTERNAL_ERROR' } }, state: calculating() },
  ESTIMATE_FAILED: { event: { type: 'ESTIMATE_FAILED', requestId: 'RID-SAMPLE-0001' }, state: calculating() },
  ESTIMATE_EXPIRED: { event: { type: 'ESTIMATE_EXPIRED', requestId: 'RID-SAMPLE-0001' }, state: calculating() },
  RETRY_REFRESH: { event: { type: 'RETRY_REFRESH' }, state: rich('K03_Treatments', { refreshState: 'FAILED' }) },
  REFRESH_RESOLVED: { event: { type: 'REFRESH_RESOLVED', refreshId: 'RFR-SAMPLE-0001', catalog: makeCatalog(), options: makeOptions() }, state: refreshing() },
  REFRESH_FAILED: { event: { type: 'REFRESH_FAILED', refreshId: 'RFR-SAMPLE-0001' }, state: refreshing() },
  REFRESH_EXPIRED: { event: { type: 'REFRESH_EXPIRED', refreshId: 'RFR-SAMPLE-0001' }, state: refreshing() },
  ORIENTATION_CHANGED: { event: { type: 'ORIENTATION_CHANGED', orientation: 'LANDSCAPE' }, state: rich('K04_Result') },
  PAGE_RESTORED: { event: { type: 'PAGE_RESTORED' }, state: rich('K04_Result') },
  TICK: { event: { type: 'TICK' }, state: rich('K03_Treatments', { inputs: FULL_INPUTS }), now: BEFORE + 100_000 },
};

const SYSTEM_TYPES: KioskEventType[] = ['ORIENTATION_CHANGED', 'PAGE_RESTORED', 'TICK', 'ESTIMATE_RESPONDED', 'ESTIMATE_FAILED', 'ESTIMATE_EXPIRED', 'REFRESH_RESOLVED', 'REFRESH_FAILED', 'REFRESH_EXPIRED'];
const TYPES = Object.keys(SAMPLES) as KioskEventType[];

describe('사건 분류 (AC-015d)', () => {
  it('SYSTEM 은 시계 사건·화면 방향 관찰·페이지 복원·계산 요청·자료 갱신의 결말뿐이고 나머지는 모두 PATIENT 다', () => {
    const system = Object.entries(EVENT_SPECS).filter(([, spec]) => spec.kind === 'SYSTEM').map(([type]) => type).sort();
    expect(system).toEqual([...SYSTEM_TYPES].sort());
    expect(TYPES.sort()).toEqual(Object.keys(EVENT_SPECS).sort());
  });

  it.each(TYPES.filter((type) => !SYSTEM_TYPES.includes(type)))('PATIENT %s: 받아들이면 마지막 조작 시각이 지금으로 바뀐다', (type) => {
    const { event, state, now = NOW } = SAMPLES[type];
    const next = reduce(state, event, makeEnv(now));
    expect(next).not.toBe(state);
    expect(next.lastInteractionAt).toBe(now);
  });

  it.each(['ORIENTATION_CHANGED', 'TICK', 'ESTIMATE_RESPONDED', 'ESTIMATE_FAILED', 'ESTIMATE_EXPIRED', 'REFRESH_RESOLVED', 'REFRESH_FAILED', 'REFRESH_EXPIRED'] as const)('SYSTEM %s: 받아들여도 마지막 조작 시각은 그대로다 (서버 응답·내부 갱신·시계는 시간을 다시 세지 않는다)', (type) => {
    const { event, state, now = NOW } = SAMPLES[type];
    const next = reduce(state, event, makeEnv(now));
    expect(next).not.toBe(state);
    expect(next.lastInteractionAt).toBe(BEFORE);
  });

  it('SYSTEM PAGE_RESTORED: 세션을 새로 열 뿐 이전 세션의 시계를 이어 받지 않는다', () => {
    const { event, state } = SAMPLES.PAGE_RESTORED;
    const next = reduce(state, event, makeEnv(NOW));
    expect(next.screen).toBe('K00_Start');
    expect(next.sessionStartedAt).toBe(NOW);
  });

  it('모든 표본은 실제로 받아들여진다 (표본이 헛돌지 않는다)', () => {
    for (const type of TYPES) {
      const { event, state, now = NOW } = SAMPLES[type];
      expect(reduce(state, event, makeEnv(now)), type).not.toBe(state);
    }
  });
});
