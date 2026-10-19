import type { RuleBundleSnapshot } from '../../engine/types';
import type { BundleAvailability } from '../domain/entities';
import type { ItemVersionRecordOf } from '../domain/items';
import { toEngineDocumentRuleSet, toEngineMapping, toEngineProfile } from '../domain/projection';
import type { Repository } from '../repo/interfaces';
import { ServerIntegrityError } from './integrity';

// 규칙 묶음의 읽기 (SPEC-REIMBURSEMENT-001 M4.B, design.md DD-14 "항목 생명주기 상태와 캐시 계약", DD-04, AC-006i).
// 계산 요청이 묶음을 엔진 입력으로 만드는 일은 세 단계로 나뉘고, 단계마다 "요청마다 새로 읽는가"가 다르다:
//   1) loadBundleContent    — 바뀌지 않는 내용(묶음 기록과 항목 버전 내용)을 읽는다. 캐시해도 되는 것은 이 단계의 결과뿐이다
//                              ((묶음 id, 내용 해시)가 키. M4.C 가 이 함수를 감싼다).
//   2) assertBundleStructure — 읽어 온 내용의 구조를 검사한다. 캐시 적중이든 아니든 엔진 앞에서 매번 한다.
//   3) composeBundleSnapshot — 항목의 현재 상태·승인자·승인 지문을 요청마다 새로 읽어(readItemStates 정확히 한 번) 내용에 채운다.
//                              합성은 projection.ts 의 단일 구현이 한다(준비 상태 계산과 같다). 가용성도 호출하는 쪽이 요청마다 새로 읽어 넘긴다.
// 규칙 사용 범위가 없거나 묶음이 중지(SUSPENDED)이면 이 파일의 어떤 함수도 부르지 않는다: 묶음 안의 항목을 읽지 않는다(DD-04 isBundleUsable).

/** 묶음의 바뀌지 않는 내용: 묶음 id·내용 해시와 종류별 항목 버전 기록 (게시된 묶음의 itemRefs 순서). 상태·승인자·지문·가용성은 들어 있지 않다. */
export interface BundleContent {
  id: string;
  contentHash: string;
  profiles: ItemVersionRecordOf<'PROFILE'>[];
  mappings: ItemVersionRecordOf<'MAPPING'>[];
  /** [문서에 없음] 묶음 게시는 서류 규칙 묶음을 하나만 허용한다. 둘 이상이 저장돼 있으면 itemRefs 순서의 첫 번째만 쓴다(준비 상태 계산과 같다). */
  documentRuleSet: ItemVersionRecordOf<'DOCUMENT_RULE_SET'> | null;
}

type ContentReads = Pick<Repository, 'getRuleBundleVersion' | 'getItemVersion'>;

/**
 * 묶음 기록과 담긴 항목 버전의 내용을 읽는다. 저장소가 가리키는 자료가 없으면(묶음 기록·항목 내용) 서버 데이터 무결성 결함이다.
 * 항목의 현재 상태는 읽지 않는다.
 */
export function loadBundleContent(repo: ContentReads, bundleId: string): BundleContent {
  const bundle = repo.getRuleBundleVersion(bundleId);
  if (bundle === null) {
    throw new ServerIntegrityError('BUNDLE_MISSING');
  }
  const content: BundleContent = { id: bundle.id, contentHash: bundle.contentHash, profiles: [], mappings: [], documentRuleSet: null };
  for (const ref of bundle.itemRefs) {
    const record = repo.getItemVersion(ref);
    if (record === null) {
      throw new ServerIntegrityError('ITEM_CONTENT_MISSING');
    }
    if (ref.kind === 'PROFILE') {
      content.profiles.push(record as ItemVersionRecordOf<'PROFILE'>);
    } else if (ref.kind === 'MAPPING') {
      content.mappings.push(record as ItemVersionRecordOf<'MAPPING'>);
    } else if (content.documentRuleSet === null) {
      content.documentRuleSet = record as ItemVersionRecordOf<'DOCUMENT_RULE_SET'>;
    }
  }
  return content;
}

const isPlainObject = (value: unknown): boolean => typeof value === 'object' && value !== null && !Array.isArray(value);

// @MX:NOTE: [AUTO] [문서에 없음] 구조 검사의 대상은 profiles·mappings 의 컨테이너(배열)와 항목 기록, 그리고 그 기록의 content 다. "항목이 null 이 아닌 비배열 객체"를 기록과 내용 양쪽에 적용한다:
// 기록은 객체인데 내용만 null 이면 projection 의 펼침({...content})이 속 빈 객체를 만들어 엔진이 다른 이유의 보류로 덮어 버리기 때문이다. 희소 배열의 빈 칸도 결함이다(인덱스로 돈다).
// 정상적인 빈 배열 []은 결함이 아니다(엔진의 PROFILE_ABSENT·MAPPING_ABSENT 판정을 그대로 따른다). documentRuleSet 은 범위 밖이다.
/**
 * 읽어 온 묶음 내용의 구조를 검사한다: profiles·mappings 는 배열이어야 하고 모든 항목(과 그 항목의 content)이 null 이 아닌 비배열 객체여야 한다.
 * 어긋나면 ServerIntegrityError('BUNDLE_STRUCTURE_INVALID') 를 던진다. ACTIVE 묶음에만 부른다(범위 없음·중지 판정이 먼저다).
 */
export function assertBundleStructure(content: BundleContent): void {
  for (const items of [content.profiles, content.mappings] as unknown[]) {
    if (!Array.isArray(items)) {
      throw new ServerIntegrityError('BUNDLE_STRUCTURE_INVALID');
    }
    for (let index = 0; index < items.length; index += 1) {
      const item: unknown = items[index];
      if (!isPlainObject(item) || !isPlainObject((item as { content?: unknown }).content)) {
        throw new ServerIntegrityError('BUNDLE_STRUCTURE_INVALID');
      }
    }
  }
}

/**
 * 내용에 방금 읽은 현재 상태를 채워 엔진의 RuleBundleSnapshot 을 만든다. 항목 상태 읽기(readItemStates)는 호출마다 정확히 한 번이다
 * (참조 순서: 프로필 → 매핑 → 서류 규칙 묶음). 상태 기록이 없는 항목은 서버 데이터 무결성 결함이다. status 는 호출하는 쪽이 요청 안에서 새로 읽은 가용성이다.
 */
export function composeBundleSnapshot(repo: Pick<Repository, 'readItemStates'>, content: BundleContent, status: BundleAvailability): RuleBundleSnapshot {
  const ruleSet = content.documentRuleSet;
  const refs = [...content.profiles, ...content.mappings, ...(ruleSet === null ? [] : [ruleSet])].map((record) => record.ref);
  const states = repo.readItemStates(refs);
  let cursor = 0;
  const nextState = () => {
    const state = states[cursor];
    cursor += 1;
    if (state === null || state === undefined) {
      throw new ServerIntegrityError('ITEM_STATE_MISSING');
    }
    return state;
  };
  const profiles = content.profiles.map((record) => toEngineProfile(record, nextState()));
  const mappings = content.mappings.map((record) => toEngineMapping(record, nextState()));
  const documentRuleSet = ruleSet === null ? null : toEngineDocumentRuleSet(ruleSet, nextState());
  return { id: content.id, contentHash: content.contentHash, status, profiles, mappings, documentRuleSet };
}
