import type { DocumentRuleSet, StandardAssumptionProfile, TreatmentCoverageMapping } from '../../engine/types';
import type { Defect } from '../domain/errors';
import type { ItemKind, ItemVersionRef } from '../domain/items';
import { expectValue, isNonEmptyString, isPlainObject } from './shape';

// 규칙 묶음 게시 검증 1층: 컨테이너와 항목의 형식, 그리고 참조(ref)의 해석 (AC-011i 의 `M3 · 미구현` 하위 기준).
// M1 엔진은 묶음 컨테이너의 잘못된 항목을 막지 않는다(null 프로필은 resolveProfile 에서, null 매핑은 estimate() 에서 TypeError).
// 이 층이 그 보장을 맡는다: 잘못된 부분은 보고하고 더 읽지 않으며, 어떤 입력에서도 던지지 않는다.

/** 규칙 묶음 게시 요청: 항목 버전의 참조 목록. 세 필드는 unknown 으로 받아 모양이 틀린 요청을 시험할 수 있게 한다. */
export interface RuleBundlePublishRequest {
  /** ItemVersionRef(kind = PROFILE) 의 배열. */
  profiles: unknown;
  /** ItemVersionRef(kind = MAPPING) 의 배열. */
  mappings: unknown;
  /** ItemVersionRef(kind = DOCUMENT_RULE_SET) 하나, 또는 서류 규칙 묶음이 없으면 null. */
  documentRuleSet: unknown;
}

/**
 * 참조를 "엔진 형식으로 합쳐진 항목"(바뀌지 않는 내용 + 방금 읽은 현재 상태, domain/projection.ts 의 toEngine*)으로 바꾸는 순수 함수 묶음.
 * 검증기는 저장소를 모른다: 호출하는 게시 서비스가 저장소에서 읽어 이 해석기를 만들어 넘긴다. 없는 참조는 null 을 돌려준다.
 * 해석기는 던지지 않고 참조마다 같은 값을 돌려줘야 한다(검증기는 참조마다 정확히 한 번 부른다).
 */
export interface BundleItemResolver {
  profile(ref: ItemVersionRef): StandardAssumptionProfile | null;
  mapping(ref: ItemVersionRef): TreatmentCoverageMapping | null;
  documentRuleSet(ref: ItemVersionRef): DocumentRuleSet | null;
}

/** 요청 안의 위치(index)와 함께 해석된 항목. */
export interface ResolvedEntry<T> {
  index: number;
  item: T;
}

export interface FormResult {
  defects: Defect[];
  profiles: Array<ResolvedEntry<StandardAssumptionProfile>>;
  mappings: Array<ResolvedEntry<TreatmentCoverageMapping>>;
  documentRuleSet: DocumentRuleSet | null;
  /** profiles·mappings 가 배열이고 모든 항목이 형식에 맞고 해석됐다. 교차 검사는 전체 항목이 있어야 의미가 있다. */
  complete: boolean;
}

/**
 * 참조 하나의 모양을 본다: 객체이고, kind 가 기대한 종류이고, id·version 이 비어 있지 않은 문자열이다.
 * 보고 순서는 kind → id → version. 하나라도 틀리면 null 이다(해석기를 부르지 않는다).
 */
function parseRef(entry: unknown, path: string, expected: ItemKind, out: Defect[]): ItemVersionRef | null {
  if (!isPlainObject(entry)) {
    out.push({ code: 'NOT_OBJECT', path });
    return null;
  }
  const before = out.length;
  expectValue(out, entry.kind, `${path}.kind`, (kind) => kind === expected);
  expectValue(out, entry.id, `${path}.id`, isNonEmptyString);
  expectValue(out, entry.version, `${path}.version`, isNonEmptyString);
  if (out.length > before) {
    return null;
  }
  return { kind: expected, id: entry.id as string, version: entry.version as string };
}

/** 해석 결과는 배열이 아닌 객체여야 한다. 그렇지 않으면 해석되지 않은 것으로 본다(REF_UNRESOLVABLE). */
function resolved<T>(value: unknown, path: string, out: Defect[]): T | null {
  if (!isPlainObject(value)) {
    out.push({ code: 'REF_UNRESOLVABLE', path });
    return null;
  }
  return value as T;
}

/** 배열 컨테이너 하나를 읽는다: 배열이 아니면 NOT_ARRAY 이고 null, 배열이면 항목마다 참조를 해석한다. */
function resolveList<T>(
  out: Defect[],
  list: unknown,
  path: string,
  kind: ItemKind,
  resolve: (ref: ItemVersionRef) => unknown,
): { entries: Array<ResolvedEntry<T>>; complete: boolean } {
  if (!Array.isArray(list)) {
    out.push({ code: 'NOT_ARRAY', path });
    return { entries: [], complete: false };
  }
  const entries: Array<ResolvedEntry<T>> = [];
  let complete = true;
  // 인덱스로 돌아 희소 배열의 빈 칸도 undefined 항목으로 잡는다.
  for (let index = 0; index < list.length; index += 1) {
    const at = `${path}[${index}]`;
    const ref = parseRef(list[index], at, kind, out);
    const item = ref === null ? null : resolved<T>(resolve(ref), at, out);
    if (item === null) {
      complete = false;
    } else {
      entries.push({ index, item });
    }
  }
  return { entries, complete };
}

/**
 * 요청의 형식을 본다. 결함 순서: profiles(목록 모양 → 항목 순서대로) → mappings(같은 방식) → documentRuleSet.
 * 형식이 틀린 부분만 빠지고 나머지 항목은 해석되어 이어지는 층으로 간다.
 */
export function resolveBundle(request: unknown, resolver: BundleItemResolver): FormResult {
  const defects: Defect[] = [];
  if (!isPlainObject(request)) {
    return { defects: [{ code: 'NOT_OBJECT', path: 'bundle' }], profiles: [], mappings: [], documentRuleSet: null, complete: false };
  }
  const profiles = resolveList<StandardAssumptionProfile>(defects, request.profiles, 'bundle.profiles', 'PROFILE', (ref) => resolver.profile(ref));
  const mappings = resolveList<TreatmentCoverageMapping>(defects, request.mappings, 'bundle.mappings', 'MAPPING', (ref) => resolver.mapping(ref));

  // null 은 "서류 규칙 묶음이 없다"는 뜻이다. 필드가 빠졌거나 undefined 인 것은 없다고 추정하지 않고 결함으로 본다.
  let documentRuleSet: DocumentRuleSet | null = null;
  const slot = request.documentRuleSet;
  if (slot === undefined) {
    defects.push({ code: 'VALUE_MISSING', path: 'bundle.documentRuleSet' });
  } else if (slot !== null) {
    const ref = parseRef(slot, 'bundle.documentRuleSet', 'DOCUMENT_RULE_SET', defects);
    documentRuleSet = ref === null ? null : resolved<DocumentRuleSet>(resolver.documentRuleSet(ref), 'bundle.documentRuleSet', defects);
  }

  return { defects, profiles: profiles.entries, mappings: mappings.entries, documentRuleSet, complete: profiles.complete && mappings.complete };
}
