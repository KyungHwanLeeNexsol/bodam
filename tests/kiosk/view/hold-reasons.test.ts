import { describe, expect, it } from 'vitest';
import { HOLD_REASON_CODES } from '../../../src/engine/types';
import { HOLD_CLASS_ORDER, groupHoldReasons, holdClassOf } from '../../../src/app/kiosk/view/hold-reasons';

// 보류 사유의 환자용 분류 (DD-21, AC-013c): 내부 코드 21개가 네 분류 가운데 하나로 가고, 모르는 코드는 첫 분류다. 환자 화면에는 분류 문구만 보인다.

const SETUP = '표준 가정 자료가 아직 준비되지 않았습니다';
const MAPPING = '이 치료의 보장 분류를 검토하고 있습니다';
const CLASSIFICATION = '이 치료의 분류 확인이 필요합니다';
const PRICE = '이 치료의 가격 자료 확인이 필요합니다';

// DD-21 표를 그대로 옮긴 기대값. 코드 하나가 정확히 한 분류에 있고 21개가 모두 있다.
const EXPECTED: Record<string, readonly string[]> = {
  SETUP: [
    'CLINIC_RULE_SCOPE_ABSENT',
    'RULE_BUNDLE_SUSPENDED',
    'PROFILE_ABSENT',
    'PROFILE_DRAFT',
    'PROFILE_DEMO',
    'PROFILE_UNAPPROVED',
    'PROFILE_INVALID',
    'PROFILE_UNDER_REREVIEW',
    'PROFILE_SOURCE_INCOMPLETE',
    'PROFILE_FORMULA_UNSUPPORTED',
    'PROFILE_VALUE_MISSING',
    'PROFILE_VALUE_INVALID',
    'CALC_RANGE_EXCEEDED',
  ],
  MAPPING: ['MAPPING_ABSENT', 'MAPPING_UNREVIEWED', 'MAPPING_REJECTED', 'MAPPING_INVALID', 'MAPPING_UNDER_REREVIEW', 'MAPPING_GROUP_NOT_IN_PROFILE'],
  CLASSIFICATION: ['CLASSIFICATION_NEEDS_REVIEW'],
  PRICE: ['LINE_ORIGIN_NOT_ACCEPTED'],
};

describe('holdClassOf: 코드 → 환자용 분류 (DD-21)', () => {
  it('엔진의 보류 코드 21개가 모두 분류에 있고, DD-21 표와 같은 분류로 간다', () => {
    expect(HOLD_REASON_CODES).toHaveLength(21);
    const listed = Object.values(EXPECTED).flat();
    expect([...listed].sort()).toEqual([...HOLD_REASON_CODES].sort());
    for (const [kind, codes] of Object.entries(EXPECTED)) {
      for (const code of codes) expect(holdClassOf(code), code).toBe(kind);
    }
  });

  it('모르는 코드·새 코드·빈 문자열은 첫 분류다 (원문 코드를 보이지 않는다)', () => {
    for (const code of ['SOMETHING_NEW', 'PROFILE_FUTURE_REASON', '', 'mapping_absent']) expect(holdClassOf(code), code).toBe('SETUP');
  });

  it('분류 순서는 고정이다: 자료 준비 → 보장 분류 검토 → 분류 확인 → 가격 자료', () => {
    expect(HOLD_CLASS_ORDER).toEqual(['SETUP', 'MAPPING', 'CLASSIFICATION', 'PRICE']);
  });
});

describe('groupHoldReasons: 분류별로 묶고 치료 이름만 보인다', () => {
  const names: Record<string, string> = { A: '엑스레이', B: '초음파', C: '신장분사', D: '물리치료' };
  const nameOf = (id: string): string | null => names[id] ?? null;

  it('분류 문구는 DD-21 초안 그대로이고, 분류 순서대로 나오며, 보류가 없는 분류는 빠진다', () => {
    const groups = groupHoldReasons(
      [
        { treatmentId: 'D', code: 'LINE_ORIGIN_NOT_ACCEPTED' },
        { treatmentId: 'A', code: 'MAPPING_ABSENT' },
        { treatmentId: 'B', code: 'PROFILE_ABSENT' },
      ],
      nameOf,
    );
    expect(groups.map((group) => group.phrase)).toEqual([SETUP, MAPPING, PRICE]);
    expect(groups.map((group) => group.items)).toEqual([['초음파'], ['엑스레이'], ['물리치료']]);
    expect(groups.map((group) => group.key)).toEqual(['SETUP', 'MAPPING', 'PRICE']);
  });

  it('같은 분류의 서로 다른 코드는 한 묶음이고, 같은 치료는 한 번만 나온다 (응답 순서 유지)', () => {
    const groups = groupHoldReasons(
      [
        { treatmentId: 'B', code: 'MAPPING_UNREVIEWED' },
        { treatmentId: 'A', code: 'MAPPING_ABSENT' },
        { treatmentId: 'B', code: 'MAPPING_REJECTED' },
        { treatmentId: 'C', code: 'CLASSIFICATION_NEEDS_REVIEW' },
      ],
      nameOf,
    );
    expect(groups).toEqual([
      { key: 'MAPPING', phrase: MAPPING, items: ['초음파', '엑스레이'] },
      { key: 'CLASSIFICATION', phrase: CLASSIFICATION, items: ['신장분사'] },
    ]);
  });

  it('이름을 모르는 치료는 목록에서 빠지지만 분류 문구는 남는다 (id·코드를 이름 자리에 쓰지 않는다)', () => {
    const groups = groupHoldReasons([{ treatmentId: 'ZZZ', code: 'MAPPING_ABSENT' }], nameOf);
    expect(groups).toEqual([{ key: 'MAPPING', phrase: MAPPING, items: [] }]);
  });

  it('보류 목록이 비어 있어도(보류 결과가 사유를 싣지 않은 경우) 첫 분류 문구 하나는 보인다 — 빈 보류 화면을 만들지 않는다', () => {
    expect(groupHoldReasons([], nameOf)).toEqual([{ key: 'SETUP', phrase: SETUP, items: [] }]);
  });

  it('결과에 내부 코드·원문이 어디에도 없다', () => {
    const serialized = JSON.stringify(groupHoldReasons([{ treatmentId: 'A', code: 'PROFILE_VALUE_MISSING' }, { treatmentId: 'B', code: 'NEW_UNKNOWN_CODE' }, { treatmentId: 'C', code: 'MAPPING_INVALID' }], nameOf));
    expect(serialized).not.toMatch(/PROFILE_|MAPPING_|LINE_|CLASSIFICATION_|NEW_UNKNOWN/);
  });
});
