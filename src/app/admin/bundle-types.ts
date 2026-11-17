// 묶음 게시(RV)와 규칙 사용 범위 지정(PO) 화면이 읽는 관리자 API 응답의 모양 (src/server/admin/router.ts 의 bundle-publish · rule-scope 경로, bundle-overview.ts · bundle-compose.ts · rule-scope-admin.ts 의 보기).
// 화면 코드는 서버 모듈을 가져오지 않고 이 형식만 쓴다.

import type { Generation, InsurerType, LifecycleState } from './review-types';

/** 묶음 가용성. 기록이 없는 묶음(서버 데이터 결함)은 상태가 null 이다. */
export type BundleAvailability = 'ACTIVE' | 'SUSPENDED';

export type ItemKind = 'PROFILE' | 'MAPPING' | 'DOCUMENT_RULE_SET';

export interface MappingRefView {
  id: string;
  version: string;
}

export interface ClinicRef {
  clinicId: string;
  slug: string;
}

/** 게시된 묶음 한 건의 요약. 두 화면이 같은 모양을 쓴다. */
export interface BundleSummary {
  bundleId: string;
  status: BundleAvailability | null;
  publishedAt: string;
  publishedBy: string;
  contentHash: string;
  itemCounts: { profiles: number; mappings: number; documentRuleSets: number };
}

/** 묶음 게시 화면의 기준 묶음 후보: 요약 + 지금 그 묶음을 쓰는 병원. */
export interface BundleBase extends BundleSummary {
  clinics: ClinicRef[];
}

export type FingerprintState = 'CURRENT' | 'STALE' | 'UNKNOWN';

export interface CoverageTarget {
  /** TREATMENT = 치료, BASE_FEE = 공통 기본비용, UNKNOWN = 읽을 수 없음. */
  kind: 'TREATMENT' | 'BASE_FEE' | 'UNKNOWN';
  displayName: string | null;
  clinicId: string | null;
  clinicSlug: string | null;
}

export interface MappingCandidate {
  mappingRef: MappingRefView & { kind: 'MAPPING' };
  treatmentId: string;
  target: CoverageTarget;
  scope: Array<{ generation: Generation; insurerType: InsurerType }>;
  decision: 'COVERED' | 'EXCLUDED';
  groupKey: string | null;
  exclusionReason: string | null;
  validity: { from: string; to: string };
  approvedBy: string | null;
  approvedFingerprint: FingerprintState;
  reviewRequestId: string | null;
  alreadyInBundles: string[];
  /** 지문 상태를 UNKNOWN 으로 둔 이유 코드. 아니면 null. */
  readIssue: string | null;
}

export interface BundlePublishOverview {
  bases: BundleBase[];
  candidates: MappingCandidate[];
  unreadable: Array<{ ref: MappingRefView & { kind: string }; reason: string }>;
}

export interface BundleCellView {
  generation: Generation;
  insurerType: InsurerType;
}

export type BundleItemLabel =
  | { treatmentId: string; decision: string; scope: BundleCellView[]; target: CoverageTarget }
  | { generation: string; insurerType: string }
  | null;

export interface BundlePreviewItem {
  kind: ItemKind;
  id: string;
  version: string;
  state: LifecycleState | null;
  source: 'BASE' | 'ADDED';
  /** 게시 판정의 결함 경로가 가리키는 자리 (`bundle.mappings[3]` …). */
  path: string;
  label: BundleItemLabel;
}

export interface BundleDefect {
  code: string;
  path: string;
}

export interface BundleConflictView {
  mappingRef: MappingRefView & { kind?: string };
  path: string;
  treatmentId: string;
  conflictsWith: Array<{ ref: MappingRefView & { kind?: string }; source: 'BASE' | 'ADDED'; cells: BundleCellView[] }>;
}

export interface BundlePreviewResponse {
  base: { bundleId: string; status: BundleAvailability; contentHash: string; itemCount: number };
  items: BundlePreviewItem[];
  defects: BundleDefect[];
  conflicts: BundleConflictView[];
  /** 결함도 충돌도 없을 때만 있다. 아니면 null. */
  publishConfirmation: string | null;
}

export interface BundlePublishResponse {
  bundle: { id: string; contentHash: string; publishedAt: string; publishedBy: string; itemRefs: Array<{ kind: string; id: string; version: string }>; status: BundleAvailability };
  assignedClinics: ClinicRef[];
}

/** 묶음 중지(POST /api/admin/rule-bundles/{id}/suspend)의 응답. affectedClinics 는 중지 시점에 현재 범위가 그 묶음을 가리키던 병원이다. */
export interface BundleSuspendResponse {
  bundle: { id: string; status: 'SUSPENDED' };
  suspension: { at: string; by: string; role: string; reason: string | null; previousStatus: BundleAvailability | null };
  affectedClinics: ClinicRef[];
}

/** 규칙 사용 범위 화면의 병원 한 줄. current 가 null 이면 지정된 묶음이 없다. */
export interface ClinicScopeRow {
  clinicId: string;
  slug: string;
  displayName: string;
  current: { bundleId: string; status: BundleAvailability | null; assignedAt: string; assignedBy: string } | null;
}

export interface RuleScopeOverview {
  clinics: ClinicScopeRow[];
  bundles: BundleSummary[];
}

export interface RuleScopeAssignResponse {
  clinic: ClinicScopeRow;
  scope: { clinicId: string; ruleBundleVersionId: string; assignedAt: string; assignedBy: string };
}
