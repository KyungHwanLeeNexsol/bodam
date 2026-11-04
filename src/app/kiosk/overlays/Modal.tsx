import { useEffect, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

// 겹침창의 공통 껍질 (SPEC-REIMBURSEMENT-001 M6, BRIEF D8, 기획서 §13.1 "모달이 열리면 포커스가 모달 안으로 이동해 밖으로 나가지 않고, 닫으면 열기 전 위치로 돌아간다").
//  - role="dialog" aria-modal="true", 제목·본문으로 이름을 붙인다. 밑 화면의 inert·aria-hidden 은 LiveKiosk 가 건다(겹침창은 inert 덮개의 형제다).
//  - 처음 초점은 data-kiosk-initial-focus 가 붙은 버튼(없으면 첫 버튼)이다. 되돌릴 수 없는 동작이 아니라 안전한 동작에 둔다.
//  - Tab·Shift+Tab 은 창 안에서만 돈다. Escape 는 호출하는 쪽이 정한다(onEscape 가 없으면 아무 일도 없다).
// 닫힐 때 초점을 돌려주는 일은 겹침창 하나가 아니라 OverlayHost 가 한다(ResetConfirm → TimeoutDialog 로 바뀌어도 처음 열기 전 위치로 돌아가야 해서).

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => !element.hasAttribute('inert'));
}

/**
 * Tab·Shift+Tab 의 다음 초점 대상. 창 안의 처음·끝에서 반대쪽 끝으로 돌고(가둔다), 초점이 창 밖에 있으면 방향에 따라 처음·끝으로 끌어들인다.
 * 창 안의 중간 요소에서는 null 을 돌려 브라우저의 기본 이동에 맡긴다. 초점을 받을 요소가 없으면 null 이다(이동을 막는 것은 호출하는 쪽이 정한다).
 */
export function trapTarget<T>(items: readonly T[], active: T | null, inside: boolean, shift: boolean): T | null {
  const first = items[0];
  const last = items[items.length - 1];
  if (first === undefined || last === undefined) return null;
  if (shift) return active === first || !inside ? last : null;
  return active === last || !inside ? first : null;
}

export interface ModalProps {
  readonly titleId: string;
  readonly bodyId: string;
  readonly onEscape?: (() => void) | undefined;
  readonly children: ReactNode;
}

export function Modal({ titleId, bodyId, onEscape, children }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    (dialog.querySelector<HTMLElement>('[data-kiosk-initial-focus]') ?? focusableIn(dialog)[0] ?? dialog).focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onEscape?.();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusableIn(dialog);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    const target = trapTarget(items, active instanceof HTMLElement ? active : null, dialog.contains(active), event.shiftKey);
    if (target !== null) {
      event.preventDefault();
      target.focus();
    }
  }

  return (
    <div className="kiosk-overlay">
      <div ref={dialogRef} className="kiosk-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} tabIndex={-1} onKeyDown={onKeyDown}>
        {children}
      </div>
    </div>
  );
}
