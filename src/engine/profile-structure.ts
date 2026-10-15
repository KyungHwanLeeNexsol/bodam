import type { StandardAssumptionProfile } from './types';

// 프로필 구조 검사 (design.md DD-02 "프로필 구조 검사와 영향 범위").
// 입력만으로 결과가 정해지는 순수 함수다. 규칙 묶음 게시 검증(M3)과 계산(DD-04 호출 순서 5)이 같은 함수를 쓴다.
// 구조 규칙 5번(같은 칸에 프로필 둘 이상)은 칸 조회(resolveProfile)가 본다.
// 풀 한도의 값 결함(없음·무효·지원 밖)은 구조 결함이 아니다. 그 풀의 멤버 그룹만 보류하는 값 검사의 몫이다(M1.3).

export type ProfileStructureDefectCode =
  | 'EMPTY_PROFILE'
  | 'GROUP_ENTRY_INVALID'
  | 'EMPTY_GROUP_KEY'
  | 'DUPLICATE_GROUP_KEY'
  | 'POOLS_NOT_ARRAY'
  | 'POOL_ENTRY_INVALID'
  | 'EMPTY_POOL_KEY'
  | 'DUPLICATE_POOL_KEY'
  | 'UNKNOWN_POOL_REFERENCE'
  | 'GROUP_ORDER_MISSING_KEY'
  | 'GROUP_ORDER_DUPLICATE_KEY'
  | 'GROUP_ORDER_UNKNOWN_KEY';

export interface ProfileStructureDefect {
  code: ProfileStructureDefectCode;
  /** 어긋난 필드 경로. 게시 검증이 거절 사유와 함께 그대로 보여 줄 수 있다. */
  path: string;
}

export type ProfileStructureResult = { ok: true } | { ok: false; defects: ProfileStructureDefect[] };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** 그룹·풀 항목은 배열이 아닌 객체여야 한다. null, undefined, 숫자, 문자열, 불리언, 배열은 항목 모양 결함이며 속성을 읽기 전에 가려낸다. */
function isEntryObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// @MX:ANCHOR: [AUTO] 프로필 구조 검사. 계산(resolveProfile)과 규칙 묶음 게시 검증(M3)과 운영 준비 상태 계산(M3)이 같은 함수를 쓴다.
// @MX:REASON: 구조 결함이 하나라도 있으면 프로필 전체를 믿을 수 없어 모든 줄이 PROFILE_INVALID 가 된다. 두 번째 구현이 있으면 게시와 계산이 어긋난다(DD-02).
/**
 * 구조 결함을 모두 모아 고정된 순서로 돌려준다: 그룹(항목 모양·키) → 풀(배열 여부·항목 모양·키) → 풀 참조 → groupOrder.
 * 그룹이 하나도 없거나 groups 가 배열이 아닌 빈 프로필은 그 결함 하나만 돌려준다(나머지 검사의 전제가 없다).
 * 어떤 속성도 읽기 전에 배열 여부와 항목이 객체인지를 먼저 본다: null·undefined·원시값·배열인 항목은 항목 모양 결함 하나로
 * 보고하고 그 항목에서는 더 읽지 않는다(던지지 않고, 따라오는 키 결함 잡음도 만들지 않는다). 입력은 고치거나 바꾸지 않는다.
 * sharedLimitPools 가 배열이 아니면 빈 목록으로 대신하지 않고 POOLS_NOT_ARRAY 결함이다(결과는 항상 ok:false).
 * 이어지는 풀 참조 검사만 풀이 없는 것으로 보고 계속하므로 다른 결함도 함께 보고된다. 진짜 빈 배열 []은 유효하다.
 */
export function checkProfileStructure(profile: StandardAssumptionProfile): ProfileStructureResult {
  const defects: ProfileStructureDefect[] = [];
  const { groups } = profile;

  if (!Array.isArray(groups) || groups.length === 0) {
    return { ok: false, defects: [{ code: 'EMPTY_PROFILE', path: 'groups' }] };
  }

  // 그룹: 항목이 객체가 아니면 항목 모양 결함. 그룹 키는 문자열이 아니면 빈 키로 본다. 중복은 두 번째 등장 위치를 가리킨다.
  // 인덱스로 돌아 희소 배열의 빈 칸도 undefined 항목으로 잡는다.
  const groupKeys = new Set<string>();
  for (let index = 0; index < groups.length; index += 1) {
    const entry: unknown = groups[index];
    if (!isEntryObject(entry)) {
      defects.push({ code: 'GROUP_ENTRY_INVALID', path: `groups[${index}]` });
      continue;
    }
    const key = entry.groupKey;
    if (!isNonEmptyString(key)) {
      defects.push({ code: 'EMPTY_GROUP_KEY', path: `groups[${index}].groupKey` });
    }
    if (typeof key === 'string') {
      if (groupKeys.has(key) && key !== '') {
        defects.push({ code: 'DUPLICATE_GROUP_KEY', path: `groups[${index}].groupKey` });
      }
      groupKeys.add(key);
    }
  }

  // 풀: 배열이 아니면 POOLS_NOT_ARRAY. 배열이면 항목 모양 → 키(빈 키, 중복) 순으로 본다.
  const rawPools: unknown = profile.sharedLimitPools;
  const poolKeys = new Set<string>();
  if (!Array.isArray(rawPools)) {
    defects.push({ code: 'POOLS_NOT_ARRAY', path: 'sharedLimitPools' });
  } else {
    for (let index = 0; index < rawPools.length; index += 1) {
      const entry: unknown = rawPools[index];
      if (!isEntryObject(entry)) {
        defects.push({ code: 'POOL_ENTRY_INVALID', path: `sharedLimitPools[${index}]` });
        continue;
      }
      const key = entry.poolKey;
      if (!isNonEmptyString(key)) {
        defects.push({ code: 'EMPTY_POOL_KEY', path: `sharedLimitPools[${index}].poolKey` });
        continue;
      }
      if (poolKeys.has(key)) {
        defects.push({ code: 'DUPLICATE_POOL_KEY', path: `sharedLimitPools[${index}].poolKey` });
      }
      poolKeys.add(key);
    }
  }

  // 풀 참조: sharedLimitPoolKey 가 있으면 존재하는 poolKey 를 가리켜야 한다. 멤버 없는 풀은 허용한다.
  // 항목 모양 결함이 있는 그룹은 읽지 않는다.
  for (let index = 0; index < groups.length; index += 1) {
    const entry: unknown = groups[index];
    if (!isEntryObject(entry)) continue;
    const reference = entry.sharedLimitPoolKey;
    if (reference !== undefined && !(typeof reference === 'string' && poolKeys.has(reference))) {
      defects.push({ code: 'UNKNOWN_POOL_REFERENCE', path: `groups[${index}].sharedLimitPoolKey` });
    }
  }

  // groupOrder: 모든 groupKey 를 정확히 한 번씩 담아야 한다.
  const order: unknown = profile.groupOrder;
  const orderEntries: unknown[] = Array.isArray(order) ? order : [];
  const inOrder = new Set<unknown>(orderEntries);
  for (const key of groupKeys) {
    if (!inOrder.has(key)) {
      defects.push({ code: 'GROUP_ORDER_MISSING_KEY', path: 'groupOrder' });
    }
  }
  const seenInOrder = new Set<unknown>();
  orderEntries.forEach((key, index) => {
    if (typeof key !== 'string' || !groupKeys.has(key)) {
      defects.push({ code: 'GROUP_ORDER_UNKNOWN_KEY', path: `groupOrder[${index}]` });
    } else if (seenInOrder.has(key)) {
      defects.push({ code: 'GROUP_ORDER_DUPLICATE_KEY', path: `groupOrder[${index}]` });
    }
    seenInOrder.add(key);
  });

  return defects.length === 0 ? { ok: true } : { ok: false, defects };
}
