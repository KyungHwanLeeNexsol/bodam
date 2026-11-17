import { Button } from '../components/Button';
import { StatusBody } from '../components/StatusBody';
import { useKiosk } from '../runtime/kiosk-context';
import { buildCompleteView } from '../view/complete-view';
import { COPY } from '../view/copy';

// 이용 완료 K06_Complete (SPEC-REIMBURSEMENT-001 M6 S3b, 디자인 `ilzkX`, DD-13, AC-015f, plan.md §E #12).
//  - 이 화면이 열릴 때 세션은 이미 비어 있다(상태 기계가 먼저 전체 삭제한 뒤 이 화면을 연다). 그래서 이전 환자의 선택·금액이 이 화면 어디에도 없다.
//  - 자동 복귀는 상태 기계의 일정(completionHoldSeconds 가 양수일 때만)이 맡는다. 이 화면에는 타이머가 없고 10초 같은 기본값도 없다. null 이면 "처음 화면으로" 버튼으로만 떠난다
//    (안내 문장도 그에 맞춘다: complete-view). 버튼은 BACK_TO_START 이고, 누르면 새 세션의 K00_Start 다. 큰 글자 보기는 전체 삭제로 꺼지고 화면 방향은 유지된다(상태 기계).
//  - 가로형·큰 글자 보기는 디자인 프레임이 없다(파생): 같은 구성이고 글자만 커진다.

export function K06Complete() {
  const { state, send } = useKiosk();
  const view = buildCompleteView(state);
  return (
    <div className="kiosk-complete" data-kiosk-state="COMPLETE">
      <StatusBody icon="check" solid title={COPY.complete.title} body={view.body} note={COPY.complete.note} />
      <div className="kiosk-status__actions">
        <Button
          variant="primary"
          block
          icon="home"
          className="kiosk-complete__start"
          onClick={() => {
            send({ type: 'BACK_TO_START' });
          }}
        >
          {COPY.complete.start}
        </Button>
      </div>
    </div>
  );
}
