import { compareCodePoints } from '../engine/validate';
import type { Generation, InsurerType, Origin, PolicySourceRef } from '../engine/types';
import { approve, reject, submitForReview } from './approval';
import { appendAudit } from './audit';
import type { ServiceDeps } from './deps';
import { requireRole } from './domain/actor';
import type { Actor } from './domain/actor';
import type { CoverageReviewRequest, ReviewedBasis, TreatmentVersion } from './domain/entities';
import { DomainError } from './domain/errors';
import type { Defect } from './domain/errors';
import { isMappingRecord } from './domain/items';
import type { ItemVersionRecordOf, ItemVersionRef, MappingContent } from './domain/items';
import { readCurrentPublishedState } from './current-published-state';
import type { CurrentPublishedState } from './current-published-state';
import { COVERAGE_JUDGMENT_FIELDS, coverageFingerprintOf } from './fingerprint';
import type { CoverageJudgmentField } from './fingerprint';
import { createMappingDraftFromRequest } from './review-request';
import type { Repository } from './repo/interfaces';

// 검토 요청 하나로 매핑을 처리하는 RV 서비스 (M7 매핑 검토, design.md DD-15·DD-17·DD-19).
//   초안 작성(createMappingDraftForReviewRequest) → 작성자가 제출(submit…) → 다른 RV 가 승인(approve…) 또는 사유와 함께 반려(reject…).
// 이 파일은 기존 서비스(review-request.ts 의 초안 작성, approval.ts 의 제출·승인·반려)를 감싸는 층이다. 본인 승인 금지·전이 표·지문 고정·요청 닫기는
// 모두 기존 서비스에 그대로 있고 여기서 다시 구현하지 않는다. 이 층이 더하는 것은 기존 서비스가 보지 않던 세 가지다:
//   1. 연결 확인: 처리하려는 매핑이 정말 이 검토 요청의 초안인가 (연결되지 않은 매핑을 승인해도 요청은 조용히 안 닫히던 틈).
//   2. 현재 게시 상태: 초안을 만들 때와 승인할 때, 치료가 아직 현재 게시 목록에 있고 값을 읽을 수 있는가.
//   3. 검토 기준: 승인 때의 현재 게시 값이 RV 가 검토를 시작한 때의 값(보장 판단 필드)과 같은가.
// 승인은 "검토 기록"일 뿐이다: 매핑이 APPROVED 가 될 뿐 게시(PUBLISHED)되지 않고, 치료 분류·카탈로그·규칙 묶음·범위·키오스크 계산을 바꾸지 않는다.
// 모든 서비스는 하나의 저장소 트랜잭션 안에서 돌고, 거절하면 아무것도 쓰지 않는다.

/** 매핑 초안 입력(서버가 id·버전·치료를 채운다). origin 은 호출한 층(운영 구성이 정한 값)이 넘기며 클라이언트가 정하지 않는다. */
export interface MappingDraftInput {
  /** 생략하면 요청의 치료. 다른 치료를 주면 기존 서비스의 REF_CONTENT_MISMATCH 가 막는다. */
  treatmentId?: string | undefined;
  scope: Array<{ generation: Generation; insurerType: InsurerType }>;
  decision: 'COVERED' | 'EXCLUDED';
  groupKey?: string | undefined;
  exclusionReason?: string | undefined;
  validity: { from: string; to: string };
  policySources: PolicySourceRef[];
  origin: Origin;
}

export interface MappingDraftResult {
  draft: ItemVersionRecordOf<'MAPPING'>;
  /** 초안 링크와 검토 기준이 반영된 요청. */
  request: CoverageReviewRequest;
}

// ───────────────────────── 현재 게시 상태 → 거절 코드 ─────────────────────────

/** 현재 게시 목록에 없는 상태가 승인·작성을 막는 코드. PUBLISHED 이면 null. */
function unpublishedCode(state: CurrentPublishedState): 'TREATMENT_HIDDEN' | 'TREATMENT_NOT_IN_CATALOG' | 'CURRENT_VALUES_UNREADABLE' | null {
  switch (state.kind) {
    case 'PUBLISHED':
      return null;
    case 'HIDDEN':
      return 'TREATMENT_HIDDEN';
    case 'NOT_IN_CATALOG':
      return 'TREATMENT_NOT_IN_CATALOG';
    case 'UNREADABLE':
      return 'CURRENT_VALUES_UNREADABLE';
  }
}

const conflict = (message: string, defects: readonly Defect[]): DomainError => new DomainError('STATE_CONFLICT', message, defects);

// ───────────────────────── 검토 기준 ─────────────────────────

/** 현재 게시 버전에서 검토 기준을 뜬다. 행위 코드는 코드 포인트 순 사본이다. */
function basisOf(version: TreatmentVersion, catalogVersionId: string, capturedAt: string): ReviewedBasis {
  return {
    fingerprint: coverageFingerprintOf(version),
    fields: { treatmentCode: version.treatmentCode, procedureCodes: [...version.procedureCodes].sort(compareCodePoints), benefitType: version.benefitType, calcClass: version.calcClass },
    catalogVersionId,
    capturedAt,
  };
}

/** 검토 기준과 다른 보장 판단 필드(COVERAGE_JUDGMENT_FIELDS 의 순서). 행위 코드는 순서를 무시하고 중복은 남겨 지문과 같은 기준으로 비교한다. */
function changedJudgmentFields(reviewed: ReviewedBasis, version: TreatmentVersion): CoverageJudgmentField[] {
  const current = basisOf(version, reviewed.catalogVersionId, reviewed.capturedAt).fields;
  const sameCodes = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && [...a].sort(compareCodePoints).every((code, index) => code === [...b].sort(compareCodePoints)[index]);
  return COVERAGE_JUDGMENT_FIELDS.filter((field) => (field === 'procedureCodes' ? !sameCodes(reviewed.fields.procedureCodes, current.procedureCodes) : reviewed.fields[field] !== current[field]));
}

export type ApprovalBasisCode = 'TREATMENT_HIDDEN' | 'TREATMENT_NOT_IN_CATALOG' | 'CURRENT_VALUES_UNREADABLE' | 'REVIEW_BASIS_MISSING' | 'REVIEWED_FIELDS_CHANGED';

/** ok 이면 승인할 수 있는 상태다(이 확인 기준에서). 아니면 승인 서비스가 거절하는 코드와 바뀐 판단 필드(REVIEWED_FIELDS_CHANGED 일 때만 채운다). */
export type ApprovalBasisCheck = { ok: true } | { ok: false; code: ApprovalBasisCode; changedFields: CoverageJudgmentField[] };

type BasisReads = Pick<Repository, 'getClinicCurrentCatalogVersion' | 'getTreatmentVersion' | 'getTreatment'>;

// @MX:ANCHOR: [AUTO] 승인 시점 확인의 단일 구현. 매핑 승인 서비스(approveMappingForReviewRequest)와 검토 대기열·이력 보기(review-request-read.ts)가 부른다.
// @MX:REASON: 화면이 "이 승인은 …때문에 거절된다"고 미리 보여 주는 판정과 서버가 실제로 거절하는 판정이 한 함수에서 나와야 한다. 둘이 갈라지면 승인 단추의 안내가 거짓이 된다.
/**
 * 요청의 승인 가능 여부를 읽기만 하고 판정한다. 확인 순서: 현재 게시 상태(숨김 → 목록에 없음 → 읽지 못함) → 검토 기준의 유무 → 판단 필드/지문 일치.
 * 현재 게시 상태를 읽지 못하면 값이 같은지 알 수 없으므로 통과시키지 않는다(닫는 쪽으로 실패).
 */
export function checkApprovalBasis(repo: BasisReads, request: CoverageReviewRequest): ApprovalBasisCheck {
  const state = readCurrentPublishedState(repo, request.clinicId, request.treatmentId);
  if (state.kind !== 'PUBLISHED') {
    return { ok: false, code: unpublishedCode(state) as ApprovalBasisCode, changedFields: [] };
  }
  const reviewed = request.reviewedBasis;
  if (reviewed === undefined) {
    return { ok: false, code: 'REVIEW_BASIS_MISSING', changedFields: [] };
  }
  const changedFields = changedJudgmentFields(reviewed, state.version);
  if (changedFields.length > 0 || coverageFingerprintOf(state.version) !== reviewed.fingerprint) {
    return { ok: false, code: 'REVIEWED_FIELDS_CHANGED', changedFields };
  }
  return { ok: true };
}

function refusalOf(check: Extract<ApprovalBasisCheck, { ok: false }>): DomainError {
  if (check.code === 'REVIEWED_FIELDS_CHANGED') {
    // 필드마다 결함 하나. 필드는 같은데 지문만 다르면(저장된 기준이 어긋남) 지문 칸으로 알린다.
    const defects: Defect[] = check.changedFields.length > 0 ? check.changedFields.map((field) => ({ code: check.code, path: field })) : [{ code: check.code, path: 'reviewedBasis.fingerprint' }];
    return conflict('검토를 시작한 뒤 치료의 보장 판단 필드가 바뀌어 승인할 수 없다 (새로 검토해야 한다)', defects);
  }
  if (check.code === 'REVIEW_BASIS_MISSING') {
    return conflict('검토 기준이 기록되어 있지 않아 승인할 수 없다 (닫는 쪽으로 실패)', [{ code: check.code, path: 'reviewedBasis' }]);
  }
  return conflict(`치료의 현재 게시 상태를 확인할 수 없어 처리할 수 없다 (${check.code})`, [{ code: check.code, path: 'catalog' }]);
}

// ───────────────────────── 연결 확인 ─────────────────────────

/**
 * 처리하려는 매핑이 이 검토 요청의 초안인지 본다. 순서: 요청 있음(NOT_FOUND) → 연결(REF_CONTENT_MISMATCH MAPPING_NOT_LINKED_TO_REQUEST: 요청에 초안이 없거나
 * 다른 매핑이거나 버전·종류가 다르다) → 요청이 열려 있음(STATE_CONFLICT REVIEW_REQUEST_CLOSED) → 매핑 기록 있음(NOT_FOUND) → 매핑의 치료가 요청의 치료와 같음
 * (REF_CONTENT_MISMATCH MAPPING_TREATMENT_MISMATCH: 초안을 만드는 서비스가 막으므로 저장된 자료가 어긋난 경우에만 닿는다).
 */
function requireLinkedMapping(deps: ServiceDeps, reviewRequestId: string, ref: ItemVersionRef): CoverageReviewRequest {
  const request = deps.repo.getCoverageReviewRequest(reviewRequestId);
  if (request === null) {
    throw new DomainError('NOT_FOUND', `검토 요청 '${reviewRequestId}' 이(가) 없다`);
  }
  const linked = request.draftMappingRef;
  if (linked === null || linked.kind !== ref.kind || linked.id !== ref.id || linked.version !== ref.version) {
    throw new DomainError('REF_CONTENT_MISMATCH', `매핑 ${ref.kind}/${ref.id}/${ref.version} 은(는) 검토 요청 '${reviewRequestId}' 의 초안이 아니다`, [{ code: 'MAPPING_NOT_LINKED_TO_REQUEST', path: 'mapping' }]);
  }
  if (request.status !== 'REVIEW_REQUESTED') {
    throw conflict(`검토 요청 '${reviewRequestId}' 은(는) 이미 ${request.status} 로 닫혔다`, [{ code: 'REVIEW_REQUEST_CLOSED', path: 'reviewRequestId' }]);
  }
  const record = deps.repo.getItemVersion(ref);
  if (record === null) {
    throw new DomainError('NOT_FOUND', `매핑 ${ref.kind}/${ref.id}/${ref.version} 이(가) 없다`);
  }
  if (!isMappingRecord(record) || record.content.treatmentId !== request.treatmentId) {
    throw new DomainError('REF_CONTENT_MISMATCH', `매핑의 치료가 검토 요청의 치료 '${request.treatmentId}' 와 다르다`, [{ code: 'MAPPING_TREATMENT_MISMATCH', path: 'mapping' }]);
  }
  return request;
}

// ───────────────────────── 서비스 ─────────────────────────

function contentOf(deps: ServiceDeps, request: CoverageReviewRequest, input: MappingDraftInput): MappingContent {
  const content: MappingContent = {
    id: deps.ids.next('MAPPING'),
    version: '1',
    treatmentId: input.treatmentId ?? request.treatmentId,
    scope: input.scope.map((cell) => ({ generation: cell.generation, insurerType: cell.insurerType })),
    decision: input.decision,
    origin: input.origin,
    validity: { from: input.validity.from, to: input.validity.to },
    policySources: input.policySources.map((source) => ({ ...source })),
  };
  // 없는 값은 키 자체를 두지 않는다: 매핑 필드 규칙(bundle-mapping.ts)의 "없음"은 undefined 이므로 null·빈 문자열로 채우면 규칙이 바뀐다.
  if (input.groupKey !== undefined) {
    content.groupKey = input.groupKey;
  }
  if (input.exclusionReason !== undefined) {
    content.exclusionReason = input.exclusionReason;
  }
  return content;
}

/**
 * RV 가 열린 검토 요청으로 매핑 초안을 만든다. 순서: 역할 → 요청 있음 → 치료가 현재 게시 목록에 있고 값을 읽을 수 있음(STATE_CONFLICT
 * TREATMENT_HIDDEN | TREATMENT_NOT_IN_CATALOG | CURRENT_VALUES_UNREADABLE, path catalog) → 기존 초안 작성(요청이 열려 있음·초안 없음·치료 일치) →
 * 요청에 검토 기준(reviewedBasis)을 남긴다. 기존 서비스는 건드리지 않는다. 거절하면 아무것도 쓰지 않는다.
 */
export function createMappingDraftForReviewRequest(deps: ServiceDeps, actor: Actor, reviewRequestId: string, input: MappingDraftInput): MappingDraftResult {
  requireRole(actor, 'RV');
  return deps.repo.transaction(() => {
    const request = deps.repo.getCoverageReviewRequest(reviewRequestId);
    if (request === null) {
      throw new DomainError('NOT_FOUND', `검토 요청 '${reviewRequestId}' 이(가) 없다`);
    }
    const state = readCurrentPublishedState(deps.repo, request.clinicId, request.treatmentId);
    if (state.kind !== 'PUBLISHED') {
      throw refusalOf({ ok: false, code: unpublishedCode(state) as ApprovalBasisCode, changedFields: [] });
    }
    const draft = createMappingDraftFromRequest(deps, actor, request.id, contentOf(deps, request, input));
    const linked = deps.repo.getCoverageReviewRequest(request.id) as CoverageReviewRequest;
    const reviewedBasis = basisOf(state.version, state.catalogVersionId, deps.clock.now());
    const updated: CoverageReviewRequest = { ...linked, reviewedBasis };
    deps.repo.saveCoverageReviewRequest(updated);
    appendAudit(deps, actor, { action: 'REVIEW_REQUEST_BASIS_CAPTURE', target: request.id, beforeVersion: null, afterVersion: reviewedBasis.fingerprint, reason: null });
    return { draft, request: updated };
  });
}

/** 작성자가 초안을 검토에 제출한다. 연결 확인 뒤 기존 submitForReview 가 (작성자만 · 전이 표를) 본다. */
export function submitMappingForReviewRequest(deps: ServiceDeps, actor: Actor, reviewRequestId: string, ref: ItemVersionRef): void {
  requireRole(actor, 'RV');
  deps.repo.transaction(() => {
    requireLinkedMapping(deps, reviewRequestId, ref);
    submitForReview(deps, actor, ref);
  });
}

/**
 * 다른 RV 가 승인한다. 순서: 역할 → 연결 → 현재 게시 상태와 검토 기준 확인(checkApprovalBasis) → 기존 approve (본인 승인 금지 · 전이 표 · 지문 고정 · 요청 닫기).
 * 확인이 통과하면 현재 게시 버전의 지문이 검토 기준과 같으므로 approve 가 고정하는 지문도 검토한 값의 지문이다.
 */
export function approveMappingForReviewRequest(deps: ServiceDeps, actor: Actor, reviewRequestId: string, ref: ItemVersionRef): void {
  requireRole(actor, 'RV');
  deps.repo.transaction(() => {
    const request = requireLinkedMapping(deps, reviewRequestId, ref);
    const check = checkApprovalBasis(deps.repo, request);
    if (!check.ok) {
      throw refusalOf(check);
    }
    approve(deps, actor, ref);
  });
}

/** RV 가 사유와 함께 반려한다(작성자 본인도 가능: 도메인이 일부러 허용한 규칙). 연결 확인 뒤 기존 reject 가 (사유 필수 · 전이 표 · 요청 닫기)를 본다. */
export function rejectMappingForReviewRequest(deps: ServiceDeps, actor: Actor, reviewRequestId: string, ref: ItemVersionRef, reason: string): void {
  requireRole(actor, 'RV');
  deps.repo.transaction(() => {
    requireLinkedMapping(deps, reviewRequestId, ref);
    reject(deps, actor, ref, reason);
  });
}
