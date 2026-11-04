import type { ReactNode } from 'react';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { KioskFrame } from '../components/KioskFrame';
import { KioskHeader } from '../components/KioskHeader';
import { ResultBar } from '../components/ResultBar';
import { StatusBody } from '../components/StatusBody';
import type { CatalogDto } from '../state/api-types';
import type { Orientation } from '../state/display';
import { COPY } from '../view/copy';

// 병원 자료를 받기 전·받지 못했을 때의 화면 넷 (SPEC-REIMBURSEMENT-001 M6, BRIEF D2). 컨트롤러가 아직 없어서 상태·무조작 타이머·"큰 글자 보기"가 없다.
// 디자인에 프레임이 없어 KXX_Error_Network·KXX_Loading_Calculating 의 구성(상단 + 상태 막대 + 가운데 안내 + 하단 동작)을 따라 만들었다("그리지 않고 만든 화면").
// 환자 문구는 쉬운 말이고 오류 코드·HTTP 상태를 싣지 않는다. 0원 같은 금액도 없다. "접수 직원에게 문의해 주세요"는 문장이며 버튼이 아니다.

function NonReadyFrame({ orientation, catalog, children }: { readonly orientation: Orientation; readonly catalog?: CatalogDto | undefined; readonly children: ReactNode }) {
  return (
    <KioskFrame orientation={orientation} largeText={false}>
      <KioskHeader serviceName={catalog?.serviceDisplayName ?? COPY.serviceName} hospitalName={catalog?.clinic.displayName} />
      <main className="kiosk-screen">{children}</main>
    </KioskFrame>
  );
}

/** 불러오는 중. 환자가 할 일은 없고 화면 낭독기에는 상태로 알린다. */
export function LoadingScreen({ orientation }: { readonly orientation: Orientation }) {
  return (
    <NonReadyFrame orientation={orientation}>
      <div role="status" className="kiosk-screen" data-kiosk-state="LOADING">
        <StatusBody icon="loader" spin title={COPY.bootstrap.loading.title} body={COPY.bootstrap.loading.body} />
      </div>
    </NonReadyFrame>
  );
}

/** 병원을 찾지 못함(404). 다시 시도해도 달라지지 않으므로 버튼이 없다. */
export function NotFoundScreen({ orientation }: { readonly orientation: Orientation }) {
  return (
    <NonReadyFrame orientation={orientation}>
      <div className="kiosk-screen" data-kiosk-state="NOT_FOUND">
        <StatusBody icon="circle-alert" tone="warn" title={COPY.bootstrap.notFound.title} body={COPY.bootstrap.notFound.body} />
      </div>
    </NonReadyFrame>
  );
}

/** 통신 오류·시간 초과·서버 오류·읽을 수 없는 응답. "다시 시도"는 받기를 처음부터 다시 한다. */
export function LoadFailedScreen({ orientation, onRetry }: { readonly orientation: Orientation; readonly onRetry: () => void }) {
  return (
    <NonReadyFrame orientation={orientation}>
      <div className="kiosk-screen" data-kiosk-state="LOAD_FAILED">
        <ResultBar label={COPY.bootstrap.loadFailed.barLabel} badge={<Badge tone="danger">{COPY.bootstrap.loadFailed.badge}</Badge>} />
        <StatusBody icon="wifi-off" tone="danger" title={COPY.bootstrap.loadFailed.title} body={COPY.bootstrap.loadFailed.body} />
        <div className="kiosk-status__actions">
          <Button variant="primary" block icon="rotate-ccw" onClick={onRetry}>
            {COPY.buttons.retry}
          </Button>
        </div>
      </div>
    </NonReadyFrame>
  );
}

/** 병원은 있으나 안내할 치료가 없음. 시작할 수 없고, 직원에게 문의하라는 문장만 있다. */
export function NoTreatmentsScreen({ orientation, catalog }: { readonly orientation: Orientation; readonly catalog: CatalogDto }) {
  return (
    <NonReadyFrame orientation={orientation} catalog={catalog}>
      <div className="kiosk-screen" data-kiosk-state="NO_TREATMENTS">
        <StatusBody icon="circle-alert" tone="warn" title={COPY.bootstrap.noTreatments.title} body={COPY.bootstrap.noTreatments.body} />
      </div>
    </NonReadyFrame>
  );
}
