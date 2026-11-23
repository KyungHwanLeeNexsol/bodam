import { useState } from 'react';
import { TreatmentCard } from '../src/app/kiosk/components/ChoiceCards';
import { HelpPanel } from '../src/app/kiosk/components/HelpPanel';
import { InputScreen } from '../src/app/kiosk/components/InputScreen';
import { SelectionSummaryBar } from '../src/app/kiosk/components/SelectionSummary';
import { useKiosk } from '../src/app/kiosk/runtime/kiosk-context';
import { StepFooter } from '../src/app/kiosk/screens/StepFooter';
import { COPY } from '../src/app/kiosk/view/copy';
import { formatWon, rulesFor, treatmentPrice, treatments, uncappedPayout } from './estimate';
import type { EstimateInput, TreatmentId } from './estimate';

export function TreatmentStep({ submit }: { readonly submit: (checks: EstimateInput) => void }) {
  const { state, send } = useKiosk();
  const [quotedPrice, setQuotedPrice] = useState('');
  const [policyId, setPolicyId] = useState('');
  const [matchingPolicy, setMatchingPolicy] = useState(false);
  const [matchingTreatment, setMatchingTreatment] = useState(false);
  const [availableCoverage, setAvailableCoverage] = useState(false);
  const chosen = state.inputs.treatmentIds[0];
  const treatmentId = chosen === 'shockwave' || chosen === 'prolotherapy' ? chosen : '';
  const policies = rulesFor(state.inputs.generation, state.inputs.insurerType, state.inputs.cause);
  const policy = policies.length === 1 ? policies[0] : policies.find(({ id }) => id === policyId);
  const price = treatmentId ? treatmentPrice(treatmentId, quotedPrice) : 0;
  const payout = policy && price !== null ? uncappedPayout(policy, price) : null;
  const totals = price === null ? null : { selectedCount: treatmentId ? 1 : 0, benefit: 0, nonBenefit: price, total: price };
  const unavailableReason = treatmentId === '' ? COPY.input.treatments.emptyHint
    : price === null ? '병원에서 확인한 한 부위 치료비를 50,000원~100,000원 사이의 숫자로 입력해 주세요.' : '';
  const pendingPrice = <p className="kiosk-summary patient-pending-price">총 예상 결제액: 금액 입력 필요</p>;

  function choose(id: string) {
    if (chosen) send({ type: 'TOGGLE_TREATMENT', treatmentId: chosen });
    if (chosen !== id) send({ type: 'TOGGLE_TREATMENT', treatmentId: id });
    setQuotedPrice('');
    setMatchingTreatment(false);
    setAvailableCoverage(false);
  }

  return (
    <InputScreen step={4} kind="treatments" title={COPY.input.treatments.title}
      subtitle="비급여 치료 한 부위의 1회 금액을 확인할 수 있어요."
      aside={
        <>
          {unavailableReason ? <p id="patient-treatment-incomplete" className="kiosk-input__reason">{unavailableReason}</p> : null}
          <p className="kiosk-input__hint">진찰료·검사료와 다른 치료비는 포함되지 않습니다.</p>
        </>
      }
      footer={
        <>
          {totals === null ? pendingPrice : <SelectionSummaryBar totals={totals} />}
          <StepFooter primaryLabel={COPY.input.treatments.confirm} primaryDisabled={!treatmentId || price === null}
            describedBy={unavailableReason ? 'patient-treatment-incomplete' : undefined}
            onPrimary={() => {
              if (!treatmentId || price === null) return;
              submit({ policyId: policy?.id ?? '', treatmentId, quotedPrice, matchingPolicy, matchingTreatment, availableCoverage });
            }} />
        </>
      }
    >
      <div className="kiosk-input__list" role="group" aria-label={COPY.input.treatments.title}>
        {state.clinic.catalog.treatments.map((card) => (
          <TreatmentCard key={card.treatmentId} treatment={card} selected={card.treatmentId === chosen} locked={false}
            priceLabel={card.treatmentId === 'prolotherapy' ? '5만~10만 원' : undefined}
            onToggle={() => choose(card.treatmentId)} />
        ))}
      </div>
      {treatmentId === 'prolotherapy' ? (
        <label className="patient-quote">
          <span>병원에서 확인한 한 부위 치료비(원)</span>
          <input inputMode="numeric" pattern="[0-9]*" maxLength={6} value={quotedPrice} onChange={({ currentTarget }) => {
            setQuotedPrice(currentTarget.value);
            setMatchingTreatment(false);
            setAvailableCoverage(false);
          }} />
        </label>
      ) : null}
      {treatmentId ? (
        <HelpPanel title="보험금 계산 전 확인" lines={policies.length > 0
          ? ['아래 조건을 확인하면 보험금 수령 후 남는 금액을 계산해요. 모르는 조건이 있으면 고르지 않고 계속할 수 있어요.']
          : [state.inputs.cause === 'UNKNOWN'
            ? '치료 원인을 확인하지 못하면 치료 금액만 안내해 드려요.'
            : '선택한 보험 조건은 아직 실손보험금을 계산할 수 없어요. 치료 금액만 안내해 드려요.']}>
          {policies.length > 1 ? (
            <label className="patient-quote">
              <span>가입한 실손보험 상품과 담보</span>
              <select value={policyId} onChange={({ currentTarget }) => {
                setPolicyId(currentTarget.value);
                setMatchingPolicy(false);
                setAvailableCoverage(false);
              }}>
                <option value="">상품과 담보를 선택해 주세요</option>
                {policies.map(({ id, policy: name, coverage }) => <option key={id} value={id}>{name} · {coverage}</option>)}
              </select>
            </label>
          ) : null}
          {policy ? (
            <div className="patient-checks" role="group" aria-label="실손보험 확인 조건">
              <label><input type="checkbox" checked={matchingPolicy} onChange={({ currentTarget }) => setMatchingPolicy(currentTarget.checked)} />
                <span>보험증권이나 보험사에서 ‘{policy.policy} · {policy.coverage}’가 지금 적용되는 것을 확인했어요.</span>
              </label>
              <label><input type="checkbox" checked={matchingTreatment} onChange={({ currentTarget }) => setMatchingTreatment(currentTarget.checked)} />
                <span>{`병원에 ‘${treatments[treatmentId].billing}’로 청구되는지와 한 부위의 실제 치료비를 확인했어요.`}</span>
              </label>
              <label><input type="checkbox" checked={availableCoverage} disabled={payout === null} onChange={({ currentTarget }) => setAvailableCoverage(currentTarget.checked)} />
                <span>
                  보험사에 이번 치료가 보장 대상이고 남은 횟수가 있는 것을 확인했어요.
                  {policy.scope === 'VISIT' ? ' 이번 외래에서 보상 대상 비용은 이 치료비뿐이에요.' : ''}
                  {policy.scope === 'INITIAL_TEN' ? ' 계약연도 기준 도수·체외충격파·증식 합산 첫 10회 이내예요.' : ''}
                  {payout !== null ? ` ${policy.scope === 'VISIT' ? '외래 가입금액이' : '남은 보장 한도가'} ${formatWon(payout)} 이상이에요.` : ''}
                </span>
              </label>
            </div>
          ) : null}
        </HelpPanel>
      ) : null}
    </InputScreen>
  );
}
