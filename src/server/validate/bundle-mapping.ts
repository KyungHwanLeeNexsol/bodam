import type { TreatmentCoverageMapping } from '../../engine/types';
import type { Defect } from '../domain/errors';
import { GENERATION_VALUES, INSURER_TYPES, isNonEmptyString, isOneOf, isPlainObject } from './shape';

// 규칙 묶음 게시 검증: 매핑 필드 규칙 (design.md DD-03 "확인된 제외와 줄 상태", AC-011i 첫 번째 항목).
//   COVERED  ⇒ groupKey 필수(비어 있지 않음) · exclusionReason 없음
//   EXCLUDED ⇒ groupKey 없음 · exclusionReason 필수(비어 있지 않음)
//   그 밖의 decision ⇒ 거절
// 두 경우 모두 약관 출처 1개 이상과 승인자 기록이 필요하며 EXCLUDED 도 똑같다: 그 요건은 머리 검사(bundle-header.ts)가 본다.
// "없음"은 엔진의 저장 데이터 방어(resolve.ts violatesMappingFieldRules)와 같이 undefined 를 뜻한다: null 이나 빈 문자열은 "있음"이다.

const isGeneration = isOneOf(GENERATION_VALUES);
const isInsurerType = isOneOf(INSURER_TYPES);

/** scope: 엔진 매핑 조회(resolveMapping)가 읽는 모양. 배열이고 항목마다 (세대, 보험사 형태)가 닫힌 목록 안의 값이다. 빈 scope 는 허용한다 [문서에 없음]. */
function checkScope(out: Defect[], mapping: Record<string, unknown>, path: string): void {
  const scope = mapping.scope;
  if (!Array.isArray(scope)) {
    out.push({ code: 'SCOPE_INVALID', path: `${path}.scope` });
    return;
  }
  for (let index = 0; index < scope.length; index += 1) {
    const entry: unknown = scope[index];
    const at = `${path}.scope[${index}]`;
    if (!isPlainObject(entry)) {
      out.push({ code: 'SCOPE_INVALID', path: at });
      continue;
    }
    if (!isGeneration(entry.generation)) {
      out.push({ code: 'SCOPE_INVALID', path: `${at}.generation` });
    }
    if (!isInsurerType(entry.insurerType)) {
      out.push({ code: 'SCOPE_INVALID', path: `${at}.insurerType` });
    }
  }
}

/** 매핑 하나의 필드 규칙. 보고 순서: decision → groupKey → exclusionReason → scope. decision 이 틀리면 그룹·사유 규칙은 판단하지 않는다. */
export function checkMappingFields(out: Defect[], mapping: TreatmentCoverageMapping, path: string): void {
  const fields = mapping as unknown as Record<string, unknown>;
  switch (fields.decision) {
    case 'COVERED':
      if (!isNonEmptyString(fields.groupKey)) {
        out.push({ code: 'GROUP_KEY_REQUIRED', path: `${path}.groupKey` });
      }
      if (fields.exclusionReason !== undefined) {
        out.push({ code: 'EXCLUSION_REASON_FORBIDDEN', path: `${path}.exclusionReason` });
      }
      break;
    case 'EXCLUDED':
      if (fields.groupKey !== undefined) {
        out.push({ code: 'GROUP_KEY_FORBIDDEN', path: `${path}.groupKey` });
      }
      if (!isNonEmptyString(fields.exclusionReason)) {
        out.push({ code: 'EXCLUSION_REASON_REQUIRED', path: `${path}.exclusionReason` });
      }
      break;
    default:
      out.push({ code: 'DECISION_INVALID', path: `${path}.decision` });
  }
  checkScope(out, fields, path);
}
