import { describe, expect, it } from 'vitest';
import { previewBundlePublish, publishBundleFromBase } from '../../src/server/bundle-compose';
import { suspendRuleBundle } from '../../src/server/bundle-status';
import { assignRuleScopeChecked, readClinicScopeRow, readRuleScopeOverview } from '../../src/server/rule-scope-admin';
import { TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1 } from '../fixtures/server/actors.fixture';
import { approvedMapping, composeWorld } from '../fixtures/server/bundle-compose.fixture';
import type { ComposeWorld } from '../fixtures/server/bundle-compose.fixture';
import { catchDomainError } from '../fixtures/server/errors.fixture';
import { TEST_FIXTURE_RV_SUSPENDER } from '../fixtures/server/governance.fixture';
import { snapshotOf } from '../fixtures/server/repo.fixture';
import { OTHER_CLINIC_ID, TEST_FIXTURE_RV_PUBLISHER } from '../fixtures/server/versioning.fixture';

// PO 의 규칙 사용 범위 지정 (읽기 보기 + 기대 현재값 확인). 지정 자체는 기존 assignRuleScope 가 한다(PO 만, 감사 CLINIC_SCOPE_ASSIGN, 이력에 더함).
// 이 층이 더하는 것은 화면이 본 현재 범위가 그 사이 바뀌었으면 지정하지 않는 확인(SCOPE_CHANGED)이다. 모든 거절은 저장소 전체 비교가 같다.

const PO = TEST_FIXTURE_PO_1;
const CLINIC_1 = TEST_FIXTURE_CLINIC_ID;

/** 기준 묶음(병원 1 의 범위)에 매핑 하나를 더한 새 묶음을 게시한다. 병원에는 지정하지 않았다. */
function worldWithNewBundle(): ComposeWorld & { next: string } {
  const composed = composeWorld();
  const added = approvedMapping(composed.world, 'TEST_FIXTURE_MAPPING_ADDED_T3');
  const choice = { baseBundleId: composed.base.id, mappings: [added] };
  const next = publishBundleFromBase(composed.world.deps, TEST_FIXTURE_RV_PUBLISHER, { ...choice, publishConfirmation: previewBundlePublish(composed.world.deps, TEST_FIXTURE_RV_PUBLISHER, choice).publishConfirmation as string });
  return { ...composed, next: next.id };
}

describe('readRuleScopeOverview', () => {
  it('병원마다 현재 범위(묶음·가용성·지정 시각·지정자)를, 묶음마다 상태·게시 정보를 낸다. 범위가 없는 병원은 current 가 null 이고 읽기만 한다', () => {
    const { world, base, next } = worldWithNewBundle();
    suspendRuleBundle(world.deps, TEST_FIXTURE_RV_SUSPENDER, base.id, 'TEST_FIXTURE 중지');
    const before = snapshotOf(world.repo);

    const overview = readRuleScopeOverview(world.repo);

    expect(snapshotOf(world.repo)).toEqual(before);
    expect(overview.clinics).toEqual([
      { clinicId: CLINIC_1, slug: 'test-fixture-clinic-1', displayName: 'TEST_FIXTURE 시험 의원', current: { bundleId: base.id, status: 'SUSPENDED', assignedAt: expect.any(String), assignedBy: 'TEST_FIXTURE_PO_1' } },
      { clinicId: OTHER_CLINIC_ID, slug: 'test-fixture-clinic-2', displayName: expect.any(String), current: null },
    ]);
    expect(overview.bundles.map((bundle) => [bundle.bundleId, bundle.status])).toEqual([
      [next, 'ACTIVE'],
      [base.id, 'SUSPENDED'],
    ]);
    expect(overview.bundles[0]).toMatchObject({ publishedBy: TEST_FIXTURE_RV_PUBLISHER.id, itemCounts: { profiles: 1, mappings: 4, documentRuleSets: 1 }, contentHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(Object.keys(overview.bundles[0] ?? {})).not.toContain('clinics');
  });
});

describe('assignRuleScopeChecked', () => {
  it('화면이 본 현재 범위와 같으면 지정한다: 그 병원만 바뀌고 다른 병원은 그대로이며, 감사 기록에 이전/이후 묶음이 남는다', () => {
    const { world, base, next } = worldWithNewBundle();
    const auditBefore = world.repo.listAuditLog().length;
    const other = world.repo.getClinicRuleScope(OTHER_CLINIC_ID);
    world.clock.set('2026-10-18T10:00:00.000Z');

    const scope = assignRuleScopeChecked(world.deps, PO, CLINIC_1, next, base.id);

    expect(scope).toEqual({ clinicId: CLINIC_1, ruleBundleVersionId: next, assignedBy: { id: PO.id, role: 'PO' }, assignedAt: '2026-10-18T10:00:00.000Z' });
    expect(world.repo.getClinicRuleScope(CLINIC_1)).toEqual(scope);
    expect(world.repo.getClinicRuleScope(OTHER_CLINIC_ID)).toEqual(other);
    expect(world.repo.listClinicRuleScopeHistory(CLINIC_1).map((entry) => entry.ruleBundleVersionId)).toEqual([base.id, next]);
    const written = world.repo.listAuditLog().slice(auditBefore);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ action: 'CLINIC_SCOPE_ASSIGN', target: `CLINIC/${CLINIC_1}`, beforeVersion: base.id, afterVersion: next, actorId: PO.id, role: 'PO' });
  });

  it('범위가 없던 병원은 expectedCurrentBundleId 를 null 로 지정한다 (처음 지정의 이전 묶음은 null)', () => {
    const { world, next } = worldWithNewBundle();

    assignRuleScopeChecked(world.deps, PO, OTHER_CLINIC_ID, next, null);

    expect(world.repo.getClinicRuleScope(OTHER_CLINIC_ID)?.ruleBundleVersionId).toBe(next);
    expect(world.repo.listAuditLog().at(-1)).toMatchObject({ action: 'CLINIC_SCOPE_ASSIGN', beforeVersion: null, afterVersion: next });
  });

  it('그 사이 범위가 바뀌었으면 SCOPE_CHANGED 이고 아무것도 쓰지 않는다 (범위가 없다고 보았는데 있음 · 다른 묶음을 보았음 · 있다고 보았는데 없음)', () => {
    const { world, base, next } = worldWithNewBundle();
    const before = snapshotOf(world.repo);

    const sawNone = catchDomainError(() => assignRuleScopeChecked(world.deps, PO, CLINIC_1, next, null));
    expect(sawNone.code).toBe('STATE_CONFLICT');
    expect(sawNone.defects).toEqual([{ code: 'SCOPE_CHANGED', path: 'expectedCurrentBundleId' }]);
    expect(catchDomainError(() => assignRuleScopeChecked(world.deps, PO, CLINIC_1, next, next)).defects).toEqual([{ code: 'SCOPE_CHANGED', path: 'expectedCurrentBundleId' }]);
    expect(catchDomainError(() => assignRuleScopeChecked(world.deps, PO, OTHER_CLINIC_ID, next, base.id)).defects).toEqual([{ code: 'SCOPE_CHANGED', path: 'expectedCurrentBundleId' }]);
    expect(snapshotOf(world.repo)).toEqual(before);
  });

  it('없는 병원·없는 묶음은 NOT_FOUND 다 (기대 현재값이 맞지 않아도 NOT_FOUND 가 먼저이고, 아무것도 쓰지 않는다)', () => {
    const { world, base, next } = worldWithNewBundle();
    const before = snapshotOf(world.repo);

    expect(catchDomainError(() => assignRuleScopeChecked(world.deps, PO, 'TEST_FIXTURE_NO_SUCH_CLINIC', next, null)).code).toBe('NOT_FOUND');
    expect(catchDomainError(() => assignRuleScopeChecked(world.deps, PO, CLINIC_1, 'TEST_FIXTURE_NO_SUCH_BUNDLE', base.id)).code).toBe('NOT_FOUND');
    expect(catchDomainError(() => assignRuleScopeChecked(world.deps, PO, CLINIC_1, 'TEST_FIXTURE_NO_SUCH_BUNDLE', null)).code).toBe('NOT_FOUND');
    expect(snapshotOf(world.repo)).toEqual(before);
  });

  it.each([
    ['RV', TEST_FIXTURE_RV_PUBLISHER],
    ['HA', TEST_FIXTURE_HA_1],
  ])('%s 는 지정할 수 없다 (ROLE_NOT_PERMITTED, 저장소 그대로)', (_name, actor) => {
    const { world, base, next } = worldWithNewBundle();
    const before = snapshotOf(world.repo);
    expect(catchDomainError(() => assignRuleScopeChecked(world.deps, actor, CLINIC_1, next, base.id)).code).toBe('ROLE_NOT_PERMITTED');
    expect(snapshotOf(world.repo)).toEqual(before);
  });

  it('기존 계약 그대로 중지된 묶음도 지정할 수 있다(화면이 막는다)', () => {
    const { world, base, next } = worldWithNewBundle();
    suspendRuleBundle(world.deps, TEST_FIXTURE_RV_SUSPENDER, next, 'TEST_FIXTURE 중지');

    assignRuleScopeChecked(world.deps, PO, CLINIC_1, next, base.id);

    expect(world.repo.getClinicRuleScope(CLINIC_1)?.ruleBundleVersionId).toBe(next);
  });
});

describe('readClinicScopeRow', () => {
  it('지정 뒤의 병원 한 줄을 낸다 (응답이 화면의 그 줄을 새로 고치는 데 쓴다)', () => {
    const { world, next } = worldWithNewBundle();
    assignRuleScopeChecked(world.deps, PO, OTHER_CLINIC_ID, next, null);

    expect(readClinicScopeRow(world.repo, OTHER_CLINIC_ID)).toMatchObject({ clinicId: OTHER_CLINIC_ID, slug: 'test-fixture-clinic-2', current: { bundleId: next, status: 'ACTIVE', assignedBy: PO.id } });
    expect(readClinicScopeRow(world.repo, 'TEST_FIXTURE_NO_SUCH_CLINIC')).toBeNull();
  });
});
