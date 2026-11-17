import { describe, expect, it } from 'vitest';
import type { KioskEvent } from '../../../src/app/kiosk/state/events';
import { EVENT_SPECS, reduce } from '../../../src/app/kiosk/state/machine';
import { SCREEN_STATES } from '../../../src/app/kiosk/state/session-store';
import type { KioskState, OverlayState, ScreenState } from '../../../src/app/kiosk/state/session-store';
import { EMPTY_PATIENT_INPUTS, FULL_INPUTS, makeEnv, resultSessionAt, sequenceIds, stateAt } from '../../fixtures/kiosk/state.fixture';

// "처음으로"·ResetConfirm·TimeoutDialog 의 사건 규칙 (design.md DD-07 전이표 마지막 행들, DD-13, plan.md §E #36). reduce 수준에서 본다.
// 닫는 AC: AC-015h(여기서는 화면 상태 쪽), 증거: AC-015e·AC-015g·AC-015j·AC-015k. 시간이 흐르는 쪽은 idle-timers.test.ts 가 본다.

const NOW = 50_000;
const RESET_CONFIRM: OverlayState = { kind: 'RESET_CONFIRM' };
const TIMEOUT_DIALOG: OverlayState = { kind: 'TIMEOUT_DIALOG', openedAt: 40_000, resetAt: 60_000 };

// 사건마다 새 발급기를 쓴다: 한 발급기를 여러 시험이 나눠 쓰면 "첫 초기화는 NEW-1" 대조가 시험 순서에 기댄다.
const send = (state: KioskState, event: KioskEvent): KioskState => reduce(state, event, makeEnv(NOW, sequenceIds('NEW')));
const withInput = (screen: ScreenState, overlay: OverlayState = { kind: 'NONE' }): KioskState => resultSessionAt(screen, { overlay, lastInteractionAt: 1_000 });
const withoutInput = (screen: ScreenState, overlay: OverlayState = { kind: 'NONE' }): KioskState => stateAt(screen, { overlay, lastInteractionAt: 1_000 });

describe('일반 환자 화면의 "처음으로" (겹침창 없음)', () => {
  it.each(['K01_Generation', 'K03_Treatments', 'K04_Result', 'K04_Result_Hold', 'K07_Documents'] as const)(
    '%s: 환자 입력이 있으면 ResetConfirm 을 먼저 띄운다 — 화면·선택·결과는 그대로, 세션은 그대로 (AC-015g)',
    (screen) => {
      const state = withInput(screen);
      const next = send(state, { type: 'REQUEST_HOME' });
      expect(next.overlay).toEqual({ kind: 'RESET_CONFIRM' });
      expect(next.screen).toBe(screen);
      expect(next.inputs).toBe(state.inputs);
      expect(next.derived).toBe(state.derived);
      expect(next.sessionId).toBe(state.sessionId);
      expect(next.lastInteractionAt).toBe(NOW);
    },
  );

  it.each([
    ['세대만', { ...EMPTY_PATIENT_INPUTS, generation: 'GEN1_AS' as const }],
    ['형태만', { ...EMPTY_PATIENT_INPUTS, insurerType: 'LIFE' as const }],
    ['원인만', { ...EMPTY_PATIENT_INPUTS, cause: 'UNKNOWN' as const }],
    ['치료만', { ...EMPTY_PATIENT_INPUTS, treatmentIds: ['TEST_FIXTURE_TREATMENT_1'] }],
  ])('환자 입력 가운데 하나라도 있으면(%s) ResetConfirm 이 먼저 뜬다 ("진행 중" = 입력이 하나 이상)', (_name, inputs) => {
    expect(send(stateAt('K02_Type', { inputs }), { type: 'REQUEST_HOME' }).overlay.kind).toBe('RESET_CONFIRM');
  });

  it.each(['K01_Generation', 'K01_Generation_Unknown', 'K02_Type', 'K03_Treatments', 'Calculating', 'KXX_Error_Network'] as const)(
    '%s: 환자 입력이 하나도 없으면 ResetConfirm 없이 바로 K00_Start 로 간다 (AC-015j)',
    (screen) => {
      const state = withoutInput(screen);
      const next = send(state, { type: 'REQUEST_HOME' });
      expect(next.screen).toBe('K00_Start');
      expect(next.overlay.kind).toBe('NONE');
      expect(next.sessionId).toBe('NEW-1');
    },
  );

  it('ResetConfirm "확인" → 전체 삭제 후 K00_Start (K06_Complete 를 거치지 않는다), 새 sessionId, 큰 글자 꺼짐', () => {
    const state = { ...withInput('K04_Result_NotCovered', RESET_CONFIRM), display: { largeText: true, orientation: 'LANDSCAPE' as const } };
    const next = send(state, { type: 'CONFIRM_RESET' });
    expect(next.screen).toBe('K00_Start');
    expect(next.overlay.kind).toBe('NONE');
    expect(next.inputs).toEqual(EMPTY_PATIENT_INPUTS);
    expect(next.derived).toEqual({ estimate: null, documents: null, basis: null, returnContext: null });
    expect(next.display).toEqual({ largeText: false, orientation: 'LANDSCAPE' });
    expect(next.sessionId).toBe('NEW-1');
    expect(next.sessionStartedAt).toBe(NOW);
  });

  it('ResetConfirm "취소" → 직전 화면, 선택·결과·화면 그대로, 취소 터치는 무조작 시간을 다시 센다', () => {
    const state = withInput('K04_Result', RESET_CONFIRM);
    const next = send(state, { type: 'CANCEL_RESET' });
    expect(next.overlay.kind).toBe('NONE');
    expect(next.screen).toBe('K04_Result');
    expect(next.inputs).toBe(state.inputs);
    expect(next.derived).toBe(state.derived);
    expect(next.sessionId).toBe(state.sessionId);
    expect(next.lastInteractionAt).toBe(NOW);
  });

  it('ResetConfirm 이 열려 있는 동안 "처음으로"는 두 번째 겹침창을 쌓지 않는다 (겹침창은 동시에 하나)', () => {
    const state = withInput('K03_Treatments', RESET_CONFIRM);
    expect(send(state, { type: 'REQUEST_HOME' })).toBe(state);
  });

  it('ResetConfirm 에 닿는 화면 터치(INTERACTION)는 무조작 시간을 다시 세고 ResetConfirm 은 그대로다 (AC-015k)', () => {
    const state = withInput('K03_Treatments', RESET_CONFIRM);
    const next = send(state, { type: 'INTERACTION' });
    expect(next.overlay).toEqual({ kind: 'RESET_CONFIRM' });
    expect(next.lastInteractionAt).toBe(NOW);
  });
});

describe('TimeoutDialog 안의 "처음으로" (plan.md §E #36, AC-015e)', () => {
  it.each([
    ['환자 입력이 있는 세션', withInput('K04_Result', TIMEOUT_DIALOG)],
    ['환자 입력이 없는 세션', withoutInput('K01_Generation', TIMEOUT_DIALOG)],
  ])('%s: ResetConfirm 없이 바로 지우고 새 sessionId 의 K00_Start, K06_Complete 를 거치지 않는다', (_name, state) => {
    const next = send(state, { type: 'REQUEST_HOME' });
    expect(next.screen).toBe('K00_Start');
    expect(next.overlay.kind).toBe('NONE');
    expect(next.inputs).toEqual(EMPTY_PATIENT_INPUTS);
    expect(next.sessionId).toBe('NEW-1');
    expect(next.sessionStartedAt).toBe(NOW);
  });

  it('"계속 사용할게요" → 직전 화면(겹침창 아래), 선택 유지, 시간을 다시 센다. 반복할 수 있다', () => {
    let state = withInput('K04_Result_NotCovered', TIMEOUT_DIALOG);
    for (let n = 0; n < 3; n += 1) {
      state = send({ ...state, overlay: TIMEOUT_DIALOG, lastInteractionAt: 1_000 }, { type: 'CONTINUE_USING' });
      expect(state.overlay.kind).toBe('NONE');
      expect(state.screen).toBe('K04_Result_NotCovered');
      expect(state.inputs).toBe(FULL_INPUTS);
      expect(state.lastInteractionAt).toBe(NOW);
    }
  });

  it('열려 있는 동안 화면 터치(INTERACTION)는 받지 않는다: 시간은 "계속 사용할게요"로만 다시 센다 (초기화 시점은 열릴 때 정해진다)', () => {
    const state = withInput('K04_Result', TIMEOUT_DIALOG);
    expect(send(state, { type: 'INTERACTION' })).toBe(state);
  });
});

describe('겹침창 아래의 환자 사건은 막힌다', () => {
  const PATIENT_EVENTS: KioskEvent[] = [
    { type: 'START' },
    { type: 'SELECT_GENERATION', code: 'GEN1_AS' },
    { type: 'SELECT_INSURER_TYPE', code: 'LIFE' },
    { type: 'SELECT_CAUSE', code: 'ILLNESS' },
    { type: 'TOGGLE_TREATMENT', treatmentId: 'TEST_FIXTURE_TREATMENT_4' },
    { type: 'NEXT' },
    { type: 'PREV' },
    { type: 'TREATMENTS_NEXT_PAGE' },
    { type: 'OPEN_GENERATION_HELP' },
    { type: 'OPEN_DOCUMENTS' },
    { type: 'OPEN_BASIS' },
    { type: 'RETURN_TO_RESULT' },
    { type: 'RESELECT_TREATMENTS' },
    { type: 'EDIT_INSURANCE' },
    { type: 'COMPLETE_USE' },
    { type: 'BACK_TO_START' },
    { type: 'TOGGLE_LARGE_TEXT' },
    { type: 'REQUEST_ESTIMATE' },
    { type: 'RETRY_REFRESH' },
  ];

  it.each([RESET_CONFIRM, TIMEOUT_DIALOG])('겹침창 %j 가 열려 있으면 화면의 환자 사건은 모두 거절한다', (overlay) => {
    for (const screen of SCREEN_STATES) {
      const state = resultSessionAt(screen, { overlay, derived: { estimate: { state: 'ESTIMATED' }, documents: null, basis: null, returnContext: { resultVariant: 'NORMAL' } } });
      for (const event of PATIENT_EVENTS) {
        expect(send(state, event), `${overlay.kind} ${event.type} @ ${screen}`).toBe(state);
      }
    }
  });

  it('겹침창 전용 사건은 그 겹침창이 열려 있을 때만 받는다', () => {
    const plain = withInput('K04_Result');
    expect(send(plain, { type: 'CONFIRM_RESET' })).toBe(plain);
    expect(send(plain, { type: 'CANCEL_RESET' })).toBe(plain);
    expect(send(plain, { type: 'CONTINUE_USING' })).toBe(plain);
    const confirm = withInput('K04_Result', RESET_CONFIRM);
    expect(send(confirm, { type: 'CONTINUE_USING' })).toBe(confirm);
    const dialog = withInput('K04_Result', TIMEOUT_DIALOG);
    expect(send(dialog, { type: 'CONFIRM_RESET' })).toBe(dialog);
    expect(send(dialog, { type: 'CANCEL_RESET' })).toBe(dialog);
  });

  it('시스템 사건(화면 방향 변경·페이지 복원)은 겹침창이 열려 있어도 받는다: 방향은 바뀌고, 복원은 겹침창을 닫고 K00 으로 간다', () => {
    const dialog = withInput('K04_Result', TIMEOUT_DIALOG);
    const rotated = send(dialog, { type: 'ORIENTATION_CHANGED', orientation: 'LANDSCAPE' });
    expect(rotated.overlay).toEqual(TIMEOUT_DIALOG);
    expect(rotated.display.orientation).toBe('LANDSCAPE');
    const restored = send(withInput('K04_Result', RESET_CONFIRM), { type: 'PAGE_RESTORED' });
    expect(restored.screen).toBe('K00_Start');
    expect(restored.overlay.kind).toBe('NONE');
  });

  it('EVENT_SPECS 의 겹침창 허용 목록이 위 규칙과 같다', () => {
    const allowedIn = (kind: OverlayState['kind']) => Object.entries(EVENT_SPECS).filter(([, spec]) => spec.overlays.includes(kind)).map(([type]) => type).sort();
    // 계산 요청의 결말 세 종류와 자료 갱신의 결말 세 종류는 어느 겹침창 위에서도 곧바로 밑 화면에 반영된다 (DD-07 "겹침창이 열려 있는 동안 도착하는 요청 결말" 규칙 1, 표 2).
    expect(allowedIn('RESET_CONFIRM')).toEqual(['CANCEL_RESET', 'CONFIRM_RESET', 'ESTIMATE_EXPIRED', 'ESTIMATE_FAILED', 'ESTIMATE_RESPONDED', 'INTERACTION', 'ORIENTATION_CHANGED', 'PAGE_RESTORED', 'REFRESH_EXPIRED', 'REFRESH_FAILED', 'REFRESH_RESOLVED', 'TICK']);
    expect(allowedIn('TIMEOUT_DIALOG')).toEqual(['CONTINUE_USING', 'ESTIMATE_EXPIRED', 'ESTIMATE_FAILED', 'ESTIMATE_RESPONDED', 'ORIENTATION_CHANGED', 'PAGE_RESTORED', 'REFRESH_EXPIRED', 'REFRESH_FAILED', 'REFRESH_RESOLVED', 'REQUEST_HOME', 'TICK']);
  });
});
