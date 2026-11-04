import type { KioskEvent } from '../state/events';
import { COPY } from '../view/copy';
import type { ResultActionKey } from '../view/result-view';
import { Button } from './Button';

// 결과 화면의 동작 (디자인 "Result Actions": 서류 확인(주 동작, accent-soft) / 계산 근거 · 치료 다시 선택 · 보험 조건 수정 / 처음으로 · 이용 완료(primary)).
// 정상·보장 제외 결과는 여섯 개이고 큰 글자 보기·가로형에서도 줄이지 않는다(AC-013e). 보류 결과는 네 개뿐이다: 서류 확인·계산 근거가 없다(AC-013c).
// 모두 이미 있는 사건으로 간다(새 사건을 만들지 않는다). 서류·근거로 갈 수 있는지(저장된 결과·원인)는 상태 기계가 정하고, 못 가면 사건이 거절돼 화면이 그대로다.
// 배치는 CSS 격자가 정한다: 세로 = 서류 한 줄 + 보조 셋 + (처음으로, 이용 완료), 가로 = 서류 한 줄 + 한 줄에 다섯. DOM 순서는 눈에 보이는 순서이고 키보드 초점 순서도 같다.

const EVENT_OF: Readonly<Record<ResultActionKey, KioskEvent>> = {
  DOCUMENTS: { type: 'OPEN_DOCUMENTS' },
  BASIS: { type: 'OPEN_BASIS' },
  RESELECT: { type: 'RESELECT_TREATMENTS' },
  EDIT_INSURANCE: { type: 'EDIT_INSURANCE' },
  HOME: { type: 'REQUEST_HOME' },
  COMPLETE: { type: 'COMPLETE_USE' },
};

const LABEL: Readonly<Record<ResultActionKey, string>> = {
  DOCUMENTS: COPY.result.actions.documents,
  BASIS: COPY.result.actions.basis,
  RESELECT: COPY.result.actions.reselect,
  EDIT_INSURANCE: COPY.result.actions.editInsurance,
  HOME: COPY.result.actions.home,
  COMPLETE: COPY.result.actions.complete,
};

export function ResultActions({ actions, onAction }: { readonly actions: readonly ResultActionKey[]; readonly onAction: (event: KioskEvent) => void }) {
  return (
    <div className="kiosk-result-actions" data-actions={actions.length}>
      {actions.map((key) => (
        <Button
          key={key}
          variant={key === 'COMPLETE' ? 'primary' : 'secondary'}
          icon={key === 'DOCUMENTS' ? 'file-text' : key === 'HOME' ? 'rotate-ccw' : key === 'COMPLETE' ? 'check' : undefined}
          className={`kiosk-result-actions__button kiosk-result-actions__button--${key.toLowerCase().replace('_', '-')}${key === 'DOCUMENTS' ? ' kiosk-button--accent-soft' : ''}`}
          data-kiosk-action={key}
          onClick={() => {
            onAction(EVENT_OF[key]);
          }}
        >
          {LABEL[key]}
        </Button>
      ))}
    </div>
  );
}
