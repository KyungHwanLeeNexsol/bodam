import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { Button } from '../../../src/app/kiosk/components/Button';
import { Modal, trapTarget } from '../../../src/app/kiosk/overlays/Modal';
import { ResetConfirm } from '../../../src/app/kiosk/overlays/ResetConfirm';
import { K00Start } from '../../../src/app/kiosk/screens/K00Start';
import type { KioskState } from '../../../src/app/kiosk/state/session-store';
import { initialState, stateAt } from '../../fixtures/kiosk/state.fixture';

// 버튼과 사건의 연결 (BRIEF D14): 화면은 눌림을 사건 하나로 바꿀 뿐이고, 전이 규칙은 상태 기계가 가진다.
// DOM 없이 시험한다: 훅이 없는 함수형 화면은 직접 불러 요소 트리를 얻고, 트리 안 Button 의 onClick 을 호출해 보낸 사건을 본다(컨텍스트의 useKiosk 는 가짜).
// 실제 클릭·초점·키보드는 브라우저 시험(tests/e2e)이 본다.

const mocks = vi.hoisted(() => ({ send: vi.fn(), state: null as unknown }));

vi.mock('../../../src/app/kiosk/runtime/kiosk-context', () => ({
  useKiosk: () => ({ state: mocks.state, send: mocks.send, read: (selector: (state: unknown, now: number) => unknown) => selector(mocks.state, 0) }),
}));

type Node = ReactNode;

function findAll(node: Node, match: (element: ReactElement<{ children?: Node }>) => boolean, found: ReactElement<{ children?: Node }>[] = []): ReactElement<{ children?: Node }>[] {
  if (Array.isArray(node)) {
    for (const child of node as Node[]) findAll(child, match, found);
    return found;
  }
  if (node !== null && typeof node === 'object' && 'props' in node) {
    const element = node as ReactElement<{ children?: Node }>;
    if (match(element)) found.push(element);
    findAll(element.props.children, match, found);
  }
  return found;
}

const textOf = (node: Node): string => (Array.isArray(node) ? (node as Node[]).map(textOf).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : node !== null && typeof node === 'object' && 'props' in node ? textOf((node as ReactElement<{ children?: Node }>).props.children) : '');

function buttons(tree: Node): Array<{ label: string; click: () => void }> {
  return findAll(tree, (element) => element.type === Button).map((element) => ({ label: textOf(element.props.children), click: (element.props as unknown as { onClick: () => void }).onClick }));
}

function use(state: KioskState): void {
  mocks.state = state;
}

beforeEach(() => {
  mocks.send.mockReset();
});

describe('K00Start', () => {
  it('"시작하기" 는 START 하나를 보낸다', () => {
    use(initialState());
    const all = buttons(K00Start());
    expect(all.map((entry) => entry.label)).toEqual(['시작하기']);
    all[0]?.click();
    expect(mocks.send.mock.calls).toEqual([[{ type: 'START' }]]);
  });
});

describe('ResetConfirm', () => {
  it('"계속 이용" 은 CANCEL_RESET, "처음으로" 는 CONFIRM_RESET 이다', () => {
    use(stateAt('K03_Treatments', { overlay: { kind: 'RESET_CONFIRM' } }));
    const all = buttons(ResetConfirm());
    expect(all.map((entry) => entry.label)).toEqual(['계속 이용', '처음으로']);
    all[0]?.click();
    all[1]?.click();
    expect(mocks.send.mock.calls).toEqual([[{ type: 'CANCEL_RESET' }], [{ type: 'CONFIRM_RESET' }]]);
  });

  it('Escape 는 취소(CANCEL_RESET)와 같다 (Modal 에 onEscape 로 넘긴다)', () => {
    use(stateAt('K03_Treatments', { overlay: { kind: 'RESET_CONFIRM' } }));
    const modal = findAll(ResetConfirm(), (element) => element.type === Modal)[0];
    (modal?.props as unknown as { onEscape: () => void }).onEscape();
    expect(mocks.send.mock.calls).toEqual([[{ type: 'CANCEL_RESET' }]]);
  });
});

describe('초점 가두기 (trapTarget)', () => {
  const items = ['처음', '가운데', '끝'];

  it('끝에서 Tab 은 처음으로, 처음에서 Shift+Tab 은 끝으로 돈다', () => {
    expect(trapTarget(items, '끝', true, false)).toBe('처음');
    expect(trapTarget(items, '처음', true, true)).toBe('끝');
  });

  it('창 안의 중간에서는 브라우저 기본 이동에 맡긴다 (null)', () => {
    expect(trapTarget(items, '가운데', true, false)).toBeNull();
    expect(trapTarget(items, '가운데', true, true)).toBeNull();
    expect(trapTarget(items, '처음', true, false)).toBeNull();
    expect(trapTarget(items, '끝', true, true)).toBeNull();
  });

  it('초점이 창 밖에 있으면 방향에 따라 처음·끝으로 끌어들인다', () => {
    expect(trapTarget(items, null, false, false)).toBe('처음');
    expect(trapTarget(items, null, false, true)).toBe('끝');
  });

  it('요소가 하나뿐이면 어느 방향이든 그 요소에 머문다', () => {
    expect(trapTarget(['혼자'], '혼자', true, false)).toBe('혼자');
    expect(trapTarget(['혼자'], '혼자', true, true)).toBe('혼자');
  });

  it('초점을 받을 요소가 없으면 null 이다', () => {
    expect(trapTarget([], null, false, false)).toBeNull();
  });
});
