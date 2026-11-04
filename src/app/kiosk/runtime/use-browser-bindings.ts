import { useEffect } from 'react';
import type { KioskController } from '../state/controller';
import { LANDSCAPE_QUERY } from './viewport';

// 브라우저 쪽 연결 (SPEC-REIMBURSEMENT-001 M6, BRIEF D4). 브라우저의 일을 상태 기계의 사건으로 바꾸는 얇은 층이고, 모두 controller.dispatch 를 거친다.
//  (a) 화면 방향이 바뀌면 ORIENTATION_CHANGED,
//  (b) 뒤로·앞으로 가기로 페이지 캐시에서 복원되면(pageshow, persisted) PAGE_RESTORED → 빈 세션,
//  (c) 일반 터치·키 입력은 INTERACTION (LiveKiosk 가 루트에서 잡아 보낸다, interaction-handlers).
// 마지막 조작 시각을 여기서 직접 쓰지 않는다: 시각을 정하는 곳은 reducer 뿐이다(5e6fb05: 만료된 세션은 어떤 사건보다 먼저 지운다).
// 기록(history)·주소(location)·저장소를 건드리지 않는다.

/** 연결이 쓰는 브라우저 창의 일부. 시험은 이 모양의 가짜를 넘긴다(window 가 만족한다). */
export interface BindingHost {
  matchMedia(query: string): { readonly matches: boolean; addEventListener(type: 'change', listener: () => void): void; removeEventListener(type: 'change', listener: () => void): void };
  addEventListener(type: 'pageshow', listener: (event: { readonly persisted: boolean }) => void): void;
  removeEventListener(type: 'pageshow', listener: (event: { readonly persisted: boolean }) => void): void;
}

/** 방향 관찰과 페이지 복원을 컨트롤러에 연결하고, 연결을 푸는 함수를 돌려준다. */
export function attachBrowserBindings(controller: KioskController, host: BindingHost): () => void {
  const media = host.matchMedia(LANDSCAPE_QUERY);
  const syncOrientation = (): void => {
    controller.dispatch({ type: 'ORIENTATION_CHANGED', orientation: media.matches ? 'LANDSCAPE' : 'PORTRAIT' });
  };
  const onPageShow = (event: { readonly persisted: boolean }): void => {
    if (event.persisted) controller.dispatch({ type: 'PAGE_RESTORED' });
  };
  media.addEventListener('change', syncOrientation);
  host.addEventListener('pageshow', onPageShow);
  // 컨트롤러를 만든 뒤 연결하기 전 사이에 방향이 바뀌었을 수 있다. 같은 방향이면 상태 기계가 거절하므로 부담이 없다.
  syncOrientation();
  return () => {
    media.removeEventListener('change', syncOrientation);
    host.removeEventListener('pageshow', onPageShow);
  };
}

export function useBrowserBindings(controller: KioskController): void {
  useEffect(() => attachBrowserBindings(controller, window), [controller]);
}

/** 루트의 포착 단계 조작 감지기. 터치(pointerdown)와 키 입력(keydown)을 INTERACTION 으로 보낸다. 버튼이 자기 사건을 보내기 전에 먼저 부른다. */
export function interactionHandlers(controller: KioskController): { readonly onPointerDownCapture: () => void; readonly onKeyDownCapture: () => void } {
  const interact = (): void => {
    controller.dispatch({ type: 'INTERACTION' });
  };
  return { onPointerDownCapture: interact, onKeyDownCapture: interact };
}
