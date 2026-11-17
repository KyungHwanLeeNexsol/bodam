import { BottomActions } from '../components/BottomActions';
import { Button } from '../components/Button';
import { StatusBody } from '../components/StatusBody';
import { useKiosk } from '../runtime/kiosk-context';
import { COPY } from '../view/copy';

// 계산 중 KXX_Loading_Calculating (SPEC-REIMBURSEMENT-001 M6 S3a, 디자인 `BfNvc`, DD-07·DD-09, AC-015l~p).
//  - 요청이 진행 중인 화면이다. 환자가 새 요청을 보낼 동작이 없다: 디자인대로 "이전"과 "계산 중…"은 눌러도 아무 일도 없는 비활성 버튼이다.
//  - 상태는 화면 낭독기에 "상태"로 알린다(role="status"). 로딩은 활성 요청에서 읽히고(selectIsLoading) 응답이 오면 결과·오류·K03 으로 화면이 바뀐다 — 이 화면은 그 전이를 하지 않는다.
//  - "처음으로"는 디자인 프레임에 없다(파생). DD-07 이 "Calculating 에서 '처음으로'를 눌러 ResetConfirm 을 연다"고 정하고(입력이 있으면 확인창, AC-015l~m), 환자가 기다리다 되돌아갈 길이 필요해서 더했다.
//    눌러도 새 계산 요청은 나가지 않는다. 확정되면 상태 기계가 먼저 요청을 CANCELLED 로 풀고 새 세션을 연다.
//  - 겹침창 위에 응답이 도착하면 이 컴포넌트는 곧바로 결과·오류 화면으로 바뀌고(ScreenRouter), 겹침창은 그대로 남는다(DD-07 표 1).

export function CalculatingScreen() {
  const { send } = useKiosk();
  return (
    <div className="kiosk-calculating" data-kiosk-state="CALCULATING">
      <div className="kiosk-calculating__status" role="status" aria-live="polite">
        <StatusBody icon="loader" spin title={COPY.calculating.title} body={COPY.calculating.body} note={COPY.calculating.note} />
      </div>
      <BottomActions three>
        <Button
          variant="secondary"
          className="kiosk-button--home"
          onClick={() => {
            send({ type: 'REQUEST_HOME' });
          }}
        >
          {COPY.buttons.home}
        </Button>
        <Button variant="secondary" icon="chevron-left" disabled>
          {COPY.buttons.previous}
        </Button>
        <Button variant="primary" disabled>
          {COPY.calculating.busy}
        </Button>
      </BottomActions>
    </div>
  );
}
