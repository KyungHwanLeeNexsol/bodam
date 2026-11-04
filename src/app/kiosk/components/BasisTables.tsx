import { COPY } from '../view/copy';
import type { BasisSourceView, BasisView } from '../view/basis-view';
import { Badge } from './Badge';
import { Icon } from './icons';

// 계산 근거의 표와 패널 (SPEC-REIMBURSEMENT-001 M6 S3b, 디자인 K04_Basis_Calculation `GhMYi`의 Treatment Table·Deduction Table·Assumption Panel·Rule Source Area, DD-22, AC-014f).
// 값은 모두 보기 모양(basis-view)이 응답에서 읽은 문자열이다: 이 파일에는 금액 계산도, 응답을 직접 읽는 곳도 없다. 디자인의 예시 문장·예시 값은 싣지 않는다(plan.md §E #27).
//  - 치료 표: 치료 · 구분 · 환자 결제액 · 보장 대상 여부(보장 대상 / 보장 제외 / 확인 필요) + 병원 결제액 합계. 제외 항목은 색이 아니라 "보장 제외" 글자 배지로 구분한다.
//  - 공제·한도 표: 그룹마다 보장 대상 치료비 → 공제(가정) → 지급한도(가정) (+ 그룹 지급액·공유 한도 적용 후) 와 맨 아래 예상 보험금. 그룹이 하나이면 묶음 이름이 없다.
//  - 가정 패널(적용한 계산 가정 + 확인하지 않은 전제)과 약관 출처 패널: 약관 출처는 글자뿐이고 링크가 아니다(DD-11).

export function ConditionRows({ view }: { readonly view: BasisView }) {
  if (view.conditionRows.length === 0) return null;
  return (
    <dl className="kiosk-conditions kiosk-conditions--inline" data-kiosk-block>
      {view.conditionRows.map((row) => (
        <div key={row.label} className="kiosk-conditions__row">
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function TreatmentTable({ view }: { readonly view: BasisView }) {
  return (
    <div className="kiosk-table-card" data-kiosk-block data-basis-table="treatments">
      <table className="kiosk-table">
        <caption className="kiosk-sr-only">{COPY.basis.treatmentsLabel}</caption>
        <thead>
          <tr>
            <th scope="col">{COPY.basis.treatmentHead[0]}</th>
            <th scope="col">{COPY.basis.treatmentHead[1]}</th>
            <th scope="col" className="kiosk-table__num">
              {COPY.basis.treatmentHead[2]}
            </th>
            <th scope="col">{COPY.basis.treatmentHead[3]}</th>
          </tr>
        </thead>
        <tbody>
          {view.treatments.map((row, index) => (
            <tr key={`${String(index)}|${row.name}`}>
              <th scope="row">{row.name}</th>
              <td>{row.benefitLabel}</td>
              <td className="kiosk-table__num">{row.amount}</td>
              <td>{row.excluded ? <Badge tone="warn">{row.coverage}</Badge> : row.coverage}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={2}>
              {COPY.basis.hospitalTotal}
            </th>
            <td className="kiosk-table__num kiosk-table__strong">{view.hospitalTotal}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function StepsTable({ view }: { readonly view: BasisView }) {
  return (
    <div className="kiosk-table-card" data-kiosk-block data-basis-table="steps">
      <table className="kiosk-table kiosk-table--steps">
        <caption className="kiosk-sr-only">{COPY.basis.stepsLabel}</caption>
        <thead>
          <tr>
            <th scope="col">{COPY.basis.stepsHead[0]}</th>
            <th scope="col" className="kiosk-table__num">
              {COPY.basis.stepsHead[1]}
            </th>
          </tr>
        </thead>
        {view.groups.map((group, index) => (
          <tbody key={`group-${String(index)}`}>
            {group.title === null ? null : (
              <tr className="kiosk-table__group">
                <th scope="colgroup" colSpan={2}>
                  {group.title}
                </th>
              </tr>
            )}
            {group.rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td className="kiosk-table__num">{row.value}</td>
              </tr>
            ))}
          </tbody>
        ))}
        <tfoot>
          <tr>
            <th scope="row">{COPY.basis.payout}</th>
            <td className="kiosk-table__num kiosk-table__strong">{view.payoutTotal}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** 적용한 계산 가정 + 확인하지 않은 전제 (DD-22). 개인 계약 값을 확인한 값처럼 쓰지 않는다. */
export function AssumptionPanel({ view }: { readonly view: BasisView }) {
  return (
    <section className="kiosk-panel kiosk-panel--warn" aria-labelledby="kiosk-basis-assumptions" data-kiosk-block data-kiosk-panel="assumptions">
      <div className="kiosk-panel__title">
        <Icon name="info" size={34} />
        <h2 id="kiosk-basis-assumptions" className="kiosk-panel__heading">
          {COPY.basis.assumptionTitle}
        </h2>
      </div>
      {view.assumptions.map((sentence) => (
        <p key={sentence} className="kiosk-panel__note">
          {sentence}
        </p>
      ))}
      <p className="kiosk-panel__note">{view.uncheckedPremise}</p>
    </section>
  );
}

/** 약관 출처: 문서 · 개정일 · 조항 또는 쪽. 글자뿐이고 링크가 아니다. */
export function SourcePanel({ sources }: { readonly sources: readonly BasisSourceView[] }) {
  return (
    <section className="kiosk-source" aria-labelledby="kiosk-basis-sources" data-kiosk-block data-kiosk-panel="sources">
      <h2 id="kiosk-basis-sources" className="kiosk-source__title">
        {COPY.basis.sourcesTitle}
      </h2>
      <ul className="kiosk-source__list">
        {sources.map((source, index) => (
          <li key={`${String(index)}|${source.document}`} className="kiosk-source__item">
            {[source.document, source.revision, source.clause].flatMap((part) => part ?? []).join(' · ')}
          </li>
        ))}
      </ul>
    </section>
  );
}
