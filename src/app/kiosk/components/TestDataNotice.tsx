import { COPY } from '../view/copy';
import { Icon } from './icons';

// 테스트 데이터 표시 (AC-010e, plan.md §E #22). 운영이 아닌 자료(origin !== OPERATING)로 계산한 결과 화면의 맨 위에 보인다. 운영 자료의 결과에서는 그려지지 않는다.
// 색(warn)뿐 아니라 아이콘과 굵은 문장으로 알린다. 응답의 origin 값(코드)을 화면에 싣지 않는다 — 문구는 고정이다.

export function TestDataNotice() {
  return (
    <div className="kiosk-test-data" role="note" data-kiosk-block data-kiosk-test-data>
      <Icon name="circle-alert" size={32} />
      <p className="kiosk-test-data__text">{COPY.result.testData}</p>
    </div>
  );
}
