import type { Basis, DocumentLine, DocumentLineKey, DocumentScope, DocumentsResult, FormulaStep, HoldReasonCode, LineResult } from '../../../src/engine/types';
import type { EstimateResponseDto, EstimateResultState } from '../../../src/app/kiosk/state/api-types';
import { FOUR_TREATMENTS, T_KIDNEY_SPRAY, T_PHYSIO, T_ULTRASOUND, T_XRAY } from './clinic.fixture';

// 시험 자료(TEST_FIXTURE). 결과 화면(M6 S3a)이 읽는 계산 응답의 시험용 본문. 브라우저 시험(Playwright)도 쓰므로 형식 가져오기와 clinic.fixture 만 가져온다(런타임 src 가져오기 없음).
// 금액은 디자인·기획서 §4 의 예시와 같다: 정상 124,000 / 114,000 / 10,000 (급여 14,000 + 비급여 110,000), 보장 제외 124,000 / 74,000 / 50,000(신장분사치료 40,000 제외).
// 운영 코드(src/)는 이 파일을 가져오지 않는다. 응답의 모양이 실제 핸들러가 낸 본문과 같다는 것은 tests/kiosk/view/result-real-handler.test.tsx 가 따로 확인한다.

const NAME = Object.fromEntries(FOUR_TREATMENTS.map((entry) => [entry.treatmentId, entry.displayName])) as Record<string, string>;

function line(treatmentId: string, benefitType: 'BENEFIT' | 'NON_BENEFIT', patientAmount: number, extra: Partial<LineResult> = {}): LineResult {
  return { treatmentId, displayName: NAME[treatmentId] ?? treatmentId, benefitType, patientAmount, isBaseFee: false, origin: 'TEST_FIXTURE', state: 'ESTIMATED', groupKey: 'TEST_FIXTURE_GROUP_1', ...extra };
}

function excludedLine(treatmentId: string, benefitType: 'BENEFIT' | 'NON_BENEFIT', patientAmount: number, exclusionReason: string): LineResult {
  const { groupKey: _groupKey, ...rest } = line(treatmentId, benefitType, patientAmount);
  return { ...rest, state: 'EXCLUDED_CONFIRMED', exclusionReason };
}

const estimatedLines = (): LineResult[] => [line(T_XRAY, 'BENEFIT', 10_000), line(T_ULTRASOUND, 'BENEFIT', 4_000), line(T_KIDNEY_SPRAY, 'NON_BENEFIT', 40_000), line(T_PHYSIO, 'NON_BENEFIT', 70_000)];

const VERSIONS = { catalogVersion: 'TEST_FIXTURE_CATALOG_V1', ruleBundleVersion: 'TEST_FIXTURE_BUNDLE_V1', ruleBundleStatus: 'ACTIVE' as const, profile: { id: 'TEST_FIXTURE_PROFILE_1', version: 'v1', origin: 'TEST_FIXTURE' as const } };
const EMPTY_BASIS = { ruleBundleId: 'TEST_FIXTURE_BUNDLE_V1', profile: null, steps: [] };

type OriginName = 'OPERATING' | 'DEMO' | 'TEST_FIXTURE';

/** 약관 출처 (시험 자료): 실제 핸들러 응답의 모양과 같다(insurerDocumentId·revisionDate·clauseOrPage 와, 화면에 싣지 않는 효력일·확인자·확인일). */
export const POLICY_SOURCE = {
  insurerDocumentId: 'TEST_FIXTURE 약관 문서 A',
  revisionDate: '2026-01-01',
  clauseOrPage: '제12조 (보상하는 의료비)',
  effectiveDate: '2026-01-01',
  verifiedBy: 'TEST_FIXTURE_VERIFIER',
  verifiedAt: '2026-01-02',
} as const;

/** 계산 근거 (시험 자료): 한 그룹. 보장 대상 치료비 `covered`, 공제 10,000, 한도 250,000, 지급액 = 응답의 예상 보험금. 값은 시험이 정한다(화면은 계산하지 않는다). */
export function basisWith(step: Partial<FormulaStep> & { E: number; P: number }): Basis {
  return {
    ruleBundleId: 'TEST_FIXTURE_BUNDLE_V1',
    profile: { id: 'TEST_FIXTURE_PROFILE_1', version: 'v1', origin: 'TEST_FIXTURE', policySources: [{ ...POLICY_SOURCE }] },
    steps: [{ groupKey: 'TEST_FIXTURE_GROUP_1', D: 10_000, D_applied: 10_000, L: 250_000, P_pooled: step.P, ...step }],
  };
}

/** 서류 줄 하나(시험 자료). */
export const docLine = (line: DocumentLineKey, required: boolean, reasons?: string[], scope?: DocumentScope): DocumentLine => ({
  line,
  required,
  ...(scope === undefined ? {} : { scope }),
  ...(reasons === undefined ? {} : { reasons }),
});

/** 상해 한 가지 원인의 서류 (디자인 K07_Documents 예시와 같은 줄 구성: 통원확인서·영수증·초진기록지·소견서·판독지 필요). 문장은 시험 자료다. */
export function singleCauseDocuments(overrides: { origin?: OriginName; lines?: DocumentLine[] } = {}): DocumentsResult {
  return {
    state: 'AVAILABLE',
    mode: 'SINGLE_CAUSE',
    lines: overrides.lines ?? [
      docLine('DIAGNOSIS_CERT', false),
      docLine('OUTPATIENT_CONFIRMATION', true, ['통원 치료 기준 · 진료받은 날짜를 확인합니다.']),
      docLine('TREATMENT_CONFIRMATION', false),
      docLine('RECEIPT_AND_ITEMIZED', true, ['반드시 함께 제출합니다. 결제 사실과 항목별 금액을 확인합니다.']),
      docLine('INITIAL_EXAM_RECORD', true, ['상해 기준 · 다친 경위와 최초 진료 내용을 확인합니다.']),
      docLine('ADMISSION_DISCHARGE_CONFIRMATION', false),
      docLine('MEDICAL_OPINION', true, ['신장분사치료가 보험사 재량 항목이라 필요합니다.']),
      docLine('IMAGING_READING', true, ['X-ray · 초음파 검사가 있어 필요합니다.']),
      docLine('BIOPSY_RESULT', false),
    ],
    ruleSetId: 'TEST_FIXTURE_DOCUMENT_RULE_SET_1',
    ruleSetVersion: 'v1',
    origin: overrides.origin ?? 'TEST_FIXTURE',
  };
}

/** 원인 모름의 서류: 공통 7줄(필요 4 + 필요 없음 3) + 상해 전용 초진기록지 + 질병 전용 진단서(디자인 K07_Documents_Unknown 예시). 전용 줄 구성은 시험이 바꾼다. */
export function unknownCauseDocuments(overrides: { origin?: OriginName; injuryOnly?: DocumentLine[]; illnessOnly?: DocumentLine[]; common?: DocumentLine[] } = {}): DocumentsResult {
  const injuryOnly = overrides.injuryOnly ?? [docLine('INITIAL_EXAM_RECORD', true, ['다친 경위와 최초 진료 내용을 확인합니다.'], 'INJURY_ONLY')];
  const illnessOnly = overrides.illnessOnly ?? [docLine('DIAGNOSIS_CERT', true, ['병명과 치료 내용을 확인합니다.'], 'ILLNESS_ONLY')];
  const taken = new Set([...injuryOnly, ...illnessOnly].map((entry) => entry.line));
  const common: DocumentLine[] =
    overrides.common ??
    ([
      docLine('RECEIPT_AND_ITEMIZED', true, ['반드시 함께 제출합니다. 결제 사실과 항목별 금액을 확인합니다.'], 'COMMON'),
      docLine('OUTPATIENT_CONFIRMATION', true, ['통원 치료 기준 · 진료받은 날짜를 확인합니다.'], 'COMMON'),
      docLine('IMAGING_READING', true, ['X-ray · 초음파 검사가 있어 필요합니다.'], 'COMMON'),
      docLine('MEDICAL_OPINION', true, ['신장분사치료가 보험사 재량 항목이라 필요합니다.'], 'COMMON'),
      docLine('TREATMENT_CONFIRMATION', false, undefined, 'COMMON'),
      docLine('ADMISSION_DISCHARGE_CONFIRMATION', false, undefined, 'COMMON'),
      docLine('BIOPSY_RESULT', false, undefined, 'COMMON'),
      docLine('DIAGNOSIS_CERT', false, undefined, 'COMMON'),
      docLine('INITIAL_EXAM_RECORD', false, undefined, 'COMMON'),
    ] satisfies DocumentLine[]).filter((entry) => !taken.has(entry.line));
  return { state: 'AVAILABLE', mode: 'UNKNOWN_CAUSE', lines: [...common, ...injuryOnly, ...illnessOnly], ruleSetId: 'TEST_FIXTURE_DOCUMENT_RULE_SET_1', ruleSetVersion: 'v1', origin: overrides.origin ?? 'TEST_FIXTURE' };
}

/** 정상 결과 (ESTIMATED): 124,000 / 114,000 / 10,000. 근거는 보장 대상 치료비 124,000 − 공제 10,000 = 114,000(한도 250,000 안). */
export function estimatedResponse(overrides: { origin?: OriginName; documents?: DocumentsResult | null; basis?: Basis } = {}): EstimateResponseDto {
  return {
    versions: VERSIONS,
    origin: overrides.origin ?? 'TEST_FIXTURE',
    result: {
      state: 'ESTIMATED',
      amounts: { hospitalPayment: 124_000, baseFeeIncluded: 'NOT_REGISTERED', expectedInsurancePayout: 114_000, expectedOutOfPocketAfterPayout: 10_000 },
      lines: estimatedLines(),
      groups: [],
      referenceGroups: [],
      assumptions: ['STANDARD_PROFILE_APPLIED', 'ALL_COVERED_AND_LIMIT_REMAINS', 'PERSONAL_CONTRACT_NOT_CONFIRMED'],
      holdReasons: [],
      excludedItems: [],
      basis: overrides.basis ?? basisWith({ E: 124_000, P: 114_000 }),
    },
    documents: overrides.documents === undefined ? { state: 'RULES_UNAVAILABLE' } : overrides.documents,
  };
}

/** 보장 제외 결과 (ESTIMATED_WITH_EXCLUSIONS): 124,000 / 74,000 / 50,000, 신장분사치료 40,000원 제외. 근거는 보장 대상 치료비 84,000 − 공제 10,000 = 74,000. */
export function notCoveredResponse(overrides: { origin?: OriginName; reason?: string; documents?: DocumentsResult | null; basis?: Basis } = {}): EstimateResponseDto {
  const reason = overrides.reason ?? 'TEST_FIXTURE 약관상 보장하지 않는 치료';
  return {
    versions: VERSIONS,
    origin: overrides.origin ?? 'TEST_FIXTURE',
    result: {
      state: 'ESTIMATED_WITH_EXCLUSIONS',
      amounts: { hospitalPayment: 124_000, baseFeeIncluded: 'NOT_REGISTERED', expectedInsurancePayout: 74_000, expectedOutOfPocketAfterPayout: 50_000 },
      lines: [line(T_XRAY, 'BENEFIT', 10_000), line(T_ULTRASOUND, 'BENEFIT', 4_000), excludedLine(T_KIDNEY_SPRAY, 'NON_BENEFIT', 40_000, reason), line(T_PHYSIO, 'NON_BENEFIT', 70_000)],
      groups: [],
      referenceGroups: [],
      assumptions: ['STANDARD_PROFILE_APPLIED', 'REMAINING_COVERED_AND_LIMIT_REMAINS', 'PERSONAL_CONTRACT_NOT_CONFIRMED'],
      holdReasons: [],
      excludedItems: [{ treatmentId: T_KIDNEY_SPRAY, amount: 40_000, reason, payout: 0 }],
      basis: overrides.basis ?? basisWith({ E: 84_000, P: 74_000 }),
    },
    documents: overrides.documents === undefined ? { state: 'RULES_UNAVAILABLE' } : overrides.documents,
  };
}

/** 보류 결과 (ON_HOLD): 병원 결제액만 숫자. `holds` 는 치료별 보류 코드(나머지 치료는 정상 줄이다). 참고 그룹 값도 일부러 담아 화면에 새지 않음을 본다. */
export function holdResponse(holds: ReadonlyArray<readonly [string, HoldReasonCode]> = [[T_XRAY, 'PROFILE_ABSENT'], [T_ULTRASOUND, 'PROFILE_ABSENT'], [T_KIDNEY_SPRAY, 'PROFILE_ABSENT'], [T_PHYSIO, 'PROFILE_ABSENT']], overrides: { origin?: OriginName } = {}): EstimateResponseDto {
  const codeOf = new Map(holds);
  const lines = estimatedLines().map((entry) => {
    const code = codeOf.get(entry.treatmentId);
    if (code === undefined) return entry;
    const { groupKey: _groupKey, ...rest } = entry;
    return { ...rest, state: 'ON_HOLD' as const, holdReason: code };
  });
  return {
    versions: { ...VERSIONS, ruleBundleStatus: 'SUSPENDED', profile: null },
    origin: overrides.origin ?? 'TEST_FIXTURE',
    result: {
      state: 'ON_HOLD',
      amounts: { hospitalPayment: 124_000, baseFeeIncluded: 'NOT_REGISTERED', expectedInsurancePayout: null, expectedOutOfPocketAfterPayout: null },
      lines,
      groups: [],
      referenceGroups: [{ groupKey: 'TEST_FIXTURE_GROUP_REF', P: 987_654, isReference: true }],
      assumptions: ['PERSONAL_CONTRACT_NOT_CONFIRMED'],
      holdReasons: holds.map(([treatmentId, code]) => ({ treatmentId, code })),
      excludedItems: [],
      basis: { ruleBundleId: null, profile: null, steps: [] },
    },
    documents: null,
  };
}

export function responseFor(state: EstimateResultState): EstimateResponseDto {
  return state === 'ESTIMATED' ? estimatedResponse() : state === 'ESTIMATED_WITH_EXCLUSIONS' ? notCoveredResponse() : holdResponse();
}

/** 줄의 이름만 바꾼 응답: 운영 병원처럼 짧은 이름으로 한 화면에 들어가는지 볼 때 쓴다. */
export function renamed(response: EstimateResponseDto, names: Readonly<Record<string, string>>): EstimateResponseDto {
  return { ...response, result: { ...response.result, lines: response.result.lines.map((entry) => ({ ...entry, displayName: names[entry.treatmentId] ?? entry.displayName })) } };
}

/** 금액만 바꾼 응답(아주 큰 금액이 카드 안에 들어가는지 보려는 시험용). 병원 결제액이 선택 요약과 달라지므로 급여·비급여 내역은 화면에 나오지 않는다. */
export function withAmounts(response: EstimateResponseDto, amounts: { hospitalPayment: number; expectedInsurancePayout: number | null; expectedOutOfPocketAfterPayout: number | null }): EstimateResponseDto {
  return { ...response, result: { ...response.result, amounts: { ...response.result.amounts, ...amounts } } };
}
