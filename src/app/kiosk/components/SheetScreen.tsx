import type { ReactNode } from 'react';
import { ResultBar } from './ResultBar';
import { ScrollRegion } from './ScrollRegion';
import { TestDataNotice } from './TestDataNotice';

// 근거·필요 서류 화면의 공통 뼈대 (SPEC-REIMBURSEMENT-001 M6 S3b, 디자인 K04_Basis_Calculation `GhMYi`·K07_Documents `F19r1B`·L_K07_Documents `CL4xk`).
// 위에서 아래로: (테스트 데이터 표시) → 결과 막대(이름 + "예시 계산"/"예시 기준" 배지) → 스크롤되는 본문(제목·부제·내용) → (쪽 넘김) → 하단 동작.
//  - 본문은 세로로 스크롤된다: 큰 글자 보기·긴 사유로 한 화면에 다 들어가지 않으면 기능을 빼지 않고 스크롤한다(DD-12). 스크롤 막대를 늘 보이게 해(CSS) 아래에 더 있음을 알린다.
//  - 쪽 넘김과 하단 동작은 본문 밖에 고정이라 늘 보이고 닿는다.
//  - 제목은 화면의 대표 제목이라 초점 복귀 표지(data-kiosk-primary)를 가진다. 가로형의 `condition` 은 제목 오른쪽 한 줄 요약이다.

export type SheetKind = 'basis' | 'documents' | 'documents-unknown' | 'unavailable';

export interface SheetScreenProps {
  readonly kind: SheetKind;
  readonly barLabel: string;
  readonly badge: ReactNode;
  readonly title: string;
  readonly subtitle?: string | undefined;
  /** 가로형의 한 줄 요약(제목 오른쪽). */
  readonly condition?: string | undefined;
  readonly testData: boolean;
  readonly pager?: ReactNode;
  readonly footer: ReactNode;
  readonly children: ReactNode;
}

export function SheetScreen({ kind, barLabel, badge, title, subtitle, condition, testData, pager, footer, children }: SheetScreenProps) {
  return (
    <div className="kiosk-sheet" data-sheet={kind}>
      {testData ? <TestDataNotice /> : null}
      <ResultBar label={barLabel} badge={badge} />
      <ScrollRegion className="kiosk-sheet__body">
        <div className="kiosk-sheet__head">
          <h1 className="kiosk-sheet__title" tabIndex={-1} data-kiosk-primary>
            {title}
          </h1>
          {subtitle === undefined ? null : <p className="kiosk-sheet__subtitle">{subtitle}</p>}
          {condition === undefined ? null : <p className="kiosk-sheet__condition">{condition}</p>}
        </div>
        {children}
      </ScrollRegion>
      {pager}
      {footer}
    </div>
  );
}
