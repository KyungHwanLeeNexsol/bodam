import type { CatalogDto, EstimateResponseDto, OptionsDto } from '../src/app/kiosk/state/api-types';
import { estimateOneTreatment, rulesFor, treatmentPrice, treatments } from './estimate';
import type { EstimateInput } from './estimate';

const priceVersion = 'seongjeongwon-price-reference-2026-11-23';

export const clinicCatalog: CatalogDto = {
  clinic: { slug: 'seongjeongwon', displayName: '성정원통사의원', setting: 'OUTPATIENT_ONLY' },
  serviceDisplayName: '보담',
  catalogVersion: priceVersion,
  baseFees: [],
  baseFeeIncluded: 'NOT_REGISTERED',
  treatments: Object.entries(treatments).map(([treatmentId, entry], order) => ({
    treatmentId, displayName: entry.name, patientAmount: entry.minWon, order,
    description: treatmentId === 'prolotherapy' ? '치료 부위에 따라 가격이 달라요' : '',
    priceCondition: '한 부위 기준',
    benefitType: 'NON_BENEFIT',
  })),
};

export const clinicOptions: OptionsDto = {
  ruleBundleVersion: null, ruleBundleStatus: null,
  generations: [
    { code: 'GEN1_AS', label: '1세대(A·S)', period: '2009.10 표준화 이전 계약' },
    { code: 'GEN2_C1', label: '2세대(C1)', period: '2009.10 표준화 이후~2015.09.01 이전' },
    { code: 'GEN2_5_C2', label: '2.5세대(C2)', period: '2015.09.01~2017.04.01 이전' },
    { code: 'GEN3_C3', label: '3세대(C3)', period: '2017.04.01~2021.07.01 이전' },
    { code: 'GEN4_C4', label: '4세대(C4)', period: '2021.07.01부터의 4세대 계약' },
  ],
  insurerTypes: [
    { code: 'NON_LIFE', label: '손해보험사', help: '손해보험사에서 가입한 실손보험' },
    { code: 'LIFE', label: '생명보험사', help: '생명보험사에서 가입한 실손보험' },
    { code: 'MUTUAL_AID', label: '그외 공제 조합', help: '우체국, 새마을금고 공제회, 농협' },
  ],
  causes: [
    { code: 'INJURY', label: '다쳐서 왔어요 (상해)', help: '넘어짐, 부딪힘, 화상처럼 갑작스러운 사고로 다친 경우' },
    { code: 'ILLNESS', label: '아파서 왔어요 (질병)', help: '통증, 염증, 질환처럼 몸에 생긴 병으로 치료받는 경우' },
    { code: 'UNKNOWN', label: '잘 모르겠어요', help: '치료 원인이 확실하지 않은 경우' },
  ],
  guidance: { generationUnknown: '보험증권이나 보험사 앱에서 가입일을 확인해 주세요. 확인이 어려우면 보험사에 문의해 주세요.' },
};

// This private in-memory adapter serves the existing controller; it never makes a network request.
export function referenceResponse(raw: unknown, checks: EstimateInput | null): EstimateResponseDto | null {
  if (!raw || typeof raw !== 'object' || checks === null) return null;
  const body = raw as Record<string, unknown>;
  const { treatmentId } = checks;
  if (body.catalogVersion !== priceVersion || body.ruleBundleVersion !== null ||
    !Array.isArray(body.treatmentIds) || body.treatmentIds.length !== 1 || body.treatmentIds[0] !== treatmentId ||
    (treatmentId !== 'shockwave' && treatmentId !== 'prolotherapy') ||
    !clinicOptions.generations.some(({ code }) => code === body.generation) ||
    !clinicOptions.insurerTypes.some(({ code }) => code === body.insurerType) ||
    !clinicOptions.causes.some(({ code }) => code === body.cause)) return null;
  const paid = treatmentPrice(treatmentId, checks.quotedPrice);
  if (paid === null) return null;

  const policies = rulesFor(body.generation, body.insurerType, body.cause);
  const selected = policies.find(({ id }) => id === checks.policyId);
  const estimate = estimateOneTreatment(checks, selected);
  const estimated = estimate.state === 'estimated' && selected !== undefined;
  return {
    origin: 'PUBLIC_REFERENCE',
    versions: { catalogVersion: priceVersion, ruleBundleVersion: null, ruleBundleStatus: null, profile: null },
    ...(estimated
      ? { referencePolicy: { id: selected.id, label: `${selected.policy} · ${selected.coverage}` } }
      : { referenceHoldMessage: body.cause === 'UNKNOWN'
        ? '치료 원인이 확인되지 않아 보험금을 계산하지 않았습니다.'
        : policies.length > 0
          ? '보험 계약이나 치료·보장 조건이 확인되지 않아 보험금을 계산하지 않았습니다.'
          : '선택한 보험 조건의 계산 기준이 아직 없습니다. 보험사에 보장 내용을 확인해 주세요.' }),
    result: {
      state: estimated ? 'ESTIMATED' : 'ON_HOLD',
      amounts: {
        hospitalPayment: paid,
        baseFeeIncluded: 'NOT_REGISTERED',
        expectedInsurancePayout: estimated ? estimate.insuranceWon : null,
        expectedOutOfPocketAfterPayout: estimated ? estimate.patientWon : null,
      },
      basis: { ruleBundleId: null, profile: null, steps: [] },
      lines: [], groups: [], referenceGroups: [], assumptions: [], holdReasons: [], excludedItems: [],
    },
    documents: null,
  };
}
