import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reduce } from '../../../src/app/kiosk/state/machine';
import type { KioskState } from '../../../src/app/kiosk/state/session-store';
import { EMPTY_PATIENT_INPUTS, FULL_INPUTS, makeEnv, markerIds, sequenceIds, stateAt } from '../../fixtures/kiosk/state.fixture';
import { startKiosk } from '../../fixtures/kiosk/transport.fixture';

// K00_Start 의 "시작하기"는 새 빈 세션을 만든다 (design.md DD-07 전이표 "전체 삭제(빈 세션 생성)", AC-012a "시작하기는 언제나 빈 세션으로 화면 1을 연다").
// 시작은 초기화 경로(처음으로·이용 완료·무조작·새로고침)가 아니라서 표시 설정(큰 글자 보기·관찰한 화면 방향)은 유지한다 — 소유자에게 확인할 선택이다(아래 시험이 못 박는다).

const ENV = () => makeEnv(7_000, sequenceIds('NEW'), markerIds('RID-UNIT'), markerIds('RFR-UNIT'));
const start = (state: KioskState, env = ENV()): KioskState => reduce(state, { type: 'START' }, env);

/** 이전 환자의 값이 남아 있는 K00_Start (강제 구성): 정상 흐름에서는 K00 이 항상 비어 있으므로 "언제나 빈 세션"을 방어로 확인한다. */
function dirtyStart(): KioskState {
  return stateAt('K00_Start', {
    inputs: FULL_INPUTS,
    inputRevision: 5,
    derived: { estimate: { state: 'ESTIMATED' }, documents: { marker: 'DOCUMENTS' }, basis: { marker: 'BASIS' }, returnContext: { resultVariant: 'NORMAL' } },
    refreshNotice: { removed: [{ treatmentId: 'OLD', displayName: '옛 치료' }] },
    refreshState: 'FAILED',
    treatmentPageOffset: 4,
    display: { largeText: true, orientation: 'LANDSCAPE' },
    lastInteractionAt: 1_000,
    sessionStartedAt: 1_000,
  });
}

describe('START: 새 빈 세션', () => {
  it('K01_Generation 으로 가고 새 sessionId 를 한 번 발급받는다. 시작 시각과 마지막 조작은 지금이다', () => {
    const state = stateAt('K00_Start');
    const env = ENV();
    const next = start(state, env);
    expect(next.screen).toBe('K01_Generation');
    expect(next.sessionId).toBe('NEW-1');
    expect(next.sessionId).not.toBe(state.sessionId);
    expect(next.sessionStartedAt).toBe(7_000);
    expect(next.lastInteractionAt).toBe(7_000);
    expect(env.newSessionId()).toBe('NEW-2');
  });

  it('이전 값이 남은 K00 에서도 입력·파생 데이터·복귀 정보·갱신 상태와 안내·쪽 위치·겹침창이 모두 비고 inputRevision 이 0 으로 돌아온다', () => {
    const next = start({ ...dirtyStart(), overlay: { kind: 'NONE' } });
    expect(next.inputs).toEqual(EMPTY_PATIENT_INPUTS);
    expect(next.derived).toEqual({ estimate: null, documents: null, basis: null, returnContext: null });
    expect(next.inputRevision).toBe(0);
    expect(next.refreshState).toBe('NONE');
    expect(next.refreshNotice).toBeNull();
    expect(next.activeRequest).toBeNull();
    expect(next.activeRefresh).toBeNull();
    expect(next.treatmentPageOffset).toBe(0);
    expect(next.overlay).toEqual({ kind: 'NONE' });
  });

  it('표시 설정은 유지한다: 큰 글자 보기와 관찰한 화면 방향 (초기화가 아니라서 끄지 않는다 — 소유자 확인 필요한 선택)', () => {
    const next = start(dirtyStart());
    expect(next.display).toEqual({ largeText: true, orientation: 'LANDSCAPE' });
  });

  it('병원 자료(catalog·options·버전·무조작 정책)는 그대로다', () => {
    const state = dirtyStart();
    expect(start(state).clinic).toBe(state.clinic);
  });

  it('K00 이 아닌 화면과 겹침창이 열린 상태에서는 거절한다 (같은 상태 참조)', () => {
    const k01 = stateAt('K01_Generation');
    expect(start(k01)).toBe(k01);
    const withOverlay = stateAt('K00_Start', { overlay: { kind: 'RESET_CONFIRM' } });
    expect(start(withOverlay)).toBe(withOverlay);
  });
});

describe('START 와 진행 중인 요청·갱신 (강제로 남은 경우도 취소 도우미를 거친다)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('활성 요청이 남은 K00: 시작하면 요청을 취소(abort)하고 타이머를 풀며 새 세션에 요청이 남지 않는다', () => {
    const base = stateAt('K00_Start', { inputs: FULL_INPUTS });
    const forced: KioskState = { ...base, activeRequest: { requestId: 'RID-FORCED-A', sessionId: base.sessionId, inputRevision: base.inputRevision } };
    const kiosk = startKiosk({ from: forced });
    const call = kiosk.transport.calls[0]!;
    expect(vi.getTimerCount()).toBe(1);
    expect(kiosk.controller.dispatch({ type: 'START' })).toBe('APPLIED');
    const state = kiosk.controller.getState();
    expect(state.activeRequest).toBeNull();
    expect(state.sessionId).not.toBe(base.sessionId);
    expect(kiosk.abortCalls()).toBe(1);
    expect(call.init.signal.aborted).toBe(true);
    // 남은 타이머는 새 세션의 무조작 타이머 하나뿐이다
    expect(vi.getTimerCount()).toBe(1);
    kiosk.dispose();
  });

  it('활성 갱신이 남은 K00: 시작하면 갱신을 취소하고 새 세션은 갱신 상태 NONE 이다', () => {
    const base = stateAt('K00_Start', { inputs: FULL_INPUTS, refreshState: 'RUNNING' });
    const forced: KioskState = { ...base, activeRefresh: { refreshId: 'RFR-FORCED-A', sessionId: base.sessionId, inputRevision: base.inputRevision, reason: 'RETRY' } };
    const kiosk = startKiosk({ from: forced });
    const gets = kiosk.transport.refreshCalls();
    expect(gets).toHaveLength(2);
    kiosk.controller.dispatch({ type: 'START' });
    const state = kiosk.controller.getState();
    expect(state).toMatchObject({ activeRefresh: null, refreshState: 'NONE', screen: 'K01_Generation' });
    expect(gets.every((get) => get.init.signal.aborted)).toBe(true);
    kiosk.dispose();
  });
});
