import { describe, expect, it } from 'vitest';
import { TREATMENTS_PER_PAGE, selectLayout } from '../../../src/app/kiosk/state/display';
import { EVENT_SPECS, reduce } from '../../../src/app/kiosk/state/machine';
import type { KioskEvent } from '../../../src/app/kiosk/state/events';
import { canGoNext, canRequestEstimate, selectStep, selectTotals, selectTreatmentPage } from '../../../src/app/kiosk/state/selectors';
import type { KioskState } from '../../../src/app/kiosk/state/session-store';
import { FOUR_TREATMENTS, T_FIFTH, T_KIDNEY_SPRAY, T_PHYSIO, T_SIXTH, T_ULTRASOUND, T_XRAY, makeCatalog } from '../../fixtures/kiosk/clinic.fixture';
import { EMPTY_PATIENT_INPUTS, FULL_INPUTS, initialState, makeEnv, resultSessionAt, stateAt } from '../../fixtures/kiosk/state.fixture';

// 표시 설정(큰 글자·관찰한 화면 방향), 파생 값(선택 요약·페이지·단계·확인 버튼 활성), 증거: AC-012a·b·e·f·i, AC-014e·h·i.
// 모든 것은 상태에서 읽는 순수 함수라서 상태를 만들어 값을 읽는다.

const ENV = makeEnv(10_000);
const send = (state: KioskState, event: KioskEvent): KioskState => reduce(state, event, ENV);
const sendAll = (state: KioskState, ...events: KioskEvent[]): KioskState => events.reduce(send, state);

describe('AC-012f 증거: 선택 요약 (엔진의 합산 함수)', () => {
  const four = (ids: string[]) => stateAt('K03_Treatments', { inputs: { ...FULL_INPUTS, treatmentIds: ids } }, { catalog: makeCatalog({ treatments: [...FOUR_TREATMENTS] }) });

  it('예시 4종을 모두 고르면 선택 4개, 급여 14,000 · 비급여 110,000 · 총 예상 결제액 124,000 이다', () => {
    expect(selectTotals(four([T_XRAY, T_ULTRASOUND, T_KIDNEY_SPRAY, T_PHYSIO]))).toEqual({ selectedCount: 4, benefit: 14_000, nonBenefit: 110_000, total: 124_000 });
  });

  it('일부만 고르면 그 치료의 합이다. 고르는 순서와 상관없다', () => {
    expect(selectTotals(four([T_PHYSIO, T_XRAY]))).toEqual({ selectedCount: 2, benefit: 10_000, nonBenefit: 70_000, total: 80_000 });
    expect(selectTotals(four([T_XRAY, T_PHYSIO]))).toEqual(selectTotals(four([T_PHYSIO, T_XRAY])));
  });

  it('아무것도 고르지 않으면 0 개, 합계 0 이다 (결과가 아니라 선택 요약이며 확인 버튼은 비활성이다)', () => {
    expect(selectTotals(four([]))).toEqual({ selectedCount: 0, benefit: 0, nonBenefit: 0, total: 0 });
  });

  it('공통 기본비용이 등록된 병원은 치료를 하나 이상 고르면 기본비용 줄이 합계에 들어간다 (서버의 병원 결제액 T 와 같은 기준)', () => {
    const catalog = makeCatalog({
      treatments: [...FOUR_TREATMENTS],
      baseFees: [
        { baseFeeId: 'TEST_FIXTURE_FEE_1', displayName: 'TEST_FIXTURE 기본비용', benefitType: 'BENEFIT', amount: 500 },
        { baseFeeId: 'TEST_FIXTURE_FEE_2', displayName: 'TEST_FIXTURE 기본비용 2', benefitType: 'NON_BENEFIT', amount: 200 },
      ],
      baseFeeIncluded: 'INCLUDED',
    });
    const withFees = (ids: string[]) => stateAt('K03_Treatments', { inputs: { ...FULL_INPUTS, treatmentIds: ids } }, { catalog });
    expect(selectTotals(withFees([T_XRAY]))).toEqual({ selectedCount: 1, benefit: 10_500, nonBenefit: 200, total: 10_700 });
    expect(selectTotals(withFees([]))).toEqual({ selectedCount: 0, benefit: 0, nonBenefit: 0, total: 0 });
  });

  it('카탈로그에 없는 치료 id 는 합계에 넣지 않는다', () => {
    expect(selectTotals(four([T_XRAY, 'NOT_IN_CATALOG']))).toEqual({ selectedCount: 1, benefit: 10_000, nonBenefit: 0, total: 10_000 });
  });
});

describe('치료 목록 페이지 (AC-012e 증거: 선택 유지, 큰 글자에서는 한 쪽 2개)', () => {
  const k03 = (patch: Partial<KioskState> = {}, treatments = 6) =>
    stateAt('K03_Treatments', { inputs: { ...FULL_INPUTS, treatmentIds: [T_XRAY, T_SIXTH] }, ...patch }, { catalog: makeCatalog({ treatments: [...makeCatalog().treatments.slice(0, treatments)] }) });

  it('한 쪽 4개(큰 글자 2개)이다 (DD-12 의 디자인 명세 예, [문서에 없음] 가로형의 개수는 정하지 않았다)', () => {
    expect(TREATMENTS_PER_PAGE).toEqual({ normal: 4, largeText: 2 });
  });

  it('첫째 쪽: 치료 4개, 선택 표시는 선택한 것만, 다음 쪽이 있고 이전 쪽은 없다', () => {
    const page = selectTreatmentPage(k03());
    expect(page.items.map((item) => [item.treatment.treatmentId, item.selected])).toEqual([
      [T_XRAY, true],
      [T_ULTRASOUND, false],
      [T_KIDNEY_SPRAY, false],
      [T_PHYSIO, false],
    ]);
    expect([page.pageIndex, page.pageCount, page.pageSize, page.hasPrev, page.hasNext]).toEqual([0, 2, 4, false, true]);
  });

  it('둘째 쪽: 나머지 둘, 선택한 여섯째 치료의 표시가 유지된다', () => {
    const page = selectTreatmentPage(sendAll(k03(), { type: 'TREATMENTS_NEXT_PAGE' }));
    expect(page.items.map((item) => [item.treatment.treatmentId, item.selected])).toEqual([
      [T_FIFTH, false],
      [T_SIXTH, true],
    ]);
    expect([page.pageIndex, page.hasPrev, page.hasNext]).toEqual([1, true, false]);
  });

  it('큰 글자를 켜면 한 쪽 2개가 되고, 보던 쪽의 첫 치료가 들어 있는 쪽으로 맞춘다. 끄면 원래대로다', () => {
    const second = sendAll(k03(), { type: 'TREATMENTS_NEXT_PAGE' }); // offset 4: 다섯째·여섯째
    const large = send(second, { type: 'TOGGLE_LARGE_TEXT' });
    const page = selectTreatmentPage(large);
    expect([page.pageSize, page.pageIndex, page.pageCount]).toEqual([2, 2, 3]);
    expect(page.items.map((item) => item.treatment.treatmentId)).toEqual([T_FIFTH, T_SIXTH]);
    const back = selectTreatmentPage(send(large, { type: 'TOGGLE_LARGE_TEXT' }));
    expect([back.pageSize, back.pageIndex]).toEqual([4, 1]);
  });

  it('큰 글자 켠 상태의 쪽 이동은 2개씩이다', () => {
    const large = sendAll(k03(), { type: 'TOGGLE_LARGE_TEXT' }, { type: 'TREATMENTS_NEXT_PAGE' });
    expect(selectTreatmentPage(large).items.map((item) => item.treatment.treatmentId)).toEqual([T_KIDNEY_SPRAY, T_PHYSIO]);
    expect(selectTreatmentPage(sendAll(large, { type: 'TREATMENTS_PREV_PAGE' })).pageIndex).toBe(0);
  });

  it('치료 수가 줄어 보던 위치가 범위를 벗어나면 마지막 쪽으로 맞춘다', () => {
    const page = selectTreatmentPage(k03({ treatmentPageOffset: 400 }));
    expect([page.pageIndex, page.hasNext, page.items.length]).toEqual([1, false, 2]);
  });

  it('치료가 없는 병원: 빈 한 쪽이다', () => {
    const page = selectTreatmentPage(k03({}, 0));
    expect([page.items.length, page.pageCount, page.hasPrev, page.hasNext]).toEqual([0, 1, false, false]);
  });
});

describe('확인 버튼·다음 버튼·단계 표시의 파생 값', () => {
  it('"예상 부담액 확인"은 치료가 1개 이상이고 갱신이 필요하지 않을 때만 활성이다 (AC-012b, DD-09 규칙 1)', () => {
    expect(canRequestEstimate(stateAt('K03_Treatments', { inputs: EMPTY_PATIENT_INPUTS }))).toBe(false);
    expect(canRequestEstimate(stateAt('K03_Treatments', { inputs: FULL_INPUTS }))).toBe(true);
    expect(canRequestEstimate(stateAt('K03_Treatments', { inputs: FULL_INPUTS, refreshState: 'RUNNING' }))).toBe(false);
    expect(canRequestEstimate(stateAt('K03_Treatments', { inputs: FULL_INPUTS, refreshState: 'FAILED' }))).toBe(false);
    expect(canRequestEstimate(stateAt('K03_Treatments', { inputs: { ...FULL_INPUTS, treatmentIds: [] }, refreshState: 'NONE' }))).toBe(false);
  });

  it.each([
    ['K01_Generation', { ...EMPTY_PATIENT_INPUTS }, false],
    ['K01_Generation', { ...EMPTY_PATIENT_INPUTS, generation: 'GEN2_C1' as const }, true],
    ['K02_Type', { ...EMPTY_PATIENT_INPUTS, generation: 'GEN2_C1' as const }, false],
    ['K02_Type', { ...EMPTY_PATIENT_INPUTS, insurerType: 'LIFE' as const }, true],
    ['K02b_Cause', { ...EMPTY_PATIENT_INPUTS, generation: 'GEN2_C1' as const }, false],
    ['K02b_Cause', { ...EMPTY_PATIENT_INPUTS, cause: 'UNKNOWN' as const }, true],
    ['K03_Treatments', FULL_INPUTS, false],
    ['K04_Result', FULL_INPUTS, false],
  ] as const)('"다음": %s, 입력 %j → %s (AC-012b: 1~3단계에서 값이 있을 때만 활성)', (screen, inputs, expected) => {
    expect(canGoNext(stateAt(screen, { inputs }))).toBe(expected);
  });

  it.each([
    ['K01_Generation', 1],
    ['K02_Type', 2],
    ['K02b_Cause', 3],
    ['K03_Treatments', 4],
  ] as const)('%s 의 단계 표시는 %i/4 이다 (AC-012a)', (screen, index) => {
    expect(selectStep(stateAt(screen))).toEqual({ index, total: 4 });
  });

  it.each(['K00_Start', 'K01_Generation_Unknown', 'Calculating', 'K04_Result', 'K06_Complete'] as const)('%s 에는 단계 표시가 없다', (screen) => {
    expect(selectStep(stateAt(screen))).toBeNull();
  });
});

describe('표시 설정: 큰 글자와 관찰한 화면 방향은 파생 데이터가 아니고 복귀 정보에 들어가지 않는다 (DD-11)', () => {
  const withResult = (screen: KioskState['screen'], orientation: 'PORTRAIT' | 'LANDSCAPE') =>
    resultSessionAt(screen, { display: { largeText: false, orientation } });

  it('AC-014e·AC-014i: 가로 결과 → 근거 화면에서 세로로 바꾸고 돌아오면 들어온 결과 종류의 세로형이 나오고 선택·결과·금액·inputRevision 이 그대로다', () => {
    const start = withResult('K04_Result_NotCovered', 'LANDSCAPE');
    const atBasis = send(start, { type: 'OPEN_BASIS' });
    const rotated = send(atBasis, { type: 'ORIENTATION_CHANGED', orientation: 'PORTRAIT' });
    expect(rotated.screen).toBe('K04_Basis_Calculation');
    const back = send(rotated, { type: 'RETURN_TO_RESULT' });
    expect(selectLayout(back)).toEqual({ screen: 'K04_Result_NotCovered', orientation: 'PORTRAIT', largeText: false });
    expect(back.inputs).toBe(start.inputs);
    expect(back.derived.estimate).toBe(start.derived.estimate);
    expect(back.inputRevision).toBe(start.inputRevision);
    expect(back.activeRequest).toBeNull();
  });

  it('AC-014i: 반대 방향(세로 → 가로)과 서류 화면도 같다', () => {
    const atDocs = send(withResult('K04_Result', 'PORTRAIT'), { type: 'OPEN_DOCUMENTS' });
    const back = send(send(atDocs, { type: 'ORIENTATION_CHANGED', orientation: 'LANDSCAPE' }), { type: 'RETURN_TO_RESULT' });
    expect(selectLayout(back)).toEqual({ screen: 'K04_Result', orientation: 'LANDSCAPE', largeText: false });
  });

  it.each(['OPEN_BASIS', 'OPEN_DOCUMENTS'] as const)('AC-014h: %s 로 들어간 화면에서 큰 글자를 켰다 끄면 그 화면에 머물고, 켜 둔 채 돌아오면 큰 글자가 남는다', (open) => {
    const inside = send(withResult('K04_Result', 'PORTRAIT'), { type: open });
    const screen = inside.screen;
    const on = send(inside, { type: 'TOGGLE_LARGE_TEXT' });
    expect(on.screen).toBe(screen);
    expect(send(on, { type: 'TOGGLE_LARGE_TEXT' }).display.largeText).toBe(false);
    const back = send(on, { type: 'RETURN_TO_RESULT' });
    expect(selectLayout(back)).toEqual({ screen: 'K04_Result', orientation: 'PORTRAIT', largeText: true });
    expect(back.derived.returnContext).toEqual({ resultVariant: 'NORMAL' });
    expect(back.inputs).toBe(inside.inputs);
    expect(back.inputRevision).toBe(inside.inputRevision);
    expect(back.activeRequest).toBeNull();
    expect(back.refreshState).toBe('NONE');
  });

  it('AC-014h: 원인 모름의 서류 화면(K07_Documents_Unknown)에서도 같다', () => {
    const state = resultSessionAt('K04_Result', { inputs: { ...FULL_INPUTS, cause: 'UNKNOWN' } });
    const inside = send(state, { type: 'OPEN_DOCUMENTS' });
    expect(inside.screen).toBe('K07_Documents_Unknown');
    const toggled = sendAll(inside, { type: 'TOGGLE_LARGE_TEXT' }, { type: 'TOGGLE_LARGE_TEXT' }, { type: 'TOGGLE_LARGE_TEXT' });
    expect(toggled.screen).toBe('K07_Documents_Unknown');
    expect(selectLayout(send(toggled, { type: 'RETURN_TO_RESULT' })).largeText).toBe(true);
  });

  it('큰 글자는 초기화 때 꺼지지만 화면 방향(관찰값)은 기기의 상태라 유지된다', () => {
    const state = resultSessionAt('K04_Result', { display: { largeText: true, orientation: 'LANDSCAPE' } });
    const reset = send(state, { type: 'COMPLETE_USE' });
    expect(reset.display).toEqual({ largeText: false, orientation: 'LANDSCAPE' });
  });
});

describe('AC-012i 증거: 가입일(날짜) 입력이 없고 세대를 미리 정하거나 제안하지 않는다', () => {
  it('사건 종류 어디에도 날짜·가입일·생년월일을 다루는 것이 없다', () => {
    expect(Object.keys(EVENT_SPECS).filter((type) => /DATE|ENROLL|JOIN|BIRTH|DAY/i.test(type))).toEqual([]);
  });

  it('세대는 SELECT_GENERATION 으로만 정해진다: 선택 사건을 뺀 모든 사건을 어떤 순서로 보내도 세대는 비어 있다', () => {
    const others: KioskEvent[] = [
      { type: 'START' }, { type: 'NEXT' }, { type: 'PREV' }, { type: 'OPEN_GENERATION_HELP' }, { type: 'CLOSE_GENERATION_HELP' },
      { type: 'TREATMENTS_NEXT_PAGE' }, { type: 'REQUEST_HOME' }, { type: 'CANCEL_RESET' }, { type: 'TOGGLE_LARGE_TEXT' }, { type: 'INTERACTION' },
      { type: 'ORIENTATION_CHANGED', orientation: 'LANDSCAPE' }, { type: 'PAGE_RESTORED' }, { type: 'TICK' },
    ];
    let frontier: KioskState[] = [initialState()];
    for (let depth = 0; depth < 4; depth += 1) {
      frontier = frontier.flatMap((state) => others.map((event) => send(state, event)));
      expect(frontier.every((state) => state.inputs.generation === null)).toBe(true);
    }
  });

  it('시작 직후 K01 에는 미리 선택된 카드가 없다 (AC-012a: 이전 금액·선택이 없는 빈 세션)', () => {
    const k01 = send(initialState(), { type: 'START' });
    expect(k01.inputs).toEqual(EMPTY_PATIENT_INPUTS);
    expect(k01.derived).toEqual({ estimate: null, documents: null, basis: null, returnContext: null });
  });
});
