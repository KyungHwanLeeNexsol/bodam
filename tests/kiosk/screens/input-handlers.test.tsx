import { beforeEach, describe, expect, it, vi } from 'vitest';
import { K01Generation } from '../../../src/app/kiosk/screens/K01Generation';
import { K01GenerationHelp } from '../../../src/app/kiosk/screens/K01GenerationHelp';
import { K02Type } from '../../../src/app/kiosk/screens/K02Type';
import { K02bCause } from '../../../src/app/kiosk/screens/K02bCause';
import { K03Treatments } from '../../../src/app/kiosk/screens/K03Treatments';
import type { KioskState } from '../../../src/app/kiosk/state/session-store';
import { T_FIFTH, T_KIDNEY_SPRAY, T_PHYSIO, T_ULTRASOUND, T_XRAY, makeCatalog } from '../../fixtures/kiosk/clinic.fixture';
import { stateAt } from '../../fixtures/kiosk/state.fixture';
import { buttonsOf, inputsOf } from './tree';

// 입력 단계 화면의 단추·카드와 사건의 연결 (BRIEF D14, AC-012a~i·AC-014d·AC-020i): 화면은 눌림을 사건 하나로 바꿀 뿐이고 전이 규칙은 상태 기계가 가진다.
// DOM 없이 시험한다: 화면을 요소 트리로 펼쳐(훅은 가짜) 호스트 <button>·<input> 의 핸들러를 직접 부른다. 실제 클릭·초점·키보드는 브라우저 시험(tests/e2e)이 본다.

const mocks = vi.hoisted(() => ({ send: vi.fn(), focus: vi.fn(), state: null as unknown }));

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), useId: () => 'ID', useRef: () => ({ current: { focus: mocks.focus } }) }));
vi.mock('../../../src/app/kiosk/runtime/kiosk-context', () => ({
  useKiosk: () => ({ state: mocks.state, send: mocks.send, read: (selector: (state: unknown, now: number) => unknown) => selector(mocks.state, 0) }),
}));

const use = (state: KioskState): void => {
  mocks.state = state;
};
const sent = (): unknown[] => mocks.send.mock.calls.map((call) => call[0]);

beforeEach(() => {
  mocks.send.mockReset();
  mocks.focus.mockReset();
});

const RUNNING: Partial<KioskState> = {
  refreshState: 'RUNNING',
  activeRefresh: { refreshId: 'RFR-FIXTURE-0001', sessionId: 'SESSION-1', inputRevision: 1, reason: 'VERSION_MISMATCH' as const },
};

describe('K01Generation (AC-012a·b·d·h·i)', () => {
  it('카드는 options 응답의 세대 다섯 장 그대로이고 어느 것도 미리 선택되어 있지 않다', () => {
    use(stateAt('K01_Generation'));
    const radios = inputsOf(K01Generation());
    expect(radios).toHaveLength(5);
    expect(radios.every((radio) => radio.type === 'radio' && !radio.checked)).toBe(true);
  });

  it('카드를 누르면 SELECT_GENERATION 을 코드와 함께 보낸다 (선택된 카드가 표시된다)', () => {
    use(stateAt('K01_Generation', { inputs: { generation: 'GEN3_C3', insurerType: null, cause: null, treatmentIds: [] } }));
    const radios = inputsOf(K01Generation());
    expect(radios.map((radio) => radio.checked)).toEqual([false, false, false, true, false]);
    radios.forEach((radio) => radio.change());
    expect(sent()).toEqual([
      { type: 'SELECT_GENERATION', code: 'GEN1_AS' },
      { type: 'SELECT_GENERATION', code: 'GEN2_C1' },
      { type: 'SELECT_GENERATION', code: 'GEN2_5_C2' },
      { type: 'SELECT_GENERATION', code: 'GEN3_C3' },
      { type: 'SELECT_GENERATION', code: 'GEN4_C4' },
    ]);
  });

  it('"다음" 은 세대를 고르기 전에는 비활성이고 눌러도 사건이 없다 (AC-012b)', () => {
    use(stateAt('K01_Generation'));
    const next = buttonsOf(K01Generation()).find((entry) => entry.label === '다음');
    expect(next?.ariaDisabled).toBe(true);
    next?.click();
    expect(sent()).toEqual([]);
  });

  it('세대를 고르면 "다음" 이 NEXT 를 보낸다', () => {
    use(stateAt('K01_Generation', { inputs: { generation: 'GEN2_C1', insurerType: null, cause: null, treatmentIds: [] } }));
    const next = buttonsOf(K01Generation()).find((entry) => entry.label === '다음');
    expect(next?.ariaDisabled).toBe(false);
    next?.click();
    expect(sent()).toEqual([{ type: 'NEXT' }]);
  });

  it('"세대를 모르겠어요" 와 안내 패널의 "확인 방법 보기" 는 모두 OPEN_GENERATION_HELP 하나를 보낸다 (계산 요청 없음, AC-012d)', () => {
    use(stateAt('K01_Generation'));
    const all = buttonsOf(K01Generation());
    expect(all.map((entry) => entry.label)).toEqual(['세대를 모르겠어요', '확인 방법 보기', '처음으로', '다음']);
    all[0]?.click();
    all[1]?.click();
    expect(sent()).toEqual([{ type: 'OPEN_GENERATION_HELP' }, { type: 'OPEN_GENERATION_HELP' }]);
  });

  it('왼쪽 아래 "처음으로" 는 REQUEST_HOME 이다 (처음으로 확인창은 상태 기계가 연다)', () => {
    use(stateAt('K01_Generation'));
    buttonsOf(K01Generation()).find((entry) => entry.label === '처음으로')?.click();
    expect(sent()).toEqual([{ type: 'REQUEST_HOME' }]);
  });
});

describe('K01GenerationHelp (AC-012d)', () => {
  it('단추는 "보험 선택으로 돌아가기" 하나이고 CLOSE_GENERATION_HELP 를 보낸다', () => {
    use(stateAt('K01_Generation_Unknown'));
    const all = buttonsOf(K01GenerationHelp());
    expect(all.map((entry) => entry.label)).toEqual(['보험 선택으로 돌아가기']);
    all[0]?.click();
    expect(sent()).toEqual([{ type: 'CLOSE_GENERATION_HELP' }]);
  });
});

describe.each([
  ['K02Type', K02Type, 'K02_Type', 'SELECT_INSURER_TYPE', ['NON_LIFE', 'LIFE', 'MUTUAL_AID'], { generation: 'GEN2_C1', insurerType: 'LIFE', cause: null, treatmentIds: [] }],
  ['K02bCause', K02bCause, 'K02b_Cause', 'SELECT_CAUSE', ['INJURY', 'ILLNESS', 'UNKNOWN'], { generation: 'GEN2_C1', insurerType: 'LIFE', cause: 'UNKNOWN', treatmentIds: [] }],
] as const)('%s (AC-012b·c·g)', (_name, Screen, screen, eventType, codes, filled) => {
  it('카드는 응답의 세 장 그대로이고 누르면 선택 사건을 코드와 함께 보낸다', () => {
    use(stateAt(screen, { inputs: { ...filled, insurerType: screen === 'K02_Type' ? null : 'LIFE', cause: null } }));
    const radios = inputsOf(Screen());
    expect(radios).toHaveLength(3);
    expect(radios.every((radio) => !radio.checked)).toBe(true);
    radios.forEach((radio) => radio.change());
    expect(sent()).toEqual(codes.map((code) => ({ type: eventType, code })));
  });

  it('고른 카드가 표시되고 "다음" 이 NEXT 를 보낸다; 고르기 전에는 비활성이다', () => {
    use(stateAt(screen, { inputs: { ...filled, insurerType: screen === 'K02_Type' ? null : 'LIFE', cause: null } }));
    const before = buttonsOf(Screen()).find((entry) => entry.label === '다음');
    expect(before?.ariaDisabled).toBe(true);
    before?.click();
    expect(sent()).toEqual([]);

    use(stateAt(screen, { inputs: filled }));
    const radios = inputsOf(Screen());
    expect(radios.filter((radio) => radio.checked)).toHaveLength(1);
    const after = buttonsOf(Screen()).find((entry) => entry.label === '다음');
    expect(after?.ariaDisabled).toBe(false);
    after?.click();
    expect(sent()).toEqual([{ type: 'NEXT' }]);
  });

  it('하단 단추는 처음으로·이전·다음 순서이고 각각 REQUEST_HOME·PREV·NEXT 이다 ("직원에게 문의" 단추는 없다, AC-012c)', () => {
    use(stateAt(screen, { inputs: filled }));
    const all = buttonsOf(Screen());
    expect(all.map((entry) => entry.label)).toEqual(['처음으로', '이전', '다음']);
    all.forEach((entry) => entry.click());
    expect(sent()).toEqual([{ type: 'REQUEST_HOME' }, { type: 'PREV' }, { type: 'NEXT' }]);
  });
});

describe('K03Treatments (AC-012e·f·014d·019c·020i)', () => {
  const picked = (ids: string[], patch: Partial<KioskState> = {}): KioskState =>
    stateAt('K03_Treatments', { inputs: { generation: 'GEN2_C1', insurerType: 'NON_LIFE', cause: 'INJURY', treatmentIds: ids }, ...patch });

  it('한 쪽에 치료 카드 네 장(체크박스)을 그리고 선택된 것이 표시된다; 다섯째·여섯째는 다음 쪽에 있다', () => {
    use(picked([T_ULTRASOUND]));
    const boxes = inputsOf(K03Treatments());
    expect(boxes).toHaveLength(4);
    expect(boxes.every((box) => box.type === 'checkbox')).toBe(true);
    expect(boxes.map((box) => box.checked)).toEqual([false, true, false, false]);
  });

  it('카드를 누르면 TOGGLE_TREATMENT 를 치료 id 와 함께 보낸다 (해제도 같은 사건이다)', () => {
    use(picked([T_ULTRASOUND]));
    inputsOf(K03Treatments()).forEach((box) => box.change());
    expect(sent()).toEqual([T_XRAY, T_ULTRASOUND, T_KIDNEY_SPRAY, T_PHYSIO].map((treatmentId) => ({ type: 'TOGGLE_TREATMENT', treatmentId })));
  });

  it('치료를 고르기 전에는 "예상 부담액 확인" 이 비활성이고 눌러도 사건이 없다', () => {
    use(picked([]));
    const confirm = buttonsOf(K03Treatments()).find((entry) => entry.label === '예상 부담액 확인');
    expect(confirm?.ariaDisabled).toBe(true);
    confirm?.click();
    expect(sent()).toEqual([]);
  });

  it('치료를 하나 이상 고르면 "예상 부담액 확인" 이 REQUEST_ESTIMATE 를 보낸다', () => {
    use(picked([T_XRAY]));
    const confirm = buttonsOf(K03Treatments()).find((entry) => entry.label === '예상 부담액 확인');
    expect(confirm?.ariaDisabled).toBe(false);
    confirm?.click();
    expect(sent()).toEqual([{ type: 'REQUEST_ESTIMATE' }]);
  });

  it('쪽 넘김 단추는 TREATMENTS_NEXT_PAGE·TREATMENTS_PREV_PAGE 만 보낸다 (선택·계산 사건이 아니다); 첫 쪽의 "이전 목록" 은 비활성이다', () => {
    use(picked([T_XRAY]));
    const first = buttonsOf(K03Treatments()).filter((entry) => entry.className.includes('kiosk-pager__button'));
    expect(first.map((entry) => [entry.label, entry.ariaDisabled])).toEqual([
      ['이전 목록', true],
      ['다음 목록', false],
    ]);
    first.forEach((entry) => entry.click());
    expect(sent()).toEqual([{ type: 'TREATMENTS_NEXT_PAGE' }]);

    mocks.send.mockReset();
    use(picked([T_XRAY], { treatmentPageOffset: 4 }));
    const second = buttonsOf(K03Treatments()).filter((entry) => entry.className.includes('kiosk-pager__button'));
    expect(second.map((entry) => [entry.label, entry.ariaDisabled])).toEqual([
      ['이전 목록', false],
      ['다음 목록', true],
    ]);
    second.forEach((entry) => entry.click());
    expect(sent()).toEqual([{ type: 'TREATMENTS_PREV_PAGE' }]);
  });

  it('둘째 쪽에는 다섯째·여섯째 치료만 있고 첫 쪽에서 고른 치료의 선택은 그대로 합계에 남는다', () => {
    use(picked([T_XRAY], { treatmentPageOffset: 4 }));
    const boxes = inputsOf(K03Treatments());
    expect(boxes).toHaveLength(2);
    expect(boxes.map((box) => box.checked)).toEqual([false, false]);
  });

  it('하단 단추는 처음으로·이전·예상 부담액 확인 순서이다 (REQUEST_HOME·PREV·REQUEST_ESTIMATE)', () => {
    use(picked([T_XRAY]));
    const all = buttonsOf(K03Treatments()).filter((entry) => !entry.className.includes('kiosk-pager__button'));
    expect(all.map((entry) => entry.label)).toEqual(['처음으로', '이전', '예상 부담액 확인']);
    all.forEach((entry) => entry.click());
    expect(sent()).toEqual([{ type: 'REQUEST_HOME' }, { type: 'PREV' }, { type: 'REQUEST_ESTIMATE' }]);
  });

  describe('자료 갱신 중 (DD-09, AC-020i)', () => {
    it('치료 카드를 눌러도 사건이 없고 카드는 aria-disabled 이다', () => {
      use(picked([T_XRAY], RUNNING));
      const boxes = inputsOf(K03Treatments());
      expect(boxes.every((box) => box.ariaDisabled)).toBe(true);
      boxes.forEach((box) => box.change());
      expect(sent()).toEqual([]);
    });

    it('"이전" 은 비활성이고 눌러도 사건이 없다; "처음으로"·쪽 넘김은 계속 동작한다 (BRIEF D5)', () => {
      use(picked([T_XRAY], RUNNING));
      const all = buttonsOf(K03Treatments());
      const previous = all.find((entry) => entry.label === '이전');
      expect(previous?.ariaDisabled).toBe(true);
      previous?.click();
      expect(sent()).toEqual([]);
      all.find((entry) => entry.label === '처음으로')?.click();
      all.find((entry) => entry.label === '다음 목록')?.click();
      expect(sent()).toEqual([{ type: 'REQUEST_HOME' }, { type: 'TREATMENTS_NEXT_PAGE' }]);
    });

    it('"예상 부담액 확인" 은 갱신 중에 눌러도 REQUEST_ESTIMATE 를 보내지 않는다 (canRequestEstimate 가 막는다)', () => {
      use(picked([T_XRAY], RUNNING));
      const confirm = buttonsOf(K03Treatments()).find((entry) => entry.label === '예상 부담액 확인');
      expect(confirm?.ariaDisabled).toBe(true);
      confirm?.click();
      expect(sent()).toEqual([]);
    });

    it('이미 잠긴 뒤에 도착한 눌림도 보내는 순간의 상태로 한 번 더 막는다 (그리는 값이 낡았어도 사건이 나가지 않는다)', () => {
      // 그릴 때는 잠기지 않았다가(NONE) 누르는 순간 잠긴(RUNNING) 경우: read() 는 누른 순간의 mocks.state 를 읽는다.
      use(picked([T_XRAY]));
      const boxes = inputsOf(K03Treatments());
      const all = buttonsOf(K03Treatments());
      use(picked([T_XRAY], RUNNING));
      boxes.forEach((box) => box.change());
      all.find((entry) => entry.label === '이전')?.click();
      expect(sent()).toEqual([]);
    });
  });

  describe('갱신 실패·성공 안내', () => {
    const FAILED: Partial<KioskState> = { refreshState: 'FAILED' };

    it('실패하면 인라인 "다시 시도" 가 RETRY_REFRESH 를 보내고 계산 사건(REQUEST_ESTIMATE)은 보내지 않는다', () => {
      use(picked([T_XRAY], FAILED));
      const retry = buttonsOf(K03Treatments()).find((entry) => entry.label === '다시 시도');
      expect(retry).toBeDefined();
      retry?.click();
      expect(sent()).toEqual([{ type: 'RETRY_REFRESH' }]);
      expect(mocks.focus).toHaveBeenCalledTimes(1);
    });

    it('실패 상태에서는 잠금이 풀려 있다 (잠금은 진행 중에만): 카드는 눌리고 "예상 부담액 확인" 은 비활성이다', () => {
      use(picked([T_XRAY], FAILED));
      const boxes = inputsOf(K03Treatments());
      expect(boxes.some((box) => box.ariaDisabled)).toBe(false);
      boxes[1]?.change();
      expect(sent()).toEqual([{ type: 'TOGGLE_TREATMENT', treatmentId: T_ULTRASOUND }]);
      expect(buttonsOf(K03Treatments()).find((entry) => entry.label === '예상 부담액 확인')?.ariaDisabled).toBe(true);
    });

    it('"다시 시도" 를 누르는 순간 이미 재시도할 수 없는 상태면 사건을 보내지 않는다', () => {
      use(picked([T_XRAY], FAILED));
      const retry = buttonsOf(K03Treatments()).find((entry) => entry.label === '다시 시도');
      use(picked([T_XRAY], RUNNING));
      retry?.click();
      expect(sent()).toEqual([]);
    });

    it('성공한 갱신이 선택에서 뺀 치료의 안내를 보이고 자동으로 계산하지 않는다 (다시 확인 단추가 켜져 있다)', () => {
      use(picked([T_XRAY], { refreshNotice: { removed: [{ treatmentId: T_PHYSIO, displayName: '물리치료' }] } }));
      const all = buttonsOf(K03Treatments());
      expect(sent()).toEqual([]);
      expect(all.find((entry) => entry.label === '예상 부담액 확인')?.ariaDisabled).toBe(false);
    });
  });

  it('치료가 하나도 게시되지 않은 병원 자료도 그린다 (빈 목록 안내만, 쪽 넘김은 비활성)', () => {
    use(stateAt('K03_Treatments', { clinic: { ...stateAt('K03_Treatments').clinic, catalog: makeCatalog({ treatments: [] }) } }));
    expect(inputsOf(K03Treatments())).toHaveLength(0);
    expect(buttonsOf(K03Treatments()).filter((entry) => entry.className.includes('kiosk-pager__button')).every((entry) => entry.ariaDisabled)).toBe(true);
  });

  it('5번째 치료 id 는 이 시험이 쓰는 자료에서 둘째 쪽 첫 카드이다', () => {
    use(picked([], { treatmentPageOffset: 4 }));
    inputsOf(K03Treatments())[0]?.change();
    expect(sent()).toEqual([{ type: 'TOGGLE_TREATMENT', treatmentId: T_FIFTH }]);
  });
});
