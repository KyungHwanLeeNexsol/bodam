import { profileHasGroup } from '../../engine/resolve';
import type { Generation, InsurerType, StandardAssumptionProfile, TreatmentCoverageMapping } from '../../engine/types';
import type { Defect } from '../domain/errors';
import type { ResolvedEntry } from './bundle-form';
import { GENERATION_VALUES, INSURER_TYPES, isNonEmptyString, isOneOf, isPlainObject, repeatedPositions } from './shape';

// 규칙 묶음 게시 검증: 묶음 교차 검사 (design.md DD-03·DD-18, AC-011i 세 번째 항목).
//   1) 매핑 scope 의 한 칸에 같은 묶음의 프로필이 있는데 그 프로필에 매핑의 groupKey 가 없는 COVERED 매핑
//   2) 같은 (세대, 보험사 형태) 칸에 프로필 둘 이상
//   3) 같은 매핑 id 의 버전 둘 이상
// 프로필이 없는 칸을 scope 로 가진 매핑은 거절하지 않는다(그 칸의 계산은 PROFILE_ABSENT 로 보류된다).
// 이 층은 형식 결함이 없는 완전한 항목 목록에서만 돈다(bundle.ts). 배열 순서에 결과가 달라지지 않도록 중복은 같은 값을 가진 항목 모두를 보고한다.

export interface CrossProfile extends ResolvedEntry<StandardAssumptionProfile> {
  /** 엔진 구조 검사를 통과했다. 통과하지 못한 프로필의 그룹 목록은 믿을 수 없어 그룹 교차 검사에서 뺀다(구조 결함이 이미 거절한다). */
  structureOk: boolean;
}

const isGeneration = isOneOf(GENERATION_VALUES);
const isInsurerType = isOneOf(INSURER_TYPES);

interface Cell {
  generation: Generation;
  insurerType: InsurerType;
}

function cellKey(cell: Cell): string {
  return `${cell.generation}\u0000${cell.insurerType}`;
}

/** 칸 키가 닫힌 목록 안의 값인 프로필의 칸. 아니면 null (VALUE_INVALID 로 이미 보고됐다). */
function cellOfProfile(profile: StandardAssumptionProfile): Cell | null {
  return isGeneration(profile.generation) && isInsurerType(profile.insurerType) ? { generation: profile.generation, insurerType: profile.insurerType } : null;
}

/** 매핑 scope 에서 형식이 맞는 칸만 뽑는다(형식이 틀린 항목은 SCOPE_INVALID 로 이미 보고됐다). */
function cellsOfScope(mapping: TreatmentCoverageMapping): Cell[] {
  const scope: unknown = mapping.scope;
  if (!Array.isArray(scope)) {
    return [];
  }
  const cells: Cell[] = [];
  for (let index = 0; index < scope.length; index += 1) {
    const entry: unknown = scope[index];
    if (isPlainObject(entry) && isGeneration(entry.generation) && isInsurerType(entry.insurerType)) {
      cells.push({ generation: entry.generation, insurerType: entry.insurerType });
    }
  }
  return cells;
}

function groupCrossCheck(out: Defect[], profiles: readonly CrossProfile[], mappings: ReadonlyArray<ResolvedEntry<TreatmentCoverageMapping>>): void {
  const trusted = new Map<string, StandardAssumptionProfile[]>();
  for (const { item, structureOk } of profiles) {
    const cell = cellOfProfile(item);
    if (structureOk && cell !== null) {
      trusted.set(cellKey(cell), [...(trusted.get(cellKey(cell)) ?? []), item]);
    }
  }
  for (const { index, item: mapping } of mappings) {
    const groupKey: unknown = mapping.groupKey;
    if (mapping.decision !== 'COVERED' || !isNonEmptyString(groupKey)) {
      continue;
    }
    // scope 의 칸 가운데 프로필이 있는 칸에서 그 프로필이 하나라도 이 그룹을 갖지 않으면 매핑 하나에 결함 하나다.
    const lacking = cellsOfScope(mapping).some((cell) => (trusted.get(cellKey(cell)) ?? []).some((profile) => !profileHasGroup(profile, groupKey)));
    if (lacking) {
      out.push({ code: 'MAPPING_GROUP_NOT_IN_PROFILE', path: `bundle.mappings[${index}].groupKey` });
    }
  }
}

function duplicateCells(out: Defect[], profiles: readonly CrossProfile[]): void {
  const keys = profiles.map(({ item }) => {
    const cell = cellOfProfile(item);
    return cell === null ? null : cellKey(cell);
  });
  const repeated = new Set(repeatedPositions(keys));
  profiles.forEach(({ index }, position) => {
    if (repeated.has(position)) {
      out.push({ code: 'CELL_PROFILE_DUPLICATE', path: `bundle.profiles[${index}]` });
    }
  });
}

function duplicateMappingIds(out: Defect[], mappings: ReadonlyArray<ResolvedEntry<TreatmentCoverageMapping>>): void {
  const keys = mappings.map(({ item }) => (isNonEmptyString(item.id) ? item.id : null));
  const repeated = new Set(repeatedPositions(keys));
  mappings.forEach(({ index }, position) => {
    if (repeated.has(position)) {
      out.push({ code: 'MAPPING_ID_DUPLICATE', path: `bundle.mappings[${index}].id` });
    }
  });
}

/** 교차 검사. 보고 순서: 그룹 교차(매핑 순서) → 칸의 프로필 중복(프로필 순서) → 매핑 id 중복(매핑 순서). */
export function checkCross(out: Defect[], profiles: readonly CrossProfile[], mappings: ReadonlyArray<ResolvedEntry<TreatmentCoverageMapping>>): void {
  groupCrossCheck(out, profiles, mappings);
  duplicateCells(out, profiles);
  duplicateMappingIds(out, mappings);
}
