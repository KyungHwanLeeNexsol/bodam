import { TEST_CELL, TEST_FIXTURE_APPROVER, TEST_VALIDITY, testPolicySource } from './profiles.fixture';
import type { TreatmentCoverageMapping } from '../../../src/engine/types';

// 시험 자료(TEST_FIXTURE). 매핑의 보장 판단·승인자·약관 출처는 모두 가짜 값이며 실제 승인 기록이 아니다.

/** 줄의 coverageFingerprint 와 같은 시험 지문. lines.fixture.ts 의 줄도 이 규칙을 쓴다. */
export function testFingerprint(treatmentId: string): string {
  return `TEST_FP_${treatmentId}`;
}

/** 사용 가능한 COVERED 시험 매핑. 기본은 TEST_GROUP_BENEFIT 그룹으로 간다. */
export function makeMapping(
  treatmentId: string,
  overrides: Partial<TreatmentCoverageMapping> = {},
): TreatmentCoverageMapping {
  return {
    id: `TEST_MAPPING_${treatmentId}`,
    version: 'v1',
    treatmentId,
    scope: [{ ...TEST_CELL }],
    decision: 'COVERED',
    groupKey: 'TEST_GROUP_BENEFIT',
    approvedFingerprint: testFingerprint(treatmentId),
    state: 'PUBLISHED',
    origin: 'TEST_FIXTURE',
    validity: { ...TEST_VALIDITY },
    policySources: [testPolicySource()],
    approver: { ...TEST_FIXTURE_APPROVER },
    ...overrides,
  };
}

/** 사용 불가 매핑 한 종류와 그 매핑이 후보 하나로서 받는 보류 코드. */
export interface UnusableMappingVariant {
  make: (id: string) => TreatmentCoverageMapping;
  code: 'MAPPING_UNDER_REREVIEW' | 'MAPPING_UNREVIEWED' | 'MAPPING_REJECTED' | 'MAPPING_INVALID';
}

/**
 * AC-008b/h 의 사용 불가 상태 전부. 시험 허용 출처(규칙 OPERATING·TEST_FIXTURE)를 전제로 하므로
 * 허용 밖 출처는 DEMO 로 만든다. 운영 허용 출처의 TEST_FIXTURE 는 origins.test.ts 가 따로 시험한다.
 */
export function unusableMappingVariants(treatmentId: string): Record<string, UnusableMappingVariant> {
  const base = (id: string, overrides: Partial<TreatmentCoverageMapping>) => makeMapping(treatmentId, { id, ...overrides });
  return {
    UNDER_REREVIEW_STATE: { make: (id) => base(id, { state: 'UNDER_REREVIEW' }), code: 'MAPPING_UNDER_REREVIEW' },
    FINGERPRINT_MISMATCH: { make: (id) => base(id, { approvedFingerprint: 'TEST_FP_OLD' }), code: 'MAPPING_UNDER_REREVIEW' },
    DRAFT: { make: (id) => base(id, { state: 'DRAFT' }), code: 'MAPPING_UNREVIEWED' },
    REVIEW_REQUESTED: { make: (id) => base(id, { state: 'REVIEW_REQUESTED' }), code: 'MAPPING_UNREVIEWED' },
    APPROVED_UNPUBLISHED: { make: (id) => base(id, { state: 'APPROVED' }), code: 'MAPPING_UNREVIEWED' },
    REJECTED: { make: (id) => base(id, { state: 'REJECTED' }), code: 'MAPPING_REJECTED' },
    SUPERSEDED: { make: (id) => base(id, { state: 'SUPERSEDED' }), code: 'MAPPING_INVALID' },
    EXPIRED: { make: (id) => base(id, { state: 'EXPIRED' }), code: 'MAPPING_INVALID' },
    SUSPENDED: { make: (id) => base(id, { state: 'SUSPENDED' }), code: 'MAPPING_INVALID' },
    OUTSIDE_VALIDITY: { make: (id) => base(id, { validity: { from: '2025-01-01', to: '2025-12-31' } }), code: 'MAPPING_INVALID' },
    SOURCE_MISSING: { make: (id) => base(id, { policySources: [{ ...testPolicySource(), clauseOrPage: '' }] }), code: 'MAPPING_INVALID' },
    APPROVER_MISSING: { make: (id) => base(id, { approver: null }), code: 'MAPPING_INVALID' },
    ORIGIN_DEMO: { make: (id) => base(id, { origin: 'DEMO' }), code: 'MAPPING_INVALID' },
  };
}

/** 사용 가능한 EXCLUDED 시험 매핑(groupKey 없음, 사유 있음). */
export function makeExcludedMapping(
  treatmentId: string,
  overrides: Partial<TreatmentCoverageMapping> = {},
): TreatmentCoverageMapping {
  const { groupKey: _omitted, ...rest } = makeMapping(treatmentId);
  return { ...rest, decision: 'EXCLUDED', exclusionReason: 'TEST_FIXTURE_EXCLUSION_REASON', ...overrides };
}
