import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import type { Orientation } from '../state/display';

// 키오스크 화면의 루트 (SPEC-REIMBURSEMENT-001 M6, BRIEF D6). 방향과 큰 글자 보기를 data 속성으로 노출해 CSS 가 배치를 바꾼다.
// 값은 컨트롤러가 있으면 상태(selectLayout)에서, 없으면(자료를 받는 중·오류) 뷰포트 방향과 "꺼짐"에서 온다. 데이터는 바꾸지 않는다(DD-12).

type NativeDiv = Omit<ComponentPropsWithoutRef<'div'>, 'className' | 'children'>;

export interface KioskFrameProps extends NativeDiv {
  readonly orientation: Orientation;
  readonly largeText: boolean;
  readonly children: ReactNode;
}

export function KioskFrame({ orientation, largeText, children, ...rest }: KioskFrameProps) {
  return (
    <div className="kiosk-root" lang="ko" data-orientation={orientation === 'LANDSCAPE' ? 'landscape' : 'portrait'} data-large-text={largeText ? 'true' : 'false'} {...rest}>
      {children}
    </div>
  );
}
