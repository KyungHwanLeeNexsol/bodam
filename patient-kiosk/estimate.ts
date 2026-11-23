export const priceSource = 'https://www.tongsaclinic.com/sub/unpaid.php';
export const policySource = 'https://kbinsure.co.kr/CG802030003.ec?fileNm=23870_1_1.pdf';

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

export type EstimateInput = Confirmations & { treatmentId: TreatmentId | ''; quotedPrice: string };
type EstimateResult =
  | { state: 'unavailable'; message: string }
  | { state: 'estimated'; paidWon: number; insuranceWon: number; patientWon: number };

const rule = {
  minimumDeductibleWon: 30_000,
  deductiblePercent: 30,
};

export function treatmentPrice(treatmentId: TreatmentId, quotedPrice: string): number | null {
  const price = treatments[treatmentId];
  if (price.minWon === price.maxWon) return price.minWon;
  const amount = /^[0-9]{5,6}$/.test(quotedPrice) ? Number(quotedPrice) : NaN;
  return amount >= price.minWon && amount <= price.maxWon ? amount : null;
}

export function estimateOneTreatment(input: EstimateInput): EstimateResult {
  if (input.treatmentId === '' || !Object.hasOwn(treatments, input.treatmentId)) {
    return { state: 'unavailable', message: '계산할 치료를 선택해 주세요.' };
  }
  const paidWon = treatmentPrice(input.treatmentId, input.quotedPrice);
  if (paidWon === null) {
    return { state: 'unavailable', message: '병원에서 확인한 한 부위 금액을 50,000원~100,000원 사이의 숫자로 입력해 주세요.' };
  }
  if (!input.matchingPolicy || !input.matchingTreatment || !input.availableCoverage) {
    return { state: 'unavailable', message: '확인하지 않은 조건이 있어 금액을 계산할 수 없습니다. 내 보험 계약과 치료 내역을 병원 또는 보험사에 확인해 주세요.' };
  }
  const deductible = Math.max(rule.minimumDeductibleWon, Math.ceil(paidWon * rule.deductiblePercent / 100));
  const insuranceWon = Math.max(0, paidWon - deductible);
  return { state: 'estimated', paidWon, insuranceWon, patientWon: paidWon - insuranceWon };
}
