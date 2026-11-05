import { describe, expect, it } from 'vitest';
import { readCurrentPublishedState } from '../../src/server/current-published-state';
import { TEST_FIXTURE_CLINIC_ID } from '../fixtures/server/actors.fixture';
import { makeCatalogVersion, makeClinic, makeTreatment, makeTreatmentVersion } from '../fixtures/server/entities.fixture';
import { TEST_FIXTURE_TREATMENT_ID, newWorld, seedTreatment } from '../fixtures/server/lifecycle.fixture';
import type { World } from '../fixtures/server/lifecycle.fixture';
import { repoWith } from '../api/helpers';

// 현재 게시 상태 읽기 (M7 매핑 검토): 한 치료가 병원의 "현재 게시 목록"에 어떻게 있는지를 네 가지로 나누어 낸다.
//   PUBLISHED / HIDDEN(숨김) / NOT_IN_CATALOG(목록에 없음) / UNREADABLE(읽지 못함 — 데이터 결함).
// 읽지 못한 것을 "목록에 없음"으로 읽지 않는 것이 이 함수의 존재 이유다. 읽기만 하고 던지지 않는다.

const CLINIC = TEST_FIXTURE_CLINIC_ID;
const T1 = TEST_FIXTURE_TREATMENT_ID;
const OTHER_TREATMENT = 'TEST_FIXTURE_TREATMENT_2';

function setup(): World {
  const world = newWorld();
  seedTreatment(world.repo);
  return world;
}

/** 치료 둘(T1 · T2)을 담은 현재 카탈로그. */
function setupTwo(): World {
  const world = setup();
  world.repo.saveTreatment(makeTreatment({ id: OTHER_TREATMENT, sortOrder: 2 }));
  const second = makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_2', treatmentId: OTHER_TREATMENT, treatmentCode: 'TEST_FIXTURE_TC_2' });
  world.repo.putTreatmentVersion(second);
  const catalog = makeCatalogVersion({ id: 'TEST_FIXTURE_CATALOG_2', treatmentVersionIds: ['TEST_FIXTURE_TV_1', second.id], baseFeeIds: [] });
  world.repo.putCatalogVersion(catalog);
  world.repo.saveClinic(makeClinic({ currentCatalogVersionId: catalog.id }));
  return world;
}

describe('readCurrentPublishedState', () => {
  it('PUBLISHED: 현재 카탈로그가 담은 활성 치료는 치료·버전·카탈로그 버전 id 를 함께 낸다', () => {
    const world = setup();
    const state = readCurrentPublishedState(world.repo, CLINIC, T1);
    expect(state.kind).toBe('PUBLISHED');
    if (state.kind !== 'PUBLISHED') throw new Error('unreachable');
    expect(state.treatment.id).toBe(T1);
    expect(state.version.id).toBe('TEST_FIXTURE_TV_1');
    expect(state.version.treatmentCode).toBe('TEST_FIXTURE_TC_1');
    expect(state.catalogVersionId).toBe('TEST_FIXTURE_CATALOG_1');
  });

  it('HIDDEN: 그 병원의 치료이고 active=false 이면 숨긴 치료다', () => {
    const world = setup();
    world.repo.saveTreatment(makeTreatment({ active: false }));
    expect(readCurrentPublishedState(world.repo, CLINIC, T1)).toEqual({ kind: 'HIDDEN' });
  });

  it('NOT_IN_CATALOG: 병원에 현재 카탈로그가 없다', () => {
    const world = newWorld();
    world.repo.saveClinic(makeClinic());
    world.repo.saveTreatment(makeTreatment());
    expect(readCurrentPublishedState(world.repo, CLINIC, T1)).toEqual({ kind: 'NOT_IN_CATALOG' });
  });

  it('NOT_IN_CATALOG: 병원이 없다', () => {
    expect(readCurrentPublishedState(newWorld().repo, CLINIC, T1)).toEqual({ kind: 'NOT_IN_CATALOG' });
  });

  it('NOT_IN_CATALOG: 카탈로그가 담지 않은 활성 치료, 모르는 치료 id', () => {
    const world = setup();
    world.repo.saveTreatment(makeTreatment({ id: OTHER_TREATMENT, sortOrder: 2 }));
    expect(readCurrentPublishedState(world.repo, CLINIC, OTHER_TREATMENT)).toEqual({ kind: 'NOT_IN_CATALOG' });
    expect(readCurrentPublishedState(world.repo, CLINIC, 'TEST_FIXTURE_NO_SUCH')).toEqual({ kind: 'NOT_IN_CATALOG' });
  });

  it('NOT_IN_CATALOG: 다른 병원의 치료는 (숨겼든 아니든) 이 병원에서는 목록에 없는 것이다 — 다른 병원 자료를 드러내지 않는다', () => {
    const world = setup();
    world.repo.saveClinic(makeClinic({ id: 'TEST_FIXTURE_CLINIC_2', slug: 'test-fixture-clinic-2' }));
    world.repo.saveTreatment(makeTreatment({ id: 'TEST_FIXTURE_OTHER_ACTIVE', clinicId: 'TEST_FIXTURE_CLINIC_2' }));
    world.repo.saveTreatment(makeTreatment({ id: 'TEST_FIXTURE_OTHER_HIDDEN', clinicId: 'TEST_FIXTURE_CLINIC_2', active: false }));
    expect(readCurrentPublishedState(world.repo, CLINIC, 'TEST_FIXTURE_OTHER_ACTIVE')).toEqual({ kind: 'NOT_IN_CATALOG' });
    expect(readCurrentPublishedState(world.repo, CLINIC, 'TEST_FIXTURE_OTHER_HIDDEN')).toEqual({ kind: 'NOT_IN_CATALOG' });
  });

  it.each([
    ['TREATMENT_VERSION_MISSING', { getTreatmentVersion: () => null }],
    ['TREATMENT_MISSING', { getTreatment: () => null }],
    ['TREATMENT_CLINIC_MISMATCH', { getTreatment: () => makeTreatment({ clinicId: 'TEST_FIXTURE_CLINIC_2' }) }],
  ] as const)('UNREADABLE: 카탈로그 참조가 저장소와 맞지 않으면(%s) 던지지 않고 결함 코드를 낸다 — "목록에 없음"이 아니다', (code, override) => {
    const world = setup();
    const repo = repoWith(world.repo, override as Parameters<typeof repoWith>[1]);
    expect(readCurrentPublishedState(repo, CLINIC, T1)).toEqual({ kind: 'UNREADABLE', code });
  });

  it('UNREADABLE: 다른 항목에 결함이 있어도 게시 집합을 믿을 수 없으므로 (결함 없는) 이 치료도 읽지 못한 것이다', () => {
    const world = setupTwo();
    expect(readCurrentPublishedState(world.repo, CLINIC, T1).kind).toBe('PUBLISHED');
    // T2 의 치료 버전만 사라진 것처럼 읽히게 한다. T1 의 항목은 멀쩡하다.
    const repo = repoWith(world.repo, { getTreatmentVersion: ((id: string) => (id === 'TEST_FIXTURE_TV_2' ? null : world.repo.getTreatmentVersion(id))) as never });
    expect(readCurrentPublishedState(repo, CLINIC, T1)).toEqual({ kind: 'UNREADABLE', code: 'TREATMENT_VERSION_MISSING' });
    // 숨긴 치료도, 목록에 없는 치료도 같다: 결함이 있으면 어느 쪽으로도 단정하지 않는다.
    expect(readCurrentPublishedState(repo, CLINIC, 'TEST_FIXTURE_NO_SUCH')).toEqual({ kind: 'UNREADABLE', code: 'TREATMENT_VERSION_MISSING' });
  });

  it('읽기만 한다: 저장소 전체가 그대로다 (모든 분기)', () => {
    const world = setupTwo();
    world.repo.saveTreatment(makeTreatment({ id: OTHER_TREATMENT, sortOrder: 2, active: false }));
    const before = world.repo.exportState();
    for (const id of [T1, OTHER_TREATMENT, 'TEST_FIXTURE_NO_SUCH']) {
      readCurrentPublishedState(world.repo, CLINIC, id);
    }
    readCurrentPublishedState(repoWith(world.repo, { getTreatmentVersion: () => null }), CLINIC, T1);
    expect(world.repo.exportState()).toEqual(before);
  });
});
