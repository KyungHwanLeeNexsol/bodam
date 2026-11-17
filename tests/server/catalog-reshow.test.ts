import { describe, expect, it } from 'vitest';
import { readPublishedCatalog } from '../../src/server/api/published-catalog';
import { discardCatalogDraft, publishCatalogDraft, saveCatalogDraft } from '../../src/server/catalog-draft';
import { parseDraftRequest } from '../../src/server/catalog-draft-parse';
import { publishCatalog } from '../../src/server/catalog-publish';
import { applyReactivations, canonicalOrder, defaultOrderOf, reactivatedIdsInOrder, structureDefects } from '../../src/server/catalog-structure';
import { canonicalDigest } from '../../src/server/digest';
import { DomainError } from '../../src/server/domain/errors';
import { draftContentDigest, issuePublishConfirmation } from '../../src/server/publish-confirmation';
import { selectHiddenTreatments, selectPublishedTreatments } from '../../src/server/published-treatments';
import { TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_HA_1 } from '../fixtures/server/actors.fixture';
import { T1, T2 } from '../fixtures/server/base-fee.fixture';
import { T3, addThirdTreatment, additionBody, changedKeys, depsOver, repoThrowingOn } from '../fixtures/server/catalog-structure.fixture';
import { makeTreatment } from '../fixtures/server/entities.fixture';
import { buildWorld } from '../fixtures/server/estimate-world.fixture';
import type { World } from '../fixtures/server/lifecycle.fixture';
import { TEST_CATALOG_CONFIG } from '../fixtures/server/publish.fixture';
import { OTHER_CLINIC_ID, OTHER_CLINIC_TREATMENT_ID, addOtherClinic } from '../fixtures/server/versioning.fixture';

// 숨긴 치료 다시 표시 (M7): 서비스 층 시험(HTTP 없음). 세계: 병원 1 에 치료 셋(T1·T2·T3, 표시 순서 T1·T2·T3, T1·T2 의 sortOrder 는 둘 다 1, T3 는 3).
// 먼저 실제 서비스 경로(초안 저장 → 게시)로 치료를 숨기고, 그 뒤 초안으로 다시 표시한다. 저장소에 active 를 직접 넣는 길은 쓰지 않는다(아래 "범위 밖 변경" 시험만 예외).

const HA = TEST_FIXTURE_HA_1;
const CLINIC = TEST_FIXTURE_CLINIC_ID;
const ADDED_1 = 'TEST_FIXTURE_ADDED_TREATMENT_1';
const A = 'NEW_A';

const save = (world: World, body: unknown) => saveCatalogDraft(world.deps, HA, CLINIC, body);
const confirmationOf = (world: World): string => issuePublishConfirmation(world.repo.getCatalogDraft(CLINIC)!, HA.id);
const publish = (world: World) => publishCatalogDraft(world.deps, HA, CLINIC, confirmationOf(world), TEST_CATALOG_CONFIG, 'TEST_FIXTURE');
const clinicOf = (world: World) => world.repo.getClinic(CLINIC)!;
const displayed = (world: World): string[] => readPublishedCatalog(world.repo, clinicOf(world)).treatments.map(({ treatment }) => treatment.id);
const sortOrders = (world: World): Array<[string, boolean, number]> => world.repo.listTreatments(CLINIC).map((treatment) => [treatment.id, treatment.active, treatment.sortOrder]);
const hiddenOf = (world: World, catalog = world.repo.getClinicCurrentCatalogVersion(CLINIC)!) =>
  selectHiddenTreatments(world.repo, CLINIC, catalog, (defect) => {
    throw new Error(`깨진 참조 ${defect.code}`);
  });

function threeTreatmentWorld(): World {
  const { world } = buildWorld();
  addThirdTreatment(world);
  return world;
}

/** 세 치료 세계에서 주어진 치료를 실제 경로(저장 → 게시)로 숨긴 세계. */
function hiddenWorld(hide: string[] = [T2]): World {
  const world = threeTreatmentWorld();
  save(world, { deactivations: hide });
  publish(world);
  return world;
}

function rejectionOf(run: () => unknown): DomainError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    return error as DomainError;
  }
  throw new Error('거절되어야 한다');
}

const defectsOf = (run: () => unknown) => rejectionOf(run).defects;

describe('숨긴 치료의 정의 (selectHiddenTreatments)', () => {
  it('현재 카탈로그가 버전을 담고 있는 비활성 치료만이다. 활성 치료·다른 병원 치료·카탈로그가 담지 않은 비활성 치료는 없다', () => {
    const world = hiddenWorld([T2]);
    addOtherClinic(world.repo);
    world.repo.saveTreatment(makeTreatment({ id: 'TEST_FIXTURE_RETIRED', sortOrder: 9, active: false })); // 이 병원의 비활성 치료지만 카탈로그가 버전을 담지 않는다
    expect(hiddenOf(world).map(({ treatment }) => treatment.id)).toEqual([T2]);
    expect(displayed(world)).toEqual([T1, T3]);
  });

  it('활성 치료의 선택과 한 번의 순회를 공유한다: 둘을 합치면 카탈로그가 담은 치료 전부이고 서로 겹치지 않는다', () => {
    const world = hiddenWorld([T2]);
    const catalog = world.repo.getClinicCurrentCatalogVersion(CLINIC)!;
    const fail = (): never => {
      throw new Error('깨진 참조');
    };
    const active = selectPublishedTreatments(world.repo, CLINIC, catalog, fail).map(({ version }) => version.id);
    const hidden = selectHiddenTreatments(world.repo, CLINIC, catalog, fail).map(({ version }) => version.id);
    expect([...active, ...hidden].sort()).toEqual([...catalog.treatmentVersionIds].sort());
    expect(active.filter((id) => hidden.includes(id))).toEqual([]);
  });

  it('깨진 참조는 활성 선택과 같은 방식으로 주입된 실패 함수가 알린다', () => {
    const world = hiddenWorld([T2]);
    const broken = { ...world.repo.getClinicCurrentCatalogVersion(CLINIC)!, treatmentVersionIds: ['TEST_FIXTURE_TV_GHOST'] };
    let seen: string | null = null;
    expect(() =>
      selectHiddenTreatments(world.repo, CLINIC, broken, (defect) => {
        seen = defect.code;
        throw new Error('stop');
      }),
    ).toThrow('stop');
    expect(seen).toBe('TREATMENT_VERSION_MISSING');
  });
});

describe('형식 검사: reactivations', () => {
  it('치료 id 목록이고 키를 생략하면 비어 있다', () => {
    expect(parseDraftRequest({ reactivations: [T2] })).toMatchObject({ ok: true, request: { reactivations: [T2] } });
    expect(parseDraftRequest({})).toMatchObject({ ok: true, request: { reactivations: [] } });
  });

  it.each<[string, unknown, string, string]>([
    ['배열이 아님', { reactivations: T2 }, 'NOT_ARRAY', 'reactivations'],
    ['같은 치료가 두 번', { reactivations: [T2, T2] }, 'DUPLICATE_TREATMENT_ID', 'reactivations[1]'],
    ['항목이 문자열이 아님', { reactivations: [1] }, 'VALUE_INVALID', 'reactivations[0]'],
    ['빈 문자열', { reactivations: [''] }, 'VALUE_INVALID', 'reactivations[0]'],
    ['객체 항목(치료 내용을 같이 보내려 함)', { reactivations: [{ treatmentId: T2, patientAmount: 1 }] }, 'VALUE_INVALID', 'reactivations[0]'],
  ])('거절: %s', (_name, body, code, path) => {
    const parsed = parseDraftRequest(body);
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.defects).toContainEqual({ code, path });
  });
});

describe('초안 저장: 다시 표시는 공개 상태를 바꾸지 않는다', () => {
  it('다시 표시만 저장하면 초안 기록과 감사 기록 말고는 저장소 전체가 같다 (치료 기록의 active·치료 버전·카탈로그·병원·매핑 불변)', () => {
    const world = hiddenWorld([T2]);
    const before = world.repo.exportState();
    const publicBefore = readPublishedCatalog(world.repo, clinicOf(world));
    const draft = save(world, { reactivations: [T2] });
    expect(draft.reactivations).toEqual([T2]);
    expect(draft.order).toBeNull();
    expect(changedKeys(before, world.repo.exportState())).toEqual(['auditLog', 'catalogDrafts']);
    expect(readPublishedCatalog(world.repo, clinicOf(world))).toEqual(publicBefore);
    expect(sortOrders(world)).toEqual([[T1, true, 1], [T2, false, 1], [T3, true, 3]]);
  });

  it('저장하면 코드 포인트 순으로 정렬해 담고, 저장할 때마다 새 revision 이다', () => {
    const world = hiddenWorld([T1, T2]);
    const first = save(world, { reactivations: [T2, T1] });
    expect(first.reactivations).toEqual([T1, T2]);
    expect(save(world, { reactivations: [T2, T1] }).revision).not.toBe(first.revision);
  });

  it('다시 표시만 있는 초안도 "변경 있음"이다 (NO_DRAFT_CHANGE 가 아니다)', () => {
    const world = hiddenWorld([T2]);
    expect(() => save(world, { reactivations: [T2] })).not.toThrow();
    expect(defectsOf(() => save(world, {}))).toContainEqual({ code: 'NO_DRAFT_CHANGE', path: 'request' });
  });

  it('남는 치료 계산에 다시 표시가 들어간다: 표시 중인 치료를 모두 숨겨도 다시 표시가 하나 있으면 저장·게시된다 (NO_TREATMENT_REMAINS 가 아니다)', () => {
    const world = hiddenWorld([T2]);
    expect(defectsOf(() => save(world, { deactivations: [T1, T3] }))).toContainEqual({ code: 'NO_TREATMENT_REMAINS', path: 'deactivations' });
    save(world, { deactivations: [T1, T3], reactivations: [T2] });
    publish(world);
    expect(displayed(world)).toEqual([T2]);
  });
});

describe('초안 저장: 대상 검증 (자기 병원의 현재 카탈로그가 담은 숨긴 치료만)', () => {
  const rejected = (body: unknown, code: string, path: string, hide: string[] = [T2]): void => {
    const world = hiddenWorld(hide);
    addOtherClinic(world.repo);
    const before = world.repo.exportState();
    expect(defectsOf(() => save(world, body))).toContainEqual({ code, path });
    expect(world.repo.exportState()).toEqual(before);
  };

  it('다른 병원의 치료는 없는 치료와 같은 코드다 (다른 병원의 존재를 드러내지 않는다)', () => {
    rejected({ reactivations: [OTHER_CLINIC_TREATMENT_ID] }, 'TREATMENT_NOT_IN_CATALOG', 'reactivations[0]');
    rejected({ reactivations: ['TEST_FIXTURE_NO_SUCH_TREATMENT'] }, 'TREATMENT_NOT_IN_CATALOG', 'reactivations[0]');
    const world = hiddenWorld();
    addOtherClinic(world.repo);
    const other = defectsOf(() => save(world, { reactivations: [OTHER_CLINIC_TREATMENT_ID] }));
    const none = defectsOf(() => save(world, { reactivations: ['TEST_FIXTURE_NO_SUCH_TREATMENT'] }));
    expect(other).toEqual(none);
  });

  it('이 병원의 비활성 치료라도 현재 카탈로그가 버전을 담지 않았으면 거절한다 (과거 카탈로그 복구가 아니다)', () => {
    const world = hiddenWorld([T2]);
    world.repo.saveTreatment(makeTreatment({ id: 'TEST_FIXTURE_RETIRED', sortOrder: 9, active: false }));
    expect(defectsOf(() => save(world, { reactivations: ['TEST_FIXTURE_RETIRED'] }))).toEqual([{ code: 'TREATMENT_NOT_IN_CATALOG', path: 'reactivations[0]' }]);
  });

  it('이미 표시 중인 치료는 TREATMENT_ALREADY_VISIBLE 이다', () => {
    rejected({ reactivations: [T1] }, 'TREATMENT_ALREADY_VISIBLE', 'reactivations[0]');
  });

  it('같은 초안에서 숨김과 다시 표시를 함께 요청하면 거절한다 (표시 중인 치료도, 이미 숨긴 치료도)', () => {
    rejected({ deactivations: [T1], reactivations: [T1] }, 'REACTIVATION_CONFLICTS_WITH_DEACTIVATION', 'reactivations[0]');
    rejected({ deactivations: [T2], reactivations: [T2] }, 'REACTIVATION_CONFLICTS_WITH_DEACTIVATION', 'reactivations[0]');
  });

  it('다시 표시할 치료의 가격 수정은 거절한다 (가격은 다시 표시를 게시한 뒤에 고친다)', () => {
    rejected({ reactivations: [T2], priceEdits: [{ treatmentId: T2, patientAmount: 1_000 }] }, 'PRICE_EDIT_ON_REACTIVATED', 'priceEdits[0].treatmentId');
  });

  it('여러 결함은 한꺼번에 알린다 (하나가 다른 하나를 가리지 않는다)', () => {
    const world = hiddenWorld([T2]);
    const defects = defectsOf(() => save(world, { reactivations: [T1, OTHER_CLINIC_TREATMENT_ID, T2, T2] }));
    expect(defects).toContainEqual({ code: 'DUPLICATE_TREATMENT_ID', path: 'reactivations[3]' });
  });

  it('순서에 다시 표시 치료를 빼면 ORDER_INCOMPLETE, 다시 표시하지 않는 숨긴 치료를 넣으면 ORDER_UNKNOWN_ENTRY 이다', () => {
    const world = hiddenWorld([T2, T3]);
    expect(defectsOf(() => save(world, { reactivations: [T2], order: [T1] }))).toContainEqual({ code: 'ORDER_INCOMPLETE', path: 'order' });
    expect(defectsOf(() => save(world, { reactivations: [T2], order: [T1, T2, T3] }))).toContainEqual({ code: 'ORDER_UNKNOWN_ENTRY', path: 'order[2]' });
    expect(() => save(world, { reactivations: [T2], order: [T2, T1] })).not.toThrow();
  });

  it('병원 권한: HA 가 아니면 거절한다 (다른 역할은 서비스가 막는다)', () => {
    const world = hiddenWorld([T2]);
    expect(() => saveCatalogDraft(world.deps, { id: 'rv', role: 'RV' }, CLINIC, { reactivations: [T2] })).toThrow();
    expect(world.repo.getCatalogDraft(CLINIC)).toBeNull();
  });
});

describe('기본 표시 위치: 남는 기존 치료 → 다시 표시 → 새 치료 (결정적)', () => {
  it('다시 표시한 치료는 기존 표시 치료의 뒤에 놓인다 (예전 번호가 앞이어도)', () => {
    const world = hiddenWorld([T2]); // T2 의 예전 번호는 1 이라 T3(3)보다 앞이었다
    save(world, { reactivations: [T2] });
    publish(world);
    expect(displayed(world)).toEqual([T1, T3, T2]);
    // 기본 순서가 1..n 으로 명시적으로 매겨진다(되살린 치료의 예전 번호 1 이 앞에 남지 않는다). sortOrders 는 치료 id 순이다.
    expect(sortOrders(world)).toEqual([[T1, true, 1], [T2, true, 3], [T3, true, 2]]);
  });

  it('여러 치료를 다시 표시하면 예전 표시 순서(sortOrder, 같으면 치료 id)로 놓인다 — 요청에 적은 순서와 무관하다', () => {
    const world = hiddenWorld([T1, T2]); // T1·T2 모두 예전 번호 1: 치료 id 순으로 T1 → T2
    save(world, { reactivations: [T2, T1] });
    publish(world);
    expect(displayed(world)).toEqual([T3, T1, T2]);
  });

  it('남는 기존 치료 → 다시 표시 → 새 치료 순서다', () => {
    const world = hiddenWorld([T2]);
    save(world, { reactivations: [T2], additions: [additionBody(A)] });
    const draft = world.repo.getCatalogDraft(CLINIC)!;
    expect(draft.order).toBeNull();
    publish(world);
    expect(displayed(world)).toEqual([T1, T3, T2, ADDED_1]);
  });

  it('초안이 순서를 정하면 그대로 따른다 (기본 순서와 같으면 null 로 줄여 저장한다)', () => {
    const world = hiddenWorld([T2]);
    expect(save(world, { reactivations: [T2], order: [T1, T3, T2] }).order).toBeNull();
    const custom = save(world, { reactivations: [T2], order: [T2, T1, T3] });
    expect(custom.order).toEqual([T2, T1, T3]);
    publish(world);
    expect(displayed(world)).toEqual([T2, T1, T3]);
    expect(sortOrders(world)).toEqual([[T1, true, 2], [T2, true, 1], [T3, true, 3]]);
  });

  it('숨김을 다시 표시하는 것과 다른 치료를 숨기는 것을 한 초안에서 할 수 있다', () => {
    const world = hiddenWorld([T2]);
    save(world, { reactivations: [T2], deactivations: [T1] });
    publish(world);
    expect(displayed(world)).toEqual([T3, T2]);
    expect(world.repo.getTreatment(T1)!.active).toBe(false);
  });

  it('순수 함수 확인: defaultOrderOf / reactivatedIdsInOrder / canonicalOrder 는 hidden 을 입력으로만 읽는다', () => {
    const world = hiddenWorld([T1, T2]);
    const catalog = world.repo.getClinicCurrentCatalogVersion(CLINIC)!;
    const hidden = hiddenOf(world, catalog);
    const hiddenSnapshot = JSON.stringify(hidden);
    const published = selectPublishedTreatments(world.repo, CLINIC, catalog, (): never => {
      throw new Error('x');
    });
    expect(reactivatedIdsInOrder(hidden, [T2, T1])).toEqual([T1, T2]);
    expect(reactivatedIdsInOrder(hidden, ['NOPE'])).toEqual([]);
    const parts = { priceEdits: [], additions: [], deactivations: [], reactivations: [T2, T1], order: null };
    expect(defaultOrderOf(published, parts, hidden)).toEqual([T3, T1, T2]);
    expect(canonicalOrder(published, { ...parts, order: [T3, T1, T2] }, hidden)).toBeNull();
    expect(canonicalOrder(published, { ...parts, order: [T1, T3, T2] }, hidden)).toEqual([T1, T3, T2]);
    expect(JSON.stringify(hidden)).toBe(hiddenSnapshot);
    // hidden 을 넘기지 않으면 다시 표시 대상은 검증에서 걸러진다(조용히 틀린 순서를 만들지 않는다).
    expect(structureDefects(world.repo, CLINIC, published, parts)).toContainEqual({ code: 'TREATMENT_NOT_IN_CATALOG', path: 'reactivations[0]' });
  });
});

describe('게시: 같은 트랜잭션에서 새 카탈로그와 active·표시 순서가 함께 바뀐다', () => {
  it('치료 기록의 active 와 sortOrder 만 바뀐다. 새 치료 기록·새 치료 버전은 없고, 카탈로그는 같은 치료 버전을 계속 담는다', () => {
    const world = hiddenWorld([T2]);
    const oldCatalog = world.repo.getClinicCurrentCatalogVersion(CLINIC)!;
    const versionsBefore = world.repo.exportState()['treatmentVersions'];
    const treatmentCountBefore = world.repo.listTreatments(CLINIC).length;
    save(world, { reactivations: [T2] });
    const draftState = world.repo.exportState();
    const published = publish(world);

    expect(published.id).not.toBe(oldCatalog.id);
    expect(published.treatmentVersionIds).toEqual(oldCatalog.treatmentVersionIds);
    expect(world.repo.listTreatments(CLINIC)).toHaveLength(treatmentCountBefore);
    expect(world.repo.exportState()['treatmentVersions']).toEqual(versionsBefore);
    expect(changedKeys(draftState, world.repo.exportState())).toEqual(['auditLog', 'catalogDrafts', 'catalogVersions', 'clinics', 'treatments']);
    expect(world.repo.getCatalogDraft(CLINIC)).toBeNull();
    expect(world.repo.getClinic(CLINIC)!.currentCatalogVersionId).toBe(published.id);
    expect(world.repo.getTreatment(T2)!.active).toBe(true);
  });

  it('변경 요약은 reactivatedTreatmentIds 만 싣는다: 추가·제거·가격 변경이 아니다', () => {
    const world = hiddenWorld([T2]);
    save(world, { reactivations: [T2] });
    expect(publish(world).changeSummary).toEqual({
      addedTreatmentIds: [],
      removedTreatmentIds: [],
      priceChangedTreatmentIds: [],
      baseFeesChanged: false,
      reactivatedTreatmentIds: [T2],
    });
  });

  it('다시 표시가 없는 게시의 변경 요약에는 reactivatedTreatmentIds 키가 없다 (기존 모양 그대로)', () => {
    const world = threeTreatmentWorld();
    save(world, { deactivations: [T2] });
    expect('reactivatedTreatmentIds' in publish(world).changeSummary).toBe(false);
  });

  it('감사 기록은 기존 초안 동작뿐이다: CATALOG_DRAFT_SAVE · CATALOG_PUBLISH · CATALOG_DRAFT_PUBLISH. 다시 표시 전용 동작이 없다', () => {
    const world = hiddenWorld([T2]);
    const before = world.repo.listAuditLog().length;
    save(world, { reactivations: [T2] });
    const published = publish(world);
    const added = world.repo.listAuditLog().slice(before);
    expect(added.map((entry) => entry.action)).toEqual(['CATALOG_DRAFT_SAVE', 'CATALOG_PUBLISH', 'CATALOG_DRAFT_PUBLISH']);
    const last = added[2]!;
    expect(last).toMatchObject({ target: `CATALOG/${published.id}` });
    expect(last.reason).toBe(`DRAFT_OF:${draftContentDigest({ priceEdits: [], baseFeeEdits: [], additions: [], deactivations: [], reactivations: [T2], order: null })}`);
  });

  it('보장 판단은 건드리지 않는다: 치료 버전·매핑·승인 지문·규칙 묶음·범위 모두 같다 (게시 전후 이 키들이 같다)', () => {
    const world = hiddenWorld([T2]);
    const before = world.repo.exportState();
    save(world, { reactivations: [T2] });
    publish(world);
    const after = world.repo.exportState();
    for (const key of Object.keys(before).filter((name) => !['auditLog', 'catalogDrafts', 'catalogVersions', 'clinics', 'treatments'].includes(name))) {
      expect(after[key], key).toEqual(before[key]);
    }
  });

  it('다른 병원은 그대로다 (치료 기록·현재 카탈로그)', () => {
    const world = hiddenWorld([T2]);
    addOtherClinic(world.repo);
    const otherBefore = JSON.stringify([world.repo.getClinic(OTHER_CLINIC_ID), world.repo.listTreatments(OTHER_CLINIC_ID)]);
    save(world, { reactivations: [T2] });
    publish(world);
    expect(JSON.stringify([world.repo.getClinic(OTHER_CLINIC_ID), world.repo.listTreatments(OTHER_CLINIC_ID)])).toBe(otherBefore);
  });

  it('가격 수정·새 치료·숨김·순서와 함께 한 초안으로 게시된다 (한 트랜잭션, 한 카탈로그)', () => {
    const world = hiddenWorld([T2]);
    save(world, {
      priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }],
      additions: [additionBody(A)],
      deactivations: [T3],
      reactivations: [T2],
    });
    const published = publish(world);
    expect(displayed(world)).toEqual([T1, T2, ADDED_1]);
    expect(published.changeSummary).toMatchObject({
      addedTreatmentIds: [ADDED_1],
      priceChangedTreatmentIds: [T1],
      deactivatedTreatmentIds: [T3],
      reactivatedTreatmentIds: [T2],
    });
  });

  it('다시 표시한 치료의 치료 버전은 한 글자도 바뀌지 않는다 (분류·보장 판단 필드·가격 그대로, 새 버전 없음)', () => {
    const world = hiddenWorld([T3]);
    const versionBefore = JSON.stringify(world.repo.getTreatmentVersion('TEST_FIXTURE_TV_3'));
    save(world, { reactivations: [T3] });
    publish(world);
    expect(JSON.stringify(world.repo.getTreatmentVersion('TEST_FIXTURE_TV_3'))).toBe(versionBefore);
    expect(world.repo.getClinicCurrentCatalogVersion(CLINIC)!.treatmentVersionIds).toContain('TEST_FIXTURE_TV_3');
  });
});

describe('게시: 확인값은 다시 표시 내용에 묶인다', () => {
  it('확인값 없이·틀린 확인값으로는 게시할 수 없다 (409 PREVIEW_REQUIRED, 저장소 그대로)', () => {
    const world = hiddenWorld([T2]);
    save(world, { reactivations: [T2] });
    const before = world.repo.exportState();
    const error = rejectionOf(() => publishCatalogDraft(world.deps, HA, CLINIC, 'a'.repeat(64), TEST_CATALOG_CONFIG, 'TEST_FIXTURE'));
    expect(error.code).toBe('STATE_CONFLICT');
    expect(error.defects[0]!.code).toBe('PREVIEW_REQUIRED');
    expect(world.repo.exportState()).toEqual(before);
    expect(world.repo.getTreatment(T2)!.active).toBe(false);
  });

  it('다시 표시 A 의 확인값으로 다시 표시 B 를 게시할 수 없다', () => {
    const world = hiddenWorld([T2, T3]);
    save(world, { reactivations: [T2] });
    const forT2 = confirmationOf(world);
    save(world, { reactivations: [T3] });
    expect(rejectionOf(() => publishCatalogDraft(world.deps, HA, CLINIC, forT2, TEST_CATALOG_CONFIG, 'TEST_FIXTURE')).defects[0]!.code).toBe('PREVIEW_REQUIRED');
    expect(world.repo.getTreatment(T3)!.active).toBe(false);
  });

  it('다시 표시가 없는 초안의 확인값으로 다시 표시가 든 초안을 게시할 수 없다 (같은 내용을 다시 저장해도 revision 이 달라 무효다)', () => {
    const world = hiddenWorld([T2]);
    save(world, { additions: [additionBody(A)] });
    const forPlain = confirmationOf(world);
    save(world, { additions: [additionBody(A)], reactivations: [T2] });
    expect(rejectionOf(() => publishCatalogDraft(world.deps, HA, CLINIC, forPlain, TEST_CATALOG_CONFIG, 'TEST_FIXTURE')).defects[0]!.code).toBe('PREVIEW_REQUIRED');
  });

  it('순서만 다른 초안의 확인값으로도 게시할 수 없다 (최종 순서가 확인값에 묶인다)', () => {
    const world = hiddenWorld([T2]);
    save(world, { reactivations: [T2], order: [T2, T1, T3] });
    const forFirst = confirmationOf(world);
    save(world, { reactivations: [T2], order: [T1, T2, T3] });
    expect(rejectionOf(() => publishCatalogDraft(world.deps, HA, CLINIC, forFirst, TEST_CATALOG_CONFIG, 'TEST_FIXTURE')).defects[0]!.code).toBe('PREVIEW_REQUIRED');
  });

  it('지문은 다시 표시가 없으면 이 필드가 생기기 전과 같다 (기존 초안·확인값이 깨지지 않는다)', () => {
    const base = { priceEdits: [{ treatmentId: T1, patientAmount: 1 }], additions: [], deactivations: [T2], order: null };
    const legacy = canonicalDigest({ priceEdits: base.priceEdits, additions: base.additions, deactivations: base.deactivations, order: base.order });
    expect(draftContentDigest({ ...base, baseFeeEdits: [], reactivations: [] })).toBe(legacy);
    expect(draftContentDigest({ ...base, baseFeeEdits: [], reactivations: [T2] })).not.toBe(legacy);
  });
});

describe('게시: 트랜잭션 안에서 대상을 다시 확인한다', () => {
  it('저장 뒤 다른 게시로 카탈로그가 바뀌었으면 DRAFT_STALE 이다 (옛 카탈로그 버전)', () => {
    const world = hiddenWorld([T2]);
    save(world, { reactivations: [T2] });
    const confirmation = confirmationOf(world);
    const current = world.repo.getClinicCurrentCatalogVersion(CLINIC)!;
    publishCatalog(
      world.deps,
      HA,
      CLINIC,
      { treatmentVersions: current.treatmentVersionIds.map((id) => world.repo.getTreatmentVersion(id)!), commonBaseFees: current.baseFeeIds.map((id) => world.repo.getCommonBaseFee(id)!) },
      TEST_CATALOG_CONFIG,
    );
    const before = world.repo.exportState();
    const error = rejectionOf(() => publishCatalogDraft(world.deps, HA, CLINIC, confirmation, TEST_CATALOG_CONFIG, 'TEST_FIXTURE'));
    expect(error.defects[0]!.code).toBe('DRAFT_STALE');
    expect(world.repo.exportState()).toEqual(before);
    expect(world.repo.getTreatment(T2)!.active).toBe(false);
  });

  it('저장 뒤 대상이 이미 표시 중이 됐으면(범위 밖 변경) DRAFT_STALE 로 거절하고 아무것도 쓰지 않는다', () => {
    const world = hiddenWorld([T2]);
    save(world, { reactivations: [T2] });
    const confirmation = confirmationOf(world);
    world.repo.saveTreatment({ ...world.repo.getTreatment(T2)!, active: true }); // 범위 밖 변경(시험이 직접 저장소에 쓴다)
    const before = world.repo.exportState();
    const error = rejectionOf(() => publishCatalogDraft(world.deps, HA, CLINIC, confirmation, TEST_CATALOG_CONFIG, 'TEST_FIXTURE'));
    expect(error.defects[0]!.code).toBe('DRAFT_STALE');
    expect(world.repo.exportState()).toEqual(before);
  });

  it('applyReactivations 는 쓰기 직전에 다시 본다: 없는 치료·다른 병원 치료·이미 활성인 치료는 서버 결함으로 던지고 아무것도 쓰지 않는다', () => {
    const world = hiddenWorld([T2]);
    addOtherClinic(world.repo);
    world.repo.saveTreatment({ ...world.repo.getTreatment(OTHER_CLINIC_TREATMENT_ID)!, active: false });
    const before = world.repo.exportState();
    expect(() => applyReactivations(world.deps, CLINIC, ['NO_SUCH'])).toThrow(/저장소에 없다/);
    expect(() => applyReactivations(world.deps, CLINIC, [OTHER_CLINIC_TREATMENT_ID])).toThrow(/병원 .* 의 것이 아니다/);
    expect(() => applyReactivations(world.deps, CLINIC, [T1])).toThrow(/이미 활성/);
    expect(world.repo.exportState()).toEqual(before);
  });

  it('초안을 버리면 다시 표시도 사라지고 치료 기록은 그대로다', () => {
    const world = hiddenWorld([T2]);
    save(world, { reactivations: [T2] });
    const before = world.repo.exportState();
    expect(discardCatalogDraft(world.deps, HA, CLINIC)).toBe(true);
    expect(changedKeys(before, world.repo.exportState())).toEqual(['auditLog', 'catalogDrafts']);
    expect(world.repo.getTreatment(T2)!.active).toBe(false);
  });
});

describe('저장소 백스톱: 서비스를 거치지 않고 초안을 직접 저장해도 다시 표시 대상은 이 병원의 치료여야 한다', () => {
  it('다른 병원의 치료는 REF_CONTENT_MISMATCH, 없는 치료는 NOT_FOUND 이고 초안은 저장되지 않는다', () => {
    const world = hiddenWorld([T2]);
    addOtherClinic(world.repo);
    const stored = save(world, { reactivations: [T2] });
    const before = world.repo.exportState();
    expect(rejectionOf(() => world.repo.saveCatalogDraft({ ...stored, reactivations: [OTHER_CLINIC_TREATMENT_ID] })).code).toBe('REF_CONTENT_MISMATCH');
    expect(rejectionOf(() => world.repo.saveCatalogDraft({ ...stored, reactivations: ['NO_SUCH'] })).code).toBe('NOT_FOUND');
    expect(world.repo.exportState()).toEqual(before);
  });
});

describe('게시 실패는 전체를 되돌린다 (새 카탈로그·active·순서·초안·감사 기록)', () => {
  it.each([
    ['초안 닫기에서 실패', 'closeCatalogDraft', 0],
    ['치료 기록 쓰기(active 되돌리기)에서 실패', 'saveTreatment', 0],
    ['마지막 감사 기록(CATALOG_DRAFT_PUBLISH) 쓰기에서 실패 — 다른 모든 쓰기가 끝난 뒤다', 'appendAuditLog', 1],
  ] as const)('%s', (_name, method, afterCalls) => {
    const world = hiddenWorld([T2]);
    save(world, { reactivations: [T2] });
    const confirmation = confirmationOf(world);
    const before = world.repo.exportState();
    const failing = repoThrowingOn(world.repo, method, afterCalls);
    expect(() => publishCatalogDraft(depsOver(world, failing.repo), HA, CLINIC, confirmation, TEST_CATALOG_CONFIG, 'TEST_FIXTURE')).toThrow(`INJECTED_FAILURE:${method}`);
    expect(world.repo.exportState()).toEqual(before);
    expect(world.repo.getTreatment(T2)!.active).toBe(false);
    expect(world.repo.getCatalogDraft(CLINIC)).not.toBeNull();
  });

  it('순서를 매기는 도중 실패해도(되살린 치료의 sortOrder 쓰기) 되돌려진다', () => {
    const world = hiddenWorld([T2]);
    save(world, { reactivations: [T2] });
    const confirmation = confirmationOf(world);
    const before = world.repo.exportState();
    // 첫 saveTreatment(active 되돌리기)는 통과하고 두 번째(순서 매기기)에서 실패한다.
    const failing = repoThrowingOn(world.repo, 'saveTreatment', 1);
    expect(() => publishCatalogDraft(depsOver(world, failing.repo), HA, CLINIC, confirmation, TEST_CATALOG_CONFIG, 'TEST_FIXTURE')).toThrow('INJECTED_FAILURE:saveTreatment');
    expect(failing.calls.length).toBeGreaterThanOrEqual(2);
    expect(world.repo.exportState()).toEqual(before);
    expect(sortOrders(world)).toEqual([[T1, true, 1], [T2, false, 1], [T3, true, 3]]);
  });
});
