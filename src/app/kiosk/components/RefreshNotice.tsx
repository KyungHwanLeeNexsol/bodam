import { forwardRef } from 'react';
import { COPY } from '../view/copy';
import { Button } from './Button';
import { Icon } from './icons';

// K03 안의 자료 갱신 안내 (SPEC-REIMBURSEMENT-001 M6 S2, DD-09 규칙 2·3·5, AC-020i). 새 화면이 아니라 같은 화면 안의 인라인 안내다. 디자인에 프레임이 없어 이 단계가 만들었다(파생).
//  - running: 진행 표시. 치료 카드·"이전"·확인 버튼이 잠겨 있다(화면이 이 상태를 selectRefresh 로 읽는다).
//  - failed: 실패 안내와 인라인 "다시 시도". 다시 시도는 계산이 아니라 갱신을 먼저 실행한다.
//  - removed: 성공한 갱신이 내려간 치료를 선택에서 뺐다는 안내. 성공해도 결과로 가지 않는다: 환자가 "예상 부담액 확인"을 다시 눌러야 한다.
// 같은 요소가 상태가 바뀌어도 그대로 남아(초점을 받을 수 있다) "다시 시도"를 누른 뒤 초점이 사라지지 않는다.

export type RefreshNoticeState =
  | { readonly kind: 'running' }
  | { readonly kind: 'failed'; readonly onRetry: () => void }
  | { readonly kind: 'removed'; readonly names: readonly string[] };

export const RefreshNotice = forwardRef<HTMLDivElement, { readonly notice: RefreshNoticeState }>(function RefreshNotice({ notice }, ref) {
  const copy = COPY.input.refresh;
  return (
    <div ref={ref} className={`kiosk-refresh kiosk-refresh--${notice.kind}`} role={notice.kind === 'failed' ? 'alert' : 'status'} tabIndex={-1} data-kiosk-refresh={notice.kind}>
      <Icon name={notice.kind === 'running' ? 'loader' : notice.kind === 'failed' ? 'wifi-off' : 'circle-alert'} size={36} className={notice.kind === 'running' ? 'kiosk-spin' : undefined} />
      <div className="kiosk-refresh__text">
        <p className="kiosk-refresh__title">{notice.kind === 'running' ? copy.runningTitle : notice.kind === 'failed' ? copy.failedTitle : copy.removedTitle}</p>
        {notice.kind === 'removed' ? <p className="kiosk-refresh__names">{notice.names.map((name) => `‘${name}’`).join(', ')}</p> : null}
        <p className="kiosk-refresh__body">{notice.kind === 'running' ? copy.runningBody : notice.kind === 'failed' ? copy.failedBody : copy.removedBody}</p>
        {notice.kind === 'failed' ? (
          <Button variant="secondary" icon="rotate-ccw" iconSize={30} className="kiosk-refresh__retry" onClick={notice.onRetry}>
            {copy.retry}
          </Button>
        ) : null}
      </div>
    </div>
  );
});
