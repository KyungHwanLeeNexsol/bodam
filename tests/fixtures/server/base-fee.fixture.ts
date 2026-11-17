import { canonicalDigest } from '../../../src/server/digest';
import type { EstimateResult, LineResult, PublishedLine } from '../../../src/engine/types';
import type { Cell } from '../../../src/engine/resolve';
import { approve, submitForReview } from '../../../src/server/approval';
import { createDraft } from '../../../src/server/authoring';
import type { CommonBaseFee, RuleBundleVersion } from '../../../src/server/domain/entities';
import type { ItemVersionRef, MappingContent } from '../../../src/server/domain/items';
import { coverageFingerprint } from '../../../src/server/fingerprint';
import { readReadiness } from '../../../src/server/readiness';
import type { ClinicReadiness, MappingRow, ReadinessClinicInput, ReadinessContext } from '../../../src/server/readiness';
import { assignRuleScope } from '../../../src/server/rule-scope';
import { makeExcludedMapping } from '../engine/mappings.fixture';
import { TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_PO_1, TEST_FIXTURE_RV_APPROVER, TEST_FIXTURE_RV_AUTHOR } from './actors.fixture';
import { makeCommonBaseFee } from './entities.fixture';
import { baseContent } from './lifecycle.fixture';
import type { World } from './lifecycle.fixture';
import { mappingRecord } from './items.fixture';
import { validCatalogRequest } from './publish.fixture';
import type { CatalogRequestFixture } from './publish.fixture';
import { ALL_CELLS, TEST_CTX, estimateFor, rowOfCell, sameCell } from './readiness.fixture';
import {
  approveSpec,
  catalogWorld,
  engineSnapshotOf,
  lineOfVersion,
  publishCatalogOf,
  publishRefs,
} from './versioning.fixture';
import type { BundleRefs, BundleSpec } from './versioning.fixture';

// 시험 자료(TEST_FIXTURE). 공통 기본비용 매핑 승인·게시 경로 (M3 외부 검토 보완 ①) 시험이 쓰는 세계.
// 병원 1 의 치료 둘(TREATMENT_1·2)과 공통 기본비용 하나(BASE_FEE_A)가 카탈로그에 있고, 승인·게시·지정은 모두 실제 도메인 서비스로 한다.
// 저장소에 승인 상태나 지문을 직접 넣는 길은 만들지 않는다. 모든 id·금액·코드는 시험용 가짜 값이다.

export const T1 = 'TEST_FIXTURE_TREATMENT_1';
export const T2 = 'TEST_FIXTURE_TREATMENT_2';
export const BASE_FEE_ID = 'TEST_FIXTURE_BASE_FEE_A';
export const BASE_FEE_MAPPING_ID = 'TEST_FIXTURE_MAPPING_BASE_FEE';

/** 치료 둘의 가격(각 10_000)과 기본비용(5_000)의 합. 병원 지불액 T 의 기준이다. */
export const TREATMENT_PAYMENT = 20_000;
export const BASE_FEE_AMOUNT = 5_000;

export const REPO_CTX: ReadinessContext = { ...TEST_CTX, at: '2026-10-16', digest: canonicalDigest };
export const READY_CELL: Cell = ALL_CELLS.find((cell) => cell.generation === 'GEN4_C4' && cell.insurerType === 'NON_LIFE')!;

/** 기본비용 BASE_FEE_A 의 n 번째 버전. 버전 id 는 `..._V<n>`, 안정 식별자(baseFeeId)는 모든 버전이 같다. */
export function makeBaseFeeVersion(n = 1, overrides: Partial<CommonBaseFee> = {}): CommonBaseFee {
  return makeCommonBaseFee({
    id: `${BASE_FEE_ID}_V${n}`,
    baseFeeId: BASE_FEE_ID,
    displayName: 'TEST_FIXTURE 기본 진찰료',
    benefitType: 'BENEFIT',
    amount: BASE_FEE_AMOUNT,
    code: 'TEST_FIXTURE_BASE_FEE_CODE',
    ...overrides,
  });
}

/** 치료 둘(validCatalogRequest 의 TV_1·TV_2)과 주어진 기본비용 버전들을 담은 카탈로그 요청. */
export function catalogRequestOf(fees: CommonBaseFee[]): CatalogRequestFixture {
  return { treatmentVersions: validCatalogRequest().treatmentVersions, commonBaseFees: fees };
}

export function publishFeeCatalog(world: World, fees: CommonBaseFee[]) {
  return publishCatalogOf(world, catalogRequestOf(fees));
}

/** 병원 1·치료 둘이 있고 카탈로그에 기본비용 BASE_FEE_A 의 1번 버전이 든 세계. 규칙 묶음은 아직 없다. */
export function baseFeeCatalogWorld(): World {
  const world = catalogWorld();
  publishFeeCatalog(world, [makeBaseFeeVersion(1)]);
  return world;
}

/** 기본비용의 COVERED 또는 EXCLUDED 매핑 내용 (매핑의 treatmentId 가 기본비용의 안정 식별자다). */
export function baseFeeMappingContent(kind: 'COVERED' | 'EXCLUDED', id = BASE_FEE_MAPPING_ID): MappingContent {
  if (kind === 'COVERED') {
    return mappingRecord(BASE_FEE_ID, { id }).content;
  }
  const { state: _state, approver: _approver, approvedFingerprint: _fingerprint, ...content } = makeExcludedMapping(BASE_FEE_ID, { id });
  return content;
}

/** 프로필 하나, 치료 둘의 COVERED 매핑, 서류 규칙 묶음. 기본비용의 매핑은 담지 않는다. */
export function treatmentBundleSpec(): BundleSpec {
  return {
    profiles: [baseContent('PROFILE', 1)],
    mappings: [baseContent('MAPPING', 1), mappingRecord(T2, { id: 'TEST_FIXTURE_MAPPING_2' }).content],
    documentRuleSet: baseContent('DOCUMENT_RULE_SET', 1),
  };
}

export interface BaseFeePath {
  world: World;
  refs: BundleRefs;
  bundle: RuleBundleVersion;
  /** 기본비용 매핑 참조. 매핑을 만들지 않은 경우 null. */
  feeMapping: ItemVersionRef | null;
}

/** 묶음을 게시하고 PO 가 병원 1 의 범위로 지정한다. */
export function publishAndAssign(world: World, refs: BundleRefs): RuleBundleVersion {
  const bundle = publishRefs(world, refs);
  assignRuleScope(world.deps, TEST_FIXTURE_PO_1, TEST_FIXTURE_CLINIC_ID, bundle.id);
  return bundle;
}

/**
 * 서비스 경로 전체: 카탈로그 게시(기본비용 포함) → 매핑 작성 → 제출 → 다른 RV 의 승인 → 묶음 게시 → PO 의 범위 지정.
 * kind 가 NONE 이면 기본비용 매핑은 만들지 않는다.
 */
export function publishedBaseFeePath(kind: 'COVERED' | 'EXCLUDED' | 'NONE'): BaseFeePath {
  const world = baseFeeCatalogWorld();
  const spec = treatmentBundleSpec();
  if (kind !== 'NONE') {
    spec.mappings.push(baseFeeMappingContent(kind));
  }
  const refs = approveSpec(world, spec);
  const bundle = publishAndAssign(world, refs);
  return { world, refs, bundle, feeMapping: kind === 'NONE' ? null : refs.mappings.at(-1)! };
}

/** 기본비용 매핑 하나를 작성 → 제출(작성자) → 승인(다른 RV) 한다. */
export function approveFeeMapping(world: World, kind: 'COVERED' | 'EXCLUDED' = 'COVERED'): ItemVersionRef {
  const ref = createDraft(world.deps, TEST_FIXTURE_RV_AUTHOR, 'MAPPING', baseFeeMappingContent(kind)).ref;
  submitForReview(world.deps, TEST_FIXTURE_RV_AUTHOR, ref);
  approve(world.deps, TEST_FIXTURE_RV_APPROVER, ref);
  return ref;
}

// ───────────────────────── 엔진과 맞추기 ─────────────────────────

/**
 * 기본비용 버전 → 엔진 줄. 서비스의 변환(toEngineBaseFeeLine)과 따로 적은 기대 모양이다.
 * 지문은 공유 함수 coverageFingerprint 에 (기본비용 코드, 행위 코드 없음, 급여 구분, 급여 구분에서 정한 분류)를 넣어 만든다.
 */
export function lineOfBaseFee(fee: CommonBaseFee): PublishedLine {
  const calcClass = fee.benefitType === 'BENEFIT' ? 'GENERAL_BENEFIT' : 'GENERAL_NON_BENEFIT';
  return {
    treatmentId: fee.baseFeeId,
    treatmentVersionId: fee.id,
    displayName: fee.displayName,
    benefitType: fee.benefitType,
    calcClass,
    patientAmount: fee.amount,
    coverageFingerprint: coverageFingerprint({ treatmentCode: fee.code, procedureCodes: [], benefitType: fee.benefitType, calcClass }),
    isBaseFee: true,
    documentFlags: { imaging: false, biopsy: false, opinionRequired: false },
    origin: fee.origin,
  };
}

/** 서비스의 합성과 따로 조립한 병원 1 의 엔진 입력: 현재 카탈로그의 치료·기본비용 줄과 범위가 가리키는 묶음. */
export function independentClinicInput(world: World): ReadinessClinicInput {
  const scope = world.repo.getClinicRuleScope(TEST_FIXTURE_CLINIC_ID);
  const catalog = world.repo.getClinicCurrentCatalogVersion(TEST_FIXTURE_CLINIC_ID);
  const clinic = world.repo.getClinic(TEST_FIXTURE_CLINIC_ID)!;
  return {
    clinicId: TEST_FIXTURE_CLINIC_ID,
    slug: clinic.slug,
    bundle: scope === null ? null : engineSnapshotOf(world.repo, scope.ruleBundleVersionId),
    lines: (catalog?.treatmentVersionIds ?? []).map((id) => lineOfVersion(world.repo.getTreatmentVersion(id)!)),
    baseFeeLines: (catalog?.baseFeeIds ?? []).map((id) => lineOfBaseFee(world.repo.getCommonBaseFee(id)!)),
  };
}

export function clinicReport(world: World): ClinicReadiness {
  return readReadiness(world.repo, REPO_CTX).clinics.find((clinic) => clinic.clinicId === TEST_FIXTURE_CLINIC_ID)!;
}

/** 표 M 에서 기본비용 줄의 한 칸. */
export function feeRowAt(report: ClinicReadiness, cell: Cell = READY_CELL): MappingRow {
  const found = report.mappings.find((row) => row.treatmentId === BASE_FEE_ID && sameCell(row.cell, cell));
  if (found === undefined) {
    throw new Error('TEST_FIXTURE: 기본비용 줄의 표 M 행이 없다');
  }
  return found;
}

/** 서비스와 따로 조립한 입력으로 부른 estimate() (칸은 READY_CELL). */
export function estimateOf(world: World, cell: Cell = READY_CELL): EstimateResult {
  return estimateFor(independentClinicInput(world), cell, REPO_CTX)!;
}

export function feeLineOf(result: EstimateResult): LineResult {
  const found = result.lines.find((line) => line.treatmentId === BASE_FEE_ID);
  if (found === undefined) {
    throw new Error('TEST_FIXTURE: 계산 결과에 기본비용 줄이 없다');
  }
  return found;
}

export { rowOfCell };
