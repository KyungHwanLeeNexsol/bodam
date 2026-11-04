import { BottomActions } from '../components/BottomActions';
import { Button } from '../components/Button';
import { StatusBody } from '../components/StatusBody';
import { useKiosk } from '../runtime/kiosk-context';
import { COPY } from '../view/copy';

// 근거·필요 서류 화면의 하단 동작과 방어 화면 (SPEC-REIMBURSEMENT-001 M6 S3b, DD-07·DD-11·DD-13, 기획서 §4·§13.2).
//  - "처음으로"(REQUEST_HOME) · "결과로 돌아가기"(RETURN_TO_RESULT) · "이용 완료"(COMPLETE_USE). 디자인 프레임은 뒤 둘뿐이다: 모든 환자 화면에 있어야 하는 "처음으로"(기획서 §13.2)와
//    근거 화면의 "이용 완료"(DD-13: 결과·근거·서류 어디서나 이용 완료)는 이 단계가 더한 자리다(파생, 보고 참고). 모두 이미 있는 사건이고 새 사건을 만들지 않는다.
//  - "결과로 돌아가기"가 어느 결과로 가는지(정상·보장 제외)와 방향·큰 글자의 최신 값은 상태 기계가 정한다(DD-11). 이 화면은 사건만 보낸다.

export function SheetFooter() {
  const { send } = useKiosk();
  return (
    <BottomActions sheet>
      <Button
        variant="secondary"
        className="kiosk-button--home"
        onClick={() => {
          send({ type: 'REQUEST_HOME' });
        }}
      >
        {COPY.buttons.home}
      </Button>
      <Button
        variant="secondary"
        className="kiosk-button--back"
        icon="chevron-left"
        onClick={() => {
          send({ type: 'RETURN_TO_RESULT' });
        }}
      >
        {COPY.sheet.back}
      </Button>
      <Button
        variant="primary"
        icon="check"
        onClick={() => {
          send({ type: 'COMPLETE_USE' });
        }}
      >
        {COPY.sheet.complete}
      </Button>
    </BottomActions>
  );
}

/** 저장된 응답이 없거나 근거를 만들 수 없는 결과(보류)에서 이 화면에 온 경우(일어나지 않는 상태의 방어): 0원이나 빈 표를 그리지 않고 "처음으로"만 둔다. */
export function SheetUnavailable({ title, body }: { readonly title: string; readonly body: string }) {
  const { send } = useKiosk();
  return (
    <div className="kiosk-sheet kiosk-sheet--unavailable" data-sheet="unavailable">
      <StatusBody icon="circle-alert" tone="warn" title={title} body={body} />
      <div className="kiosk-status__actions">
        <Button
          variant="secondary"
          block
          icon="rotate-ccw"
          onClick={() => {
            send({ type: 'REQUEST_HOME' });
          }}
        >
          {COPY.buttons.home}
        </Button>
      </div>
    </div>
  );
}
