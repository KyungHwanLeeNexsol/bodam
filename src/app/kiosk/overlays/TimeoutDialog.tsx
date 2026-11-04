import { useEffect, useState } from 'react';
import { Button } from '../components/Button';
import { useKiosk } from '../runtime/kiosk-context';
import { selectTimeoutDialog } from '../state/idle';
import { COPY } from '../view/copy';
import { Modal } from './Modal';

// 무조작 경고창 (디자인 TimeoutDialog·K04_Result_Dialog_Timeout, 기획서 §13.2, DD-07·DD-10). 상태 기계가 TICK 으로 연다.
// "계속 사용할게요" = CONTINUE_USING (무조작 시간을 처음부터 다시 센다, 횟수 제한 없음), "처음으로" = REQUEST_HOME (이 창이 이미 확인 단계라 ResetConfirm 없이 바로 지운다).
// 남은 시간은 표시 전용이다: selectTimeoutDialog(state, 지금) 에서 읽고, 값이 바뀌는 순간에 맞춰 다시 그릴 뿐 어떤 사건도 보내지 않는다.
// 초기화 시각은 창이 열릴 때 정해져 있고 이 화면이 늘리지도 줄이지도 않는다(DD-07 규칙 4). 시각이 되면 상태 기계의 타이머가 지운다.
// Escape 는 무시한다(환자가 모르고 눌러 닫히거나 지워지지 않는다). 처음 초점은 "계속 사용할게요"다.

/** 남은 초(올림). 남은 시간이 1ms 라도 있으면 1초로 보인다. */
export function secondsLeft(remainingMs: number): number {
  return Math.ceil(remainingMs / 1000);
}

/** 표시 값이 한 칸 내려가기까지 남은 시간(밀리초): 남은 시간이 (표시 값 - 1)초 아래로 내려가는 순간 + 1ms. */
export function redrawDelay(remainingMs: number): number {
  return remainingMs - (secondsLeft(remainingMs) - 1) * 1000 + 1;
}

export function TimeoutDialog() {
  const { read, send } = useKiosk();
  const [, redraw] = useState(0);
  const view = read(selectTimeoutDialog);
  const seconds = view === null ? 0 : secondsLeft(view.remainingMs);

  // 표시 값이 한 칸 내려가는 순간(남은 시간이 (seconds-1)*1000 이하가 되는 때)에 한 번 다시 그린다. 상태 사건이 아니라 이 컴포넌트만의 그리기다.
  useEffect(() => {
    if (view === null || seconds <= 0) return;
    const handle = setTimeout(() => redraw((count) => count + 1), redrawDelay(view.remainingMs));
    return () => clearTimeout(handle);
  }, [view, seconds]);

  return (
    <Modal titleId="kiosk-timeout-title" bodyId="kiosk-timeout-body">
      <div className="kiosk-countdown">
        <span className="kiosk-countdown__label">{COPY.timeoutDialog.countdownLabel}</span>
        <span className="kiosk-countdown__value">{seconds}</span>
        <span className="kiosk-countdown__unit">{COPY.timeoutDialog.countdownUnit}</span>
      </div>
      <h2 id="kiosk-timeout-title" className="kiosk-dialog__title">
        {COPY.timeoutDialog.title}
      </h2>
      <p id="kiosk-timeout-body" className="kiosk-dialog__body">
        {COPY.timeoutDialog.body(seconds)}
      </p>
      <p className="kiosk-dialog__note">{COPY.timeoutDialog.note}</p>
      <div className="kiosk-dialog__actions">
        <Button
          variant="secondary"
          onClick={() => {
            send({ type: 'REQUEST_HOME' });
          }}
        >
          {COPY.timeoutDialog.reset}
        </Button>
        <Button
          variant="primary"
          data-kiosk-initial-focus
          onClick={() => {
            send({ type: 'CONTINUE_USING' });
          }}
        >
          {COPY.timeoutDialog.continue}
        </Button>
      </div>
    </Modal>
  );
}
