import { describe, expect, it } from 'vitest';
import { documentRuleSetContent, profileContent } from '../../src/engine/usability';
import type { LifecycleState } from '../../src/engine/types';
import { createDraft, createNextDraft, editDraft } from '../../src/server/authoring';
import { canonicalDigest } from '../../src/server/digest';
import type { ItemKind } from '../../src/server/domain/items';
import { TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1, TEST_FIXTURE_RV_APPROVER, TEST_FIXTURE_RV_AUTHOR } from '../fixtures/server/actors.fixture';
import { catchDomainError } from '../fixtures/server/errors.fixture';
import { ALL_STATES, ITEM_KINDS, baseContent, itemInState, newWorld } from '../fixtures/server/lifecycle.fixture';
import { snapshotOf } from '../fixtures/server/repo.fixture';

// 초안 작성·수정·다음 버전 (design.md DD-17: "규칙은 덮어쓰거나 지우지 않고 새 버전을 낸다. 수정자·일시·사유를 남긴다").
// 초안(DRAFT)일 때만 같은 버전의 내용을 고칠 수 있고, DRAFT 를 떠난 버전의 내용은 바뀌지 않는다.

type Loose = Record<string, unknown>;

/** 서비스가 프로필·서류 규칙 묶음의 내용 해시를 엔진 정규화 함수로 다시 만든 값. 매핑은 해시가 없다. */
function sealedHash(kind: ItemKind, content: Loose): string | undefined {
  if (kind === 'PROFILE') {
    return canonicalDigest(profileContent({ ...content, state: 'DRAFT', approver: null } as never));
  }
  if (kind === 'DOCUMENT_RULE_SET') {
    return canonicalDigest(documentRuleSetContent({ ...content, state: 'DRAFT', approver: null } as never));
  }
  return undefined;
}

/** 해시에 드는 내용을 실제로 바꾸는 수정 (종류마다 해시 입력 필드가 다르다). */
function hashRelevantEdit(kind: ItemKind, content: Loose): Loose {
  const changed = structuredClone(content);
  if (kind === 'PROFILE') {
    (changed.groups as Array<{ deduction: unknown }>)[0]!.deduction = { kind: 'FIXED', fixed: 7_777 };
  } else if (kind === 'DOCUMENT_RULE_SET') {
    (changed.rules as Array<{ reason: string }>)[0]!.reason = 'TEST_FIXTURE 바뀐 사유';
  } else {
    changed.validity = { from: '2026-03-01', to: '2026-09-30' };
  }
  return changed;
}

describe.each(ITEM_KINDS)('초안 작성 (%s)', (kind) => {
  it('RV 가 쓰면 DRAFT 로 저장되고 작성자·시각·최초 상태 이력이 기록된다', () => {
    const world = newWorld();
    world.clock.set('2026-10-16T09:30:00.000Z');
    const content = baseContent(kind);
    const record = createDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, kind, content);

    expect(record.ref).toEqual({ kind, id: content.id, version: content.version });
    expect(record.authorId).toBe('TEST_FIXTURE_RV_AUTHOR');
    expect(record.createdAt).toBe('2026-10-16T09:30:00.000Z');
    expect(world.repo.getItemVersion(record.ref)).toEqual(record);
    expect(world.repo.getItemState(record.ref)).toEqual({
      ref: record.ref,
      state: 'DRAFT',
      approver: null,
      approvedFingerprint: null,
      history: [
        { from: null, to: 'DRAFT', actorId: 'TEST_FIXTURE_RV_AUTHOR', role: 'RV', at: '2026-10-16T09:30:00.000Z', reason: null, approver: null, approvedFingerprint: null },
      ],
    });
  });

  it('감사 기록 한 건: 수행자 id·역할, 동작, 대상, 이전(없음)/이후(DRAFT), 시각', () => {
    const world = newWorld();
    const record = createDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, kind, baseContent(kind));
    expect(world.repo.listAuditLog()).toEqual([
      {
        id: 'TEST_FIXTURE_AUDIT_1',
        actorId: 'TEST_FIXTURE_RV_AUTHOR',
        role: 'RV',
        action: 'ITEM_CREATE_DRAFT',
        target: `${kind}/${record.ref.id}/${record.ref.version}`,
        beforeVersion: null,
        afterVersion: 'DRAFT',
        reason: null,
        at: world.clock.now(),
      },
    ]);
  });

  it.each([TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1])('역할 %o 는 만들 수 없다 (ROLE_NOT_PERMITTED, 저장소 전후 비교가 같다)', (actor) => {
    const world = newWorld();
    const before = snapshotOf(world.repo);
    expect(catchDomainError(() => createDraft(world.deps, actor, kind, baseContent(kind))).code).toBe('ROLE_NOT_PERMITTED');
    expect(snapshotOf(world.repo)).toEqual(before);
  });

  it('같은 (종류, id, 버전)을 다시 만들면 내용이 같아도 DUPLICATE_KEY 이고 아무것도 바뀌지 않는다', () => {
    const world = newWorld();
    createDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, kind, baseContent(kind));
    const before = snapshotOf(world.repo);
    expect(catchDomainError(() => createDraft(world.deps, TEST_FIXTURE_RV_APPROVER, kind, baseContent(kind))).code).toBe('DUPLICATE_KEY');
    expect(snapshotOf(world.repo)).toEqual(before);
  });

  it.each([
    ['id', ''],
    ['id', '   '],
    ['version', ''],
    ['version', '\t'],
  ])('%s 가 비었거나 공백뿐(%j)이면 INVALID_INPUT 이고 아무것도 바뀌지 않는다', (field, value) => {
    const world = newWorld();
    const before = snapshotOf(world.repo);
    const error = catchDomainError(() => createDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, kind, { ...baseContent(kind), [field]: value }));
    expect(error.code).toBe('INVALID_INPUT');
    expect(error.defects).toEqual([{ code: 'EMPTY', path: field }]);
    expect(snapshotOf(world.repo)).toEqual(before);
  });

  it('입력 내용을 바꾸지 않고, 돌려준 값이나 입력을 나중에 고쳐도 저장된 값은 그대로다', () => {
    const world = newWorld();
    const content = baseContent(kind);
    const copy = structuredClone(content);
    const record = createDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, kind, content);
    expect(content).toEqual(copy);
    (content as Loose).validity = { from: 'MUTATED', to: 'MUTATED' };
    (record.content as Loose).validity = { from: 'MUTATED', to: 'MUTATED' };
    expect((world.repo.getItemVersion(record.ref)?.content as Loose).validity).toEqual((copy as Loose).validity);
  });
});

describe('초안 작성: 내용 해시는 서비스가 엔진의 정규화 함수로 봉인한다', () => {
  it.each(['PROFILE', 'DOCUMENT_RULE_SET'] as const)('%s : 호출자가 넘긴 해시가 틀려도 저장된 해시는 내용과 일치한다', (kind) => {
    const world = newWorld();
    const record = createDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, kind, { ...baseContent(kind), contentHash: 'TEST_FIXTURE_WRONG_HASH' });
    expect((record.content as Loose).contentHash).toBe(sealedHash(kind, record.content as Loose));
    expect((record.content as Loose).contentHash).not.toBe('TEST_FIXTURE_WRONG_HASH');
  });

  it('매핑 내용에는 내용 해시도, 승인 시점의 지문도 없다', () => {
    const world = newWorld();
    const record = createDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, 'MAPPING', baseContent('MAPPING'));
    expect(Object.keys(record.content)).not.toContain('contentHash');
    expect(Object.keys(record.content)).not.toContain('approvedFingerprint');
  });
});

describe('매핑 초안은 HA 가 만들 수 없다 (소유자 결정 #34)', () => {
  it('HA 의 매핑 초안은 ROLE_NOT_PERMITTED 이고 저장소 전후 비교가 같다', () => {
    const world = newWorld();
    const before = snapshotOf(world.repo);
    expect(catchDomainError(() => createDraft(world.deps, TEST_FIXTURE_HA_1, 'MAPPING', baseContent('MAPPING'))).code).toBe('ROLE_NOT_PERMITTED');
    expect(snapshotOf(world.repo)).toEqual(before);
    expect(world.repo.listItemVersions('MAPPING')).toEqual([]);
  });
});

describe.each(ITEM_KINDS)('초안 수정 (%s)', (kind) => {
  it('DRAFT 일 때 내용이 바뀌고 작성자·작성 시각·상태·상태 이력은 그대로이며 감사 기록에 수정자·시각·사유가 남는다', () => {
    const world = newWorld();
    const created = createDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, kind, baseContent(kind));
    const stateBefore = world.repo.getItemState(created.ref);
    world.clock.set('2026-10-17T01:02:03.000Z');
    const changed = hashRelevantEdit(kind, created.content as Loose);
    const edited = editDraft(world.deps, TEST_FIXTURE_RV_APPROVER, created.ref, changed as never, 'TEST_FIXTURE 수정 사유');

    expect(edited.authorId).toBe('TEST_FIXTURE_RV_AUTHOR');
    expect(edited.createdAt).toBe(created.createdAt);
    expect(world.repo.getItemVersion(created.ref)).toEqual(edited);
    // 내용 해시를 뺀 나머지 내용은 호출자가 넘긴 그대로다.
    const { contentHash: _storedHash, ...storedRest } = edited.content as Loose;
    const { contentHash: _passedHash, ...passedRest } = changed;
    expect(storedRest).toEqual(passedRest);
    expect(world.repo.getItemState(created.ref)).toEqual(stateBefore);

    const entry = world.repo.listAuditLog().at(-1);
    expect(entry).toMatchObject({
      actorId: 'TEST_FIXTURE_RV_APPROVER',
      role: 'RV',
      action: 'ITEM_EDIT_DRAFT',
      target: `${kind}/${created.ref.id}/${created.ref.version}`,
      reason: 'TEST_FIXTURE 수정 사유',
      at: '2026-10-17T01:02:03.000Z',
    });
    // 이전/이후는 수정 전후 내용의 정본 해시다 (같은 버전 라벨 안에서 일어난 변경을 구분하려는 것).
    expect(entry?.beforeVersion).toBe(canonicalDigest(created.content));
    expect(entry?.afterVersion).toBe(canonicalDigest(edited.content));
    expect(entry?.beforeVersion).not.toBe(entry?.afterVersion);
  });

  it('사유는 null 이어도 된다 (사유를 남기는 것이지 필수 조건이 아니다) [문서에 없음]', () => {
    const world = newWorld();
    const created = createDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, kind, baseContent(kind));
    editDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, created.ref, hashRelevantEdit(kind, created.content as Loose) as never, null);
    expect(world.repo.listAuditLog().at(-1)?.reason).toBeNull();
  });

  it.each([TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1])('역할 %o 는 고칠 수 없다 (ROLE_NOT_PERMITTED, 전후 비교가 같다)', (actor) => {
    const world = newWorld();
    const created = createDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, kind, baseContent(kind));
    const before = snapshotOf(world.repo);
    expect(catchDomainError(() => editDraft(world.deps, actor, created.ref, hashRelevantEdit(kind, created.content as Loose) as never, null)).code).toBe('ROLE_NOT_PERMITTED');
    expect(snapshotOf(world.repo)).toEqual(before);
  });

  it('없는 항목은 NOT_FOUND 이다', () => {
    const world = newWorld();
    const before = snapshotOf(world.repo);
    const ref = { kind, id: 'TEST_FIXTURE_NOPE', version: 'v1' };
    expect(catchDomainError(() => editDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, ref, { ...baseContent(kind), id: 'TEST_FIXTURE_NOPE' }, null)).code).toBe('NOT_FOUND');
    expect(snapshotOf(world.repo)).toEqual(before);
  });

  it.each(['id', 'version'])('내용의 %s 가 참조와 다르면 REF_CONTENT_MISMATCH 이다 (정체성은 고칠 수 없다)', (field) => {
    const world = newWorld();
    const created = createDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, kind, baseContent(kind));
    const before = snapshotOf(world.repo);
    const error = catchDomainError(() => editDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, created.ref, { ...baseContent(kind), [field]: 'TEST_FIXTURE_OTHER' }, null));
    expect(error.code).toBe('REF_CONTENT_MISMATCH');
    expect(snapshotOf(world.repo)).toEqual(before);
  });

  it.each(ALL_STATES.filter((state) => state !== 'DRAFT'))('상태가 %s 이면 STATE_CONFLICT 이고 내용·상태·감사 기록이 그대로다 (DRAFT 를 떠난 버전은 불변)', (state: LifecycleState) => {
    const world = newWorld();
    const ref = itemInState(world, kind, state);
    const before = snapshotOf(world.repo);
    const error = catchDomainError(() => editDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, ref, hashRelevantEdit(kind, baseContent(kind)) as never, 'TEST_FIXTURE'));
    expect(error.code).toBe('STATE_CONFLICT');
    expect(error.message).toContain(state);
    expect(snapshotOf(world.repo)).toEqual(before);
  });

  it('제출한 뒤에는 고칠 수 없고, 제출 전에 고친 내용이 그대로 남는다', () => {
    const world = newWorld();
    const created = createDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, kind, baseContent(kind));
    const edited = editDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, created.ref, hashRelevantEdit(kind, created.content as Loose) as never, null);
    world.repo.recordItemTransition(created.ref, {
      from: 'DRAFT',
      to: 'REVIEW_REQUESTED',
      actor: TEST_FIXTURE_RV_AUTHOR,
      at: 'T',
      reason: null,
      approverAfter: null,
      approvedFingerprintAfter: null,
    });
    expect(catchDomainError(() => editDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, created.ref, created.content as never, null)).code).toBe('STATE_CONFLICT');
    expect(world.repo.getItemVersion(created.ref)).toEqual(edited);
  });
});

describe('초안 수정: 내용 해시를 다시 봉인한다', () => {
  it.each(['PROFILE', 'DOCUMENT_RULE_SET'] as const)('%s : 내용이 바뀌면 해시도 새 내용에 맞게 바뀐다', (kind) => {
    const world = newWorld();
    const created = createDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, kind, baseContent(kind));
    const edited = editDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, created.ref, hashRelevantEdit(kind, created.content as Loose) as never, null);
    expect((edited.content as Loose).contentHash).toBe(sealedHash(kind, edited.content as Loose));
    expect((edited.content as Loose).contentHash).not.toBe((created.content as Loose).contentHash);
  });
});

describe.each(ITEM_KINDS)('다음 버전 초안 (%s)', (kind) => {
  it.each(ALL_STATES)('원본이 %s 여도 사본이 새 버전 라벨의 DRAFT 로 만들어지고 원본은 그대로다', (state) => {
    const world = newWorld();
    const sourceRef = itemInState(world, kind, state);
    const sourceContent = world.repo.getItemVersion(sourceRef);
    const sourceState = world.repo.getItemState(sourceRef);
    world.clock.set('2026-10-18T00:00:00.000Z');

    const next = createNextDraft(world.deps, TEST_FIXTURE_RV_APPROVER, sourceRef, 'v2');

    expect(next.ref).toEqual({ kind, id: sourceRef.id, version: 'v2' });
    expect(next.authorId).toBe('TEST_FIXTURE_RV_APPROVER');
    expect(next.createdAt).toBe('2026-10-18T00:00:00.000Z');
    const { contentHash: _nextHash, version: nextVersion, ...nextRest } = next.content as Loose;
    const { contentHash: _sourceHash, version: sourceVersion, ...sourceRest } = (sourceContent?.content ?? {}) as Loose;
    expect(nextRest).toEqual(sourceRest);
    expect(nextVersion).toBe('v2');
    expect(sourceVersion).toBe(sourceRef.version);
    expect(world.repo.getItemState(next.ref)?.state).toBe('DRAFT');
    expect(world.repo.getItemState(next.ref)?.approver).toBeNull();
    expect(world.repo.getItemState(next.ref)?.approvedFingerprint).toBeNull();
    // 원본의 내용과 상태는 그대로다 (규칙은 덮어쓰지 않고 새 버전을 낸다).
    expect(world.repo.getItemVersion(sourceRef)).toEqual(sourceContent);
    expect(world.repo.getItemState(sourceRef)).toEqual(sourceState);
  });

  it('감사 기록에 수행자·새 버전 대상·원본 출처가 남는다', () => {
    const world = newWorld();
    const sourceRef = itemInState(world, kind, 'REJECTED');
    createNextDraft(world.deps, TEST_FIXTURE_RV_APPROVER, sourceRef, 'v2');
    expect(world.repo.listAuditLog().at(-1)).toMatchObject({
      actorId: 'TEST_FIXTURE_RV_APPROVER',
      role: 'RV',
      action: 'ITEM_CREATE_NEXT_VERSION',
      target: `${kind}/${sourceRef.id}/v2`,
      beforeVersion: null,
      afterVersion: 'DRAFT',
      reason: `COPY_OF:${kind}/${sourceRef.id}/${sourceRef.version}`,
    });
  });

  it('같은 새 버전 라벨을 두 번 만들면 두 번째는 DUPLICATE_KEY 이고 첫 사본을 덮어쓰지 않는다', () => {
    const world = newWorld();
    const sourceRef = itemInState(world, kind, 'SUSPENDED');
    const first = createNextDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, sourceRef, 'v2');
    const before = snapshotOf(world.repo);
    expect(catchDomainError(() => createNextDraft(world.deps, TEST_FIXTURE_RV_APPROVER, sourceRef, 'v2')).code).toBe('DUPLICATE_KEY');
    expect(snapshotOf(world.repo)).toEqual(before);
    expect(world.repo.getItemVersion(first.ref)).toEqual(first);
  });

  it('원본과 같은 라벨은 DUPLICATE_KEY 이다', () => {
    const world = newWorld();
    const sourceRef = itemInState(world, kind, 'REJECTED');
    const before = snapshotOf(world.repo);
    expect(catchDomainError(() => createNextDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, sourceRef, sourceRef.version)).code).toBe('DUPLICATE_KEY');
    expect(snapshotOf(world.repo)).toEqual(before);
  });

  it.each(['', '  '])('새 버전 라벨이 비었거나 공백뿐(%j)이면 INVALID_INPUT 이다', (label) => {
    const world = newWorld();
    const sourceRef = itemInState(world, kind, 'REJECTED');
    const before = snapshotOf(world.repo);
    const error = catchDomainError(() => createNextDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, sourceRef, label));
    expect(error.code).toBe('INVALID_INPUT');
    expect(error.defects).toEqual([{ code: 'EMPTY', path: 'version' }]);
    expect(snapshotOf(world.repo)).toEqual(before);
  });

  it('원본이 없으면 NOT_FOUND, HA·PO 는 ROLE_NOT_PERMITTED 이다', () => {
    const world = newWorld();
    const before = snapshotOf(world.repo);
    expect(catchDomainError(() => createNextDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, { kind, id: 'TEST_FIXTURE_NOPE', version: 'v1' }, 'v2')).code).toBe('NOT_FOUND');
    const sourceRef = itemInState(world, kind, 'REJECTED');
    const mid = snapshotOf(world.repo);
    for (const actor of [TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1]) {
      expect(catchDomainError(() => createNextDraft(world.deps, actor, sourceRef, 'v2')).code).toBe('ROLE_NOT_PERMITTED');
    }
    expect(snapshotOf(world.repo)).toEqual(mid);
    expect(before).not.toEqual(mid);
  });

  it('REJECTED 원본은 계속 REJECTED 이고 새 버전만 다시 DRAFT 에서 시작한다', () => {
    const world = newWorld();
    const sourceRef = itemInState(world, kind, 'REJECTED');
    const next = createNextDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, sourceRef, 'v2');
    expect(world.repo.getItemState(sourceRef)?.state).toBe('REJECTED');
    expect(world.repo.getItemState(next.ref)?.state).toBe('DRAFT');
  });
});

describe('다음 버전 초안: 버전 라벨이 해시 입력에 들므로 사본의 해시를 다시 봉인한다', () => {
  it.each(['PROFILE', 'DOCUMENT_RULE_SET'] as const)('%s : 사본의 해시는 새 버전 라벨 기준이며 원본 해시와 다르다', (kind) => {
    const world = newWorld();
    const sourceRef = itemInState(world, kind, 'REJECTED');
    const source = world.repo.getItemVersion(sourceRef);
    const next = createNextDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, sourceRef, 'v2');
    expect((next.content as Loose).contentHash).toBe(sealedHash(kind, next.content as Loose));
    expect((next.content as Loose).contentHash).not.toBe((source?.content as Loose).contentHash);
  });
});
