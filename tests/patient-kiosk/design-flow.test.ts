import { describe, expect, it } from 'vitest';
import { clinicCatalog, clinicOptions, referenceResponse } from '../../patient-kiosk/clinic';
import type { EstimateInput } from '../../patient-kiosk/estimate';
import { createKioskController } from '../../src/app/kiosk/state/controller';
import { buildResultView } from '../../src/app/kiosk/view/result-view';

const checks: EstimateInput = {
  treatmentId: 'shockwave', quotedPrice: '', matchingPolicy: true, matchingTreatment: true, availableCoverage: true,
};

const body = {
  catalogVersion: clinicCatalog.catalogVersion,
  ruleBundleVersion: null,
  generation: 'GEN4_C4', insurerType: 'NON_LIFE', cause: 'ILLNESS',
  treatmentIds: ['shockwave'],
};

describe('Seongjeongwon public design flow', () => {
  it('uses the existing controller flow, result cards, and result actions', async () => {
    const kiosk = createKioskController({
      transport: async (path, request) => {
        expect(path).toBe('/api/clinics/seongjeongwon/estimate');
        return { status: 200, json: async () => referenceResponse(JSON.parse(request.body ?? '{}'), checks) };
      },
    }, { catalog: clinicCatalog, options: clinicOptions });
    try {
      const screen = () => kiosk.getState().screen;
      expect(screen()).toBe('K00_Start');
      kiosk.dispatch({ type: 'START' });
      expect(screen()).toBe('K01_Generation');
      kiosk.dispatch({ type: 'SELECT_GENERATION', code: 'GEN4_C4' });
      kiosk.dispatch({ type: 'NEXT' });
      expect(screen()).toBe('K02_Type');
      kiosk.dispatch({ type: 'SELECT_INSURER_TYPE', code: 'NON_LIFE' });
      kiosk.dispatch({ type: 'NEXT' });
      expect(screen()).toBe('K02b_Cause');
      kiosk.dispatch({ type: 'SELECT_CAUSE', code: 'ILLNESS' });
      kiosk.dispatch({ type: 'NEXT' });
      expect(screen()).toBe('K03_Treatments');
      kiosk.dispatch({ type: 'TOGGLE_TREATMENT', treatmentId: 'shockwave' });
      expect(kiosk.dispatch({ type: 'REQUEST_ESTIMATE' })).toBe('APPLIED');
      await viWaitForResult();
      expect(buildResultView(kiosk.getState(), 'NORMAL')).toMatchObject({
        testData: false, publicReference: true,
        hospital: { text: '100,000원' }, payout: { text: '70,000원' }, afterPayout: { text: '30,000원' },
      });
      kiosk.dispatch({ type: 'OPEN_BASIS' });
      expect(screen()).toBe('K04_Basis_Calculation');
      kiosk.dispatch({ type: 'RETURN_TO_RESULT' });
      kiosk.dispatch({ type: 'OPEN_DOCUMENTS' });
      expect(screen()).toBe('K07_Documents');
      kiosk.dispatch({ type: 'COMPLETE_USE' });
      expect(screen()).toBe('K06_Complete');
      expect(kiosk.getState().inputs.treatmentIds).toEqual([]);
      expect(kiosk.getState().derived.estimate).toBeNull();
    } finally {
      kiosk.dispose();
    }
  });

  it.each([
    [{ generation: 'GEN3_C3' }, checks],
    [{ insurerType: 'LIFE' }, checks],
    [{}, { ...checks, matchingTreatment: false }],
    [{}, { ...checks, matchingPolicy: false }],
    [{}, { ...checks, availableCoverage: false }],
  ])('returns a hold with no insurance amounts for %j', (diff, form) => {
    expect(referenceResponse({ ...body, ...diff }, form)?.result).toMatchObject({
      state: 'ON_HOLD',
      amounts: { hospitalPayment: 100_000, expectedInsurancePayout: null, expectedOutOfPocketAfterPayout: null },
    });
  });

  it('uses the actual quoted amount for the variable-price treatment', () => {
    expect(referenceResponse({ ...body, treatmentIds: ['prolotherapy'] }, {
      ...checks, treatmentId: 'prolotherapy', quotedPrice: '80000',
    })?.result.amounts).toMatchObject({ hospitalPayment: 80_000, expectedInsurancePayout: 50_000 });
  });

  it('rejects absent, invalid or mismatched submissions', () => {
    expect(referenceResponse(body, null)).toBeNull();
    expect(referenceResponse({ ...body, treatmentIds: ['shockwave','prolotherapy'] }, checks)).toBeNull();
    expect(referenceResponse({ ...body, treatmentIds: ['prolotherapy'] }, checks)).toBeNull();
    expect(referenceResponse({ ...body, treatmentIds: ['prolotherapy'] }, {
      ...checks, treatmentId: 'prolotherapy', quotedPrice: '40000',
    })).toBeNull();
    expect(referenceResponse({ ...body, catalogVersion: 'other' }, checks)).toBeNull();
  });
});

// Await the controller's local transport promise and its settled event.
const viWaitForResult = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
