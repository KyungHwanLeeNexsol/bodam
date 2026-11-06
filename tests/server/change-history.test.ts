import { describe, expect, it } from 'vitest';
import { CHANGE_HISTORY_ACTIONS, CHANGE_HISTORY_LIMIT, readClinicChangeHistory } from '../../src/server/change-history';
import type { AuditLogEntry } from '../../src/server/domain/entities';
import { TEST_FIXTURE_CLINIC_ID } from '../fixtures/server/actors.fixture';
import { publishSecondClinicCatalog } from '../fixtures/server/api-composition.fixture';
import { addThirdTreatment } from '../fixtures/server/catalog-structure.fixture';
import { makeAuditEntry, makeClinic } from '../fixtures/server/entities.fixture';
import { buildWorld } from '../fixtures/server/estimate-world.fixture';
import { OTHER_CLINIC_ID } from '../fixtures/server/versioning.fixture';

// 병원 관리자 변경 이력 읽기 (M7 변경 이력, src/server/change-history.ts). 직접 만든 감사 기록으로 병원 소유 판정·허용 동작·순서·상한·응답 필드·읽기 전용을 본다.
// 세계: 병원 1(카탈로그 둘: 처음 것과 치료 셋째를 더한 것)과 병원 2(카탈로그 하나). 세계를 만드는 과정이 이미 감사 기록(CATALOG_PUBLISH 등)을 남긴다 — 그 기록은 허용 동작이 아니라서 보이지 않아야 한다.

function setup() {
  const built = buildWorld();
  const second = publishSecondClinicCatalog(built.world);
  const third = addThirdTreatment(built.world);
  const repo = built.world.repo;
  let counter = 0;
  const add = (overrides: Partial<AuditLogEntry>): AuditLogEntry => {
    counter += 1;
    const entry = makeAuditEntry({ id: `TEST_FIXTURE_AUDIT_HISTORY_${counter}`, role: 'HA', actorId: 'TEST_FIXTURE_HA_CLINIC_1', ...overrides });
    repo.appendAuditLog(entry);
    return entry;
  };
  return { repo, first: built.catalog, third, second, clinic1: repo.getClinic(TEST_FIXTURE_CLINIC_ID)!, clinic2: repo.getClinic(OTHER_CLINIC_ID)!, add };
}

type Setup = ReturnType<typeof setup>;

const draftOf = (clinicId: string, action = 'CATALOG_DRAFT_SAVE'): Partial<AuditLogEntry> => ({ action, target: `CATALOG_DRAFT/${clinicId}`, beforeVersion: null, afterVersion: 'DIGEST_AFTER' });
const idleOf = (clinicId: string): Partial<AuditLogEntry> => ({ action: 'IDLE_POLICY_SAVE', target: `CLINIC/${clinicId}/IDLE_POLICY`, beforeVersion: null, afterVersion: 'DIGEST_POLICY' });
const publishOf = (afterId: string, beforeId: string | null): Partial<AuditLogEntry> => ({ action: 'CATALOG_DRAFT_PUBLISH', target: `CATALOG/${afterId}`, beforeVersion: beforeId, afterVersion: afterId, reason: 'DRAFT_OF:DIGEST' });

const idsOf = (world: Setup, which: 'clinic1' | 'clinic2'): string[] => readClinicChangeHistory(world.repo, world[which]).entries.map((entry) => entry.target + '|' + entry.action);

describe('허용 동작만 보인다', () => {
  it('세계를 만드는 과정의 기록(CATALOG_PUBLISH)은 대상이 이 병원의 카탈로그를 가리켜도 보이지 않는다. 이력은 비어 있다', () => {
    const world = setup();
    // 전제: 세계가 남긴 기록 가운데 대상이 병원 1 의 실제 카탈로그와 같은 기록이 있다.
    expect(world.repo.listAuditLog().some((entry) => entry.action === 'CATALOG_PUBLISH' && entry.target === `CATALOG/${world.first.id}`)).toBe(true);
    const history = readClinicChangeHistory(world.repo, world.clinic1);
    expect(history.entries).toEqual([]);
    expect(history.page).toEqual({ limit: CHANGE_HISTORY_LIMIT, returned: 0, total: 0, truncated: false });
  });

  it('목록은 네 동작이고 coveredActions 가 그대로 알린다. 목록 밖의 동작은 대상이 이 병원의 것과 일치해도 나오지 않는다', () => {
    const world = setup();
    expect([...CHANGE_HISTORY_ACTIONS]).toEqual(['CATALOG_DRAFT_SAVE', 'CATALOG_DRAFT_DISCARD', 'CATALOG_DRAFT_PUBLISH', 'IDLE_POLICY_SAVE']);
    world.add(draftOf(TEST_FIXTURE_CLINIC_ID));
    world.add(draftOf(TEST_FIXTURE_CLINIC_ID, 'CATALOG_DRAFT_DISCARD'));
    world.add(publishOf(world.third.id, world.first.id));
    world.add(idleOf(TEST_FIXTURE_CLINIC_ID));
    // 목록 밖: 같은 대상을 쓰는 다른 동작과 동작 이름을 흉내 낸 값.
    for (const action of ['CATALOG_PUBLISH', 'CATALOG_RESTORE', 'ITEM_EDIT_DRAFT', 'BUNDLE_SUSPEND', 'CLINIC_SCOPE_ASSIGN', 'catalog_draft_save', 'CATALOG_DRAFT_SAVE ', 'CATALOG_DRAFT_SAVE2', '']) {
      world.add({ ...draftOf(TEST_FIXTURE_CLINIC_ID), action });
      world.add({ ...idleOf(TEST_FIXTURE_CLINIC_ID), action });
      world.add({ ...publishOf(world.third.id, world.first.id), action });
    }
    const history = readClinicChangeHistory(world.repo, world.clinic1);
    expect(history.coveredActions).toEqual(CHANGE_HISTORY_ACTIONS);
    expect(history.entries.map((entry) => entry.action).sort()).toEqual(['CATALOG_DRAFT_DISCARD', 'CATALOG_DRAFT_PUBLISH', 'CATALOG_DRAFT_SAVE', 'IDLE_POLICY_SAVE']);
    expect(history.page.total).toBe(4);
  });
});

describe('병원 격리: 자기 병원 기록만', () => {
  it('병원 1·2 의 기록을 섞어도 각자 자기 기록만 읽고, 합이 전체와 같다', () => {
    const world = setup();
    world.add(draftOf(TEST_FIXTURE_CLINIC_ID));
    world.add(draftOf(OTHER_CLINIC_ID));
    world.add(idleOf(OTHER_CLINIC_ID));
    world.add(idleOf(TEST_FIXTURE_CLINIC_ID));
    world.add(publishOf(world.second.id, null));
    world.add(publishOf(world.third.id, world.first.id));
    expect(idsOf(world, 'clinic1')).toEqual([`CATALOG/${world.third.id}|CATALOG_DRAFT_PUBLISH`, `CLINIC/${TEST_FIXTURE_CLINIC_ID}/IDLE_POLICY|IDLE_POLICY_SAVE`, `CATALOG_DRAFT/${TEST_FIXTURE_CLINIC_ID}|CATALOG_DRAFT_SAVE`]);
    expect(idsOf(world, 'clinic2')).toEqual([`CATALOG/${world.second.id}|CATALOG_DRAFT_PUBLISH`, `CLINIC/${OTHER_CLINIC_ID}/IDLE_POLICY|IDLE_POLICY_SAVE`, `CATALOG_DRAFT/${OTHER_CLINIC_ID}|CATALOG_DRAFT_SAVE`]);
  });

  it('비슷한 병원 id(접두·접미·슬래시 포함)의 기록은 서로 보이지 않는다: 소유는 기대 대상과의 정확한 일치뿐이다', () => {
    const world = setup();
    const SIMILAR = [`${TEST_FIXTURE_CLINIC_ID}0`, `${TEST_FIXTURE_CLINIC_ID}_B`, `${TEST_FIXTURE_CLINIC_ID}/IDLE_POLICY`, `${TEST_FIXTURE_CLINIC_ID.toLowerCase()}`];
    SIMILAR.forEach((id, index) => world.repo.saveClinic(makeClinic({ id, slug: `similar-clinic-${index}` })));
    for (const id of [TEST_FIXTURE_CLINIC_ID, ...SIMILAR]) {
      world.add(draftOf(id));
      world.add(idleOf(id));
    }
    // 병원 1 의 대상에 무언가 덧붙인 값도 병원 1 의 기록이 아니다.
    for (const target of [`CATALOG_DRAFT/${TEST_FIXTURE_CLINIC_ID}/x`, `CATALOG_DRAFT/${TEST_FIXTURE_CLINIC_ID} `, ` CATALOG_DRAFT/${TEST_FIXTURE_CLINIC_ID}`, `X/CATALOG_DRAFT/${TEST_FIXTURE_CLINIC_ID}`, `CLINIC/${TEST_FIXTURE_CLINIC_ID}/IDLE_POLICYX`, `CLINIC/${TEST_FIXTURE_CLINIC_ID}/IDLE_POLICY/`]) {
      world.add({ ...draftOf(TEST_FIXTURE_CLINIC_ID), target });
      world.add({ ...idleOf(TEST_FIXTURE_CLINIC_ID), target });
    }
    expect(idsOf(world, 'clinic1').sort()).toEqual([`CATALOG_DRAFT/${TEST_FIXTURE_CLINIC_ID}|CATALOG_DRAFT_SAVE`, `CLINIC/${TEST_FIXTURE_CLINIC_ID}/IDLE_POLICY|IDLE_POLICY_SAVE`].sort());
    for (const id of SIMILAR) {
      const clinic = world.repo.getClinic(id)!;
      const own = readClinicChangeHistory(world.repo, clinic);
      expect(own.entries.map((entry) => entry.target).sort(), id).toEqual([`CATALOG_DRAFT/${id}`, `CLINIC/${id}/IDLE_POLICY`].sort());
      expect(own.page.total, id).toBe(2);
    }
  });

  it('초안 게시는 병원의 실제 카탈로그 버전과 연결된다: 다른 병원의 카탈로그를 가리키거나 이후·이전 버전이 어긋난 기록은 어느 병원에도 보이지 않는다', () => {
    const world = setup();
    const okFirst = world.add(publishOf(world.third.id, world.first.id));
    const okFresh = world.add(publishOf(world.first.id, null));
    const okOther = world.add(publishOf(world.second.id, null));
    // 소유를 확인할 수 없는 기록들.
    world.add({ ...publishOf(world.third.id, world.first.id), afterVersion: world.first.id }); // 대상과 이후 버전이 다르다
    world.add({ ...publishOf(world.third.id, world.second.id) }); // 이전 버전이 다른 병원의 카탈로그다
    world.add({ ...publishOf(world.third.id, 'TEST_FIXTURE_CATALOG_GHOST') }); // 이전 버전이 어느 병원에도 없다
    world.add(publishOf('TEST_FIXTURE_CATALOG_GHOST', null)); // 없는 카탈로그
    world.add({ ...publishOf(world.third.id, world.first.id), target: `CATALOG/${world.third.id} ` });
    world.add({ ...publishOf(world.third.id, world.first.id), target: `CATALOG_DRAFT/${world.third.id}` });
    world.add({ ...publishOf(world.third.id, world.first.id), target: '' });
    world.add({ ...publishOf(world.second.id, null), afterVersion: null });
    const one = readClinicChangeHistory(world.repo, world.clinic1);
    const two = readClinicChangeHistory(world.repo, world.clinic2);
    expect(one.entries.map((entry) => entry.afterVersion)).toEqual([world.first.id, world.third.id]);
    expect(two.entries.map((entry) => entry.afterVersion)).toEqual([world.second.id]);
    // 소유 불명 기록은 합계에도 세지 않는다(존재를 알리지 않는다).
    expect(one.page.total).toBe(2);
    expect(two.page.total).toBe(1);
    expect([okFirst, okFresh, okOther].length).toBe(3);
  });

  it('저장소가 병원별로 걸러 주지 않고 다른 병원의 카탈로그 버전까지 돌려주더라도(저장소 결함) 병원 소유를 한 번 더 확인한다', () => {
    const world = setup();
    world.add(publishOf(world.second.id, null)); // 병원 2 의 카탈로그를 가리키는 게시 기록
    world.add(publishOf(world.third.id, world.first.id)); // 병원 1 의 게시 기록
    const leaky = new Proxy(world.repo, {
      get(target, property) {
        const value = Reflect.get(target, property, target) as unknown;
        if (property === 'listCatalogVersions') return () => [...target.listCatalogVersions(TEST_FIXTURE_CLINIC_ID), ...target.listCatalogVersions(OTHER_CLINIC_ID)];
        return typeof value === 'function' ? (...args: unknown[]) => (value as (...rest: unknown[]) => unknown).apply(target, args) : value;
      },
    });
    expect(readClinicChangeHistory(leaky, world.clinic1).entries.map((entry) => entry.afterVersion)).toEqual([world.third.id]);
    expect(readClinicChangeHistory(leaky, world.clinic2).entries.map((entry) => entry.afterVersion)).toEqual([world.second.id]);
  });

  it('없는 병원·없는 카탈로그를 가리키는 기록(소유 불명)은 어느 병원에도 보이지 않고 합계에도 없다', () => {
    const world = setup();
    world.add(draftOf('TEST_FIXTURE_CLINIC_GHOST'));
    world.add(idleOf('TEST_FIXTURE_CLINIC_GHOST'));
    world.add(draftOf(''));
    world.add({ ...idleOf(TEST_FIXTURE_CLINIC_ID), target: 'CLINIC//IDLE_POLICY' });
    for (const which of ['clinic1', 'clinic2'] as const) {
      const history = readClinicChangeHistory(world.repo, world[which]);
      expect(history.entries).toEqual([]);
      expect(history.page.total).toBe(0);
    }
  });
});

describe('순서와 번호', () => {
  it('시각이 같은 기록도 저장 순서의 역순으로 갈리고 번호는 이 병원 기록 안에서만 센다', () => {
    const world = setup();
    const at = '2026-10-16T09:00:00.000Z';
    world.add({ ...draftOf(TEST_FIXTURE_CLINIC_ID), at, afterVersion: 'A' });
    world.add({ ...draftOf(OTHER_CLINIC_ID), at, afterVersion: 'OTHER_1' });
    world.add({ ...draftOf(TEST_FIXTURE_CLINIC_ID), at, afterVersion: 'B' });
    world.add({ ...draftOf(OTHER_CLINIC_ID), at, afterVersion: 'OTHER_2' });
    world.add({ ...draftOf(TEST_FIXTURE_CLINIC_ID), at, afterVersion: 'C' });
    const history = readClinicChangeHistory(world.repo, world.clinic1);
    expect(history.entries.map((entry) => [entry.sequence, entry.afterVersion])).toEqual([[3, 'C'], [2, 'B'], [1, 'A']]);
    // 다른 병원의 기록이 사이에 있어도 번호에 빈틈이 없다.
    expect(readClinicChangeHistory(world.repo, world.clinic2).entries.map((entry) => entry.sequence)).toEqual([2, 1]);
  });

  it('정렬 기준은 시각이 아니라 저장 순서다: 나중에 저장된 기록의 시각이 더 이르더라도 맨 위에 온다', () => {
    const world = setup();
    world.add({ ...draftOf(TEST_FIXTURE_CLINIC_ID), at: '2026-10-16T10:00:00.000Z', afterVersion: 'LATER_TIME' });
    world.add({ ...draftOf(TEST_FIXTURE_CLINIC_ID), at: '2026-10-16T08:00:00.000Z', afterVersion: 'EARLIER_TIME_STORED_LAST' });
    expect(readClinicChangeHistory(world.repo, world.clinic1).entries.map((entry) => entry.afterVersion)).toEqual(['EARLIER_TIME_STORED_LAST', 'LATER_TIME']);
  });
});

describe('건수 상한과 합계 (소유 필터 뒤에 센다)', () => {
  it('가장 최근 100건만 낸다: 합계는 이 병원 기록 전체이고 다른 병원의 기록은 합계·번호에 들어가지 않는다', () => {
    const world = setup();
    for (let index = 1; index <= 130; index += 1) {
      world.add({ ...draftOf(TEST_FIXTURE_CLINIC_ID), afterVersion: `OWN_${index}` });
      if (index % 6 === 0) world.add({ ...draftOf(OTHER_CLINIC_ID), afterVersion: `OTHER_${index}` });
    }
    const history = readClinicChangeHistory(world.repo, world.clinic1);
    expect(CHANGE_HISTORY_LIMIT).toBe(100);
    expect(history.page).toEqual({ limit: 100, returned: 100, total: 130, truncated: true });
    expect(history.entries).toHaveLength(100);
    expect(history.entries[0]).toMatchObject({ sequence: 130, afterVersion: 'OWN_130' });
    expect(history.entries[99]).toMatchObject({ sequence: 31, afterVersion: 'OWN_31' });
    expect(history.entries.map((entry) => entry.sequence)).toEqual(Array.from({ length: 100 }, (_, index) => 130 - index));
    expect(history.entries.every((entry) => entry.afterVersion!.startsWith('OWN_'))).toBe(true);
    const other = readClinicChangeHistory(world.repo, world.clinic2);
    expect(other.page).toEqual({ limit: 100, returned: 21, total: 21, truncated: false });
    expect(other.entries[0]!.sequence).toBe(21);
  });

  it('정확히 100건이면 잘리지 않았고 101건이면 잘렸다', () => {
    const world = setup();
    for (let index = 1; index <= 100; index += 1) world.add({ ...draftOf(TEST_FIXTURE_CLINIC_ID), afterVersion: `N_${index}` });
    expect(readClinicChangeHistory(world.repo, world.clinic1).page).toEqual({ limit: 100, returned: 100, total: 100, truncated: false });
    world.add({ ...draftOf(TEST_FIXTURE_CLINIC_ID), afterVersion: 'N_101' });
    const history = readClinicChangeHistory(world.repo, world.clinic1);
    expect(history.page).toEqual({ limit: 100, returned: 100, total: 101, truncated: true });
    expect(history.entries[0]!.sequence).toBe(101);
    expect(history.entries[99]!.sequence).toBe(2);
  });
});

describe('응답에는 허용한 필드만 있다', () => {
  it('항목 필드가 고정이고, 기록에 딸려 있는 다른 속성(영향 병원 수·몰래 끼운 값)은 옮기지 않는다', () => {
    const world = setup();
    const smuggled = { ...draftOf(TEST_FIXTURE_CLINIC_ID), reason: '기록된 사유', affectedClinicCount: 7, revision: 'SECRET_REVISION', publishConfirmation: 'SECRET_CONFIRMATION' } as Partial<AuditLogEntry>;
    world.add({ ...smuggled, actorId: 'TEST_FIXTURE_HA_CLINIC_1B' });
    const history = readClinicChangeHistory(world.repo, world.clinic1);
    expect(Object.keys(history).sort()).toEqual(['clinic', 'coveredActions', 'entries', 'page']);
    expect(history.clinic).toEqual({ id: TEST_FIXTURE_CLINIC_ID, displayName: world.clinic1.name });
    const entry = history.entries[0]!;
    expect(Object.keys(entry).sort()).toEqual(['action', 'actor', 'afterVersion', 'at', 'beforeVersion', 'reason', 'sequence', 'target']);
    expect(Object.keys(entry.actor).sort()).toEqual(['id', 'role']);
    expect(entry).toMatchObject({ actor: { id: 'TEST_FIXTURE_HA_CLINIC_1B', role: 'HA' }, reason: '기록된 사유' });
    const text = JSON.stringify(history);
    for (const forbidden of ['SECRET_REVISION', 'SECRET_CONFIRMATION', 'affectedClinicCount', 'revision', 'publishConfirmation', 'TEST_FIXTURE_AUDIT_HISTORY']) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });
});

describe('읽기만 한다', () => {
  it('저장소 전체 사본이 전후 같고, 부른 저장소 메서드는 listAuditLog·listCatalogVersions 뿐이다', () => {
    const world = setup();
    world.add(draftOf(TEST_FIXTURE_CLINIC_ID));
    world.add(publishOf(world.third.id, world.first.id));
    const before = world.repo.exportState();
    const calls = new Set<string>();
    const spy = new Proxy(world.repo, {
      get(target, property) {
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === 'function'
          ? (...args: unknown[]) => {
              calls.add(String(property));
              return (value as (...rest: unknown[]) => unknown).apply(target, args);
            }
          : value;
      },
    });
    const first = readClinicChangeHistory(spy, world.clinic1);
    const second = readClinicChangeHistory(spy, world.clinic1);
    expect(second).toEqual(first);
    expect([...calls].sort()).toEqual(['listAuditLog', 'listCatalogVersions']);
    expect(world.repo.exportState()).toEqual(before);
  });
});
