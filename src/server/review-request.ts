import { appendAudit } from './audit';
import { createDraft } from './authoring';
import type { ServiceDeps } from './deps';
import { requireRole } from './domain/actor';
import type { Actor } from './domain/actor';
import type { CoverageReviewRequest, ProposedCoverageInfo } from './domain/entities';
import { DomainError } from './domain/errors';
import type { ItemVersionRecordOf, ItemVersionRef, MappingContent } from './domain/items';
import { selectPublishedTreatments } from './published-treatments';
import type { Repository } from './repo/interfaces';

// 매핑 작성 주체와 검토 요청 기록 (design.md DD-17 "매핑 작성 주체", DD-18 CoverageReviewRequest, 소유자 결정 #34).
//  - HA(병원 관리자)의 "검토 요청"은 CoverageReviewRequest(REVIEW_REQUESTED)만 만든다. 매핑은 만들지 않는다.
//  - RV 가 그 요청으로 매핑 초안을 만든다. 매핑 승인은 요청을 APPROVED 로, 반려는 REJECTED(+사유)로 닫는다.
//  - HA 는 요청을 읽기만 한다: 이 파일에 HA 가 요청이나 매핑을 고치는 쓰기 서비스는 없다.
// 병원 소유(자기 병원인지)·소속 확인은 M7(AC-022a)이며, 여기서는 넘어온 clinicId 를 그대로 믿고 치료가 그 병원의 것인지만 본다.
// 관리자 API 는 createCoverageReviewRequest 를 직접 부르지 않고 submitCoverageReviewRequest 를 부른다: 병원의 현재 게시 치료인지와 열린 요청이 이미 있는지까지 한 트랜잭션에서 본다.

export interface ReviewRequestInput {
  clinicId: string;
  treatmentId: string;
  proposed: ProposedCoverageInfo;
}

/** HA 가 검토 요청 기록을 만든다. 병원·치료가 있어야 하고 치료가 그 병원의 것이어야 한다. */
export function createCoverageReviewRequest(deps: ServiceDeps, actor: Actor, input: ReviewRequestInput): CoverageReviewRequest {
  requireRole(actor, 'HA');
  return deps.repo.transaction(() => {
    if (deps.repo.getClinic(input.clinicId) === null) {
      throw new DomainError('NOT_FOUND', `병원 '${input.clinicId}' 이(가) 없다`);
    }
    const treatment = deps.repo.getTreatment(input.treatmentId);
    if (treatment === null) {
      throw new DomainError('NOT_FOUND', `치료 '${input.treatmentId}' 이(가) 없다`);
    }
    if (treatment.clinicId !== input.clinicId) {
      throw new DomainError('REF_CONTENT_MISMATCH', `치료 '${treatment.id}' 은(는) 병원 '${input.clinicId}' 의 것이 아니다`);
    }
    const request: CoverageReviewRequest = {
      id: deps.ids.next('REVIEW_REQUEST'),
      clinicId: input.clinicId,
      treatmentId: input.treatmentId,
      proposed: structuredClone(input.proposed),
      requestedBy: { id: actor.id, role: actor.role },
      requestedAt: deps.clock.now(),
      status: 'REVIEW_REQUESTED',
      rejectionReason: null,
      draftMappingRef: null,
      resultMappingRef: null,
    };
    deps.repo.saveCoverageReviewRequest(request);
    appendAudit(deps, actor, { action: 'REVIEW_REQUEST_CREATE', target: request.id, beforeVersion: null, afterVersion: 'REVIEW_REQUESTED', reason: null });
    return request;
  });
}

/**
 * 관리자 API 의 검토 요청 제출 (HA, M7). 한 트랜잭션에서 (1) 병원이 있는지, (2) 치료가 그 병원의 현재 게시 카탈로그에 있는 활성 치료인지, (3) 그 치료에 열린 요청(REVIEW_REQUESTED)이 없는지를 보고
 * createCoverageReviewRequest 로 요청 기록과 감사 기록을 쓴다. 거절하면 아무것도 쓰지 않는다. 요청은 제안 기록일 뿐이라 치료·치료 버전·카탈로그·매핑·규칙 묶음을 바꾸지 않는다.
 *  - 병원이 없으면 NOT_FOUND.
 *  - 없는 치료 id, 다른 병원의 치료 id, 숨긴(active=false) 치료, 게시한 적 없는 병원은 모두 같은 INVALID_INPUT `TREATMENT_NOT_IN_CATALOG`(path `treatmentId`)다: 다른 병원 자료의 존재를 드러내지 않는다.
 *    "현재 게시 치료" 의 정의는 공개 카탈로그·준비 상태와 같은 selectPublishedTreatments 하나다.
 *  - 열린 요청이 이미 있으면 STATE_CONFLICT `REVIEW_ALREADY_REQUESTED`(소유자 결정: 같은 치료에 열린 요청은 하나). 승인·반려로 닫힌 뒤에는 새 요청을 낼 수 있다.
 *  - 현재 카탈로그의 참조가 저장소와 맞지 않으면(서버 데이터 결함) STATE_CONFLICT + 결함 코드(path `catalog`)다. 관리자 라우터는 이것을 500 으로 낸다.
 */
export function submitCoverageReviewRequest(deps: ServiceDeps, actor: Actor, clinicId: string, treatmentId: string, proposed: ProposedCoverageInfo): CoverageReviewRequest {
  requireRole(actor, 'HA');
  return deps.repo.transaction(() => {
    if (deps.repo.getClinic(clinicId) === null) {
      throw new DomainError('NOT_FOUND', `병원 '${clinicId}' 이(가) 없다`);
    }
    const catalog = deps.repo.getClinicCurrentCatalogVersion(clinicId);
    const published =
      catalog === null
        ? []
        : selectPublishedTreatments(deps.repo, clinicId, catalog, (defect) => {
            throw new DomainError('STATE_CONFLICT', `현재 카탈로그의 참조가 저장소와 맞지 않는다 (${defect.code})`, [{ code: defect.code, path: 'catalog' }]);
          });
    if (!published.some(({ treatment }) => treatment.id === treatmentId)) {
      throw new DomainError('INVALID_INPUT', '치료가 병원의 현재 게시 카탈로그에 없다', [{ code: 'TREATMENT_NOT_IN_CATALOG', path: 'treatmentId' }]);
    }
    if (deps.repo.listCoverageReviewRequests(clinicId).some((request) => request.treatmentId === treatmentId && request.status === 'REVIEW_REQUESTED')) {
      throw new DomainError('STATE_CONFLICT', '이 치료에는 열린 검토 요청이 이미 있다', [{ code: 'REVIEW_ALREADY_REQUESTED', path: 'treatmentId' }]);
    }
    return createCoverageReviewRequest(deps, actor, { clinicId, treatmentId, proposed });
  });
}

/**
 * RV 가 열린 검토 요청으로 매핑 초안(DRAFT)을 만들고 요청에 초안 링크를 남긴다. 요청이 없으면 NOT_FOUND, 요청이 이미 닫혔거나 초안이 있으면
 * STATE_CONFLICT, 내용의 treatmentId 가 요청의 치료와 다르면 REF_CONTENT_MISMATCH. [문서에 없음] 한 요청에 초안은 하나다.
 */
export function createMappingDraftFromRequest(deps: ServiceDeps, actor: Actor, requestId: string, content: MappingContent): ItemVersionRecordOf<'MAPPING'> {
  requireRole(actor, 'RV');
  return deps.repo.transaction(() => {
    const request = deps.repo.getCoverageReviewRequest(requestId);
    if (request === null) {
      throw new DomainError('NOT_FOUND', `검토 요청 '${requestId}' 이(가) 없다`);
    }
    if (request.status !== 'REVIEW_REQUESTED' || request.draftMappingRef !== null) {
      throw new DomainError('STATE_CONFLICT', `검토 요청 '${requestId}' 은(는) 이미 ${request.status} 이거나 매핑 초안이 연결되어 있다`);
    }
    if (content.treatmentId !== request.treatmentId) {
      throw new DomainError('REF_CONTENT_MISMATCH', `매핑 내용의 치료 '${content.treatmentId}' 이(가) 검토 요청의 치료 '${request.treatmentId}' 와 다르다`);
    }
    const draft = createDraft(deps, actor, 'MAPPING', content);
    deps.repo.saveCoverageReviewRequest({ ...request, draftMappingRef: draft.ref });
    appendAudit(deps, actor, { action: 'REVIEW_REQUEST_DRAFT_LINK', target: request.id, beforeVersion: 'REVIEW_REQUESTED', afterVersion: 'REVIEW_REQUESTED', reason: null });
    return draft;
  });
}

/**
 * 매핑 승인·반려가 부른다(approval.ts): 그 매핑 초안에 연결된 열린 요청이 있으면 같은 트랜잭션에서 닫는다.
 * 승인이면 APPROVED + 결과 매핑 버전, 반려면 REJECTED + 반려 사유(결과 매핑 없음). 연결된 열린 요청이 없으면(요청 없이 만든 매핑, 이미
 * 닫힌 요청의 재승인·재반려) 아무것도 하지 않는다.
 */
export function closeReviewRequestForMapping(
  deps: ServiceDeps,
  actor: Actor,
  treatmentId: string,
  mappingRef: ItemVersionRef,
  outcome: { status: 'APPROVED' } | { status: 'REJECTED'; reason: string },
): void {
  const treatment = deps.repo.getTreatment(treatmentId);
  if (treatment === null) {
    return;
  }
  const open = deps.repo
    .listCoverageReviewRequests(treatment.clinicId)
    .find((request) => request.status === 'REVIEW_REQUESTED' && request.draftMappingRef?.id === mappingRef.id && request.draftMappingRef.version === mappingRef.version);
  if (open === undefined) {
    return;
  }
  const rejected = outcome.status === 'REJECTED';
  deps.repo.saveCoverageReviewRequest({
    ...open,
    status: outcome.status,
    rejectionReason: rejected ? outcome.reason : null,
    resultMappingRef: rejected ? null : { kind: mappingRef.kind, id: mappingRef.id, version: mappingRef.version },
  });
  appendAudit(deps, actor, { action: 'REVIEW_REQUEST_CLOSE', target: open.id, beforeVersion: 'REVIEW_REQUESTED', afterVersion: outcome.status, reason: rejected ? outcome.reason : null });
}

/** 요청 한 건을 읽는다 (HA 읽기 전용 조회). 없으면 null. 저장소를 바꾸지 않는다. */
export function readReviewRequest(repo: Pick<Repository, 'getCoverageReviewRequest'>, id: string): CoverageReviewRequest | null {
  return repo.getCoverageReviewRequest(id);
}

/** 병원의 요청 전부를 id 순으로 읽는다 (HA 읽기 전용 조회). */
export function readClinicReviewRequests(repo: Pick<Repository, 'listCoverageReviewRequests'>, clinicId: string): CoverageReviewRequest[] {
  return repo.listCoverageReviewRequests(clinicId);
}
