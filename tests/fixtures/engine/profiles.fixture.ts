import { profileContent } from '../../../src/engine/usability';
import type {
  ApproverRecord,
  CoverageGroupDef,
  Generation,
  InsurerType,
  PolicySourceRef,
  StandardAssumptionProfile,
} from '../../../src/engine/types';

// 시험 자료(TEST_FIXTURE). 이 파일의 모든 값은 엔진 시험용 가짜 값이다.
// 실제 보험 공제식·공제액·한도·약관 조항·승인 기록이 아니며 어떤 운영 자료와도 관계가 없다.

/** 시험 판정 기준일. 아래 모든 유효 기간 안에 든다. */
export const TEST_AT = '2026-10-15';

export const TEST_CELL: { generation: Generation; insurerType: InsurerType } = {
  generation: 'GEN4_C4',
  insurerType: 'NON_LIFE',
};

/** 승인자 기록처럼 보이는 시험 자료. 실제 승인 기록이 아니다. */
export const TEST_FIXTURE_APPROVER: ApproverRecord = {
  approverId: 'TEST_FIXTURE_APPROVER_NOT_A_REAL_APPROVAL',
  approvedAt: '2026-01-02',
};

/** 약관 출처 여섯 항목을 모두 채운 시험 자료. 실제 약관 출처가 아니다. */
export function testPolicySource(label = 'A'): PolicySourceRef {
  return {
    insurerDocumentId: `TEST_FIXTURE_DOC_${label}`,
    revisionDate: '2026-01-01',
    clauseOrPage: `TEST_FIXTURE_CLAUSE_${label}`,
    effectiveDate: '2026-01-01',
    verifiedBy: 'TEST_FIXTURE_VERIFIER',
    verifiedAt: '2026-01-02',
  };
}

export const TEST_VALIDITY = { from: '2026-01-01', to: '2026-12-31' };

/**
 * 시험용 내용 해시 함수(암호학적 해시가 아님). 키를 정렬한 JSON 문자열에 FNV-1a 를 적용한다.
 * 엔진은 해시 구현을 가져오지 않고 주입받으므로(DD-04) 시험이 이 함수를 넘긴다.
 */
export function testDigest(content: unknown): string {
  const canonical = JSON.stringify(content, (_key, value: unknown) => {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return value;
  });
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `TEST_DIGEST_${hash.toString(16).padStart(8, '0')}`;
}

/** 시험용 그룹 두 개. 값은 모두 가짜 값이다. */
export function testGroups(): CoverageGroupDef[] {
  return [
    {
      groupKey: 'TEST_GROUP_BENEFIT',
      deduction: { kind: 'FIXED', fixed: 1_000 },
      limit: { kind: 'PER_VISIT_PAYOUT', amount: 100_000, limitBasis: 'PAYOUT' },
    },
    {
      groupKey: 'TEST_GROUP_NON_BENEFIT',
      deduction: { kind: 'FIXED', fixed: 2_000 },
      limit: { kind: 'PER_VISIT_PAYOUT', amount: 200_000, limitBasis: 'PAYOUT' },
    },
  ];
}

/** 내용 해시를 현재 내용에 맞춘다. 내용을 바꾼 뒤 사용 가능한 상태로 만들 때 쓴다. */
export function withValidHash(profile: StandardAssumptionProfile): StandardAssumptionProfile {
  return { ...profile, contentHash: testDigest(profileContent(profile)) };
}

/** 사용 가능한(PUBLISHED, TEST_FIXTURE, 해시 일치) 시험 프로필. overrides 를 적용한 뒤 해시를 다시 맞춘다. */
export function makeProfile(overrides: Partial<StandardAssumptionProfile> = {}): StandardAssumptionProfile {
  const groups = overrides.groups ?? testGroups();
  const base: StandardAssumptionProfile = {
    id: 'TEST_PROFILE_1',
    version: 'v1',
    generation: TEST_CELL.generation,
    insurerType: TEST_CELL.insurerType,
    groups,
    groupOrder: groups.map((group) => group.groupKey),
    sharedLimitPools: [],
    contentHash: '',
    state: 'PUBLISHED',
    origin: 'TEST_FIXTURE',
    validity: { ...TEST_VALIDITY },
    policySources: [testPolicySource()],
    approver: { ...TEST_FIXTURE_APPROVER },
    ...overrides,
  };
  // contentHash 를 직접 넘긴 시험(불일치 시험)은 그 값을 그대로 쓴다.
  return overrides.contentHash === undefined ? withValidHash(base) : base;
}
