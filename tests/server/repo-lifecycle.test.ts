import { describe, expect, it } from 'vitest';
import type { LifecycleState } from '../../src/engine/types';
import type { ItemVersionRecord } from '../../src/server/domain/items';
import { TEST_FIXTURE_RV_APPROVER, TEST_FIXTURE_RV_AUTHOR } from '../fixtures/server/actors.fixture';
import { makeClinic, makeReviewRequest, makeTreatment, makeTreatmentVersion } from '../fixtures/server/entities.fixture';
import { catchDomainError } from '../fixtures/server/errors.fixture';
import { mappingRecord, profileRecord } from '../fixtures/server/items.fixture';
import { ALL_STATES, forceState } from '../fixtures/server/lifecycle.fixture';
import { newRepo, snapshotOf, transitionInput } from '../fixtures/server/repo.fixture';

// M3.B 가 저장소에 더한 것: 승인 시점의 지문을 상태 기록에 두기, DRAFT 내용 수정, 치료 버전 목록, 검토 요청의 초안 링크.
// 기존 저장소 계약(write-once, 원자성, 격리)은 repo-memory.test.ts 가 그대로 지킨다.

describe('승인 시점의 지문은 상태 기록에 있다 (M3.A 결정의 M3.B 변경)', () => {
  it('전이마다 승인자·지문이 그 전이 뒤의 값으로 바뀌고 이력은 각 전이 뒤의 값을 남긴다', () => {
    const repo = newRepo();
    const record = mappingRecord();
    repo.putItemVersion(record);
    repo.recordItemTransition(record.ref, transitionInput());
    repo.recordItemTransition(
      record.ref,
      transitionInput({ from: 'DRAFT', to: 'APPROVED', actor: TEST_FIXTURE_RV_APPROVER, at: 'T1', approverAfter: { approverId: 'A1', approvedAt: 'T1' }, approvedFingerprintAfter: 'FP1' }),
    );
    repo.recordItemTransition(record.ref, transitionInput({ from: 'APPROVED', to: 'UNDER_REREVIEW', at: 'T2', approverAfter: { approverId: 'A1', approvedAt: 'T1' }, approvedFingerprintAfter: 'FP1' }));
    repo.recordItemTransition(
      record.ref,
      transitionInput({ from: 'UNDER_REREVIEW', to: 'APPROVED', at: 'T3', approverAfter: { approverId: 'A2', approvedAt: 'T3' }, approvedFingerprintAfter: 'FP2' }),
    );

    const state = repo.getItemState(record.ref);
    expect(state?.approver).toEqual({ approverId: 'A2', approvedAt: 'T3' });
    expect(state?.approvedFingerprint).toBe('FP2');
    expect(state?.history.map((step) => [step.to, step.approver?.approverId ?? null, step.approvedFingerprint])).toEqual([
      ['DRAFT', null, null],
      ['APPROVED', 'A1', 'FP1'],
      ['UNDER_REREVIEW', 'A1', 'FP1'],
      ['APPROVED', 'A2', 'FP2'],
    ]);
  });

  it('상태와 함께 지문이 읽힌다: 내용 기록은 지문을 갖지 않는다', () => {
    const repo = newRepo();
    const record = mappingRecord();
    repo.putItemVersion(record);
    repo.recordItemTransition(record.ref, transitionInput({ approvedFingerprintAfter: 'FP1' }));
    expect(repo.readItemStates([record.ref])[0]?.approvedFingerprint).toBe('FP1');
    expect(Object.keys(repo.getItemVersion(record.ref)?.content ?? {})).not.toContain('approvedFingerprint');
  });

  it('상태 기록이 아직 없는 참조의 지문은 읽을 수 없다 (상태 자체가 null)', () => {
    const repo = newRepo();
    const record = mappingRecord();
    repo.putItemVersion(record);
    expect(repo.readItemStates([record.ref])).toEqual([null]);
  });
});

describe('초안 내용 수정 (reviseDraftItemVersion): DRAFT 에만 허용되는 유일한 덮어쓰기', () => {
  function revised(record: ItemVersionRecord): ItemVersionRecord {
    return { ...record, content: { ...record.content, validity: { from: '2026-03-01', to: '2026-09-30' } } } as ItemVersionRecord;
  }

  it('DRAFT 의 내용이 바뀌고 상태 기록은 그대로다', () => {
    const repo = newRepo();
    const record = profileRecord();
    repo.putItemVersion(record);
    repo.recordItemTransition(record.ref, transitionInput());
    const stateBefore = repo.getItemState(record.ref);
    repo.reviseDraftItemVersion(revised(record));
    expect(repo.getItemVersion(record.ref)).toEqual(revised(record));
    expect(repo.getItemState(record.ref)).toEqual(stateBefore);
  });

  it('같은 내용으로 다시 써도 아무 일 없다 (멱등)', () => {
    const repo = newRepo();
    const record = profileRecord();
    repo.putItemVersion(record);
    repo.recordItemTransition(record.ref, transitionInput());
    const before = snapshotOf(repo);
    repo.reviseDraftItemVersion(record);
    expect(snapshotOf(repo)).toEqual(before);
  });

  it.each(ALL_STATES.filter((state) => state !== 'DRAFT'))('상태가 %s 이면 STATE_CONFLICT 이고 내용이 그대로다 (DRAFT 를 떠난 버전은 불변)', (state: LifecycleState) => {
    const repo = newRepo();
    const record = profileRecord();
    repo.putItemVersion(record);
    repo.recordItemTransition(record.ref, transitionInput());
    forceState(repo, record.ref, state);
    const before = snapshotOf(repo);
    expect(catchDomainError(() => repo.reviseDraftItemVersion(revised(record))).code).toBe('STATE_CONFLICT');
    expect(snapshotOf(repo)).toEqual(before);
  });

  it('상태 기록이 아직 없으면 STATE_CONFLICT, 항목이 없으면 NOT_FOUND 이다', () => {
    const repo = newRepo();
    const record = profileRecord();
    expect(catchDomainError(() => repo.reviseDraftItemVersion(record)).code).toBe('NOT_FOUND');
    repo.putItemVersion(record);
    const before = snapshotOf(repo);
    expect(catchDomainError(() => repo.reviseDraftItemVersion(revised(record))).code).toBe('STATE_CONFLICT');
    expect(snapshotOf(repo)).toEqual(before);
  });

  it('참조와 내용의 id·version 이 다르면 REF_CONTENT_MISMATCH, 작성자·작성 시각을 바꾸면 IMMUTABLE_VERSION 이다', () => {
    const repo = newRepo();
    const record = profileRecord();
    repo.putItemVersion(record);
    repo.recordItemTransition(record.ref, transitionInput());
    const before = snapshotOf(repo);
    expect(catchDomainError(() => repo.reviseDraftItemVersion({ ...record, content: { ...record.content, version: 'v9' } } as ItemVersionRecord)).code).toBe('REF_CONTENT_MISMATCH');
    expect(catchDomainError(() => repo.reviseDraftItemVersion({ ...record, authorId: TEST_FIXTURE_RV_APPROVER.id })).code).toBe('IMMUTABLE_VERSION');
    expect(catchDomainError(() => repo.reviseDraftItemVersion({ ...record, createdAt: 'OTHER' })).code).toBe('IMMUTABLE_VERSION');
    expect(snapshotOf(repo)).toEqual(before);
  });

  it('쓴 뒤에 호출자가 입력을 고쳐도 저장된 값은 그대로이고 트랜잭션이 되돌리면 수정도 사라진다', () => {
    const repo = newRepo();
    const record = profileRecord();
    repo.putItemVersion(record);
    repo.recordItemTransition(record.ref, transitionInput());
    const next = revised(record);
    repo.reviseDraftItemVersion(next);
    (next.content as { validity: { from: string } }).validity.from = 'MUTATED';
    expect((repo.getItemVersion(record.ref)?.content as { validity: { from: string } }).validity.from).toBe('2026-03-01');

    const before = snapshotOf(repo);
    expect(() =>
      repo.transaction(() => {
        repo.reviseDraftItemVersion(record);
        throw new Error('되돌림');
      }),
    ).toThrow('되돌림');
    expect(snapshotOf(repo)).toEqual(before);
  });

  it('작성자 id 는 그대로 쓴다 (작성자 = 처음 만든 주체)', () => {
    const repo = newRepo();
    const record = profileRecord();
    repo.putItemVersion(record);
    repo.recordItemTransition(record.ref, transitionInput());
    repo.reviseDraftItemVersion(revised(record));
    expect(repo.getItemVersion(record.ref)?.authorId).toBe(TEST_FIXTURE_RV_AUTHOR.id);
  });
});

describe('치료 버전 목록 (listTreatmentVersions)', () => {
  it('치료마다 쓴 순서대로 돌려주고 다른 치료의 버전은 섞이지 않는다', () => {
    const repo = newRepo();
    repo.saveClinic(makeClinic());
    repo.saveTreatment(makeTreatment());
    repo.saveTreatment(makeTreatment({ id: 'TEST_FIXTURE_TREATMENT_2', sortOrder: 2 }));
    repo.putTreatmentVersion(makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_B' }));
    repo.putTreatmentVersion(makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_OTHER', treatmentId: 'TEST_FIXTURE_TREATMENT_2' }));
    repo.putTreatmentVersion(makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_A' }));
    expect(repo.listTreatmentVersions('TEST_FIXTURE_TREATMENT_1').map((version) => version.id)).toEqual(['TEST_FIXTURE_TV_B', 'TEST_FIXTURE_TV_A']);
    expect(repo.listTreatmentVersions('TEST_FIXTURE_TREATMENT_2').map((version) => version.id)).toEqual(['TEST_FIXTURE_TV_OTHER']);
    expect(repo.listTreatmentVersions('TEST_FIXTURE_NOPE')).toEqual([]);
  });

  it('복사본을 돌려준다', () => {
    const repo = newRepo();
    repo.saveClinic(makeClinic());
    repo.saveTreatment(makeTreatment());
    repo.putTreatmentVersion(makeTreatmentVersion());
    repo.listTreatmentVersions('TEST_FIXTURE_TREATMENT_1')[0]!.displayName = 'MUTATED';
    expect(repo.getTreatmentVersion('TEST_FIXTURE_TV_1')?.displayName).toBe(makeTreatmentVersion().displayName);
  });
});

describe('검토 요청의 초안 링크 (draftMappingRef)', () => {
  it('링크한 매핑 버전이 없으면 NOT_FOUND, 있으면 저장된다', () => {
    const repo = newRepo();
    repo.saveClinic(makeClinic());
    repo.saveTreatment(makeTreatment());
    const record = mappingRecord();
    const before = snapshotOf(repo);
    expect(catchDomainError(() => repo.saveCoverageReviewRequest(makeReviewRequest({ draftMappingRef: record.ref }))).code).toBe('NOT_FOUND');
    expect(snapshotOf(repo)).toEqual(before);
    repo.putItemVersion(record);
    repo.saveCoverageReviewRequest(makeReviewRequest({ draftMappingRef: record.ref }));
    expect(repo.getCoverageReviewRequest(makeReviewRequest().id)?.draftMappingRef).toEqual(record.ref);
  });
});
