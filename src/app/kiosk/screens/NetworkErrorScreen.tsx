import { Badge } from '../components/Badge';
import { BottomActions } from '../components/BottomActions';
import { Button } from '../components/Button';
import { ResultBar } from '../components/ResultBar';
import { StatusBody } from '../components/StatusBody';
import { useKiosk } from '../runtime/kiosk-context';
import { canRequestEstimate } from '../state/selectors';
import { COPY } from '../view/copy';

// 통신 오류 KXX_Error_Network (SPEC-REIMBURSEMENT-001 M6 S3a, 디자인 `bWvFJ`, DD-07·DD-19, AC-013d).
//  - 계산 요청이 실패(5xx·시간 초과·연결 실패·그 밖의 4xx)했을 때의 화면이다. 금액을 보이지 않고 내부 코드·HTTP 상태도 없다. 보험금이 0원이라는 뜻이 아님을 문장으로 알린다(디자인 그대로).
//  - "다시 시도"(REQUEST_ESTIMATE)는 같은 입력으로 새 요청을 만든다. 자료 갱신이 필요한 동안(갱신이 진행 중이거나 실패해 있을 때)은 계산을 보내지 않으므로 비활성이다(DD-09 규칙 1, canRequestEstimate).
//    상태 기계도 같은 판정으로 사건을 거절한다: 이 화면의 비활성은 표시이고 그 위에서 한 번 더 막는다.
//  - "이용 종료"(COMPLETE_USE)는 먼저 전체 삭제한 뒤 이용 완료 화면(K06_Complete)으로 간다(잠정, plan.md §E #20).
//  - "접수 직원에게 문의해 주세요"는 문장이다. 버튼·전화 연결이 아니다.
//  - 세로는 디자인대로 위아래로 쌓고(다시 시도, 이용 종료), 가로는 한 줄이다(파생: 가로 프레임 없음, 다른 화면의 동작 막대와 같이 보조 동작이 왼쪽, 주 동작이 오른쪽). DOM 순서가 눈에 보이는 순서다.

export function NetworkErrorScreen() {
  const { state, send, read } = useKiosk();
  const canRetry = canRequestEstimate(state);
  const landscape = state.display.orientation === 'LANDSCAPE';
  const retry = (
    <Button
      key="retry"
      variant="primary"
      block={!landscape}
      icon="rotate-ccw"
      disabled={!canRetry}
      onClick={() => {
        // 누른 순간의 상태로 한 번 더 확인한다: 갱신이 필요한 동안에는 계산 요청을 보내지 않는다.
        if (read((current) => canRequestEstimate(current))) send({ type: 'REQUEST_ESTIMATE' });
      }}
    >
      {COPY.networkError.retry}
    </Button>
  );
  const finish = (
    <Button
      key="finish"
      variant="secondary"
      block={!landscape}
      onClick={() => {
        send({ type: 'COMPLETE_USE' });
      }}
    >
      {COPY.networkError.finish}
    </Button>
  );
  return (
    <div className="kiosk-error" data-kiosk-state="NETWORK_ERROR">
      <ResultBar label={COPY.networkError.barLabel} badge={<Badge tone="danger">{COPY.networkError.badge}</Badge>} />
      <StatusBody icon="wifi-off" tone="danger" title={COPY.networkError.title} body={COPY.networkError.body} />
      <BottomActions stack={!landscape}>{landscape ? [finish, retry] : [retry, finish]}</BottomActions>
    </div>
  );
}
