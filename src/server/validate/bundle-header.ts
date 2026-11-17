import type { DocumentRuleSet, StandardAssumptionProfile, TreatmentCoverageMapping } from '../../engine/types';
import { documentRuleSetContent, profileContent } from '../../engine/usability';
import { canonicalDigest } from '../digest';
import type { Defect } from '../domain/errors';
import { ORIGINS, POLICY_SOURCE_FIELDS, expectValue, isNonEmptyString, isOneOf, isPlainObject } from './shape';

// 규칙 묶음 게시 검증: 머리 정보 (출처 · 약관 출처 · 승인자 · 봉인). 프로필·매핑·서류 규칙 묶음이 같은 머리 검사를 쓴다.
// 이 결함들은 묶음 게시의 결함이다(엔진 보류가 아니다): 머리가 불완전한 항목은 계산 때 SOURCE_INCOMPLETE·APPROVER_MISSING·
// INTEGRITY_MISMATCH 로 쓸 수 없게 되므로, 쓸 수 없는 항목을 묶어 게시하지 못하게 막는다. 판정 기준은 엔진 isUsable 과 같다
// (빈 문자열만 "비어 있음", 공백뿐인 문자열은 "비어 있지 않음").
// 생명주기 상태·유효 기간은 여기서 보지 않는다: 게시 서비스(M3.D)의 상태 전제와 계산 때의 isUsable 이 각각 본다.

const isOrigin = isOneOf(ORIGINS);

/** 약관 출처: 배열이고 1개 이상이며 모든 항목이 여섯 항목을 문자열로 채웠다 (엔진 arePolicySourcesComplete 와 같은 기준). */
function checkPolicySources(out: Defect[], item: Record<string, unknown>, path: string): void {
  const sources = item.policySources;
  if (!Array.isArray(sources) || sources.length === 0) {
    out.push({ code: 'POLICY_SOURCES_MISSING', path: `${path}.policySources` });
    return;
  }
  for (let index = 0; index < sources.length; index += 1) {
    const source: unknown = sources[index];
    const at = `${path}.policySources[${index}]`;
    if (!isPlainObject(source)) {
      out.push({ code: 'POLICY_SOURCE_INCOMPLETE', path: at });
      continue;
    }
    for (const field of POLICY_SOURCE_FIELDS) {
      if (!isNonEmptyString(source[field])) {
        out.push({ code: 'POLICY_SOURCE_INCOMPLETE', path: `${at}.${field}` });
      }
    }
  }
}

/** 승인자 기록: 객체이고 approverId·approvedAt 이 비어 있지 않은 문자열이다 (엔진 isApproverComplete 와 같은 기준). */
function checkApprover(out: Defect[], item: Record<string, unknown>, path: string): void {
  const approver = item.approver;
  if (!isPlainObject(approver)) {
    out.push({ code: 'APPROVER_MISSING', path: `${path}.approver` });
    return;
  }
  for (const field of ['approverId', 'approvedAt']) {
    if (!isNonEmptyString(approver[field])) {
      out.push({ code: 'APPROVER_INCOMPLETE', path: `${path}.approver.${field}` });
    }
  }
}

/** 봉인 검사: 내용 해시가 엔진 정규화(profileContent·documentRuleSetContent) + 운영 해시로 다시 계산한 값과 같아야 한다. 해시를 고쳐 맞추지 않는다. */
function checkSeal(out: Defect[], expected: string, stored: unknown, path: string): void {
  if (stored !== expected) {
    out.push({ code: 'INTEGRITY_MISMATCH', path: `${path}.contentHash` });
  }
}

type HeaderTarget =
  | { kind: 'PROFILE'; item: StandardAssumptionProfile }
  | { kind: 'MAPPING'; item: TreatmentCoverageMapping }
  | { kind: 'DOCUMENT_RULE_SET'; item: DocumentRuleSet };

/**
 * 항목 하나의 머리를 본다. 보고 순서: origin → 약관 출처 → 승인자 → 봉인(프로필·서류 규칙 묶음의 내용 해시) 또는 고정된 지문(매핑).
 * 매핑은 내용 해시가 없다: 지문이 현재 치료 버전과 같은지는 치료 자료가 있는 곳(계산·재검토)이 보며, 여기서는 지문이 고정되어 있는지만 본다.
 */
export function checkHeader(out: Defect[], target: HeaderTarget, path: string): void {
  const item = target.item as unknown as Record<string, unknown>;
  expectValue(out, item.origin, `${path}.origin`, isOrigin);
  checkPolicySources(out, item, path);
  checkApprover(out, item, path);
  switch (target.kind) {
    case 'PROFILE':
      checkSeal(out, canonicalDigest(profileContent(target.item)), item.contentHash, path);
      break;
    case 'DOCUMENT_RULE_SET':
      checkSeal(out, canonicalDigest(documentRuleSetContent(target.item)), item.contentHash, path);
      break;
    case 'MAPPING':
      if (!isNonEmptyString(item.approvedFingerprint)) {
        out.push({ code: 'FINGERPRINT_MISSING', path: `${path}.approvedFingerprint` });
      }
      break;
  }
}
