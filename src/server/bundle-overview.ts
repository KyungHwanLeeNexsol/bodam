import type { Generation, InsurerType } from '../engine/types';
import { currentCoverageTarget } from './coverage-target';
import { describeCoverageTarget } from './coverage-target-label';
import type { CoverageTargetLabel } from './coverage-target-label';
import type { BundleAvailability } from './domain/entities';
import { isMappingRecord } from './domain/items';
import type { ItemVersionRecordOf, ItemVersionRef } from './domain/items';
import type { AffectedClinic } from './rule-scope';
import type { Repository } from './repo/interfaces';

// 묶음 게시 화면의 읽기 보기 (SPEC-REIMBURSEMENT-001 M7 묶음 구성, 역할 RV). 읽기만 한다: 저장소를 바꾸지 않는다.
//   bases       — 기준이 될 수 있는 게시된 묶음(ACTIVE · SUSPENDED, 최신순)과 지금 그 묶음을 쓰는 병원. 고를 수 있는 것은 ACTIVE 뿐이다(미리보기가 다시 확인한다).
//   candidates  — 현재 APPROVED 인 매핑(최신순): 대상·범위·판정·승인자·고정 지문 상태·연결된 검토 요청·이미 담긴 묶음
//   unreadable  — 읽다가 실패한 매핑. 후보가 없는 것처럼 숨기지 않고 이유 코드와 함께 남긴다.
// 한 건을 읽지 못해도 던지지 않는다. 단, 이 보기는 판정이 아니다: 후보라는 표시가 게시할 수 있다는 뜻은 아니며, 게시 판정은 미리보기가 한다.

export interface BundleBaseView {
  bundleId: string;
  /** 가용성 기록이 없는 묶음(서버 데이터 결함)은 null 이다. */
  status: BundleAvailability | null;
  publishedAt: string;
  publishedBy: string;
  contentHash: string;
  itemCounts: { profiles: number; mappings: number; documentRuleSets: number };
  /** 현재 범위가 이 묶음을 가리키는 병원. */
  clinics: AffectedClinic[];
}

/**
 * 고정 지문과 보장 대상의 현재 지문을 견준 결과. CURRENT = 같다, STALE = 다르다(게시하면 FINGERPRINT_STALE), UNKNOWN = 견줄 수 없다(readIssue 에 이유).
 * UNKNOWN 은 "낡지 않았다"는 뜻이 아니다.
 */
export type ApprovedFingerprintState = 'CURRENT' | 'STALE' | 'UNKNOWN';

export interface MappingCandidateView {
  mappingRef: ItemVersionRef;
  treatmentId: string;
  target: CoverageTargetLabel;
  scope: Array<{ generation: Generation; insurerType: InsurerType }>;
  decision: 'COVERED' | 'EXCLUDED';
  groupKey: string | null;
  exclusionReason: string | null;
  validity: { from: string; to: string };
  approvedBy: string | null;
  approvedFingerprint: ApprovedFingerprintState;
  /** 이 매핑을 결과 또는 초안으로 가진 검토 요청 id. 없으면 null. */
  reviewRequestId: string | null;
  /** 이 매핑 버전을 이미 담은 묶음 id (게시 순서). */
  alreadyInBundles: string[];
  /** 지문 상태를 UNKNOWN 으로 둔 이유(TARGET_VERSION_ABSENT · APPROVED_FINGERPRINT_MISSING · TARGET_UNREADABLE). 아니면 null. */
  readIssue: string | null;
}

export interface BundlePublishOverview {
  bases: BundleBaseView[];
  candidates: MappingCandidateView[];
  unreadable: Array<{ ref: ItemVersionRef; reason: 'READ_FAILED' }>;
}

const keyOf = (ref: ItemVersionRef): string => JSON.stringify([ref.kind, ref.id, ref.version]);

function baseViews(repo: Repository): BundleBaseView[] {
  const holders = new Map<string, AffectedClinic[]>();
  for (const clinic of repo.listClinics()) {
    const scope = repo.getClinicRuleScope(clinic.id);
    if (scope !== null) {
      holders.set(scope.ruleBundleVersionId, [...(holders.get(scope.ruleBundleVersionId) ?? []), { clinicId: clinic.id, slug: clinic.slug }]);
    }
  }
  return repo
    .listRuleBundleVersions()
    .map((bundle) => ({
      bundleId: bundle.id,
      status: repo.getBundleStatus(bundle.id),
      publishedAt: bundle.publishedAt,
      publishedBy: bundle.publishedBy.id,
      contentHash: bundle.contentHash,
      itemCounts: {
        profiles: bundle.itemRefs.filter((ref) => ref.kind === 'PROFILE').length,
        mappings: bundle.itemRefs.filter((ref) => ref.kind === 'MAPPING').length,
        documentRuleSets: bundle.itemRefs.filter((ref) => ref.kind === 'DOCUMENT_RULE_SET').length,
      },
      clinics: holders.get(bundle.id) ?? [],
    }))
    .reverse();
}

/** 검토 요청 연결: 매핑 키 → 요청 id. 결과 매핑이 초안 연결보다 앞선다. */
function reviewLinks(repo: Repository): Map<string, string> {
  const links = new Map<string, string>();
  for (const clinic of repo.listClinics()) {
    for (const request of repo.listCoverageReviewRequests(clinic.id)) {
      if (request.draftMappingRef !== null && !links.has(keyOf(request.draftMappingRef))) {
        links.set(keyOf(request.draftMappingRef), request.id);
      }
    }
  }
  for (const clinic of repo.listClinics()) {
    for (const request of repo.listCoverageReviewRequests(clinic.id)) {
      if (request.resultMappingRef !== null) {
        links.set(keyOf(request.resultMappingRef), request.id);
      }
    }
  }
  return links;
}

/** 매핑 키 → 그 매핑을 담은 묶음 id (게시 순서). */
function bundlesHolding(repo: Repository): Map<string, string[]> {
  const holding = new Map<string, string[]>();
  for (const bundle of repo.listRuleBundleVersions()) {
    for (const ref of bundle.itemRefs) {
      if (ref.kind === 'MAPPING') {
        holding.set(keyOf(ref), [...(holding.get(keyOf(ref)) ?? []), bundle.id]);
      }
    }
  }
  return holding;
}

interface Fingerprint {
  state: ApprovedFingerprintState;
  issue: string | null;
  target: CoverageTargetLabel;
}

/** 고정 지문과 현재 보장 대상의 지문을 견준다. 읽다가 실패해도 던지지 않고 UNKNOWN 으로 표시한다. */
function fingerprintOf(repo: Repository, targetId: string, approvedFingerprint: string | null): Fingerprint {
  const unknown = (issue: string, target: CoverageTargetLabel): Fingerprint => ({ state: 'UNKNOWN', issue, target });
  let target: CoverageTargetLabel = { kind: 'UNKNOWN', displayName: null, clinicId: null, clinicSlug: null };
  try {
    target = describeCoverageTarget(repo, targetId);
    const current = currentCoverageTarget(repo, targetId);
    if (current === null) {
      return unknown('TARGET_VERSION_ABSENT', target);
    }
    if (approvedFingerprint === null || approvedFingerprint === '') {
      return unknown('APPROVED_FINGERPRINT_MISSING', target);
    }
    return { state: current.fingerprint === approvedFingerprint ? 'CURRENT' : 'STALE', issue: null, target };
  } catch {
    return unknown('TARGET_UNREADABLE', target);
  }
}

function candidateOf(
  repo: Repository,
  record: ItemVersionRecordOf<'MAPPING'>,
  links: ReadonlyMap<string, string>,
  holding: ReadonlyMap<string, string[]>,
): MappingCandidateView | null {
  const state = repo.readItemStates([record.ref])[0];
  if (state === undefined || state === null || state.state !== 'APPROVED') {
    return null;
  }
  const { content } = record;
  const fingerprint = fingerprintOf(repo, content.treatmentId, state.approvedFingerprint);
  return {
    mappingRef: { kind: 'MAPPING', id: record.ref.id, version: record.ref.version },
    treatmentId: content.treatmentId,
    target: fingerprint.target,
    scope: content.scope.map((cell) => ({ generation: cell.generation, insurerType: cell.insurerType })),
    decision: content.decision,
    groupKey: content.groupKey ?? null,
    exclusionReason: content.exclusionReason ?? null,
    validity: { from: content.validity.from, to: content.validity.to },
    approvedBy: state.approver === null ? null : state.approver.approverId,
    approvedFingerprint: fingerprint.state,
    reviewRequestId: links.get(keyOf(record.ref)) ?? null,
    alreadyInBundles: [...(holding.get(keyOf(record.ref)) ?? [])],
    readIssue: fingerprint.issue,
  };
}

// @MX:ANCHOR: [AUTO] 묶음 게시 화면 읽기 보기의 단일 구현. 관리자 API(bundle-publish GET)와 시험이 부른다.
// @MX:REASON: 읽기만 해야 하고(미리보기·게시와 같은 저장소를 보는 화면이 상태를 바꾸면 안 된다), 한 건을 읽지 못해도 후보를 "없음"으로 숨기면 안 된다. 둘 다 이 함수가 지킨다.
/** 묶음 게시 화면이 보여 줄 기준 묶음과 후보 매핑을 읽는다. 후보와 기준 묶음 모두 최신순이다. 읽지 못한 매핑은 unreadable 에 남는다. */
export function readBundlePublishOverview(repo: Repository): BundlePublishOverview {
  const links = reviewLinks(repo);
  const holding = bundlesHolding(repo);
  const candidates: MappingCandidateView[] = [];
  const unreadable: BundlePublishOverview['unreadable'] = [];
  const records = (repo.listItemVersions('MAPPING') as Array<ItemVersionRecordOf<'MAPPING'>>).filter(isMappingRecord);
  for (const record of [...records].reverse()) {
    try {
      const candidate = candidateOf(repo, record, links, holding);
      if (candidate !== null) {
        candidates.push(candidate);
      }
    } catch {
      unreadable.push({ ref: { kind: 'MAPPING', id: record.ref.id, version: record.ref.version }, reason: 'READ_FAILED' });
    }
  }
  return { bases: baseViews(repo), candidates, unreadable };
}
