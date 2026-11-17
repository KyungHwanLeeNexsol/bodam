import { describe, expect, it } from 'vitest';
import type { KioskEvent } from '../../../src/app/kiosk/state/events';
import { EVENT_SPECS, reduce } from '../../../src/app/kiosk/state/machine';
import { SCREEN_STATES } from '../../../src/app/kiosk/state/session-store';
import type { KioskState, ScreenState } from '../../../src/app/kiosk/state/session-store';
import { FOUR_TREATMENTS, T_KIDNEY_SPRAY, T_PHYSIO, T_SIXTH, T_XRAY, makeCatalog } from '../../fixtures/kiosk/clinic.fixture';
import { EMPTY_PATIENT_INPUTS, FULL_INPUTS, initialState, makeEnv, resultSessionAt, sequenceIds, stateAt } from '../../fixtures/kiosk/state.fixture';

// DD-07 전이표 가운데 요청·갱신과 무관하게 환자 조작만으로 가는 행(M5.A가 맡은 행)을 한 줄씩 시험한다.
// 근거: design.md DD-07 "전이표", DD-08, DD-11. 닫는 AC: AC-012g, AC-014a(일부). 증거: AC-012a·b·e·i, AC-014e·g·h·i.
// reduce 는 순수 함수이므로 상태를 직접 구성해 부르고, 부른 뒤 받은 상태만 본다.

// 새 세션 식별자는 시험 자료가 만든 SESSION-n 과 겹치지 않는 NEW-n 이다(겹치면 "새 sessionId" 대조가 헛돈다).
const ENV = makeEnv(5_000, sequenceIds('NEW'));
const RESULT_SCREENS: ScreenState[] = ['K04_Result', 'K04_Result_NotCovered', 'K04_Result_Hold'];

function send(state: KioskState, event: KioskEvent): KioskState {
  return reduce(state, event, ENV);
}

/** 상태가 바뀌지 않았다(같은 참조). 거절된 사건이다. */
function expectRejected(state: KioskState, event: KioskEvent): void {
  expect(send(state, event)).toBe(state);
}

describe('DD-07 전이표: 입력 단계 (K00 → K01 → K02 → K02b → K03)', () => {
  it('K00_Start "시작하기" → K01_Generation, 새 빈 세션 (DD-07 "전체 삭제(빈 세션 생성)", AC-012a). 자세한 내용은 start-session.test.ts', () => {
    const state = initialState();
    const next = send(state, { type: 'START' });
    expect(next.screen).toBe('K01_Generation');
    expect(next.inputs).toEqual(EMPTY_PATIENT_INPUTS);
    // 시작할 때마다 새 세션 식별자다 (이전에는 K00 의 식별자를 이어 썼다)
    expect(next.sessionId).not.toBe(state.sessionId);
  });

  it('K01 세대 카드 선택 → K01 에 머물고 값이 저장된다', () => {
    const next = send(stateAt('K01_Generation'), { type: 'SELECT_GENERATION', code: 'GEN3_C3' });
    expect(next.screen).toBe('K01_Generation');
    expect(next.inputs.generation).toBe('GEN3_C3');
  });

  it('K01 "다음" 은 세대가 있을 때만 K02_Type 으로 간다 (AC-012b: 아무것도 고르지 않으면 비활성)', () => {
    expectRejected(stateAt('K01_Generation'), { type: 'NEXT' });
    expect(send(stateAt('K01_Generation', { inputs: { ...EMPTY_PATIENT_INPUTS, generation: 'GEN1_AS' } }), { type: 'NEXT' }).screen).toBe('K02_Type');
  });

  it('K01 "확인 방법 보기" → K01_Generation_Unknown, "보험 선택으로 돌아가기" → K01 (선택은 유지)', () => {
    const state = stateAt('K01_Generation', { inputs: { ...EMPTY_PATIENT_INPUTS, generation: 'GEN4_C4' } });
    const help = send(state, { type: 'OPEN_GENERATION_HELP' });
    expect(help.screen).toBe('K01_Generation_Unknown');
    const back = send(help, { type: 'CLOSE_GENERATION_HELP' });
    expect(back.screen).toBe('K01_Generation');
    expect(back.inputs).toEqual(state.inputs);
  });

  it('K02 형태 카드 선택 → K02, "다음" 은 형태가 있을 때만 K02b_Cause 로, "이전" 은 K01 로', () => {
    const state = stateAt('K02_Type', { inputs: { ...EMPTY_PATIENT_INPUTS, generation: 'GEN1_AS' } });
    expectRejected(state, { type: 'NEXT' });
    const chosen = send(state, { type: 'SELECT_INSURER_TYPE', code: 'LIFE' });
    expect(chosen.screen).toBe('K02_Type');
    expect(chosen.inputs.insurerType).toBe('LIFE');
    expect(send(chosen, { type: 'NEXT' }).screen).toBe('K02b_Cause');
    expect(send(chosen, { type: 'PREV' }).screen).toBe('K01_Generation');
  });

  it('K02b 원인 카드 선택 → K02b, "다음" 은 원인이 있을 때만 K03_Treatments 로, "이전" 은 K02 로', () => {
    const state = stateAt('K02b_Cause', { inputs: { ...EMPTY_PATIENT_INPUTS, generation: 'GEN1_AS', insurerType: 'LIFE' } });
    expectRejected(state, { type: 'NEXT' });
    const chosen = send(state, { type: 'SELECT_CAUSE', code: 'UNKNOWN' });
    expect(chosen.screen).toBe('K02b_Cause');
    expect(chosen.inputs.cause).toBe('UNKNOWN');
    expect(send(chosen, { type: 'NEXT' }).screen).toBe('K03_Treatments');
    expect(send(chosen, { type: 'PREV' }).screen).toBe('K02_Type');
  });

  it('K03 치료 카드 터치 → K03, 반복 터치로 수량이 늘지 않는다 (AC-012e): 선택은 집합이고 다시 누르면 해제된다', () => {
    const state = stateAt('K03_Treatments', { inputs: { ...EMPTY_PATIENT_INPUTS, generation: 'GEN1_AS', insurerType: 'LIFE', cause: 'INJURY' } });
    const once = send(state, { type: 'TOGGLE_TREATMENT', treatmentId: T_XRAY });
    expect(once.screen).toBe('K03_Treatments');
    expect(once.inputs.treatmentIds).toEqual([T_XRAY]);
    const twice = send(once, { type: 'TOGGLE_TREATMENT', treatmentId: T_XRAY });
    expect(twice.inputs.treatmentIds).toEqual([]);
    const again = send(twice, { type: 'TOGGLE_TREATMENT', treatmentId: T_XRAY });
    expect(again.inputs.treatmentIds).toEqual([T_XRAY]);
    expect(Object.keys(again.inputs)).not.toContain('quantity');
  });

  it('K03 "이전" → K02b_Cause (선택 유지, AC-012g)', () => {
    const state = stateAt('K03_Treatments', { inputs: FULL_INPUTS });
    const back = send(state, { type: 'PREV' });
    expect(back.screen).toBe('K02b_Cause');
    expect(back.inputs).toEqual(FULL_INPUTS);
  });

  it('K03 "다음" 은 없다: 4단계의 다음 동작은 "예상 부담액 확인"(M5.B)이다', () => {
    expectRejected(stateAt('K03_Treatments', { inputs: FULL_INPUTS }), { type: 'NEXT' });
  });

  it('AC-012g: 2~4단계에서 "이전"으로 돌아가면 앞서 고른 값이 남아 있다', () => {
    let state = stateAt('K03_Treatments', { inputs: FULL_INPUTS });
    state = send(state, { type: 'PREV' });
    expect(state.inputs.cause).toBe('INJURY');
    state = send(state, { type: 'PREV' });
    expect(state.inputs.insurerType).toBe('NON_LIFE');
    state = send(state, { type: 'PREV' });
    expect(state.screen).toBe('K01_Generation');
    expect(state.inputs).toEqual(FULL_INPUTS);
  });

  it('카드 코드가 options 응답의 카드에 없으면 거절한다 (세대 5·형태 3·원인 3 밖의 값은 저장하지 않는다)', () => {
    expectRejected(stateAt('K01_Generation'), { type: 'SELECT_GENERATION', code: 'GEN5_X' as never });
    expectRejected(stateAt('K02_Type'), { type: 'SELECT_INSURER_TYPE', code: 'ALIEN' as never });
    expectRejected(stateAt('K02b_Cause'), { type: 'SELECT_CAUSE', code: 'OTHER' as never });
    expectRejected(stateAt('K03_Treatments'), { type: 'TOGGLE_TREATMENT', treatmentId: 'NOT_IN_CATALOG' });
  });
});

describe('DD-07 전이표: 치료 목록 페이지 나눔 (선택 유지)', () => {
  const six = stateAt('K03_Treatments', { inputs: { ...FULL_INPUTS, treatmentIds: [T_XRAY, T_SIXTH] } });

  it('"다음 목록" → 둘째 쪽, "이전 목록" → 첫째 쪽, 선택은 그대로다 (AC-012e)', () => {
    const second = send(six, { type: 'TREATMENTS_NEXT_PAGE' });
    expect(second.screen).toBe('K03_Treatments');
    expect(second.inputs).toEqual(six.inputs);
    const first = send(second, { type: 'TREATMENTS_PREV_PAGE' });
    expect(first.inputs).toEqual(six.inputs);
    expect(first.treatmentPageOffset).toBe(0);
  });

  it('마지막 쪽의 "다음 목록"과 첫째 쪽의 "이전 목록"은 거절한다 (버튼이 없다)', () => {
    expectRejected(six, { type: 'TREATMENTS_PREV_PAGE' });
    const last = send(six, { type: 'TREATMENTS_NEXT_PAGE' });
    expectRejected(last, { type: 'TREATMENTS_NEXT_PAGE' });
  });

  it('치료가 한 쪽에 다 들어가면 "다음 목록"은 거절한다', () => {
    const one = stateAt('K03_Treatments', {}, { catalog: makeCatalog({ treatments: [...FOUR_TREATMENTS] }) });
    expectRejected(one, { type: 'TREATMENTS_NEXT_PAGE' });
  });

  it('페이지 이동은 파생 데이터와 inputRevision 을 바꾸지 않는다 (DD-08)', () => {
    const state = resultSessionAt('K03_Treatments', { inputs: { ...FULL_INPUTS, treatmentIds: [T_XRAY, T_SIXTH] } });
    const next = send(state, { type: 'TREATMENTS_NEXT_PAGE' });
    expect(next.derived).toBe(state.derived);
    expect(next.inputRevision).toBe(state.inputRevision);
  });
});

describe('DD-07 전이표: 결과 화면에서 이어지는 행 (결과는 시험이 상태로 직접 저장해 둔다)', () => {
  it.each([
    ['K04_Result', 'INJURY', 'K07_Documents', 'NORMAL'],
    ['K04_Result', 'ILLNESS', 'K07_Documents', 'NORMAL'],
    ['K04_Result', 'UNKNOWN', 'K07_Documents_Unknown', 'NORMAL'],
    ['K04_Result_NotCovered', 'INJURY', 'K07_Documents', 'NOT_COVERED'],
    ['K04_Result_NotCovered', 'ILLNESS', 'K07_Documents', 'NOT_COVERED'],
    ['K04_Result_NotCovered', 'UNKNOWN', 'K07_Documents_Unknown', 'NOT_COVERED'],
  ] as const)('%s + 원인 %s: "보험 청구에 필요한 서류 확인" → %s, 복귀 정보 %s (AC-014g)', (screen, cause, expected, variant) => {
    const state = resultSessionAt(screen, { inputs: { ...FULL_INPUTS, cause } });
    const next = send(state, { type: 'OPEN_DOCUMENTS' });
    expect(next.screen).toBe(expected);
    expect(next.derived.returnContext).toEqual({ resultVariant: variant });
    expect(next.derived.estimate).toBe(state.derived.estimate);
  });

  it.each([
    ['K04_Result', 'NORMAL'],
    ['K04_Result_NotCovered', 'NOT_COVERED'],
  ] as const)('%s: "계산 근거 보기" → K04_Basis_Calculation, 복귀 정보 %s', (screen, variant) => {
    const next = send(resultSessionAt(screen), { type: 'OPEN_BASIS' });
    expect(next.screen).toBe('K04_Basis_Calculation');
    expect(next.derived.returnContext).toEqual({ resultVariant: variant });
  });

  it('보류 결과에는 서류 확인·계산 근거 버튼이 없다: 사건을 거절한다 (DD-07 K04_Result_Hold)', () => {
    expectRejected(resultSessionAt('K04_Result_Hold'), { type: 'OPEN_DOCUMENTS' });
    expectRejected(resultSessionAt('K04_Result_Hold'), { type: 'OPEN_BASIS' });
  });

  it('저장된 결과가 없으면 서류·근거로 갈 수 없다 (계산이 끝난 결과에서만)', () => {
    const noResult = resultSessionAt('K04_Result', { derived: { estimate: null, documents: null, basis: null, returnContext: null } });
    expectRejected(noResult, { type: 'OPEN_DOCUMENTS' });
    expectRejected(noResult, { type: 'OPEN_BASIS' });
  });

  it('원인이 없으면 서류 화면을 고를 수 없다 (방어: 계산 뒤에는 원인이 항상 있다)', () => {
    expectRejected(resultSessionAt('K04_Result', { inputs: { ...FULL_INPUTS, cause: null } }), { type: 'OPEN_DOCUMENTS' });
  });

  it.each(RESULT_SCREENS)('%s: "치료 다시 선택" → K03_Treatments, "보험 조건 수정" → K01_Generation (입력·결과 유지)', (screen) => {
    const state = resultSessionAt(screen);
    const reselect = send(state, { type: 'RESELECT_TREATMENTS' });
    expect(reselect.screen).toBe('K03_Treatments');
    expect(reselect.inputs).toBe(state.inputs);
    expect(reselect.derived).toBe(state.derived);
    const edit = send(state, { type: 'EDIT_INSURANCE' });
    expect(edit.screen).toBe('K01_Generation');
    expect(edit.derived).toBe(state.derived);
  });

  it.each([
    ['K04_Basis_Calculation', 'NORMAL', 'K04_Result'],
    ['K04_Basis_Calculation', 'NOT_COVERED', 'K04_Result_NotCovered'],
    ['K07_Documents', 'NORMAL', 'K04_Result'],
    ['K07_Documents', 'NOT_COVERED', 'K04_Result_NotCovered'],
    ['K07_Documents_Unknown', 'NORMAL', 'K04_Result'],
    ['K07_Documents_Unknown', 'NOT_COVERED', 'K04_Result_NotCovered'],
  ] as const)('%s 에서 복귀 정보 %s → "결과로 돌아가기" → %s (결과 종류로 고정하지 않는다, AC-014e)', (screen, variant, expected) => {
    const state = resultSessionAt(screen, { derived: { estimate: { state: 'ESTIMATED' }, documents: null, basis: null, returnContext: { resultVariant: variant } } });
    const back = send(state, { type: 'RETURN_TO_RESULT' });
    expect(back.screen).toBe(expected);
    expect(back.derived.returnContext).toEqual({ resultVariant: variant });
    expect(back.inputs).toBe(state.inputs);
    expect(back.inputRevision).toBe(state.inputRevision);
  });

  it('복귀 정보가 없으면 "결과로 돌아가기"를 거절한다', () => {
    expectRejected(resultSessionAt('K04_Basis_Calculation'), { type: 'RETURN_TO_RESULT' });
  });
});

describe('DD-07·DD-13 전이표: 이용 완료·처음 화면으로', () => {
  it.each(['K04_Result', 'K04_Result_NotCovered', 'K04_Result_Hold', 'K04_Basis_Calculation', 'K07_Documents', 'K07_Documents_Unknown', 'KXX_Error_Network'] as const)(
    '%s: "이용 완료"(통신 오류는 "이용 종료") → 먼저 전체 삭제, 그다음 K06_Complete (AC-015f)',
    (screen) => {
      const state = resultSessionAt(screen, { display: { largeText: true, orientation: 'LANDSCAPE' } });
      const next = send(state, { type: 'COMPLETE_USE' });
      expect(next.screen).toBe('K06_Complete');
      expect(next.sessionId).not.toBe(state.sessionId);
      expect(next.inputs).toEqual(EMPTY_PATIENT_INPUTS);
      expect(next.derived).toEqual({ estimate: null, documents: null, basis: null, returnContext: null });
      expect(next.display).toEqual({ largeText: false, orientation: 'LANDSCAPE' });
      expect(next.sessionStartedAt).toBe(ENV.now);
    },
  );

  it('K06_Complete "처음 화면으로" → K00_Start (이미 비어 있음)', () => {
    const complete = send(resultSessionAt('K04_Result'), { type: 'COMPLETE_USE' });
    const start = send(complete, { type: 'BACK_TO_START' });
    expect(start.screen).toBe('K00_Start');
    expect(start.inputs).toEqual(EMPTY_PATIENT_INPUTS);
    expect(start.sessionStartedAt).toBe(ENV.now);
  });

  it('K06 에서 켠 큰 글자는 다음 환자에게 넘어가지 않는다: K00 으로 가면 꺼진다 [문서에 없음]', () => {
    const complete = send(resultSessionAt('K04_Result'), { type: 'COMPLETE_USE' });
    const large = send(complete, { type: 'TOGGLE_LARGE_TEXT' });
    expect(large.display.largeText).toBe(true);
    expect(send(large, { type: 'BACK_TO_START' }).display.largeText).toBe(false);
  });
});

describe('DD-07 전이표 "모든 상태" 행: 큰 글자 전환, 화면 방향 변경, 새로고침·페이지 캐시 복원', () => {
  it.each(SCREEN_STATES)('%s: 큰 글자 전환은 같은 상태에 머물고 표시 설정만 바뀐다', (screen) => {
    const state = resultSessionAt(screen, { derived: { estimate: { state: 'ESTIMATED' }, documents: null, basis: null, returnContext: { resultVariant: 'NORMAL' } } });
    const on = send(state, { type: 'TOGGLE_LARGE_TEXT' });
    expect(on.screen).toBe(screen);
    expect(on.display.largeText).toBe(true);
    expect(on.derived).toBe(state.derived);
    expect(on.inputs).toBe(state.inputs);
    expect(on.inputRevision).toBe(state.inputRevision);
    expect(send(on, { type: 'TOGGLE_LARGE_TEXT' }).display.largeText).toBe(false);
  });

  it.each(SCREEN_STATES)('%s: 화면 방향 변경은 같은 상태에 머물고 방향만 바뀐다', (screen) => {
    const state = resultSessionAt(screen);
    const landscape = send(state, { type: 'ORIENTATION_CHANGED', orientation: 'LANDSCAPE' });
    expect(landscape.screen).toBe(screen);
    expect(landscape.display.orientation).toBe('LANDSCAPE');
    expect(landscape.derived).toBe(state.derived);
    expect(landscape.inputs).toBe(state.inputs);
    expect(landscape.inputRevision).toBe(state.inputRevision);
    expect(landscape.lastInteractionAt).toBe(state.lastInteractionAt);
  });

  it('같은 방향이 다시 오면 거절한다 (변경이 아니다)', () => {
    expectRejected(initialState({ orientation: 'LANDSCAPE' }), { type: 'ORIENTATION_CHANGED', orientation: 'LANDSCAPE' });
  });

  it.each(SCREEN_STATES)('%s: 새로고침·뒤로·앞으로·페이지 캐시 복원은 K00_Start 와 새 세션이다', (screen) => {
    const state = resultSessionAt(screen, { display: { largeText: true, orientation: 'LANDSCAPE' } });
    const next = send(state, { type: 'PAGE_RESTORED' });
    expect(next.screen).toBe('K00_Start');
    expect(next.sessionId).not.toBe(state.sessionId);
    expect(next.inputs).toEqual(EMPTY_PATIENT_INPUTS);
    expect(next.derived).toEqual({ estimate: null, documents: null, basis: null, returnContext: null });
    expect(next.display.largeText).toBe(false);
  });
});

// 모든 (화면, 사건) 짝에서 받아들이는가를 표 하나로 정한다: 표에 없는 짝은 모두 거절이어야 한다.
describe('받아들이는 화면 표 (겹침창 없음): 15개 화면 × 사건 전부', () => {
  const PATIENT_SCREENS = SCREEN_STATES.filter((screen) => screen !== 'K00_Start' && screen !== 'K06_Complete');
  const COMPLETE_FROM: ScreenState[] = [...RESULT_SCREENS, 'K04_Basis_Calculation', 'K07_Documents', 'K07_Documents_Unknown', 'KXX_Error_Network'];

  const ACCEPT: ReadonlyArray<[KioskEvent, readonly ScreenState[]]> = [
    [{ type: 'START' }, ['K00_Start']],
    [{ type: 'SELECT_GENERATION', code: 'GEN1_AS' }, ['K01_Generation']],
    [{ type: 'SELECT_INSURER_TYPE', code: 'LIFE' }, ['K02_Type']],
    [{ type: 'SELECT_CAUSE', code: 'ILLNESS' }, ['K02b_Cause']],
    [{ type: 'TOGGLE_TREATMENT', treatmentId: T_PHYSIO }, ['K03_Treatments']],
    [{ type: 'NEXT' }, ['K01_Generation', 'K02_Type', 'K02b_Cause']],
    [{ type: 'PREV' }, ['K02_Type', 'K02b_Cause', 'K03_Treatments']],
    [{ type: 'TREATMENTS_NEXT_PAGE' }, ['K03_Treatments']],
    [{ type: 'OPEN_GENERATION_HELP' }, ['K01_Generation']],
    [{ type: 'CLOSE_GENERATION_HELP' }, ['K01_Generation_Unknown']],
    [{ type: 'OPEN_DOCUMENTS' }, ['K04_Result', 'K04_Result_NotCovered']],
    [{ type: 'OPEN_BASIS' }, ['K04_Result', 'K04_Result_NotCovered']],
    [{ type: 'RETURN_TO_RESULT' }, ['K04_Basis_Calculation', 'K07_Documents', 'K07_Documents_Unknown']],
    [{ type: 'RESELECT_TREATMENTS' }, RESULT_SCREENS],
    [{ type: 'EDIT_INSURANCE' }, RESULT_SCREENS],
    [{ type: 'REQUEST_HOME' }, PATIENT_SCREENS],
    [{ type: 'COMPLETE_USE' }, COMPLETE_FROM],
    [{ type: 'BACK_TO_START' }, ['K06_Complete']],
    [{ type: 'TOGGLE_LARGE_TEXT' }, SCREEN_STATES],
    [{ type: 'INTERACTION' }, PATIENT_SCREENS],
    [{ type: 'ORIENTATION_CHANGED', orientation: 'LANDSCAPE' }, SCREEN_STATES],
    [{ type: 'PAGE_RESTORED' }, SCREEN_STATES],
  ];

  /** 모든 조건(값·결과·복귀 정보·여러 쪽의 치료 목록)이 갖춰진 상태: 거절 사유가 화면 하나뿐이 되게 한다. */
  function rich(screen: ScreenState): KioskState {
    return resultSessionAt(screen, {
      inputs: { ...FULL_INPUTS, treatmentIds: [T_XRAY, T_KIDNEY_SPRAY] },
      derived: { estimate: { state: screen === 'K04_Result_NotCovered' ? 'ESTIMATED_WITH_EXCLUSIONS' : 'ESTIMATED' }, documents: null, basis: null, returnContext: { resultVariant: 'NORMAL' } },
    });
  }

  it('표는 15개 화면 모두를 한 번 이상 받아들이는 사건이 있다 (빈 표 방지)', () => {
    const covered = new Set(ACCEPT.flatMap(([, screens]) => screens));
    expect([...covered].sort()).toEqual([...SCREEN_STATES].sort());
  });

  it.each(ACCEPT.map(([event, screens]) => [event.type, event, screens] as const))('%s', (_name, event, screens) => {
    for (const screen of SCREEN_STATES) {
      const state = rich(screen);
      const next = reduce(state, event, ENV);
      expect(next !== state, `${event.type} @ ${screen}`).toBe(screens.includes(screen));
    }
  });

  it('표가 다루는 사건 종류 + 시계 사건(TICK)이 EVENT_SPECS 의 모든 사건과 정확히 일치한다', () => {
    const covered = new Set<string>([...ACCEPT.map(([event]) => event.type), 'TICK', 'TREATMENTS_PREV_PAGE', 'CONFIRM_RESET', 'CANCEL_RESET', 'CONTINUE_USING', 'REQUEST_ESTIMATE', 'ESTIMATE_RESPONDED', 'ESTIMATE_FAILED', 'ESTIMATE_EXPIRED', 'RETRY_REFRESH', 'REFRESH_RESOLVED', 'REFRESH_FAILED', 'REFRESH_EXPIRED']);
    expect([...covered].sort()).toEqual(Object.keys(EVENT_SPECS).sort());
  });
});
