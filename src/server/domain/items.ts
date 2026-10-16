import type {
  ApproverRecord,
  DocumentRuleSet,
  LifecycleState,
  StandardAssumptionProfile,
  TreatmentCoverageMapping,
} from '../../engine/types';
import type { Actor, Role } from './actor';

// 규칙 데이터 항목(프로필·매핑·서류 규칙 묶음)의 "바뀌지 않는 내용"과 "현재 생명주기 상태"를 따로 다룬다
// (design.md DD-14 "항목 생명주기 상태와 캐시 계약").
//
//   내용(ItemVersionRecord)  — 항목 버전 하나의 내용. 한 번 쓰면 바꾸지 않는다. 캐시해도 된다.
//   상태(ItemStateRecord)    — 그 항목 버전의 현재 LifecycleState 와 승인자 기록, 그리고 추가 전용 전이 이력.
//                              계산 요청마다 새로 읽는다(캐시하지 않는다).
//
// 엔진 항목 타입은 머리 정보 안에 `state` 를 갖는다. 저장된 내용은 `state` 의 정본이 아니므로 내용 기록에서 `state` 를 뺀다.
// [문서에 없음] `approver` 도 내용에서 뺀다: 승인자는 승인 시점에 생기는 생명주기 사실이어서, 내용에 두면 초안을 쓸 때는
// 알 수 없고 승인할 때는 쓰기 한 번 뒤에 바꿔야 한다. 그러면 "내용은 한 번 쓰면 바뀌지 않는다"를 지킬 수 없다.
// 그래서 승인자 기록은 상태 기록이 갖는다. 엔진 형식으로 합칠 때(projection.ts) 두 쪽에서 채운다.
// [문서에 없음] (M3.B 결정) 매핑의 `approvedFingerprint` 도 같은 이유로 내용이 아니라 상태 기록이 갖는다: DD-15 는 지문을
// "승인 때" 저장한다고 하고 DD-17 은 UNDER_REREVIEW → APPROVED(같은 버전의 재승인)를 허용한다. 지문이 불변 내용이면 둘 중 하나를
// 지킬 수 없다. 재승인할 때마다 새 지문이 고정되고 이전 값은 상태 이력에 남는다. design.md:827 이 지문을 캐시해도 되는
// 내용에 넣은 것과는 어긋나므로 SPEC 문구 쪽의 정리가 필요하다(progress.md 에 기록).

export type ItemKind = 'PROFILE' | 'MAPPING' | 'DOCUMENT_RULE_SET';

/** 항목 버전 하나를 가리키는 참조. (kind, id, version) 이 키다. */
export interface ItemVersionRef {
  kind: ItemKind;
  id: string;
  version: string;
}

/** 사람이 읽는 참조 표기 (`종류/id/버전`). 감사 기록의 대상과 오류 메시지에 쓴다. */
export function formatRef(ref: ItemVersionRef): string {
  return `${ref.kind}/${ref.id}/${ref.version}`;
}

/**
 * 엔진 항목 타입에서 현재 상태(`state`)와 승인자(`approver`)를 뺀, 바뀌지 않는 내용. 나머지 필드는 엔진 타입을 그대로 재사용한다.
 * 매핑은 승인 시점의 사실인 `approvedFingerprint` 도 뺀다(상태 기록이 갖는다).
 */
export type ProfileContent = Omit<StandardAssumptionProfile, 'state' | 'approver'>;
export type MappingContent = Omit<TreatmentCoverageMapping, 'state' | 'approver' | 'approvedFingerprint'>;
export type DocumentRuleSetRecordContent = Omit<DocumentRuleSet, 'state' | 'approver'>;

export interface ItemContentByKind {
  PROFILE: ProfileContent;
  MAPPING: MappingContent;
  DOCUMENT_RULE_SET: DocumentRuleSetRecordContent;
}

/** 특정 종류의 항목 버전 기록. */
export interface ItemVersionRecordOf<K extends ItemKind> {
  ref: { kind: K; id: string; version: string };
  content: ItemContentByKind[K];
  authorId: string;
  /** ISO 8601 시각 (주입한 시계). */
  createdAt: string;
}

/** 어떤 종류든 담는 항목 버전 기록 (종류별 형식의 합집합). 저장소는 이 형식을 쓴다. */
export type ItemVersionRecord = { [K in ItemKind]: ItemVersionRecordOf<K> }[ItemKind];

/** 매핑 버전 기록인지 가려 타입을 좁힌다 (종류는 ref 안에 있어 기록 전체의 판별자가 아니다). */
export function isMappingRecord(record: ItemVersionRecord): record is ItemVersionRecordOf<'MAPPING'> {
  return record.ref.kind === 'MAPPING';
}

/**
 * 상태 전이 한 건의 기록. 추가 전용이다. 최초 기록(생성)은 from 이 null 이다.
 * approver·approvedFingerprint 는 이 전이 뒤에 유효한 값이다: 재승인으로 현재 값이 바뀌어도 이전 값이 이력에 남는다.
 */
export interface StateTransition {
  from: LifecycleState | null;
  to: LifecycleState;
  actorId: string;
  role: Role;
  /** ISO 8601 시각 (주입한 시계). */
  at: string;
  reason: string | null;
  approver: ApproverRecord | null;
  approvedFingerprint: string | null;
}

/** 전이를 쓸 때 서비스가 넘기는 입력. 저장소는 from 이 현재 상태와 같은지만 확인하고 전이 표(DD-17)는 서비스가 본다. */
export interface ItemTransitionInput {
  from: LifecycleState | null;
  to: LifecycleState;
  actor: Actor;
  at: string;
  reason: string | null;
  /** 전이 뒤의 승인자 기록. 승인하면 채우고, 승인자를 바꾸지 않는 전이는 이전 값을 그대로 넘긴다. */
  approverAfter: ApproverRecord | null;
  /** 전이 뒤의 고정된 지문(매핑). 승인하면 그 시점의 지문을 채우고, 바꾸지 않는 전이는 이전 값을 그대로 넘긴다. 매핑이 아니면 null. */
  approvedFingerprintAfter: string | null;
}

/** 항목 버전의 현재 상태 기록(이력 포함). */
export interface ItemStateRecord {
  ref: ItemVersionRef;
  state: LifecycleState;
  approver: ApproverRecord | null;
  /** 승인 때 고정된 지문(매핑). 승인한 적이 없거나 매핑이 아니면 null. */
  approvedFingerprint: string | null;
  history: StateTransition[];
}

/** 계산 요청마다 새로 읽는 현재 상태. 이력은 싣지 않는다. */
export interface ItemStateSnapshot {
  ref: ItemVersionRef;
  state: LifecycleState;
  approver: ApproverRecord | null;
  approvedFingerprint: string | null;
}
