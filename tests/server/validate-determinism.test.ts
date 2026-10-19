import { describe, expect, it } from 'vitest';
import { DomainError } from '../../src/server/domain/errors';
import { PUBLISH_DEFECT_CODES, assertNoDefects, validateCatalogPublish, validateRuleBundlePublish } from '../../src/server/publish-validate';
import type { BundleItemResolver } from '../../src/server/publish-validate';
import { catchDomainError } from '../fixtures/server/errors.fixture';
import { deepFreeze, reverseKeys, seededRandom, setAt } from '../fixtures/server/mutate.fixture';
import { OPERATING_CATALOG_CONFIG, TEST_CATALOG_CONFIG, requestOf, resolverOf, sealedProfile, validBundleItems, validCatalogRequest } from '../fixtures/server/publish.fixture';
import type { BundleItems } from '../fixtures/server/publish.fixture';

// 게시 검증기의 순수성: 입력을 바꾸지 않고, 같은 입력에 같은 결과를 내며, 객체 키 삽입 순서에 달라지지 않고,
// 어떤 쓰레기 입력에서도 던지지 않는다. assertNoDefects 는 결함 목록을 PUBLISH_VALIDATION_FAILED 로 바꾼다.

/** 엔진 구조 검사(프로필·서류 규칙 묶음)가 정한 결함 코드. 검증기는 이 코드를 그대로 전달한다. */
const ENGINE_STRUCTURE_CODES = [
  'EMPTY_PROFILE', 'GROUP_ENTRY_INVALID', 'EMPTY_GROUP_KEY', 'DUPLICATE_GROUP_KEY', 'POOLS_NOT_ARRAY', 'POOL_ENTRY_INVALID', 'EMPTY_POOL_KEY',
  'DUPLICATE_POOL_KEY', 'UNKNOWN_POOL_REFERENCE', 'GROUP_ORDER_MISSING_KEY', 'GROUP_ORDER_DUPLICATE_KEY', 'GROUP_ORDER_UNKNOWN_KEY',
  'RULES_NOT_ARRAY', 'RULE_ENTRY_INVALID', 'DOCUMENT_CODE_INVALID', 'REASON_INVALID', 'PRIORITY_INVALID', 'WHEN_NOT_OBJECT', 'WHEN_UNKNOWN_KEY', 'WHEN_VALUE_INVALID',
];

/** 결함이 여러 곳에 흩어진 카탈로그 요청. */
function messyCatalog() {
  let request: unknown = validCatalogRequest();
  request = setAt(request, ['treatmentVersions', 0, 'patientAmount'], -1);
  request = setAt(request, ['treatmentVersions', 1, 'treatmentId'], 'TEST_FIXTURE_TREATMENT_1');
  request = setAt(request, ['treatmentVersions', 1, 'documentFlags', 'imaging'], 'yes');
  request = setAt(request, ['commonBaseFees', 1, 'amount'], Number.NaN);
  return request;
}

/** 결함이 여러 층에 흩어진 규칙 묶음 항목. */
function messyBundle(): BundleItems {
  const items = validBundleItems();
  const profile = sealedProfile({ groups: [{ ...items.profiles[0]!.groups[0]!, deduction: { kind: 'FIXED', fixed: -3 } }, items.profiles[0]!.groups[1]!] });
  return {
    profiles: [{ ...profile, approver: null }],
    mappings: [{ ...items.mappings[0]!, groupKey: 'NO_SUCH_GROUP' }, { ...items.mappings[1]!, groupKey: 'TEST_GROUP_BENEFIT' }],
    documentRuleSet: { ...items.documentRuleSet!, contentHash: 'TEST_FIXTURE_BAD_HASH' },
  };
}

describe('카탈로그 검증기', () => {
  it('같은 입력에 같은 결과를 내고, 입력을 얼려도(쓰기 금지) 던지지 않으며 입력은 그대로다', () => {
    const request = messyCatalog();
    const before = structuredClone(request);
    const first = validateCatalogPublish(request, OPERATING_CATALOG_CONFIG);
    deepFreeze(request);
    const second = validateCatalogPublish(request, OPERATING_CATALOG_CONFIG);
    const third = validateCatalogPublish(request, OPERATING_CATALOG_CONFIG);
    expect(first.length).toBeGreaterThan(4);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(request).toEqual(before);
  });

  it('객체 키 삽입 순서를 뒤집어도 결함 목록(내용과 순서)이 같다', () => {
    const request = messyCatalog();
    expect(validateCatalogPublish(reverseKeys(request), TEST_CATALOG_CONFIG)).toEqual(validateCatalogPublish(request, TEST_CATALOG_CONFIG));
  });

  it('돌려준 배열을 호출자가 바꿔도 다음 호출에는 영향이 없다 (매번 새 배열)', () => {
    const request = messyCatalog();
    const first = validateCatalogPublish(request, TEST_CATALOG_CONFIG);
    const snapshot = structuredClone(first);
    first.length = 0;
    expect(validateCatalogPublish(request, TEST_CATALOG_CONFIG)).toEqual(snapshot);
  });

  it('설정 객체도 바꾸지 않는다', () => {
    const config = deepFreeze({ acceptedLineOrigins: ['OPERATING'] as const });
    expect(() => validateCatalogPublish(messyCatalog(), config)).not.toThrow();
  });
});

describe('규칙 묶음 검증기', () => {
  it('같은 입력에 같은 결과를 내고, 요청·해석된 항목·해석기를 모두 얼려도 던지지 않으며 입력은 그대로다', () => {
    const items = messyBundle();
    const request = requestOf(items);
    const before = structuredClone({ request, items });
    const inner = resolverOf(items);
    const resolver: BundleItemResolver = deepFreeze({
      profile: (ref) => deepFreeze(structuredClone(inner.profile(ref))),
      mapping: (ref) => deepFreeze(structuredClone(inner.mapping(ref))),
      documentRuleSet: (ref) => deepFreeze(structuredClone(inner.documentRuleSet(ref))),
    });
    deepFreeze(request);
    const first = validateRuleBundlePublish(request, resolver);
    const second = validateRuleBundlePublish(request, resolver);
    expect(first.length).toBeGreaterThan(3);
    expect(second).toEqual(first);
    expect({ request, items }).toEqual(before);
  });

  it('요청과 항목의 객체 키 삽입 순서를 뒤집어도 결함 목록이 같다', () => {
    const items = messyBundle();
    const flipped: BundleItems = reverseKeys(items);
    expect(validateRuleBundlePublish(reverseKeys(requestOf(items)), resolverOf(flipped))).toEqual(validateRuleBundlePublish(requestOf(items), resolverOf(items)));
  });

  it('결함 목록이 같은 순서로 나오는 것을 고정한다 (층: 형식 → 머리 → 매핑 필드 → 프로필 → 서류 규칙 → 교차)', () => {
    const items = messyBundle();
    expect(validateRuleBundlePublish(requestOf(items), resolverOf(items))).toEqual([
      { code: 'APPROVER_MISSING', path: 'bundle.profiles[0].approver' },
      { code: 'INTEGRITY_MISMATCH', path: 'bundle.documentRuleSet.contentHash' },
      { code: 'GROUP_KEY_FORBIDDEN', path: 'bundle.mappings[1].groupKey' },
      { code: 'VALUE_INVALID', path: 'bundle.profiles[0].groups[0].deduction.fixed' },
      { code: 'MAPPING_GROUP_NOT_IN_PROFILE', path: 'bundle.mappings[0].groupKey' },
    ]);
  });

  it('참조마다 해석기를 정확히 한 번 부른다 (읽기 횟수가 호출 횟수에 달라지지 않는다)', () => {
    const items = validBundleItems();
    const resolver = resolverOf(items);
    validateRuleBundlePublish(requestOf(items), resolver);
    expect(resolver.calls).toHaveLength(items.profiles.length + items.mappings.length + 1);
  });

  it('돌려준 배열을 호출자가 바꿔도 다음 호출에는 영향이 없다', () => {
    const items = messyBundle();
    const first = validateRuleBundlePublish(requestOf(items), resolverOf(items));
    const snapshot = structuredClone(first);
    first.splice(0, first.length);
    expect(validateRuleBundlePublish(requestOf(items), resolverOf(items))).toEqual(snapshot);
  });
});

describe('assertNoDefects', () => {
  it('결함이 없으면 아무것도 하지 않는다', () => {
    expect(() => assertNoDefects([])).not.toThrow();
  });

  it('결함이 있으면 PUBLISH_VALIDATION_FAILED 로 던지고 결함 목록을 그대로 담는다', () => {
    const defects = [
      { code: 'VALUE_INVALID', path: 'treatmentVersions[2].patientAmount' },
      { code: 'ORIGIN_NOT_ACCEPTED', path: 'treatmentVersions[0].origin' },
    ];
    const error = catchDomainError(() => assertNoDefects(defects));
    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe('PUBLISH_VALIDATION_FAILED');
    expect(error.defects).toEqual(defects);
    expect(error.message).toContain('2');
    expect(error.message).toContain('treatmentVersions[2].patientAmount');
  });

  it('호출자가 결함 배열을 나중에 바꿔도 오류는 바뀌지 않는다', () => {
    const defects = [{ code: 'VALUE_INVALID', path: 'x' }];
    const error = catchDomainError(() => assertNoDefects(defects));
    defects.push({ code: 'NOT_ARRAY', path: 'y' });
    expect(error.defects).toEqual([{ code: 'VALUE_INVALID', path: 'x' }]);
  });

  it('검증기의 결과와 이어 쓰면: 올바른 요청은 통과하고 결함이 있는 요청은 필드 경로와 함께 거절된다', () => {
    expect(() => assertNoDefects(validateCatalogPublish(validCatalogRequest(), TEST_CATALOG_CONFIG))).not.toThrow();
    const error = catchDomainError(() => assertNoDefects(validateCatalogPublish(messyCatalog(), TEST_CATALOG_CONFIG)));
    expect(error.defects.map((defect) => defect.path)).toContain('treatmentVersions[0].patientAmount');
  });
});

describe('쓰레기 입력 전수: 던지지 않는다', () => {
  const SEED = 20_261_017;
  const TRIALS = 600;

  function garbage(random: () => number, depth = 0): unknown {
    const roll = random();
    if (depth >= 3 || roll < 0.45) {
      const leaves: unknown[] = [null, undefined, 0, -0, 1, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, '', 'x', 'GEN4_C4', 'OPERATING', true, false, 10n, Symbol('s'), () => 1];
      return leaves[Math.floor(random() * leaves.length)];
    }
    if (roll < 0.7) {
      const length = Math.floor(random() * 4);
      return Array.from({ length }, () => garbage(random, depth + 1));
    }
    const keys = ['kind', 'id', 'version', 'groups', 'deduction', 'limit', 'rules', 'when', 'scope', 'decision', 'policySources', 'approver', 'origin', 'contentHash', 'treatmentVersions', 'commonBaseFees', 'patientAmount', 'documentFlags', 'procedureCodes'];
    const entries = Array.from({ length: Math.floor(random() * 5) }, () => [keys[Math.floor(random() * keys.length)] as string, garbage(random, depth + 1)] as const);
    return Object.fromEntries(entries);
  }

  it(`고정 시드 ${SEED} 로 만든 무작위 입력 ${TRIALS}개를 카탈로그·규칙 묶음 검증기에 넣어도 던지지 않고 결함 목록(배열)을 돌려준다`, () => {
    console.info(`[validate-determinism] 쓰레기 입력 시험 seed=${SEED} trials=${TRIALS}`);
    const random = seededRandom(SEED);
    const seen = new Set<string>();
    const note = (defects: Array<{ code: string; path: string }>): boolean => {
      defects.forEach((defect) => seen.add(defect.code));
      return Array.isArray(defects);
    };
    for (let trial = 0; trial < TRIALS; trial += 1) {
      const a = garbage(random);
      const b = garbage(random);
      const c = garbage(random);
      expect(note(validateCatalogPublish(a, TEST_CATALOG_CONFIG))).toBe(true);
      expect(note(validateCatalogPublish({ treatmentVersions: b, commonBaseFees: c }, OPERATING_CATALOG_CONFIG))).toBe(true);
      expect(note(validateCatalogPublish({ treatmentVersions: [b, c], commonBaseFees: [c, b] }, OPERATING_CATALOG_CONFIG))).toBe(true);
      const items = validBundleItems();
      const resolver: BundleItemResolver = {
        profile: () => (random() < 0.5 ? (b as never) : (items.profiles[0] as never)),
        mapping: () => (random() < 0.5 ? (c as never) : (items.mappings[0] as never)),
        documentRuleSet: () => (random() < 0.5 ? (a as never) : (items.documentRuleSet as never)),
      };
      for (const request of [a, { profiles: b, mappings: c, documentRuleSet: a }, { profiles: [b, c], mappings: [c, b], documentRuleSet: b }, requestOf(items)]) {
        expect(note(validateRuleBundlePublish(request, resolver))).toBe(true);
      }
    }
    // 쓰레기 입력이 내는 코드는 모두 알려진 코드다: 이 검증기의 닫힌 목록 또는 엔진 구조 검사의 코드.
    const known = new Set<string>([...PUBLISH_DEFECT_CODES, ...ENGINE_STRUCTURE_CODES]);
    expect([...seen].filter((code) => !known.has(code))).toEqual([]);
    // 시험이 허공을 치지 않았다: 형식 결함 코드는 실제로 여러 가지가 나왔다.
    expect(seen.size).toBeGreaterThan(8);
  });
});
