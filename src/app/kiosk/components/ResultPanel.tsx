import { useId } from 'react';
import type { HoldGroupView } from '../view/hold-reasons';
import { COPY } from '../view/copy';
import type { ExclusionView } from '../view/result-view';
import { Badge } from './Badge';
import { Icon } from './icons';

// 결과 화면의 안내 패널 둘 (디자인 Assumption Panel = HelpPanel `PxiwY` 의 warn 변형: 바탕 warn-soft, 테두리 warn, info 아이콘).
//  - ExclusionPanel: 보장 제외 결과(K04_Result_NotCovered)의 제외 항목·사유와 나머지 항목 기준의 가정 문장(AC-013b). 디자인의 "디자인 예시이며 …" 자리 표시 문장은 싣지 않는다(plan.md §E #27).
//    제목 줄을 따로 두지 않고(구역 이름은 aria-label) 이름·금액·"보장 제외"·사유를 한 줄에 놓는다: 보장 제외 결과가 한 화면에 들어가게 높이를 아낀다.
//  - HoldPanel: 보류 결과(K04_Result_Hold)의 환자용 분류별 목록(DD-21). 디자인 프레임이 없어 같은 패널 모양으로 구성했다(파생). 내부 코드·참고 그룹 값이 없다.

export function ExclusionPanel({ exclusions, notes }: { readonly exclusions: readonly ExclusionView[]; readonly notes: readonly string[] }) {
  return (
    <section className="kiosk-panel kiosk-panel--warn kiosk-panel--compact" aria-label={COPY.result.exclusion.title} data-kiosk-block data-kiosk-panel="exclusion">
      <Icon name="info" size={34} />
      <div className="kiosk-panel__content">
        <ul className="kiosk-panel__list">
          {exclusions.map((item) => (
            <li key={`${item.name}|${item.amount}|${item.reason}`} className="kiosk-exclusion">
              <span className="kiosk-exclusion__name">{item.name}</span>
              <span className="kiosk-exclusion__amount">{item.amount}</span>
              <Badge tone="warn">{COPY.result.exclusion.excludedTag}</Badge>
              <span className="kiosk-exclusion__reason">{item.reason}</span>
            </li>
          ))}
        </ul>
        {notes.map((note) => (
          <p key={note} className="kiosk-panel__note">
            {note}
          </p>
        ))}
      </div>
    </section>
  );
}

export function HoldPanel({ groups }: { readonly groups: readonly HoldGroupView[] }) {
  const titleId = useId();
  return (
    <section className="kiosk-panel kiosk-panel--warn" aria-labelledby={titleId} data-kiosk-block data-kiosk-panel="hold">
      <div className="kiosk-panel__title">
        <Icon name="info" size={34} />
        <h2 id={titleId} className="kiosk-panel__heading">
          {COPY.result.hold.panelTitle}
        </h2>
      </div>
      <div className="kiosk-hold">
        {groups.map((group) => (
          <div key={group.key} className="kiosk-hold__group" data-kiosk-hold-class={group.key}>
            <p className="kiosk-hold__phrase">{group.phrase}</p>
            {group.items.length === 0 ? null : <p className="kiosk-hold__items">{group.items.join(', ')}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
