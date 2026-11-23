import policyRules from './data/insurance-rules.generated.json';

export const priceSource = 'https://www.tongsaclinic.com/sub/unpaid.php';
export type PolicyRule = (typeof policyRules)[number];

export function rulesFor(generation: unknown, insurerType: unknown, cause: unknown): readonly PolicyRule[] {
  if (cause !== 'INJURY' && cause !== 'ILLNESS') return [];
  return policyRules.filter((rule) => rule.generation === generation && rule.insurerType === insurerType);
}

export function policyRule(id: unknown): PolicyRule | undefined {
  return policyRules.find((rule) => rule.id === id);
}

export const treatments = {
  shockwave: { name: '체외충격파치료', minWon: 100_000, maxWon: 100_000, billing: '체외충격파치료(근골격계질환, SZ084)' },
  prolotherapy: { name: '프롤로 주사', minWon: 50_000, maxWon: 100_000, billing: '증식치료(사지관절 MY142 또는 척추 MY143)' },
} as const;

export type TreatmentId = keyof typeof treatments;
export const formatWon = (amount: number) => `${amount.toLocaleString('ko-KR')}원`;

type Confirmations = {
  matchingPolicy: boolean;
  matchingTreatment: boolean;
  availableCoverage: boolean;
};

export type EstimateInput = Confirmations & { policyId: string; treatmentId: TreatmentId | ''; quotedPrice: string };
type EstimateResult =
  | { state: 'unavailable'; message: string }
  | { state: 'estimated'; paidWon: number; insuranceWon: number; patientWon: number };

export function uncappedPayout(rule: PolicyRule, paidWon: number): number {
  const deductible = Math.max(rule.fixedDeductibleWon, Math.ceil(paidWon * rule.nonBenefitBasisPoints / 10_000));
  return Math.max(0, paidWon - deductible);
}

export function calculationCondition(rule: PolicyRule): string {
  if (rule.scope === 'VISIT') {
    return `이번 외래의 실손 보상 대상이 이 치료비뿐일 때 계산합니다. 계약연도 ${rule.maxVisits}회 한도 내 남은 횟수와 외래 가입금액을 보험사에서 확인해 주세요.`;
  }
  const limit = rule.annualLimitWon === null ? '' :
    ` 계약연도 한도는 도수·체외충격파·증식 합산 ${formatWon(rule.annualLimitWon)}·${rule.maxVisits}회입니다.`;
  return (rule.scope === 'INITIAL_TEN' ? '합산 첫 10회 이내만 계산합니다.' : '공제는 치료행위별로 적용합니다.') + limit;
}

export function treatmentPrice(treatmentId: TreatmentId, quotedPrice: string): number | null {
  const price = treatments[treatmentId];
  if (price.minWon === price.maxWon) return price.minWon;
  const amount = /^[0-9]{5,6}$/.test(quotedPrice) ? Number(quotedPrice) : NaN;
  return amount >= price.minWon && amount <= price.maxWon ? amount : null;
}

export function estimateOneTreatment(input: EstimateInput, rule: PolicyRule | undefined): EstimateResult {
  if (input.treatmentId === '' || !Object.hasOwn(treatments, input.treatmentId)) {
    return { state: 'unavailable', message: '계산할 치료를 선택해 주세요.' };
  }
  const paidWon = treatmentPrice(input.treatmentId, input.quotedPrice);
  if (paidWon === null) {
    return { state: 'unavailable', message: '병원에서 확인한 한 부위 금액을 50,000원~100,000원 사이의 숫자로 입력해 주세요.' };
  }
  if (!rule || input.policyId !== rule.id || input.matchingPolicy !== true ||
    input.matchingTreatment !== true || input.availableCoverage !== true) {
    return { state: 'unavailable', message: '확인하지 않은 조건이 있어 금액을 계산할 수 없습니다. 내 보험 계약과 치료 내역을 병원 또는 보험사에 확인해 주세요.' };
  }
  const insuranceWon = uncappedPayout(rule, paidWon);
  return { state: 'estimated', paidWon, insuranceWon, patientWon: paidWon - insuranceWon };
}
