import { makeMapping, testFingerprint } from './mappings.fixture';
import { TEST_AT, makeProfile } from './profiles.fixture';
import type {
  EstimateInput,
  Origin,
  PublishedLine,
  RuleBundleSnapshot,
  StandardAssumptionProfile,
  TreatmentCoverageMapping,
} from '../../../src/engine/types';

// 시험 자료(TEST_FIXTURE). 치료 이름과 금액은 기획서 §5 예시 4종을 옮긴 시험 사본이며
// 실제 병원 가격이 아니다.

export function makeLine(
  treatmentId: string,
  patientAmount: number,
  overrides: Partial<PublishedLine> = {},
): PublishedLine {
  return {
    treatmentId,
    treatmentVersionId: `${treatmentId}-v1`,
    displayName: `시험 치료 ${treatmentId}`,
    benefitType: 'BENEFIT',
    calcClass: 'GENERAL_BENEFIT',
    patientAmount,
    coverageFingerprint: testFingerprint(treatmentId),
    isBaseFee: false,
    documentFlags: { imaging: false, biopsy: false, opinionRequired: false },
    origin: 'TEST_FIXTURE',
    ...overrides,
  };
}

export const T_XRAY = 'T-XRAY';
export const T_ULTRA = 'T-ULTRA';
export const T_PHYSIO = 'T-PHYSIO';
export const T_INJECT = 'T-INJECT';
export const T_BASE = 'B-BASE';

export function exampleLines(): PublishedLine[] {
  return [
    makeLine(T_XRAY, 10_000),
    makeLine(T_ULTRA, 70_000, { benefitType: 'NON_BENEFIT', calcClass: 'GENERAL_NON_BENEFIT' }),
    makeLine(T_PHYSIO, 4_000),
    makeLine(T_INJECT, 40_000, { benefitType: 'NON_BENEFIT', calcClass: 'MAJOR_THREE_NON_BENEFIT' }),
  ];
}

export function exampleBaseFeeLine(overrides: Partial<PublishedLine> = {}): PublishedLine {
  return makeLine(T_BASE, 5_000, { isBaseFee: true, ...overrides });
}

/** 예시 4종 모두에 사용 가능한 COVERED 매핑이 있다(그룹은 모두 TEST_GROUP_BENEFIT). */
export function exampleMappings(): TreatmentCoverageMapping[] {
  return [T_XRAY, T_ULTRA, T_PHYSIO, T_INJECT].map((id) => makeMapping(id));
}

export function makeBundle(overrides: Partial<RuleBundleSnapshot> = {}): RuleBundleSnapshot {
  return {
    id: 'TEST_BUNDLE_1',
    contentHash: 'TEST_BUNDLE_HASH_1',
    status: 'ACTIVE',
    profiles: [makeProfile()],
    mappings: exampleMappings(),
    documentRuleSet: null,
    ...overrides,
  };
}

export function bundleWith(
  profile: StandardAssumptionProfile,
  mappings: TreatmentCoverageMapping[] = exampleMappings(),
  status: RuleBundleSnapshot['status'] = 'ACTIVE',
): RuleBundleSnapshot {
  return makeBundle({ profiles: [profile], mappings, status });
}

/** 시험 허용 출처: 규칙 OPERATING·TEST_FIXTURE, 줄 OPERATING·TEST_FIXTURE·DEMO (DD-04). */
export const TEST_ACCEPTED_ORIGINS: { rules: Origin[]; lines: Origin[] } = {
  rules: ['OPERATING', 'TEST_FIXTURE'],
  lines: ['OPERATING', 'TEST_FIXTURE', 'DEMO'],
};

export function makeInput(overrides: Partial<EstimateInput> = {}): EstimateInput {
  const lines = overrides.lines ?? exampleLines();
  return {
    generation: 'GEN4_C4',
    insurerType: 'NON_LIFE',
    treatmentIds: lines.filter((line) => !line.isBaseFee).map((line) => line.treatmentId),
    lines,
    baseFeeLines: [],
    bundle: makeBundle(),
    at: TEST_AT,
    acceptedOrigins: { rules: [...TEST_ACCEPTED_ORIGINS.rules], lines: [...TEST_ACCEPTED_ORIGINS.lines] },
    ...overrides,
  };
}
