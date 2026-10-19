import { describe, expect, it } from 'vitest';
import type { DocumentRuleSet, StandardAssumptionProfile, TreatmentCoverageMapping } from '../../src/engine/types';
import { validateRuleBundlePublish } from '../../src/server/publish-validate';
import { requestOf, resolverOf, validBundleItems } from '../fixtures/server/publish.fixture';
import type { BundleItems } from '../fixtures/server/publish.fixture';
import { setAt, unsetAt } from '../fixtures/server/mutate.fixture';

// 규칙 묶음 게시 검증: 머리 정보 (출처 · 약관 출처 · 승인자 · 봉인). 프로필·매핑·서류 규칙 묶음이 같은 머리 검사를 쓴다.
// 이 결함들은 묶음 게시의 결함이다(엔진 보류가 아니다): 머리가 불완전한 항목은 계산 때 SOURCE_INCOMPLETE·APPROVER_MISSING·
// INTEGRITY_MISMATCH 로 쓸 수 없게 되므로, 쓸 수 없는 항목을 묶어 게시하지 못하게 막는다.

type Kind = 'PROFILE' | 'MAPPING' | 'DOCUMENT_RULE_SET';

const base = validBundleItems();
const profile = base.profiles[0] as StandardAssumptionProfile;
const mapping = base.mappings[0] as TreatmentCoverageMapping;
const ruleSet = base.documentRuleSet as DocumentRuleSet;

/** 종류별로 항목 하나를 바꾼 묶음을 검증하고, 그 항목의 보고 경로 접두어를 함께 돌려준다. */
function withItem(kind: Kind, edit: (item: Record<string, unknown>) => unknown) {
  const items: BundleItems = structuredClone(base);
  let prefix: string;
  if (kind === 'PROFILE') {
    items.profiles = [edit(items.profiles[0] as unknown as Record<string, unknown>) as StandardAssumptionProfile];
    prefix = 'bundle.profiles[0]';
  } else if (kind === 'MAPPING') {
    items.mappings = [edit(items.mappings[0] as unknown as Record<string, unknown>) as TreatmentCoverageMapping];
    prefix = 'bundle.mappings[0]';
  } else {
    items.documentRuleSet = edit(items.documentRuleSet as unknown as Record<string, unknown>) as DocumentRuleSet;
    prefix = 'bundle.documentRuleSet';
  }
  // 프로필 한 개·매핑 한 개 중 하나만 남겨도 다른 쪽 검사에 영향이 없게 같은 묶음 안의 나머지는 그대로 둔다.
  return { defects: validateRuleBundlePublish(requestOf(items), resolverOf(items)), prefix };
}

const kinds: Kind[] = ['PROFILE', 'MAPPING', 'DOCUMENT_RULE_SET'];

describe('올바른 머리', () => {
  it.each(kinds)('%s: 결함이 없다', (kind) => {
    expect(withItem(kind, (item) => item).defects).toEqual([]);
  });

  it('원본 시험 자료는 건드리지 않는다 (복사본에서만 바꾼다)', () => {
    withItem('PROFILE', (item) => ({ ...item, origin: 'BAD' }));
    expect(profile.origin).toBe('TEST_FIXTURE');
    expect(mapping.origin).toBe('TEST_FIXTURE');
    expect(ruleSet.origin).toBe('TEST_FIXTURE');
  });
});

describe('origin (닫힌 세 값)', () => {
  it.each(kinds)('%s: OPERATING·DEMO·TEST_FIXTURE 는 유효하다 (허용 출처 판정은 게시 검증이 아니라 계산의 몫)', (kind) => {
    for (const origin of ['OPERATING', 'DEMO', 'TEST_FIXTURE']) {
      expect(withItem(kind, (item) => ({ ...item, origin })).defects).toEqual([]);
    }
  });

  it.each(kinds)('%s: 목록 밖·형식이 틀린 origin 은 VALUE_INVALID', (kind) => {
    for (const origin of ['PRODUCTION', 'operating', '', 7, true, []]) {
      const { defects, prefix } = withItem(kind, (item) => ({ ...item, origin }));
      expect(defects).toEqual([{ code: 'VALUE_INVALID', path: `${prefix}.origin` }]);
    }
  });

  it.each(kinds)('%s: origin 이 없거나 null 이면 VALUE_MISSING', (kind) => {
    for (const edit of [(item: Record<string, unknown>) => unsetAt(item, ['origin']), (item: Record<string, unknown>) => ({ ...item, origin: null })]) {
      const { defects, prefix } = withItem(kind, edit);
      expect(defects).toEqual([{ code: 'VALUE_MISSING', path: `${prefix}.origin` }]);
    }
  });
});

describe('약관 출처 (PolicySourceRef 여섯 항목, 1개 이상)', () => {
  const fields = ['insurerDocumentId', 'revisionDate', 'clauseOrPage', 'effectiveDate', 'verifiedBy', 'verifiedAt'];

  it.each(kinds)('%s: 배열이 아니거나 비어 있으면 POLICY_SOURCES_MISSING', (kind) => {
    for (const policySources of [[], null, undefined, 'x', {}, 5]) {
      const { defects, prefix } = withItem(kind, (item) => ({ ...item, policySources }));
      expect(defects).toEqual([{ code: 'POLICY_SOURCES_MISSING', path: `${prefix}.policySources` }]);
    }
  });

  it.each(kinds)('%s: 출처 항목이 객체가 아니면 그 항목이 POLICY_SOURCE_INCOMPLETE', (kind) => {
    for (const bad of [null, undefined, 5, 'x', []]) {
      const { defects, prefix } = withItem(kind, (item) => setAt(item, ['policySources'], [(item.policySources as unknown[])[0], bad]));
      expect(defects).toEqual([{ code: 'POLICY_SOURCE_INCOMPLETE', path: `${prefix}.policySources[1]` }]);
    }
  });

  describe.each(kinds)('%s', (kind) => {
    it.each(fields)('%s 가 비어 있거나 없거나 문자열이 아니면 그 필드 경로의 POLICY_SOURCE_INCOMPLETE', (field) => {
      for (const make of [
        (item: Record<string, unknown>) => setAt(item, ['policySources', 0, field], ''),
        (item: Record<string, unknown>) => unsetAt(item, ['policySources', 0, field]),
        (item: Record<string, unknown>) => setAt(item, ['policySources', 0, field], null),
        (item: Record<string, unknown>) => setAt(item, ['policySources', 0, field], 20260101),
      ]) {
        const { defects, prefix } = withItem(kind, make);
        expect(defects).toEqual([{ code: 'POLICY_SOURCE_INCOMPLETE', path: `${prefix}.policySources[0].${field}` }]);
      }
    });

    it('두 번째 출처의 결함은 policySources[1] 로 보고한다', () => {
      const { defects, prefix } = withItem(kind, (item) => {
        const first = (item.policySources as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
        return setAt(item, ['policySources'], [first, { ...first, verifiedBy: '' }]);
      });
      expect(defects).toEqual([{ code: 'POLICY_SOURCE_INCOMPLETE', path: `${prefix}.policySources[1].verifiedBy` }]);
    });
  });

  it('공백뿐인 출처 필드는 엔진 판정(isUsable)과 같이 "비어 있지 않음"이다', () => {
    expect(withItem('PROFILE', (item) => setAt(item, ['policySources', 0, 'clauseOrPage'], '  ')).defects).toEqual([]);
  });
});

describe('승인자 기록', () => {
  it.each(kinds)('%s: 없거나 객체가 아니면 APPROVER_MISSING', (kind) => {
    for (const approver of [null, undefined, 'x', 5, []]) {
      const { defects, prefix } = withItem(kind, (item) => ({ ...item, approver }));
      expect(defects).toEqual([{ code: 'APPROVER_MISSING', path: `${prefix}.approver` }]);
    }
  });

  it.each(kinds)('%s: approverId·approvedAt 이 비어 있거나 문자열이 아니면 그 필드의 APPROVER_INCOMPLETE', (kind) => {
    for (const field of ['approverId', 'approvedAt']) {
      for (const value of ['', null, 3]) {
        const { defects, prefix } = withItem(kind, (item) => setAt(item, ['approver', field], value));
        expect(defects).toEqual([{ code: 'APPROVER_INCOMPLETE', path: `${prefix}.approver.${field}` }]);
      }
    }
  });
});

describe('봉인: 내용 해시 (프로필·서류 규칙 묶음)', () => {
  it.each(['PROFILE', 'DOCUMENT_RULE_SET'] as const)('%s: 해시가 다르면 INTEGRITY_MISMATCH', (kind) => {
    const { defects, prefix } = withItem(kind, (item) => ({ ...item, contentHash: 'TEST_FIXTURE_NOT_THE_DIGEST' }));
    expect(defects).toEqual([{ code: 'INTEGRITY_MISMATCH', path: `${prefix}.contentHash` }]);
  });

  it.each(['PROFILE', 'DOCUMENT_RULE_SET'] as const)('%s: 해시가 비어 있거나 없거나 문자열이 아니어도 INTEGRITY_MISMATCH (고쳐 쓰지 않는다)', (kind) => {
    for (const edit of [
      (item: Record<string, unknown>) => ({ ...item, contentHash: '' }),
      (item: Record<string, unknown>) => unsetAt(item, ['contentHash']),
      (item: Record<string, unknown>) => ({ ...item, contentHash: null }),
      (item: Record<string, unknown>) => ({ ...item, contentHash: 12345 }),
    ]) {
      const { defects, prefix } = withItem(kind, edit);
      expect(defects).toEqual([{ code: 'INTEGRITY_MISMATCH', path: `${prefix}.contentHash` }]);
    }
  });

  it('프로필: 내용이 바뀌었는데 옛 해시를 그대로 두면 INTEGRITY_MISMATCH (해시를 다시 만들어 맞추지 않는다)', () => {
    const { defects } = withItem('PROFILE', (item) => setAt(item, ['groups', 0, 'deduction', 'fixed'], 1_234));
    expect(defects).toEqual([{ code: 'INTEGRITY_MISMATCH', path: 'bundle.profiles[0].contentHash' }]);
  });

  it('프로필의 머리 정보(승인자·출처·상태)는 해시 입력이 아니므로 바뀌어도 봉인은 유지된다', () => {
    const { defects } = withItem('PROFILE', (item) => ({ ...item, state: 'DRAFT', validity: { from: '2000-01-01', to: '2000-12-31' } }));
    expect(defects).toEqual([]);
  });
});

describe('매핑: 고정된 지문 (approvedFingerprint)', () => {
  it('비어 있거나 없거나 문자열이 아니면 FINGERPRINT_MISSING', () => {
    for (const edit of [
      (item: Record<string, unknown>) => ({ ...item, approvedFingerprint: '' }),
      (item: Record<string, unknown>) => unsetAt(item, ['approvedFingerprint']),
      (item: Record<string, unknown>) => ({ ...item, approvedFingerprint: null }),
      (item: Record<string, unknown>) => ({ ...item, approvedFingerprint: 7 }),
    ]) {
      const { defects, prefix } = withItem('MAPPING', edit);
      expect(defects).toEqual([{ code: 'FINGERPRINT_MISSING', path: `${prefix}.approvedFingerprint` }]);
    }
  });

  it('매핑은 내용 해시를 갖지 않는다: contentHash 가 있어도 없어도 봉인 검사를 하지 않는다', () => {
    expect(withItem('MAPPING', (item) => ({ ...item, contentHash: 'whatever' })).defects).toEqual([]);
  });

  it('지문이 현재 치료 버전과 같은지는 이 검증기가 보지 않는다 (치료 자료가 없다). 비어 있지 않으면 통과한다', () => {
    expect(withItem('MAPPING', (item) => ({ ...item, approvedFingerprint: 'TEST_FIXTURE_ANY_FINGERPRINT' })).defects).toEqual([]);
  });
});

describe('머리 결함 보고 순서 (한 항목 안): origin → 약관 출처 → 승인자 → 봉인/지문', () => {
  it.each(['PROFILE', 'DOCUMENT_RULE_SET'] as const)('%s', (kind) => {
    const { defects, prefix } = withItem(kind, (item) => ({ ...item, contentHash: 'X', approver: null, policySources: [], origin: 'Z' }));
    expect(defects).toEqual([
      { code: 'VALUE_INVALID', path: `${prefix}.origin` },
      { code: 'POLICY_SOURCES_MISSING', path: `${prefix}.policySources` },
      { code: 'APPROVER_MISSING', path: `${prefix}.approver` },
      { code: 'INTEGRITY_MISMATCH', path: `${prefix}.contentHash` },
    ]);
  });

  it('MAPPING', () => {
    const { defects, prefix } = withItem('MAPPING', (item) => ({ ...item, approvedFingerprint: '', approver: null, policySources: [], origin: 'Z' }));
    expect(defects).toEqual([
      { code: 'VALUE_INVALID', path: `${prefix}.origin` },
      { code: 'POLICY_SOURCES_MISSING', path: `${prefix}.policySources` },
      { code: 'APPROVER_MISSING', path: `${prefix}.approver` },
      { code: 'FINGERPRINT_MISSING', path: `${prefix}.approvedFingerprint` },
    ]);
  });
});

describe('층 순서: 머리 층이 항목 종류를 가로질러 먼저 나온다', () => {
  it('프로필 머리 → 매핑 머리 → 서류 규칙 묶음 머리 → 그 뒤에 매핑 필드 규칙', () => {
    const items: BundleItems = structuredClone(base);
    items.profiles = [{ ...(items.profiles[0] as StandardAssumptionProfile), approver: null }];
    items.mappings = [{ ...(items.mappings[0] as TreatmentCoverageMapping), approver: null, decision: 'MAYBE' as never }];
    items.documentRuleSet = { ...(items.documentRuleSet as DocumentRuleSet), approver: null };
    expect(validateRuleBundlePublish(requestOf(items), resolverOf(items))).toEqual([
      { code: 'APPROVER_MISSING', path: 'bundle.profiles[0].approver' },
      { code: 'APPROVER_MISSING', path: 'bundle.mappings[0].approver' },
      { code: 'APPROVER_MISSING', path: 'bundle.documentRuleSet.approver' },
      { code: 'DECISION_INVALID', path: 'bundle.mappings[0].decision' },
    ]);
  });
});
