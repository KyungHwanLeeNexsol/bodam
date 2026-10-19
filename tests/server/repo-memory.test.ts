import { describe, expect, it } from 'vitest';
import type { ItemVersionRef } from '../../src/server/domain/items';
import { MemoryRepository } from '../../src/server/repo/memory/memory-repository';
import type { ReadQueryName } from '../../src/server/repo/memory/read-spy';
import { TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1, TEST_FIXTURE_RV_APPROVER, TEST_FIXTURE_RV_AUTHOR } from '../fixtures/server/actors.fixture';
import {
  TEST_FIXTURE_NOW,
  makeAuditEntry,
  makeBundleVersion,
  makeCatalogVersion,
  makeClinic,
  makeCommonBaseFee,
  makeIdlePolicy,
  makeInsurer,
  makePolicySource,
  makeReviewRequest,
  makeScope,
  makeStatusEvent,
  makeTreatment,
  makeTreatmentVersion,
} from '../fixtures/server/entities.fixture';
import { catchDomainError } from '../fixtures/server/errors.fixture';
import { documentRuleSetRecord, mappingRecord, profileRecord } from '../fixtures/server/items.fixture';
import { newRepo, seedWorld, snapshotOf, transitionInput } from '../fixtures/server/repo.fixture';

// 저장소 인터페이스의 메모리 구현 시험: 트랜잭션, 불변 버전, 추가 전용 기록, 깊은 복사 격리,
// 항목 상태 일괄 읽기, 읽기 감시, 결정적 정렬, 참조 무결성.

/** 한 트랜잭션 안에서 여러 종류의 저장소 쓰기를 한다. 되돌림 시험에서 전후 비교가 의미를 갖게 일부러 넓게 쓴다. */
function mutateEverything(repo: MemoryRepository, world: ReturnType<typeof seedWorld>): void {
  const newProfile = profileRecord({ id: 'TEST_PROFILE_TX', version: 'v1' });
  repo.saveClinic(makeClinic({ id: 'TEST_FIXTURE_CLINIC_TX', slug: 'test-fixture-clinic-tx' }));
  repo.putItemVersion(newProfile);
  repo.recordItemTransition(newProfile.ref, transitionInput());
  repo.recordItemTransition(world.profileRef, transitionInput({ from: 'DRAFT', to: 'REVIEW_REQUESTED', actor: TEST_FIXTURE_RV_AUTHOR, reason: 'TEST_FIXTURE 제출' }));
  repo.putRuleBundleVersion(makeBundleVersion({ id: 'TEST_FIXTURE_BUNDLE_TX', itemRefs: [newProfile.ref] }));
  repo.appendBundleStatusEvent(makeStatusEvent({ bundleId: 'TEST_FIXTURE_BUNDLE_TX' }));
  repo.appendBundleStatusEvent(makeStatusEvent({ bundleId: world.bundleId, status: 'SUSPENDED', previousStatus: 'ACTIVE', reason: 'TEST_FIXTURE 중지' }));
  repo.assignClinicRuleScope(makeScope({ ruleBundleVersionId: 'TEST_FIXTURE_BUNDLE_TX' }));
  repo.saveIdlePolicy(makeIdlePolicy({ completionHoldSeconds: 30 }));
  repo.appendAuditLog(makeAuditEntry({ id: 'TEST_FIXTURE_AUDIT_TX' }));
}

describe('트랜잭션', () => {
  it('성공하면 쓴 내용이 남고 콜백의 반환값을 돌려준다', () => {
    const repo = newRepo();
    const result = repo.transaction(() => {
      repo.saveClinic(makeClinic());
      return 'TEST_FIXTURE_RESULT';
    });
    expect(result).toBe('TEST_FIXTURE_RESULT');
    expect(repo.getClinic(TEST_FIXTURE_CLINIC_ID)).toEqual(makeClinic());
  });

  it('던지면 모든 쓰기가 되돌려지고 같은 오류가 다시 던져진다 (감사 기록·묶음 상태 사건·상태 전이 포함)', () => {
    const repo = newRepo();
    const world = seedWorld(repo);
    const before = snapshotOf(repo);
    const boom = new Error('TEST_FIXTURE 되돌림');
    let caught: unknown;
    try {
      repo.transaction(() => {
        mutateEverything(repo, world);
        throw boom;
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(boom);
    expect(snapshotOf(repo)).toEqual(before);
    expect(repo.listAuditLog()).toHaveLength(1);
    expect(repo.listBundleStatusEvents(world.bundleId)).toHaveLength(1);
    expect(repo.getItemState(world.profileRef)?.history).toHaveLength(1);
  });

  it('쓰기가 한 번 성공한 뒤 도메인 오류로 중간에 실패해도 앞의 쓰기가 남지 않는다', () => {
    const repo = newRepo();
    seedWorld(repo);
    const before = snapshotOf(repo);
    const error = catchDomainError(() =>
      repo.transaction(() => {
        repo.saveClinic(makeClinic({ id: 'TEST_FIXTURE_CLINIC_TX', slug: 'test-fixture-clinic-tx' }));
        repo.appendAuditLog(makeAuditEntry({ id: 'TEST_FIXTURE_AUDIT_TX' }));
        repo.saveTreatment(makeTreatment({ id: 'TEST_FIXTURE_TREATMENT_X', clinicId: 'TEST_FIXTURE_CLINIC_MISSING' }));
      }),
    );
    expect(error.code).toBe('NOT_FOUND');
    expect(snapshotOf(repo)).toEqual(before);
  });

  it('중첩 호출은 바깥 트랜잭션에 합류한다: 바깥이 던지면 안쪽에서 성공한 쓰기도 함께 사라진다', () => {
    const repo = newRepo();
    const world = seedWorld(repo);
    const before = snapshotOf(repo);
    expect(() =>
      repo.transaction(() => {
        repo.transaction(() => {
          mutateEverything(repo, world);
        });
        expect(repo.getClinic('TEST_FIXTURE_CLINIC_TX')).not.toBeNull();
        throw new Error('바깥에서 실패');
      }),
    ).toThrow('바깥에서 실패');
    expect(snapshotOf(repo)).toEqual(before);
  });

  it('중첩 호출이 성공하면 바깥이 끝날 때 함께 확정된다', () => {
    const repo = newRepo();
    repo.transaction(() => {
      repo.saveClinic(makeClinic());
      repo.transaction(() => {
        repo.saveInsurer(makeInsurer());
      });
    });
    expect(repo.getClinic(TEST_FIXTURE_CLINIC_ID)).not.toBeNull();
    expect(repo.getInsurer(makeInsurer().id)).not.toBeNull();
  });

  it('안쪽이 던지고 바깥이 오류를 잡아 계속하면 안쪽 쓰기만 되돌려지고 바깥의 앞뒤 쓰기는 남는다', () => {
    const repo = newRepo();
    repo.transaction(() => {
      repo.saveClinic(makeClinic());
      try {
        repo.transaction(() => {
          repo.saveInsurer(makeInsurer());
          throw new Error('안쪽 실패');
        });
      } catch {
        // 바깥이 삼켰다.
      }
      repo.putPolicySource(makePolicySource());
    });
    expect(repo.getClinic(TEST_FIXTURE_CLINIC_ID)).not.toBeNull();
    expect(repo.getInsurer(makeInsurer().id)).toBeNull();
    expect(repo.getPolicySource(makePolicySource().id)).not.toBeNull();
  });

  it('콜백이 약속(Promise)을 돌려주면 동기 전용 계약 위반으로 거절하고 되돌린다', () => {
    const repo = newRepo();
    const before = snapshotOf(repo);
    const run = () =>
      repo.transaction(() => {
        repo.saveClinic(makeClinic());
        return Promise.resolve(1);
      });
    expect(run).toThrow(TypeError);
    expect(snapshotOf(repo)).toEqual(before);
  });

  it('되돌린 뒤 저장소는 계속 쓸 수 있다', () => {
    const repo = newRepo();
    expect(() =>
      repo.transaction(() => {
        repo.saveClinic(makeClinic());
        throw new Error('x');
      }),
    ).toThrow('x');
    repo.saveClinic(makeClinic());
    expect(repo.getClinic(TEST_FIXTURE_CLINIC_ID)?.slug).toBe('test-fixture-clinic-1');
  });
});

describe('바뀌지 않는 버전 (write-once)', () => {
  const identicalRewrite: Array<[string, (repo: MemoryRepository) => void, (repo: MemoryRepository) => void]> = [
    ['항목 버전', (repo) => repo.putItemVersion(profileRecord()), (repo) => repo.putItemVersion({ ...profileRecord(), content: { ...profileRecord().content, validity: { from: '2020-01-01', to: '2020-12-31' } } })],
    ['항목 버전: 작성자만 다름', (repo) => repo.putItemVersion(profileRecord()), (repo) => repo.putItemVersion({ ...profileRecord(), authorId: 'TEST_FIXTURE_OTHER_AUTHOR' })],
    ['항목 버전: 생성 시각만 다름', (repo) => repo.putItemVersion(profileRecord()), (repo) => repo.putItemVersion({ ...profileRecord(), createdAt: '2030-01-01T00:00:00.000Z' })],
    ['매핑 버전', (repo) => repo.putItemVersion(mappingRecord()), (repo) => repo.putItemVersion(mappingRecord('TEST_FIXTURE_TREATMENT_1', { decision: 'EXCLUDED' }))],
    ['서류 규칙 묶음 버전', (repo) => repo.putItemVersion(documentRuleSetRecord()), (repo) => repo.putItemVersion({ ...documentRuleSetRecord(), content: { ...documentRuleSetRecord().content, rules: [] } })],
    ['치료 버전', (repo) => repo.putTreatmentVersion(makeTreatmentVersion()), (repo) => repo.putTreatmentVersion(makeTreatmentVersion({ patientAmount: 1 }))],
    ['치료 버전: 행위 코드 순서만 다름', (repo) => repo.putTreatmentVersion(makeTreatmentVersion()), (repo) => repo.putTreatmentVersion(makeTreatmentVersion({ procedureCodes: ['TEST_FIXTURE_PROC_B', 'TEST_FIXTURE_PROC_A'] }))],
    ['공통 기본비용', (repo) => repo.putCommonBaseFee(makeCommonBaseFee()), (repo) => repo.putCommonBaseFee(makeCommonBaseFee({ amount: 1 }))],
    ['카탈로그 버전', (repo) => repo.putCatalogVersion(makeCatalogVersion()), (repo) => repo.putCatalogVersion(makeCatalogVersion({ baseFeeIds: [] }))],
    ['약관 출처', (repo) => repo.putPolicySource(makePolicySource()), (repo) => repo.putPolicySource(makePolicySource({ clauseOrPage: 'TEST_FIXTURE_OTHER' }))],
    [
      '규칙 묶음 버전',
      (repo) => repo.putRuleBundleVersion(makeBundleVersion({ itemRefs: [profileRecord().ref, mappingRecord().ref, documentRuleSetRecord().ref] })),
      (repo) => repo.putRuleBundleVersion(makeBundleVersion({ itemRefs: [profileRecord().ref, mappingRecord().ref, documentRuleSetRecord().ref], contentHash: 'TEST_FIXTURE_OTHER_HASH' })),
    ],
    [
      '규칙 묶음 버전: 항목 참조 순서만 다름',
      (repo) => repo.putRuleBundleVersion(makeBundleVersion({ itemRefs: [profileRecord().ref, mappingRecord().ref, documentRuleSetRecord().ref] })),
      (repo) => repo.putRuleBundleVersion(makeBundleVersion({ itemRefs: [mappingRecord().ref, profileRecord().ref, documentRuleSetRecord().ref] })),
    ],
  ];

  it.each(identicalRewrite)('%s: 같은 내용을 다시 쓰면 멱등(아무것도 바뀌지 않음)이다', (_label, write) => {
    const repo = newRepo();
    seedWorld(repo);
    const before = snapshotOf(repo);
    expect(() => write(repo)).not.toThrow();
    expect(snapshotOf(repo)).toEqual(before);
  });

  it.each(identicalRewrite)('%s: 같은 키에 다른 내용을 쓰면 IMMUTABLE_VERSION 이고 저장소는 그대로다', (_label, _write, rewrite) => {
    const repo = newRepo();
    seedWorld(repo);
    const before = snapshotOf(repo);
    expect(catchDomainError(() => rewrite(repo)).code).toBe('IMMUTABLE_VERSION');
    expect(snapshotOf(repo)).toEqual(before);
  });

  it('같은 id 의 다른 버전은 따로 쓸 수 있고 먼저 쓴 버전은 그대로다', () => {
    const repo = newRepo();
    const v1 = profileRecord({ version: 'v1' });
    const v2 = profileRecord({ version: 'v2' });
    repo.putItemVersion(v1);
    repo.putItemVersion(v2);
    expect(repo.getItemVersion(v1.ref)).toEqual(v1);
    expect(repo.getItemVersion(v2.ref)).toEqual(v2);
  });

  it('종류가 다르면 같은 id·버전이어도 다른 키다', () => {
    const repo = newRepo();
    const profile = profileRecord({ id: 'TEST_FIXTURE_SAME_ID', version: 'v1' });
    const rules = documentRuleSetRecord({ id: 'TEST_FIXTURE_SAME_ID', version: 'v1' });
    repo.putItemVersion(profile);
    repo.putItemVersion(rules);
    expect(repo.getItemVersion(profile.ref)?.ref.kind).toBe('PROFILE');
    expect(repo.getItemVersion(rules.ref)?.ref.kind).toBe('DOCUMENT_RULE_SET');
  });

  it('저장소에는 삭제·초기화 동작이 없고, 내용을 덮어쓰는 동작은 초안 수정(reviseDraftItemVersion) 하나뿐이다', () => {
    const repo = newRepo();
    const names = new Set<string>();
    for (let proto: object | null = Object.getPrototypeOf(repo) as object | null; proto !== null && proto !== Object.prototype; proto = Object.getPrototypeOf(proto) as object | null) {
      for (const name of Object.getOwnPropertyNames(proto)) {
        names.add(name);
      }
    }
    for (const name of Object.keys(repo)) {
      names.add(name);
    }
    for (const name of names) {
      expect(name, `삭제성 이름 ${name}`).not.toMatch(/delete|remove|clear|drop|truncate|purge|destroy|wipe|update(?!Version)/i);
    }
    // 불변 내용을 덮어쓸 수 있는 이름은 초안 수정 하나뿐이다 (DRAFT 에만 듣는다는 검사는 repo-lifecycle.test.ts).
    expect([...names].filter((name) => /overwrite|replace|revise|rewrite|upsert/i.test(name))).toEqual(['reviseDraftItemVersion']);
    // 위 검사가 빈 검사가 아님을 확인한다.
    expect(names.has('putItemVersion')).toBe(true);
    expect(names.has('transaction')).toBe(true);
  });
});

describe('추가 전용 기록', () => {
  it('감사 기록은 쓴 순서대로 쌓이고 같은 id 를 다시 쓸 수 없다', () => {
    const repo = newRepo();
    repo.appendAuditLog(makeAuditEntry({ id: 'TEST_FIXTURE_AUDIT_B' }));
    repo.appendAuditLog(makeAuditEntry({ id: 'TEST_FIXTURE_AUDIT_A' }));
    expect(repo.listAuditLog().map((entry) => entry.id)).toEqual(['TEST_FIXTURE_AUDIT_B', 'TEST_FIXTURE_AUDIT_A']);
    const before = snapshotOf(repo);
    expect(catchDomainError(() => repo.appendAuditLog(makeAuditEntry({ id: 'TEST_FIXTURE_AUDIT_B', action: 'OVERWRITE' }))).code).toBe('DUPLICATE_KEY');
    expect(snapshotOf(repo)).toEqual(before);
  });

  it('새 기록을 더해도 앞의 기록은 그대로다 (접두 보존)', () => {
    const repo = newRepo();
    repo.appendAuditLog(makeAuditEntry({ id: 'TEST_FIXTURE_AUDIT_1' }));
    const first = repo.listAuditLog();
    repo.appendAuditLog(makeAuditEntry({ id: 'TEST_FIXTURE_AUDIT_2' }));
    expect(repo.listAuditLog().slice(0, 1)).toEqual(first);
    expect(repo.listAuditLog()).toHaveLength(2);
  });

  it('항목 상태 전이 기록은 쌓이기만 하고 이전 전이를 바꿀 수 없다', () => {
    const repo = newRepo();
    const record = profileRecord();
    repo.putItemVersion(record);
    repo.recordItemTransition(record.ref, transitionInput({ at: 'T0' }));
    const afterFirst = repo.getItemState(record.ref)?.history;
    repo.recordItemTransition(record.ref, transitionInput({ from: 'DRAFT', to: 'REVIEW_REQUESTED', at: 'T1', reason: 'TEST_FIXTURE 제출' }));
    repo.recordItemTransition(record.ref, transitionInput({ from: 'REVIEW_REQUESTED', to: 'REJECTED', actor: TEST_FIXTURE_RV_APPROVER, at: 'T2', reason: 'TEST_FIXTURE 반려 사유' }));
    const history = repo.getItemState(record.ref)?.history ?? [];
    expect(history.map((step) => [step.from, step.to])).toEqual([
      [null, 'DRAFT'],
      ['DRAFT', 'REVIEW_REQUESTED'],
      ['REVIEW_REQUESTED', 'REJECTED'],
    ]);
    expect(history.slice(0, 1)).toEqual(afterFirst);
    expect(history[2]).toEqual({ from: 'REVIEW_REQUESTED', to: 'REJECTED', actorId: 'TEST_FIXTURE_RV_APPROVER', role: 'RV', at: 'T2', reason: 'TEST_FIXTURE 반려 사유', approver: null, approvedFingerprint: null });
  });

  it('돌려받은 기록을 고쳐도 저장소의 기록은 그대로다', () => {
    const repo = newRepo();
    repo.appendAuditLog(makeAuditEntry());
    const listed = repo.listAuditLog();
    listed.pop();
    listed.push(makeAuditEntry({ id: 'FORGED' }));
    expect(repo.listAuditLog().map((entry) => entry.id)).toEqual(['TEST_FIXTURE_AUDIT_1']);
  });
});

describe('묶음 가용성 사건 (RuleBundleStatusEvent)', () => {
  function withBundle() {
    const repo = newRepo();
    const world = seedWorld(repo);
    return { repo, world };
  }

  it('현재 상태는 마지막 사건이고 사건이 없으면 null 이다', () => {
    const repo = newRepo();
    expect(repo.getBundleStatus('TEST_FIXTURE_BUNDLE_1')).toBeNull();
    const { repo: seeded, world } = withBundle();
    expect(seeded.getBundleStatus(world.bundleId)).toBe('ACTIVE');
    seeded.appendBundleStatusEvent(makeStatusEvent({ status: 'SUSPENDED', previousStatus: 'ACTIVE', reason: 'TEST_FIXTURE 중지', at: 'T1' }));
    expect(seeded.getBundleStatus(world.bundleId)).toBe('SUSPENDED');
    expect(seeded.listBundleStatusEvents(world.bundleId).map((event) => event.status)).toEqual(['ACTIVE', 'SUSPENDED']);
  });

  it('중지는 묶음 기록과 항목 상태, 병원 범위를 바꾸지 않는다', () => {
    const { repo, world } = withBundle();
    const bundleBefore = repo.getRuleBundleVersion(world.bundleId);
    const statesBefore = repo.readItemStates([world.profileRef, world.mappingRef, world.documentRuleSetRef]);
    const scopeBefore = repo.getClinicRuleScope(world.clinicId);
    repo.appendBundleStatusEvent(makeStatusEvent({ status: 'SUSPENDED', previousStatus: 'ACTIVE', reason: 'TEST_FIXTURE 중지' }));
    expect(repo.getRuleBundleVersion(world.bundleId)).toEqual(bundleBefore);
    expect(repo.readItemStates([world.profileRef, world.mappingRef, world.documentRuleSetRef])).toEqual(statesBefore);
    expect(repo.getClinicRuleScope(world.clinicId)).toEqual(scopeBefore);
    expect(repo.getClinicRuleScope(world.clinicId)?.ruleBundleVersionId).toBe(world.bundleId);
  });

  const brokenChains: Array<[string, Partial<ReturnType<typeof makeStatusEvent>>]> = [
    ['이미 사건이 있는데 다시 첫 사건(ACTIVE, 이전 없음)', { status: 'ACTIVE', previousStatus: null }],
    ['이미 ACTIVE 인데 ACTIVE 를 또 씀', { status: 'ACTIVE', previousStatus: 'ACTIVE' }],
    ['이전 상태를 SUSPENDED 로 잘못 적은 중지', { status: 'SUSPENDED', previousStatus: 'SUSPENDED' }],
    ['이전 상태를 비운 중지', { status: 'SUSPENDED', previousStatus: null }],
  ];

  it.each(brokenChains)('사슬이 어긋나면 STATE_CONFLICT: %s', (_label, change) => {
    const { repo } = withBundle();
    const before = snapshotOf(repo);
    expect(catchDomainError(() => repo.appendBundleStatusEvent(makeStatusEvent(change))).code).toBe('STATE_CONFLICT');
    expect(snapshotOf(repo)).toEqual(before);
  });

  const brokenFirstEvents: Array<[string, Partial<ReturnType<typeof makeStatusEvent>>]> = [
    ['첫 사건이 SUSPENDED', { status: 'SUSPENDED', previousStatus: null, reason: 'TEST_FIXTURE 중지' }],
    ['첫 사건인데 이전 상태가 ACTIVE', { status: 'ACTIVE', previousStatus: 'ACTIVE' }],
    ['첫 사건인데 이전 상태가 SUSPENDED', { status: 'ACTIVE', previousStatus: 'SUSPENDED' }],
  ];

  it.each(brokenFirstEvents)('사건이 하나도 없는 묶음의 첫 사건은 ACTIVE(이전 없음)여야 한다: %s', (_label, change) => {
    const repo = newRepo();
    const world = seedWorld(repo);
    repo.putRuleBundleVersion(makeBundleVersion({ id: 'TEST_FIXTURE_BUNDLE_2', itemRefs: [world.profileRef] }));
    const before = snapshotOf(repo);
    expect(catchDomainError(() => repo.appendBundleStatusEvent(makeStatusEvent({ bundleId: 'TEST_FIXTURE_BUNDLE_2', ...change }))).code).toBe('STATE_CONFLICT');
    expect(snapshotOf(repo)).toEqual(before);
    expect(repo.getBundleStatus('TEST_FIXTURE_BUNDLE_2')).toBeNull();
  });

  it('묶음마다 사건 사슬이 따로다', () => {
    const { repo, world } = withBundle();
    repo.putRuleBundleVersion(makeBundleVersion({ id: 'TEST_FIXTURE_BUNDLE_2', itemRefs: [world.profileRef] }));
    repo.appendBundleStatusEvent(makeStatusEvent({ bundleId: 'TEST_FIXTURE_BUNDLE_2' }));
    repo.appendBundleStatusEvent(makeStatusEvent({ status: 'SUSPENDED', previousStatus: 'ACTIVE', reason: 'TEST_FIXTURE 중지' }));
    expect(repo.getBundleStatus('TEST_FIXTURE_BUNDLE_1')).toBe('SUSPENDED');
    expect(repo.getBundleStatus('TEST_FIXTURE_BUNDLE_2')).toBe('ACTIVE');
  });

  it('SUSPENDED 뒤에는 어떤 사건도 쓸 수 없다 (같은 묶음 id 의 재활성화 거절)', () => {
    const { repo } = withBundle();
    repo.appendBundleStatusEvent(makeStatusEvent({ status: 'SUSPENDED', previousStatus: 'ACTIVE', reason: 'TEST_FIXTURE 중지' }));
    const before = snapshotOf(repo);
    for (const attempt of [
      makeStatusEvent({ status: 'ACTIVE', previousStatus: 'SUSPENDED' }),
      makeStatusEvent({ status: 'SUSPENDED', previousStatus: 'SUSPENDED' }),
      makeStatusEvent({ status: 'ACTIVE', previousStatus: null }),
    ]) {
      expect(catchDomainError(() => repo.appendBundleStatusEvent(attempt)).code).toBe('STATE_CONFLICT');
    }
    expect(snapshotOf(repo)).toEqual(before);
  });
});

describe('항목 상태 기록 (ItemStateRecord)', () => {
  it('항목 버전이 있어야 첫 전이(from=null)를 쓸 수 있다', () => {
    const repo = newRepo();
    const before = snapshotOf(repo);
    expect(catchDomainError(() => repo.recordItemTransition(profileRecord().ref, transitionInput())).code).toBe('NOT_FOUND');
    expect(snapshotOf(repo)).toEqual(before);
  });

  it('현재 상태와 from 이 다르면 STATE_CONFLICT 이고, 이미 상태가 있는데 from=null 이어도 마찬가지다', () => {
    const repo = newRepo();
    const record = profileRecord();
    repo.putItemVersion(record);
    repo.recordItemTransition(record.ref, transitionInput());
    const before = snapshotOf(repo);
    expect(catchDomainError(() => repo.recordItemTransition(record.ref, transitionInput({ from: 'APPROVED', to: 'PUBLISHED' }))).code).toBe('STATE_CONFLICT');
    expect(catchDomainError(() => repo.recordItemTransition(record.ref, transitionInput({ from: null, to: 'DRAFT' }))).code).toBe('STATE_CONFLICT');
    expect(snapshotOf(repo)).toEqual(before);
  });

  it('상태가 아직 없는 항목에 from 이 null 이 아닌 첫 전이는 거절한다', () => {
    const repo = newRepo();
    const record = profileRecord();
    repo.putItemVersion(record);
    expect(catchDomainError(() => repo.recordItemTransition(record.ref, transitionInput({ from: 'DRAFT', to: 'REVIEW_REQUESTED' }))).code).toBe('STATE_CONFLICT');
    expect(repo.getItemState(record.ref)).toBeNull();
  });

  it('전이는 현재 상태와 승인자 기록을 바꾸고 수행자 id·역할·시각·사유를 이력에 남긴다', () => {
    const repo = newRepo();
    const record = mappingRecord();
    repo.putItemVersion(record);
    repo.recordItemTransition(record.ref, transitionInput());
    repo.recordItemTransition(
      record.ref,
      transitionInput({
        from: 'DRAFT',
        to: 'APPROVED',
        actor: TEST_FIXTURE_RV_APPROVER,
        at: 'T9',
        reason: 'TEST_FIXTURE 승인',
        approverAfter: { approverId: TEST_FIXTURE_RV_APPROVER.id, approvedAt: 'T9' },
        approvedFingerprintAfter: 'TEST_FIXTURE_FP',
      }),
    );
    const state = repo.getItemState(record.ref);
    expect(state?.state).toBe('APPROVED');
    expect(state?.approver).toEqual({ approverId: 'TEST_FIXTURE_RV_APPROVER', approvedAt: 'T9' });
    expect(state?.approvedFingerprint).toBe('TEST_FIXTURE_FP');
    // 이력은 전이마다 그 전이 뒤의 승인자·지문을 남긴다 (재승인으로 현재 값이 바뀌어도 이전 값이 이력에 남는다).
    expect(state?.history.at(-1)).toEqual({
      from: 'DRAFT',
      to: 'APPROVED',
      actorId: 'TEST_FIXTURE_RV_APPROVER',
      role: 'RV',
      at: 'T9',
      reason: 'TEST_FIXTURE 승인',
      approver: { approverId: 'TEST_FIXTURE_RV_APPROVER', approvedAt: 'T9' },
      approvedFingerprint: 'TEST_FIXTURE_FP',
    });
  });

  it('항목 버전의 내용은 상태가 바뀌어도 그대로다 (내용과 상태가 따로 저장된다)', () => {
    const repo = newRepo();
    const record = profileRecord();
    repo.putItemVersion(record);
    repo.recordItemTransition(record.ref, transitionInput());
    const contentBefore = repo.getItemVersion(record.ref);
    repo.recordItemTransition(record.ref, transitionInput({ from: 'DRAFT', to: 'SUSPENDED', reason: 'TEST_FIXTURE' }));
    expect(repo.getItemVersion(record.ref)).toEqual(contentBefore);
    expect(Object.keys((contentBefore as { content: object }).content)).not.toContain('state');
    expect(Object.keys((contentBefore as { content: object }).content)).not.toContain('approver');
  });

  it('읽을 수 없는 항목의 상태 기록은 null 이다', () => {
    const repo = newRepo();
    expect(repo.getItemState(profileRecord().ref)).toBeNull();
  });
});

describe('항목 상태 일괄 읽기 (readItemStates)', () => {
  function seedThree() {
    const repo = newRepo();
    const world = seedWorld(repo);
    repo.recordItemTransition(world.profileRef, transitionInput({ from: 'DRAFT', to: 'SUSPENDED', reason: 'TEST_FIXTURE 중지' }));
    return { repo, world };
  }

  it('참조 목록을 한 번에 받아 같은 순서로 현재 상태를 돌려준다', () => {
    const { repo, world } = seedThree();
    const states = repo.readItemStates([world.documentRuleSetRef, world.profileRef, world.mappingRef]);
    expect(states.map((state) => state?.ref.kind)).toEqual(['DOCUMENT_RULE_SET', 'PROFILE', 'MAPPING']);
    expect(states.map((state) => state?.state)).toEqual(['DRAFT', 'SUSPENDED', 'DRAFT']);
  });

  it('없는 참조는 null 이고 중복 참조는 각각 답한다', () => {
    const { repo, world } = seedThree();
    const missing: ItemVersionRef = { kind: 'PROFILE', id: 'TEST_FIXTURE_MISSING', version: 'v1' };
    const states = repo.readItemStates([world.profileRef, missing, world.profileRef]);
    expect(states.map((state) => state?.state ?? null)).toEqual(['SUSPENDED', null, 'SUSPENDED']);
  });

  it('빈 목록은 빈 목록이다', () => {
    const { repo } = seedThree();
    expect(repo.readItemStates([])).toEqual([]);
  });

  it('각 항목은 ref·state·approver·approvedFingerprint 만 담고 이력은 담지 않는다', () => {
    const { repo, world } = seedThree();
    const [first] = repo.readItemStates([world.profileRef]);
    expect(Object.keys(first ?? {}).sort()).toEqual(['approvedFingerprint', 'approver', 'ref', 'state']);
  });

  it('목록 길이와 상관없이 읽기 한 번으로 센다', () => {
    const { repo, world } = seedThree();
    repo.spy.reset();
    repo.readItemStates([world.profileRef, world.mappingRef, world.documentRuleSetRef]);
    expect(repo.spy.counts.readItemStates).toBe(1);
  });

  it('호출한 쪽이 입력 참조 배열을 바꿔도 저장소에는 영향이 없다', () => {
    const { repo, world } = seedThree();
    const refs = [world.profileRef];
    repo.readItemStates(refs);
    expect(refs).toEqual([world.profileRef]);
  });
});

describe('읽기 감시 (spy)', () => {
  const reads: Array<[ReadQueryName, (repo: MemoryRepository, world: ReturnType<typeof seedWorld>) => unknown]> = [
    ['getClinic', (repo, w) => repo.getClinic(w.clinicId)],
    ['listClinics', (repo) => repo.listClinics()],
    ['getClinicCurrentCatalogVersion', (repo, w) => repo.getClinicCurrentCatalogVersion(w.clinicId)],
    ['getTreatment', (repo) => repo.getTreatment(makeTreatment().id)],
    ['listTreatments', (repo, w) => repo.listTreatments(w.clinicId)],
    ['getTreatmentVersion', (repo) => repo.getTreatmentVersion(makeTreatmentVersion().id)],
    ['listTreatmentVersions', (repo) => repo.listTreatmentVersions(makeTreatment().id)],
    ['getCommonBaseFee', (repo) => repo.getCommonBaseFee(makeCommonBaseFee().id)],
    ['listCommonBaseFeeVersions', (repo) => repo.listCommonBaseFeeVersions(makeCommonBaseFee().baseFeeId)],
    ['getCatalogVersion', (repo) => repo.getCatalogVersion(makeCatalogVersion().id)],
    ['listCatalogVersions', (repo, w) => repo.listCatalogVersions(w.clinicId)],
    ['getInsurer', (repo) => repo.getInsurer(makeInsurer().id)],
    ['listInsurers', (repo) => repo.listInsurers()],
    ['getPolicySource', (repo) => repo.getPolicySource(makePolicySource().id)],
    ['listPolicySources', (repo) => repo.listPolicySources()],
    ['getCoverageReviewRequest', (repo) => repo.getCoverageReviewRequest(makeReviewRequest().id)],
    ['listCoverageReviewRequests', (repo, w) => repo.listCoverageReviewRequests(w.clinicId)],
    ['getItemVersion', (repo, w) => repo.getItemVersion(w.profileRef)],
    ['listItemVersions', (repo) => repo.listItemVersions('PROFILE')],
    ['getItemState', (repo, w) => repo.getItemState(w.profileRef)],
    ['readItemStates', (repo, w) => repo.readItemStates([w.profileRef])],
    ['getRuleBundleVersion', (repo, w) => repo.getRuleBundleVersion(w.bundleId)],
    ['listRuleBundleVersions', (repo) => repo.listRuleBundleVersions()],
    ['getBundleStatus', (repo, w) => repo.getBundleStatus(w.bundleId)],
    ['listBundleStatusEvents', (repo, w) => repo.listBundleStatusEvents(w.bundleId)],
    ['getClinicRuleScope', (repo, w) => repo.getClinicRuleScope(w.clinicId)],
    ['listClinicRuleScopeHistory', (repo, w) => repo.listClinicRuleScopeHistory(w.clinicId)],
    ['getIdlePolicy', (repo, w) => repo.getIdlePolicy(w.clinicId)],
    ['listAuditLog', (repo) => repo.listAuditLog()],
  ];

  it('저장소의 읽기 메서드(get·list·read 로 시작)는 모두 이 표에 있다 (감시 누락 방지)', () => {
    const names = new Set<string>();
    for (const name of Object.getOwnPropertyNames(MemoryRepository.prototype)) {
      if (/^(get|list|read)[A-Z]/.test(name)) {
        names.add(name);
      }
    }
    expect([...names].sort()).toEqual(reads.map(([name]) => name).sort());
  });

  it.each(reads)('%s 를 한 번 부르면 그 이름의 카운터만 1 늘어난다', (name, call) => {
    const repo = newRepo();
    const world = seedWorld(repo);
    repo.spy.reset();
    call(repo, world);
    expect(repo.spy.counts[name]).toBe(1);
    const others = Object.entries(repo.spy.counts).filter(([key, value]) => key !== name && value !== 0);
    expect(others).toEqual([]);
  });

  it('쓰기와 상태 떠 내기(exportState)는 읽기 카운터를 올리지 않는다', () => {
    const repo = newRepo();
    seedWorld(repo);
    snapshotOf(repo);
    expect(Object.values(repo.spy.counts).every((count) => count === 0)).toBe(true);
  });

  it('reset 은 모든 카운터를 0 으로 되돌린다', () => {
    const repo = newRepo();
    const world = seedWorld(repo);
    repo.getClinic(world.clinicId);
    repo.listAuditLog();
    expect(Object.values(repo.spy.counts).some((count) => count > 0)).toBe(true);
    repo.spy.reset();
    expect(Object.values(repo.spy.counts).every((count) => count === 0)).toBe(true);
  });

  it('트랜잭션을 되돌려도 카운터는 되돌리지 않는다 (관측은 저장소 상태가 아니다)', () => {
    const repo = newRepo();
    const world = seedWorld(repo);
    repo.spy.reset();
    expect(() =>
      repo.transaction(() => {
        repo.getClinic(world.clinicId);
        throw new Error('x');
      }),
    ).toThrow('x');
    expect(repo.spy.counts.getClinic).toBe(1);
  });

  it('묶음 내용은 한 번 읽어 두고 상태는 요청마다 읽는 흐름이 호출 수로 드러난다', () => {
    const repo = newRepo();
    const world = seedWorld(repo);
    repo.spy.reset();
    // 캐시를 채운다: 묶음 내용과 항목 내용을 한 번만 읽는다.
    const bundle = repo.getRuleBundleVersion(world.bundleId);
    const contents = bundle?.itemRefs.map((ref) => repo.getItemVersion(ref));
    expect(contents).toHaveLength(3);
    // 요청 세 번: 매번 상태만 읽는다.
    const seen: string[] = [];
    for (let request = 0; request < 3; request += 1) {
      if (request === 2) {
        repo.recordItemTransition(world.profileRef, transitionInput({ from: 'DRAFT', to: 'SUSPENDED', reason: 'TEST_FIXTURE 중지' }));
      }
      const states = repo.readItemStates(bundle?.itemRefs ?? []);
      seen.push(states[0]?.state ?? 'NONE');
    }
    expect(repo.spy.counts.getRuleBundleVersion).toBe(1);
    expect(repo.spy.counts.getItemVersion).toBe(3);
    expect(repo.spy.counts.readItemStates).toBe(3);
    // 내용 캐시는 그대로인데 세 번째 요청은 바뀐 상태를 본다.
    expect(seen).toEqual(['DRAFT', 'DRAFT', 'SUSPENDED']);
    expect(repo.getRuleBundleVersion(world.bundleId)).toEqual(bundle);
  });
});

describe('깊은 복사 격리 (호출자는 저장된 자료를 바꿀 수 없다)', () => {
  type Case = {
    label: string;
    save: (repo: MemoryRepository) => void;
    read: (repo: MemoryRepository) => unknown;
    corrupt: (value: never) => void;
  };

  const cases: Case[] = [
    { label: '병원', save: (r) => r.saveClinic(makeClinic()), read: (r) => r.getClinic(TEST_FIXTURE_CLINIC_ID), corrupt: (v: { name: string }) => void (v.name = 'MUTATED') },
    {
      label: '항목 버전(중첩 배열·객체)',
      save: (r) => r.putItemVersion(profileRecord()),
      read: (r) => r.getItemVersion(profileRecord().ref),
      corrupt: (v: { content: { groups: Array<{ groupKey: string }>; policySources: Array<{ clauseOrPage: string }> } }) => {
        v.content.groups[0]!.groupKey = 'MUTATED';
        v.content.groups.pop();
        v.content.policySources[0]!.clauseOrPage = 'MUTATED';
      },
    },
    {
      label: '카탈로그 버전',
      save: (r) => {
        r.saveClinic(makeClinic());
        r.saveTreatment(makeTreatment());
        r.putTreatmentVersion(makeTreatmentVersion());
        r.putCommonBaseFee(makeCommonBaseFee());
        r.putCatalogVersion(makeCatalogVersion());
      },
      read: (r) => r.getCatalogVersion(makeCatalogVersion().id),
      corrupt: (v: { treatmentVersionIds: string[]; changeSummary: { addedTreatmentIds: string[] } }) => {
        v.treatmentVersionIds.push('MUTATED');
        v.changeSummary.addedTreatmentIds.length = 0;
      },
    },
    { label: '무조작 정책(중첩 객체)', save: (r) => { r.saveClinic(makeClinic()); r.saveIdlePolicy(makeIdlePolicy()); }, read: (r) => r.getIdlePolicy(TEST_FIXTURE_CLINIC_ID), corrupt: (v: { screens: Record<string, { warnSeconds: number }> }) => void (v.screens.TEST_FIXTURE_INPUT!.warnSeconds = 1) },
    { label: '감사 기록', save: (r) => r.appendAuditLog(makeAuditEntry()), read: (r) => r.listAuditLog(), corrupt: (v: Array<{ action: string }>) => void (v[0]!.action = 'MUTATED') },
    { label: '약관 출처 목록', save: (r) => r.putPolicySource(makePolicySource()), read: (r) => r.listPolicySources(), corrupt: (v: Array<{ verifiedBy: string }>) => void (v[0]!.verifiedBy = 'MUTATED') },
    {
      label: '항목 상태 이력',
      save: (r) => {
        r.putItemVersion(profileRecord());
        r.recordItemTransition(profileRecord().ref, transitionInput());
      },
      read: (r) => r.getItemState(profileRecord().ref),
      corrupt: (v: { state: string; history: Array<{ to: string }> }) => {
        v.state = 'PUBLISHED';
        v.history[0]!.to = 'PUBLISHED';
        v.history.length = 0;
      },
    },
    {
      label: '항목 상태 일괄 읽기 결과',
      save: (r) => {
        r.putItemVersion(profileRecord());
        r.recordItemTransition(profileRecord().ref, transitionInput());
      },
      read: (r) => r.readItemStates([profileRecord().ref]),
      corrupt: (v: Array<{ state: string; ref: { id: string } }>) => {
        v[0]!.state = 'PUBLISHED';
        v[0]!.ref.id = 'MUTATED';
      },
    },
    {
      label: '규칙 묶음 버전',
      save: (r) => {
        r.putItemVersion(profileRecord());
        r.putRuleBundleVersion(makeBundleVersion({ itemRefs: [profileRecord().ref] }));
      },
      read: (r) => r.getRuleBundleVersion(makeBundleVersion().id),
      corrupt: (v: { itemRefs: Array<{ id: string }> }) => void (v.itemRefs[0]!.id = 'MUTATED'),
    },
  ];

  it.each(cases)('$label: 읽어 온 값을 고쳐도 저장된 값은 그대로다', ({ save, read, corrupt }) => {
    const repo = newRepo();
    save(repo);
    const pristine = structuredClone(read(repo));
    expect(pristine).not.toBeNull();
    corrupt(read(repo) as never);
    expect(read(repo)).toEqual(pristine);
  });

  it('같은 자료를 두 번 읽으면 서로 다른 객체다 (참조를 공유하지 않는다)', () => {
    const repo = newRepo();
    repo.saveClinic(makeClinic());
    expect(repo.getClinic(TEST_FIXTURE_CLINIC_ID)).not.toBe(repo.getClinic(TEST_FIXTURE_CLINIC_ID));
  });

  it('쓴 뒤에 입력 객체를 고쳐도 저장된 값은 그대로다 (중첩 포함)', () => {
    const repo = newRepo();
    const record = profileRecord();
    const pristine = structuredClone(record);
    repo.putItemVersion(record);
    record.content.groups[0]!.groupKey = 'MUTATED';
    record.content.groupOrder.push('MUTATED');
    record.content.policySources[0]!.clauseOrPage = 'MUTATED';
    record.authorId = 'MUTATED';
    expect(repo.getItemVersion(pristine.ref)).toEqual(pristine);
  });

  it('쓴 뒤에 병원·상태 전이 입력을 고쳐도 저장된 값은 그대로다', () => {
    const repo = newRepo();
    const clinic = makeClinic();
    repo.saveClinic(clinic);
    clinic.name = 'MUTATED';
    expect(repo.getClinic(TEST_FIXTURE_CLINIC_ID)?.name).toBe(makeClinic().name);

    const record = mappingRecord();
    repo.putItemVersion(record);
    const input = transitionInput({ approverAfter: { approverId: 'A', approvedAt: 'T' } });
    repo.recordItemTransition(record.ref, input);
    input.approverAfter!.approverId = 'MUTATED';
    input.actor.id = 'MUTATED';
    expect(repo.getItemState(record.ref)?.approver).toEqual({ approverId: 'A', approvedAt: 'T' });
    expect(repo.getItemState(record.ref)?.history[0]?.actorId).toBe(TEST_FIXTURE_RV_AUTHOR.id);
  });

  it('한 저장소를 되돌린 뒤에도 이전에 읽어 둔 값은 영향을 받지 않는다', () => {
    const repo = newRepo();
    repo.saveClinic(makeClinic());
    const held = repo.getClinic(TEST_FIXTURE_CLINIC_ID);
    expect(() =>
      repo.transaction(() => {
        repo.saveClinic(makeClinic({ name: 'CHANGED' }));
        throw new Error('x');
      }),
    ).toThrow('x');
    expect(held?.name).toBe(makeClinic().name);
    expect(repo.getClinic(TEST_FIXTURE_CLINIC_ID)?.name).toBe(makeClinic().name);
  });
});

describe('결정적 정렬', () => {
  it('병원 목록은 id 의 유니코드 코드 포인트 순이다 (삽입 순서와 무관)', () => {
    const repo = newRepo();
    // U+FF5E(BMP 끝쪽)는 U+1F600(보충 평면)보다 코드 포인트가 작지만 UTF-16 코드 단위로는 반대다.
    const ids = ['TEST_FIXTURE_C_\u{1f600}', 'TEST_FIXTURE_B', 'TEST_FIXTURE_C_～', 'TEST_FIXTURE_A'];
    for (const [index, id] of ids.entries()) {
      repo.saveClinic(makeClinic({ id, slug: `test-fixture-slug-${index}` }));
    }
    expect(repo.listClinics().map((clinic) => clinic.id)).toEqual(['TEST_FIXTURE_A', 'TEST_FIXTURE_B', 'TEST_FIXTURE_C_～', 'TEST_FIXTURE_C_\u{1f600}']);
  });

  it('병원 아래 목록(치료·검토 요청)과 보험사·약관 출처 목록도 id 순이다', () => {
    const repo = newRepo();
    repo.saveClinic(makeClinic());
    repo.saveClinic(makeClinic({ id: 'TEST_FIXTURE_CLINIC_2', slug: 'test-fixture-clinic-2' }));
    for (const id of ['TEST_FIXTURE_TREATMENT_C', 'TEST_FIXTURE_TREATMENT_A', 'TEST_FIXTURE_TREATMENT_B']) {
      repo.saveTreatment(makeTreatment({ id }));
    }
    repo.saveTreatment(makeTreatment({ id: 'TEST_FIXTURE_TREATMENT_OTHER', clinicId: 'TEST_FIXTURE_CLINIC_2' }));
    expect(repo.listTreatments(TEST_FIXTURE_CLINIC_ID).map((t) => t.id)).toEqual(['TEST_FIXTURE_TREATMENT_A', 'TEST_FIXTURE_TREATMENT_B', 'TEST_FIXTURE_TREATMENT_C']);

    for (const id of ['TEST_FIXTURE_REVIEW_B', 'TEST_FIXTURE_REVIEW_A']) {
      repo.saveCoverageReviewRequest(makeReviewRequest({ id, treatmentId: 'TEST_FIXTURE_TREATMENT_A' }));
    }
    expect(repo.listCoverageReviewRequests(TEST_FIXTURE_CLINIC_ID).map((r) => r.id)).toEqual(['TEST_FIXTURE_REVIEW_A', 'TEST_FIXTURE_REVIEW_B']);

    for (const id of ['TEST_FIXTURE_INSURER_2', 'TEST_FIXTURE_INSURER_1']) {
      repo.saveInsurer(makeInsurer({ id }));
    }
    expect(repo.listInsurers().map((i) => i.id)).toEqual(['TEST_FIXTURE_INSURER_1', 'TEST_FIXTURE_INSURER_2']);

    for (const id of ['TEST_FIXTURE_SOURCE_2', 'TEST_FIXTURE_SOURCE_1']) {
      repo.putPolicySource(makePolicySource({ id }));
    }
    expect(repo.listPolicySources().map((s) => s.id)).toEqual(['TEST_FIXTURE_SOURCE_1', 'TEST_FIXTURE_SOURCE_2']);
  });

  it('버전과 이력 목록은 쓴 순서(게시 순서)다: v10 이 v2 보다 먼저 써졌으면 먼저 나온다', () => {
    const repo = newRepo();
    for (const version of ['v10', 'v2', 'v1']) {
      repo.putItemVersion(profileRecord({ version }));
    }
    expect(repo.listItemVersions('PROFILE').map((record) => record.ref.version)).toEqual(['v10', 'v2', 'v1']);
    expect(repo.listItemVersions('MAPPING')).toEqual([]);

    repo.saveClinic(makeClinic());
    repo.saveTreatment(makeTreatment());
    repo.putTreatmentVersion(makeTreatmentVersion());
    repo.putCommonBaseFee(makeCommonBaseFee());
    for (const id of ['TEST_FIXTURE_CATALOG_B', 'TEST_FIXTURE_CATALOG_A']) {
      repo.putCatalogVersion(makeCatalogVersion({ id }));
    }
    expect(repo.listCatalogVersions(TEST_FIXTURE_CLINIC_ID).map((c) => c.id)).toEqual(['TEST_FIXTURE_CATALOG_B', 'TEST_FIXTURE_CATALOG_A']);

    for (const id of ['TEST_FIXTURE_BUNDLE_Z', 'TEST_FIXTURE_BUNDLE_Y']) {
      repo.putRuleBundleVersion(makeBundleVersion({ id }));
    }
    expect(repo.listRuleBundleVersions().map((b) => b.id)).toEqual(['TEST_FIXTURE_BUNDLE_Z', 'TEST_FIXTURE_BUNDLE_Y']);
  });

  it('같은 동작 순서로 만든 두 저장소는 같은 상태이고, 목록은 되풀이해 읽어도 같다', () => {
    const one = newRepo();
    const two = newRepo();
    seedWorld(one);
    seedWorld(two);
    expect(snapshotOf(one)).toEqual(snapshotOf(two));
    expect(one.listClinics()).toEqual(one.listClinics());
    expect(one.listItemVersions('PROFILE')).toEqual(two.listItemVersions('PROFILE'));
  });
});

describe('참조 무결성', () => {
  const missing = 'TEST_FIXTURE_MISSING';
  const brokenReferences: Array<[string, (repo: MemoryRepository) => void, 'NOT_FOUND' | 'REF_CONTENT_MISMATCH' | 'DUPLICATE_KEY']> = [
    ['없는 병원의 치료', (r) => r.saveTreatment(makeTreatment({ id: 'TEST_FIXTURE_TREATMENT_Q', clinicId: missing })), 'NOT_FOUND'],
    ['없는 치료의 치료 버전', (r) => r.putTreatmentVersion(makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_Q', treatmentId: missing })), 'NOT_FOUND'],
    ['없는 병원의 공통 기본비용', (r) => r.putCommonBaseFee(makeCommonBaseFee({ id: 'TEST_FIXTURE_FEE_Q', clinicId: missing })), 'NOT_FOUND'],
    ['없는 병원의 카탈로그', (r) => r.putCatalogVersion(makeCatalogVersion({ id: 'TEST_FIXTURE_CATALOG_Q', clinicId: missing })), 'NOT_FOUND'],
    ['없는 치료 버전을 담은 카탈로그', (r) => r.putCatalogVersion(makeCatalogVersion({ id: 'TEST_FIXTURE_CATALOG_Q', treatmentVersionIds: [missing] })), 'NOT_FOUND'],
    ['없는 공통 기본비용을 담은 카탈로그', (r) => r.putCatalogVersion(makeCatalogVersion({ id: 'TEST_FIXTURE_CATALOG_Q', baseFeeIds: [missing] })), 'NOT_FOUND'],
    ['없는 카탈로그를 현재 값으로 가리키는 병원', (r) => r.saveClinic(makeClinic({ currentCatalogVersionId: missing })), 'NOT_FOUND'],
    ['다른 병원의 카탈로그를 현재 값으로 가리키는 병원', (r) => {
      r.saveClinic(makeClinic({ id: 'TEST_FIXTURE_CLINIC_2', slug: 'test-fixture-clinic-2', currentCatalogVersionId: makeCatalogVersion().id }));
    }, 'REF_CONTENT_MISMATCH'],
    ['없는 항목을 담은 규칙 묶음', (r) => r.putRuleBundleVersion(makeBundleVersion({ id: 'TEST_FIXTURE_BUNDLE_Q', itemRefs: [{ kind: 'PROFILE', id: missing, version: 'v1' }] })), 'NOT_FOUND'],
    ['없는 묶음의 가용성 사건', (r) => r.appendBundleStatusEvent(makeStatusEvent({ bundleId: missing })), 'NOT_FOUND'],
    ['없는 병원의 규칙 사용 범위', (r) => r.assignClinicRuleScope(makeScope({ clinicId: missing })), 'NOT_FOUND'],
    ['없는 묶음을 가리키는 규칙 사용 범위', (r) => r.assignClinicRuleScope(makeScope({ ruleBundleVersionId: missing })), 'NOT_FOUND'],
    ['없는 병원의 무조작 정책', (r) => r.saveIdlePolicy(makeIdlePolicy({ clinicId: missing })), 'NOT_FOUND'],
    ['없는 병원의 검토 요청', (r) => r.saveCoverageReviewRequest(makeReviewRequest({ id: 'TEST_FIXTURE_REVIEW_Q', clinicId: missing })), 'NOT_FOUND'],
    ['없는 치료의 검토 요청', (r) => r.saveCoverageReviewRequest(makeReviewRequest({ id: 'TEST_FIXTURE_REVIEW_Q', treatmentId: missing })), 'NOT_FOUND'],
    ['없는 매핑을 결과로 가리키는 검토 요청', (r) => r.saveCoverageReviewRequest(makeReviewRequest({ id: 'TEST_FIXTURE_REVIEW_Q', resultMappingRef: { kind: 'MAPPING', id: missing, version: 'v1' } })), 'NOT_FOUND'],
    ['id 가 내용과 다른 항목 버전', (r) => r.putItemVersion({ ...profileRecord(), ref: { kind: 'PROFILE', id: 'TEST_PROFILE_OTHER', version: 'v1' } }), 'REF_CONTENT_MISMATCH'],
    ['version 이 내용과 다른 항목 버전', (r) => r.putItemVersion({ ...profileRecord(), ref: { kind: 'PROFILE', id: 'TEST_PROFILE_1', version: 'v9' } }), 'REF_CONTENT_MISMATCH'],
    ['다른 병원이 쓰는 slug', (r) => r.saveClinic(makeClinic({ id: 'TEST_FIXTURE_CLINIC_2' })), 'DUPLICATE_KEY'],
  ];

  it.each(brokenReferences)('%s', (_label, write, code) => {
    const repo = newRepo();
    seedWorld(repo);
    const before = snapshotOf(repo);
    expect(catchDomainError(() => write(repo)).code).toBe(code);
    expect(snapshotOf(repo)).toEqual(before);
  });

  it('같은 병원이 같은 slug 로 다시 저장하는 것은 갱신이다', () => {
    const repo = newRepo();
    repo.saveClinic(makeClinic());
    repo.saveClinic(makeClinic({ name: 'TEST_FIXTURE 바뀐 이름' }));
    expect(repo.getClinic(TEST_FIXTURE_CLINIC_ID)?.name).toBe('TEST_FIXTURE 바뀐 이름');
    expect(repo.listClinics()).toHaveLength(1);
  });

  it('병원의 현재 카탈로그 버전은 병원 저장으로 가리키고 질의로 읽는다', () => {
    const repo = newRepo();
    expect(repo.getClinicCurrentCatalogVersion(TEST_FIXTURE_CLINIC_ID)).toBeNull();
    const world = seedWorld(repo);
    expect(repo.getClinicCurrentCatalogVersion(world.clinicId)).toEqual(makeCatalogVersion());
    expect(repo.getClinicCurrentCatalogVersion('TEST_FIXTURE_MISSING')).toBeNull();
    repo.saveClinic(makeClinic({ id: 'TEST_FIXTURE_CLINIC_2', slug: 'test-fixture-clinic-2' }));
    expect(repo.getClinicCurrentCatalogVersion('TEST_FIXTURE_CLINIC_2')).toBeNull();
  });
});

describe('병원 규칙 사용 범위 (ClinicRuleScope)', () => {
  it('현재 값은 마지막 지정이고 이력은 지정한 순서대로 모두 남는다', () => {
    const repo = newRepo();
    const world = seedWorld(repo);
    repo.putRuleBundleVersion(makeBundleVersion({ id: 'TEST_FIXTURE_BUNDLE_2', itemRefs: [world.profileRef] }));
    repo.appendBundleStatusEvent(makeStatusEvent({ bundleId: 'TEST_FIXTURE_BUNDLE_2' }));
    repo.assignClinicRuleScope(makeScope({ ruleBundleVersionId: 'TEST_FIXTURE_BUNDLE_2', assignedBy: TEST_FIXTURE_PO_1, assignedAt: 'T2' }));
    expect(repo.getClinicRuleScope(world.clinicId)?.ruleBundleVersionId).toBe('TEST_FIXTURE_BUNDLE_2');
    expect(repo.listClinicRuleScopeHistory(world.clinicId).map((scope) => scope.ruleBundleVersionId)).toEqual(['TEST_FIXTURE_BUNDLE_1', 'TEST_FIXTURE_BUNDLE_2']);
  });

  it('범위를 지정한 적 없는 병원은 현재 값이 null 이고 이력이 비어 있다', () => {
    const repo = newRepo();
    repo.saveClinic(makeClinic());
    expect(repo.getClinicRuleScope(TEST_FIXTURE_CLINIC_ID)).toBeNull();
    expect(repo.listClinicRuleScopeHistory(TEST_FIXTURE_CLINIC_ID)).toEqual([]);
  });

  it('병원마다 따로 센다', () => {
    const repo = newRepo();
    const world = seedWorld(repo);
    repo.saveClinic(makeClinic({ id: 'TEST_FIXTURE_CLINIC_2', slug: 'test-fixture-clinic-2' }));
    repo.assignClinicRuleScope(makeScope({ clinicId: 'TEST_FIXTURE_CLINIC_2', assignedBy: TEST_FIXTURE_HA_1 }));
    expect(repo.listClinicRuleScopeHistory(world.clinicId)).toHaveLength(1);
    expect(repo.listClinicRuleScopeHistory('TEST_FIXTURE_CLINIC_2')).toHaveLength(1);
  });
});

describe('읽기 질의', () => {
  it('없는 자료는 모두 null 이거나 빈 목록이다', () => {
    const repo = newRepo();
    const m = 'TEST_FIXTURE_MISSING';
    expect(repo.getClinic(m)).toBeNull();
    expect(repo.getTreatment(m)).toBeNull();
    expect(repo.getTreatmentVersion(m)).toBeNull();
    expect(repo.getCommonBaseFee(m)).toBeNull();
    expect(repo.getCatalogVersion(m)).toBeNull();
    expect(repo.getInsurer(m)).toBeNull();
    expect(repo.getPolicySource(m)).toBeNull();
    expect(repo.getCoverageReviewRequest(m)).toBeNull();
    expect(repo.getItemVersion({ kind: 'PROFILE', id: m, version: 'v1' })).toBeNull();
    expect(repo.getRuleBundleVersion(m)).toBeNull();
    expect(repo.getIdlePolicy(m)).toBeNull();
    expect(repo.listTreatments(m)).toEqual([]);
    expect(repo.listCatalogVersions(m)).toEqual([]);
    expect(repo.listCoverageReviewRequests(m)).toEqual([]);
    expect(repo.listBundleStatusEvents(m)).toEqual([]);
    expect(repo.listAuditLog()).toEqual([]);
  });

  it('쓴 자료를 그대로 읽는다', () => {
    const repo = newRepo();
    const world = seedWorld(repo);
    expect(repo.getTreatment(makeTreatment().id)).toEqual(makeTreatment());
    expect(repo.getTreatmentVersion(makeTreatmentVersion().id)).toEqual(makeTreatmentVersion());
    expect(repo.getCommonBaseFee(makeCommonBaseFee().id)).toEqual(makeCommonBaseFee());
    expect(repo.getInsurer(makeInsurer().id)).toEqual(makeInsurer());
    expect(repo.getPolicySource(makePolicySource().id)).toEqual(makePolicySource());
    expect(repo.getCoverageReviewRequest(makeReviewRequest().id)).toEqual(makeReviewRequest());
    expect(repo.getIdlePolicy(world.clinicId)).toEqual(makeIdlePolicy());
    expect(repo.getItemVersion(world.profileRef)).toEqual(profileRecord());
    expect(repo.getRuleBundleVersion(world.bundleId)?.itemRefs).toEqual([world.profileRef, world.mappingRef, world.documentRuleSetRef]);
    expect(repo.listAuditLog()).toEqual([makeAuditEntry()]);
    expect(TEST_FIXTURE_NOW).toBe(repo.getRuleBundleVersion(world.bundleId)?.publishedAt);
  });

  it('검토 요청은 상태가 바뀌는 기록이라 같은 id 로 다시 저장하면 갱신된다 (되돌리거나 지울 수는 없다)', () => {
    const repo = newRepo();
    seedWorld(repo);
    repo.saveCoverageReviewRequest(makeReviewRequest({ status: 'REJECTED', rejectionReason: 'TEST_FIXTURE 반려 사유' }));
    expect(repo.getCoverageReviewRequest(makeReviewRequest().id)?.status).toBe('REJECTED');
    expect(repo.listCoverageReviewRequests(TEST_FIXTURE_CLINIC_ID)).toHaveLength(1);
  });
});

describe('snapshotOf 도우미', () => {
  it('저장소가 바뀌면 값이 달라지고 안 바뀌면 같다', () => {
    const repo = newRepo();
    const empty = snapshotOf(repo);
    expect(snapshotOf(repo)).toEqual(empty);
    repo.saveClinic(makeClinic());
    expect(snapshotOf(repo)).not.toEqual(empty);
  });

  it('감사 기록·묶음 상태 사건·항목 상태 이력의 변화도 잡아 낸다', () => {
    const repo = newRepo();
    const world = seedWorld(repo);
    const base = snapshotOf(repo);
    repo.appendAuditLog(makeAuditEntry({ id: 'TEST_FIXTURE_AUDIT_2' }));
    expect(snapshotOf(repo)).not.toEqual(base);
    const afterAudit = snapshotOf(repo);
    repo.appendBundleStatusEvent(makeStatusEvent({ status: 'SUSPENDED', previousStatus: 'ACTIVE', reason: 'r' }));
    expect(snapshotOf(repo)).not.toEqual(afterAudit);
    const afterEvent = snapshotOf(repo);
    repo.recordItemTransition(world.profileRef, transitionInput({ from: 'DRAFT', to: 'REVIEW_REQUESTED' }));
    expect(snapshotOf(repo)).not.toEqual(afterEvent);
  });

  it('떠 낸 값을 고쳐도 저장소에는 영향이 없다', () => {
    const repo = newRepo();
    repo.saveClinic(makeClinic());
    const dump = snapshotOf(repo);
    const before = structuredClone(dump);
    (dump.clinics as unknown[]).length = 0;
    expect(snapshotOf(repo)).toEqual(before);
  });
});
