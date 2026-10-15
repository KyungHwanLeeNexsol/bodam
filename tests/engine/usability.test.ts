import { describe, expect, it } from 'vitest';
import {
  bundleHoldCode,
  isBundleUsable,
  isUsable,
  mappingHoldCode,
  mappingToRuleItem,
  profileContent,
  profileHoldCode,
  profileToRuleItem,
} from '../../src/engine/usability';
import type { ItemUsabilityReason, RuleItem, UsabilityContext } from '../../src/engine/usability';
import type { LifecycleState, PolicySourceRef, RuleBundleSnapshot } from '../../src/engine/types';
import { makeMapping, testFingerprint } from '../fixtures/engine/mappings.fixture';
import { TEST_AT, makeProfile, testDigest, testPolicySource } from '../fixtures/engine/profiles.fixture';
import { makeBundle } from '../fixtures/engine/lines.fixture';

// 시험 자료: 모든 값은 TEST_FIXTURE이며 실제 보험 값이나 승인 기록이 아니다.

const ctx: UsabilityContext = {
  at: TEST_AT,
  acceptedOrigins: ['OPERATING', 'TEST_FIXTURE'],
  digest: testDigest,
};

function profileItem(overrides: Parameters<typeof makeProfile>[0] = {}): RuleItem {
  return profileToRuleItem(makeProfile(overrides));
}

describe('isBundleUsable — 묶음 단위 선행 판정 (DD-04)', () => {
  it('bundle 이 null(규칙 사용 범위 없음)이면 SCOPE_ABSENT 다', () => {
    expect(isBundleUsable(null)).toEqual({ usable: false, reason: 'SCOPE_ABSENT' });
  });

  it('ACTIVE 묶음은 그대로 사용 가능이다', () => {
    const bundle = makeBundle();
    expect(isBundleUsable(bundle)).toEqual({ usable: true, bundle });
  });

  it('SUSPENDED 묶음은 버전 id·내용 해시가 그대로여도 BUNDLE_SUSPENDED 다', () => {
    const suspended = makeBundle({ status: 'SUSPENDED' });
    expect(suspended.id).toBe(makeBundle().id);
    expect(suspended.contentHash).toBe(makeBundle().contentHash);
    expect(isBundleUsable(suspended)).toEqual({ usable: false, reason: 'BUNDLE_SUSPENDED' });
  });

  it('알 수 없는 status 값은 받은 대로 ACTIVE 로 추정하지 않고 사용 불가(BUNDLE_SUSPENDED)로 본다', () => {
    const odd = { ...makeBundle(), status: 'PAUSED' } as unknown as RuleBundleSnapshot;
    expect(isBundleUsable(odd)).toEqual({ usable: false, reason: 'BUNDLE_SUSPENDED' });
  });

  it('묶음 안의 항목(profiles·mappings·documentRuleSet)을 읽지 않는다: 읽으면 던지는 접근자를 단 묶음에서도 판정된다', () => {
    const trap = (name: string) => () => {
      throw new Error(`묶음 안의 ${name} 을 읽었다`);
    };
    const build = (status: RuleBundleSnapshot['status']): RuleBundleSnapshot => {
      const bundle = { id: 'TEST_BUNDLE_TRAP', contentHash: 'TEST_HASH', status } as RuleBundleSnapshot;
      Object.defineProperty(bundle, 'profiles', { get: trap('profiles') });
      Object.defineProperty(bundle, 'mappings', { get: trap('mappings') });
      Object.defineProperty(bundle, 'documentRuleSet', { get: trap('documentRuleSet') });
      return bundle;
    };
    expect(isBundleUsable(build('SUSPENDED'))).toEqual({ usable: false, reason: 'BUNDLE_SUSPENDED' });
    expect(isBundleUsable(build('ACTIVE')).usable).toBe(true);
  });
});

describe('bundleHoldCode — 묶음 사유 → 보류 코드 (DD-04 묶음 사유 표)', () => {
  it('SCOPE_ABSENT → CLINIC_RULE_SCOPE_ABSENT, BUNDLE_SUSPENDED → RULE_BUNDLE_SUSPENDED', () => {
    expect(bundleHoldCode('SCOPE_ABSENT')).toBe('CLINIC_RULE_SCOPE_ABSENT');
    expect(bundleHoldCode('BUNDLE_SUSPENDED')).toBe('RULE_BUNDLE_SUSPENDED');
  });
});

describe('isUsable — 항목 단위 판정 (프로필)', () => {
  it('모든 조건을 만족하면 사용 가능이다', () => {
    expect(isUsable(profileItem(), ctx)).toEqual({ usable: true });
  });

  it('허용 출처 밖이면 ORIGIN_NOT_ACCEPTED 다 (운영 허용 출처의 TEST_FIXTURE, 어디서나 DEMO)', () => {
    expect(isUsable(profileItem(), { ...ctx, acceptedOrigins: ['OPERATING'] })).toEqual({
      usable: false,
      reason: 'ORIGIN_NOT_ACCEPTED',
    });
    expect(isUsable(profileItem({ origin: 'DEMO' }), ctx)).toEqual({
      usable: false,
      reason: 'ORIGIN_NOT_ACCEPTED',
    });
  });

  it.each<[LifecycleState, ItemUsabilityReason]>([
    ['DRAFT', 'STATE_DRAFT'],
    ['REVIEW_REQUESTED', 'STATE_UNAPPROVED'],
    ['APPROVED', 'STATE_UNAPPROVED'],
    ['REJECTED', 'STATE_REJECTED'],
    ['UNDER_REREVIEW', 'STATE_UNDER_REREVIEW'],
    ['SUPERSEDED', 'STATE_INVALID'],
    ['EXPIRED', 'STATE_INVALID'],
    ['SUSPENDED', 'STATE_INVALID'],
  ])('상태 %s 는 사유 %s 다', (state, reason) => {
    expect(isUsable(profileItem({ state }), ctx)).toEqual({ usable: false, reason });
  });

  it('알 수 없는 상태 값은 사용 가능으로 추정하지 않고 STATE_INVALID 다', () => {
    const odd = profileItem({ state: 'ARCHIVED' as unknown as LifecycleState });
    expect(isUsable(odd, ctx)).toEqual({ usable: false, reason: 'STATE_INVALID' });
  });

  it('유효 기간 경계 쌍: 시작일과 종료일 당일은 안쪽이고 하루 전·하루 뒤는 바깥이다', () => {
    const profile = { validity: { from: '2026-10-15', to: '2026-10-20' } };
    const at = (day: string) => isUsable(profileItem(profile), { ...ctx, at: day });
    expect(at('2026-10-15')).toEqual({ usable: true });
    expect(at('2026-10-20')).toEqual({ usable: true });
    expect(at('2026-10-14')).toEqual({ usable: false, reason: 'OUTSIDE_VALIDITY' });
    expect(at('2026-10-21')).toEqual({ usable: false, reason: 'OUTSIDE_VALIDITY' });
  });

  it.each([
    ['기준일이 날짜 형식이 아님', { from: '2026-01-01', to: '2026-12-31' }, 'yesterday'],
    ['시작일이 날짜 형식이 아님', { from: '', to: '2026-12-31' }, TEST_AT],
    ['종료일이 달력에 없는 날짜', { from: '2026-01-01', to: '2026-02-30' }, TEST_AT],
    ['시작일이 종료일보다 늦음', { from: '2026-12-31', to: '2026-01-01' }, TEST_AT],
    ['시작일이 문자열이 아닌 숫자', { from: 20260101 as unknown as string, to: '2026-12-31' }, TEST_AT],
  ])('날짜를 해석할 수 없거나 앞뒤가 뒤집히면 유효 기간 밖으로 본다: %s', (_name, validity, at) => {
    expect(isUsable(profileItem({ validity }), { ...ctx, at })).toEqual({
      usable: false,
      reason: 'OUTSIDE_VALIDITY',
    });
  });

  it('유효 기간 자체가 없으면(undefined) 유효 기간 밖으로 본다', () => {
    const item = profileItem({ validity: undefined as unknown as { from: string; to: string } });
    expect(isUsable(item, ctx)).toEqual({ usable: false, reason: 'OUTSIDE_VALIDITY' });
  });

  it('약관 출처 목록에 객체가 아닌 요소(null)가 있으면 SOURCE_INCOMPLETE 다', () => {
    const item = profileItem({ policySources: [testPolicySource(), null as unknown as PolicySourceRef] });
    expect(isUsable(item, ctx)).toEqual({ usable: false, reason: 'SOURCE_INCOMPLETE' });
  });

  it('약관 출처가 하나도 없으면 SOURCE_INCOMPLETE 다', () => {
    expect(isUsable(profileItem({ policySources: [] }), ctx)).toEqual({
      usable: false,
      reason: 'SOURCE_INCOMPLETE',
    });
  });

  it.each<keyof PolicySourceRef>([
    'insurerDocumentId',
    'revisionDate',
    'clauseOrPage',
    'effectiveDate',
    'verifiedBy',
    'verifiedAt',
  ])('약관 출처 6항목 중 %s 가 빈 문자열이거나 없으면 SOURCE_INCOMPLETE 다', (field) => {
    const empty = { ...testPolicySource(), [field]: '' };
    const missing: Partial<PolicySourceRef> = { ...testPolicySource() };
    delete missing[field];
    for (const source of [empty, missing as PolicySourceRef]) {
      expect(isUsable(profileItem({ policySources: [testPolicySource('B'), source] }), ctx)).toEqual({
        usable: false,
        reason: 'SOURCE_INCOMPLETE',
      });
    }
  });

  it.each([
    ['승인자 없음(null)', null],
    ['승인자 id 가 빈 문자열', { approverId: '', approvedAt: '2026-01-02' }],
    ['승인 시각이 빈 문자열', { approverId: 'TEST_FIXTURE_APPROVER', approvedAt: '' }],
  ])('승인자 기록 누락: %s 는 APPROVER_MISSING 이다', (_name, approver) => {
    expect(isUsable(profileItem({ approver }), ctx)).toEqual({ usable: false, reason: 'APPROVER_MISSING' });
  });

  it('내용 해시가 내용과 다르면 INTEGRITY_MISMATCH 다', () => {
    expect(isUsable(profileItem({ contentHash: 'TEST_DIGEST_00000000' }), ctx)).toEqual({
      usable: false,
      reason: 'INTEGRITY_MISMATCH',
    });
  });

  it('내용(그룹 값)을 해시 갱신 없이 바꾸면 INTEGRITY_MISMATCH 다', () => {
    const profile = makeProfile();
    const tampered = {
      ...profile,
      groups: profile.groups.map((group) => ({ ...group, deduction: { kind: 'FIXED' as const, fixed: 1 } })),
    };
    expect(isUsable(profileToRuleItem(tampered), ctx)).toEqual({ usable: false, reason: 'INTEGRITY_MISMATCH' });
  });
});

describe('isUsable — 검사 순서: 출처 → 상태 → 유효 기간 → 약관 출처 → 승인자 → 무결성', () => {
  const bad = {
    origin: 'DEMO' as const,
    state: 'DRAFT' as const,
    validity: { from: '2027-01-01', to: '2027-12-31' },
    policySources: [],
    approver: null,
    contentHash: 'TEST_DIGEST_00000000',
  };

  it('여러 사유가 겹치면 순서상 첫 번째 사유 하나만 돌려준다', () => {
    const steps: Array<[Parameters<typeof makeProfile>[0], ItemUsabilityReason]> = [
      [{ ...bad }, 'ORIGIN_NOT_ACCEPTED'],
      [{ ...bad, origin: 'TEST_FIXTURE' }, 'STATE_DRAFT'],
      [{ ...bad, origin: 'TEST_FIXTURE', state: 'PUBLISHED' }, 'OUTSIDE_VALIDITY'],
      [{ ...bad, origin: 'TEST_FIXTURE', state: 'PUBLISHED', validity: { from: '2026-01-01', to: '2026-12-31' } }, 'SOURCE_INCOMPLETE'],
      [
        {
          ...bad,
          origin: 'TEST_FIXTURE',
          state: 'PUBLISHED',
          validity: { from: '2026-01-01', to: '2026-12-31' },
          policySources: [testPolicySource()],
        },
        'APPROVER_MISSING',
      ],
      [
        {
          ...bad,
          origin: 'TEST_FIXTURE',
          state: 'PUBLISHED',
          validity: { from: '2026-01-01', to: '2026-12-31' },
          policySources: [testPolicySource()],
          approver: { approverId: 'TEST_FIXTURE_APPROVER', approvedAt: '2026-01-02' },
        },
        'INTEGRITY_MISMATCH',
      ],
    ];
    for (const [overrides, reason] of steps) {
      expect(isUsable(profileItem(overrides), ctx)).toEqual({ usable: false, reason });
    }
  });
});

describe('isUsable — 항목 단위 판정 (매핑)', () => {
  it('지문이 같으면 사용 가능이고 다르면 INTEGRITY_MISMATCH 다', () => {
    const mapping = makeMapping('T-A');
    expect(isUsable(mappingToRuleItem(mapping, testFingerprint('T-A')), ctx)).toEqual({ usable: true });
    expect(isUsable(mappingToRuleItem(mapping, 'TEST_FP_CHANGED'), ctx)).toEqual({
      usable: false,
      reason: 'INTEGRITY_MISMATCH',
    });
  });

  it('지문은 마지막 검사다: 상태가 DRAFT 이면 지문이 달라도 STATE_DRAFT 다', () => {
    const mapping = makeMapping('T-A', { state: 'DRAFT' });
    expect(isUsable(mappingToRuleItem(mapping, 'TEST_FP_CHANGED'), ctx)).toEqual({
      usable: false,
      reason: 'STATE_DRAFT',
    });
  });
});

describe('profileHoldCode / mappingHoldCode — 항목 사유 → 보류 코드 (DD-04 표)', () => {
  const rows: Array<[ItemUsabilityReason, string, string]> = [
    ['ORIGIN_NOT_ACCEPTED', 'PROFILE_DEMO', 'MAPPING_INVALID'],
    ['STATE_DRAFT', 'PROFILE_DRAFT', 'MAPPING_UNREVIEWED'],
    ['STATE_UNAPPROVED', 'PROFILE_UNAPPROVED', 'MAPPING_UNREVIEWED'],
    ['STATE_REJECTED', 'PROFILE_UNAPPROVED', 'MAPPING_REJECTED'],
    ['STATE_UNDER_REREVIEW', 'PROFILE_UNDER_REREVIEW', 'MAPPING_UNDER_REREVIEW'],
    ['STATE_INVALID', 'PROFILE_INVALID', 'MAPPING_INVALID'],
    ['OUTSIDE_VALIDITY', 'PROFILE_INVALID', 'MAPPING_INVALID'],
    ['SOURCE_INCOMPLETE', 'PROFILE_SOURCE_INCOMPLETE', 'MAPPING_INVALID'],
    ['APPROVER_MISSING', 'PROFILE_SOURCE_INCOMPLETE', 'MAPPING_INVALID'],
    ['INTEGRITY_MISMATCH', 'PROFILE_INVALID', 'MAPPING_UNDER_REREVIEW'],
  ];

  it.each(rows)('%s → 프로필 %s / 매핑 %s', (reason, profileCode, mappingCode) => {
    expect(profileHoldCode(reason)).toBe(profileCode);
    expect(mappingHoldCode(reason)).toBe(mappingCode);
  });
});

describe('profileContent — 프로필 내용 해시의 대상', () => {
  it('머리 정보(상태·출처·유효 기간·약관 출처·승인자)와 contentHash 를 제외한 계산 내용이다', () => {
    const profile = makeProfile();
    const content = profileContent(profile) as Record<string, unknown>;
    expect(Object.keys(content).sort()).toEqual([
      'generation',
      'groupOrder',
      'groups',
      'id',
      'insurerType',
      'sharedLimitPools',
      'version',
    ]);
  });

  it('상태나 승인자만 바뀌어도 해시는 변하지 않고, 그룹 값이 바뀌면 변한다', () => {
    const base = makeProfile();
    const stateOnly = makeProfile({ state: 'DRAFT' });
    expect(testDigest(profileContent(stateOnly))).toBe(testDigest(profileContent(base)));
    const changed = makeProfile({
      groups: base.groups.map((group) => ({ ...group, deduction: { kind: 'FIXED' as const, fixed: 7 } })),
    });
    expect(testDigest(profileContent(changed))).not.toBe(testDigest(profileContent(base)));
  });
});

describe('형식 수준 시험 — 묶음과 항목의 책임 분리 (AC-008l 형식 부분)', () => {
  it('isUsable 은 묶음을 받지 않고, isBundleUsable 은 항목을 받지 않으며, 항목 사유에 묶음 사유가 없다', () => {
    // 아래 함수는 호출하지 않는다. tsc 가 컴파일 오류(@ts-expect-error)를 확인하는 것이 시험이다.
    const typeOnly = (bundle: RuleBundleSnapshot): void => {
      // @ts-expect-error isUsable 의 첫 매개변수는 RuleItem 이므로 RuleBundleSnapshot 을 줄 수 없다.
      isUsable(bundle, ctx);
      // @ts-expect-error isBundleUsable 의 매개변수에는 RuleItem(프로필 항목)이 올 수 없다.
      isBundleUsable(profileItem());
      // @ts-expect-error UsabilityContext 에는 묶음 상태가 없으므로 status 를 줄 수 없다.
      const withStatus: UsabilityContext = { ...ctx, status: 'SUSPENDED' };
      void withStatus;
    };
    const noBundleReason: 'BUNDLE_SUSPENDED' extends ItemUsabilityReason ? false : true = true;
    const noScopeReason: 'SCOPE_ABSENT' extends ItemUsabilityReason ? false : true = true;
    expect(typeof typeOnly).toBe('function');
    expect([noBundleReason, noScopeReason]).toEqual([true, true]);
  });
});
