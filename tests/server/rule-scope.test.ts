import { describe, expect, it } from 'vitest';
import { suspendRuleBundle } from '../../src/server/bundle-status';
import { assignRuleScope, findAffectedClinics, readClinicRuleBundle } from '../../src/server/rule-scope';
import { TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1, TEST_FIXTURE_RV_AUTHOR } from '../fixtures/server/actors.fixture';
import { catchDomainError } from '../fixtures/server/errors.fixture';
import { TEST_FIXTURE_RV_SUSPENDER, clinicIdOf, publishSecondBundleOfSameItems, scopeWorld } from '../fixtures/server/governance.fixture';
import { snapshotOf } from '../fixtures/server/repo.fixture';

// 병원별 규칙 사용 범위(ClinicRuleScope) 지정 서비스 (design.md DD-14, DD-17 권한 표: 지정은 플랫폼 운영자(PO)만).
// 역할만 본다: 병원 소속·인증·401/403 은 M7(AC-022a)이다. 이 서비스는 AC 를 혼자 닫지 않고 AC-011e(중지가 범위를 바꾸지 않음)와
// M4 의 영향 병원 계산·복구 경로(AC-011f)가 쓰는 도메인 쪽 동작이다.

describe('규칙 사용 범위 지정 (PO)', () => {
  it('PO 가 지정하면 이력에 더해지고 현재 값이 된다 (지정자·시각은 주입한 값)', () => {
    const { world, bundle } = scopeWorld();
    world.clock.set('2026-10-17T08:00:00.000Z');

    const scope = assignRuleScope(world.deps, TEST_FIXTURE_PO_1, clinicIdOf(1), bundle.id);

    expect(scope).toEqual({ clinicId: clinicIdOf(1), ruleBundleVersionId: bundle.id, assignedBy: { id: 'TEST_FIXTURE_PO_1', role: 'PO' }, assignedAt: '2026-10-17T08:00:00.000Z' });
    expect(world.repo.getClinicRuleScope(clinicIdOf(1))).toEqual(scope);
    expect(world.repo.listClinicRuleScopeHistory(clinicIdOf(1))).toEqual([scope]);
    expect(world.repo.getClinicRuleScope(clinicIdOf(2))).toBeNull();
  });

  it('다시 지정하면 이력에 쌓이고 마지막 지정이 현재 값이다 (같은 묶음을 다시 지정해도 이력에 남는다)', () => {
    const { world, bundle: a, refs } = scopeWorld();
    const b = publishSecondBundleOfSameItems(world, refs);
    assignRuleScope(world.deps, TEST_FIXTURE_PO_1, clinicIdOf(1), a.id);
    world.clock.set('2026-10-17T08:00:00.000Z');
    assignRuleScope(world.deps, TEST_FIXTURE_PO_1, clinicIdOf(1), b.id);
    assignRuleScope(world.deps, TEST_FIXTURE_PO_1, clinicIdOf(1), b.id);

    expect(world.repo.listClinicRuleScopeHistory(clinicIdOf(1)).map((scope) => scope.ruleBundleVersionId)).toEqual([a.id, b.id, b.id]);
    expect(world.repo.getClinicRuleScope(clinicIdOf(1))?.ruleBundleVersionId).toBe(b.id);
  });

  it('감사 기록이 지정자·역할·병원·이전/이후 묶음을 남긴다 (처음 지정의 이전은 null)', () => {
    const { world, bundle: a, refs } = scopeWorld();
    const b = publishSecondBundleOfSameItems(world, refs);
    const auditBefore = world.repo.listAuditLog().length;
    world.clock.set('2026-10-17T08:00:00.000Z');
    assignRuleScope(world.deps, TEST_FIXTURE_PO_1, clinicIdOf(1), a.id);
    assignRuleScope(world.deps, TEST_FIXTURE_PO_1, clinicIdOf(1), b.id);

    const added = world.repo.listAuditLog().slice(auditBefore);
    expect(added.map(({ id: _id, ...rest }) => rest)).toEqual([
      { actorId: 'TEST_FIXTURE_PO_1', role: 'PO', action: 'CLINIC_SCOPE_ASSIGN', target: `CLINIC/${clinicIdOf(1)}`, beforeVersion: null, afterVersion: a.id, reason: null, at: '2026-10-17T08:00:00.000Z' },
      { actorId: 'TEST_FIXTURE_PO_1', role: 'PO', action: 'CLINIC_SCOPE_ASSIGN', target: `CLINIC/${clinicIdOf(1)}`, beforeVersion: a.id, afterVersion: b.id, reason: null, at: '2026-10-17T08:00:00.000Z' },
    ]);
  });

  it.each([TEST_FIXTURE_HA_1, TEST_FIXTURE_RV_AUTHOR])('PO 가 아닌 역할 %o 는 지정할 수 없다 (ROLE_NOT_PERMITTED, 저장소 전후 비교가 같다)', (actor) => {
    const { world, bundle } = scopeWorld();
    const before = snapshotOf(world.repo);
    expect(catchDomainError(() => assignRuleScope(world.deps, actor, clinicIdOf(1), bundle.id)).code).toBe('ROLE_NOT_PERMITTED');
    expect(snapshotOf(world.repo)).toEqual(before);
  });

  it('없는 병원, 없는 묶음은 NOT_FOUND 이고 저장소는 그대로다', () => {
    const { world, bundle } = scopeWorld();
    const before = snapshotOf(world.repo);
    expect(catchDomainError(() => assignRuleScope(world.deps, TEST_FIXTURE_PO_1, 'TEST_FIXTURE_CLINIC_NOPE', bundle.id)).code).toBe('NOT_FOUND');
    expect(catchDomainError(() => assignRuleScope(world.deps, TEST_FIXTURE_PO_1, clinicIdOf(1), 'TEST_FIXTURE_BUNDLE_NOPE')).code).toBe('NOT_FOUND');
    expect(catchDomainError(() => assignRuleScope(world.deps, TEST_FIXTURE_PO_1, 'TEST_FIXTURE_CLINIC_NOPE', 'TEST_FIXTURE_BUNDLE_NOPE')).code).toBe('NOT_FOUND');
    expect(snapshotOf(world.repo)).toEqual(before);
  });

  it('[문서에 없음] 중지된 묶음도 지정할 수 있다 (지정은 기록일 뿐이고, 계산은 그 묶음을 RULE_BUNDLE_SUSPENDED 보류로 다룬다)', () => {
    const { world, bundle } = scopeWorld();
    suspendRuleBundle(world.deps, TEST_FIXTURE_RV_SUSPENDER, bundle.id, '중지 사유');
    assignRuleScope(world.deps, TEST_FIXTURE_PO_1, clinicIdOf(1), bundle.id);
    expect(readClinicRuleBundle(world.repo, clinicIdOf(1))).toEqual({ ruleBundleVersionId: bundle.id, ruleBundleStatus: 'SUSPENDED' });
  });

  it('지정은 묶음 기록·가용성 기록·항목 상태를 바꾸지 않는다', () => {
    const { world, bundle } = scopeWorld();
    const before = snapshotOf(world.repo);
    assignRuleScope(world.deps, TEST_FIXTURE_PO_1, clinicIdOf(1), bundle.id);
    const after = snapshotOf(world.repo);
    const changed = Object.keys(after).filter((name) => JSON.stringify(after[name]) !== JSON.stringify(before[name]));
    expect(changed.sort()).toEqual(['auditLog', 'scopeHistory']);
  });

  it('감사 기록 id 가 이미 쓰였으면 지정 전체가 되돌려진다 (범위 이력에 남지 않는다)', () => {
    const { world, bundle } = scopeWorld();
    const taken = world.repo.listAuditLog()[0]!.id;
    const before = snapshotOf(world.repo);
    const deps = { ...world.deps, ids: { next: (prefix: string) => (prefix === 'AUDIT' ? taken : world.ids.next(prefix)) } };
    expect(catchDomainError(() => assignRuleScope(deps, TEST_FIXTURE_PO_1, clinicIdOf(1), bundle.id)).code).toBe('DUPLICATE_KEY');
    expect(snapshotOf(world.repo)).toEqual(before);
    expect(world.repo.getClinicRuleScope(clinicIdOf(1))).toBeNull();
  });
});

describe('범위와 묶음 가용성 읽기 (readClinicRuleBundle, M4 의 options 응답이 쓰는 값)', () => {
  it('범위가 없는 병원은 묶음 id 도 상태도 null 이다', () => {
    const { world } = scopeWorld();
    expect(readClinicRuleBundle(world.repo, clinicIdOf(1))).toEqual({ ruleBundleVersionId: null, ruleBundleStatus: null });
  });

  it('범위가 있으면 묶음 id 와 현재 가용성을 호출할 때마다 새로 읽는다 (중지 뒤에도 id 는 같다)', () => {
    const { world, bundle } = scopeWorld();
    assignRuleScope(world.deps, TEST_FIXTURE_PO_1, clinicIdOf(1), bundle.id);
    expect(readClinicRuleBundle(world.repo, clinicIdOf(1))).toEqual({ ruleBundleVersionId: bundle.id, ruleBundleStatus: 'ACTIVE' });
    suspendRuleBundle(world.deps, TEST_FIXTURE_RV_SUSPENDER, bundle.id, '중지 사유');
    expect(readClinicRuleBundle(world.repo, clinicIdOf(1))).toEqual({ ruleBundleVersionId: bundle.id, ruleBundleStatus: 'SUSPENDED' });
  });

  it('읽기는 저장소를 바꾸지 않고 돌려준 값을 고쳐도 저장소에 영향이 없다', () => {
    const { world, bundle } = scopeWorld();
    assignRuleScope(world.deps, TEST_FIXTURE_PO_1, clinicIdOf(1), bundle.id);
    const before = snapshotOf(world.repo);
    const read = readClinicRuleBundle(world.repo, clinicIdOf(1));
    read.ruleBundleStatus = null;
    expect(snapshotOf(world.repo)).toEqual(before);
    expect(readClinicRuleBundle(world.repo, clinicIdOf(1)).ruleBundleStatus).toBe('ACTIVE');
  });
});

describe('영향을 받는 병원 찾기 (findAffectedClinics)', () => {
  it('묶음을 가리키는 현재 범위만 센다 (이력은 세지 않고, 읽기는 저장소를 바꾸지 않는다)', () => {
    const { world, bundle: a, refs } = scopeWorld();
    const b = publishSecondBundleOfSameItems(world, refs);
    assignRuleScope(world.deps, TEST_FIXTURE_PO_1, clinicIdOf(2), a.id);
    assignRuleScope(world.deps, TEST_FIXTURE_PO_1, clinicIdOf(2), b.id);
    assignRuleScope(world.deps, TEST_FIXTURE_PO_1, clinicIdOf(3), a.id);
    const before = snapshotOf(world.repo);

    expect(findAffectedClinics(world.repo, a.id)).toEqual([{ clinicId: clinicIdOf(3), slug: 'test-fixture-clinic-3' }]);
    expect(findAffectedClinics(world.repo, b.id)).toEqual([{ clinicId: clinicIdOf(2), slug: 'test-fixture-clinic-2' }]);
    expect(findAffectedClinics(world.repo, 'TEST_FIXTURE_BUNDLE_NOPE')).toEqual([]);
    expect(snapshotOf(world.repo)).toEqual(before);
  });
});
