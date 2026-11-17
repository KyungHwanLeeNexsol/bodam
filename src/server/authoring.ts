import { documentRuleSetContent, profileContent } from '../engine/usability';
import { appendAudit } from './audit';
import { canonicalDigest } from './digest';
import type { ServiceDeps } from './deps';
import { requireRole } from './domain/actor';
import type { Actor } from './domain/actor';
import { DomainError } from './domain/errors';
import { formatRef } from './domain/items';
import type { DocumentRuleSetRecordContent, ItemContentByKind, ItemKind, ItemVersionRecord, ItemVersionRecordOf, ProfileContent } from './domain/items';

// 규칙 항목(프로필·매핑·서류 규칙 묶음)의 초안 작성·수정·다음 버전 (design.md DD-17).
// 규칙 데이터의 작성은 보험 기준 검토 담당자(RV)만 한다 (소유자 결정 #34: 매핑 초안을 HA 가 만들 수 없다). 역할만 본다 — 소유·인증은 M7.
// 모든 서비스는 하나의 저장소 트랜잭션 안에서 돌고, 던지면 쓰기 전부(상태 기록·감사 기록 포함)가 되돌려진다.
//
// 내용 해시: 프로필·서류 규칙 묶음의 contentHash 는 호출자가 넘긴 값을 믿지 않고 서비스가 엔진의 정규화 함수
// (profileContent / documentRuleSetContent)와 운영 해시(canonicalDigest)로 다시 만든다. [문서에 없음] 저장된 해시가 항상 저장된
// 내용과 일치하게 해서, 게시 전에 낡은 해시가 INTEGRITY_MISMATCH 로 드러나는 일을 막는다. 두 번째 정규화 구현은 없다.

type Ref<K extends ItemKind> = { kind: K; id: string; version: string };

function requireText(value: unknown, path: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DomainError('INVALID_INPUT', `${path} 는 비어 있지 않은 문자열이어야 한다`, [{ code: 'EMPTY', path }]);
  }
}

/** 내용의 contentHash 를 엔진 정규화 + 운영 해시로 다시 만든 사본. 매핑은 해시가 없어 사본만 돌려준다. */
function sealed<K extends ItemKind>(kind: K, content: ItemContentByKind[K]): ItemContentByKind[K] {
  const copy = structuredClone(content);
  if (kind === 'PROFILE') {
    const profile = copy as ProfileContent;
    profile.contentHash = canonicalDigest(profileContent({ ...profile, state: 'DRAFT', approver: null }));
  } else if (kind === 'DOCUMENT_RULE_SET') {
    const ruleSet = copy as DocumentRuleSetRecordContent;
    ruleSet.contentHash = canonicalDigest(documentRuleSetContent({ ...ruleSet, state: 'DRAFT', approver: null }));
  }
  return copy;
}

/** 새 (종류, id, 버전)의 초안을 쓴다: 내용 기록 + 최초 DRAFT 상태 이력 + 감사 기록. 이미 있으면 DUPLICATE_KEY. */
function insertDraft<K extends ItemKind>(
  deps: ServiceDeps,
  actor: Actor,
  kind: K,
  content: ItemContentByKind[K],
  audit: { action: string; reason: string | null },
): ItemVersionRecordOf<K> {
  return deps.repo.transaction(() => {
    const ref: Ref<K> = { kind, id: content.id, version: content.version };
    if (deps.repo.getItemVersion(ref) !== null) {
      throw new DomainError('DUPLICATE_KEY', `항목 ${formatRef(ref)} 은(는) 이미 있다 (같은 버전을 다시 만들 수 없다)`);
    }
    const at = deps.clock.now();
    const record = { ref, content: sealed(kind, content), authorId: actor.id, createdAt: at } as ItemVersionRecordOf<K>;
    deps.repo.putItemVersion(record as ItemVersionRecord);
    deps.repo.recordItemTransition(ref, { from: null, to: 'DRAFT', actor, at, reason: null, approverAfter: null, approvedFingerprintAfter: null });
    appendAudit(deps, actor, { action: audit.action, target: formatRef(ref), beforeVersion: null, afterVersion: 'DRAFT', reason: audit.reason });
    return record;
  });
}

// @MX:ANCHOR: [AUTO] 규칙 항목 초안 작성의 단일 진입점. 직접 작성, 검토 요청으로부터의 매핑 초안(review-request.ts), 규칙 묶음 복구(M3.D)가 부른다.
// @MX:REASON: RV 역할 검사·내용 해시 봉인·최초 DRAFT 이력·감사 기록이 한 트랜잭션에서 같이 일어나야 한다. 이 중 하나가 빠진 초안은 승인 단계에서 근거 없이 보인다.
/** RV 가 새 버전의 초안을 만든다. 작성자는 행위자다. id·version 은 내용에서 오며 비어 있으면 INVALID_INPUT. */
export function createDraft<K extends ItemKind>(deps: ServiceDeps, actor: Actor, kind: K, content: ItemContentByKind[K]): ItemVersionRecordOf<K> {
  requireRole(actor, 'RV');
  requireText(content.id, 'id');
  requireText(content.version, 'version');
  return insertDraft(deps, actor, kind, content, { action: 'ITEM_CREATE_DRAFT', reason: null });
}

/**
 * DRAFT 일 때만 같은 버전의 내용을 고친다 (id·version 은 바꿀 수 없다). 작성자와 작성 시각은 그대로이고 상태 이력은 늘지 않는다.
 * 감사 기록에 수정자·시각·사유와 수정 전후 내용의 정본 해시가 남는다. 사유는 null 이어도 된다 [문서에 없음: 사유를 남기는 것이지
 * 필수 조건으로 보지 않았다]. DRAFT 를 떠난 버전은 STATE_CONFLICT.
 */
export function editDraft<K extends ItemKind>(deps: ServiceDeps, actor: Actor, ref: Ref<K>, content: ItemContentByKind[K], reason: string | null): ItemVersionRecordOf<K> {
  requireRole(actor, 'RV');
  return deps.repo.transaction(() => {
    const existing = deps.repo.getItemVersion(ref);
    if (existing === null) {
      throw new DomainError('NOT_FOUND', `항목 ${formatRef(ref)} 이(가) 없다`);
    }
    if (content.id !== ref.id || content.version !== ref.version) {
      throw new DomainError('REF_CONTENT_MISMATCH', `내용의 id·version(${content.id}/${content.version})이 참조 ${formatRef(ref)} 와 다르다 (정체성은 고칠 수 없다)`);
    }
    const record = { ref: { kind: ref.kind, id: ref.id, version: ref.version }, content: sealed(ref.kind, content), authorId: existing.authorId, createdAt: existing.createdAt } as ItemVersionRecordOf<K>;
    deps.repo.reviseDraftItemVersion(record as ItemVersionRecord);
    appendAudit(deps, actor, {
      action: 'ITEM_EDIT_DRAFT',
      target: formatRef(ref),
      beforeVersion: canonicalDigest(existing.content),
      afterVersion: canonicalDigest(record.content),
      reason,
    });
    return record;
  });
}

/**
 * 어떤 상태의 버전이든 그 내용의 사본을 새 버전 라벨의 DRAFT 로 만든다 (REJECTED·SUSPENDED 는 이 길로만 이어진다).
 * 원본은 읽기만 한다. 같은 라벨의 버전이 이미 있으면 DUPLICATE_KEY 이며 덮어쓰지 않는다. 버전 라벨이 해시 입력에 들므로 해시를 다시 봉인한다.
 */
export function createNextDraft<K extends ItemKind>(deps: ServiceDeps, actor: Actor, from: Ref<K>, newVersion: string): ItemVersionRecordOf<K> {
  requireRole(actor, 'RV');
  requireText(newVersion, 'version');
  return deps.repo.transaction(() => {
    const source = deps.repo.getItemVersion(from);
    if (source === null) {
      throw new DomainError('NOT_FOUND', `항목 ${formatRef(from)} 이(가) 없다`);
    }
    const copy = { ...structuredClone(source.content), version: newVersion } as ItemContentByKind[K];
    return insertDraft(deps, actor, from.kind, copy, { action: 'ITEM_CREATE_NEXT_VERSION', reason: `COPY_OF:${formatRef(from)}` });
  });
}
