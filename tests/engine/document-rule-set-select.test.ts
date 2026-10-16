import { describe, expect, it } from 'vitest';
import { selectDocumentRuleSet } from '../../src/engine/documents';
import type { DocumentRule, DocumentRuleSet, LifecycleState, RuleBundleSnapshot } from '../../src/engine/types';
import type { UsabilityContext } from '../../src/engine/usability';
import { plainRule, planningExampleRuleSet, ruleSetOf } from '../fixtures/engine/document-rules.fixture';
import { makeBundle } from '../fixtures/engine/lines.fixture';
import { TEST_AT, testDigest, testPolicySource } from '../fixtures/engine/profiles.fixture';

// M2.A: selectDocumentRuleSet — 묶음 단위 선행 판정 → 서류 규칙 묶음 있음 → 항목 판정(isUsable) → 구조 검사.
// 쓸 수 없으면 null 이며(호출하는 쪽이 RULES_UNAVAILABLE 로 바꾼다) 어긋난 묶음을 고치지 않는다.
// 시험 자료: 모든 값은 TEST_FIXTURE이며 실제 서류 요건·승인 기록이 아니다.

const ctx: UsabilityContext = { at: TEST_AT, acceptedOrigins: ['OPERATING', 'TEST_FIXTURE'], digest: testDigest };

function bundleOf(documentRuleSet: unknown, status: RuleBundleSnapshot['status'] = 'ACTIVE'): RuleBundleSnapshot {
  return makeBundle({ status, documentRuleSet: documentRuleSet as DocumentRuleSet | null });
}

const usableSet = planningExampleRuleSet();

describe('쓸 수 있는 묶음', () => {
  it('ACTIVE 묶음의 사용 가능하고 구조가 맞는 서류 규칙 묶음을 같은 객체로 돌려준다', () => {
    expect(selectDocumentRuleSet(bundleOf(usableSet), ctx)).toBe(usableSet);
  });

  it('허용 출처가 OPERATING 뿐이면 OPERATING 출처 묶음만 쓰인다', () => {
    const operating = ruleSetOf(planningExampleRuleSet().rules, { origin: 'OPERATING' });
    const strict: UsabilityContext = { ...ctx, acceptedOrigins: ['OPERATING'] };
    expect(selectDocumentRuleSet(bundleOf(operating), strict)).toBe(operating);
  });

  it('규칙이 하나도 없는 묶음도 구조 결함이 아니므로 쓸 수 있다 (rules: [])', () => {
    const empty = ruleSetOf([]);
    expect(selectDocumentRuleSet(bundleOf(empty), ctx)).toBe(empty);
  });

  it('깊이 동결한 묶음도 던지지 않고 같은 객체를 돌려준다', () => {
    const frozen = ruleSetOf([plainRule('RECEIPT', {}, '시험 사유', 1)]);
    Object.freeze(frozen);
    Object.freeze(frozen.rules);
    expect(selectDocumentRuleSet(bundleOf(frozen), ctx)).toBe(frozen);
  });
});

describe('묶음 단위 선행 판정이 먼저다 (AC-008g·AC-008l 의 판정 순서)', () => {
  it('bundle 이 null(규칙 사용 범위 없음)이면 null 이다', () => {
    expect(selectDocumentRuleSet(null, ctx)).toBeNull();
  });

  it('SUSPENDED 묶음은 묶음 안의 항목을 하나도 읽지 않고 null 이다 (읽으면 던지는 접근자와 읽기 횟수 기록)', () => {
    let reads = 0;
    const trap = (name: string) => () => {
      reads += 1;
      throw new Error(`묶음 안의 ${name} 을 읽었다`);
    };
    const bundle = { id: 'TEST_BUNDLE_TRAP', contentHash: 'TEST_HASH', status: 'SUSPENDED' } as RuleBundleSnapshot;
    Object.defineProperty(bundle, 'profiles', { get: trap('profiles') });
    Object.defineProperty(bundle, 'mappings', { get: trap('mappings') });
    Object.defineProperty(bundle, 'documentRuleSet', { get: trap('documentRuleSet') });
    expect(selectDocumentRuleSet(bundle, ctx)).toBeNull();
    expect(reads).toBe(0);
  });

  it('SUSPENDED 묶음은 사용 가능하고 구조도 맞는 서류 규칙 묶음을 담고 있어도 null 이다', () => {
    expect(selectDocumentRuleSet(bundleOf(usableSet, 'SUSPENDED'), ctx)).toBeNull();
  });

  it('알 수 없는 status 는 ACTIVE 로 추정하지 않아 null 이다', () => {
    const odd = { ...bundleOf(usableSet), status: 'PAUSED' } as unknown as RuleBundleSnapshot;
    expect(selectDocumentRuleSet(odd, ctx)).toBeNull();
  });

  it('ACTIVE 묶음에서는 서류 규칙 묶음을 읽는다 (접근자 읽기 횟수가 1 이상): 순서 시험이 빈 시험이 아니다', () => {
    let reads = 0;
    const bundle = bundleOf(null);
    Object.defineProperty(bundle, 'documentRuleSet', {
      get: () => {
        reads += 1;
        return usableSet;
      },
    });
    expect(selectDocumentRuleSet(bundle, ctx)).toBe(usableSet);
    expect(reads).toBeGreaterThan(0);
  });
});

describe('서류 규칙 묶음이 없거나 객체가 아니다', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['숫자', 7],
    ['문자열', 'x'],
    ['배열', []],
    ['불리언', true],
  ])('documentRuleSet 이 %s 이면 던지지 않고 null 이다', (_label, value) => {
    expect(selectDocumentRuleSet(bundleOf(value), ctx)).toBeNull();
  });

  it('빈 객체 {} 는 던지지 않고 null 이다 (출처부터 어긋난다)', () => {
    expect(selectDocumentRuleSet(bundleOf({}), ctx)).toBeNull();
  });
});

describe('항목 판정(isUsable)을 그대로 쓴다 — 사유마다 null', () => {
  it('허용 출처에 없는 출처는 null 이다 (TEST_FIXTURE 만 있는데 허용 출처가 OPERATING 뿐)', () => {
    const strict: UsabilityContext = { ...ctx, acceptedOrigins: ['OPERATING'] };
    expect(selectDocumentRuleSet(bundleOf(usableSet), strict)).toBeNull();
    expect(selectDocumentRuleSet(bundleOf(ruleSetOf(usableSet.rules, { origin: 'DEMO' })), ctx)).toBeNull();
  });

  const unusableStates: LifecycleState[] = ['DRAFT', 'REVIEW_REQUESTED', 'APPROVED', 'REJECTED', 'UNDER_REREVIEW', 'SUPERSEDED', 'EXPIRED', 'SUSPENDED'];
  it.each(unusableStates)('상태 %s 는 null 이다', (state) => {
    expect(selectDocumentRuleSet(bundleOf(ruleSetOf(usableSet.rules, { state })), ctx)).toBeNull();
  });

  it('알 수 없는 상태 값도 사용 가능으로 추정하지 않아 null 이다', () => {
    expect(selectDocumentRuleSet(bundleOf(ruleSetOf(usableSet.rules, { state: 'PAUSED' as LifecycleState })), ctx)).toBeNull();
  });

  it('유효 기간 밖(기준일이 끝난 뒤 또는 시작 전)은 null 이고 시작일·종료일 당일은 쓸 수 있다', () => {
    const at = (from: string, to: string) => ruleSetOf(usableSet.rules, { validity: { from, to } });
    expect(selectDocumentRuleSet(bundleOf(at('2026-01-01', '2026-10-14')), ctx)).toBeNull();
    expect(selectDocumentRuleSet(bundleOf(at('2026-10-16', '2026-12-31')), ctx)).toBeNull();
    const startsToday = at(TEST_AT, '2026-12-31');
    const endsToday = at('2026-01-01', TEST_AT);
    expect(selectDocumentRuleSet(bundleOf(startsToday), ctx)).toBe(startsToday);
    expect(selectDocumentRuleSet(bundleOf(endsToday), ctx)).toBe(endsToday);
  });

  it('약관 출처가 없거나 불완전하면 null 이다', () => {
    expect(selectDocumentRuleSet(bundleOf(ruleSetOf(usableSet.rules, { policySources: [] })), ctx)).toBeNull();
    const incomplete = { ...testPolicySource('DOC'), clauseOrPage: '' };
    expect(selectDocumentRuleSet(bundleOf(ruleSetOf(usableSet.rules, { policySources: [incomplete] })), ctx)).toBeNull();
  });

  it('승인자가 없으면 null 이다', () => {
    expect(selectDocumentRuleSet(bundleOf(ruleSetOf(usableSet.rules, { approver: null })), ctx)).toBeNull();
  });

  it('내용 해시가 어긋나면 null 이다 (내용을 바꾸고 옛 해시를 둔 경우, 빈 해시)', () => {
    const changed: DocumentRuleSet = { ...usableSet, rules: usableSet.rules.slice(1) };
    expect(selectDocumentRuleSet(bundleOf(changed), ctx)).toBeNull();
    expect(selectDocumentRuleSet(bundleOf(ruleSetOf(usableSet.rules, { contentHash: '' })), ctx)).toBeNull();
    expect(selectDocumentRuleSet(bundleOf(ruleSetOf(usableSet.rules, { contentHash: 'TEST_DIGEST_00000000' })), ctx)).toBeNull();
  });

  it('규칙을 다른 순서로 저장해도 원래 해시 그대로 쓸 수 있다 (해시 입력이 배열 순서에 의존하지 않는다)', () => {
    const reordered: DocumentRuleSet = { ...usableSet, rules: [...usableSet.rules].reverse() };
    expect(selectDocumentRuleSet(bundleOf(reordered), ctx)).toBe(reordered);
  });
});

describe('구조 검사 — 봉인이 맞아도 구조 결함이 있으면 null 이다', () => {
  const cases: Array<[string, DocumentRule]> = [
    ['priority 가 음수', plainRule('RECEIPT', {}, '시험 사유', -1)],
    ['알 수 없는 when 키', { ...plainRule('RECEIPT', {}, '시험 사유', 1), when: { foo: true } as never }],
    ['false 플래그', { ...plainRule('RECEIPT', {}, '시험 사유', 1), when: { imaging: false } as never }],
    ['닫힌 10종 밖의 문서 코드', { ...plainRule('RECEIPT', {}, '시험 사유', 1), documentCode: 'NOPE' as never }],
    ['빈 reason', plainRule('RECEIPT', {}, '', 1)],
  ];

  it.each(cases)('%s', (_label, bad) => {
    const sealed = ruleSetOf([plainRule('RECEIPT', {}, '시험 사유', 1), bad]);
    expect(selectDocumentRuleSet(bundleOf(sealed), ctx)).toBeNull();
  });

  it('null 규칙 항목이나 배열이 아닌 rules 도 봉인이 맞으면 사용 가능 판정은 지나지만 구조 검사에서 null 이 된다 (던지지 않는다)', () => {
    expect(selectDocumentRuleSet(bundleOf(ruleSetOf([null as unknown as DocumentRule])), ctx)).toBeNull();
    expect(selectDocumentRuleSet(bundleOf(ruleSetOf(null as unknown as DocumentRule[])), ctx)).toBeNull();
    expect(selectDocumentRuleSet(bundleOf(ruleSetOf({ length: 0 } as unknown as DocumentRule[])), ctx)).toBeNull();
  });

  it.each([
    ['공백 하나', ' '],
    ['탭', '\t'],
    ['줄바꿈', '\n'],
    ['공백·탭·줄바꿈 섞임', ' \t\n '],
    ['NBSP (U+00A0)', ' '],
    ['표의 공백 (U+3000)', '　'],
  ])('공백뿐인 reason(%s)이 든 묶음은 봉인(ruleSetOf 로 해시를 다시 맞춤)이 맞아도 null 이다', (_label, reason) => {
    const sealed = ruleSetOf([plainRule('RECEIPT', {}, '시험 사유', 1), plainRule('MEDICAL_OPINION', {}, reason, 1)]);
    // 봉인이 맞는지 먼저 확인한다: 사용 가능 판정을 지나므로 null 의 원인이 구조 검사임을 보인다.
    expect(selectDocumentRuleSet(bundleOf(ruleSetOf([plainRule('RECEIPT', {}, '시험 사유', 1)])), ctx)).not.toBeNull();
    expect(sealed.contentHash).not.toBe('');
    expect(selectDocumentRuleSet(bundleOf(sealed), ctx)).toBeNull();
  });

  it('앞뒤에 공백이 있어도 글자가 있는 reason 의 봉인된 묶음은 같은 객체로 선택되고 사유 원문이 그대로다', () => {
    const padded = ruleSetOf([plainRule('RECEIPT', {}, ' 사유 ', 1)]);
    const selected = selectDocumentRuleSet(bundleOf(padded), ctx);
    expect(selected).toBe(padded);
    expect(selected?.rules[0]?.reason).toBe(' 사유 ');
  });

  it('결함이 있어도 일부만 골라 쓰지 않는다: 유효한 규칙이 섞여 있어도 묶음 전체가 null 이다', () => {
    const mixed = ruleSetOf([plainRule('RECEIPT', {}, '시험 사유', 1), plainRule('ITEMIZED_STATEMENT', {}, '시험 사유', Number.NaN)]);
    expect(selectDocumentRuleSet(bundleOf(mixed), ctx)).toBeNull();
  });
});
