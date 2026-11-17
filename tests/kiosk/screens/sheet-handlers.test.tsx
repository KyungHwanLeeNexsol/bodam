import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { K04BasisCalculation } from '../../../src/app/kiosk/screens/BasisScreen';
import { K06Complete } from '../../../src/app/kiosk/screens/CompleteScreen';
import { DocumentsBody, K07Documents } from '../../../src/app/kiosk/screens/DocumentsScreens';
import type { KioskState } from '../../../src/app/kiosk/state/session-store';
import { buildDocumentsView } from '../../../src/app/kiosk/view/documents-view';
import { makeCatalog } from '../../fixtures/kiosk/clinic.fixture';
import { estimatedResponse, holdResponse, resultStateWith, singleCauseDocuments } from '../../fixtures/kiosk/estimate.fixture';
import { stateAt } from '../../fixtures/kiosk/state.fixture';
import { buttonsOf } from './tree';

// 근거·서류·이용 완료 화면의 단추와 사건의 연결 (SPEC-REIMBURSEMENT-001 M6 S3b, BRIEF D14, AC-014e·g·h·i, AC-015f): 화면은 눌림을 이미 있는 사건 하나로 바꿀 뿐이고 전이 규칙은 상태 기계가 가진다.
// DOM 없이 시험한다(훅은 가짜). 실제 클릭·초점·복귀는 브라우저 시험(tests/e2e)이 본다.

const mocks = vi.hoisted(() => ({ send: vi.fn(), setOffset: vi.fn(), offset: 0, scrollTo: vi.fn(), state: null as unknown }));

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), useId: () => 'ID', useState: () => [mocks.offset, mocks.setOffset] }));
vi.mock('../../../src/app/kiosk/runtime/kiosk-context', () => ({
  useKiosk: () => ({ state: mocks.state, send: mocks.send, read: (selector: (state: unknown, now: number) => unknown) => selector(mocks.state, 0) }),
}));

const use = (state: KioskState): void => {
  mocks.state = state;
};
const sent = (): unknown[] => mocks.send.mock.calls.map((call) => call[0]);

beforeEach(() => {
  mocks.send.mockReset();
  mocks.setOffset.mockReset();
  mocks.scrollTo.mockReset();
  mocks.offset = 0;
  vi.stubGlobal('document', { querySelector: (selector: string) => (selector === '.kiosk-sheet__body' ? { scrollTo: mocks.scrollTo } : null) });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const basisState = (): KioskState => ({ ...resultStateWith(estimatedResponse()), screen: 'K04_Basis_Calculation' });

describe('계산 근거 화면의 동작', () => {
  it('"처음으로"·"결과로 돌아가기"·"이용 완료" 가 REQUEST_HOME·RETURN_TO_RESULT·COMPLETE_USE 를 보낸다 (새 사건을 만들지 않는다)', () => {
    use(basisState());
    const all = buttonsOf(K04BasisCalculation());
    expect(all.map((entry) => entry.label)).toEqual(['처음으로', '결과로 돌아가기', '이용 완료']);
    for (const entry of all) entry.click();
    expect(sent()).toEqual([{ type: 'REQUEST_HOME' }, { type: 'RETURN_TO_RESULT' }, { type: 'COMPLETE_USE' }]);
    expect(all.every((entry) => !entry.ariaDisabled)).toBe(true);
  });

  it('보류 결과(근거 없음)의 방어 화면은 "처음으로"(REQUEST_HOME)만 보낸다', () => {
    use({ ...resultStateWith(holdResponse()), screen: 'K04_Basis_Calculation' });
    const all = buttonsOf(K04BasisCalculation());
    expect(all.map((entry) => entry.label)).toEqual(['처음으로']);
    all[0]?.click();
    expect(sent()).toEqual([{ type: 'REQUEST_HOME' }]);
  });
});

describe('필요 서류 화면의 동작과 쪽 넘김', () => {
  const docState = (): KioskState => ({ ...resultStateWith(estimatedResponse({ documents: singleCauseDocuments() })), screen: 'K07_Documents' });
  const body = (offset: number, pageSize: number, onOffset: (next: number) => void) => {
    const state = docState();
    use(state);
    const view = buildDocumentsView(state);
    if (view === null) throw new Error('서류 보기 모양이 없다');
    return buttonsOf(DocumentsBody({ view, landscape: false, pageSize, offset, onOffset }));
  };

  it('하단 동작 셋은 REQUEST_HOME·RETURN_TO_RESULT·COMPLETE_USE 를 보낸다', () => {
    const all = body(0, 9, () => undefined);
    expect(all.map((entry) => entry.label)).toEqual(['처음으로', '결과로 돌아가기', '이용 완료']);
    for (const entry of all) entry.click();
    expect(sent()).toEqual([{ type: 'REQUEST_HOME' }, { type: 'RETURN_TO_RESULT' }, { type: 'COMPLETE_USE' }]);
  });

  it('쪽이 하나이면 쪽 넘김 단추가 없다', () => {
    expect(body(0, 9, () => undefined).map((entry) => entry.label)).not.toContain('다음 목록');
  });

  it('쪽이 여럿이면 "이전 목록"(처음 쪽에서는 비활성)·"다음 목록"이 있고 눌러도 계산·상태 사건이 나가지 않는다 (AC-014d·AC-007i)', () => {
    const offsets: number[] = [];
    const first = body(0, 4, (next) => offsets.push(next));
    expect(first.map((entry) => entry.label)).toEqual(['이전 목록', '다음 목록', '처음으로', '결과로 돌아가기', '이용 완료']);
    expect(first[0]?.ariaDisabled).toBe(true);
    expect(first[1]?.ariaDisabled).toBe(false);
    first[0]?.click();
    first[1]?.click();
    expect(offsets).toEqual([4]);
    expect(sent()).toEqual([]);

    const last = body(8, 4, (next) => offsets.push(next));
    expect(last[0]?.ariaDisabled).toBe(false);
    expect(last[1]?.ariaDisabled).toBe(true);
    last[0]?.click();
    last[1]?.click();
    expect(offsets).toEqual([4, 4]);
  });
});

describe('필요 서류 화면(훅 포함)의 쪽 넘김', () => {
  const largeState = (): KioskState => ({ ...resultStateWith(estimatedResponse({ documents: singleCauseDocuments() })), screen: 'K07_Documents', display: { orientation: 'PORTRAIT', largeText: true } });

  it('"다음 목록"은 쪽 위치를 한 쪽 앞으로 옮기고 본문을 맨 위로 돌린다. 계산·상태 사건은 없다', () => {
    use(largeState());
    const next = buttonsOf(K07Documents()).find((entry) => entry.label === '다음 목록');
    next?.click();
    expect(mocks.setOffset).toHaveBeenCalledWith(6);
    expect(mocks.scrollTo).toHaveBeenCalledWith({ top: 0 });
    expect(sent()).toEqual([]);
  });

  it('둘째 쪽에서 "이전 목록"은 처음 쪽으로 돌아간다', () => {
    use(largeState());
    mocks.offset = 6;
    const previous = buttonsOf(K07Documents()).find((entry) => entry.label === '이전 목록');
    expect(previous?.ariaDisabled).toBe(false);
    previous?.click();
    expect(mocks.setOffset).toHaveBeenCalledWith(0);
  });

  it('저장된 응답이 없으면 방어 화면("처음으로"만)이고 쪽 상태를 쓰지 않는다', () => {
    use({ ...largeState(), derived: { estimate: null, documents: null, basis: null, returnContext: null } });
    expect(buttonsOf(K07Documents()).map((entry) => entry.label)).toEqual(['처음으로']);
  });
});

describe('K06_Complete 의 동작', () => {
  it('"처음 화면으로" 는 BACK_TO_START 를 보낸다 (이용 완료·처음으로 사건이 아니다)', () => {
    use(stateAt('K06_Complete', {}, { catalog: makeCatalog({ idlePolicy: { completionHoldSeconds: 10 } }) }));
    const all = buttonsOf(K06Complete());
    expect(all.map((entry) => entry.label)).toEqual(['처음 화면으로']);
    all[0]?.click();
    expect(sent()).toEqual([{ type: 'BACK_TO_START' }]);
  });
});
