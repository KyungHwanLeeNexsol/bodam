import { describe, expect, it } from 'vitest';
import { publishCatalog } from '../../src/server/catalog-publish';
import { PUBLISH_DEFECT_CODES, validateCatalogPublish } from '../../src/server/publish-validate';
import { SERVICE_PUBLISH_DEFECT_CODES } from '../../src/server/publish-defects';
import { TEST_FIXTURE_HA_1 } from '../fixtures/server/actors.fixture';
import { BASE_FEE_ID, T1, catalogRequestOf, makeBaseFeeVersion } from '../fixtures/server/base-fee.fixture';
import { makeClinic, makeCommonBaseFee, makeTreatment } from '../fixtures/server/entities.fixture';
import { catchDomainError } from '../fixtures/server/errors.fixture';
import { setAt, unsetAt } from '../fixtures/server/mutate.fixture';
import { TEST_CATALOG_CONFIG, validCatalogRequest } from '../fixtures/server/publish.fixture';
import { newRepo, snapshotOf } from '../fixtures/server/repo.fixture';
import { OTHER_CLINIC_ID, addOtherClinic, catalogWorld, publishCatalogOf } from '../fixtures/server/versioning.fixture';

// 하나의 식별자 공간과 소유 (M3 외부 검토 보완 ①, design.md:157·:318: 치료 줄과 기본비용 줄은 같은 id 공간과 같은 매핑 판정을 쓴다).
//  - 검증기: baseFeeId 형식과 한 카탈로그 안의 중복
//  - 저장소 백스톱: 치료 id 와 기본비용의 baseFeeId 는 서로 겹치지 못한다 (둘 다 엔진 줄의 treatmentId 가 된다)
//  - 카탈로그 게시의 소유 확인: 치료 id 와 충돌하는 baseFeeId, 다른 병원의 기본비용에 속한 baseFeeId
// 거절은 모두 저장소 전체 상태의 전후 비교가 같고, 고친 요청은 같은 세계에서 게시된다. 시험 자료는 전부 TEST_FIXTURE 다.

const FEE = 'commonBaseFees';
const valid = validCatalogRequest();

describe('검증기: baseFeeId 형식과 중복', () => {
  it('올바른 요청(baseFeeId 가 모두 다르다)에는 결함이 없다', () => {
    expect(validateCatalogPublish(valid, TEST_CATALOG_CONFIG)).toEqual([]);
  });

  it('baseFeeId 가 없으면 VALUE_MISSING, null 이어도 VALUE_MISSING', () => {
    expect(validateCatalogPublish(unsetAt(valid, [FEE, 1, 'baseFeeId']), TEST_CATALOG_CONFIG)).toEqual([{ code: 'VALUE_MISSING', path: `${FEE}[1].baseFeeId` }]);
    expect(validateCatalogPublish(setAt(valid, [FEE, 1, 'baseFeeId'], null), TEST_CATALOG_CONFIG)).toEqual([{ code: 'VALUE_MISSING', path: `${FEE}[1].baseFeeId` }]);
  });

  it.each([['빈 문자열', ''], ['숫자', 5], ['객체', {}]])('baseFeeId 가 %s 이면 VALUE_INVALID', (_name, value) => {
    expect(validateCatalogPublish(setAt(valid, [FEE, 0, 'baseFeeId'], value), TEST_CATALOG_CONFIG)).toEqual([{ code: 'VALUE_INVALID', path: `${FEE}[0].baseFeeId` }]);
  });

  it('같은 baseFeeId 가 한 카탈로그에 둘이면(서로 다른 버전 id) 둘 다 DUPLICATE_BASE_FEE_ID 다', () => {
    const request = { treatmentVersions: [], commonBaseFees: [makeBaseFeeVersion(1), makeBaseFeeVersion(2)] };
    expect(validateCatalogPublish(request, TEST_CATALOG_CONFIG)).toEqual([
      { code: 'DUPLICATE_BASE_FEE_ID', path: `${FEE}[0].baseFeeId` },
      { code: 'DUPLICATE_BASE_FEE_ID', path: `${FEE}[1].baseFeeId` },
    ]);
  });

  it('버전 id 도 같으면 기존 DUPLICATE_ID 가 먼저 나오고 DUPLICATE_BASE_FEE_ID 가 뒤따른다 (기존 결함 코드는 그대로다)', () => {
    const request = { treatmentVersions: [], commonBaseFees: [makeBaseFeeVersion(1), makeBaseFeeVersion(1)] };
    expect(validateCatalogPublish(request, TEST_CATALOG_CONFIG).map((defect) => `${defect.code}@${defect.path}`)).toEqual([
      `DUPLICATE_ID@${FEE}[0].id`,
      `DUPLICATE_ID@${FEE}[1].id`,
      `DUPLICATE_BASE_FEE_ID@${FEE}[0].baseFeeId`,
      `DUPLICATE_BASE_FEE_ID@${FEE}[1].baseFeeId`,
    ]);
  });

  it('비어 있거나 문자열이 아닌 baseFeeId 는 중복으로 세지 않는다 (VALUE_INVALID 만 낸다)', () => {
    let request = setAt(valid, [FEE, 0, 'baseFeeId'], '');
    request = setAt(request, [FEE, 1, 'baseFeeId'], '');
    expect(validateCatalogPublish(request, TEST_CATALOG_CONFIG)).toEqual([
      { code: 'VALUE_INVALID', path: `${FEE}[0].baseFeeId` },
      { code: 'VALUE_INVALID', path: `${FEE}[1].baseFeeId` },
    ]);
  });

  it('치료의 treatmentId 와 baseFeeId 가 같은 것은 검증기가 보지 않는다 (저장소를 읽는 소유 확인의 몫)', () => {
    const request = setAt(valid, [FEE, 0, 'baseFeeId'], 'TEST_FIXTURE_TREATMENT_1');
    expect(validateCatalogPublish(request, TEST_CATALOG_CONFIG)).toEqual([]);
  });

  it('필드 보고 순서: 기본비용 항목 안에서 id → baseFeeId → clinicId → displayName → ... 순이다', () => {
    let request = unsetAt(valid, [FEE, 0, 'clinicId']);
    request = unsetAt(request, [FEE, 0, 'baseFeeId']);
    request = unsetAt(request, [FEE, 0, 'id']);
    expect(validateCatalogPublish(request, TEST_CATALOG_CONFIG).map((defect) => defect.path)).toEqual([`${FEE}[0].id`, `${FEE}[0].baseFeeId`, `${FEE}[0].clinicId`]);
  });

  it('새 결함 코드는 닫힌 목록에 있다', () => {
    expect(PUBLISH_DEFECT_CODES).toContain('DUPLICATE_BASE_FEE_ID');
    expect(SERVICE_PUBLISH_DEFECT_CODES).toEqual(expect.arrayContaining(['BASE_FEE_ID_COLLIDES_WITH_TREATMENT', 'BASE_FEE_ID_CLINIC_MISMATCH']));
    // 기존 코드 이름은 바뀌지 않았다.
    expect(SERVICE_PUBLISH_DEFECT_CODES).toEqual(
      expect.arrayContaining(['TREATMENT_ABSENT', 'TREATMENT_CLINIC_MISMATCH', 'BASE_FEE_CLINIC_MISMATCH', 'TREATMENT_VERSION_ABSENT', 'FINGERPRINT_STALE']),
    );
  });
});

describe('저장소 백스톱: 치료 id 와 기본비용 baseFeeId 는 한 id 공간이다', () => {
  function repoWithTreatmentAndFee() {
    const repo = newRepo();
    repo.saveClinic(makeClinic());
    repo.saveTreatment(makeTreatment());
    repo.putCommonBaseFee(makeBaseFeeVersion(1));
    return repo;
  }

  it('기존 치료 id 와 같은 baseFeeId 의 기본비용은 DUPLICATE_KEY 로 거절되고 저장소는 그대로다', () => {
    const repo = repoWithTreatmentAndFee();
    const before = snapshotOf(repo);
    const error = catchDomainError(() => repo.putCommonBaseFee(makeBaseFeeVersion(2, { baseFeeId: T1 })));
    expect(error.code).toBe('DUPLICATE_KEY');
    expect(snapshotOf(repo)).toEqual(before);
    expect(repo.listCommonBaseFeeVersions(T1)).toEqual([]);
  });

  it('기존 baseFeeId 와 같은 id 의 치료는 DUPLICATE_KEY 로 거절되고 저장소는 그대로다 (병원이 같아도 마찬가지)', () => {
    const repo = repoWithTreatmentAndFee();
    const before = snapshotOf(repo);
    const error = catchDomainError(() => repo.saveTreatment(makeTreatment({ id: BASE_FEE_ID })));
    expect(error.code).toBe('DUPLICATE_KEY');
    expect(snapshotOf(repo)).toEqual(before);
    expect(repo.getTreatment(BASE_FEE_ID)).toBeNull();
  });

  it('트랜잭션 안에서 거절돼도 그 안의 앞선 쓰기까지 함께 되돌려진다', () => {
    const repo = repoWithTreatmentAndFee();
    const before = snapshotOf(repo);
    expect(() =>
      repo.transaction(() => {
        repo.putCommonBaseFee(makeBaseFeeVersion(2));
        repo.saveTreatment(makeTreatment({ id: BASE_FEE_ID }));
      }),
    ).toThrow();
    expect(snapshotOf(repo)).toEqual(before);
  });

  it('겹치지 않는 id 는 막지 않는다: 같은 baseFeeId 의 여러 버전, 다른 baseFeeId, 이미 있는 치료를 같은 내용으로 다시 저장', () => {
    const repo = repoWithTreatmentAndFee();
    repo.putCommonBaseFee(makeBaseFeeVersion(2, { amount: 6_000 }));
    repo.putCommonBaseFee(makeCommonBaseFee({ id: 'TEST_FIXTURE_FEE_OTHER' }));
    repo.saveTreatment(makeTreatment());
    repo.saveTreatment(makeTreatment({ id: 'TEST_FIXTURE_TREATMENT_9' }));
    expect(repo.listCommonBaseFeeVersions(BASE_FEE_ID).map((fee) => fee.id)).toEqual([makeBaseFeeVersion(1).id, makeBaseFeeVersion(2).id]);
  });

  it('기본비용 버전 id 는 지금처럼 write-once 이고 같은 내용의 재기록은 멱등이다', () => {
    const repo = repoWithTreatmentAndFee();
    const before = snapshotOf(repo);
    repo.putCommonBaseFee(makeBaseFeeVersion(1));
    expect(snapshotOf(repo)).toEqual(before);
    expect(catchDomainError(() => repo.putCommonBaseFee(makeBaseFeeVersion(1, { amount: 1 }))).code).toBe('IMMUTABLE_VERSION');
    expect(snapshotOf(repo)).toEqual(before);
  });

  it('listCommonBaseFeeVersions: 쓴 순서, 없는 id 는 빈 목록, 복사본을 돌려준다', () => {
    const repo = repoWithTreatmentAndFee();
    repo.putCommonBaseFee(makeBaseFeeVersion(3));
    repo.putCommonBaseFee(makeBaseFeeVersion(2));
    expect(repo.listCommonBaseFeeVersions(BASE_FEE_ID).map((fee) => fee.id)).toEqual([makeBaseFeeVersion(1).id, makeBaseFeeVersion(3).id, makeBaseFeeVersion(2).id]);
    expect(repo.listCommonBaseFeeVersions('TEST_FIXTURE_NO_SUCH_FEE')).toEqual([]);
    repo.listCommonBaseFeeVersions(BASE_FEE_ID)[0]!.amount = 1;
    expect(repo.listCommonBaseFeeVersions(BASE_FEE_ID)[0]!.amount).toBe(makeBaseFeeVersion(1).amount);
    expect(repo.spy.counts.listCommonBaseFeeVersions).toBeGreaterThan(0);
  });
});

describe('카탈로그 게시의 소유 확인: 하나의 id 공간과 기본비용 소유', () => {
  /** 병원 1·2, 병원 1 의 치료 둘, 병원 2 의 치료 하나. 병원 2 에는 BASE_FEE_ID 기본비용이 게시되어 있다. */
  function worldWithOtherClinicFee() {
    const w = catalogWorld();
    addOtherClinic(w.repo);
    publishCatalog(w.deps, TEST_FIXTURE_HA_1, OTHER_CLINIC_ID, { treatmentVersions: [], commonBaseFees: [makeBaseFeeVersion(1, { clinicId: OTHER_CLINIC_ID })] }, TEST_CATALOG_CONFIG);
    return w;
  }

  it('같은 baseFeeId 가 한 카탈로그에 둘이면 PUBLISH_VALIDATION_FAILED 이고 저장소 전후 비교가 같다, 하나로 고치면 게시된다', () => {
    const w = catalogWorld();
    const before = snapshotOf(w.repo);
    const error = catchDomainError(() => publishCatalogOf(w, catalogRequestOf([makeBaseFeeVersion(1), makeBaseFeeVersion(2, { amount: 6_000 })])));
    expect(error.code).toBe('PUBLISH_VALIDATION_FAILED');
    expect(error.defects).toEqual([
      { code: 'DUPLICATE_BASE_FEE_ID', path: `${FEE}[0].baseFeeId` },
      { code: 'DUPLICATE_BASE_FEE_ID', path: `${FEE}[1].baseFeeId` },
    ]);
    expect(snapshotOf(w.repo)).toEqual(before);
    expect(() => publishCatalogOf(w, catalogRequestOf([makeBaseFeeVersion(2, { amount: 6_000 })]))).not.toThrow();
  });

  it('치료 id 와 같은 baseFeeId 는 BASE_FEE_ID_COLLIDES_WITH_TREATMENT 이고 저장소 전후 비교가 같다, 다른 baseFeeId 로 고치면 게시된다', () => {
    const w = catalogWorld();
    publishCatalogOf(w, catalogRequestOf([makeBaseFeeVersion(1)]));
    const before = snapshotOf(w.repo);

    const error = catchDomainError(() => publishCatalogOf(w, catalogRequestOf([makeBaseFeeVersion(2, { baseFeeId: T1 })])));

    expect(error.code).toBe('PUBLISH_VALIDATION_FAILED');
    expect(error.defects).toEqual([{ code: 'BASE_FEE_ID_COLLIDES_WITH_TREATMENT', path: `${FEE}[0].baseFeeId` }]);
    expect(snapshotOf(w.repo)).toEqual(before);
    expect(() => publishCatalogOf(w, catalogRequestOf([makeBaseFeeVersion(2)]))).not.toThrow();
  });

  it('다른 병원의 기본비용 버전이 있는 baseFeeId 는 BASE_FEE_ID_CLINIC_MISMATCH 이고 저장소 전후 비교가 같다, 다른 baseFeeId 로 고치면 게시된다', () => {
    const w = worldWithOtherClinicFee();
    const before = snapshotOf(w.repo);

    const error = catchDomainError(() => publishCatalogOf(w, catalogRequestOf([makeBaseFeeVersion(2)])));

    expect(error.code).toBe('PUBLISH_VALIDATION_FAILED');
    expect(error.defects).toEqual([{ code: 'BASE_FEE_ID_CLINIC_MISMATCH', path: `${FEE}[0].baseFeeId` }]);
    expect(snapshotOf(w.repo)).toEqual(before);
    expect(w.repo.listCommonBaseFeeVersions(BASE_FEE_ID).map((fee) => fee.clinicId)).toEqual([OTHER_CLINIC_ID]);
    expect(() => publishCatalogOf(w, catalogRequestOf([makeBaseFeeVersion(2, { baseFeeId: 'TEST_FIXTURE_BASE_FEE_B' })]))).not.toThrow();
  });

  it('병원 id 자체가 틀린 기본비용은 기존 BASE_FEE_CLINIC_MISMATCH 로 보고하고 항목 안의 보고 순서는 병원 불일치 → 치료 id 충돌 → baseFeeId 소유 불일치다', () => {
    const w = worldWithOtherClinicFee();
    const error = catchDomainError(() => publishCatalogOf(w, catalogRequestOf([makeBaseFeeVersion(2, { clinicId: OTHER_CLINIC_ID, baseFeeId: T1 }), makeBaseFeeVersion(3)])));
    expect(error.defects.map((defect) => `${defect.code}@${defect.path}`)).toEqual([
      `BASE_FEE_CLINIC_MISMATCH@${FEE}[0].clinicId`,
      `BASE_FEE_ID_COLLIDES_WITH_TREATMENT@${FEE}[0].baseFeeId`,
      `BASE_FEE_ID_CLINIC_MISMATCH@${FEE}[1].baseFeeId`,
    ]);
  });

  it('같은 병원에서 같은 baseFeeId 의 새 버전을 다른 카탈로그에 게시하는 것은 막지 않는다', () => {
    const w = catalogWorld();
    publishCatalogOf(w, catalogRequestOf([makeBaseFeeVersion(1)]));
    expect(() => publishCatalogOf(w, catalogRequestOf([makeBaseFeeVersion(2, { amount: 6_000 })]))).not.toThrow();
    expect(w.repo.listCommonBaseFeeVersions(BASE_FEE_ID).map((fee) => fee.amount)).toEqual([5_000, 6_000]);
  });
});
