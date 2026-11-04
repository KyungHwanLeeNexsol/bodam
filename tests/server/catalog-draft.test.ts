import { describe, expect, it } from 'vitest';
import { discardCatalogDraft, parsePriceEdits, publishCatalogDraft, saveCatalogDraft } from '../../src/server/catalog-draft';
import { publishCatalog } from '../../src/server/catalog-publish';
import { DomainError } from '../../src/server/domain/errors';
import type { Actor } from '../../src/server/domain/actor';
import { TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1, TEST_FIXTURE_RV_AUTHOR } from '../fixtures/server/actors.fixture';
import { buildWorld } from '../fixtures/server/estimate-world.fixture';
import { T1, T2 } from '../fixtures/server/base-fee.fixture';
import { makeTreatmentVersion } from '../fixtures/server/entities.fixture';
import { OPERATING_CATALOG_CONFIG, TEST_CATALOG_CONFIG } from '../fixtures/server/publish.fixture';
import { OTHER_CLINIC_ID, OTHER_CLINIC_TREATMENT_ID, addOtherClinic } from '../fixtures/server/versioning.fixture';

// 카탈로그 초안 서비스 (M7 첫 기능): 치료 가격 수정 → 초안 저장 → 게시. 도메인 층 시험이다(HTTP 없음).
// 세계는 실제 서비스 경로로 만든다: 병원 1 에 치료 둘(각 10,000원)·공통 기본비용·승인된 매핑·게시된 규칙 묶음·규칙 사용 범위.

const HA = TEST_FIXTURE_HA_1;
const edit = (treatmentId: string, patientAmount: number) => ({ treatmentId, patientAmount });
const edits = (...list: Array<ReturnType<typeof edit>>) => ({ priceEdits: list });

function dumpWithout(state: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  const copy = { ...state };
  for (const key of keys) {
    delete copy[key];
  }
  return copy;
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

describe('parsePriceEdits (형식 검사)', () => {
  it('가격 수정 한 건은 treatmentId 와 patientAmount 둘뿐이다', () => {
    expect(parsePriceEdits(edits(edit(T1, 12_000)))).toEqual({ ok: true, edits: [edit(T1, 12_000)] });
  });

  it.each<[string, unknown, string, string]>([
    ['객체가 아님', 'x', 'NOT_OBJECT', 'request'],
    ['priceEdits 없음', {}, 'VALUE_MISSING', 'priceEdits'],
    ['배열이 아님', { priceEdits: {} }, 'NOT_ARRAY', 'priceEdits'],
    ['최상위 알 수 없는 키', { priceEdits: [], benefitType: 'BENEFIT' }, 'UNKNOWN_FIELD', 'request.benefitType'],
    ['항목이 객체가 아님', { priceEdits: [1] }, 'NOT_OBJECT', 'priceEdits[0]'],
    ['보장 판단 필드를 같이 보냄(급여 구분)', edits({ ...edit(T1, 1), benefitType: 'NON_BENEFIT' } as never), 'UNKNOWN_FIELD', 'priceEdits[0].benefitType'],
    ['보장 판단 필드를 같이 보냄(행위 코드)', edits({ ...edit(T1, 1), procedureCodes: ['X'] } as never), 'UNKNOWN_FIELD', 'priceEdits[0].procedureCodes'],
    ['치료 이름을 같이 보냄', edits({ ...edit(T1, 1), displayName: 'x' } as never), 'UNKNOWN_FIELD', 'priceEdits[0].displayName'],
    ['치료 id 없음', edits({ patientAmount: 1 } as never), 'VALUE_MISSING', 'priceEdits[0].treatmentId'],
    ['빈 치료 id', edits(edit('', 1)), 'VALUE_INVALID', 'priceEdits[0].treatmentId'],
    ['가격 없음', edits({ treatmentId: T1 } as never), 'VALUE_MISSING', 'priceEdits[0].patientAmount'],
    ['가격이 문자열', edits({ treatmentId: T1, patientAmount: '1000' } as never), 'VALUE_INVALID', 'priceEdits[0].patientAmount'],
    ['가격이 음수', edits(edit(T1, -1)), 'VALUE_INVALID', 'priceEdits[0].patientAmount'],
    ['가격이 소수', edits(edit(T1, 100.5)), 'VALUE_INVALID', 'priceEdits[0].patientAmount'],
    ['가격이 NaN', edits(edit(T1, Number.NaN)), 'VALUE_INVALID', 'priceEdits[0].patientAmount'],
    ['가격이 범위 밖(큰 수)', edits(edit(T1, Number.MAX_SAFE_INTEGER)), 'VALUE_INVALID', 'priceEdits[0].patientAmount'],
    ['같은 치료가 두 번', edits(edit(T1, 1), edit(T1, 2)), 'DUPLICATE_TREATMENT_ID', 'priceEdits[1].treatmentId'],
  ])('거절: %s', (_name, body, code, path) => {
    const parsed = parsePriceEdits(body);
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.defects).toContainEqual({ code, path });
  });
});

describe('초안 저장 (saveCatalogDraft)', () => {
  it('가격만 초안에 저장하고 게시된 기록(치료 버전·카탈로그·병원)·묶음·매핑 상태는 하나도 바뀌지 않는다', () => {
    const { world } = buildWorld();
    const before = world.repo.exportState();
    const draft = saveCatalogDraft(world.deps, HA, TEST_FIXTURE_CLINIC_ID, edits(edit(T1, 12_000)));
    expect(draft.priceEdits).toEqual([edit(T1, 12_000)]);
    expect(draft.updatedBy).toEqual(HA);
    const after = world.repo.exportState();
    // 초안과 감사 기록 말고는 저장소 전체가 같다.
    expect(dumpWithout(after, 'catalogDrafts', 'auditLog')).toEqual(dumpWithout(before, 'catalogDrafts', 'auditLog'));
    expect(world.repo.getClinicCurrentCatalogVersion(TEST_FIXTURE_CLINIC_ID)?.id).toBe(draft.baseCatalogVersionId);
    expect(world.repo.getCatalogDraft(TEST_FIXTURE_CLINIC_ID)).toEqual(draft);
    expect(world.repo.listAuditLog().at(-1)).toMatchObject({ action: 'CATALOG_DRAFT_SAVE', actorId: HA.id, role: 'HA', target: `CATALOG_DRAFT/${TEST_FIXTURE_CLINIC_ID}` });
  });

  it('현재 가격과 같은 항목은 걸러 내고, 다시 저장하면 덮어쓴다(병원마다 하나)', () => {
    const { world } = buildWorld();
    saveCatalogDraft(world.deps, HA, TEST_FIXTURE_CLINIC_ID, edits(edit(T2, 20_000), edit(T1, 10_000)));
    expect(world.repo.getCatalogDraft(TEST_FIXTURE_CLINIC_ID)?.priceEdits).toEqual([edit(T2, 20_000)]);
    saveCatalogDraft(world.deps, HA, TEST_FIXTURE_CLINIC_ID, edits(edit(T1, 11_000)));
    expect(world.repo.getCatalogDraft(TEST_FIXTURE_CLINIC_ID)?.priceEdits).toEqual([edit(T1, 11_000)]);
  });

  it.each<[string, unknown, string, string]>([
    ['가격이 음수', edits(edit(T1, -5)), 'VALUE_INVALID', 'priceEdits[0].patientAmount'],
    ['다른 병원의 치료 id', edits(edit(OTHER_CLINIC_TREATMENT_ID, 5_000)), 'TREATMENT_NOT_IN_CATALOG', 'priceEdits[0].treatmentId'],
    ['없는 치료 id', edits(edit('NO_SUCH_TREATMENT', 5_000)), 'TREATMENT_NOT_IN_CATALOG', 'priceEdits[0].treatmentId'],
    ['모두 현재 가격과 같음', edits(edit(T1, 10_000), edit(T2, 10_000)), 'NO_PRICE_CHANGE', 'priceEdits'],
    ['보장 판단 필드를 보냄', edits({ ...edit(T1, 12_000), treatmentCode: 'X' } as never), 'UNKNOWN_FIELD', 'priceEdits[0].treatmentCode'],
  ])('거절(INVALID_INPUT, 저장 상태 불변): %s', (_name, body, code, path) => {
    const { world } = buildWorld();
    saveCatalogDraft(world.deps, HA, TEST_FIXTURE_CLINIC_ID, edits(edit(T2, 15_000)));
    const before = world.repo.exportState();
    const error = rejectionOf(() => saveCatalogDraft(world.deps, HA, TEST_FIXTURE_CLINIC_ID, body));
    expect(error.code).toBe('INVALID_INPUT');
    expect(error.defects).toContainEqual({ code, path });
    expect(world.repo.exportState()).toEqual(before);
  });

  it.each<[string, Actor]>([
    ['검토 담당자(RV)', TEST_FIXTURE_RV_AUTHOR],
    ['플랫폼 운영자(PO)', TEST_FIXTURE_PO_1],
  ])('HA 가 아니면 거절한다 (%s)', (_name, actor) => {
    const { world } = buildWorld();
    const before = world.repo.exportState();
    expect(rejectionOf(() => saveCatalogDraft(world.deps, actor, TEST_FIXTURE_CLINIC_ID, edits(edit(T1, 12_000)))).code).toBe('ROLE_NOT_PERMITTED');
    expect(world.repo.exportState()).toEqual(before);
  });

  it('병원이 없으면 NOT_FOUND, 카탈로그를 게시한 적 없는 병원이면 STATE_CONFLICT(CATALOG_ABSENT)', () => {
    const { world } = buildWorld();
    expect(rejectionOf(() => saveCatalogDraft(world.deps, HA, 'NO_SUCH_CLINIC', edits(edit(T1, 1)))).code).toBe('NOT_FOUND');
    addOtherClinic(world.repo);
    const error = rejectionOf(() => saveCatalogDraft(world.deps, HA, OTHER_CLINIC_ID, edits(edit(OTHER_CLINIC_TREATMENT_ID, 1))));
    expect(error.code).toBe('STATE_CONFLICT');
    expect(error.defects).toContainEqual({ code: 'CATALOG_ABSENT', path: 'draft' });
  });
});

describe('초안 버리기 (discardCatalogDraft)', () => {
  it('초안을 지우고 감사 기록을 남기며, 초안이 없으면 아무 일도 없다', () => {
    const { world } = buildWorld();
    expect(discardCatalogDraft(world.deps, HA, TEST_FIXTURE_CLINIC_ID)).toBe(false);
    expect(world.repo.listAuditLog()).toHaveLength(world.repo.listAuditLog().length);
    saveCatalogDraft(world.deps, HA, TEST_FIXTURE_CLINIC_ID, edits(edit(T1, 12_000)));
    const auditCount = world.repo.listAuditLog().length;
    expect(discardCatalogDraft(world.deps, HA, TEST_FIXTURE_CLINIC_ID)).toBe(true);
    expect(world.repo.getCatalogDraft(TEST_FIXTURE_CLINIC_ID)).toBeNull();
    expect(world.repo.listAuditLog()).toHaveLength(auditCount + 1);
    expect(world.repo.listAuditLog().at(-1)?.action).toBe('CATALOG_DRAFT_DISCARD');
  });

  it('HA 가 아니면 거절한다', () => {
    const { world } = buildWorld();
    expect(rejectionOf(() => discardCatalogDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, TEST_FIXTURE_CLINIC_ID)).code).toBe('ROLE_NOT_PERMITTED');
  });
});

describe('초안 게시 (publishCatalogDraft)', () => {
  it('가격만 바뀐 새 치료 버전과 새 카탈로그 버전이 게시되고, 초안은 지워지며, 변경 요약은 가격 변경으로 나온다', () => {
    const { world, catalog } = buildWorld();
    saveCatalogDraft(world.deps, HA, TEST_FIXTURE_CLINIC_ID, edits(edit(T1, 12_000)));
    const published = publishCatalogDraft(world.deps, HA, TEST_FIXTURE_CLINIC_ID, TEST_CATALOG_CONFIG);

    expect(published.id).not.toBe(catalog.id);
    expect(world.repo.getClinicCurrentCatalogVersion(TEST_FIXTURE_CLINIC_ID)?.id).toBe(published.id);
    expect(world.repo.getCatalogDraft(TEST_FIXTURE_CLINIC_ID)).toBeNull();
    expect(published.publishedBy).toEqual({ id: HA.id, role: 'HA' });
    expect(published.changeSummary).toEqual({ addedTreatmentIds: [], removedTreatmentIds: [], priceChangedTreatmentIds: [T1], baseFeesChanged: false });
    // 이전 카탈로그와 이전 치료 버전은 그대로 남는다(불변 이력).
    expect(world.repo.getCatalogVersion(catalog.id)).toEqual(catalog);

    const before = world.repo.getTreatmentVersion(catalog.treatmentVersionIds[0] as string)!;
    const afterVersion = published.treatmentVersionIds.map((id) => world.repo.getTreatmentVersion(id)!).find((version) => version.treatmentId === T1)!;
    expect(afterVersion.id).not.toBe(before.id);
    expect(afterVersion.patientAmount).toBe(12_000);
    // 가격 말고는 한 필드도 다르지 않다(보장 판단 필드 포함).
    expect({ ...afterVersion, id: before.id, patientAmount: before.patientAmount }).toEqual(before);
    // 가격을 바꾸지 않은 치료는 같은 치료 버전을 그대로 가리킨다.
    expect(published.treatmentVersionIds.filter((id) => catalog.treatmentVersionIds.includes(id))).toHaveLength(catalog.treatmentVersionIds.length - 1);
  });

  it('가격 수정은 보장 매핑 승인·규칙 묶음·규칙 사용 범위를 바꾸지 않는다 (재검토 전환이 없다)', () => {
    const { world, bundle } = buildWorld();
    const mappingRefs = world.repo.listItemVersions('MAPPING').map((record) => record.ref);
    const statesBefore = world.repo.readItemStates(mappingRefs);
    const bundlesBefore = world.repo.listRuleBundleVersions();
    const scopeBefore = world.repo.listClinicRuleScopeHistory(TEST_FIXTURE_CLINIC_ID);
    const statusBefore = bundle === null ? null : world.repo.listBundleStatusEvents(bundle.id);
    saveCatalogDraft(world.deps, HA, TEST_FIXTURE_CLINIC_ID, edits(edit(T1, 12_000), edit(T2, 9_000)));
    publishCatalogDraft(world.deps, HA, TEST_FIXTURE_CLINIC_ID, TEST_CATALOG_CONFIG);

    expect(mappingRefs.length).toBeGreaterThan(0);
    expect(statesBefore.every((state) => state !== null && ['APPROVED', 'PUBLISHED'].includes(state.state))).toBe(true);
    expect(world.repo.readItemStates(mappingRefs)).toEqual(statesBefore);
    expect(world.repo.listRuleBundleVersions()).toEqual(bundlesBefore);
    expect(world.repo.listClinicRuleScopeHistory(TEST_FIXTURE_CLINIC_ID)).toEqual(scopeBefore);
    if (bundle !== null) {
      expect(world.repo.listBundleStatusEvents(bundle.id)).toEqual(statusBefore);
    }
    // 재검토 요청 기록도 만들어지지 않았다.
    expect(world.repo.listCoverageReviewRequests(TEST_FIXTURE_CLINIC_ID)).toEqual([]);
    const actions = world.repo.listAuditLog().map((entry) => entry.action);
    expect(actions.filter((action) => action.includes('REREVIEW') || action.includes('MAPPING'))).toEqual([]);
  });

  it('게시 검증이 거절하면 저장소 전체가 호출 전과 같고 초안도 남으며 식별자 생성기를 쓰지 않는다 (운영 허용 출처는 시험 자료 줄을 거절한다)', () => {
    const { world } = buildWorld();
    saveCatalogDraft(world.deps, HA, TEST_FIXTURE_CLINIC_ID, edits(edit(T1, 12_000)));
    const before = world.repo.exportState();
    const error = rejectionOf(() => publishCatalogDraft(world.deps, HA, TEST_FIXTURE_CLINIC_ID, OPERATING_CATALOG_CONFIG));
    expect(error.code).toBe('PUBLISH_VALIDATION_FAILED');
    expect(error.defects.some((defect) => defect.code === 'ORIGIN_NOT_ACCEPTED')).toBe(true);
    expect(world.repo.exportState()).toEqual(before);
    expect(world.repo.getCatalogDraft(TEST_FIXTURE_CLINIC_ID)).not.toBeNull();
    expect(world.ids.next('TREATMENT_VERSION')).toBe('TEST_FIXTURE_TREATMENT_VERSION_1');
  });

  it('초안이 없으면 STATE_CONFLICT(DRAFT_ABSENT), 초안이 근거한 카탈로그가 바뀌었으면 STATE_CONFLICT(DRAFT_STALE)이며 저장소는 그대로다', () => {
    const { world, catalog } = buildWorld();
    const absent = rejectionOf(() => publishCatalogDraft(world.deps, HA, TEST_FIXTURE_CLINIC_ID, TEST_CATALOG_CONFIG));
    expect(absent.code).toBe('STATE_CONFLICT');
    expect(absent.defects).toContainEqual({ code: 'DRAFT_ABSENT', path: 'draft' });

    saveCatalogDraft(world.deps, HA, TEST_FIXTURE_CLINIC_ID, edits(edit(T1, 12_000)));
    // 그 사이 다른 게시(같은 병원, 가격만 다른 치료 버전)가 현재 카탈로그를 바꾼다.
    const other = makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_OTHER_PUBLISH', treatmentId: T1, patientAmount: 11_000 });
    const versions = catalog.treatmentVersionIds.map((id) => (id === catalog.treatmentVersionIds[0] ? other : world.repo.getTreatmentVersion(id)!));
    publishCatalog(world.deps, HA, TEST_FIXTURE_CLINIC_ID, { treatmentVersions: versions, commonBaseFees: catalog.baseFeeIds.map((id) => world.repo.getCommonBaseFee(id)!) }, TEST_CATALOG_CONFIG);
    const before = world.repo.exportState();
    const stale = rejectionOf(() => publishCatalogDraft(world.deps, HA, TEST_FIXTURE_CLINIC_ID, TEST_CATALOG_CONFIG));
    expect(stale.code).toBe('STATE_CONFLICT');
    expect(stale.defects).toContainEqual({ code: 'DRAFT_STALE', path: 'draft' });
    expect(world.repo.exportState()).toEqual(before);
  });

  it.each<[string, Actor]>([
    ['검토 담당자(RV)', TEST_FIXTURE_RV_AUTHOR],
    ['플랫폼 운영자(PO)', TEST_FIXTURE_PO_1],
  ])('HA 가 아니면 거절하고 초안·카탈로그가 그대로다 (%s)', (_name, actor) => {
    const { world } = buildWorld();
    saveCatalogDraft(world.deps, HA, TEST_FIXTURE_CLINIC_ID, edits(edit(T1, 12_000)));
    const before = world.repo.exportState();
    expect(rejectionOf(() => publishCatalogDraft(world.deps, actor, TEST_FIXTURE_CLINIC_ID, TEST_CATALOG_CONFIG)).code).toBe('ROLE_NOT_PERMITTED');
    expect(world.repo.exportState()).toEqual(before);
  });
});
