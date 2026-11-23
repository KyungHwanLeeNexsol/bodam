import { Badge } from '../src/app/kiosk/components/Badge';
import { HelpPanel } from '../src/app/kiosk/components/HelpPanel';
import { SheetScreen } from '../src/app/kiosk/components/SheetScreen';
import { useKiosk } from '../src/app/kiosk/runtime/kiosk-context';
import { SheetFooter, SheetUnavailable } from '../src/app/kiosk/screens/SheetFooter';
import { COPY } from '../src/app/kiosk/view/copy';
import { calculationCondition, formatWon, policyRule, priceSource } from './estimate';

export function ReferenceBasis() {
  const { state } = useKiosk();
  const result = state.derived.estimate?.response;
  if (result?.origin !== 'PUBLIC_REFERENCE' || result.result.state !== 'ESTIMATED') {
    return <SheetUnavailable title={COPY.basis.unavailable.title} body={COPY.basis.unavailable.body} />;
  }
  const rule = policyRule(result.referencePolicy?.id);
  const { hospitalPayment, expectedInsurancePayout, expectedOutOfPocketAfterPayout } = result.result.amounts;
  if (!rule || expectedInsurancePayout === null || expectedOutOfPocketAfterPayout === null) {
    return <SheetUnavailable title={COPY.basis.unavailable.title} body={COPY.basis.unavailable.body} />;
  }
  const treatment = state.clinic.catalog.treatments.find(({ treatmentId }) => treatmentId === state.inputs.treatmentIds[0]);
  return (
    <SheetScreen kind="basis" barLabel={COPY.basis.barLabel} badge={<Badge tone="warn">예상 계산</Badge>}
      title={COPY.basis.title} testData={false} footer={<SheetFooter />}>
      <dl className="kiosk-conditions">
        <div className="kiosk-conditions__row"><dt>보험 조건</dt><dd>{result.referencePolicy?.label}</dd></div>
        <div className="kiosk-conditions__row"><dt>선택한 치료</dt><dd>{treatment?.displayName} · 비급여 한 부위 1회</dd></div>
        <div className="kiosk-conditions__row"><dt>치료비 − 공제액 = 예상 보험금</dt><dd>{formatWon(hospitalPayment)} − {formatWon(expectedOutOfPocketAfterPayout)} = {formatWon(expectedInsurancePayout)}</dd></div>
      </dl>
      <div className="kiosk-basis__grid">
        <HelpPanel title="공제와 보장 한도" lines={[
          rule.nonBenefitBasisPoints === 0
            ? `치료비에서 ${formatWon(rule.fixedDeductibleWon)}을 공제합니다.`
            : `치료비의 ${rule.nonBenefitBasisPoints / 100}%와 ${formatWon(rule.fixedDeductibleWon)} 중 큰 금액을 공제합니다.`,
          calculationCondition(rule),
          '실제 지급액은 보험사 심사에 따라 달라질 수 있습니다.',
        ]} />
        <div className="patient-reference-links" aria-label="출처">
          <a href={priceSource} target="_blank" rel="noreferrer">병원 비급여 공식 가격표 (새 창)</a>
          <a href={rule.sourceUrl} target="_blank" rel="noreferrer">보험사 약관 · {rule.sourceLocation} (새 창)</a>
        </div>
      </div>
    </SheetScreen>
  );
}

export function ReferenceDocuments() {
  const { state } = useKiosk();
  return (
    <SheetScreen kind={state.inputs.cause === 'UNKNOWN' ? 'documents-unknown' : 'documents'}
      barLabel={COPY.documents.barLabel} title={COPY.documents.title}
      badge={<Badge>보험사 확인</Badge>} testData={false} footer={<SheetFooter />}>
      <HelpPanel title="보험사에 필요한 서류를 확인해 주세요"
        lines={['이번 청구에 필요한 서류 목록은 확정되어 있지 않습니다.', '보험사 앱이나 고객센터에서 필요한 서류를 확인한 뒤, 병원 접수·수납 창구에 발급을 요청해 주세요.']} />
    </SheetScreen>
  );
}
