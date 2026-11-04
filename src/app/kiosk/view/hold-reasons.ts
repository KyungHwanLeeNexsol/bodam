// 보류 사유의 환자용 분류 (SPEC-REIMBURSEMENT-001 M6 S3a, design.md DD-21, AC-013c).
// 보류 줄의 내부 코드(21개)를 환자에게 보일 네 분류 문구 가운데 하나로 바꾼다. 환자 화면에는 내부 코드·"N" 같은 기호·세대별 규칙·참고 그룹 값이 보이지 않는다(기획서 §9).
// 모르는 코드(엔진에 새 코드가 생겼는데 화면이 아직 모르는 경우)는 첫 분류다: 원문 코드를 보이거나 분류 없이 빠뜨리지 않는다(DD-21).
// 분류 문구의 최종 표현은 plan.md §E #23 의 소유자 확인 대상이고, 여기서는 DD-21 초안을 그대로 쓴다.

import { COPY } from './copy';

export const HOLD_CLASS_ORDER = ['SETUP', 'MAPPING', 'CLASSIFICATION', 'PRICE'] as const;
export type HoldClassKey = (typeof HOLD_CLASS_ORDER)[number];

// DD-21 표의 오른쪽 열. 엔진의 보류 코드 21개가 하나도 빠지지 않고 정확히 한 분류에 있다(tests/kiosk/view/hold-reasons.test.ts 가 엔진 목록과 대조한다).
// 첫 분류에는 프로필 구조 결함으로 생기는 PROFILE_INVALID 도 들어 있다(DD-21 둘째 문단).
const CLASS_OF: Readonly<Record<string, HoldClassKey>> = {
  CLINIC_RULE_SCOPE_ABSENT: 'SETUP',
  RULE_BUNDLE_SUSPENDED: 'SETUP',
  PROFILE_ABSENT: 'SETUP',
  PROFILE_DRAFT: 'SETUP',
  PROFILE_DEMO: 'SETUP',
  PROFILE_UNAPPROVED: 'SETUP',
  PROFILE_INVALID: 'SETUP',
  PROFILE_UNDER_REREVIEW: 'SETUP',
  PROFILE_SOURCE_INCOMPLETE: 'SETUP',
  PROFILE_FORMULA_UNSUPPORTED: 'SETUP',
  PROFILE_VALUE_MISSING: 'SETUP',
  PROFILE_VALUE_INVALID: 'SETUP',
  CALC_RANGE_EXCEEDED: 'SETUP',
  MAPPING_ABSENT: 'MAPPING',
  MAPPING_UNREVIEWED: 'MAPPING',
  MAPPING_REJECTED: 'MAPPING',
  MAPPING_INVALID: 'MAPPING',
  MAPPING_UNDER_REREVIEW: 'MAPPING',
  MAPPING_GROUP_NOT_IN_PROFILE: 'MAPPING',
  CLASSIFICATION_NEEDS_REVIEW: 'CLASSIFICATION',
  LINE_ORIGIN_NOT_ACCEPTED: 'PRICE',
};

// @MX:NOTE: [AUTO] 모르는 보류 코드는 첫 분류다(DD-21). 엔진에 새 코드가 생겨도 환자 화면이 원문 코드를 보이거나 보류 줄을 빠뜨리지 않는다. 21개 대조는 hold-reasons.test.ts 가 맡는다.
/** 내부 보류 코드 → 환자용 분류. 표에 없는 코드는 첫 분류다. */
export function holdClassOf(code: string): HoldClassKey {
  return Object.hasOwn(CLASS_OF, code) ? (CLASS_OF[code] as HoldClassKey) : 'SETUP';
}

export interface HoldGroupView {
  readonly key: HoldClassKey;
  readonly phrase: string;
  /** 그 분류에 걸린 치료의 이름(응답 순서, 중복 없음). 이름을 모르는 치료는 빠진다 — id·코드를 이름 자리에 쓰지 않는다. */
  readonly items: readonly string[];
}

/**
 * 보류 줄을 분류별로 묶는다. 분류 순서는 고정(HOLD_CLASS_ORDER)이고 보류가 없는 분류는 나오지 않는다.
 * 보류 목록이 비어 있어도(보류 결과인데 사유가 오지 않은 모양) 첫 분류 문구는 하나 보인다: 사유 없는 빈 보류 화면을 만들지 않는다.
 */
export function groupHoldReasons(holds: ReadonlyArray<{ readonly treatmentId: string; readonly code: string }>, nameOf: (treatmentId: string) => string | null): HoldGroupView[] {
  const byClass = new Map<HoldClassKey, string[]>();
  for (const hold of holds) {
    const key = holdClassOf(hold.code);
    const items = byClass.get(key) ?? [];
    const name = nameOf(hold.treatmentId);
    if (name !== null && !items.includes(name)) items.push(name);
    byClass.set(key, items);
  }
  const groups = HOLD_CLASS_ORDER.filter((key) => byClass.has(key)).map((key): HoldGroupView => ({ key, phrase: COPY.result.hold.classes[key], items: byClass.get(key) ?? [] }));
  return groups.length === 0 ? [{ key: 'SETUP', phrase: COPY.result.hold.classes.SETUP, items: [] }] : groups;
}
