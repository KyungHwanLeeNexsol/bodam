import { describe, expect, it } from 'vitest';
import { estimateOneTreatment } from '../../patient-kiosk/estimate';

const confirmed = { matchingPolicy: true, matchingTreatment: true, availableCoverage: true };
const shockwave = { ...confirmed, treatmentId: 'shockwave' as const, quotedPrice: '' };

describe('Seongjeongwon patient estimate', () => {
  it('uses the published single-body-area shockwave price and one deductible', () => {
    expect(estimateOneTreatment(shockwave)).toEqual({
      state: 'estimated', paidWon: 100_000, insuranceWon: 70_000, patientWon: 30_000,
    });
  });

  it.each([
    ['50000', 20_000],
    ['80000', 50_000],
    ['100000', 70_000],
  ])('uses the confirmed prolotherapy price of %s won', (quotedPrice, insuranceWon) => {
    expect(estimateOneTreatment({ ...confirmed, treatmentId: 'prolotherapy', quotedPrice })).toEqual({
      state: 'estimated', paidWon: Number(quotedPrice), insuranceWon, patientWon: 30_000,
    });
  });

  it.each(['', '49999', '100001', '80,000', '80000.5', '8e4', '-80000'])('withholds the estimate for unverified price %j', (quotedPrice) => {
    expect(estimateOneTreatment({ ...confirmed, treatmentId: 'prolotherapy', quotedPrice }).state).toBe('unavailable');
  });

  it.each(Object.keys(confirmed) as (keyof typeof confirmed)[])('withholds the estimate without %s', (confirmation) => {
    expect(estimateOneTreatment({ ...shockwave, [confirmation]: false }).state).toBe('unavailable');
  });

  it('does not estimate without a selected treatment', () => {
    expect(estimateOneTreatment({ ...shockwave, treatmentId: '' }).state).toBe('unavailable');
  });
});
