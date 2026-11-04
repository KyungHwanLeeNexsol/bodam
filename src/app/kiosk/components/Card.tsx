import type { ComponentPropsWithoutRef, ReactNode } from 'react';

// 카드 기본형 (디자인 카드: surface, border 2, r-card 20). 선택 카드(역할 radio·checkbox)와 금액 카드는 후속 단계가 이 위에 만든다.
// 카드는 그림자를 쓰지 않는다: border 로 구분한다(디자인 명세).

type NativeDiv = Omit<ComponentPropsWithoutRef<'div'>, 'className' | 'children'>;

export interface CardProps extends NativeDiv {
  readonly children: ReactNode;
  readonly selected?: boolean | undefined;
  readonly className?: string | undefined;
}

export function Card({ children, selected = false, className, ...rest }: CardProps) {
  const classes = ['kiosk-card', ...(selected ? ['kiosk-card--selected'] : []), ...(className === undefined ? [] : [className])].join(' ');
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}
