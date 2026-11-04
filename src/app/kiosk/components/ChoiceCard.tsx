import type { ReactNode } from 'react';
import { Icon } from './icons';

// 선택 카드의 바탕 (디자인 GenerationCard·InsuranceTypeCard·TreatmentCard 의 공통 동작, BRIEF D15).
// 카드 한 장 = 진짜 <label> 안의 네이티브 <input type="radio|checkbox"> 다: 키보드(Tab·Space·방향키)와 화면 낭독기의 radio·checkbox 의미를 브라우저가 준다.
// 입력은 카드 전체를 덮는 투명한 요소라 카드 어디를 눌러도 입력이 직접 눌린다(터치 영역 = 카드). 초점 표시는 카드 윤곽선(굵은 윤곽 + 간격)으로 색에만 기대지 않는다.
// 잠금(locked)은 aria-disabled 와 스타일뿐이다: 눌러도 아무 일이 없게 하는 것은 호출하는 화면의 핸들러가 한다(AC-020i).

export interface ChoiceCardProps {
  readonly type: 'radio' | 'checkbox';
  /** 라디오 묶음 이름(같은 단계의 카드끼리 같다). */
  readonly name?: string | undefined;
  readonly selected: boolean;
  readonly locked?: boolean | undefined;
  readonly onChange: () => void;
  readonly ariaLabel?: string | undefined;
  readonly labelledBy?: string | undefined;
  readonly describedBy?: string | undefined;
  readonly variant: 'generation' | 'type' | 'treatment';
  readonly children: ReactNode;
}

export function ChoiceCard({ type, name, selected, locked = false, onChange, ariaLabel, labelledBy, describedBy, variant, children }: ChoiceCardProps) {
  const classes = ['kiosk-choice', `kiosk-choice--${variant}`, ...(selected ? ['kiosk-choice--selected'] : []), ...(locked ? ['kiosk-choice--locked'] : [])].join(' ');
  return (
    <label className={classes}>
      <input
        className="kiosk-choice__input"
        type={type}
        name={name}
        checked={selected}
        onChange={onChange}
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-disabled={locked ? true : undefined}
      />
      {children}
    </label>
  );
}

/** 오른쪽 끝의 선택 표시: 빈 원 ↔ 체크 원 + "선택됨" (글자와 모양으로도 구분한다). */
export function RadioMark({ selected, label }: { readonly selected: boolean; readonly label: string }) {
  return selected ? (
    <span className="kiosk-choice__mark kiosk-choice__mark--on" aria-hidden="true">
      <span className="kiosk-choice__check">
        <Icon name="check" size={36} />
      </span>
      <span className="kiosk-choice__mark-label">{label}</span>
    </span>
  ) : (
    <span className="kiosk-choice__mark kiosk-choice__mark--off" aria-hidden="true">
      <span className="kiosk-choice__ring" />
    </span>
  );
}
