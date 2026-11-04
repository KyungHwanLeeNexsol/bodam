import type { ReactNode } from 'react';
import { BottomActions } from '../components/BottomActions';
import { Button } from '../components/Button';
import { useKiosk } from '../runtime/kiosk-context';
import { selectRefresh } from '../state/selectors';
import { COPY } from '../view/copy';

// 2~4단계의 하단 동작: "처음으로"(REQUEST_HOME) · "이전"(PREV) · 주 버튼(2·3단계 "다음", 4단계 "예상 부담액 확인").
// 디자인 프레임은 이전 + 주 버튼 둘이고 "처음으로"는 그리지 않았다. 처음으로 확인창(ResetConfirm)과 무조작 정책이 "모든 화면의 처음으로"를 전제하므로(기획서 §13.2, DD-13) 자리를 더했다(파생).
// `previousLocked` 는 갱신이 진행 중인 4단계에서 "이전"을 잠근다(AC-020i). 잠금은 눌러도 사건이 나가지 않는 것까지 이 컴포넌트가 지킨다.

export interface StepFooterProps {
  readonly primaryLabel: string;
  readonly primaryDisabled: boolean;
  readonly onPrimary: () => void;
  readonly previousLocked?: boolean;
  readonly describedBy?: string | undefined;
  readonly lead?: ReactNode;
}

export function StepFooter({ primaryLabel, primaryDisabled, onPrimary, previousLocked = false, describedBy, lead }: StepFooterProps) {
  const { send, read } = useKiosk();
  return (
    <BottomActions three lead={lead}>
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
        icon="chevron-left"
        disabled={previousLocked}
        onClick={() => {
          // 화면의 잠금 표시와 별개로 보내는 순간의 상태로 한 번 더 막는다(AC-020i). 상태 기계의 우회 방어(AC-020g 3)와는 다른 층이다.
          if (read((state) => selectRefresh(state).locked)) return;
          send({ type: 'PREV' });
        }}
      >
        {COPY.buttons.previous}
      </Button>
      <Button variant="primary" icon="chevron-right" disabled={primaryDisabled} aria-describedby={describedBy} onClick={onPrimary}>
        {primaryLabel}
      </Button>
    </BottomActions>
  );
}
