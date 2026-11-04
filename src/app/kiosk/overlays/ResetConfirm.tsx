import { Button } from '../components/Button';
import { Icon } from '../components/icons';
import { useKiosk } from '../runtime/kiosk-context';
import { COPY } from '../view/copy';
import { Modal } from './Modal';

// "처음으로" 확인창 (디자인 ConfirmDialog·K03_Treatments_Dialog_Reset, 기획서 §13.2, DD-13). 환자 입력이 있을 때만 뜬다(reducer 가 정한다).
// "계속 이용" = CANCEL_RESET (선택·결과·화면 그대로), "처음으로" = CONFIRM_RESET (전체 삭제 후 K00_Start, K06_Complete 를 거치지 않는다).
// 처음 초점은 "계속 이용"이다: 실수로 Enter·스페이스를 눌러도 선택을 잃지 않는다. Escape 는 취소와 같다.

export function ResetConfirm() {
  const { send } = useKiosk();
  const cancel = (): void => {
    send({ type: 'CANCEL_RESET' });
  };
  return (
    <Modal titleId="kiosk-reset-title" bodyId="kiosk-reset-body" onEscape={cancel}>
      <span className="kiosk-dialog__icon">
        <Icon name="rotate-ccw" size={44} />
      </span>
      <h2 id="kiosk-reset-title" className="kiosk-dialog__title">
        {COPY.resetConfirm.title}
      </h2>
      <p id="kiosk-reset-body" className="kiosk-dialog__body">
        {COPY.resetConfirm.body}
      </p>
      <div className="kiosk-dialog__actions">
        <Button variant="secondary" data-kiosk-initial-focus onClick={cancel}>
          {COPY.resetConfirm.cancel}
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            send({ type: 'CONFIRM_RESET' });
          }}
        >
          {COPY.resetConfirm.confirm}
        </Button>
      </div>
    </Modal>
  );
}
