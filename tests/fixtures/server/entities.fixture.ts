import type {
  AuditLogEntry,
  CatalogVersion,
  Clinic,
  ClinicRuleScope,
  CommonBaseFee,
  CoverageReviewRequest,
  IdlePolicy,
  Insurer,
  PolicySource,
  RuleBundleStatusEvent,
  RuleBundleVersion,
  Treatment,
  TreatmentVersion,
} from '../../../src/server/domain/entities';
import { TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1, TEST_FIXTURE_RV_AUTHOR } from './actors.fixture';

// 시험 자료(TEST_FIXTURE). 병원·치료·보험사 이름과 금액, 코드는 모두 시험용 가짜 값이다.
// 실제 병원·보험사·가격·행위 코드가 아니며 어떤 운영 자료와도 관계가 없다.

export const TEST_FIXTURE_NOW = '2026-10-16T09:00:00.000Z';

export function makeClinic(overrides: Partial<Clinic> = {}): Clinic {
  return {
    id: TEST_FIXTURE_CLINIC_ID,
    slug: 'test-fixture-clinic-1',
    name: 'TEST_FIXTURE 시험 의원',
    institutionType: 'CLINIC',
    contact: 'TEST_FIXTURE_CONTACT',
    currentCatalogVersionId: null,
    ...overrides,
  };
}

export function makeTreatment(overrides: Partial<Treatment> = {}): Treatment {
  return { id: 'TEST_FIXTURE_TREATMENT_1', clinicId: TEST_FIXTURE_CLINIC_ID, sortOrder: 1, active: true, ...overrides };
}

export function makeTreatmentVersion(overrides: Partial<TreatmentVersion> = {}): TreatmentVersion {
  return {
    id: 'TEST_FIXTURE_TV_1',
    treatmentId: 'TEST_FIXTURE_TREATMENT_1',
    displayName: 'TEST_FIXTURE 시험 치료',
    description: 'TEST_FIXTURE 설명',
    benefitType: 'BENEFIT',
    patientAmount: 10_000,
    amountCondition: { patientType: 'TEST_FIXTURE_PATIENT', assumption: 'TEST_FIXTURE_ASSUMPTION', referenceDate: '2026-10-16' },
    treatmentCode: 'TEST_FIXTURE_TC_1',
    procedureCodes: ['TEST_FIXTURE_PROC_A', 'TEST_FIXTURE_PROC_B'],
    calcClass: 'GENERAL_BENEFIT',
    documentFlags: { imaging: false, biopsy: false, opinionRequired: false },
    origin: 'TEST_FIXTURE',
    effectiveDate: '2026-10-01',
    ...overrides,
  };
}

/** 공통 기본비용 버전. baseFeeId 를 따로 넘기지 않으면 버전 id 와 같은 값이다 (버전이 하나뿐인 기본비용). 가격이 바뀌는 새 버전은 baseFeeId 를 같게 하고 id 를 달리한다. */
export function makeCommonBaseFee(overrides: Partial<CommonBaseFee> = {}): CommonBaseFee {
  const id = overrides.id ?? 'TEST_FIXTURE_FEE_1';
  return {
    id,
    baseFeeId: id,
    clinicId: TEST_FIXTURE_CLINIC_ID,
    displayName: 'TEST_FIXTURE 공통 기본비용',
    benefitType: 'BENEFIT',
    amount: 5_000,
    code: 'TEST_FIXTURE_FEE_CODE',
    origin: 'TEST_FIXTURE',
    ...overrides,
  };
}

export function makeCatalogVersion(overrides: Partial<CatalogVersion> = {}): CatalogVersion {
  return {
    id: 'TEST_FIXTURE_CATALOG_1',
    clinicId: TEST_FIXTURE_CLINIC_ID,
    treatmentVersionIds: ['TEST_FIXTURE_TV_1'],
    baseFeeIds: ['TEST_FIXTURE_FEE_1'],
    publishedBy: { ...TEST_FIXTURE_HA_1 },
    publishedAt: TEST_FIXTURE_NOW,
    changeSummary: { addedTreatmentIds: ['TEST_FIXTURE_TREATMENT_1'], removedTreatmentIds: [], priceChangedTreatmentIds: [], baseFeesChanged: true },
    ...overrides,
  };
}

export function makeInsurer(overrides: Partial<Insurer> = {}): Insurer {
  return {
    id: 'TEST_FIXTURE_INSURER_1',
    insurerType: 'NON_LIFE',
    currentName: 'TEST_FIXTURE 시험 손해보험',
    formerNames: ['TEST_FIXTURE 옛 이름'],
    verifiedContact: null,
    ...overrides,
  };
}

export function makePolicySource(overrides: Partial<PolicySource> = {}): PolicySource {
  return {
    id: 'TEST_FIXTURE_POLICY_SOURCE_1',
    insurerDocumentId: 'TEST_FIXTURE_DOC_1',
    revisionDate: '2026-01-01',
    clauseOrPage: 'TEST_FIXTURE_CLAUSE_1',
    effectiveDate: '2026-01-01',
    verifiedBy: 'TEST_FIXTURE_VERIFIER',
    verifiedAt: '2026-01-02',
    ...overrides,
  };
}

export function makeReviewRequest(overrides: Partial<CoverageReviewRequest> = {}): CoverageReviewRequest {
  return {
    id: 'TEST_FIXTURE_REVIEW_REQUEST_1',
    clinicId: TEST_FIXTURE_CLINIC_ID,
    treatmentId: 'TEST_FIXTURE_TREATMENT_1',
    proposed: { benefitType: 'BENEFIT', procedureCodes: ['TEST_FIXTURE_PROC_A'], calcClass: 'GENERAL_BENEFIT' },
    requestedBy: { ...TEST_FIXTURE_HA_1 },
    requestedAt: TEST_FIXTURE_NOW,
    status: 'REVIEW_REQUESTED',
    rejectionReason: null,
    draftMappingRef: null,
    resultMappingRef: null,
    ...overrides,
  };
}

export function makeBundleVersion(overrides: Partial<RuleBundleVersion> = {}): RuleBundleVersion {
  return {
    id: 'TEST_FIXTURE_BUNDLE_1',
    itemRefs: [],
    contentHash: 'TEST_FIXTURE_BUNDLE_HASH_1',
    publishedBy: { ...TEST_FIXTURE_RV_AUTHOR },
    publishedAt: TEST_FIXTURE_NOW,
    ...overrides,
  };
}

export function makeStatusEvent(overrides: Partial<RuleBundleStatusEvent> = {}): RuleBundleStatusEvent {
  return {
    bundleId: 'TEST_FIXTURE_BUNDLE_1',
    status: 'ACTIVE',
    actorId: TEST_FIXTURE_RV_AUTHOR.id,
    role: 'RV',
    at: TEST_FIXTURE_NOW,
    reason: null,
    previousStatus: null,
    ...overrides,
  };
}

export function makeScope(overrides: Partial<ClinicRuleScope> = {}): ClinicRuleScope {
  return {
    clinicId: TEST_FIXTURE_CLINIC_ID,
    ruleBundleVersionId: 'TEST_FIXTURE_BUNDLE_1',
    assignedBy: { ...TEST_FIXTURE_PO_1 },
    assignedAt: TEST_FIXTURE_NOW,
    ...overrides,
  };
}

export function makeIdlePolicy(overrides: Partial<IdlePolicy> = {}): IdlePolicy {
  return {
    clinicId: TEST_FIXTURE_CLINIC_ID,
    screens: { TEST_FIXTURE_INPUT: { warnSeconds: 100, resetSeconds: 120 } },
    completionHoldSeconds: null,
    ...overrides,
  };
}

export function makeAuditEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 'TEST_FIXTURE_AUDIT_1',
    actorId: TEST_FIXTURE_RV_AUTHOR.id,
    role: 'RV',
    action: 'TEST_FIXTURE_ACTION',
    target: 'TEST_FIXTURE_TARGET',
    beforeVersion: null,
    afterVersion: 'v1',
    reason: null,
    at: TEST_FIXTURE_NOW,
    ...overrides,
  };
}
