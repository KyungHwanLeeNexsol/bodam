import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject, UIEvent } from 'react';
import { scrollCueOf } from '../view/scroll-cue';

// 스크롤 영역의 "더 있음" 측정 (SPEC-REIMBURSEMENT-001 M6 S4). 요소가 실제로 스크롤되고 넘치는지, 아래에 남은 내용이 있는지, 단서를 놓을 자리를 브라우저에서 잰다.
// 화면 상태·세션·저장소를 건드리지 않는다: 읽기만 하고 컴포넌트 안의 표시 상태만 갖는다(초기화·이용 완료로 화면이 사라지면 함께 사라진다).
// 다시 재는 때: 첫 그리기 뒤, 요소·자식의 크기가 바뀔 때(ResizeObserver), 자식이 늘고 줄 때(MutationObserver), 창 크기·방향이 바뀔 때, 스크롤할 때.

export interface ScrollRegionView {
  readonly scrollable: boolean;
  readonly more: boolean;
  /** 단서를 놓는 위치(뷰포트 좌표, 정수): 영역의 가로 가운데와 아래 가장자리. */
  readonly centerX: number;
  readonly bottom: number;
}

const HIDDEN: ScrollRegionView = { scrollable: false, more: false, centerX: 0, bottom: 0 };

function sameView(a: ScrollRegionView, b: ScrollRegionView): boolean {
  return a.scrollable === b.scrollable && a.more === b.more && a.centerX === b.centerX && a.bottom === b.bottom;
}

export function useScrollRegion<T extends HTMLElement>(): { readonly ref: RefObject<T | null>; readonly view: ScrollRegionView; readonly onScroll: (event: UIEvent<T>) => void } {
  const ref = useRef<T | null>(null);
  const [view, setView] = useState<ScrollRegionView>(HIDDEN);

  const measure = useCallback(() => {
    const element = ref.current;
    if (element === null) return;
    const overflowY = getComputedStyle(element).overflowY;
    const cue = scrollCueOf({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, scrollTop: element.scrollTop }, overflowY === 'auto' || overflowY === 'scroll');
    const box = element.getBoundingClientRect();
    const next: ScrollRegionView = cue.scrollable ? { ...cue, centerX: Math.round(box.left + box.width / 2), bottom: Math.round(box.bottom) } : HIDDEN;
    setView((previous) => (sameView(previous, next) ? previous : next));
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    measure();
    const sizes = new ResizeObserver(measure);
    const watch = (): void => {
      sizes.disconnect();
      sizes.observe(element);
      for (const child of Array.from(element.children)) sizes.observe(child);
    };
    watch();
    const changes = new MutationObserver(() => {
      watch();
      measure();
    });
    changes.observe(element, { childList: true, subtree: true, characterData: true });
    window.addEventListener('resize', measure);
    return () => {
      sizes.disconnect();
      changes.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  const onScroll = useCallback(() => {
    measure();
  }, [measure]);

  return { ref, view, onScroll };
}
