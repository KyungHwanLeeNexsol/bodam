import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { Icon } from './icons';
import type { IconName } from './icons';

// 키오스크 버튼 (디자인 Button_Primary·Button_Secondary, BRIEF D14·D15).
// 진짜 <button> 이고 터치 영역은 kiosk.css 가 72 CSS px 이상으로 보장한다(디자인 높이 88).
// 비활성은 disabled 속성이 아니라 aria-disabled 로 표시한다: 초점을 받을 수 있어 화면 낭독기가 이유 문장과 함께 읽을 수 있고, 눌러도 아무 일도 하지 않는다.
// 아이콘은 라벨 오른쪽 끝에 놓는다(디자인: 라벨은 가운데, 아이콘은 오른쪽 끝).

type NativeButton = Omit<ComponentPropsWithoutRef<'button'>, 'onClick' | 'disabled' | 'type' | 'className' | 'children'>;

export interface ButtonProps extends NativeButton {
  readonly variant: 'primary' | 'secondary';
  readonly children: ReactNode;
  readonly onClick?: (() => void) | undefined;
  readonly disabled?: boolean | undefined;
  readonly icon?: IconName | undefined;
  readonly iconSize?: number | undefined;
  /** 가로 전체를 채운다. */
  readonly block?: boolean | undefined;
  readonly className?: string | undefined;
}

export function Button({ variant, children, onClick, disabled = false, icon, iconSize = 34, block = false, className, ...rest }: ButtonProps) {
  const classes = ['kiosk-button', `kiosk-button--${variant}`, ...(block ? ['kiosk-button--block'] : []), ...(className === undefined ? [] : [className])].join(' ');
  return (
    <button type="button" className={classes} aria-disabled={disabled ? true : undefined} onClick={disabled ? undefined : onClick} {...rest}>
      <span className="kiosk-button__label">{children}</span>
      {icon === undefined ? null : <Icon name={icon} size={iconSize} />}
    </button>
  );
}
