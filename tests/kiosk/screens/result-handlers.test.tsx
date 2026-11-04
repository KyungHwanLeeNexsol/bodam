import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CalculatingScreen } from '../../../src/app/kiosk/screens/CalculatingScreen';
import { NetworkErrorScreen } from '../../../src/app/kiosk/screens/NetworkErrorScreen';
import { K04Result, K04ResultHold, K04ResultNotCovered } from '../../../src/app/kiosk/screens/ResultScreens';
import type { KioskState } from '../../../src/app/kiosk/state/session-store';
import { estimatedResponse, holdResponse, notCoveredResponse, resultStateWith } from '../../fixtures/kiosk/estimate.fixture';
import { stateAt } from '../../fixtures/kiosk/state.fixture';
import { buttonsOf } from './tree';

// 결과 쪽 화면의 단추와 사건의 연결 (SPEC-REIMBURSEMENT-001 M6 S3a, BRIEF D14, AC-013c·e, AC-014d·g의 시작, DD-09 규칙 1): 화면은 눌림을 사건 하나로 바꿀 뿐이고 전이 규칙은 상태 기계가 가진다.
// DOM 없이 시험한다(훅은 가짜). 실제 클릭·초점은 브라우저 시험(tests/e2e)이 본다.

const mocks = vi.hoisted(() => ({ send: vi.fn(), state: null as unknown }));

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), useId: () => 'ID' }));
vi.mock('../../../src/app/kiosk/runtime/kiosk-context', () => ({
  useKiosk: () => ({ state: mocks.state, send: mocks.send, read: (selector: (state: unknown, now: number) => unknown) => selector(mocks.state, 0) }),
}));

const use = (state: KioskState): void => {
  mocks.state = state;
};
const sent = (): unknown[] => mocks.send.mock.calls.map((call) => call[0]);

beforeEach(() => {
  mocks.send.mockReset();
});

const EVENT_OF_LABEL: Record<string, unknown> = {
  '보험 청구에 필요한 서류 확인': { type: 'OPEN_DOCUMENTS' },
  '계산 근거 보기': { type: 'OPEN_BASIS' },
  '치료 다시 선택': { type: 'RESELECT_TREATMENTS' },
  '보험 조건 수정': { type: 'EDIT_INSURANCE' },
  처음으로: { type: 'REQUEST_HOME' },
  '이용 완료': { type: 'COMPLETE_USE' },
};

describe('결과 화면의 동작은 이미 있는 사건 하나씩을 보낸다 (새 사건을 만들지 않는다)', () => {
  it.each([
    ['정상', () => resultStateWith(estimatedResponse()), K04Result],
    ['보장 제외', () => resultStateWith(notCoveredResponse()), K04ResultNotCovered],
  ] as const)('%s: 여섯 동작이 각자의 사건을 보낸다', (_name, make, Screen) => {
    use(make());
    const all = buttonsOf(Screen());
    expect(all.map((entry) => entry.label)).toEqual(Object.keys(EVENT_OF_LABEL));
    for (const entry of all) entry.click();
    expect(sent()).toEqual(Object.values(EVENT_OF_LABEL));
    expect(all.every((entry) => !entry.ariaDisabled)).toBe(true);
  });

  it('보류: 네 동작뿐이고 서류 확인·계산 근거 사건을 보낼 수 있는 단추가 없다 (AC-013c)', () => {
    use(resultStateWith(holdResponse()));
    const all = buttonsOf(K04ResultHold());
    expect(all.map((entry) => entry.label)).toEqual(['치료 다시 선택', '보험 조건 수정', '처음으로', '이용 완료']);
    for (const entry of all) entry.click();
    expect(sent()).toEqual([{ type: 'RESELECT_TREATMENTS' }, { type: 'EDIT_INSURANCE' }, { type: 'REQUEST_HOME' }, { type: 'COMPLETE_USE' }]);
    expect(sent()).not.toContainEqual({ type: 'OPEN_DOCUMENTS' });
    expect(sent()).not.toContainEqual({ type: 'OPEN_BASIS' });
  });

  it('응답이 없는 방어 화면은 "처음으로"(REQUEST_HOME)만 보낸다', () => {
    use(stateAt('K04_Result'));
    const all = buttonsOf(K04Result());
    expect(all.map((entry) => entry.label)).toEqual(['처음으로']);
    all[0]?.click();
    expect(sent()).toEqual([{ type: 'REQUEST_HOME' }]);
  });
});

describe('Calculating: 새 요청을 보낼 수 있는 단추가 없다 (AC-015l~p)', () => {
  it('"이전"과 "계산 중…"은 비활성이라 눌러도 사건이 없고, "처음으로"만 REQUEST_HOME 을 보낸다 (계산 요청 없음)', () => {
    use(stateAt('Calculating'));
    const all = buttonsOf(CalculatingScreen());
    expect(all.map((entry) => [entry.label, entry.ariaDisabled])).toEqual([['처음으로', false], ['이전', true], ['계산 중…', true]]);
    for (const entry of all) entry.click();
    expect(sent()).toEqual([{ type: 'REQUEST_HOME' }]);
  });
});

describe('KXX_Error_Network: "다시 시도"는 새 계산 요청, "이용 종료"는 이용 완료 (DD-07, DD-13)', () => {
  it('"다시 시도" = REQUEST_ESTIMATE, "이용 종료" = COMPLETE_USE', () => {
    use(resultStateWith(estimatedResponse(), { screen: 'KXX_Error_Network' }));
    const all = buttonsOf(NetworkErrorScreen());
    expect(all.map((entry) => entry.label)).toEqual(['다시 시도', '이용 종료']);
    for (const entry of all) entry.click();
    expect(sent()).toEqual([{ type: 'REQUEST_ESTIMATE' }, { type: 'COMPLETE_USE' }]);
  });

  it.each(['RUNNING', 'FAILED'] as const)('갱신이 %s 이면 "다시 시도"는 비활성이고 눌러도 계산 요청 사건을 보내지 않는다 (AC-020c·e), "이용 종료"는 그대로다', (refreshState) => {
    use(resultStateWith(estimatedResponse(), { screen: 'KXX_Error_Network', refreshState }));
    const all = buttonsOf(NetworkErrorScreen());
    expect(all[0]?.ariaDisabled).toBe(true);
    all[0]?.click();
    expect(sent()).toEqual([]);
    all[1]?.click();
    expect(sent()).toEqual([{ type: 'COMPLETE_USE' }]);
  });

  it('그리는 순간에는 켜져 있었어도 누르는 순간 갱신이 필요한 상태가 되었으면 계산 요청 사건을 보내지 않는다 (누른 순간의 상태로 한 번 더 막는다)', () => {
    use(resultStateWith(estimatedResponse(), { screen: 'KXX_Error_Network' }));
    const all = buttonsOf(NetworkErrorScreen());
    expect(all[0]?.ariaDisabled).toBe(false);
    use(resultStateWith(estimatedResponse(), { screen: 'KXX_Error_Network', refreshState: 'RUNNING' }));
    all[0]?.click();
    expect(sent()).toEqual([]);
  });

  it('가로형은 보조 동작("이용 종료")이 먼저이고 사건은 같다', () => {
    use({ ...resultStateWith(estimatedResponse(), { screen: 'KXX_Error_Network' }), display: { orientation: 'LANDSCAPE', largeText: false } });
    const all = buttonsOf(NetworkErrorScreen());
    expect(all.map((entry) => entry.label)).toEqual(['이용 종료', '다시 시도']);
    for (const entry of all) entry.click();
    expect(sent()).toEqual([{ type: 'COMPLETE_USE' }, { type: 'REQUEST_ESTIMATE' }]);
  });

  it('보낼 입력이 없는 상태에서도 "다시 시도"는 비활성이다 (치료 없음)', () => {
    use(resultStateWith(estimatedResponse(), { screen: 'KXX_Error_Network', inputs: { generation: 'GEN2_C1', insurerType: 'NON_LIFE', cause: 'INJURY', treatmentIds: [] } }));
    const all = buttonsOf(NetworkErrorScreen());
    expect(all[0]?.ariaDisabled).toBe(true);
    all[0]?.click();
    expect(sent()).toEqual([]);
  });
});
