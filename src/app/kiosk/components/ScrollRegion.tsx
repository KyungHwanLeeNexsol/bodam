import { createElement } from 'react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { useScrollRegion } from '../runtime/use-scroll-region';
import { COPY } from '../view/copy';
import { Icon } from './icons';

// 스크롤되는 본문 (SPEC-REIMBURSEMENT-001 M6 S4, DD-12 "넘치면 스크롤" 의 보완). 터치 화면은 스크롤 막대가 숨겨지기 쉬워 아래에 내용이 더 있음을 놓친다
// (예: 가로 계산 근거 화면의 마지막 줄 "예상 보험금", 큰 글자 결과 화면의 안내). 이 요소는 본문이 눈에 띄게 넘칠 때만:
//  - 아래에 더 있는 동안 영역 아래 가운데에 "아래에 더 있어요" 단서를 보이고(끝까지 내리면 사라진다),
//  - 키보드로 초점을 받아 방향키·PageDown 으로 스크롤할 수 있게 하고(tabIndex 0), 이름을 붙인다(기본 "화면 내용", 영역이 겹치는 화면은 label 로 구별되는 이름을 준다).
// 넘치지 않으면 아무것도 더하지 않는다: 쓸모없는 Tab 정지점·단서가 모든 화면에 생기지 않는다. 기능·금액·문구는 바뀌지 않고 표시만 더해진다.
// 단서는 레이아웃에 자리를 차지하지 않는다(position: fixed, 측정한 좌표). 눌러지지 않고(pointer-events: none) 화면 낭독기에는 숨긴다: 키보드 사용자는 영역의 이름과 스크롤로 알 수 있다.
// 요소에 이미 역할이 있으면(라디오 묶음 등) 역할은 그대로 두고 초점만 더한다. 서버 렌더링에서는 측정이 없으므로 아무것도 더해지지 않는다.

type ScrollRegionProps = Omit<ComponentPropsWithoutRef<'div'>, 'children' | 'onScroll' | 'ref'> & {
  /** 기본은 div. 상태 안내 화면은 section. */
  readonly as?: 'div' | 'section';
  readonly children: ReactNode;
  /** 영역의 접근 가능한 이름. 한 화면에 영역이 둘 이상 겹칠 때 서로 구별되게 준다(기본은 COPY.scroll.regionLabel). aria-label 을 직접 주면 그것이 먼저다. */
  readonly label?: string | undefined;
};

export function ScrollRegion({ as = 'div', children, role, label, ...rest }: ScrollRegionProps) {
  const { ref, view, onScroll } = useScrollRegion<HTMLElement>();
  const scrollProps = view.scrollable
    ? { tabIndex: 0, role: role ?? 'region', 'aria-label': rest['aria-label'] ?? label ?? COPY.scroll.regionLabel, 'data-scroll-more': view.more ? 'true' : 'false' }
    : { role };
  return (
    <>
      {createElement(as, { ...rest, ref, onScroll, ...scrollProps }, children)}
      {view.more ? (
        <div className="kiosk-scroll-cue" data-kiosk-scroll-cue aria-hidden="true" style={{ left: view.centerX, top: view.bottom }}>
          <Icon name="chevron-down" size={32} />
          <span>{COPY.scroll.cue}</span>
        </div>
      ) : null}
    </>
  );
}
