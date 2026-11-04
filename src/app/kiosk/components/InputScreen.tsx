import type { ReactNode } from 'react';
import { COPY } from '../view/copy';
import { ScrollRegion } from './ScrollRegion';
import { StepIndicator } from './StepIndicator';
import type { StepNumber } from './StepIndicator';

// 입력 단계 화면의 공통 뼈대 (디자인 K01~K03 의 Body, 가로형 "Question Column" + 오른쪽 목록). 한 DOM 으로 두 방향을 그린다(CSS 가 배치를 바꾼다):
//  - 세로: 제목 → 안내(notice) → 선택 목록 → 부속(aside) 한 열.
//  - 가로: 왼쪽 열(제목, 그 아래 부속) + 오른쪽 선택 목록, 진행·오류 안내(notice)는 두 열 위를 가로지르는 띠 (격자 영역으로 배치).
// DOM 순서는 세로의 눈에 보이는 순서와 같다: 키보드 초점 순서가 화면 순서를 따른다(제목 → 목록 → 부속의 단추).
// 제목은 화면의 대표 제목이라 초점 복귀 표지(data-kiosk-primary)를 가진다. 큰 글자 보기에서 한 화면에 다 들어가지 않으면 본문이 세로로 스크롤된다(기능을 빼지 않는다, DD-12).

export interface InputScreenProps {
  readonly step: StepNumber;
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly kind: 'generation' | 'type' | 'treatments';
  /** 제목 아래에 놓는 진행·오류 안내(자료 갱신 등). */
  readonly notice?: ReactNode;
  /** 선택 목록 아래(세로)·왼쪽 열 아래(가로)에 놓는 부속 요소. */
  readonly aside?: ReactNode;
  readonly footer: ReactNode;
  readonly children: ReactNode;
}

export function InputScreen({ step, title, subtitle, kind, notice, aside, footer, children }: InputScreenProps) {
  return (
    <div className="kiosk-input" data-input={kind}>
      <StepIndicator step={step} />
      <ScrollRegion label={COPY.scroll.inputBodyLabel} className="kiosk-input__body" data-has-notice={notice === undefined || notice === null ? undefined : 'true'}>
        <div className="kiosk-input__title">
          <h1 className="kiosk-input__heading" tabIndex={-1} data-kiosk-primary>
            {title}
          </h1>
          {subtitle === undefined ? null : <p className="kiosk-input__subtitle">{subtitle}</p>}
        </div>
        {notice === undefined || notice === null ? null : <div className="kiosk-input__notice">{notice}</div>}
        <ScrollRegion label={COPY.scroll.inputChoicesLabel} className="kiosk-input__choices">{children}</ScrollRegion>
        {aside === undefined || aside === null ? null : <ScrollRegion label={COPY.scroll.inputAsideLabel} className="kiosk-input__aside">{aside}</ScrollRegion>}
      </ScrollRegion>
      {footer}
    </div>
  );
}
