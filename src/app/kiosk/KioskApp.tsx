'use client';

import { LiveKiosk } from './runtime/LiveKiosk';
import { useBootstrap } from './runtime/use-bootstrap';
import { useKioskController } from './runtime/use-kiosk-controller';
import { useViewportOrientation } from './runtime/viewport';
import { LoadFailedScreen, LoadingScreen, NoTreatmentsScreen, NotFoundScreen } from './screens/NonReadyScreens';
import type { CatalogDto, OptionsDto } from './state/api-types';
import type { Orientation } from './state/display';

// 키오스크 화면의 진입점 (SPEC-REIMBURSEMENT-001 M6, BRIEF D1·D2·D3). 서버 컴포넌트(page.tsx)는 병원 자료를 읽지 않고, 이 클라이언트 컴포넌트가 두 GET 으로 받는다.
// 받는 동안·받지 못했을 때는 컨트롤러가 없다. 그래서 자료가 준비되기 전에는 아무것도 선택·계산할 수 없다. 준비된 뒤에 컨트롤러를 만들어 LiveKiosk 로 넘긴다.
// 병원(slug)이 바뀌면 page.tsx 의 key 가 이 트리 전체를 새로 만들어 옛 컨트롤러가 dispose 된다.

export function KioskApp({ clinicSlug }: { readonly clinicSlug: string }) {
  const { state, retry } = useBootstrap(clinicSlug);
  const orientation = useViewportOrientation();
  switch (state.status) {
    case 'LOADING':
      return <LoadingScreen orientation={orientation} />;
    case 'NOT_FOUND':
      return <NotFoundScreen orientation={orientation} />;
    case 'LOAD_FAILED':
      return <LoadFailedScreen orientation={orientation} onRetry={retry} />;
    case 'NO_TREATMENTS':
      return <NoTreatmentsScreen orientation={orientation} catalog={state.catalog} />;
    case 'READY':
      return <KioskSession catalog={state.catalog} options={state.options} orientation={orientation} />;
  }
}

function KioskSession({ catalog, options, orientation }: { readonly catalog: CatalogDto; readonly options: OptionsDto; readonly orientation: Orientation }) {
  const controller = useKioskController(catalog, options);
  // 컨트롤러를 만드는 효과가 돌기 전의 첫 그리기: 같은 "불러오는 중" 화면을 유지한다(빈 화면이나 깜박임이 없다).
  return controller === null ? <LoadingScreen orientation={orientation} /> : <LiveKiosk controller={controller} />;
}
