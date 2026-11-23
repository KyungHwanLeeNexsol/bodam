import { useEffect, useRef, useState } from 'react';
import { Button } from '../src/app/kiosk/components/Button';
import { estimateOneTreatment, formatWon, policySource, priceSource, treatments } from './estimate';
import type { TreatmentId } from './estimate';

export function PatientEstimate({ onBack, onHome }: { onBack: () => void; onHome: () => void }) {
  const [treatmentId, setTreatmentId] = useState<TreatmentId | ''>('');
  const [quotedPrice, setQuotedPrice] = useState('');
  const [matchingPolicy, setMatchingPolicy] = useState(false);
  const [matchingTreatment, setMatchingTreatment] = useState(false);
  const [availableCoverage, setAvailableCoverage] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const selected = treatmentId ? treatments[treatmentId] : undefined;
  const result = submitted ? estimateOneTreatment({ treatmentId, quotedPrice, matchingPolicy, matchingTreatment, availableCoverage }) : undefined;

  useEffect(() => {
    if (result?.state === 'estimated') resultHeading.current?.focus();
  }, [result?.state]);

  return (
    <div className="patient-estimate">
      <h1 tabIndex={-1}>예상 부담액 확인</h1>
      <p>성정원통사의원에서 비급여 치료를 한 부위에 한 번 받은 경우를 계산합니다. 현재는 아래 두 항목의 4세대 실손 조건만 확인할 수 있습니다.</p>
      <div className="patient-estimate-fields">
        <label htmlFor="estimate-treatment">치료 선택</label>
        <select id="estimate-treatment" value={treatmentId} onChange={({ currentTarget }) => {
          const next = currentTarget.value;
          setTreatmentId(next === 'shockwave' || next === 'prolotherapy' ? next : '');
          setQuotedPrice('');
          setMatchingTreatment(false);
          setAvailableCoverage(false);
          setSubmitted(false);
        }}>
          <option value="">치료를 골라 주세요</option>
          <option value="shockwave">체외충격파치료</option>
          <option value="prolotherapy">프롤로 주사</option>
        </select>
        {selected && (
          <p>병원 공개 가격(한 부위): <strong>{formatWon(selected.minWon)}{selected.minWon !== selected.maxWon && `~${formatWon(selected.maxWon)}`}</strong></p>
        )}
        {treatmentId === 'prolotherapy' && (
          <>
            <label htmlFor="estimate-price">병원에서 확인한 한 부위 치료비(원)</label>
            <input id="estimate-price" inputMode="numeric" pattern="[0-9]*" maxLength={6} value={quotedPrice} onChange={({ currentTarget }) => {
              setQuotedPrice(currentTarget.value);
              setSubmitted(false);
            }} />
          </>
        )}
      </div>
      <fieldset className="patient-estimate-checks">
        <legend>다음 조건을 모두 확인해 주세요</legend>
        <label><input type="checkbox" checked={matchingPolicy} onChange={({ currentTarget }) => { setMatchingPolicy(currentTarget.checked); setSubmitted(false); }} />
          <span>제 계약은 KB손해보험 4세대 실손의료비보장보험(23.01)이고, 유효한 3대 비급여 특약에 가입했습니다.</span>
        </label>
        <label><input type="checkbox" checked={matchingTreatment} disabled={selected === undefined} onChange={({ currentTarget }) => { setMatchingTreatment(currentTarget.checked); setSubmitted(false); }} />
          <span>{selected ? `병원 세부내역서 또는 원무과에서 ‘${selected.billing}’ 항목이며 위 금액이 한 부위에 대해 실제 부담하는 치료비인지 확인했습니다.` : '치료를 먼저 선택한 뒤 청구 항목과 금액을 확인해 주세요.'}</span>
        </label>
        <label><input type="checkbox" checked={availableCoverage} onChange={({ currentTarget }) => { setAvailableCoverage(currentTarget.checked); setSubmitted(false); }} />
          <span>보험사에서 치료 목적의 보장 대상임을 확인했고, 계약연도 기준 도수·체외충격파·증식 합산 첫 10회 이내이고 남은 보장 한도가 7만 원 이상입니다.</span>
        </label>
      </fieldset>
      <Button variant="primary" onClick={() => setSubmitted(true)}>예상 부담액 계산</Button>
      {result?.state === 'unavailable' && <p role="alert" className="patient-estimate-message">{result.message}</p>}
      {result?.state === 'estimated' && (
        <section className="patient-estimate-result" aria-labelledby="estimate-result-heading">
          <h2 id="estimate-result-heading" tabIndex={-1} ref={resultHeading}>해당 치료 1회 예상 금액</h2>
          <dl>
            <div><dt>병원에 내는 치료비</dt><dd>{formatWon(result.paidWon)}</dd></div>
            <div><dt>예상 실손보험금</dt><dd>{formatWon(result.insuranceWon)}</dd></div>
            <div><dt>보험금을 받은 뒤 예상 부담액</dt><dd>{formatWon(result.patientWon)}</dd></div>
          </dl>
          <p>치료비의 30%와 3만 원 중 큰 금액을 공제했습니다. 진찰료·검사료·다른 치료비는 포함하지 않았습니다.</p>
        </section>
      )}
      <p>이 화면은 보험금 지급 여부를 판단하지 않습니다. 실제 지급액은 계약 조건, 잔여 한도, 중복 가입 및 보험사 심사에 따라 달라집니다. 다른 실손 계약이나 11회차 이후는 보험사에 확인해 주세요.</p>
      <nav className="patient-estimate-sources" aria-label="금액과 약관 출처">
        <a href={priceSource} target="_blank" rel="noreferrer">성정원통사의원 비급여 가격표<span className="patient-source-window"> (새 창)</span></a>
        <a href={policySource} target="_blank" rel="noreferrer">KB손해보험 약관(23.01), 77쪽<span className="patient-source-window"> (새 창)</span></a>
      </nav>
      <div className="patient-estimate-actions">
        <Button variant="secondary" onClick={onBack}>안내 메뉴로</Button>
        <Button variant="secondary" onClick={onHome}>처음 화면으로</Button>
      </div>
    </div>
  );
}
