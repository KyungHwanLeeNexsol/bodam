import type { Defect } from '../domain/errors';
import { checkCross } from './bundle-cross';
import type { CrossProfile } from './bundle-cross';
import { checkDocumentRules } from './bundle-docrules';
import { resolveBundle } from './bundle-form';
import type { BundleItemResolver } from './bundle-form';
import { checkHeader } from './bundle-header';
import { checkMappingFields } from './bundle-mapping';
import { checkProfile } from './bundle-profile';

// @MX:ANCHOR: [AUTO] 규칙 묶음 게시 검증. 규칙 묶음 게시 서비스(M3.D)와 관리자 API 의 400 변환(M7, AC-021f)과 시험이 같은 함수를 부른다.
// @MX:REASON: 묶음 항목의 형식·머리·봉인·매핑 필드 규칙·프로필 구조와 값·서류 규칙·교차 검사의 거절을 한 곳에서 정해야 게시와 계산이 어긋나지 않는다(DD-02·DD-03·DD-24).
/**
 * 규칙 묶음 게시 요청의 결함을 모두 모아 고정된 순서로 돌려준다 (결함이 없으면 빈 배열). 순수 함수이며 던지지 않고 입력을 바꾸지 않는다.
 * 저장·롤백·가용성 기록은 하지 않는다: 결함이 있으면 게시 서비스가 PUBLISH_VALIDATION_FAILED 로 던지고 트랜잭션이 되돌린다(M3.D).
 *
 * 층과 보고 순서 (층 안에서는 항목을 요청의 순서대로 본다):
 *   (a) 형식: profiles(목록 모양 → 항목 모양·참조·해석) → mappings(같은 방식) → documentRuleSet.
 *       형식이 틀린 항목만 빠지고 나머지는 이어지는 층으로 간다.
 *   (b) 머리: 프로필 → 매핑 → 서류 규칙 묶음 (origin → 약관 출처 → 승인자 → 내용 해시 또는 고정된 지문)
 *   (c) 매핑 필드 규칙: decision → groupKey → exclusionReason → scope
 *   (d) 프로필: 칸 키 → 구조(엔진 checkProfileStructure 의 순서) → 그룹 값 → 풀 값
 *   (e) 서류 규칙 묶음: 엔진 checkDocumentRuleSetStructure 의 순서
 *   (f) 교차: 그룹 교차 → 같은 칸의 프로필 중복 → 같은 매핑 id 중복. profiles·mappings 의 형식 결함이 하나도 없을 때만 돈다
 *       (일부 항목이 빠진 목록으로는 "칸에 프로필이 없다" 같은 판정이 틀리기 때문이다).
 *
 * 결함 경로는 `bundle.` 로 시작한다 (예: `bundle.profiles[2].groups[0].deduction.rate`, `bundle.mappings[0].groupKey`).
 * 생명주기 상태(승인·게시 여부)와 유효 기간은 이 검증이 보지 않는다. 게시 서비스가 항목 상태를 전제로 확인하고, 계산이 isUsable 로 본다.
 */
export function validateRuleBundlePublish(request: unknown, resolver: BundleItemResolver): Defect[] {
  const form = resolveBundle(request, resolver);
  const out: Defect[] = [...form.defects];
  const { profiles, mappings, documentRuleSet } = form;

  for (const { index, item } of profiles) {
    checkHeader(out, { kind: 'PROFILE', item }, `bundle.profiles[${index}]`);
  }
  for (const { index, item } of mappings) {
    checkHeader(out, { kind: 'MAPPING', item }, `bundle.mappings[${index}]`);
  }
  if (documentRuleSet !== null) {
    checkHeader(out, { kind: 'DOCUMENT_RULE_SET', item: documentRuleSet }, 'bundle.documentRuleSet');
  }

  for (const { index, item } of mappings) {
    checkMappingFields(out, item, `bundle.mappings[${index}]`);
  }

  const crossProfiles: CrossProfile[] = profiles.map((entry) => ({
    ...entry,
    structureOk: checkProfile(out, entry.item, `bundle.profiles[${entry.index}]`).structureOk,
  }));

  if (documentRuleSet !== null) {
    checkDocumentRules(out, documentRuleSet, 'bundle.documentRuleSet');
  }

  if (form.complete) {
    checkCross(out, crossProfiles, mappings);
  }
  return out;
}
