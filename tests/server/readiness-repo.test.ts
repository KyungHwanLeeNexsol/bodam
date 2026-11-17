import { describe, expect, it } from 'vitest';
import { approve, submitForReview, suspendItem } from '../../src/server/approval';
import { createDraft } from '../../src/server/authoring';
import { suspendRuleBundle } from '../../src/server/bundle-status';
import { canonicalDigest } from '../../src/server/digest';
import type { Actor } from '../../src/server/domain/actor';
import type { CommonBaseFee } from '../../src/server/domain/entities';
import { toEngineBaseFeeLine, toEnginePublishedLine } from '../../src/server/domain/projection';
import { coverageFingerprint, coverageFingerprintOfBaseFee } from '../../src/server/fingerprint';
import { triggerReReviewForBaseFee } from '../../src/server/re-review';
import { loadReadinessSnapshot, operatingReadinessContext, readReadiness } from '../../src/server/readiness';
import type { ReadinessClinicInput, ReadinessContext } from '../../src/server/readiness';
import { assignRuleScope } from '../../src/server/rule-scope';
import { TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1, TEST_FIXTURE_RV_APPROVER_2, TEST_FIXTURE_RV_AUTHOR } from '../fixtures/server/actors.fixture';
import { makeBundleVersion, makeCatalogVersion, makeClinic, makeCommonBaseFee, makeStatusEvent, makeTreatmentVersion } from '../fixtures/server/entities.fixture';
import { catchDomainError } from '../fixtures/server/errors.fixture';
import { TEST_FIXTURE_RV_SUSPENDER, addClinics, clinicIdOf, publishSecondBundleOfSameItems } from '../fixtures/server/governance.fixture';
import { documentRuleSetRecord, mappingRecord } from '../fixtures/server/items.fixture';
import { baseContent, forceState, newWorld } from '../fixtures/server/lifecycle.fixture';
import type { World } from '../fixtures/server/lifecycle.fixture';
import { TEST_CATALOG_CONFIG, validCatalogRequest } from '../fixtures/server/publish.fixture';
import { ALL_CELLS, TEST_CTX, cellName, expectCalculationAgrees, rowOfCell, sameCell } from '../fixtures/server/readiness.fixture';
import { snapshotOf as repoSnapshotOf, transitionInput } from '../fixtures/server/repo.fixture';
import type { BundleSpec } from '../fixtures/server/versioning.fixture';
import {
  TEST_FIXTURE_CLINIC_ID,
  approveSpec,
  catalogWorld,
  engineSnapshotOf,
  lineOfVersion,
  publishCatalogOf,
  publishRefs,
} from '../fixtures/server/versioning.fixture';

// 운영 준비 상태 계산을 저장소(M3.A~D)에서 읽은 자료로 한다 (M3.E, design.md DD-23).
// 게시·승인·중지·범위 지정은 모두 실제 도메인 서비스로 한다. 기대값은 서비스와 따로 조립한 엔진 입력(engineSnapshotOf, lineOfVersion)으로
// estimate() 를 불러 얻는다. 시험 자료는 전부 TEST_FIXTURE 이며 어떤 운영 자료도 만들지 않는다.

const REPO_CTX: ReadinessContext = { ...TEST_CTX, at: '2026-10-16', digest: canonicalDigest };

/** 치료 둘(TREATMENT_1·2)의 카탈로그를 게시하고, 프로필 하나(GEN4_C4 · NON_LIFE)와 매핑 둘, 서류 규칙 묶음을 묶어 게시한 뒤 병원 1 에 지정한다. */
function readyWorld(options: { baseFees?: boolean } = {}) {
  const world = catalogWorld();
  const request = validCatalogRequest();
  const catalog = publishCatalogOf(world, { treatmentVersions: request.treatmentVersions, commonBaseFees: options.baseFees === true ? request.commonBaseFees : [] }, TEST_CATALOG_CONFIG);
  const spec: BundleSpec = {
    profiles: [baseContent('PROFILE', 1)],
    mappings: [baseContent('MAPPING', 1), mappingRecord('TEST_FIXTURE_TREATMENT_2', { id: 'TEST_FIXTURE_MAPPING_2' }).content],
    documentRuleSet: baseContent('DOCUMENT_RULE_SET', 1),
  };
  const refs = approveSpec(world, spec);
  const bundle = publishRefs(world, refs);
  assignRuleScope(world.deps, TEST_FIXTURE_PO_1, TEST_FIXTURE_CLINIC_ID, bundle.id);
  return { world, catalog, refs, bundle };
}

/** 서비스의 합성과 따로 조립한 병원 입력 (엔진 입력의 독립 기준). */
function independentClinic(world: World, clinicId = TEST_FIXTURE_CLINIC_ID): ReadinessClinicInput {
  const scope = world.repo.getClinicRuleScope(clinicId);
  const catalog = world.repo.getClinicCurrentCatalogVersion(clinicId);
  const clinic = world.repo.getClinic(clinicId)!;
  return {
    clinicId,
    slug: clinic.slug,
    bundle: scope === null ? null : engineSnapshotOf(world.repo, scope.ruleBundleVersionId),
    lines: (catalog?.treatmentVersionIds ?? []).map((id) => lineOfVersion(world.repo.getTreatmentVersion(id)!)),
    baseFeeLines: [],
  };
}

const clinicReport = (world: World, ctx: ReadinessContext = REPO_CTX, clinicId = TEST_FIXTURE_CLINIC_ID) => readReadiness(world.repo, ctx).clinics.find((clinic) => clinic.clinicId === clinicId)!;

const READY_CELL = ALL_CELLS.find((cell) => cell.generation === 'GEN4_C4' && cell.insurerType === 'NON_LIFE')!;

describe('AC-011l (5) 운영 데이터가 없는 저장소', () => {
  it('병원만 있는 저장소: 플랫폼 15칸 PROFILE_ABSENT, 표 S SCOPE_ABSENT, 표 D RULES_UNAVAILABLE, 두 조건 모두 NOT_READY', () => {
    const world = newWorld();
    world.repo.saveClinic(makeClinic());
    const report = readReadiness(world.repo, operatingReadinessContext('2026-10-16'));
    expect(report.platformProfiles).toEqual(ALL_CELLS.map((cell) => ({ cell, status: 'NOT_READY', code: 'PROFILE_ABSENT' })));
    const [clinic] = report.clinics;
    expect(clinic!.scope).toMatchObject({ status: 'NOT_READY', value: 'SCOPE_ABSENT' });
    expect(clinic!.documents).toMatchObject({ status: 'NOT_READY', code: 'RULES_UNAVAILABLE', detail: 'SCOPE_ABSENT' });
    expect(clinic!.mappings).toEqual([]);
    expect(clinic!.calculationReady.every((row) => row.status === 'NOT_READY' && row.stage === 'S')).toBe(true);
    expect(clinic!.documentReady.status).toBe('NOT_READY');
  });

  it('치료 카탈로그만 게시된 저장소: 표 M 의 모든 줄이 15칸 MAPPING_ABSENT 이고 두 조건이 모두 NOT_READY 다', () => {
    const world = catalogWorld();
    publishCatalogOf(world, undefined, TEST_CATALOG_CONFIG);
    const clinic = clinicReport(world);
    expect(clinic.mappings).toHaveLength(4 * 15);
    expect(clinic.mappings.every((row) => row.status === 'NOT_READY' && row.code === 'MAPPING_ABSENT')).toBe(true);
    expect(clinic.calculationReady.every((row) => row.status === 'NOT_READY')).toBe(true);
    expect(clinic.documentReady.status).toBe('NOT_READY');
  });

  it('운영 구성(허용 출처 OPERATING 만)은 TEST_FIXTURE 줄을 받지 않는다: 같은 저장소의 모든 줄이 LINE_ORIGIN_NOT_ACCEPTED', () => {
    const world = catalogWorld();
    publishCatalogOf(world, undefined, TEST_CATALOG_CONFIG);
    const clinic = clinicReport(world, operatingReadinessContext('2026-10-16'));
    expect(clinic.mappings.every((row) => row.status === 'NOT_READY' && row.code === 'LINE_ORIGIN_NOT_ACCEPTED')).toBe(true);
  });

  it('operatingReadinessContext 는 규칙·줄 허용 출처가 OPERATING 하나이고 해시는 canonicalDigest 다', () => {
    const ctx = operatingReadinessContext('2026-10-16');
    expect(ctx.at).toBe('2026-10-16');
    expect(ctx.acceptedOrigins).toEqual({ rules: ['OPERATING'], lines: ['OPERATING'] });
    expect(ctx.digest).toBe(canonicalDigest);
  });
});

describe('저장소에서 읽은 자료로 준비 상태를 낸다', () => {
  it('게시·지정까지 마친 병원: 프로필이 있는 칸 하나만 calculationReady 이고 documentReady 도 READY, 엔진과 모든 칸에서 같다', () => {
    const { world, bundle } = readyWorld();
    const clinic = clinicReport(world);
    expect(clinic.scope).toEqual({ status: 'READY', value: 'ACTIVE', bundleId: bundle.id, contentHash: bundle.contentHash });
    expect(clinic.documentReady).toEqual({ status: 'READY' });
    for (const cell of ALL_CELLS) {
      const row = rowOfCell(clinic.calculationReady, cell);
      if (sameCell(cell, READY_CELL)) expect(row, cellName(cell)).toEqual({ cell, status: 'READY' });
      else expect(row, cellName(cell)).toEqual({ cell, status: 'NOT_READY', stage: 'P', code: 'PROFILE_ABSENT' });
    }
    expectCalculationAgrees(clinic, independentClinic(world), REPO_CTX, '게시 직후');
    // 플랫폼 보기에서도 그 칸만 READY.
    const platform = readReadiness(world.repo, REPO_CTX).platformProfiles;
    expect(platform.filter((row) => row.status === 'READY').map((row) => row.cell)).toEqual([READY_CELL]);
    expect(rowOfCell(platform, READY_CELL)).toEqual({ cell: READY_CELL, status: 'READY', bundleIds: [bundle.id] });
  });

  it('운영 허용 출처 구성에서는 같은 저장소가 어느 칸도 준비되지 않는다 (TEST_FIXTURE 거절)', () => {
    const { world } = readyWorld();
    const report = readReadiness(world.repo, operatingReadinessContext('2026-10-16'));
    const clinic = report.clinics[0]!;
    expect(rowOfCell(report.platformProfiles, READY_CELL)).toEqual({ cell: READY_CELL, status: 'NOT_READY', code: 'PROFILE_DEMO' });
    expect(clinic.documents).toMatchObject({ status: 'NOT_READY', detail: 'ORIGIN_NOT_ACCEPTED' });
    expect(clinic.calculationReady.every((row) => row.status === 'NOT_READY')).toBe(true);
    expect(clinic.documentReady.status).toBe('NOT_READY');
  });

  it('읽기 전용이다: 호출 전후로 저장소 전체가 같고 감사 기록도 늘지 않는다', () => {
    const { world } = readyWorld();
    const before = repoSnapshotOf(world.repo);
    readReadiness(world.repo, REPO_CTX);
    loadReadinessSnapshot(world.repo);
    expect(repoSnapshotOf(world.repo)).toEqual(before);
  });

  it('항목 상태는 호출마다 새로 읽는다 (readItemStates 가 호출 수만큼 불린다)', () => {
    const { world } = readyWorld();
    world.repo.spy.reset();
    readReadiness(world.repo, REPO_CTX);
    const first = world.repo.spy.counts.readItemStates;
    readReadiness(world.repo, REPO_CTX);
    expect(first).toBeGreaterThan(0);
    expect(world.repo.spy.counts.readItemStates).toBe(first * 2);
  });

  it('읽은 스냅샷은 저장소와 분리된 복사본이다', () => {
    const { world, bundle } = readyWorld();
    const snapshot = loadReadinessSnapshot(world.repo);
    const bundleSnapshot = snapshot.bundles.find((entry) => entry.id === bundle.id)!;
    bundleSnapshot.profiles[0]!.state = 'DRAFT';
    bundleSnapshot.mappings.length = 0;
    snapshot.clinics[0]!.lines.length = 0;
    const again = loadReadinessSnapshot(world.repo);
    expect(again.bundles.find((entry) => entry.id === bundle.id)!.profiles[0]!.state).toBe('PUBLISHED');
    expect(again.clinics[0]!.lines).toHaveLength(2);
    expect(clinicReport(world).calculationReady.some((row) => row.status === 'READY')).toBe(true);
  });
});

describe('읽은 스냅샷은 서비스와 따로 조립한 엔진 입력과 같다 (projection 의 단일 합성)', () => {
  it('묶음: engineSnapshotOf 와 깊이 같다 (내용 + 방금 읽은 상태 + 방금 읽은 가용성)', () => {
    const { world, bundle } = readyWorld();
    const loaded = loadReadinessSnapshot(world.repo);
    expect(loaded.bundles).toEqual([engineSnapshotOf(world.repo, bundle.id)]);
    suspendRuleBundle(world.deps, TEST_FIXTURE_RV_SUSPENDER, bundle.id, 'TEST_FIXTURE 사유');
    expect(loadReadinessSnapshot(world.repo).bundles).toEqual([engineSnapshotOf(world.repo, bundle.id)]);
    expect(loadReadinessSnapshot(world.repo).bundles[0]!.status).toBe('SUSPENDED');
  });

  it('[문서에 없음] 서류 규칙 묶음이 둘 이상 저장된 묶음(게시 서비스로는 만들 수 없다)은 저장된 항목 순서의 첫 번째만 쓴다', () => {
    const { world, refs } = readyWorld();
    const second = documentRuleSetRecord({ id: 'TEST_FIXTURE_DOCSET_SECOND' });
    world.repo.putItemVersion(second);
    world.repo.recordItemTransition(second.ref, transitionInput({ to: 'PUBLISHED', approverAfter: { approverId: 'TEST_FIXTURE_RV_APPROVER', approvedAt: '2026-01-02' } }));
    const odd = makeBundleVersion({ id: 'TEST_FIXTURE_BUNDLE_TWO_SETS', itemRefs: [refs.profiles[0]!, ...refs.mappings, refs.documentRuleSet!, second.ref] });
    world.repo.putRuleBundleVersion(odd);
    world.repo.appendBundleStatusEvent(makeStatusEvent({ bundleId: odd.id }));
    const loaded = loadReadinessSnapshot(world.repo).bundles.find((entry) => entry.id === odd.id)!;
    expect(loaded.documentRuleSet?.id).toBe(refs.documentRuleSet!.id);
  });

  it('치료 줄: lineOfVersion 과 같다 (지문은 보장 판단 필드에서 나온다)', () => {
    const { world, catalog } = readyWorld();
    const expected = catalog.treatmentVersionIds.map((id) => lineOfVersion(world.repo.getTreatmentVersion(id)!));
    expect(loadReadinessSnapshot(world.repo).clinics[0]!.lines).toEqual(expected);
    expect(toEnginePublishedLine(world.repo.getTreatmentVersion(catalog.treatmentVersionIds[0]!)!)).toEqual(expected[0]);
  });

  it('공통 기본비용 줄 [문서에 없음]: id 가 줄 id, 급여 구분에서 분류를 정하고 지문은 코드·급여 구분·분류의 지문이다', () => {
    const fee: CommonBaseFee = makeCommonBaseFee({ id: 'TEST_FIXTURE_FEE_9', benefitType: 'NON_BENEFIT', amount: 7_000, code: 'TEST_FIXTURE_FEE_CODE_9', origin: 'TEST_FIXTURE' });
    const line = toEngineBaseFeeLine(fee);
    expect(line).toEqual({
      treatmentId: 'TEST_FIXTURE_FEE_9',
      treatmentVersionId: 'TEST_FIXTURE_FEE_9',
      displayName: fee.displayName,
      benefitType: 'NON_BENEFIT',
      calcClass: 'GENERAL_NON_BENEFIT',
      patientAmount: 7_000,
      coverageFingerprint: coverageFingerprint({ treatmentCode: 'TEST_FIXTURE_FEE_CODE_9', procedureCodes: [], benefitType: 'NON_BENEFIT', calcClass: 'GENERAL_NON_BENEFIT' }),
      isBaseFee: true,
      documentFlags: { imaging: false, biopsy: false, opinionRequired: false },
      origin: 'TEST_FIXTURE',
    });
    expect(toEngineBaseFeeLine(makeCommonBaseFee()).calcClass).toBe('GENERAL_BENEFIT');
  });

  it('공통 기본비용이 든 카탈로그: 기본비용 줄은 표 M 에 나오고 매핑이 없으면 MAPPING_ABSENT 로 칸을 막는다', () => {
    const { world } = readyWorld({ baseFees: true });
    const clinic = clinicReport(world);
    const feeRows = clinic.mappings.filter((row) => row.isBaseFee);
    expect(feeRows.map((row) => row.treatmentId)).toEqual(Array(15).fill('TEST_FIXTURE_FEE_1').concat(Array(15).fill('TEST_FIXTURE_FEE_2')).sort());
    expect(feeRows.every((row) => row.status === 'NOT_READY' && row.code === 'MAPPING_ABSENT')).toBe(true);
    expect(rowOfCell(clinic.calculationReady, READY_CELL)).toEqual({
      cell: READY_CELL,
      status: 'NOT_READY',
      stage: 'M',
      lines: [
        { treatmentId: 'TEST_FIXTURE_FEE_1', code: 'MAPPING_ABSENT' },
        { treatmentId: 'TEST_FIXTURE_FEE_2', code: 'MAPPING_ABSENT' },
      ],
    });
  });

  it('공통 기본비용 줄의 매핑이 정상 경로로 승인된다: 대상은 기본비용의 안정 식별자이고 고정 지문은 기본비용 현재 버전의 지문이다 (이전의 TREATMENT_VERSION_ABSENT 경로를 대체한다)', () => {
    const { world } = readyWorld({ baseFees: true });
    const draft = createDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, 'MAPPING', mappingRecord('TEST_FIXTURE_FEE_1', { id: 'TEST_FIXTURE_MAPPING_FEE' }).content).ref;
    submitForReview(world.deps, TEST_FIXTURE_RV_AUTHOR, draft);
    const approver: Actor = { id: 'TEST_FIXTURE_RV_APPROVER', role: 'RV' };

    approve(world.deps, approver, draft);

    const state = world.repo.getItemState(draft)!;
    expect(state.state).toBe('APPROVED');
    expect(state.approver?.approverId).toBe(approver.id);
    expect(state.approvedFingerprint).toBe(coverageFingerprintOfBaseFee(makeCommonBaseFee({ id: 'TEST_FIXTURE_FEE_1' })));
  });
});

describe('공통 기본비용 매핑 승인·게시의 실제 실패 조건은 그대로 거절된다', () => {
  const approver: Actor = { id: 'TEST_FIXTURE_RV_APPROVER', role: 'RV' };

  it('대상이 치료도 기본비용도 아니면 승인은 TREATMENT_VERSION_ABSENT 이고 저장소 전후 비교가 같다', () => {
    const { world } = readyWorld({ baseFees: true });
    const draft = createDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, 'MAPPING', mappingRecord('TEST_FIXTURE_NO_SUCH_TARGET', { id: 'TEST_FIXTURE_MAPPING_NONE' }).content).ref;
    submitForReview(world.deps, TEST_FIXTURE_RV_AUTHOR, draft);
    const before = repoSnapshotOf(world.repo);

    expect(catchDomainError(() => approve(world.deps, approver, draft)).code).toBe('TREATMENT_VERSION_ABSENT');

    expect(repoSnapshotOf(world.repo)).toEqual(before);
    expect(world.repo.getItemState(draft)?.state).toBe('REVIEW_REQUESTED');
  });

  it('대상이 치료도 기본비용도 아닌 승인 상태 매핑을 담은 묶음 게시는 TREATMENT_VERSION_ABSENT 결함으로 거절되고 아무것도 저장되지 않는다', () => {
    const { world, refs } = readyWorld({ baseFees: true });
    const draft = createDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, 'MAPPING', mappingRecord('TEST_FIXTURE_NO_SUCH_TARGET', { id: 'TEST_FIXTURE_MAPPING_NONE' }).content).ref;
    forceState(world.repo, draft, 'APPROVED'); // 서비스는 대상 없는 매핑을 승인하지 않는다. 게시 쪽 백스톱만 본다.
    const before = repoSnapshotOf(world.repo);

    const error = catchDomainError(() => publishRefs(world, { profiles: refs.profiles, mappings: [draft], documentRuleSet: refs.documentRuleSet }));

    expect(error.code).toBe('PUBLISH_VALIDATION_FAILED');
    expect(error.defects).toContainEqual({ code: 'TREATMENT_VERSION_ABSENT', path: 'bundle.mappings[0].treatmentId' });
    expect(repoSnapshotOf(world.repo)).toEqual(before);
  });

  it('작성자 본인의 승인은 기본비용 매핑에서도 SELF_APPROVAL_FORBIDDEN 이고 저장소 전후 비교가 같다', () => {
    const { world } = readyWorld({ baseFees: true });
    const draft = createDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, 'MAPPING', mappingRecord('TEST_FIXTURE_FEE_1', { id: 'TEST_FIXTURE_MAPPING_FEE' }).content).ref;
    submitForReview(world.deps, TEST_FIXTURE_RV_AUTHOR, draft);
    const before = repoSnapshotOf(world.repo);

    expect(catchDomainError(() => approve(world.deps, TEST_FIXTURE_RV_AUTHOR, draft)).code).toBe('SELF_APPROVAL_FORBIDDEN');

    expect(repoSnapshotOf(world.repo)).toEqual(before);
    expect(world.repo.getItemState(draft)?.approvedFingerprint).toBeNull();
  });

  it('재검토 전환 없이 기본비용의 판단 필드가 달라진 현재 버전이 생기면 게시는 기존 FINGERPRINT_STALE 결함으로 거절되고, 재검토·재승인 뒤에는 게시된다', () => {
    const { world, refs } = readyWorld({ baseFees: true });
    const draft = createDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, 'MAPPING', mappingRecord('TEST_FIXTURE_FEE_1', { id: 'TEST_FIXTURE_MAPPING_FEE' }).content).ref;
    submitForReview(world.deps, TEST_FIXTURE_RV_AUTHOR, draft);
    approve(world.deps, approver, draft);
    // 저장소 원시 동작: 판단 필드가 바뀐 새 버전을 현재 카탈로그에 올리되 재검토 전환은 부르지 않는다.
    const changed = makeCommonBaseFee({ id: 'TEST_FIXTURE_FEE_1_V2', baseFeeId: 'TEST_FIXTURE_FEE_1', code: 'TEST_FIXTURE_FEE_CODE_CHANGED' });
    const current = world.repo.getClinicCurrentCatalogVersion(TEST_FIXTURE_CLINIC_ID)!;
    world.repo.putCommonBaseFee(changed);
    world.repo.putCatalogVersion(makeCatalogVersion({ id: 'TEST_FIXTURE_CATALOG_RAW', treatmentVersionIds: current.treatmentVersionIds, baseFeeIds: [changed.id, 'TEST_FIXTURE_FEE_2'] }));
    world.repo.saveClinic({ ...world.repo.getClinic(TEST_FIXTURE_CLINIC_ID)!, currentCatalogVersionId: 'TEST_FIXTURE_CATALOG_RAW' });
    const request = { profiles: refs.profiles, mappings: [draft], documentRuleSet: refs.documentRuleSet };
    const before = repoSnapshotOf(world.repo);

    const error = catchDomainError(() => publishRefs(world, request));

    expect(error.code).toBe('PUBLISH_VALIDATION_FAILED');
    expect(error.defects).toEqual([{ code: 'FINGERPRINT_STALE', path: 'bundle.mappings[0].approvedFingerprint' }]);
    expect(repoSnapshotOf(world.repo)).toEqual(before);

    // 교정: 재검토 전환 → 다른 승인자의 재승인(새 지문 고정) → 게시.
    triggerReReviewForBaseFee(world.deps, TEST_FIXTURE_HA_1, changed);
    expect(world.repo.getItemState(draft)?.state).toBe('UNDER_REREVIEW');
    approve(world.deps, TEST_FIXTURE_RV_APPROVER_2, draft);
    expect(() => publishRefs(world, request)).not.toThrow();
  });
});

describe('서비스가 바꾼 상태가 다음 호출에 바로 반영되고 엔진과 같다 (캐시 없음)', () => {
  it('묶음 중지: 표 S 가 SUSPENDED, 모든 칸 calculationReady 와 documentReady 가 NOT_READY(S 단계), 엔진과 같다', () => {
    const { world, bundle } = readyWorld();
    suspendRuleBundle(world.deps, TEST_FIXTURE_RV_SUSPENDER, bundle.id, 'TEST_FIXTURE 사유');
    const clinic = clinicReport(world);
    expect(clinic.scope).toEqual({ status: 'NOT_READY', value: 'BUNDLE_SUSPENDED', code: 'RULE_BUNDLE_SUSPENDED', bundleId: bundle.id, contentHash: bundle.contentHash });
    expect(clinic.calculationReady.every((row) => row.status === 'NOT_READY' && row.stage === 'S' && row.code === 'RULE_BUNDLE_SUSPENDED')).toBe(true);
    expect(clinic.documentReady).toEqual({ status: 'NOT_READY', stage: 'S', code: 'RULE_BUNDLE_SUSPENDED' });
    expectCalculationAgrees(clinic, independentClinic(world), REPO_CTX, '묶음 중지');
  });

  it('프로필 항목 중지: 그 칸이 PROFILE_INVALID 로 막히고 엔진과 같다', () => {
    const { world, refs } = readyWorld();
    suspendItem(world.deps, TEST_FIXTURE_RV_SUSPENDER, refs.profiles[0]!, 'TEST_FIXTURE 사유');
    const clinic = clinicReport(world);
    expect(rowOfCell(clinic.calculationReady, READY_CELL)).toEqual({ cell: READY_CELL, status: 'NOT_READY', stage: 'P', code: 'PROFILE_INVALID' });
    expectCalculationAgrees(clinic, independentClinic(world), REPO_CTX, '프로필 중지');
  });

  it('매핑 항목 중지: 그 줄만 MAPPING_INVALID 이고 엔진과 같다', () => {
    const { world, refs } = readyWorld();
    suspendItem(world.deps, TEST_FIXTURE_RV_SUSPENDER, refs.mappings[1]!, 'TEST_FIXTURE 사유');
    const clinic = clinicReport(world);
    expect(rowOfCell(clinic.calculationReady, READY_CELL)).toEqual({
      cell: READY_CELL,
      status: 'NOT_READY',
      stage: 'M',
      lines: [{ treatmentId: 'TEST_FIXTURE_TREATMENT_2', code: 'MAPPING_INVALID' }],
    });
    expectCalculationAgrees(clinic, independentClinic(world), REPO_CTX, '매핑 중지');
  });

  it('서류 규칙 묶음 항목 중지: documentReady 만 NOT_READY 이고 calculationReady 는 그대로다', () => {
    const { world, refs } = readyWorld();
    const before = clinicReport(world).calculationReady;
    suspendItem(world.deps, TEST_FIXTURE_RV_SUSPENDER, refs.documentRuleSet!, 'TEST_FIXTURE 사유');
    const clinic = clinicReport(world);
    expect(clinic.documentReady).toEqual({ status: 'NOT_READY', stage: 'D', code: 'RULES_UNAVAILABLE', detail: 'STATE_INVALID' });
    expect(clinic.calculationReady).toEqual(before);
  });

  it('보장 판단 필드가 바뀐 치료 버전을 게시하면 매핑이 재검토로 떨어져 그 줄이 MAPPING_UNDER_REREVIEW 가 된다 (엔진과 같다)', () => {
    const { world } = readyWorld();
    const request = validCatalogRequest();
    publishCatalogOf(
      world,
      { treatmentVersions: [makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_1B', treatmentId: 'TEST_FIXTURE_TREATMENT_1', treatmentCode: 'TEST_FIXTURE_TC_CHANGED' }), request.treatmentVersions[1]!], commonBaseFees: [] },
      TEST_CATALOG_CONFIG,
    );
    const clinic = clinicReport(world);
    expect(rowOfCell(clinic.calculationReady, READY_CELL)).toEqual({
      cell: READY_CELL,
      status: 'NOT_READY',
      stage: 'M',
      lines: [{ treatmentId: 'TEST_FIXTURE_TREATMENT_1', code: 'MAPPING_UNDER_REREVIEW' }],
    });
    expectCalculationAgrees(clinic, independentClinic(world), REPO_CTX, '재검토');
  });

  it('가격만 바뀐 카탈로그 게시는 준비 상태를 바꾸지 않는다 (매핑 유지, 새 카탈로그 버전만)', () => {
    const { world } = readyWorld();
    const before = clinicReport(world);
    const request = validCatalogRequest();
    publishCatalogOf(
      world,
      { treatmentVersions: [makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_1C', treatmentId: 'TEST_FIXTURE_TREATMENT_1', patientAmount: 12_345 }), request.treatmentVersions[1]!], commonBaseFees: [] },
      TEST_CATALOG_CONFIG,
    );
    expect(clinicReport(world)).toEqual(before);
  });

  it('병원마다 독립이다: 한 병원의 묶음 중지가 다른 묶음을 쓰는 병원의 보고를 바꾸지 않는다', () => {
    const { world, refs, bundle } = readyWorld();
    const [second] = addClinics(world.repo, 2);
    const secondBundle = publishSecondBundleOfSameItems(world, refs);
    assignRuleScope(world.deps, TEST_FIXTURE_PO_1, second!, secondBundle.id);
    const before = clinicReport(world, REPO_CTX, clinicIdOf(2));
    expect(before.scope.status).toBe('READY');
    suspendRuleBundle(world.deps, TEST_FIXTURE_RV_SUSPENDER, bundle.id, 'TEST_FIXTURE 사유');
    expect(clinicReport(world, REPO_CTX, clinicIdOf(2))).toEqual(before);
    expect(clinicReport(world).scope.status).toBe('NOT_READY');
    // 플랫폼 보기에는 아직 사용 가능한 두 번째 묶음이 있으므로 그 칸은 READY 다 (병원 1 의 병원 보기는 NOT_READY).
    const report = readReadiness(world.repo, REPO_CTX);
    expect(rowOfCell(report.platformProfiles, READY_CELL)).toEqual({ cell: READY_CELL, status: 'READY', bundleIds: [secondBundle.id] });
    expect(rowOfCell(report.clinics.find((clinic) => clinic.clinicId === TEST_FIXTURE_CLINIC_ID)!.profiles, READY_CELL).status).toBe('NOT_READY');
  });
});

describe('저장소가 깨져 있으면 추측하지 않고 NOT_FOUND 로 거절한다', () => {
  /** 읽기 메서드 하나만 바꾼 저장소 (프로토타입 연결이라 나머지는 진짜 저장소다). */
  const withOverride = (world: World, overrides: Record<string, () => unknown>) =>
    Object.create(world.repo, Object.fromEntries(Object.entries(overrides).map(([name, fn]) => [name, { value: fn }]))) as typeof world.repo;

  it.each([
    ['항목 내용이 없음', { getItemVersion: () => null }],
    ['항목 상태 기록이 없음', { readItemStates: (): unknown[] => [null] }],
    ['묶음 가용성 기록이 없음', { getBundleStatus: () => null }],
    ['범위가 가리키는 묶음이 목록에 없음', { listRuleBundleVersions: (): unknown[] => [] }],
    ['카탈로그가 가리키는 치료 버전이 없음', { getTreatmentVersion: () => null }],
  ])('%s', (_name, overrides) => {
    const { world } = readyWorld();
    const error = catchDomainError(() => loadReadinessSnapshot(withOverride(world, overrides)));
    expect(error.code).toBe('NOT_FOUND');
  });

  it('카탈로그가 가리키는 공통 기본비용이 없음', () => {
    const { world } = readyWorld({ baseFees: true });
    expect(catchDomainError(() => loadReadinessSnapshot(withOverride(world, { getCommonBaseFee: () => null }))).code).toBe('NOT_FOUND');
  });
});
