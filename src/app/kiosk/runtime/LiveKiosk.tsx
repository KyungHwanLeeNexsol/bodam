'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { KioskFrame } from '../components/KioskFrame';
import { KioskHeader } from '../components/KioskHeader';
import { OverlayHost } from '../overlays/OverlayHost';
import { ScreenRouter } from '../screens/ScreenRouter';
import type { KioskController } from '../state/controller';
import { selectLayout } from '../state/display';
import { KioskContext } from './kiosk-context';
import type { KioskContextValue } from './kiosk-context';
import { interactionHandlers, useBrowserBindings } from './use-browser-bindings';

// 컨트롤러가 있는 키오스크 (SPEC-REIMBURSEMENT-001 M6, BRIEF D3·D4·D8). 상태는 useSyncExternalStore 로 읽는다: 컨트롤러의 subscribe·getState 는 컨트롤러마다 하나로 안정적이고
// getState 는 바꾸지 않는 상태 객체를 돌려준다. 화면은 이 상태와 send 만 본다.
// 루트는 방향·큰 글자 보기를 상태에서 받고(단일 출처), 포착 단계에서 터치·키 입력을 INTERACTION 으로 보낸다(버튼 자신의 사건보다 먼저).
// 겹침창이 열려 있으면 밑 화면(상단 + 화면)은 inert 이고 겹침창은 그 형제다. 밑 화면은 겹침창이 열려 있는 동안에도 계속 다시 그려진다(요청·갱신의 결말이 도착한다, DD-07 표 1·2).

export function LiveKiosk({ controller }: { readonly controller: KioskController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const value = useMemo<KioskContextValue>(() => ({ state, send: controller.dispatch, read: controller.select }), [state, controller]);
  useBrowserBindings(controller);

  const { orientation, largeText } = selectLayout(state);
  const overlayOpen = state.overlay.kind !== 'NONE';
  const { catalog } = state.clinic;
  return (
    <KioskContext.Provider value={value}>
      <KioskFrame orientation={orientation} largeText={largeText} {...interactionHandlers(controller)}>
        <div className="kiosk-underlay" inert={overlayOpen} aria-hidden={overlayOpen ? true : undefined}>
          <KioskHeader
            serviceName={catalog.serviceDisplayName}
            hospitalName={catalog.clinic.displayName}
            largeText={{
              pressed: largeText,
              onToggle: () => {
                controller.dispatch({ type: 'TOGGLE_LARGE_TEXT' });
              },
            }}
          />
          <main className="kiosk-screen">
            <ScreenRouter />
          </main>
        </div>
        <OverlayHost />
      </KioskFrame>
    </KioskContext.Provider>
  );
}
