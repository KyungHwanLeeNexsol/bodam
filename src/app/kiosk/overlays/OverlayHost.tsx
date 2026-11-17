import { useEffect, useRef } from 'react';
import { useKiosk } from '../runtime/kiosk-context';
import type { OverlayKind } from '../state/session-store';
import { ResetConfirm } from './ResetConfirm';
import { TimeoutDialog } from './TimeoutDialog';

// 겹침창 자리 (SPEC-REIMBURSEMENT-001 M6, BRIEF D8). state.overlay 가 정한 겹침창 하나만 그린다(동시에 둘이 열리지 않는다, DD-07).
// 열리기 직전에 초점이 있던 요소(opener)를 기억했다가 닫힌 뒤 돌려준다:
//  - 환자가 "처음으로"를 눌러 연 ResetConfirm: 그 버튼. 시스템이 연 TimeoutDialog: 그때 초점이 있던 요소.
//  - ResetConfirm 이 열린 채 경고 시점이 되어 TimeoutDialog 로 바뀌어도(AC-015k) 처음 열기 전 위치가 그대로 기억된다.
//  - 그 요소가 이미 사라졌으면(확인으로 초기화돼 화면이 바뀜, 또는 열릴 때부터 초점이 없었음) 지금 화면의 대표 제목(data-kiosk-primary), 없으면 첫 버튼으로 간다.
// 밑 화면의 inert 는 LiveKiosk 가 겹침창이 열린 동안 건다. 초점을 돌려주는 일은 겹침창이 모두 닫혀 inert 가 풀린 뒤(효과)에 한다.

function isFocusableTarget(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && element !== document.body && element.isConnected && element.closest('[inert]') === null;
}

function restoreFocus(opener: Element | null): void {
  if (isFocusableTarget(opener)) {
    opener.focus();
    return;
  }
  const fallback = document.querySelector<HTMLElement>('[data-kiosk-primary]') ?? document.querySelector<HTMLElement>('.kiosk-screen button');
  fallback?.focus();
}

export function OverlayHost() {
  const { state } = useKiosk();
  const kind: OverlayKind = state.overlay.kind;
  const memory = useRef<{ kind: OverlayKind; opener: Element | null }>({ kind: 'NONE', opener: null });

  // 렌더링 중에 읽는다: 겹침창이 그려지는 이 렌더링 시점은 아직 초점이 밑 화면에 있고, 커밋 뒤에는 밑 화면이 inert 가 되어 초점이 흔들릴 수 있다.
  // 값은 닫힘 → 열림 전이에서 한 번만 정해지고, 겹침창이 다른 겹침창으로 바뀌는 동안은 그대로다.
  if (memory.current.kind === 'NONE' && kind !== 'NONE') memory.current.opener = typeof document === 'undefined' ? null : document.activeElement;
  memory.current.kind = kind;

  useEffect(() => {
    if (kind !== 'NONE') return;
    const { opener } = memory.current;
    memory.current.opener = null;
    // 처음 그릴 때(열린 적 없음)는 돌려줄 것이 없다.
    if (opener !== null) restoreFocus(opener);
  }, [kind]);

  switch (kind) {
    case 'RESET_CONFIRM':
      return <ResetConfirm />;
    case 'TIMEOUT_DIALOG':
      return <TimeoutDialog />;
    case 'NONE':
      return null;
  }
}
