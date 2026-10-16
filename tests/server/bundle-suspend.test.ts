import { describe, expect, it } from 'vitest';
import { isBundleUsable } from '../../src/engine/usability';
import * as bundleStatus from '../../src/server/bundle-status';
import { suspendRuleBundle } from '../../src/server/bundle-status';
import { bundleContentHashOf, publishRuleBundle, restoreRuleBundle } from '../../src/server/bundle-publish';
import type { IdGenerator } from '../../src/server/domain/ports';
import { assignRuleScope, readClinicRuleBundle } from '../../src/server/rule-scope';
import { TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1, TEST_FIXTURE_RV_AUTHOR } from '../fixtures/server/actors.fixture';
import { makeBundleVersion, makeStatusEvent } from '../fixtures/server/entities.fixture';
import { catchDomainError } from '../fixtures/server/errors.fixture';
import {
  TEST_FIXTURE_RV_SUSPENDER,
  addClinics,
  clinicIdOf,
  publishSecondBundleOfSameItems,
  scopeWorld,
} from '../fixtures/server/governance.fixture';
import { snapshotOf } from '../fixtures/server/repo.fixture';
import { TEST_FIXTURE_RV_PUBLISHER, approveSpec, bundleWorld, engineSnapshotOf, publishRefs, validSpec } from '../fixtures/server/versioning.fixture';

// AC-011e 규칙 묶음 게시와 중지 (design.md DD-14 "규칙 묶음 가용성과 중지"). 도메인 서비스와 메모리 저장소만 쓰며 HTTP 경로는 없다.
//  - 게시가 ACTIVE 가용성 기록을 같은 트랜잭션에 쓴다.
//  - 중지가 수행자·역할·일시·사유가 든 SUSPENDED 기록을 덧붙이고 앞의 기록은 지우지 않는다.
//  - 묶음의 내용 해시와 묶음에 든 프로필·매핑·서류 규칙 항목의 상태는 그대로이고, 같은 항목 버전을 담은 두 번째 묶음은 계속 사용할 수 있다.
//  - 중지한 같은 묶음 id 를 다시 활성으로 돌리려는 시도는 거절되고, 사유가 빈 중지는 유형 있는 도메인 오류로 거절되며 기록을 쓰지 않는다.
// 같은 거절이 관리자 API 에서 400 이 되는 변환(AC-025f, AC-021f)과 권한 판정(AC-022a)은 M7 이다.

function replayingIds(fixed: Record<string, string>, base: IdGenerator): IdGenerator {
  return { next: (prefix) => fixed[prefix] ?? base.next(prefix) };
}

const SUSPEND_REASON = 'TEST_FIXTURE 약관 개정 확인 전까지 중지';

describe('AC-011e 게시는 ACTIVE 가용성 기록을 같은 트랜잭션에 쓴다', () => {
  it('게시한 묶음의 가용성 기록은 ACTIVE 하나이고 수행자·역할·시각이 게시와 같다', () => {
    const { world, bundle } = scopeWorld();
    expect(world.repo.listBundleStatusEvents(bundle.id)).toEqual([
      { bundleId: bundle.id, status: 'ACTIVE', actorId: TEST_FIXTURE_RV_PUBLISHER.id, role: 'RV', at: bundle.publishedAt, reason: null, previousStatus: null },
    ]);
    expect(world.repo.getBundleStatus(bundle.id)).toBe('ACTIVE');
  });

  it('게시가 거절되면 묶음도 가용성 기록도 남지 않는다 (같은 트랜잭션)', () => {
    const w = bundleWorld();
    const refs = approveSpec(w, validSpec(1));
    const before = snapshotOf(w.repo);
    const failing = { ...refs, documentRuleSet: { kind: 'DOCUMENT_RULE_SET', id: 'TEST_FIXTURE_NOPE', version: 'v1' } };
    expect(catchDomainError(() => publishRefs(w, failing)).code).toBe('PUBLISH_VALIDATION_FAILED');
    expect(snapshotOf(w.repo)).toEqual(before);
    expect(w.repo.listRuleBundleVersions()).toEqual([]);
    expect(w.repo.listBundleStatusEvents('TEST_FIXTURE_BUNDLE_1')).toEqual([]);
  });
});

describe('AC-011e 중지는 SUSPENDED 기록을 덧붙이고 앞의 기록을 지우지 않는다', () => {
  it('중지 기록에 수행자·역할·일시·사유·이전 상태가 담기고 ACTIVE 기록은 그대로 남는다', () => {
    const { world, bundle } = scopeWorld();
    const firstEvent = world.repo.listBundleStatusEvents(bundle.id)[0];
    world.clock.set('2026-10-17T10:30:00.000Z');

    const outcome = suspendRuleBundle(world.deps, TEST_FIXTURE_RV_SUSPENDER, bundle.id, SUSPEND_REASON);

    const events = world.repo.listBundleStatusEvents(bundle.id);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual(firstEvent);
    expect(events[1]).toEqual({
      bundleId: bundle.id,
      status: 'SUSPENDED',
      actorId: 'TEST_FIXTURE_RV_SUSPENDER',
      role: 'RV',
      at: '2026-10-17T10:30:00.000Z',
      reason: SUSPEND_REASON,
      previousStatus: 'ACTIVE',
    });
    expect(outcome.event).toEqual(events[1]);
    expect(world.repo.getBundleStatus(bundle.id)).toBe('SUSPENDED');
  });

  it('사유는 다듬지 않고 쓴 그대로 저장한다', () => {
    const { world, bundle } = scopeWorld();
    suspendRuleBundle(world.deps, TEST_FIXTURE_RV_SUSPENDER, bundle.id, '  TEST_FIXTURE 앞뒤 공백 포함  ');
    expect(world.repo.listBundleStatusEvents(bundle.id)[1]?.reason).toBe('  TEST_FIXTURE 앞뒤 공백 포함  ');
  });

  it('감사 기록이 수행자·역할·일시·사유·이전/이후 상태·영향을 받는 병원 수를 남긴다', () => {
    const { world, bundle } = scopeWorld();
    assignRuleScope(world.deps, TEST_FIXTURE_PO_1, clinicIdOf(1), bundle.id);
    assignRuleScope(world.deps, TEST_FIXTURE_PO_1, clinicIdOf(2), bundle.id);
    world.clock.set('2026-10-17T10:30:00.000Z');
    const auditBefore = world.repo.listAuditLog().length;

    suspendRuleBundle(world.deps, TEST_FIXTURE_RV_SUSPENDER, bundle.id, SUSPEND_REASON);

    const added = world.repo.listAuditLog().slice(auditBefore);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      actorId: 'TEST_FIXTURE_RV_SUSPENDER',
      role: 'RV',
      action: 'BUNDLE_SUSPEND',
      target: `BUNDLE/${bundle.id}`,
      beforeVersion: 'ACTIVE',
      afterVersion: 'SUSPENDED',
      reason: SUSPEND_REASON,
      at: '2026-10-17T10:30:00.000Z',
      affectedClinicCount: 2,
    });
  });

  it('영향을 받는 병원이 없으면 목록은 비고 감사 기록의 병원 수는 0 이다', () => {
    const { world, bundle } = scopeWorld();
    const outcome = suspendRuleBundle(world.deps, TEST_FIXTURE_RV_SUSPENDER, bundle.id, SUSPEND_REASON);
    expect(outcome.affectedClinics).toEqual([]);
    expect(world.repo.listAuditLog().at(-1)?.affectedClinicCount).toBe(0);
  });
});

describe('AC-011e 중지는 묶음 기록만 바꾼다 (내용 해시와 항목 상태는 그대로)', () => {
  it('묶음 버전 기록·내용 해시·itemRefs 가 그대로이고 저장된 항목 내용으로 해시를 다시 계산해도 같다', () => {
    const { world, bundle } = scopeWorld();
    const before = world.repo.getRuleBundleVersion(bundle.id);

    suspendRuleBundle(world.deps, TEST_FIXTURE_RV_SUSPENDER, bundle.id, SUSPEND_REASON);

    const after = world.repo.getRuleBundleVersion(bundle.id);
    expect(after).toEqual(before);
    expect(after?.contentHash).toBe(bundle.contentHash);
    expect(after?.itemRefs).toEqual(bundle.itemRefs);
    expect(bundleContentHashOf(world.repo, bundle.itemRefs)).toBe(bundle.contentHash);
  });

  it('프로필·매핑·서류 규칙 항목의 상태 기록(이력 포함)과 내용이 그대로다 (PUBLISHED)', () => {
    const { world, bundle } = scopeWorld();
    const statesBefore = bundle.itemRefs.map((ref) => world.repo.getItemState(ref));
    const recordsBefore = bundle.itemRefs.map((ref) => world.repo.getItemVersion(ref));
    expect(bundle.itemRefs.map((ref) => ref.kind).sort()).toEqual(['DOCUMENT_RULE_SET', 'MAPPING', 'PROFILE']);
    expect(statesBefore.map((state) => state?.state)).toEqual(['PUBLISHED', 'PUBLISHED', 'PUBLISHED']);

    suspendRuleBundle(world.deps, TEST_FIXTURE_RV_SUSPENDER, bundle.id, SUSPEND_REASON);

    expect(bundle.itemRefs.map((ref) => world.repo.getItemState(ref))).toEqual(statesBefore);
    expect(bundle.itemRefs.map((ref) => world.repo.getItemVersion(ref))).toEqual(recordsBefore);
    expect(world.repo.readItemStates(bundle.itemRefs).map((state) => state?.state)).toEqual(['PUBLISHED', 'PUBLISHED', 'PUBLISHED']);
  });

  it('중지 때 쓰이는 것은 가용성 기록 하나와 감사 기록 하나뿐이다 (저장소의 나머지 부분이 전후로 같다)', () => {
    const { world, bundle } = scopeWorld();
    const before = snapshotOf(world.repo);
    suspendRuleBundle(world.deps, TEST_FIXTURE_RV_SUSPENDER, bundle.id, SUSPEND_REASON);
    const after = snapshotOf(world.repo);
    const changed = Object.keys(after).filter((name) => JSON.stringify(after[name]) !== JSON.stringify(before[name]));
    expect(changed.sort()).toEqual(['auditLog', 'bundleEvents']);
  });

  it('규칙 사용 범위(현재 값과 이력)는 중지로 바뀌지 않고 중지된 묶음을 계속 가리킨다', () => {
    const { world, bundle } = scopeWorld();
    assignRuleScope(world.deps, TEST_FIXTURE_PO_1, clinicIdOf(1), bundle.id);
    assignRuleScope(world.deps, TEST_FIXTURE_PO_1, clinicIdOf(2), bundle.id);
    const scopesBefore = [1, 2, 3, 4].map((n) => [world.repo.getClinicRuleScope(clinicIdOf(n)), world.repo.listClinicRuleScopeHistory(clinicIdOf(n))]);

    suspendRuleBundle(world.deps, TEST_FIXTURE_RV_SUSPENDER, bundle.id, SUSPEND_REASON);

    expect([1, 2, 3, 4].map((n) => [world.repo.getClinicRuleScope(clinicIdOf(n)), world.repo.listClinicRuleScopeHistory(clinicIdOf(n))])).toEqual(scopesBefore);
    expect(readClinicRuleBundle(world.repo, clinicIdOf(1))).toEqual({ ruleBundleVersionId: bundle.id, ruleBundleStatus: 'SUSPENDED' });
  });

  it('엔진의 묶음 판정은 중지된 묶음을 RULE_BUNDLE_SUSPENDED 로, 중지 전에는 사용 가능으로 본다 (저장소에서 조립한 스냅샷)', () => {
    const { world, bundle } = scopeWorld();
    expect(isBundleUsable(engineSnapshotOf(world.repo, bundle.id)).usable).toBe(true);
    suspendRuleBundle(world.deps, TEST_FIXTURE_RV_SUSPENDER, bundle.id, SUSPEND_REASON);
    expect(isBundleUsable(engineSnapshotOf(world.repo, bundle.id))).toEqual({ usable: false, reason: 'BUNDLE_SUSPENDED' });
  });
});

describe('AC-011e 같은 항목 버전을 담은 두 번째 묶음은 계속 사용할 수 있다', () => {
  it('첫 묶음을 중지해도 두 번째 묶음의 가용성 기록·항목 상태·엔진 판정이 그대로다', () => {
    const { world, bundle: first, refs } = scopeWorld();
    const second = publishSecondBundleOfSameItems(world, refs);
    expect(second.id).not.toBe(first.id);
    expect(second.itemRefs).toEqual(first.itemRefs);
    expect(second.contentHash).toBe(first.contentHash);
    const secondEventsBefore = world.repo.listBundleStatusEvents(second.id);
    const secondRecordBefore = world.repo.getRuleBundleVersion(second.id);

    suspendRuleBundle(world.deps, TEST_FIXTURE_RV_SUSPENDER, first.id, SUSPEND_REASON);

    expect(world.repo.getBundleStatus(first.id)).toBe('SUSPENDED');
    expect(world.repo.getBundleStatus(second.id)).toBe('ACTIVE');
    expect(world.repo.listBundleStatusEvents(second.id)).toEqual(secondEventsBefore);
    expect(world.repo.getRuleBundleVersion(second.id)).toEqual(secondRecordBefore);
    expect(world.repo.readItemStates(second.itemRefs).map((state) => state?.state)).toEqual(['PUBLISHED', 'PUBLISHED', 'PUBLISHED']);
    expect(isBundleUsable(engineSnapshotOf(world.repo, second.id)).usable).toBe(true);
    expect(isBundleUsable(engineSnapshotOf(world.repo, first.id)).usable).toBe(false);
  });
});

describe('AC-011e 같은 묶음 id 를 다시 활성으로 돌리려는 시도는 거절된다', () => {
  function suspended() {
    const s = scopeWorld();
    suspendRuleBundle(s.world.deps, TEST_FIXTURE_RV_SUSPENDER, s.bundle.id, SUSPEND_REASON);
    return s;
  }

  it('저장소 수준: 중지된 묶음에 ACTIVE 사건을 쓰는 시도는 이전 상태가 무엇이든 STATE_CONFLICT 이고 아무것도 저장되지 않는다', () => {
    const { world, bundle } = suspended();
    const before = snapshotOf(world.repo);
    for (const previousStatus of ['SUSPENDED', 'ACTIVE', null] as const) {
      const attempt = makeStatusEvent({ bundleId: bundle.id, status: 'ACTIVE', previousStatus, actorId: TEST_FIXTURE_RV_SUSPENDER.id });
      expect(catchDomainError(() => world.repo.appendBundleStatusEvent(attempt)).code).toBe('STATE_CONFLICT');
    }
    expect(snapshotOf(world.repo)).toEqual(before);
    expect(world.repo.getBundleStatus(bundle.id)).toBe('SUSPENDED');
  });

  it('서비스 수준: 같은 항목·같은 시각의 게시가 중지된 묶음 id 를 다시 만들면(생성기 재생) 가용성 사슬이 막고 저장소는 그대로다', () => {
    const { world, bundle, refs } = suspended();
    const before = snapshotOf(world.repo);
    const deps = { ...world.deps, ids: replayingIds({ BUNDLE: bundle.id }, world.ids) };
    // 중지가 시계를 옮기지 않았으므로 게시 시각이 같고, 같은 게시자·같은 항목이면 묶음 기록은 같은 내용이어서 쓰기가 멱등이다. ACTIVE 사건만 막힌다.
    const error = catchDomainError(() => publishRuleBundle(deps, TEST_FIXTURE_RV_PUBLISHER, refs));
    expect(error.code).toBe('STATE_CONFLICT');
    expect(snapshotOf(world.repo)).toEqual(before);
    expect(world.repo.getBundleStatus(bundle.id)).toBe('SUSPENDED');
    expect(world.repo.listBundleStatusEvents(bundle.id)).toHaveLength(2);
  });

  it('이미 중지된 묶음을 다시 중지하는 것도 STATE_CONFLICT 이고 두 번째 SUSPENDED 기록이 쓰이지 않는다', () => {
    const { world, bundle } = suspended();
    const before = snapshotOf(world.repo);
    const error = catchDomainError(() => suspendRuleBundle(world.deps, TEST_FIXTURE_RV_SUSPENDER, bundle.id, '다시 중지'));
    expect(error.code).toBe('STATE_CONFLICT');
    expect(snapshotOf(world.repo)).toEqual(before);
    expect(world.repo.listBundleStatusEvents(bundle.id)).toHaveLength(2);
  });

  it('서비스 모듈이 내보내는 이름에 되살리기·재활성화 동작이 없다 (DD-14: 다시 활성으로 돌리는 동작은 없다)', () => {
    const names = Object.keys(bundleStatus);
    expect(names.sort()).toEqual(['suspendRuleBundle']);
    expect(names.filter((name) => /activate|resume|unsuspend|enable|restore|revive/i.test(name))).toEqual([]);
  });

  it('복구 경로: 새 묶음을 게시하고 영향을 받은 병원마다 범위를 다시 지정하면 새 묶음은 사용 가능하고 중지된 묶음은 SUSPENDED 로 남는다', () => {
    const s = scopeWorld();
    const { world, bundle: first } = s;
    assignRuleScope(world.deps, TEST_FIXTURE_PO_1, clinicIdOf(1), first.id);
    assignRuleScope(world.deps, TEST_FIXTURE_PO_1, clinicIdOf(2), first.id);
    const { affectedClinics } = suspendRuleBundle(world.deps, TEST_FIXTURE_RV_SUSPENDER, first.id, SUSPEND_REASON);

    const restored = restoreRuleBundle(world.deps, TEST_FIXTURE_RV_PUBLISHER, first.id);
    for (const { clinicId } of affectedClinics) {
      assignRuleScope(world.deps, TEST_FIXTURE_PO_1, clinicId, restored.id);
    }

    expect(restored.id).not.toBe(first.id);
    expect(restored.contentHash).toBe(first.contentHash);
    expect(world.repo.getBundleStatus(restored.id)).toBe('ACTIVE');
    expect(world.repo.getBundleStatus(first.id)).toBe('SUSPENDED');
    for (const n of [1, 2]) {
      expect(readClinicRuleBundle(world.repo, clinicIdOf(n))).toEqual({ ruleBundleVersionId: restored.id, ruleBundleStatus: 'ACTIVE' });
      expect(world.repo.listClinicRuleScopeHistory(clinicIdOf(n)).map((scope) => scope.ruleBundleVersionId)).toEqual([first.id, restored.id]);
    }
    expect(isBundleUsable(engineSnapshotOf(world.repo, restored.id)).usable).toBe(true);
    expect(isBundleUsable(engineSnapshotOf(world.repo, first.id)).usable).toBe(false);
  });
});

describe('AC-011e 사유가 비었거나 없는 중지는 유형 있는 도메인 오류로 거절되고 아무것도 쓰지 않는다', () => {
  it.each([
    ['빈 문자열', ''],
    ['공백뿐', '   '],
    ['탭·줄바꿈뿐', '\t\n \r'],
    ['사유 없음(undefined)', undefined],
    ['사유 null', null],
    ['숫자', 123],
    ['객체', { text: 'x' }],
  ])('사유가 %s 이면 REASON_REQUIRED, 결함 경로는 reason 이고 저장소 전후 비교가 같다', (_name, reason) => {
    const { world, bundle } = scopeWorld();
    assignRuleScope(world.deps, TEST_FIXTURE_PO_1, clinicIdOf(1), bundle.id);
    const before = snapshotOf(world.repo);

    const error = catchDomainError(() => suspendRuleBundle(world.deps, TEST_FIXTURE_RV_SUSPENDER, bundle.id, reason as unknown as string));

    expect(error.code).toBe('REASON_REQUIRED');
    expect(error.defects).toEqual([{ code: 'EMPTY', path: 'reason' }]);
    expect(snapshotOf(world.repo)).toEqual(before); // 감사 기록·가용성 기록 포함
    expect(world.repo.getBundleStatus(bundle.id)).toBe('ACTIVE');
    expect(world.repo.listBundleStatusEvents(bundle.id)).toHaveLength(1);
  });

  it('사유가 없는 거절은 거절 뒤 올바른 사유로 다시 부르면 그대로 중지된다 (거절이 상태를 남기지 않았다)', () => {
    const { world, bundle } = scopeWorld();
    expect(catchDomainError(() => suspendRuleBundle(world.deps, TEST_FIXTURE_RV_SUSPENDER, bundle.id, ' ')).code).toBe('REASON_REQUIRED');
    expect(suspendRuleBundle(world.deps, TEST_FIXTURE_RV_SUSPENDER, bundle.id, SUSPEND_REASON).event.status).toBe('SUSPENDED');
  });
});

describe('중지의 역할·대상 거절', () => {
  it.each([TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1])('RV 가 아닌 역할 %o 는 중지할 수 없다 (ROLE_NOT_PERMITTED, 사유가 비어 있어도 역할이 먼저)', (actor) => {
    const { world, bundle } = scopeWorld();
    const before = snapshotOf(world.repo);
    expect(catchDomainError(() => suspendRuleBundle(world.deps, actor, bundle.id, SUSPEND_REASON)).code).toBe('ROLE_NOT_PERMITTED');
    expect(catchDomainError(() => suspendRuleBundle(world.deps, actor, bundle.id, '')).code).toBe('ROLE_NOT_PERMITTED');
    expect(snapshotOf(world.repo)).toEqual(before);
  });

  it('작성자·게시자 RV 도 중지할 수 있다 (RV 이면 된다. 승인 분리 규칙은 중지에 적용하지 않는다)', () => {
    const { world, bundle } = scopeWorld();
    expect(suspendRuleBundle(world.deps, TEST_FIXTURE_RV_AUTHOR, bundle.id, SUSPEND_REASON).event.actorId).toBe(TEST_FIXTURE_RV_AUTHOR.id);
  });

  it('없는 묶음은 NOT_FOUND 이고 저장소는 그대로다', () => {
    const { world } = scopeWorld();
    const before = snapshotOf(world.repo);
    expect(catchDomainError(() => suspendRuleBundle(world.deps, TEST_FIXTURE_RV_SUSPENDER, 'TEST_FIXTURE_NO_SUCH_BUNDLE', SUSPEND_REASON)).code).toBe('NOT_FOUND');
    expect(snapshotOf(world.repo)).toEqual(before);
  });

  it('가용성 기록이 하나도 없는 묶음(게시 서비스를 거치지 않고 쓴 것)은 중지할 ACTIVE 가 없어 STATE_CONFLICT 이다', () => {
    const { world, refs } = scopeWorld();
    const bundle = makeBundleVersion({ id: 'TEST_FIXTURE_BUNDLE_RAW', itemRefs: [refs.profiles[0]!] });
    world.repo.putRuleBundleVersion(bundle);
    const before = snapshotOf(world.repo);
    expect(catchDomainError(() => suspendRuleBundle(world.deps, TEST_FIXTURE_RV_SUSPENDER, bundle.id, SUSPEND_REASON)).code).toBe('STATE_CONFLICT');
    expect(snapshotOf(world.repo)).toEqual(before);
  });

  it('감사 기록 id 가 이미 쓰였으면 중지 전체가 되돌려진다 (가용성 기록도 남지 않는다)', () => {
    const { world, bundle } = scopeWorld();
    const taken = world.repo.listAuditLog()[0]!.id;
    const before = snapshotOf(world.repo);
    const deps = { ...world.deps, ids: replayingIds({ AUDIT: taken }, world.ids) };
    expect(catchDomainError(() => suspendRuleBundle(deps, TEST_FIXTURE_RV_SUSPENDER, bundle.id, SUSPEND_REASON)).code).toBe('DUPLICATE_KEY');
    expect(snapshotOf(world.repo)).toEqual(before);
    expect(world.repo.getBundleStatus(bundle.id)).toBe('ACTIVE');
  });
});

describe('영향을 받는 병원 (DD-14: 현재 범위가 중지된 묶음을 가리키는 병원)', () => {
  it('현재 범위가 그 묶음인 병원만 병원 id 순으로 {clinicId, slug} 로 돌려준다', () => {
    const { world, bundle: a, refs } = scopeWorld();
    const b = publishSecondBundleOfSameItems(world, refs);
    // 병원 3 은 예전에 A 였다가 B 로 옮겼다(지난 이력은 해당하지 않는다). 병원 2·1 은 A, 병원 4 는 범위가 없다.
    assignRuleScope(world.deps, TEST_FIXTURE_PO_1, clinicIdOf(2), a.id);
    assignRuleScope(world.deps, TEST_FIXTURE_PO_1, clinicIdOf(3), a.id);
    assignRuleScope(world.deps, TEST_FIXTURE_PO_1, clinicIdOf(3), b.id);
    assignRuleScope(world.deps, TEST_FIXTURE_PO_1, clinicIdOf(1), a.id);

    const outcome = suspendRuleBundle(world.deps, TEST_FIXTURE_RV_SUSPENDER, a.id, SUSPEND_REASON);

    expect(outcome.affectedClinics).toEqual([
      { clinicId: 'TEST_FIXTURE_CLINIC_1', slug: 'test-fixture-clinic-1' },
      { clinicId: 'TEST_FIXTURE_CLINIC_2', slug: 'test-fixture-clinic-2' },
    ]);
    expect(world.repo.listAuditLog().at(-1)?.affectedClinicCount).toBe(2);
    // B 를 쓰는 병원 3 은 영향이 없다.
    expect(readClinicRuleBundle(world.repo, clinicIdOf(3))).toEqual({ ruleBundleVersionId: b.id, ruleBundleStatus: 'ACTIVE' });
    expect(readClinicRuleBundle(world.repo, clinicIdOf(4))).toEqual({ ruleBundleVersionId: null, ruleBundleStatus: null });
  });

  it('병원을 더 만든 순서와 범위를 지정한 순서가 달라도 결과 순서는 병원 id 순이다', () => {
    const { world, bundle } = scopeWorld();
    addClinics(world.repo, 7, 5, 6);
    for (const n of [7, 2, 6, 5, 3]) {
      assignRuleScope(world.deps, TEST_FIXTURE_PO_1, clinicIdOf(n), bundle.id);
    }
    const ids = suspendRuleBundle(world.deps, TEST_FIXTURE_RV_SUSPENDER, bundle.id, SUSPEND_REASON).affectedClinics.map((clinic) => clinic.clinicId);
    expect(ids).toEqual(['TEST_FIXTURE_CLINIC_2', 'TEST_FIXTURE_CLINIC_3', 'TEST_FIXTURE_CLINIC_5', 'TEST_FIXTURE_CLINIC_6', 'TEST_FIXTURE_CLINIC_7']);
  });
});

describe('중지 서비스의 결정성', () => {
  it('같은 시나리오를 새 세계 두 곳에서 돌리면 저장소 상태(감사 기록·가용성 기록 포함)가 같다', () => {
    function run() {
      const { world, bundle } = scopeWorld();
      assignRuleScope(world.deps, TEST_FIXTURE_PO_1, clinicIdOf(1), bundle.id);
      world.clock.set('2026-10-18T01:02:03.000Z');
      suspendRuleBundle(world.deps, TEST_FIXTURE_RV_SUSPENDER, bundle.id, SUSPEND_REASON);
      return snapshotOf(world.repo);
    }
    expect(run()).toEqual(run());
  });
});
