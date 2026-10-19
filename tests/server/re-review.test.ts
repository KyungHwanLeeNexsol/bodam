import { describe, expect, it } from 'vitest';
import type { LifecycleState } from '../../src/engine/types';
import { triggerReReview } from '../../src/server/re-review';
import type { TreatmentVersion } from '../../src/server/domain/entities';
import { coverageFingerprintOf } from '../../src/server/fingerprint';
import { TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1, TEST_FIXTURE_RV_AUTHOR } from '../fixtures/server/actors.fixture';
import { makeTreatment, makeTreatmentVersion } from '../fixtures/server/entities.fixture';
import { mappingRecord } from '../fixtures/server/items.fixture';
import { ALL_STATES, adoptTreatmentVersion, approvedOf, itemInState, newWorld, publishedOf, seedTreatment } from '../fixtures/server/lifecycle.fixture';
import type { World } from '../fixtures/server/lifecycle.fixture';
import { snapshotOf } from '../fixtures/server/repo.fixture';

// 재검토 전환 (design.md DD-16, AC-009a 의 단위 수준 부분). 보장 판단 필드가 바뀐 치료 버전이 게시되면 그 치료의
// APPROVED·PUBLISHED 매핑이 UNDER_REREVIEW 가 된다. 카탈로그 게시에서 같은 트랜잭션 안으로 부르는 것은 M3.D 의 일이다.
// 여기서는 치료 버전과 행위자를 받는 함수 자체와 바깥 트랜잭션 안에서의 동작을 본다.

const REASON = 'COVERAGE_JUDGMENT_FIELD_CHANGED';

function setup(): World {
  const w = newWorld();
  seedTreatment(w.repo);
  return w;
}

/** 새 치료 버전: 같은 치료의 다음 버전 (id 만 다르다). */
function nextVersion(overrides: Partial<TreatmentVersion> = {}): TreatmentVersion {
  return makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_2', ...overrides });
}

const GUARANTEE_FIELD_CHANGES: Array<[string, Partial<TreatmentVersion>]> = [
  ['treatmentCode', { treatmentCode: 'TEST_FIXTURE_TC_CHANGED' }],
  ['procedureCodes', { procedureCodes: ['TEST_FIXTURE_PROC_A', 'TEST_FIXTURE_PROC_C'] }],
  ['benefitType', { benefitType: 'NON_BENEFIT' }],
  ['calcClass', { calcClass: 'NEEDS_REVIEW' }],
];

describe('보장 판단 필드가 바뀐 치료 버전 → APPROVED·PUBLISHED 매핑이 UNDER_REREVIEW (DD-16)', () => {
  it.each(GUARANTEE_FIELD_CHANGES)('%s 하나만 바뀌어도 전환된다', (_field, change) => {
    const w = setup();
    const approved = approvedOf(w, 'MAPPING', 1);
    const published = publishedOf(w, 'MAPPING', 2);
    const pinned = coverageFingerprintOf(makeTreatmentVersion());
    expect(w.repo.getItemState(approved)?.approvedFingerprint).toBe(pinned);
    w.clock.set('2026-10-21T00:00:00.000Z');

    const moved = triggerReReview(w.deps, TEST_FIXTURE_HA_1, nextVersion(change));

    expect(moved).toEqual([approved, published]);
    for (const [ref, from] of [
      [approved, 'APPROVED'],
      [published, 'PUBLISHED'],
    ] as const) {
      const state = w.repo.getItemState(ref);
      expect(state?.state).toBe('UNDER_REREVIEW');
      // 승인자와 고정 지문은 그대로 남는다 (재승인이 이 값을 새로 바꾼다).
      expect(state?.approvedFingerprint).toBe(pinned);
      expect(state?.approver?.approverId).toBe('TEST_FIXTURE_RV_APPROVER');
      expect(state?.history.at(-1)).toEqual({
        from,
        to: 'UNDER_REREVIEW',
        actorId: 'TEST_FIXTURE_HA_1',
        role: 'HA',
        at: '2026-10-21T00:00:00.000Z',
        reason: REASON,
        approver: state?.approver,
        approvedFingerprint: pinned,
      });
    }
    const audit = w.repo.listAuditLog().filter((entry) => entry.action === 'ITEM_REREVIEW');
    expect(audit).toHaveLength(2);
    expect(audit.map((entry) => [entry.target, entry.beforeVersion, entry.afterVersion, entry.actorId, entry.role, entry.reason])).toEqual([
      [`MAPPING/${approved.id}/${approved.version}`, 'APPROVED', 'UNDER_REREVIEW', 'TEST_FIXTURE_HA_1', 'HA', REASON],
      [`MAPPING/${published.id}/${published.version}`, 'PUBLISHED', 'UNDER_REREVIEW', 'TEST_FIXTURE_HA_1', 'HA', REASON],
    ]);
  });

  it('행위 코드 중복이 늘어도 지문이 달라져 전환된다 (중복은 합치지 않는다)', () => {
    const w = setup();
    const ref = publishedOf(w, 'MAPPING');
    triggerReReview(w.deps, TEST_FIXTURE_HA_1, nextVersion({ procedureCodes: ['TEST_FIXTURE_PROC_A', 'TEST_FIXTURE_PROC_A', 'TEST_FIXTURE_PROC_B'] }));
    expect(w.repo.getItemState(ref)?.state).toBe('UNDER_REREVIEW');
  });

  it('여러 매핑(다른 id, 같은 id의 다른 버전)이 같은 치료이면 모두 전환된다', () => {
    const w = setup();
    const a = publishedOf(w, 'MAPPING', 1);
    const b = approvedOf(w, 'MAPPING', 2);
    const c = approvedOf(w, 'MAPPING', 3);
    triggerReReview(w.deps, TEST_FIXTURE_PO_1, nextVersion({ calcClass: 'NEEDS_REVIEW' }));
    expect([a, b, c].map((ref) => w.repo.getItemState(ref)?.state)).toEqual(['UNDER_REREVIEW', 'UNDER_REREVIEW', 'UNDER_REREVIEW']);
  });
});

describe('보장 판단 필드가 아닌 변경은 아무것도 바꾸지 않는다 (가격만 바뀌면 매핑을 유지한다)', () => {
  const NEUTRAL_CHANGES: Array<[string, Partial<TreatmentVersion>]> = [
    ['가격(patientAmount)', { patientAmount: 55_000 }],
    ['표시 이름', { displayName: 'TEST_FIXTURE 다른 이름' }],
    ['설명', { description: 'TEST_FIXTURE 다른 설명' }],
    ['금액 적용 조건', { amountCondition: { patientType: 'TEST_FIXTURE_OTHER', assumption: 'TEST_FIXTURE_OTHER', referenceDate: '2027-01-01' } }],
    ['서류 표시', { documentFlags: { imaging: true, biopsy: true, opinionRequired: true } }],
    ['적용일', { effectiveDate: '2027-01-01' }],
    ['출처 구분(origin)', { origin: 'DEMO' }],
    ['행위 코드 순서만', { procedureCodes: ['TEST_FIXTURE_PROC_B', 'TEST_FIXTURE_PROC_A'] }],
    ['변경 없음(다음 버전 id 만)', {}],
  ];

  it.each(NEUTRAL_CHANGES)('%s : 저장소 전후 비교가 같다 (상태·이력·감사 기록 모두)', (_name, change) => {
    const w = setup();
    publishedOf(w, 'MAPPING', 1);
    approvedOf(w, 'MAPPING', 2);
    const before = snapshotOf(w.repo);
    expect(triggerReReview(w.deps, TEST_FIXTURE_HA_1, nextVersion(change))).toEqual([]);
    expect(snapshotOf(w.repo)).toEqual(before);
  });
});

describe('전환 대상이 아닌 것은 건드리지 않는다', () => {
  it.each(ALL_STATES.filter((state) => state !== 'APPROVED' && state !== 'PUBLISHED'))('매핑이 %s 이면 그대로다', (state: LifecycleState) => {
    const w = setup();
    const ref = itemInState(w, 'MAPPING', state);
    const stateBefore = w.repo.getItemState(ref);
    const auditBefore = w.repo.listAuditLog().length;
    expect(triggerReReview(w.deps, TEST_FIXTURE_HA_1, nextVersion({ treatmentCode: 'TEST_FIXTURE_TC_CHANGED' }))).toEqual([]);
    expect(w.repo.getItemState(ref)).toEqual(stateBefore);
    expect(w.repo.listAuditLog()).toHaveLength(auditBefore);
  });

  it('다른 치료의 매핑은 그대로다 (같은 치료의 매핑만 전환된다)', () => {
    const w = setup();
    w.repo.saveTreatment(makeTreatment({ id: 'TEST_FIXTURE_TREATMENT_2', sortOrder: 2 }));
    adoptTreatmentVersion(w.repo, makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_T2', treatmentId: 'TEST_FIXTURE_TREATMENT_2' }));
    const own = publishedOf(w, 'MAPPING', 1);
    // 치료 2 의 매핑은 치료 2 를 가리키는 내용으로 직접 PUBLISHED 에 둔다.
    const otherMapping = mappingRecord('TEST_FIXTURE_TREATMENT_2', { id: 'TEST_FIXTURE_MAPPING_OF_T2' });
    w.repo.putItemVersion(otherMapping);
    w.repo.recordItemTransition(otherMapping.ref, {
      from: null,
      to: 'PUBLISHED',
      actor: TEST_FIXTURE_RV_AUTHOR,
      at: 'T',
      reason: null,
      approverAfter: { approverId: 'TEST_FIXTURE_RV_APPROVER', approvedAt: 'T' },
      approvedFingerprintAfter: coverageFingerprintOf(makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_T2', treatmentId: 'TEST_FIXTURE_TREATMENT_2' })),
    });
    const otherBefore = w.repo.getItemState(otherMapping.ref);

    triggerReReview(w.deps, TEST_FIXTURE_HA_1, nextVersion({ treatmentCode: 'TEST_FIXTURE_TC_CHANGED' }));

    expect(w.repo.getItemState(own)?.state).toBe('UNDER_REREVIEW');
    expect(w.repo.getItemState(otherMapping.ref)).toEqual(otherBefore);
  });

  it('프로필·서류 규칙 묶음은 치료와 무관하므로 그대로다', () => {
    const w = setup();
    const profile = publishedOf(w, 'PROFILE');
    const rules = publishedOf(w, 'DOCUMENT_RULE_SET');
    const before = [w.repo.getItemState(profile), w.repo.getItemState(rules)];
    triggerReReview(w.deps, TEST_FIXTURE_HA_1, nextVersion({ treatmentCode: 'TEST_FIXTURE_TC_CHANGED' }));
    expect([w.repo.getItemState(profile), w.repo.getItemState(rules)]).toEqual(before);
  });

  it('상태 기록이 아직 없는 매핑 버전은 건너뛴다 (던지지 않는다)', () => {
    const w = setup();
    w.repo.putItemVersion(mappingRecord('TEST_FIXTURE_TREATMENT_1', { id: 'TEST_FIXTURE_NO_STATE' }));
    const before = snapshotOf(w.repo);
    expect(triggerReReview(w.deps, TEST_FIXTURE_HA_1, nextVersion({ treatmentCode: 'TEST_FIXTURE_TC_CHANGED' }))).toEqual([]);
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  it('고정된 지문이 없는 APPROVED·PUBLISHED 매핑은 비교할 수 없으므로 안전한 쪽(전환)으로 다룬다', () => {
    const w = setup();
    const ref = itemInState(w, 'MAPPING', 'PUBLISHED');
    expect(w.repo.getItemState(ref)?.approvedFingerprint).toBeNull();
    triggerReReview(w.deps, TEST_FIXTURE_HA_1, nextVersion());
    expect(w.repo.getItemState(ref)?.state).toBe('UNDER_REREVIEW');
  });

  it('항목 내용, 치료 버전, 카탈로그는 바꾸지 않고 치료 버전을 저장하지도 않는다 (저장은 게시의 몫, M3.D)', () => {
    const w = setup();
    const ref = publishedOf(w, 'MAPPING');
    const before = snapshotOf(w.repo);
    triggerReReview(w.deps, TEST_FIXTURE_HA_1, nextVersion({ treatmentCode: 'TEST_FIXTURE_TC_CHANGED' }));
    const after = snapshotOf(w.repo);
    for (const unchanged of ['clinics', 'treatments', 'treatmentVersions', 'catalogVersions', 'itemVersions', 'bundles', 'bundleEvents', 'scopeHistory'] as const) {
      expect(after[unchanged]).toEqual(before[unchanged]);
    }
    expect(w.repo.getTreatmentVersion('TEST_FIXTURE_TV_2')).toBeNull();
    expect(w.repo.getItemState(ref)?.state).toBe('UNDER_REREVIEW');
  });
});

describe('반복·되돌림', () => {
  it('같은 치료 버전으로 두 번 불러도 두 번째는 아무것도 바꾸지 않는다', () => {
    const w = setup();
    publishedOf(w, 'MAPPING');
    const version = nextVersion({ treatmentCode: 'TEST_FIXTURE_TC_CHANGED' });
    triggerReReview(w.deps, TEST_FIXTURE_HA_1, version);
    const after = snapshotOf(w.repo);
    expect(triggerReReview(w.deps, TEST_FIXTURE_HA_1, version)).toEqual([]);
    expect(snapshotOf(w.repo)).toEqual(after);
  });

  it('원래 내용으로 되돌린 치료 버전이 나와도 UNDER_REREVIEW 는 저절로 풀리지 않는다 (재승인이 필요하다)', () => {
    const w = setup();
    const ref = publishedOf(w, 'MAPPING');
    triggerReReview(w.deps, TEST_FIXTURE_HA_1, nextVersion({ treatmentCode: 'TEST_FIXTURE_TC_CHANGED' }));
    triggerReReview(w.deps, TEST_FIXTURE_HA_1, makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_3' }));
    expect(w.repo.getItemState(ref)?.state).toBe('UNDER_REREVIEW');
  });
});

describe('행위자: 재검토 전환은 RV 동작이 아니라 게시에 딸린 시스템 효과다', () => {
  it.each([TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1, TEST_FIXTURE_RV_AUTHOR])('역할 %o 가 게시해도 전환되고 감사 기록에 그 행위자가 남는다', (actor) => {
    const w = setup();
    publishedOf(w, 'MAPPING');
    triggerReReview(w.deps, actor, nextVersion({ treatmentCode: 'TEST_FIXTURE_TC_CHANGED' }));
    const entry = w.repo.listAuditLog().at(-1);
    expect(entry).toMatchObject({ action: 'ITEM_REREVIEW', actorId: actor.id, role: actor.role });
  });
});

describe('바깥 트랜잭션 안에서 부를 수 있다 (M3.D 의 카탈로그 게시가 같은 트랜잭션에서 부른다)', () => {
  it('바깥 트랜잭션이 던지면 전환·이력·감사 기록이 모두 되돌려진다', () => {
    const w = setup();
    const ref = publishedOf(w, 'MAPPING');
    const before = snapshotOf(w.repo);
    expect(() =>
      w.repo.transaction(() => {
        triggerReReview(w.deps, TEST_FIXTURE_HA_1, nextVersion({ treatmentCode: 'TEST_FIXTURE_TC_CHANGED' }));
        expect(w.repo.getItemState(ref)?.state).toBe('UNDER_REREVIEW');
        throw new Error('TEST_FIXTURE 바깥 실패');
      }),
    ).toThrow('TEST_FIXTURE 바깥 실패');
    expect(snapshotOf(w.repo)).toEqual(before);
    expect(w.repo.getItemState(ref)?.state).toBe('PUBLISHED');
  });

  it('바깥 트랜잭션이 끝나면 전환이 남는다', () => {
    const w = setup();
    const ref = publishedOf(w, 'MAPPING');
    w.repo.transaction(() => {
      triggerReReview(w.deps, TEST_FIXTURE_HA_1, nextVersion({ treatmentCode: 'TEST_FIXTURE_TC_CHANGED' }));
    });
    expect(w.repo.getItemState(ref)?.state).toBe('UNDER_REREVIEW');
  });
});
