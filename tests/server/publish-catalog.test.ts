import { describe, expect, it } from 'vitest';
import { estimate } from '../../src/engine/estimate';
import { MAX_AMOUNT_WON } from '../../src/engine/limits';
import type { EstimateInput, Origin } from '../../src/engine/types';
import { approve, markPublished, submitForReview } from '../../src/server/approval';
import { createDraft } from '../../src/server/authoring';
import { publishCatalog } from '../../src/server/catalog-publish';
import { canonicalDigest } from '../../src/server/digest';
import type { TreatmentVersion } from '../../src/server/domain/entities';
import { coverageFingerprintOf } from '../../src/server/fingerprint';
import { TEST_AT } from '../fixtures/engine/profiles.fixture';
import { TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1, TEST_FIXTURE_RV_APPROVER, TEST_FIXTURE_RV_AUTHOR } from '../fixtures/server/actors.fixture';
import { TEST_FIXTURE_CLINIC_ID } from '../fixtures/server/actors.fixture';
import { makeCommonBaseFee, makeTreatmentVersion } from '../fixtures/server/entities.fixture';
import { catchDomainError } from '../fixtures/server/errors.fixture';
import { baseContent } from '../fixtures/server/lifecycle.fixture';
import { OPERATING_CATALOG_CONFIG, TEST_CATALOG_CONFIG, validCatalogRequest } from '../fixtures/server/publish.fixture';
import { deepFreeze, setAt } from '../fixtures/server/mutate.fixture';
import { snapshotOf } from '../fixtures/server/repo.fixture';
import {
  OTHER_CLINIC_ID,
  OTHER_CLINIC_TREATMENT_ID,
  addOtherClinic,
  approveSpec,
  catalogWorld,
  engineSnapshotOf,
  lineOfVersion,
  publishCatalogOf,
  publishRefs,
  singleTreatmentRequest,
  validSpec,
} from '../fixtures/server/versioning.fixture';

// 카탈로그 게시 서비스 (M3.D1, design.md DD-14·DD-16·DD-24, 역할 HA).
// 검증기(publish-validate)의 결함은 PUBLISH_VALIDATION_FAILED 로 던져지고, 서비스가 보는 소유 확인 결함도 같은 오류에 담긴다.
// 모든 거절 시험은 저장소 전체 상태의 전후 비교("저장소 전후 비교가 같다")를 한다. 모든 id 는 TEST_FIXTURE 다.

const T1 = 'TEST_FIXTURE_TREATMENT_1';
const T2 = 'TEST_FIXTURE_TREATMENT_2';

describe('카탈로그 게시: 정상 경로', () => {
  it('HA 가 게시하면 새 CatalogVersion 이 쓰이고 병원의 현재 카탈로그가 된다', () => {
    const w = catalogWorld();
    const request = validCatalogRequest();

    const catalog = publishCatalogOf(w, request);

    expect(catalog).toEqual({
      id: 'TEST_FIXTURE_CATALOG_1',
      clinicId: TEST_FIXTURE_CLINIC_ID,
      treatmentVersionIds: ['TEST_FIXTURE_TV_1', 'TEST_FIXTURE_TV_2'],
      baseFeeIds: ['TEST_FIXTURE_FEE_1', 'TEST_FIXTURE_FEE_2'],
      publishedBy: { id: TEST_FIXTURE_HA_1.id, role: 'HA' },
      publishedAt: '2026-10-16T09:00:00.000Z',
      changeSummary: { addedTreatmentIds: [T1, T2], removedTreatmentIds: [], priceChangedTreatmentIds: [], baseFeesChanged: true },
    });
    expect(w.repo.getCatalogVersion(catalog.id)).toEqual(catalog);
    expect(w.repo.getClinic(TEST_FIXTURE_CLINIC_ID)?.currentCatalogVersionId).toBe(catalog.id);
    expect(w.repo.getClinicCurrentCatalogVersion(TEST_FIXTURE_CLINIC_ID)).toEqual(catalog);
  });

  it('치료 버전과 공통 기본비용이 저장소에 쓰인다', () => {
    const w = catalogWorld();
    const request = validCatalogRequest();
    publishCatalogOf(w, request);
    for (const version of request.treatmentVersions) {
      expect(w.repo.getTreatmentVersion(version.id)).toEqual(version);
    }
    for (const fee of request.commonBaseFees) {
      expect(w.repo.getCommonBaseFee(fee.id)).toEqual(fee);
    }
  });

  it('게시는 감사 기록 한 건을 남긴다: 수행자 id·역할, 동작, 대상, 이전/이후 카탈로그', () => {
    const w = catalogWorld();
    const first = publishCatalogOf(w, singleTreatmentRequest());
    w.clock.set('2026-10-17T09:00:00.000Z');
    const second = publishCatalogOf(w, singleTreatmentRequest({ id: 'TEST_FIXTURE_TV_1B', patientAmount: 20_000 }));

    const entries = w.repo.listAuditLog().filter((entry) => entry.action === 'CATALOG_PUBLISH');
    expect(entries).toEqual([
      { id: expect.any(String), actorId: TEST_FIXTURE_HA_1.id, role: 'HA', action: 'CATALOG_PUBLISH', target: `CATALOG/${first.id}`, beforeVersion: null, afterVersion: first.id, reason: null, at: '2026-10-16T09:00:00.000Z' },
      { id: expect.any(String), actorId: TEST_FIXTURE_HA_1.id, role: 'HA', action: 'CATALOG_PUBLISH', target: `CATALOG/${second.id}`, beforeVersion: first.id, afterVersion: second.id, reason: null, at: '2026-10-17T09:00:00.000Z' },
    ]);
  });

  it('요청 객체를 바꾸지 않는다 (깊이 얼린 요청도 게시된다)', () => {
    const w = catalogWorld();
    const request = deepFreeze(validCatalogRequest());
    const before = structuredClone(request);
    expect(() => publishCatalogOf(w, request)).not.toThrow();
    expect(request).toEqual(before);
  });

  it('치료도 기본비용도 없는 빈 카탈로그도 게시된다 (빈 배열은 형식 결함이 아니다)', () => {
    const w = catalogWorld();
    const catalog = publishCatalogOf(w, { treatmentVersions: [], commonBaseFees: [] });
    expect(catalog).toMatchObject({ treatmentVersionIds: [], baseFeeIds: [], changeSummary: { addedTreatmentIds: [], baseFeesChanged: false } });
  });

  it('같은 요청을 두 번 게시하면 id 가 다른 새 버전이 둘 생기고 변경 요약은 비어 있다 (치료 버전 쓰기는 멱등)', () => {
    const w = catalogWorld();
    const first = publishCatalogOf(w);
    const second = publishCatalogOf(w);
    expect(second.id).not.toBe(first.id);
    expect(second.changeSummary).toEqual({ addedTreatmentIds: [], removedTreatmentIds: [], priceChangedTreatmentIds: [], baseFeesChanged: false });
    expect(w.repo.listCatalogVersions(TEST_FIXTURE_CLINIC_ID)).toHaveLength(2);
  });
});

describe('변경 요약: 병원의 직전 현재 카탈로그와 비교한다', () => {
  it('추가·제거·가격 변경·기본비용 변경을 치료 id 코드 포인트 순으로 담는다', () => {
    const w = catalogWorld();
    publishCatalogOf(w, validCatalogRequest()); // T1(10_000), T2(10_000), FEE_1, FEE_2
    const next = publishCatalogOf(w, {
      treatmentVersions: [makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_1B', patientAmount: 12_000 })], // T1 가격만 바뀜, T2 제거
      commonBaseFees: [makeCommonBaseFee({ id: 'TEST_FIXTURE_FEE_1' })], // FEE_2 제거
    });
    expect(next.changeSummary).toEqual({ addedTreatmentIds: [], removedTreatmentIds: [T2], priceChangedTreatmentIds: [T1], baseFeesChanged: true });
  });

  it('가격이 같으면 가격 변경이 아니다 (표시 이름만 바뀐 경우)', () => {
    const w = catalogWorld();
    publishCatalogOf(w, singleTreatmentRequest());
    const next = publishCatalogOf(w, singleTreatmentRequest({ id: 'TEST_FIXTURE_TV_1B', displayName: 'TEST_FIXTURE 바뀐 이름' }));
    expect(next.changeSummary).toEqual({ addedTreatmentIds: [], removedTreatmentIds: [], priceChangedTreatmentIds: [], baseFeesChanged: false });
  });

  it('추가된 치료와 기본비용 목록이 같으면 baseFeesChanged 가 false 다', () => {
    const w = catalogWorld();
    publishCatalogOf(w, singleTreatmentRequest());
    const next = publishCatalogOf(w, validCatalogRequest()); // T2 추가, FEE_2 추가
    expect(next.changeSummary).toEqual({ addedTreatmentIds: [T2], removedTreatmentIds: [], priceChangedTreatmentIds: [], baseFeesChanged: true });
    const same = publishCatalogOf(w, validCatalogRequest());
    expect(same.changeSummary.baseFeesChanged).toBe(false);
  });
});

describe('역할과 대상 병원', () => {
  it.each([
    ['RV', TEST_FIXTURE_RV_AUTHOR],
    ['PO', TEST_FIXTURE_PO_1],
  ])('%s 는 카탈로그를 게시할 수 없다 (ROLE_NOT_PERMITTED, 저장소 변화 없음)', (_role, actor) => {
    const w = catalogWorld();
    const before = snapshotOf(w.repo);
    const error = catchDomainError(() => publishCatalogOf(w, validCatalogRequest(), TEST_CATALOG_CONFIG, actor));
    expect(error.code).toBe('ROLE_NOT_PERMITTED');
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  it('없는 병원은 NOT_FOUND 이고 저장소는 그대로다', () => {
    const w = catalogWorld();
    const before = snapshotOf(w.repo);
    const error = catchDomainError(() => publishRefsCatalog(w, 'TEST_FIXTURE_NO_SUCH_CLINIC'));
    expect(error.code).toBe('NOT_FOUND');
    expect(snapshotOf(w.repo)).toEqual(before);
  });
});

function publishRefsCatalog(w: ReturnType<typeof catalogWorld>, clinicId: string) {
  return publishCatalog(w.deps, TEST_FIXTURE_HA_1, clinicId, validCatalogRequest(), TEST_CATALOG_CONFIG);
}

describe('거절: 서비스가 보는 소유 확인 (검증기는 병원 id 를 받지 않는다)', () => {
  const cases: Array<[string, () => ReturnType<typeof validCatalogRequest>, { code: string; path: string }]> = [
    [
      '다른 병원의 치료에 속한 치료 버전',
      () => ({ ...validCatalogRequest(), treatmentVersions: [makeTreatmentVersion({ treatmentId: OTHER_CLINIC_TREATMENT_ID })] }),
      { code: 'TREATMENT_CLINIC_MISMATCH', path: 'treatmentVersions[0].treatmentId' },
    ],
    [
      '저장소에 없는 치료의 치료 버전',
      () => ({ ...validCatalogRequest(), treatmentVersions: [makeTreatmentVersion({ treatmentId: 'TEST_FIXTURE_NO_SUCH_TREATMENT' })] }),
      { code: 'TREATMENT_ABSENT', path: 'treatmentVersions[0].treatmentId' },
    ],
    [
      '다른 병원 소유의 공통 기본비용',
      () => ({ ...validCatalogRequest(), commonBaseFees: [makeCommonBaseFee({ clinicId: OTHER_CLINIC_ID })] }),
      { code: 'BASE_FEE_CLINIC_MISMATCH', path: 'commonBaseFees[0].clinicId' },
    ],
  ];

  it.each(cases)('%s → 저장소 전후 비교가 같고 이전 카탈로그가 현재로 남는다', (_name, make, defect) => {
    const w = catalogWorld();
    addOtherClinic(w.repo);
    const previous = publishCatalogOf(w, singleTreatmentRequest());
    const before = snapshotOf(w.repo);

    const error = catchDomainError(() => publishCatalogOf(w, make()));

    expect(error.code).toBe('PUBLISH_VALIDATION_FAILED');
    expect(error.defects).toEqual([defect]);
    expect(snapshotOf(w.repo)).toEqual(before);
    expect(w.repo.getClinicCurrentCatalogVersion(TEST_FIXTURE_CLINIC_ID)).toEqual(previous);
    expect(w.repo.listCatalogVersions(TEST_FIXTURE_CLINIC_ID)).toEqual([previous]);
  });

  it('소유 결함이 여럿이면 치료 버전 → 기본비용 순서로 모두 담긴다', () => {
    const w = catalogWorld();
    addOtherClinic(w.repo);
    const error = catchDomainError(() =>
      publishCatalogOf(w, {
        treatmentVersions: [makeTreatmentVersion({ treatmentId: OTHER_CLINIC_TREATMENT_ID }), makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_2', treatmentId: T2 }), makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_3', treatmentId: 'TEST_FIXTURE_NO_SUCH' })],
        commonBaseFees: [makeCommonBaseFee({ clinicId: OTHER_CLINIC_ID })],
      }),
    );
    expect(error.defects.map((defect) => `${defect.code}@${defect.path}`)).toEqual([
      'TREATMENT_CLINIC_MISMATCH@treatmentVersions[0].treatmentId',
      'TREATMENT_ABSENT@treatmentVersions[2].treatmentId',
      'BASE_FEE_CLINIC_MISMATCH@commonBaseFees[0].clinicId',
    ]);
  });

  it('올바르게 고친 요청은 같은 세계에서 게시된다', () => {
    const w = catalogWorld();
    addOtherClinic(w.repo);
    expect(() => publishCatalogOf(w, { ...validCatalogRequest(), commonBaseFees: [makeCommonBaseFee({ clinicId: OTHER_CLINIC_ID })] })).toThrow();
    expect(() => publishCatalogOf(w, validCatalogRequest())).not.toThrow();
  });
});

describe('AC-011h 카탈로그: 범위 밖 값은 필드 경로와 함께 거절되고 아무것도 저장되지 않는다', () => {
  const BAD_AMOUNTS: Array<[string, unknown]> = [
    ['음수', -1],
    ['소수', 1.5],
    ['NaN', Number.NaN],
    ['문자열', '1000'],
    ['MAX_AMOUNT_WON + 1', MAX_AMOUNT_WON + 1],
  ];
  const targets: Array<[string, (value: unknown) => ReturnType<typeof validCatalogRequest>, string]> = [
    ['치료 가격 patientAmount', (value) => ({ ...validCatalogRequest(), treatmentVersions: [makeTreatmentVersion({ patientAmount: value as number })] }), 'treatmentVersions[0].patientAmount'],
    ['공통 기본비용 amount', (value) => ({ ...validCatalogRequest(), commonBaseFees: [makeCommonBaseFee({ amount: value as number })] }), 'commonBaseFees[0].amount'],
  ];

  for (const [targetName, make, path] of targets) {
    it.each(BAD_AMOUNTS)(`${targetName} 가 %s → VALUE_INVALID @ ${path}, 저장소 전후 비교가 같고 이전 버전이 남는다`, (_name, value) => {
      const w = catalogWorld();
      const previous = publishCatalogOf(w, singleTreatmentRequest());
      const before = snapshotOf(w.repo);

      const error = catchDomainError(() => publishCatalogOf(w, make(value)));

      expect(error.code).toBe('PUBLISH_VALIDATION_FAILED');
      expect(error.defects).toEqual([{ code: 'VALUE_INVALID', path }]);
      expect(snapshotOf(w.repo)).toEqual(before);
      expect(w.repo.getClinicCurrentCatalogVersion(TEST_FIXTURE_CLINIC_ID)).toEqual(previous);
    });
  }

  it.each([
    ['0', 0],
    ['MAX_AMOUNT_WON', MAX_AMOUNT_WON],
  ])('경계값 %s 는 가격과 기본비용 모두 게시된다', (_name, value) => {
    const w = catalogWorld();
    const catalog = publishCatalogOf(w, { treatmentVersions: [makeTreatmentVersion({ patientAmount: value })], commonBaseFees: [makeCommonBaseFee({ amount: value })] });
    expect(w.repo.getTreatmentVersion('TEST_FIXTURE_TV_1')?.patientAmount).toBe(value);
    expect(w.repo.getCommonBaseFee('TEST_FIXTURE_FEE_1')?.amount).toBe(value);
    expect(w.repo.getClinicCurrentCatalogVersion(TEST_FIXTURE_CLINIC_ID)?.id).toBe(catalog.id);
  });

  it('결함이 여럿이면 모두 한 오류에 담기고 고친 요청은 게시된다', () => {
    const w = catalogWorld();
    const before = snapshotOf(w.repo);
    const broken = { treatmentVersions: [makeTreatmentVersion({ patientAmount: -5 }), makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_2', treatmentId: T2, patientAmount: 1.5 })], commonBaseFees: [makeCommonBaseFee({ amount: MAX_AMOUNT_WON + 1 })] };
    const error = catchDomainError(() => publishCatalogOf(w, broken));
    expect(error.defects).toEqual([
      { code: 'VALUE_INVALID', path: 'treatmentVersions[0].patientAmount' },
      { code: 'VALUE_INVALID', path: 'treatmentVersions[1].patientAmount' },
      { code: 'VALUE_INVALID', path: 'commonBaseFees[0].amount' },
    ]);
    expect(snapshotOf(w.repo)).toEqual(before);
    expect(() => publishCatalogOf(w, validCatalogRequest())).not.toThrow();
  });

  it('요청 모양이 틀려도 던지는 것은 PUBLISH_VALIDATION_FAILED 뿐이고 저장소는 그대로다', () => {
    const w = catalogWorld();
    const before = snapshotOf(w.repo);
    for (const request of [null, undefined, 5, 'x', [], {}, { treatmentVersions: null, commonBaseFees: [] }, { treatmentVersions: [null], commonBaseFees: [] }]) {
      const error = catchDomainError(() => publishCatalog(w.deps, TEST_FIXTURE_HA_1, TEST_FIXTURE_CLINIC_ID, request as never, TEST_CATALOG_CONFIG));
      expect(error.code).toBe('PUBLISH_VALIDATION_FAILED');
    }
    expect(snapshotOf(w.repo)).toEqual(before);
  });
});

describe('AC-010c 운영 구성은 DEMO·TEST_FIXTURE 출처를 게시하지 않는다', () => {
  const rejectedOrigins: Origin[] = ['DEMO', 'TEST_FIXTURE'];

  it.each(rejectedOrigins)('운영 구성(허용 출처 OPERATING)은 %s 치료 버전을 거절한다 (저장소 전후 비교가 같다)', (origin) => {
    const w = catalogWorld();
    const before = snapshotOf(w.repo);
    const error = catchDomainError(() => publishCatalogOf(w, { treatmentVersions: [makeTreatmentVersion({ origin })], commonBaseFees: [] }, OPERATING_CATALOG_CONFIG));
    expect(error.code).toBe('PUBLISH_VALIDATION_FAILED');
    expect(error.defects).toEqual([{ code: 'ORIGIN_NOT_ACCEPTED', path: 'treatmentVersions[0].origin' }]);
    expect(snapshotOf(w.repo)).toEqual(before);
    expect(w.repo.getClinicCurrentCatalogVersion(TEST_FIXTURE_CLINIC_ID)).toBeNull();
  });

  it.each(rejectedOrigins)('운영 구성은 %s 공통 기본비용을 거절한다 (저장소 전후 비교가 같다)', (origin) => {
    const w = catalogWorld();
    const before = snapshotOf(w.repo);
    const error = catchDomainError(() => publishCatalogOf(w, { treatmentVersions: [], commonBaseFees: [makeCommonBaseFee({ origin })] }, OPERATING_CATALOG_CONFIG));
    expect(error.defects).toEqual([{ code: 'ORIGIN_NOT_ACCEPTED', path: 'commonBaseFees[0].origin' }]);
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  it('운영 구성은 거절된 항목이 섞여 있으면 전체를 거절한다: 다른 항목이 올바라도 아무것도 저장되지 않는다', () => {
    const w = catalogWorld();
    const before = snapshotOf(w.repo);
    const error = catchDomainError(() => publishCatalogOf(w, validCatalogRequest('TEST_FIXTURE'), OPERATING_CATALOG_CONFIG));
    expect(error.defects.map((defect) => defect.path)).toEqual([
      'treatmentVersions[0].origin',
      'treatmentVersions[1].origin',
      'commonBaseFees[0].origin',
      'commonBaseFees[1].origin',
    ]);
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  it('시험 구성(세 출처 허용)은 TEST_FIXTURE 와 DEMO 를 게시한다', () => {
    const w = catalogWorld();
    publishCatalogOf(w, validCatalogRequest('TEST_FIXTURE'), TEST_CATALOG_CONFIG);
    // 같은 id 로 출처만 바꾸면 불변 위반이므로 DEMO 출처 항목은 id 를 달리한다.
    const demo = { treatmentVersions: [makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_DEMO', origin: 'DEMO' })], commonBaseFees: [makeCommonBaseFee({ id: 'TEST_FIXTURE_FEE_DEMO', origin: 'DEMO' })] };
    publishCatalogOf(w, demo, TEST_CATALOG_CONFIG);
    expect(w.repo.listCatalogVersions(TEST_FIXTURE_CLINIC_ID)).toHaveLength(2);
    expect(w.repo.getTreatmentVersion('TEST_FIXTURE_TV_DEMO')?.origin).toBe('DEMO');
  });

  it('허용 출처가 비어 있는 구성은 어떤 출처도 게시하지 못한다', () => {
    const w = catalogWorld();
    const before = snapshotOf(w.repo);
    const error = catchDomainError(() => publishCatalogOf(w, validCatalogRequest(), { acceptedLineOrigins: [] }));
    expect(error.defects.every((defect) => defect.code === 'ORIGIN_NOT_ACCEPTED')).toBe(true);
    expect(snapshotOf(w.repo)).toEqual(before);
  });
});

describe('AC-009a 보장 판단 필드가 바뀐 치료 버전을 카탈로그 게시 서비스로 게시하면 매핑이 UNDER_REREVIEW 가 된다', () => {
  /** 카탈로그 1 게시(TV_1) → 그 치료의 매핑 승인(지문 고정) → 필요하면 묶음 게시로 PUBLISHED. */
  function mappedWorld(state: 'APPROVED' | 'PUBLISHED') {
    const w = catalogWorld();
    publishCatalogOf(w, singleTreatmentRequest());
    const mapping = createDraft(w.deps, TEST_FIXTURE_RV_AUTHOR, 'MAPPING', baseContent('MAPPING', 1, T1)).ref;
    submitForReview(w.deps, TEST_FIXTURE_RV_AUTHOR, mapping);
    approve(w.deps, TEST_FIXTURE_RV_APPROVER, mapping);
    if (state === 'PUBLISHED') {
      markPublished(w.deps, TEST_FIXTURE_RV_APPROVER, mapping);
    }
    return { w, mapping };
  }

  const guaranteeChanges: Array<[string, Partial<TreatmentVersion>]> = [
    ['treatmentCode', { treatmentCode: 'TEST_FIXTURE_TC_CHANGED' }],
    ['procedureCodes', { procedureCodes: ['TEST_FIXTURE_PROC_A', 'TEST_FIXTURE_PROC_C'] }],
    ['benefitType', { benefitType: 'NON_BENEFIT' }],
    ['calcClass', { calcClass: 'MAJOR_THREE_NON_BENEFIT' }],
  ];

  for (const state of ['APPROVED', 'PUBLISHED'] as const) {
    it.each(guaranteeChanges)(`${state} 매핑: %s 하나만 바꾼 치료 버전을 게시하면 UNDER_REREVIEW (카탈로그는 게시된다)`, (_field, change) => {
      const { w, mapping } = mappedWorld(state);
      const pinned = w.repo.getItemState(mapping)?.approvedFingerprint;
      expect(pinned).toBe(coverageFingerprintOf(makeTreatmentVersion()));
      w.clock.set('2026-10-21T00:00:00.000Z');

      const catalog = publishCatalogOf(w, singleTreatmentRequest({ id: 'TEST_FIXTURE_TV_1B', ...change }));

      expect(w.repo.getClinicCurrentCatalogVersion(TEST_FIXTURE_CLINIC_ID)?.id).toBe(catalog.id);
      const after = w.repo.getItemState(mapping);
      expect(after?.state).toBe('UNDER_REREVIEW');
      expect(after?.approvedFingerprint).toBe(pinned); // 재승인이 새로 고정한다
      expect(after?.history.at(-1)).toMatchObject({ from: state, to: 'UNDER_REREVIEW', actorId: TEST_FIXTURE_HA_1.id, role: 'HA', at: '2026-10-21T00:00:00.000Z', reason: 'COVERAGE_JUDGMENT_FIELD_CHANGED' });
      expect(w.repo.listAuditLog().some((entry) => entry.action === 'ITEM_REREVIEW' && entry.actorId === TEST_FIXTURE_HA_1.id && entry.role === 'HA' && entry.afterVersion === 'UNDER_REREVIEW')).toBe(true);
    });
  }

  const neutralChanges: Array<[string, Partial<TreatmentVersion>]> = [
    ['가격', { patientAmount: 99_000 }],
    ['표시 이름', { displayName: 'TEST_FIXTURE 다른 이름' }],
    ['설명', { description: 'TEST_FIXTURE 다른 설명' }],
    ['금액 적용 조건', { amountCondition: { patientType: 'TEST_FIXTURE_OTHER', assumption: 'TEST_FIXTURE_OTHER', referenceDate: '2026-10-20' } }],
    ['서류 표시', { documentFlags: { imaging: true, biopsy: false, opinionRequired: true } }],
    ['적용일', { effectiveDate: '2026-11-01' }],
    ['행위 코드 순서', { procedureCodes: ['TEST_FIXTURE_PROC_B', 'TEST_FIXTURE_PROC_A'] }],
  ];

  for (const state of ['APPROVED', 'PUBLISHED'] as const) {
    it.each(neutralChanges)(`${state} 매핑: %s 만 바뀐 치료 버전을 게시하면 매핑 상태가 그대로다`, (_field, change) => {
      const { w, mapping } = mappedWorld(state);
      const mappingBefore = w.repo.getItemState(mapping);
      publishCatalogOf(w, singleTreatmentRequest({ id: 'TEST_FIXTURE_TV_1B', ...change }));
      expect(w.repo.getItemState(mapping)).toEqual(mappingBefore);
      expect(w.repo.listAuditLog().some((entry) => entry.action === 'ITEM_REREVIEW')).toBe(false);
    });
  }

  it('다른 치료의 매핑과 이미 UNDER_REREVIEW 가 아닌 다른 상태의 매핑은 움직이지 않는다', () => {
    const { w, mapping } = mappedWorld('APPROVED');
    // 치료 2: 카탈로그 2(TV_1 + TV_2) 게시 뒤 치료 2 의 매핑 승인.
    publishCatalogOf(w, validCatalogRequest());
    const other = createDraft(w.deps, TEST_FIXTURE_RV_AUTHOR, 'MAPPING', baseContent('MAPPING', 2, T2)).ref;
    submitForReview(w.deps, TEST_FIXTURE_RV_AUTHOR, other);
    approve(w.deps, TEST_FIXTURE_RV_APPROVER, other);
    const draft = createDraft(w.deps, TEST_FIXTURE_RV_AUTHOR, 'MAPPING', baseContent('MAPPING', 3, T1)).ref;

    publishCatalogOf(w, singleTreatmentRequest({ id: 'TEST_FIXTURE_TV_1C', treatmentCode: 'TEST_FIXTURE_TC_CHANGED_2' }));

    expect(w.repo.getItemState(mapping)?.state).toBe('UNDER_REREVIEW');
    expect(w.repo.getItemState(other)?.state).toBe('APPROVED');
    expect(w.repo.getItemState(draft)?.state).toBe('DRAFT');
  });

  it('게시가 거절되면 재검토 전환도 일어나지 않는다 (같은 트랜잭션)', () => {
    const { w, mapping } = mappedWorld('PUBLISHED');
    const before = snapshotOf(w.repo);
    const error = catchDomainError(() => publishCatalogOf(w, singleTreatmentRequest({ id: 'TEST_FIXTURE_TV_1B', treatmentCode: 'TEST_FIXTURE_TC_CHANGED', patientAmount: -1 })));
    expect(error.code).toBe('PUBLISH_VALIDATION_FAILED');
    expect(w.repo.getItemState(mapping)?.state).toBe('PUBLISHED');
    expect(snapshotOf(w.repo)).toEqual(before);
  });
});

describe('AC-009c 가격만 바꾼 게시는 새 카탈로그 버전과 변경 이력을 만들고 매핑은 PUBLISHED 로 남아 새 가격으로 ESTIMATED 다 (실제 엔진)', () => {
  it('가격만 바꾸면 새 CatalogVersion 과 변경 이력이 생기고, 엔진의 줄은 새 가격으로 ESTIMATED 다', () => {
    // 카탈로그 → 항목 승인(지문 고정) → 묶음 게시(항목이 PUBLISHED) 순서를 모두 서비스 경로로 만든다.
    const c = catalogWorld();
    const first = publishCatalogOf(c, singleTreatmentRequest());
    const refs = approveSpec(c, validSpec(1));
    const bundle = publishRefs(c, refs);
    expect(c.repo.getItemState(refs.mappings[0]!)?.state).toBe('PUBLISHED');

    const inputFor = (versions: TreatmentVersion[]): EstimateInput => ({
      generation: 'GEN4_C4',
      insurerType: 'NON_LIFE',
      treatmentIds: [T1],
      lines: versions.map(lineOfVersion),
      baseFeeLines: [],
      bundle: engineSnapshotOf(c.repo, bundle.id),
      at: TEST_AT,
      acceptedOrigins: { rules: ['TEST_FIXTURE'], lines: ['TEST_FIXTURE'] },
    });

    const before = estimate(inputFor([c.repo.getTreatmentVersion('TEST_FIXTURE_TV_1')!]), { digest: canonicalDigest });
    expect(before.ok).toBe(true);
    const beforeResult = before.ok ? before.result : null;
    expect(beforeResult?.state).toBe('ESTIMATED');
    expect(beforeResult?.lines[0]).toMatchObject({ treatmentId: T1, patientAmount: 10_000, state: 'ESTIMATED' });

    // 가격만 바꾸고 표시 이름도 바꾼 게시.
    c.clock.set('2026-10-17T09:00:00.000Z');
    const second = publishCatalogOf(c, singleTreatmentRequest({ id: 'TEST_FIXTURE_TV_1B', patientAmount: 25_000, displayName: 'TEST_FIXTURE 가격 바뀐 치료' }));

    expect(second.id).not.toBe(first.id);
    expect(second.changeSummary).toEqual({ addedTreatmentIds: [], removedTreatmentIds: [], priceChangedTreatmentIds: [T1], baseFeesChanged: false });
    expect(c.repo.listCatalogVersions(TEST_FIXTURE_CLINIC_ID).map((catalog) => catalog.id)).toEqual([first.id, second.id]);
    expect(c.repo.getCatalogVersion(first.id)).toEqual(first); // 이전 버전은 그대로
    expect(c.repo.getItemState(refs.mappings[0]!)?.state).toBe('PUBLISHED');

    const after = estimate(inputFor([c.repo.getTreatmentVersion('TEST_FIXTURE_TV_1B')!]), { digest: canonicalDigest });
    expect(after.ok).toBe(true);
    const afterResult = after.ok ? after.result : null;
    expect(afterResult?.state).toBe('ESTIMATED');
    expect(afterResult?.holdReasons).toEqual([]);
    expect(afterResult?.lines[0]).toMatchObject({ treatmentId: T1, patientAmount: 25_000, state: 'ESTIMATED' });
    expect(afterResult?.amounts.hospitalPayment).toBe(25_000);
  });

  it('보장 판단 필드가 함께 바뀌면 같은 엔진 입력이 MAPPING_UNDER_REREVIEW 로 보류된다 (가격만 바뀐 경우와 대비)', () => {
    const c = catalogWorld();
    publishCatalogOf(c, singleTreatmentRequest());
    const refs = approveSpec(c, validSpec(1));
    const bundle = publishRefs(c, refs);

    publishCatalogOf(c, singleTreatmentRequest({ id: 'TEST_FIXTURE_TV_1B', treatmentCode: 'TEST_FIXTURE_TC_CHANGED' }));

    const changed = c.repo.getTreatmentVersion('TEST_FIXTURE_TV_1B')!;
    const outcome = estimate(
      {
        generation: 'GEN4_C4',
        insurerType: 'NON_LIFE',
        treatmentIds: [T1],
        lines: [lineOfVersion(changed)],
        baseFeeLines: [],
        bundle: engineSnapshotOf(c.repo, bundle.id),
        at: TEST_AT,
        acceptedOrigins: { rules: ['TEST_FIXTURE'], lines: ['TEST_FIXTURE'] },
      },
      { digest: canonicalDigest },
    );
    expect(outcome.ok).toBe(true);
    const result = outcome.ok ? outcome.result : null;
    expect(result?.state).toBe('ON_HOLD');
    expect(result?.holdReasons).toEqual([{ treatmentId: T1, code: 'MAPPING_UNDER_REREVIEW' }]);
  });
});

describe('입력 보호', () => {
  it('요청의 치료 버전 객체를 저장소가 복사해 저장한다: 게시 뒤 요청을 바꿔도 저장된 값은 그대로다', () => {
    const w = catalogWorld();
    const request = validCatalogRequest();
    publishCatalogOf(w, request);
    const stored = structuredClone(w.repo.getTreatmentVersion('TEST_FIXTURE_TV_1'));
    request.treatmentVersions[0] = setAt(request.treatmentVersions[0]!, ['patientAmount'], 1);
    request.treatmentVersions[0]!.procedureCodes.push('TEST_FIXTURE_LATE');
    expect(w.repo.getTreatmentVersion('TEST_FIXTURE_TV_1')).toEqual(stored);
  });

  it('이미 저장된 치료 버전 id 를 다른 내용으로 다시 게시하면 IMMUTABLE_VERSION 이고 저장소는 그대로다', () => {
    const w = catalogWorld();
    publishCatalogOf(w, singleTreatmentRequest());
    const before = snapshotOf(w.repo);
    const error = catchDomainError(() => publishCatalogOf(w, singleTreatmentRequest({ patientAmount: 77_000 }))); // id 가 같은 TV_1
    expect(error.code).toBe('IMMUTABLE_VERSION');
    expect(snapshotOf(w.repo)).toEqual(before);
  });
});
