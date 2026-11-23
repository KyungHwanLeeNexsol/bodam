import { describe, expect, it } from 'vitest';
import { estimateOneTreatment, policyRule } from '../../patient-kiosk/estimate';

const confirmed = { policyId: 'kb-23-01-msk', matchingPolicy: true, matchingTreatment: true, availableCoverage: true };
const shockwave = { ...confirmed, treatmentId: 'shockwave' as const, quotedPrice: '' };
const fourth = policyRule(confirmed.policyId);

describe('Seongjeongwon patient estimate', () => {
  it('uses the published single-body-area shockwave price and one deductible', () => {
    expect(estimateOneTreatment(shockwave, fourth)).toEqual({
      state: 'estimated', paidWon: 100_000, insuranceWon: 70_000, patientWon: 30_000,
    });
  });

  it.each([
    ['50000', 20_000],
    ['80000', 50_000],
    ['100000', 70_000],
  ])('uses the confirmed prolotherapy price of %s won', (quotedPrice, insuranceWon) => {
    expect(estimateOneTreatment({ ...confirmed, treatmentId: 'prolotherapy', quotedPrice }, fourth)).toEqual({
      state: 'estimated', paidWon: Number(quotedPrice), insuranceWon, patientWon: 30_000,
    });
  });

  it.each(['', '49999', '100001', '80,000', '80000.5', '8e4', '-80000'])('withholds the estimate for unverified price %j', (quotedPrice) => {
    expect(estimateOneTreatment({ ...confirmed, treatmentId: 'prolotherapy', quotedPrice }, fourth).state).toBe('unavailable');
  });

  it.each(['matchingPolicy', 'matchingTreatment', 'availableCoverage'] as const)('withholds the estimate without %s', (confirmation) => {
    expect(estimateOneTreatment({ ...shockwave, [confirmation]: false }, fourth).state).toBe('unavailable');
  });

  it('does not estimate without a selected treatment', () => {
    expect(estimateOneTreatment({ ...shockwave, treatmentId: '' }, fourth).state).toBe('unavailable');
  });

  it('applies the different 3rd generation minimum when 30% would be smaller', () => {
    const policyId = 'kb-2017-04-msk';
    expect(estimateOneTreatment({
      ...confirmed, policyId, treatmentId: 'prolotherapy', quotedPrice: '50000',
    }, policyRule(policyId))).toMatchObject({ insuranceWon: 30_000, patientWon: 20_000 });
  });

  it('rounds a fractional deductible up rather than inflating the estimated payout', () => {
    const policyId = 'samsung-1509-5-choice-2-outpatient';
    expect(estimateOneTreatment({
      ...confirmed, policyId, treatmentId: 'prolotherapy', quotedPrice: '50001',
    }, policyRule(policyId))).toMatchObject({ insuranceWon: 40_000, patientWon: 10_001 });
  });
});
