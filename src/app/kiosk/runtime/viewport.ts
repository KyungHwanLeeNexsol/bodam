import { useEffect, useState } from 'react';
import type { Orientation } from '../state/display';

// 화면 방향 읽기 (SPEC-REIMBURSEMENT-001 M6, BRIEF D4 a). 상태 기계는 방향을 "관찰값"으로만 받는다(display.ts): 읽는 곳은 matchMedia 하나다.

export const LANDSCAPE_QUERY = '(orientation: landscape)';

/** 지금 뷰포트의 방향. matchMedia 가 없으면 세로다(서버 렌더링 포함). */
export function readOrientation(): Orientation {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(LANDSCAPE_QUERY).matches ? 'LANDSCAPE' : 'PORTRAIT';
}

/**
 * 컨트롤러가 없는 화면(자료를 받는 중·오류)의 방향. 서버 렌더링과 첫 그리기는 세로로 맞추고(하이드레이션 불일치가 없다), 붙은 직후 실제 값으로 바꾼다.
 * 컨트롤러가 생긴 뒤에는 상태의 display.orientation 이 유일한 출처이고 이 값은 쓰지 않는다.
 */
export function useViewportOrientation(): Orientation {
  const [orientation, setOrientation] = useState<Orientation>('PORTRAIT');
  useEffect(() => {
    const media = window.matchMedia(LANDSCAPE_QUERY);
    const sync = (): void => setOrientation(media.matches ? 'LANDSCAPE' : 'PORTRAIT');
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  return orientation;
}
