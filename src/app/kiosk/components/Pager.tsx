import { Icon } from './icons';
import { COPY } from '../view/copy';

// 목록 쪽 넘김 (치료 목록·필요 서류 목록이 같이 쓴다. 디자인 Pager `d403xg`: "이전 목록" · "n / m 페이지" · "다음 목록"). 두 버튼은 늘 보이고, 갈 쪽이 없으면 aria-disabled 다.
// 쪽을 넘겨도 선택은 그대로이고 계산 요청은 없다(AC-012e, AC-014d). 갱신이 진행 중이어도 쪽 넘김은 잠기지 않는다(BRIEF D5).

export interface PagerProps {
  readonly pageIndex: number;
  readonly pageCount: number;
  readonly hasPrev: boolean;
  readonly hasNext: boolean;
  readonly onPrev: () => void;
  readonly onNext: () => void;
  /** 쪽 넘김 영역의 이름(화면 낭독기용). 기본은 치료 목록이다. */
  readonly label?: string | undefined;
}

export function Pager({ pageIndex, pageCount, hasPrev, hasNext, onPrev, onNext, label = COPY.input.treatments.pager.label }: PagerProps) {
  return (
    <nav className="kiosk-pager" aria-label={label}>
      <button type="button" className="kiosk-pager__button" aria-disabled={hasPrev ? undefined : true} onClick={hasPrev ? onPrev : undefined}>
        <Icon name="chevron-left" size={32} />
        <span>{COPY.input.treatments.pager.previous}</span>
      </button>
      <span className="kiosk-pager__status" aria-live="polite">
        {COPY.input.treatments.pager.status(pageIndex + 1, pageCount)}
      </span>
      <button type="button" className="kiosk-pager__button" aria-disabled={hasNext ? undefined : true} onClick={hasNext ? onNext : undefined}>
        <span>{COPY.input.treatments.pager.next}</span>
        <Icon name="chevron-right" size={32} />
      </button>
    </nav>
  );
}
