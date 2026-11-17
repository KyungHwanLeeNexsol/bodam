import type { SelectionTotals } from '../state/selectors';
import { COPY } from '../view/copy';
import { formatWon } from '../view/format';

// 선택 요약 (디자인 SelectionSummary `gRs6f`, 가로형 L_K03 의 "Selection Panel" 과 하단 합계).
// 금액은 모두 선택자 selectTotals(엔진 sumLineAmounts)의 값을 쓰는 표시일 뿐이다: 이 파일에는 덧셈이 없다(AC-019c). 총 예상 결제액은 선택 요약이며 보험 계산 결과가 아니다.
// 치료를 아직 고르지 않았을 때의 "0원"은 선택 합계가 0이라는 뜻의 계산 값이다(디자인 K03_Treatments_Empty).

/** 세로형: 목록 아래 막대. */
export function SelectionSummaryBar({ totals }: { readonly totals: SelectionTotals }) {
  return (
    <section className="kiosk-summary kiosk-summary--bar" aria-label={COPY.input.treatments.summaryLabel}>
      <div className="kiosk-summary__row">
        <span className="kiosk-summary__count" aria-live="polite">
          {COPY.input.treatments.selectedCount(totals.selectedCount)}
        </span>
        <span className="kiosk-summary__breakdown">{COPY.input.treatments.breakdown(formatWon(totals.benefit), formatWon(totals.nonBenefit))}</span>
      </div>
      <div className="kiosk-summary__row">
        <span className="kiosk-summary__total-label">{COPY.input.treatments.totalLabel}</span>
        <span className={totals.selectedCount === 0 ? 'kiosk-summary__total kiosk-summary__total--muted' : 'kiosk-summary__total'}>{formatWon(totals.total)}</span>
      </div>
    </section>
  );
}

/** 가로형: 왼쪽 열의 선택 패널(선택 개수·급여 합계·비급여 합계). */
export function SelectionSummaryPanel({ totals }: { readonly totals: SelectionTotals }) {
  return (
    <section className="kiosk-summary kiosk-summary--panel" aria-label={COPY.input.treatments.summaryLabel}>
      <div className="kiosk-summary__row">
        <span className="kiosk-summary__key">{COPY.input.treatments.panelCount}</span>
        <span className="kiosk-summary__value" aria-live="polite">{`${totals.selectedCount}개`}</span>
      </div>
      <div className="kiosk-summary__row">
        <span className="kiosk-summary__key">{COPY.input.treatments.panelBenefit}</span>
        <span className="kiosk-summary__value">{formatWon(totals.benefit)}</span>
      </div>
      <div className="kiosk-summary__row">
        <span className="kiosk-summary__key">{COPY.input.treatments.panelNonBenefit}</span>
        <span className="kiosk-summary__value">{formatWon(totals.nonBenefit)}</span>
      </div>
    </section>
  );
}

/** 가로형 하단 막대 왼쪽의 합계 두 줄. */
export function SelectionTotalLine({ totals }: { readonly totals: SelectionTotals }) {
  return (
    <div className="kiosk-summary kiosk-summary--line">
      <span className="kiosk-summary__line-1">{`${COPY.input.treatments.totalLabel} (${COPY.input.treatments.breakdown(formatWon(totals.benefit), formatWon(totals.nonBenefit))})`}</span>
      <span className={totals.selectedCount === 0 ? 'kiosk-summary__line-2 kiosk-summary__total--muted' : 'kiosk-summary__line-2'}>{formatWon(totals.total)}</span>
    </div>
  );
}
