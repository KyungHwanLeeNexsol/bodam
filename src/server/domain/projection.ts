import type { ApproverRecord, DocumentRuleSet, LifecycleState, StandardAssumptionProfile, TreatmentCoverageMapping } from '../../engine/types';
import { DomainError } from './errors';
import type { ItemContentByKind, ItemKind, ItemStateSnapshot, ItemVersionRecordOf } from './items';

// 바뀌지 않는 항목 내용 + 방금 읽은 현재 상태 → 엔진이 읽는 항목 형식 (design.md DD-14 "항목 생명주기 상태와 캐시 계약").
// 계산 요청마다 서버는 (캐시해도 되는) 내용에 (캐시하지 않는) 현재 상태를 채워 RuleBundleSnapshot 을 조립한다(M3.D·M3.E·M4).
// 이 모듈이 그 합성의 단일 구현이다: state 와 approver 는 내용이 아니라 상태 기록에서만 온다.
// 순수 함수이며 입력을 바꾸지 않고, 결과는 입력과 깊이 분리된 복사본이다.

type Assembled<K extends ItemKind> = ItemContentByKind[K] & { state: LifecycleState; approver: ApproverRecord | null };

function assemble<K extends ItemKind>(record: ItemVersionRecordOf<K>, state: ItemStateSnapshot): Assembled<K> {
  const same = state.ref.kind === record.ref.kind && state.ref.id === record.ref.id && state.ref.version === record.ref.version;
  if (!same) {
    throw new DomainError(
      'REF_CONTENT_MISMATCH',
      `상태 기록(${state.ref.kind}/${state.ref.id}/${state.ref.version})이 내용(${record.ref.kind}/${record.ref.id}/${record.ref.version})의 것이 아니다`,
    );
  }
  return {
    ...structuredClone(record.content),
    state: state.state,
    approver: state.approver === null ? null : { ...state.approver },
  };
}

// @MX:ANCHOR: [AUTO] 프로필 내용 + 현재 상태 합성. 규칙 묶음 조립(M3.D)·준비 상태 계산(M3.E)·계산 요청(M4)이 같은 합성을 부른다.
// @MX:REASON: state 를 내용에서 읽거나 캐시하면 항목 중지·재검토가 다음 요청에 반영되지 않는다(DD-14). 합성 구현이 둘이면 그 차이가 판정 차이가 된다.
export function toEngineProfile(record: ItemVersionRecordOf<'PROFILE'>, state: ItemStateSnapshot): StandardAssumptionProfile {
  return assemble(record, state);
}

export function toEngineMapping(record: ItemVersionRecordOf<'MAPPING'>, state: ItemStateSnapshot): TreatmentCoverageMapping {
  return assemble(record, state);
}

export function toEngineDocumentRuleSet(record: ItemVersionRecordOf<'DOCUMENT_RULE_SET'>, state: ItemStateSnapshot): DocumentRuleSet {
  return assemble(record, state);
}
