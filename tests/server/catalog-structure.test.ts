import { describe, expect, it } from 'vitest';
import { readPublishedCatalog } from '../../src/server/api/published-catalog';
import { discardCatalogDraft, publishCatalogDraft, saveCatalogDraft } from '../../src/server/catalog-draft';
import { publishCatalog } from '../../src/server/catalog-publish';
import { DomainError } from '../../src/server/domain/errors';
import type { Actor } from '../../src/server/domain/actor';
import type { ItemVersionRecordOf } from '../../src/server/domain/items';
import { draftContentDigest, issuePublishConfirmation } from '../../src/server/publish-confirmation';
import { TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1, TEST_FIXTURE_RV_AUTHOR } from '../fixtures/server/actors.fixture';
import { T1, T2, makeBaseFeeVersion } from '../fixtures/server/base-fee.fixture';
import { T3, addThirdTreatment, additionBody, changedKeys, depsOver, repoRecording, repoThrowingOn } from '../fixtures/server/catalog-structure.fixture';
import { buildWorld, originWorld } from '../fixtures/server/estimate-world.fixture';
import type { World } from '../fixtures/server/lifecycle.fixture';
import { OPERATING_CATALOG_CONFIG, TEST_CATALOG_CONFIG } from '../fixtures/server/publish.fixture';
import { OTHER_CLINIC_ID, OTHER_CLINIC_TREATMENT_ID, addOtherClinic } from '../fixtures/server/versioning.fixture';

// 카탈로그 초안의 구조 편집 (M7): 새 치료 추가 · 숨김 · 표시 순서. 도메인 층 시험이다(HTTP 없음).
// 세계: 병원 1 에 치료 셋(T1·T2·T3, 표시 순서 T1·T2·T3, T1·T2 의 sortOrder 는 둘 다 1)과 공통 기본비용·승인된 매핑(T1·T2)·게시된 규칙 묶음.
// 새 치료의 실제 id 는 시험 생성기가 TEST_FIXTURE_ADDED_TREATMENT_1, _2, … 로 만든다.

const HA = TEST_FIXTURE_HA_1;
const CLINIC = TEST_FIXTURE_CLINIC_ID;
const ADDED_1 = 'TEST_FIXTURE_ADDED_TREATMENT_1';
const ADDED_2 = 'TEST_FIXTURE_ADDED_TREATMENT_2';
const A = 'NEW_A';
const B = 'NEW_B';

function threeTreatmentWorld(): World {
  const { world } = buildWorld();
  addThirdTreatment(world);
  return world;
}

const save = (world: World, body: unknown, actor: Actor = HA) => saveCatalogDraft(world.deps, actor, CLINIC, body);
const confirmationOf = (world: World, actor: Actor = HA): string => issuePublishConfirmation(world.repo.getCatalogDraft(CLINIC)!, actor.id);
const publish = (world: World, origin: 'OPERATING' | 'TEST_FIXTURE' = 'TEST_FIXTURE') => publishCatalogDraft(world.deps, HA, CLINIC, confirmationOf(world), TEST_CATALOG_CONFIG, origin);
const displayedNames = (world: World): string[] => readPublishedCatalog(world.repo, world.repo.getClinic(CLINIC)!).treatments.map(({ version }) => version.displayName);
const displayed = (world: World): string[] => readPublishedCatalog(world.repo, world.repo.getClinic(CLINIC)!).treatments.map(({ treatment }) => treatment.id);

function rejectionOf(run: () => unknown): DomainError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    return error as DomainError;
  }
  throw new Error('거절되어야 한다');
}

describe('초안 저장 (구조 편집): 저장은 공개 상태를 바꾸지 않는다', () => {
  it('새 치료·숨김·순서·가격을 저장해도 초안 기록과 감사 기록 말고는 저장소 전체가 같다 (치료 기록·치료 버전·카탈로그·병원·매핑 불변)', () => {
    const world = threeTreatmentWorld();
    const before = world.repo.exportState();
    const publicBefore = readPublishedCatalog(world.repo, world.repo.getClinic(CLINIC)!);
    save(world, { priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }], additions: [additionBody(A)], deactivations: [T2], order: [A, T3, T1] });

    const after = world.repo.exportState();
    expect(changedKeys(before, after)).toEqual(['auditLog', 'catalogDrafts']);
    expect(readPublishedCatalog(world.repo, world.repo.getClinic(CLINIC)!)).toEqual(publicBefore);
    // 치료 기록의 active·sortOrder 와 치료 수가 그대로다 (새 치료 기록이 생기지 않았다).
    expect(world.repo.listTreatments(CLINIC).map((treatment) => [treatment.id, treatment.active, treatment.sortOrder])).toEqual([
      [T1, true, 1],
      [T2, true, 1],
      [T3, true, 3],
    ]);
    expect(world.repo.getTreatment(A)).toBeNull();
    expect(world.repo.listAuditLog().at(-1)).toMatchObject({ action: 'CATALOG_DRAFT_SAVE', actorId: HA.id, role: 'HA' });
  });

  it('저장한 초안: 가격 수정은 id 순, 새 치료는 적은 순서 그대로, 숨김은 코드 포인트 순, 순서는 적은 그대로', () => {
    const world = threeTreatmentWorld();
    const draft = save(world, {
      priceEdits: [{ treatmentId: T3, patientAmount: 1 }, { treatmentId: T1, patientAmount: 2 }],
      additions: [additionBody(B), additionBody(A)],
      deactivations: [T2],
      order: [B, T3, A, T1],
    });
    expect(draft.priceEdits.map((edit) => edit.treatmentId)).toEqual([T1, T3]);
    expect(draft.additions.map((addition) => addition.draftKey)).toEqual([B, A]);
    expect(draft.deactivations).toEqual([T2]);
    expect(draft.order).toEqual([B, T3, A, T1]);
    expect(world.repo.getCatalogDraft(CLINIC)).toEqual(draft);
  });

  it('숨김 둘은 코드 포인트 순으로 저장한다', () => {
    const world = threeTreatmentWorld();
    expect(save(world, { deactivations: [T3, T1] }).deactivations).toEqual([T1, T3]);
  });

  it('순서가 기본 순서와 같으면 order 는 null 로 저장한다 (기본 = 남는 기존 치료는 지금 표시 순서, 새 치료는 적은 순서대로 뒤에)', () => {
    const world = threeTreatmentWorld();
    expect(save(world, { additions: [additionBody(A), additionBody(B)], order: [T1, T2, T3, A, B] }).order).toBeNull();
    expect(save(world, { additions: [additionBody(A), additionBody(B)], order: [T1, T2, T3, B, A] }).order).toEqual([T1, T2, T3, B, A]);
    expect(save(world, { deactivations: [T2], priceEdits: [{ treatmentId: T1, patientAmount: 1 }], order: [T1, T3] }).order).toBeNull();
  });

  it('가격은 그대로 두고 순서만 바꾼 초안도 저장된다 (T1·T2 의 sortOrder 가 같아도 기본 순서는 표시 순서 T1·T2·T3)', () => {
    const world = threeTreatmentWorld();
    expect(save(world, { order: [T2, T1, T3] })).toMatchObject({ priceEdits: [], additions: [], deactivations: [], order: [T2, T1, T3] });
  });

  it('새 치료의 표시 이름은 입력 그대로 보존한다 (다듬지 않는다)', () => {
    const world = threeTreatmentWorld();
    expect(save(world, { additions: [additionBody(A, { displayName: '  앞뒤 공백  ' })] }).additions[0]!.displayName).toBe('  앞뒤 공백  ');
  });

  it('다시 저장하면 덮어쓰고 revision 이 바뀐다 (내용이 같아도)', () => {
    const world = threeTreatmentWorld();
    const first = save(world, { deactivations: [T2] });
    const second = save(world, { deactivations: [T2] });
    expect(second.revision).not.toBe(first.revision);
    expect(world.repo.getCatalogDraft(CLINIC)).toEqual(second);
  });
});

describe('초안 저장 (구조 편집): 거절은 INVALID_INPUT 이고 저장소는 호출 전과 같다', () => {
  const edit = (treatmentId: string, patientAmount: number) => ({ treatmentId, patientAmount });
  const cases: Array<[string, unknown, string, string]> = [
    ['숨기는 치료에 가격 수정', { priceEdits: [edit(T1, 12_000)], deactivations: [T1] }, 'PRICE_EDIT_ON_DEACTIVATED', 'priceEdits[0].treatmentId'],
    ['없는 치료를 숨김', { deactivations: ['NO_SUCH_TREATMENT'] }, 'TREATMENT_NOT_IN_CATALOG', 'deactivations[0]'],
    ['다른 병원 치료를 숨김 (없는 치료와 같은 코드)', { deactivations: [OTHER_CLINIC_TREATMENT_ID] }, 'TREATMENT_NOT_IN_CATALOG', 'deactivations[0]'],
    ['모든 치료를 숨김 (게시된 치료가 하나도 남지 않음)', { deactivations: [T1, T2, T3] }, 'NO_TREATMENT_REMAINS', 'deactivations'],
    ['draftKey 가 기존 치료 id 와 같음', { additions: [additionBody(T1)] }, 'DRAFT_KEY_COLLIDES', 'additions[0].draftKey'],
    ['draftKey 가 공통 기본비용의 안정 식별자와 같음', { additions: [additionBody(makeBaseFeeVersion(1).baseFeeId)] }, 'DRAFT_KEY_COLLIDES', 'additions[0].draftKey'],
    ['순서에 빠진 항목 (새 치료 누락)', { additions: [additionBody(A)], order: [T1, T2, T3] }, 'ORDER_INCOMPLETE', 'order'],
    ['순서에 빠진 항목 (기존 치료 누락)', { order: [T1, T3] }, 'ORDER_INCOMPLETE', 'order'],
    ['순서에 모르는 항목', { order: [T1, T2, T3, 'NO_SUCH'] }, 'ORDER_UNKNOWN_ENTRY', 'order[3]'],
    ['순서에 숨기는 치료가 들어 있음', { deactivations: [T2], order: [T1, T2, T3] }, 'ORDER_UNKNOWN_ENTRY', 'order[1]'],
    ['순서에 다른 병원 치료가 들어 있음', { order: [T1, T2, T3, OTHER_CLINIC_TREATMENT_ID] }, 'ORDER_UNKNOWN_ENTRY', 'order[3]'],
    ['순서에 중복', { order: [T1, T2, T3, T1] }, 'DUPLICATE_ORDER_ENTRY', 'order[3]'],
    ['변경 없음 ({})', {}, 'NO_DRAFT_CHANGE', 'request'],
    ['변경 없음 (빈 섹션들)', { priceEdits: [], additions: [], deactivations: [], order: null }, 'NO_DRAFT_CHANGE', 'request'],
    ['변경 없음 (현재 가격과 같은 가격 + 다른 섹션 키)', { priceEdits: [edit(T1, 10_000)], deactivations: [] }, 'NO_DRAFT_CHANGE', 'request'],
    ['변경 없음 (순서가 기본 순서와 같음)', { order: [T1, T2, T3] }, 'NO_DRAFT_CHANGE', 'request'],
    ['변경 없음 (이전 모양: priceEdits 만, 현재 가격과 같음)', { priceEdits: [edit(T1, 10_000)] }, 'NO_PRICE_CHANGE', 'priceEdits'],
    ['변경 없음 (이전 모양: 빈 priceEdits)', { priceEdits: [] }, 'NO_PRICE_CHANGE', 'priceEdits'],
    ['새 치료 형식 위반', { additions: [additionBody(A, { patientAmount: -1 })] }, 'VALUE_INVALID', 'additions[0].patientAmount'],
    ['새 치료에 분류를 보냄', { additions: [additionBody(A, { calcClass: 'GENERAL_BENEFIT' })] }, 'UNKNOWN_FIELD', 'additions[0].calcClass'],
  ];
  it.each(cases)('%s', (_name, body, code, path) => {
    const world = threeTreatmentWorld();
    addOtherClinic(world.repo);
    save(world, { priceEdits: [edit(T3, 15_000)] });
    const before = world.repo.exportState();
    const error = rejectionOf(() => save(world, body));
    expect(error.code).toBe('INVALID_INPUT');
    expect(error.defects).toContainEqual({ code, path });
    expect(world.repo.exportState()).toEqual(before);
    expect(world.ids.next('CATALOG_DRAFT_REVISION')).toBe('TEST_FIXTURE_CATALOG_DRAFT_REVISION_2');
  });

  it('모든 치료를 숨기면 거절하고 저장소는 그대로다. 하나라도 남기거나 새 치료를 더하면 저장된다', () => {
    const world = threeTreatmentWorld();
    const before = world.repo.exportState();
    const error = rejectionOf(() => save(world, { deactivations: [T1, T2, T3] }));
    expect(error.code).toBe('INVALID_INPUT');
    expect(error.defects).toEqual([{ code: 'NO_TREATMENT_REMAINS', path: 'deactivations' }]);
    expect(world.repo.exportState()).toEqual(before);
    expect(save(world, { deactivations: [T1, T2] }).deactivations).toEqual([T1, T2]);
    expect(save(world, { deactivations: [T1, T2, T3], additions: [additionBody(A)] }).deactivations).toEqual([T1, T2, T3]);
  });

  // draftKey 는 초안 안에서만 쓰는 이름표다(진짜 치료 id 는 게시 때 서버가 만든다). 같은 병원 안에서만 겹침을 가리고, 다른 병원의 치료·기본비용 존재는 드러내지 않는다.
  it('draftKey 가 다른 병원의 치료 id 와 같아도 저장된다 (다른 병원의 치료 존재를 드러내지 않는다)', () => {
    const world = threeTreatmentWorld();
    addOtherClinic(world.repo);
    const draft = save(world, { additions: [additionBody(OTHER_CLINIC_TREATMENT_ID)] });
    expect(draft.additions.map((addition) => addition.draftKey)).toEqual([OTHER_CLINIC_TREATMENT_ID]);
    // 게시되면 새 치료는 이 병원 몫의 새 id 를 받고, 다른 병원의 치료 기록은 그대로다.
    publish(world);
    expect(displayed(world)).toEqual([T1, T2, T3, ADDED_1]);
    expect(world.repo.getTreatment(OTHER_CLINIC_TREATMENT_ID)).toMatchObject({ clinicId: OTHER_CLINIC_ID, active: true });
  });

  it('draftKey 가 다른 병원의 공통 기본비용 식별자와 같아도 저장된다', () => {
    const world = threeTreatmentWorld();
    addOtherClinic(world.repo);
    const otherFeeId = 'TEST_FIXTURE_OTHER_CLINIC_BASE_FEE';
    world.repo.putCommonBaseFee(makeBaseFeeVersion(7, { clinicId: OTHER_CLINIC_ID, baseFeeId: otherFeeId }));
    expect(save(world, { additions: [additionBody(otherFeeId)] }).additions.map((addition) => addition.draftKey)).toEqual([otherFeeId]);
  });

  it('draftKey 가 같은 병원의 비활성 치료 id 와 같으면 거절한다 (숨긴 치료도 이 병원의 치료다)', () => {
    const world = threeTreatmentWorld();
    world.repo.saveTreatment({ ...world.repo.getTreatment(T3)!, active: false });
    const error = rejectionOf(() => save(world, { additions: [additionBody(T3)] }));
    expect(error.defects).toContainEqual({ code: 'DRAFT_KEY_COLLIDES', path: 'additions[0].draftKey' });
  });

  it('거절된 저장은 식별자 생성기를 쓰지 않는다 (새 치료 id 는 게시 때만 만든다)', () => {
    const world = threeTreatmentWorld();
    rejectionOf(() => save(world, { additions: [additionBody(A)], order: [T1] }));
    expect(world.ids.next('TREATMENT')).toBe(ADDED_1);
  });

  it.each<[string, Actor]>([
    ['검토 담당자(RV)', TEST_FIXTURE_RV_AUTHOR],
    ['플랫폼 운영자(PO)', TEST_FIXTURE_PO_1],
  ])('HA 가 아니면 구조 편집도 저장할 수 없다 (%s)', (_name, actor) => {
    const world = threeTreatmentWorld();
    const before = world.repo.exportState();
    expect(rejectionOf(() => save(world, { additions: [additionBody(A)], deactivations: [T2] }, actor)).code).toBe('ROLE_NOT_PERMITTED');
    expect(world.repo.exportState()).toEqual(before);
  });

  it('다른 병원의 초안으로 이 병원의 치료를 숨기려는 저장소 직접 쓰기도 막는다 (저장소 백스톱)', () => {
    const world = threeTreatmentWorld();
    addOtherClinic(world.repo);
    save(world, { deactivations: [T2] });
    const stored = world.repo.getCatalogDraft(CLINIC)!;
    const before = world.repo.exportState();
    expect(rejectionOf(() => world.repo.saveCatalogDraft({ ...stored, deactivations: [OTHER_CLINIC_TREATMENT_ID] })).code).toBe('REF_CONTENT_MISMATCH');
    expect(rejectionOf(() => world.repo.saveCatalogDraft({ ...stored, deactivations: ['NO_SUCH'] })).code).toBe('NOT_FOUND');
    expect(world.repo.exportState()).toEqual(before);
    expect(OTHER_CLINIC_ID).not.toBe(CLINIC);
  });
});

describe('초안 게시 (구조 편집): 한 트랜잭션으로 모두 적용된다', () => {
  const FULL = () => ({
    priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }],
    additions: [additionBody(A, { patientAmount: 7_000 }), additionBody(B, { patientAmount: 8_000, benefitType: 'NON_BENEFIT' })],
    deactivations: [T2],
    order: [B, T3, T1, A],
  });

  it('가격·새 치료·숨김·순서가 함께 적용되고 공개 목록과 순서는 게시 뒤에만 바뀐다', () => {
    const world = threeTreatmentWorld();
    const before = readPublishedCatalog(world.repo, world.repo.getClinic(CLINIC)!);
    expect(displayed(world)).toEqual([T1, T2, T3]);
    save(world, FULL());
    expect(displayed(world)).toEqual([T1, T2, T3]);

    const published = publish(world);
    const after = readPublishedCatalog(world.repo, world.repo.getClinic(CLINIC)!);
    expect(after.catalog!.id).toBe(published.id);
    expect(after.catalog!.id).not.toBe(before.catalog!.id);
    expect(displayed(world)).toEqual([ADDED_2, T3, T1, ADDED_1]);
    expect(after.treatments.map(({ treatment, version }) => [treatment.id, version.patientAmount, version.displayName])).toEqual([
      [ADDED_2, 8_000, `TEST_FIXTURE 새 치료 ${B}`],
      [T3, 11_000, 'TEST_FIXTURE 치료 3'],
      [T1, 12_000, expect.any(String)],
      [ADDED_1, 7_000, `TEST_FIXTURE 새 치료 ${A}`],
    ]);
    // 숨긴 치료는 기록이 남지만 공개 목록에는 없다. 카탈로그 스냅샷에는 그대로 담긴다.
    expect(world.repo.getTreatment(T2)).toMatchObject({ active: false });
    expect(published.treatmentVersionIds.map((id) => world.repo.getTreatmentVersion(id)!.treatmentId)).toContain(T2);
    expect(world.repo.getCatalogDraft(CLINIC)).toBeNull();
  });

  it('sortOrder: 순서가 있으면 남는 목록을 1..n 으로 다시 매기고 숨긴 치료는 건드리지 않는다. 새 치료는 요청 순서가 아니라 draftKey 로 연결된다', () => {
    const world = threeTreatmentWorld();
    save(world, FULL());
    publish(world);
    expect(world.repo.listTreatments(CLINIC).map((treatment) => [treatment.id, treatment.sortOrder, treatment.active])).toEqual([
      [ADDED_1, 4, true],
      [ADDED_2, 1, true],
      [T1, 3, true],
      [T2, 1, false],
      [T3, 2, true],
    ]);
  });

  it('sortOrder: 순서가 null 이면 기존 치료는 그대로 두고 새 치료는 모든 치료(비활성 포함)의 최대 sortOrder 뒤에 적은 순서대로 붙는다', () => {
    const world = threeTreatmentWorld();
    save(world, { additions: [additionBody(B), additionBody(A)] });
    publish(world);
    expect(world.repo.listTreatments(CLINIC).map((treatment) => [treatment.id, treatment.sortOrder])).toEqual([
      [ADDED_1, 4],
      [ADDED_2, 5],
      [T1, 1],
      [T2, 1],
      [T3, 3],
    ]);
    expect(displayed(world)).toEqual([T1, T2, T3, ADDED_1, ADDED_2]);
    expect(readPublishedCatalog(world.repo, world.repo.getClinic(CLINIC)!).treatments.slice(3).map(({ version }) => version.displayName)).toEqual([`TEST_FIXTURE 새 치료 ${B}`, `TEST_FIXTURE 새 치료 ${A}`]);
  });

  it('비활성 치료가 이미 있으면 그 sortOrder 도 최대값에 센다 (새 치료가 숨은 치료와 같은 번호를 받지 않는다)', () => {
    const world = threeTreatmentWorld();
    world.repo.saveTreatment({ ...world.repo.getTreatment(T3)!, sortOrder: 9 });
    world.repo.saveTreatment({ ...world.repo.getTreatment(T2)!, active: false });
    // T2 가 이미 비활성인 세계에서 카탈로그는 그대로(T2 의 버전을 담은 채)다.
    save(world, { additions: [additionBody(A)] });
    publish(world);
    expect(world.repo.getTreatment(ADDED_1)!.sortOrder).toBe(10);
  });

  it('sortOrder: 순서가 있을 때 숫자가 실제로 달라지는 치료만 쓴다', () => {
    const world = threeTreatmentWorld();
    save(world, { additions: [additionBody(A)], order: [T1, T2, A, T3] });
    const draft = world.repo.getCatalogDraft(CLINIC)!;
    const recording = repoRecording(world.repo, 'saveTreatment');
    publishCatalogDraft(depsOver(world, recording.repo), HA, CLINIC, issuePublishConfirmation(draft, HA.id), TEST_CATALOG_CONFIG, 'TEST_FIXTURE');
    const written = recording.calls.map(([treatment]) => (treatment as { id: string; sortOrder: number }).id);
    // 새 치료 기록 만들기 한 번 + T2(1→2)·새 치료(4→3)·T3(3→4). T1 은 이미 1 이라 쓰지 않는다.
    expect(written).toEqual([ADDED_1, T2, ADDED_1, T3]);
    expect(world.repo.listTreatments(CLINIC).map((treatment) => [treatment.id, treatment.sortOrder])).toEqual([
      [ADDED_1, 3],
      [T1, 1],
      [T2, 2],
      [T3, 4],
    ]);
    expect(displayed(world)).toEqual([T1, T2, ADDED_1, T3]);
  });

  it('변경 요약: 추가·숨김·순서 변경·가격 변경이 모두 나오고 기존 키의 뜻은 그대로다 (숨김은 removed 가 아니다)', () => {
    const world = threeTreatmentWorld();
    save(world, FULL());
    const published = publish(world);
    expect(published.changeSummary).toEqual({
      addedTreatmentIds: [ADDED_1, ADDED_2],
      removedTreatmentIds: [],
      priceChangedTreatmentIds: [T1],
      baseFeesChanged: false,
      deactivatedTreatmentIds: [T2],
      // 남는 기존 치료끼리의 순위: 이전 [T1, T3] → 이후 [T3, T1] 이라 둘 다 바뀌었다.
      reorderedTreatmentIds: [T1, T3],
    });
  });

  it('변경 요약: 비어 있는 구조 변경은 키 자체를 싣지 않는다 (가격만 바꾼 게시의 요약은 옛 모양 그대로)', () => {
    const world = threeTreatmentWorld();
    save(world, { priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }] });
    expect(publish(world).changeSummary).toEqual({ addedTreatmentIds: [], removedTreatmentIds: [], priceChangedTreatmentIds: [T1], baseFeesChanged: false });
  });

  it('변경 요약: 순서 변경은 남는 기존 치료끼리의 순위만 센다 (새 치료가 끼어들거나 숨긴 치료가 빠져 번호만 밀리는 것은 아니다)', () => {
    const world = threeTreatmentWorld();
    save(world, { additions: [additionBody(A)], deactivations: [T1], order: [A, T2, T3] });
    expect(publish(world).changeSummary).toMatchObject({ deactivatedTreatmentIds: [T1] });
    expect(world.repo.listCatalogVersions(CLINIC).at(-1)!.changeSummary.reorderedTreatmentIds).toBeUndefined();

    const second = threeTreatmentWorld();
    save(second, { order: [T3, T1, T2] });
    expect(publish(second).changeSummary.reorderedTreatmentIds).toEqual([T1, T2, T3]);
    const third = threeTreatmentWorld();
    save(third, { order: [T1, T3, T2] });
    expect(publish(third).changeSummary.reorderedTreatmentIds).toEqual([T2, T3]);
  });

  it('숨김만 게시해도 카탈로그가 새 버전으로 바뀌고 가격 바꾼 치료는 없다', () => {
    const world = threeTreatmentWorld();
    const before = world.repo.getClinicCurrentCatalogVersion(CLINIC)!;
    save(world, { deactivations: [T3] });
    const published = publish(world);
    expect(published.id).not.toBe(before.id);
    expect(published.treatmentVersionIds).toEqual(before.treatmentVersionIds);
    expect(displayed(world)).toEqual([T1, T2]);
  });

  it('모든 치료를 숨기고 새 치료 하나만 남겨도 게시된다', () => {
    const world = threeTreatmentWorld();
    save(world, { additions: [additionBody(A)], deactivations: [T1, T2, T3] });
    publish(world);
    expect(displayed(world)).toEqual([ADDED_1]);
  });

  it('게시 뒤 감사 기록: 게시 감사에 초안 내용 전체의 지문이 사유로 남는다', () => {
    const world = threeTreatmentWorld();
    const draft = save(world, FULL());
    publish(world);
    const last = world.repo.listAuditLog().at(-1)!;
    expect(last).toMatchObject({ action: 'CATALOG_DRAFT_PUBLISH', reason: `DRAFT_OF:${draftContentDigest(draft)}` });
  });
});

describe('초안 게시 (구조 편집): 새 치료는 보장 판단 없이 나간다', () => {
  it('새 치료의 치료 버전: 분류는 NEEDS_REVIEW 로 고정, 출처는 서버가 주입한 값, 표시 필드는 요청 그대로', () => {
    const world = threeTreatmentWorld();
    save(world, { additions: [additionBody(A, { benefitType: 'NON_BENEFIT', procedureCodes: ['P1', 'P2'] })] });
    publish(world);
    const version = world.repo.listTreatmentVersions(ADDED_1)[0]!;
    expect(version).toEqual({
      id: 'TEST_FIXTURE_TREATMENT_VERSION_1',
      treatmentId: ADDED_1,
      displayName: `TEST_FIXTURE 새 치료 ${A}`,
      description: 'TEST_FIXTURE 새 치료 설명',
      benefitType: 'NON_BENEFIT',
      patientAmount: 7_000,
      amountCondition: { patientType: 'TEST_FIXTURE_PATIENT', assumption: 'TEST_FIXTURE_ASSUMPTION', referenceDate: '2026-11-01' },
      treatmentCode: `TEST_FIXTURE_NEW_TC_${A}`,
      procedureCodes: ['P1', 'P2'],
      calcClass: 'NEEDS_REVIEW',
      documentFlags: { imaging: false, biopsy: true, opinionRequired: false },
      origin: 'TEST_FIXTURE',
      effectiveDate: '2026-11-01',
    });
    expect(world.repo.getTreatment(ADDED_1)).toEqual({ id: ADDED_1, clinicId: CLINIC, sortOrder: 4, active: true });
  });

  it('매핑·재검토 요청·항목 상태·규칙 묶음·규칙 사용 범위는 하나도 만들어지지 않는다 (저장소 변경은 치료·치료 버전·카탈로그·병원·감사뿐이고, 초안은 저장했다 닫혀 남지 않는다)', () => {
    const world = threeTreatmentWorld();
    const before = world.repo.exportState();
    const auditBefore = world.repo.listAuditLog().length;
    save(world, { additions: [additionBody(A)], deactivations: [T2], order: [A, T1, T3] });
    publish(world);
    expect(changedKeys(before, world.repo.exportState())).toEqual(['auditLog', 'catalogVersions', 'clinics', 'treatmentVersions', 'treatments']);
    expect(world.repo.listCoverageReviewRequests(CLINIC)).toEqual([]);
    expect(world.repo.listAuditLog().slice(auditBefore).map((entry) => entry.action).filter((action) => /REREVIEW|MAPPING|ITEM|REVIEW_REQUEST/.test(action))).toEqual([]);
    expect((world.repo.listItemVersions('MAPPING') as Array<ItemVersionRecordOf<'MAPPING'>>).some((record) => record.content.treatmentId === ADDED_1)).toBe(false);
  });

  it('운영 구성(허용 출처 OPERATING)에서도 서버가 정한 출처가 OPERATING 이면 새 치료를 게시할 수 있다 (운영 세계)', () => {
    const { world } = originWorld();
    save(world, { additions: [additionBody(A)] });
    const published = publishCatalogDraft(world.deps, HA, CLINIC, confirmationOf(world), OPERATING_CATALOG_CONFIG);
    expect(world.repo.listTreatmentVersions(ADDED_1)[0]).toMatchObject({ origin: 'OPERATING', calcClass: 'NEEDS_REVIEW' });
    expect(published.changeSummary.addedTreatmentIds).toEqual([ADDED_1]);
  });
});

describe('초안 게시 (구조 편집): 하나라도 실패하면 모두 되돌려진다', () => {
  const draftBody = () => ({
    priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }],
    additions: [additionBody(A), additionBody(B)],
    deactivations: [T2],
    order: [B, T3, T1, A],
  });

  it('게시 검증 실패(운영 허용 출처에 시험 자료 출처의 새 치료): 400 계열 거절, 저장소 전체가 같고 새 치료 기록·식별자 소비가 없다', () => {
    const world = threeTreatmentWorld();
    save(world, { additions: [additionBody(A)] });
    const confirmation = confirmationOf(world);
    const before = world.repo.exportState();
    const error = rejectionOf(() => publishCatalogDraft(world.deps, HA, CLINIC, confirmation, OPERATING_CATALOG_CONFIG, 'TEST_FIXTURE'));
    expect(error.code).toBe('PUBLISH_VALIDATION_FAILED');
    // 기존 치료 버전(시험 자료 출처)도 같은 이유로 거절되지만, 새 치료 버전의 출처 결함이 목록 끝(인덱스 3)에 있다.
    expect(error.defects).toContainEqual({ code: 'ORIGIN_NOT_ACCEPTED', path: 'treatmentVersions[3].origin' });
    expect(world.repo.exportState()).toEqual(before);
    expect(world.ids.next('TREATMENT')).toBe(ADDED_1);
    expect(world.ids.next('TREATMENT_VERSION')).toBe('TEST_FIXTURE_TREATMENT_VERSION_1');
  });

  it('운영 구성에서 서버가 정한 새 치료 출처가 허용 밖이면(시험 자료 출처) 새 치료만 있는 초안도 거절된다: ORIGIN_NOT_ACCEPTED 와 아무것도 바뀌지 않음', () => {
    const { world } = originWorld();
    save(world, { additions: [additionBody(A)] });
    const confirmation = confirmationOf(world);
    const before = world.repo.exportState();
    const error = rejectionOf(() => publishCatalogDraft(world.deps, HA, CLINIC, confirmation, OPERATING_CATALOG_CONFIG, 'TEST_FIXTURE'));
    expect(error.defects).toEqual([{ code: 'ORIGIN_NOT_ACCEPTED', path: 'treatmentVersions[2].origin' }]);
    expect(world.repo.exportState()).toEqual(before);
    expect(world.repo.getCatalogDraft(CLINIC)).not.toBeNull();
  });

  // 새 치료 기록이 이미 쓰인 뒤(게시 서비스 호출 전후)에 저장소 쓰기가 던지는 경우. 어느 지점에서 던져도 치료 기록·치료 버전·카탈로그·병원·초안·감사 기록이 호출 전과 같다.
  it.each<[string, string, number]>([
    ['새 치료 기록을 쓴 뒤, 치료 버전을 쓰는 중', 'putTreatmentVersion', 0],
    ['치료 버전을 모두 쓴 뒤, 카탈로그 버전을 쓰는 중', 'putCatalogVersion', 0],
    ['카탈로그가 게시된 뒤, 병원의 현재 카탈로그를 바꾸는 중', 'saveClinic', 0],
    ['첫 새 치료 기록을 쓴 뒤, 둘째 새 치료 기록을 쓰는 중', 'saveTreatment', 1],
    ['게시가 끝난 뒤, 숨김을 쓰는 중', 'saveTreatment', 2],
    ['숨김을 쓴 뒤, 표시 순서를 쓰는 중', 'saveTreatment', 3],
    ['표시 순서를 일부 쓴 뒤, 나머지를 쓰는 중', 'saveTreatment', 5],
    ['모든 치료 기록을 쓴 뒤, 초안을 닫는 중', 'closeCatalogDraft', 0],
    ['초안을 닫은 뒤, 게시 감사 기록을 쓰는 중', 'appendAuditLog', 1],
  ])('%s: 되돌려진다', (_name, method, afterCalls) => {
    const world = threeTreatmentWorld();
    save(world, draftBody());
    const confirmation = confirmationOf(world);
    const before = world.repo.exportState();
    const failing = repoThrowingOn(world.repo, method, afterCalls);
    expect(() => publishCatalogDraft(depsOver(world, failing.repo), HA, CLINIC, confirmation, TEST_CATALOG_CONFIG, 'TEST_FIXTURE')).toThrow(`INJECTED_FAILURE:${method}`);
    expect(failing.calls.length).toBeGreaterThan(afterCalls);
    expect(world.repo.exportState()).toEqual(before);
    // 되돌린 뒤 같은 확인값으로 다시 게시하면 성공한다 (초안이 그대로 남아 있다).
    expect(displayed(world)).toEqual([T1, T2, T3]);
    expect(world.repo.getTreatment(ADDED_1)).toBeNull();
    publishCatalogDraft(world.deps, HA, CLINIC, confirmation, TEST_CATALOG_CONFIG, 'TEST_FIXTURE');
    // 식별자 생성기는 저장소의 일부가 아니라 되돌려지지 않는다(번호는 소모된다): 새 치료 id 가 아니라 표시 이름으로 본다.
    expect(displayedNames(world)).toEqual([`TEST_FIXTURE 새 치료 ${B}`, 'TEST_FIXTURE 치료 3', 'TEST_FIXTURE 시험 치료', `TEST_FIXTURE 새 치료 ${A}`]);
  });

  it('식별자 생성기가 이미 있는 치료 id 를 내면 (서버 무결성 결함) 다른 병원 기록을 덮어쓰지 않고 던지며 아무것도 바뀌지 않는다', () => {
    const world = threeTreatmentWorld();
    addOtherClinic(world.repo);
    save(world, { additions: [additionBody(A)] });
    const confirmation = confirmationOf(world);
    const before = world.repo.exportState();
    const colliding = { repo: world.repo, clock: world.clock, ids: { next: (prefix: string) => (prefix === 'TREATMENT' ? OTHER_CLINIC_TREATMENT_ID : world.ids.next(prefix)) } };
    expect(() => publishCatalogDraft(colliding, HA, CLINIC, confirmation, TEST_CATALOG_CONFIG, 'TEST_FIXTURE')).toThrow(/이미 저장소에 있다/);
    expect(world.repo.exportState()).toEqual(before);
    expect(world.repo.getTreatment(OTHER_CLINIC_TREATMENT_ID)).toMatchObject({ clinicId: OTHER_CLINIC_ID });
  });

  it('저장한 뒤 숨김 대상이 이미 비활성이 되었으면 낡은 초안처럼 거절한다 (쓰기 전에): STATE_CONFLICT(DRAFT_STALE)', () => {
    const world = threeTreatmentWorld();
    save(world, { additions: [additionBody(A)], deactivations: [T2] });
    const confirmation = confirmationOf(world);
    world.repo.saveTreatment({ ...world.repo.getTreatment(T2)!, active: false });
    const before = world.repo.exportState();
    const error = rejectionOf(() => publishCatalogDraft(world.deps, HA, CLINIC, confirmation, TEST_CATALOG_CONFIG, 'TEST_FIXTURE'));
    expect(error.code).toBe('STATE_CONFLICT');
    expect(error.defects).toContainEqual({ code: 'DRAFT_STALE', path: 'draft' });
    expect(world.repo.exportState()).toEqual(before);
  });

  it('저장한 뒤 다른 길로 마지막 남은 치료가 비활성이 되어 모든 치료를 숨기는 초안이 되었으면 DRAFT_STALE 로 거절한다 (쓰기 전에)', () => {
    const world = threeTreatmentWorld();
    save(world, { deactivations: [T2, T3] }); // T1 하나가 남으니 저장은 통과한다
    const confirmation = confirmationOf(world);
    world.repo.saveTreatment({ ...world.repo.getTreatment(T1)!, active: false });
    const before = world.repo.exportState();
    const error = rejectionOf(() => publishCatalogDraft(world.deps, HA, CLINIC, confirmation, TEST_CATALOG_CONFIG, 'TEST_FIXTURE'));
    expect(error.code).toBe('STATE_CONFLICT');
    expect(error.defects).toContainEqual({ code: 'DRAFT_STALE', path: 'draft' });
    expect(world.repo.exportState()).toEqual(before);
    expect(world.repo.getCatalogDraft(CLINIC)).not.toBeNull();
  });

  it('초안이 근거한 카탈로그가 바뀌었으면 구조 편집 초안도 DRAFT_STALE 이고 저장소는 그대로다', () => {
    const world = threeTreatmentWorld();
    save(world, { additions: [additionBody(A)] });
    const confirmation = confirmationOf(world);
    addThirdTreatmentAgain(world);
    const before = world.repo.exportState();
    const error = rejectionOf(() => publishCatalogDraft(world.deps, HA, CLINIC, confirmation, TEST_CATALOG_CONFIG, 'TEST_FIXTURE'));
    expect(error.defects).toContainEqual({ code: 'DRAFT_STALE', path: 'draft' });
    expect(world.repo.exportState()).toEqual(before);
  });

  it.each<[string, Actor]>([
    ['검토 담당자(RV)', TEST_FIXTURE_RV_AUTHOR],
    ['플랫폼 운영자(PO)', TEST_FIXTURE_PO_1],
  ])('HA 가 아니면 구조 편집 초안을 게시할 수 없다 (%s)', (_name, actor) => {
    const world = threeTreatmentWorld();
    save(world, draftBody());
    const before = world.repo.exportState();
    expect(rejectionOf(() => publishCatalogDraft(world.deps, actor, CLINIC, confirmationOf(world, actor), TEST_CATALOG_CONFIG, 'TEST_FIXTURE')).code).toBe('ROLE_NOT_PERMITTED');
    expect(world.repo.exportState()).toEqual(before);
  });

  it('버린 초안은 게시할 수 없다 (DRAFT_ABSENT) 이고 새 치료 기록이 남지 않는다', () => {
    const world = threeTreatmentWorld();
    save(world, { additions: [additionBody(A)] });
    const confirmation = confirmationOf(world);
    expect(discardCatalogDraft(world.deps, HA, CLINIC)).toBe(true);
    const before = world.repo.exportState();
    expect(rejectionOf(() => publishCatalogDraft(world.deps, HA, CLINIC, confirmation, TEST_CATALOG_CONFIG, 'TEST_FIXTURE')).defects).toContainEqual({ code: 'DRAFT_ABSENT', path: 'draft' });
    expect(world.repo.exportState()).toEqual(before);
  });
});

/** 같은 병원의 카탈로그를 한 번 더 게시한다(가격이 같은 사본이라도 새 카탈로그 버전이다): 근거 카탈로그를 바꾸는 방법. */
function addThirdTreatmentAgain(world: World): void {
  const current = world.repo.getClinicCurrentCatalogVersion(CLINIC)!;
  publishCatalog(
    world.deps,
    HA,
    CLINIC,
    { treatmentVersions: current.treatmentVersionIds.map((id) => world.repo.getTreatmentVersion(id)!), commonBaseFees: current.baseFeeIds.map((id) => world.repo.getCommonBaseFee(id)!) },
    TEST_CATALOG_CONFIG,
  );
}

describe('게시 확인값은 초안 내용 전체에 묶인다', () => {
  it('초안 A 의 확인값으로는 초안 B 를 게시할 수 없다 (순서만 다른 B)', () => {
    const world = threeTreatmentWorld();
    save(world, { order: [T3, T1, T2] });
    const confirmationA = confirmationOf(world);
    save(world, { order: [T2, T1, T3] });
    const before = world.repo.exportState();
    const error = rejectionOf(() => publishCatalogDraft(world.deps, HA, CLINIC, confirmationA, TEST_CATALOG_CONFIG, 'TEST_FIXTURE'));
    expect(error.defects).toContainEqual({ code: 'PREVIEW_REQUIRED', path: 'draft' });
    expect(world.repo.exportState()).toEqual(before);
    // B 자신의 확인값으로는 게시된다.
    publish(world);
    expect(displayed(world)).toEqual([T2, T1, T3]);
  });

  it('숨김만 다른 초안의 확인값도 맞지 않다', () => {
    const world = threeTreatmentWorld();
    save(world, { deactivations: [T2], priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }] });
    const confirmationA = confirmationOf(world);
    save(world, { deactivations: [T3], priceEdits: [{ treatmentId: T1, patientAmount: 12_000 }] });
    expect(rejectionOf(() => publishCatalogDraft(world.deps, HA, CLINIC, confirmationA, TEST_CATALOG_CONFIG, 'TEST_FIXTURE')).defects).toContainEqual({ code: 'PREVIEW_REQUIRED', path: 'draft' });
  });

  it('새 치료만 다른 초안의 확인값도 맞지 않다', () => {
    const world = threeTreatmentWorld();
    save(world, { additions: [additionBody(A, { patientAmount: 1_000 })] });
    const confirmationA = confirmationOf(world);
    save(world, { additions: [additionBody(A, { patientAmount: 2_000 })] });
    expect(rejectionOf(() => publishCatalogDraft(world.deps, HA, CLINIC, confirmationA, TEST_CATALOG_CONFIG, 'TEST_FIXTURE')).defects).toContainEqual({ code: 'PREVIEW_REQUIRED', path: 'draft' });
  });

  it('같은 내용으로 다시 저장해도(revision 이 바뀌어) 이전 확인값은 맞지 않고, 지문(draftDigest)은 같다', () => {
    const world = threeTreatmentWorld();
    save(world, { order: [T3, T1, T2] });
    const first = world.repo.getCatalogDraft(CLINIC)!;
    const confirmationA = confirmationOf(world);
    save(world, { order: [T3, T1, T2] });
    const second = world.repo.getCatalogDraft(CLINIC)!;
    expect(draftContentDigest(second)).toBe(draftContentDigest(first));
    expect(confirmationOf(world)).not.toBe(confirmationA);
    expect(rejectionOf(() => publishCatalogDraft(world.deps, HA, CLINIC, confirmationA, TEST_CATALOG_CONFIG, 'TEST_FIXTURE')).defects).toContainEqual({ code: 'PREVIEW_REQUIRED', path: 'draft' });
  });
});
