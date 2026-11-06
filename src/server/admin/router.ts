import { priceConditionOf } from '../api/catalog';
import { guarded } from '../api/integrity';
import { readPublishedCatalog } from '../api/published-catalog';
import { discardCatalogDraft, publishCatalogDraft, saveCatalogDraft } from '../catalog-draft';
import { parseBundlePreviewBody, parseBundlePublishBody, parseBundleSuspendBody, parseRuleScopeAssignBody } from '../bundle-admin-parse';
import { previewBundlePublish, publishBundleFromBase } from '../bundle-compose';
import { readBundlePublishOverview } from '../bundle-overview';
import { suspendRuleBundle } from '../bundle-status';
import { baseFeeEditDefects } from '../catalog-base-fee';
import { structureDefects } from '../catalog-structure';
import type { Actor, Role } from '../domain/actor';
import type { CatalogDraft, Clinic, RuleBundleVersion } from '../domain/entities';
import { DomainError } from '../domain/errors';
import { draftContentDigest, issuePublishConfirmation, PUBLISH_CONFIRMATION_PATTERN } from '../publish-confirmation';
import { approveMappingForReviewRequest, createMappingDraftForReviewRequest, rejectMappingForReviewRequest, submitMappingForReviewRequest } from '../mapping-review';
import { parseMappingDraftBody, parseReviewRejectBody, parseReviewRequestRefBody } from '../mapping-review-parse';
import { parseReviewRequestBody } from '../review-request-parse';
import { readClinicReviewRequestViews, readReviewEntry, readReviewHistory, readReviewQueue, reviewRequestView } from '../review-request-read';
import { submitCoverageReviewRequest } from '../review-request';
import { readIdlePolicyAdminView, saveClinicIdlePolicyChecked } from '../idle-policy';
import { findAffectedClinics } from '../rule-scope';
import { assignRuleScopeChecked, readClinicScopeRow, readRuleScopeOverview } from '../rule-scope-admin';
import { isPlainObject } from '../validate/shape';
import { actorForClinic, actorForPlatformRole, normalizeIdentity } from './auth';
import type { AdminIdentity } from './auth';
import { buildPreview, parsePreviewRequest } from './catalog-preview';
import { adminError, invalidRequest, ok } from './http';
import type { AdminServices } from './services';

// 관리자 API 라우터 (SPEC-REIMBURSEMENT-001 M7 첫 기능: 치료 가격 수정 → 초안 저장 → 미리보기 → 게시, design.md DD-19 관리자 API (제안)).
//
//   GET    /api/admin/session                                   — 로그인한 신원(사용자 id·소속). 인증이 없으면 401.
//   GET    /api/admin/clinics/{clinicId}/treatments             — 현재 게시 치료·가격과 초안(있으면)
//   PUT    /api/admin/clinics/{clinicId}/catalog/draft          — 초안 전체를 저장(덮어씀): { priceEdits?, baseFeeEdits?, additions?, deactivations?, order? } = 가격 수정 · 공통 기본비용 금액 수정 · 새 치료 · 숨김 · 표시 순서. 이전 모양 { priceEdits } 도 그대로 받는다.
//                                                                 baseFeeEdits 는 [{ baseFeeId, amount }] (키 둘뿐, amount 는 치료 가격과 같은 원화 계약): 현재 게시 카탈로그에 든 자기 병원 공통 기본비용의 금액만 고친다. 없는 것·다른 병원의 baseFeeId 는 400 BASE_FEE_NOT_IN_CATALOG(같은 코드),
//                                                                 중복은 DUPLICATE_BASE_FEE_ID, 현재 금액과 같은 수정은 변경이 아니므로 걸러진다. 신규 등록·삭제·코드·급여 구분(보장 판단 필드) 변경은 길이 없다(알 수 없는 키는 UNKNOWN_FIELD).
//                                                                 PUT 은 초안 전체의 교체다: 빠진 키는 비어 있는 것과 같으므로 화면은 늘 치료·기본비용·구조 편집을 한 본문에 담아 보낸다(기본비용만 따로 저장하는 길은 없다)
//   DELETE /api/admin/clinics/{clinicId}/catalog/draft          — 초안 버리기
//   POST   /api/admin/clinics/{clinicId}/catalog/preview        — 초안을 게시했을 때의 계산을 현재와 나란히(같은 엔진, 읽기만). 계산 대상에 초안이 가격을 바꾼 치료가 모두 들어 있고 성공했을 때만 게시 확인값(publishConfirmation)을 싣는다. 가격 수정이 없는 초안은 계산 없이(before·after null) 목록·변경 목록만 낸다.
//                                                                 단, 공통 기본비용 금액 수정이 든 초안은 계산 없는 목록 미리보기로 확인값을 내지 않는다: 계산할 치료를 하나 이상 골라야 하고(아니면 400 BASE_FEE_PREVIEW_NEEDS_TREATMENT) 등록된 기본비용은 자동 포함되어
//                                                                 현재 게시본(옛 금액)과 초안 적용본(새 금액)이 같은 엔진으로 계산된다. 변경 목록 changes.baseFeeChanges 는 [{ baseFeeId, displayName, before, after }]. 확인값은 기본비용 수정 내용까지 묶는다
//   POST   /api/admin/clinics/{clinicId}/catalog/publish        — 본문 { publishConfirmation }: 서버가 이 관리자에게 이 초안의 미리보기를 만들어 줬을 때 발급한 값이어야 게시한다
//   GET    /api/admin/clinics/{clinicId}/catalog/versions       — 게시 이력
//   POST   /api/admin/clinics/{clinicId}/treatments/{treatmentId}/review-requests — 검토 요청 제출(HA 자기 병원, 본문 { proposed: { benefitType, procedureCodes, calcClass } }). 요청은 제안 기록일 뿐이라 치료·분류·매핑·규칙 묶음·카탈로그·키오스크 계산을 바꾸지 않는다. 치료가 병원의 현재 게시 활성 치료가 아니면 400, 열린 요청이 이미 있으면 409
//   GET    /api/admin/clinics/{clinicId}/review-requests        — 병원 관리자의 읽기 전용 요청 목록(최신순). DD-19 표에는 없고 권한 표(HA 는 자기 병원 검토 요청의 상태·결과·반려 사유를 읽는다)에서 더한 경로다
//   GET    /api/admin/review-queue                              — 검토 담당자(RV, 플랫폼 단위 소속)가 보는 모든 병원의 열린 요청(오래된 순). 병원 경로가 없다
//   GET    /api/admin/clinics/{clinicId}/idle-policy            — (HA 자기 병원) 무조작 정책 읽기. 응답 { clinic, idlePolicy: { screens, completionHoldSeconds }, customizedScreens, defaults, minLeadSeconds, policyDigest }.
//                                                                 idlePolicy 는 공개 catalog 응답의 idlePolicy 와 같은 값이다(다섯 화면 종류가 모두 있고, 저장하지 않은 종류는 기본값이다). customizedScreens 는 병원이 직접 저장한 화면 종류,
//                                                                 defaults·minLeadSeconds 는 저장하지 않은 종류가 따르는 기본값과 경고-초기화 간격 하한(초)이다.
//                                                                 policyDigest 는 읽은 순간의 저장 상태 지문(소문자 16진수 64글자)이다: 저장한 적 없음 · 직접 저장한 값(기본값과 같은 값 포함) · 직접 설정한 화면 종류가 서로 다른 지문이고, 변경 감지에만 쓴다(비밀값도 미리보기 증명도 아니다). 읽기만 한다
//   PUT    /api/admin/clinics/{clinicId}/idle-policy            — (HA 자기 병원) 무조작 정책 저장. 본문 { screens: { <화면 종류>: { warnSeconds, resetSeconds } }(일부만 가능), completionHoldSeconds: 양의 정수 | null, expectedDigest: GET 이 알린 policyDigest }(세 키 모두 필수; null = 이용 완료 화면의 자동 복귀 없음).
//                                                                 조건부 저장: 서버가 한 트랜잭션 안에서 현재 지문 비교(409 IDLE_POLICY_CHANGED) → 기존 값 검사(400) → 저장 → 감사 기록 순으로 처리한다. 지문이 없거나 형식이 틀리면(경로 expectedDigest) 400 이고, 지문이 현재 저장 상태와 다르면(그 사이 다른 창에서 저장됨) 409 이며 정책·감사 기록은 그대로다. 낡은 지문과 틀린 값이 함께 오면 409 가 먼저다.
//                                                                 저장은 정책 전체를 바꾼다(PUT 전체 교체): 본문에 없는 화면 종류는 기본값으로 돌아간다. 서버가 화면 종류 이름·초 값(0 이상의 정수)·경고 < 초기화이고 간격 ≥ 20초(completionHoldSeconds 에는 이 하한이 없다)를 검사한다.
//                                                                 응답은 GET 과 같은 모양(방금 저장한 값을 저장소에서 다시 읽은 것). 400: 어긋난 필드마다 { code, path }. 거절하면 정책 저장소도 감사 기록도 바뀌지 않는다. 성공하면 감사 기록은 IDLE_POLICY_SAVE 한 건이다.
//                                                                 병원은 경로가 정한다(본문의 병원 id 는 읽지 않는다). 저장은 이미 열려 있는 키오스크 세션에는 닿지 않는다: 새로 연 키오스크가 catalog 응답의 idlePolicy 로 읽는다. 가격·보장 규칙·계산·카탈로그 버전은 바꾸지 않는다
//
// 검토 담당자(RV, 플랫폼 단위 소속) 전용 경로 — 매핑 검토 (M7 매핑 검토). DD-19 표는 초안 작성·승인·반려를 나열한다. 검토 제출(submit), 이력 조회(review-history),
// 대기열·이력 보기의 확장(현재 게시 상태·매핑 요약·검토 기준 비교)은 DD-19 에 없고 권한 표(작성자의 검토 제출 · RV 의 처리 결과 조회)에서 이 라우터가 더한 것이다:
//   GET    /api/admin/review-history                            — 닫힌(승인·반려) 요청 이력(최신순, 모든 병원). 응답 { history: [항목] }
//   POST   /api/admin/review-requests/{reviewRequestId}/mappings — 열린 요청으로 매핑 초안 작성. 본문 { mapping: { treatmentId?, scope, decision, groupKey?, exclusionReason?, validity: { from, to }, policySources } }
//   POST   /api/admin/mappings/{mappingId}/versions/{version}/submit  — 작성자가 초안을 검토에 제출. 본문 { reviewRequestId }
//   POST   /api/admin/mappings/{mappingId}/versions/{version}/approve — 작성자가 아닌 RV 가 승인(검토 기록일 뿐: 매핑이 APPROVED 가 되고 요청이 닫힌다. 게시·분류 전환·규칙 묶음 변경은 없다). 본문 { reviewRequestId }
//   POST   /api/admin/mappings/{mappingId}/versions/{version}/reject  — RV 가 사유와 함께 반려. 본문 { reviewRequestId, reason }
// 네 쓰기의 성공 응답은 모두 `{ entry }` 다: 그 요청의 갱신된 항목으로, 대기열 항목(병원·현재 게시 상태·매핑 요약·검토 기준 비교·승인 차단 사유)에 처리 결과 칸
// (resultMappingRef·closedBy·closedAt: 열려 있으면 null)을 더한 이력 항목과 같은 모양이다. 화면은 이 응답으로 그 행을 새로 고친다.
// 매핑의 id·버전·치료·출처·상태·승인자·지문·작성자는 서버가 정하며 본문으로 받지 않는다(출처는 이 배포의 관리자 생성 자료 출처 services.newTreatmentOrigin 이다).
//
// 처리 순서(앞선 거절이 이기고 응답 하나만 나간다): 인증(401) → 경로·메서드(404·405) → 병원 소속과 역할(403) → 병원 존재(404) → 본문 읽기(400) → 도메인 서비스.
// 인증·권한 거절은 저장소를 읽기 전에 나가므로 저장 상태가 그대로이고, 병원이 존재하는지도 알리지 않는다(소속이 없으면 없는 병원도 403).
// 신원·역할·병원은 AdminAuthenticator 가 검증한 값에서만 온다. 요청의 헤더·쿼리·본문에서는 읽지 않는다.
// 병원 경로의 역할은 HA 만 허용한다(권한 표: 카탈로그 초안 저장·미리보기·게시·이력 조회·검토 요청 제출과 읽기는 HA 자기 병원). RV·PO 는 이 경로에서 403 이다.
// 대기열과 위 매핑 검토 경로는 반대로 플랫폼 단위 RV 만 허용한다(HA·PO·병원에 매인 RV 는 403). 병원 관리자의 쓰기는 초안·게시와 검토 요청 제출뿐이다:
// 병원 경로에는 승인·반려·닫기·매핑 수정이 없다. 매핑 검토 경로에는 매핑 게시(PUBLISHED)·치료 분류 전환이 없다(승인은 검토 기록일 뿐이다).
//
// 묶음 구성(RV)과 규칙 사용 범위 지정(PO) — M7 묶음 구성. 흐름: 승인된 매핑 → RV 가 새 규칙 묶음 게시 → PO 가 한 병원에 명시 지정 → 그 병원의 옵션·계산이 새 묶음을 쓴다.
// 경로마다 역할이 정해져 있고(PlatformRoute.role) 둘 다 병원에 매이지 않은 플랫폼 단위 소속만 인정한다. 게시는 어느 병원도 지정하지 않는다: RV 는 지정할 수 없고 PO 는 게시할 수 없다.
//   GET    /api/admin/bundle-publish                            — (RV) 기준이 될 묶음(ACTIVE · SUSPENDED, 최신순)과 현재 APPROVED 인 후보 매핑. 응답 { bases, candidates, unreadable }. 읽기만 한다
//   POST   /api/admin/bundle-publish/preview                    — (RV) 본문 { baseBundleId, mappings: [{ id, version }] }. 기준 묶음의 항목 전부 + 고른 매핑을 합친 구성을 평가한다. 묶음·상태·범위·감사 기록은 바꾸지 않는다. 응답 { base, items, defects, conflicts, publishConfirmation }.
//                                                                 결함(게시와 같은 판정)과 충돌은 오류가 아니라 응답에 담기고(200) 확인값은 둘 다 없을 때만 있다(아니면 null). 확인값은 서버가 이 RV 에게 이 구성으로 발급해 서버에 기록해 둔 예측할 수 없는 일회용 값이다
//                                                                 (입력에서 다시 계산할 수 없다). 발급이 쓰는 것은 확인값 기록 하나뿐이고 결함·충돌이 있으면 아무것도 쓰지 않는다. 기록은 사람이 화면을 읽었다는 증명이 아니라 "서버가 미리보기를 만들었다"는 증거다. 구성이 성립하지 않으면 404(기준 묶음·매핑 없음) · 409(BASE_BUNDLE_NOT_ACTIVE · MAPPING_ALREADY_IN_BASE)
//   POST   /api/admin/bundle-publish                            — (RV) 본문 { baseBundleId, mappings, publishConfirmation }. 응답 { bundle: { id, contentHash, publishedAt, publishedBy, itemRefs, status }, assignedClinics }.
//                                                                 assignedClinics 는 새 묶음을 현재 범위로 가진 병원이며 게시는 지정하지 않으므로 빈 목록이다. 409: MAPPING_CONFLICT · MAPPING_ALREADY_IN_BASE · BASE_BUNDLE_NOT_ACTIVE · PREVIEW_REQUIRED(서버가 발급한 적 없는 값 · 이미 쓰인 값 · 다른 관리자에게 발급된 값 · 다른 구성의 값 · 미리보기 뒤 구성이 바뀐 값; 원인은 구별해 알리지 않는다).
//                                                                 400: 기존 게시 전제(PUBLISH_VALIDATION_FAILED 의 defects: ITEM_STATE_NOT_PUBLISHABLE · FINGERPRINT_STALE …). 404: 기준 묶음·매핑 없음. 감사 기록은 기존 BUNDLE_PUBLISH 한 건이다. 게시는 확인값을 한 번 소비한다(같은 요청을 다시 보내면 409 PREVIEW_REQUIRED)
//   GET    /api/admin/rule-scope                                — (PO) 병원별 현재 범위(묶음·가용성·지정 시각·지정자)와 게시된 묶음 목록. 응답 { clinics, bundles }. 읽기만 한다
//   POST   /api/admin/rule-scope/clinics/{clinicId}             — (PO) 본문 { ruleBundleVersionId, expectedCurrentBundleId }(키 필수, null = 범위가 없다고 보았다). 응답 { clinic: 갱신된 병원 줄, scope }. 병원은 경로가 정하고 본문에서 받지 않는다.
//                                                                 404: 병원·묶음 없음(역할 확인 뒤에만). 409 BUNDLE_NOT_ACTIVE: 지정하려는 묶음이 지정 트랜잭션 안에서 읽은 가용성이 ACTIVE 가 아님(화면을 연 뒤 중지됨 · 가용성 기록 없음). 409 SCOPE_CHANGED: 화면이 본 현재 범위가 그 사이 바뀜.
//                                                                 409 는 모두 범위·이력·감사 기록을 쓰기 전에 나간다. 감사 기록은 기존 CLINIC_SCOPE_ASSIGN 한 건이다. 이미 중지된 묶음을 쓰고 있는 병원의 현재 범위는 그대로 읽힌다(GET 은 status SUSPENDED 로 보인다)
//   POST   /api/admin/rule-bundles/{bundleId}/suspend           — (RV) 규칙 묶음 중지. 본문 { reason }(필수·비어 있지 않은 문자열; 묶음은 경로가 정한다). 응답 { bundle: { id, status: 'SUSPENDED' }, suspension: { at, by, role, reason, previousStatus: 'ACTIVE' }, affectedClinics: [{ clinicId, slug }] }.
//                                                                 affectedClinics 는 중지 시점에 현재 범위가 이 묶음을 가리키는 병원이다(지난 범위 이력은 세지 않는다). 중지는 묶음의 가용성만 바꾼다: 묶음 내용·항목 상태·병원별 범위는 그대로이고, 다시 활성으로 돌리거나 다른 묶음으로 바꾸는 경로는 없다
//                                                                 (복구 = 새 묶음 게시 + PO 의 병원별 재지정). 400: 사유 없음·공백뿐·알 수 없는 키. 403: RV 가 아니거나 병원에 매인 RV. 404: 묶음 없음. 409 BUNDLE_NOT_ACTIVE: 이미 중지됐거나 가용성 기록이 없음.
//                                                                 감사 기록은 BUNDLE_SUSPEND 한 건(수행자·시각·사유·이전/이후 상태·영향 병원 수)이다. 병원 하나의 규칙을 즉시 멈추는 경로는 없다

/** 경로의 `:이름` 조각이 잡은 (디코딩된) 값. */
type RouteParams = Readonly<Record<string, string>>;

type Handler = (services: AdminServices, request: Request, actor: Actor, clinic: Clinic, params: RouteParams) => Promise<Response> | Response;

const CONFLICT_REASONS: readonly string[] = [
  'DRAFT_STALE',
  'DRAFT_ABSENT',
  'CATALOG_ABSENT',
  'PREVIEW_REQUIRED',
  'REVIEW_ALREADY_REQUESTED',
  // 매핑 검토 (RV 경로): 현재 게시 상태·검토 기준 확인, 닫힌 요청, 전이 표, 초안 중복.
  'TREATMENT_HIDDEN',
  'TREATMENT_NOT_IN_CATALOG',
  'CURRENT_VALUES_UNREADABLE',
  'REVIEW_BASIS_MISSING',
  'REVIEWED_FIELDS_CHANGED',
  'REVIEW_REQUEST_CLOSED',
  'MAPPING_DRAFT_ALREADY_EXISTS',
  'TRANSITION_NOT_ALLOWED',
  // 묶음 구성(RV)과 규칙 사용 범위 지정(PO): 겹치는 매핑, 이미 기준 묶음에 있는 매핑, ACTIVE 가 아닌 기준 묶음, 화면이 본 뒤 바뀐 현재 범위.
  // BUNDLE_NOT_ACTIVE: 묶음 중지(이미 중지됐거나 가용성 기록이 없음)와 범위 지정(지정하려는 묶음이 ACTIVE 가 아님)이 함께 쓴다.
  'MAPPING_CONFLICT',
  'MAPPING_ALREADY_IN_BASE',
  'BASE_BUNDLE_NOT_ACTIVE',
  'BUNDLE_NOT_ACTIVE',
  'SCOPE_CHANGED',
  // 무조작 정책(HA): 화면이 읽은 저장 상태 지문(expectedDigest)이 저장 시점의 현재 지문과 다름(다른 창·다른 사람이 그 사이 저장함).
  'IDLE_POLICY_CHANGED',
];

/**
 * 도메인 오류를 관리자 응답으로 바꾼다. 요청 쪽 거절만 바꾸고, 서버 데이터 결함은 null 이라 호출한 쪽이 다시 던져 500 이 된다.
 * 카탈로그 참조 결함(STATE_CONFLICT + TREATMENT_VERSION_MISSING 등, path catalog)은 그대로 500 이다: 목록에 있는 코드만 409 가 된다.
 * 매핑 검토의 거절(본인 승인·작성자 아님·사유 필수·참조 불일치·치료 버전 없음)은 서버 결함이 아니라 요청 쪽 거절이므로 500 이 아닌 응답으로 바꾼다.
 */
function responseFromDomainError(error: DomainError): Response | null {
  switch (error.code) {
    case 'INVALID_INPUT':
    case 'PUBLISH_VALIDATION_FAILED':
    case 'REASON_REQUIRED':
      return invalidRequest(error.defects);
    case 'STATE_CONFLICT': {
      const reason = error.defects[0]?.code;
      return reason !== undefined && CONFLICT_REASONS.includes(reason) ? adminError('CONFLICT', { reason }) : null;
    }
    case 'NOT_FOUND':
      return adminError('NOT_FOUND');
    case 'ROLE_NOT_PERMITTED':
      return adminError('FORBIDDEN');
    case 'SELF_APPROVAL_FORBIDDEN':
    case 'NOT_ITEM_AUTHOR':
      return adminError('FORBIDDEN', { reason: error.code });
    case 'REF_CONTENT_MISMATCH':
      return adminError('CONFLICT', { reason: error.defects[0]?.code ?? 'REF_CONTENT_MISMATCH' });
    case 'TREATMENT_VERSION_ABSENT':
      return adminError('CONFLICT', { reason: 'TREATMENT_VERSION_ABSENT' });
    default:
      return null;
  }
}

async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: (await request.json()) as unknown };
  } catch {
    return { ok: false };
  }
}

const draftView = (draft: CatalogDraft, currentCatalogVersion: string | null) => ({
  baseCatalogVersionId: draft.baseCatalogVersionId,
  priceEdits: draft.priceEdits.map((edit) => ({ treatmentId: edit.treatmentId, patientAmount: edit.patientAmount })),
  /** 공통 기본비용의 새 금액들(baseFeeId 의 코드 포인트 순). 금액 말고 보장 판단 필드는 담지 않는다. 기본비용을 건드리지 않은 초안은 빈 배열이다. */
  baseFeeEdits: draft.baseFeeEdits.map((edit) => ({ baseFeeId: edit.baseFeeId, amount: edit.amount })),
  /** 새 치료 초안(요청에 적은 표시 필드만). 분류·출처·치료 id 는 서버가 게시 때 정하므로 없다. */
  additions: draft.additions.map((addition) => structuredClone(addition)),
  deactivations: [...draft.deactivations],
  /** null 이면 기본 순서(남는 기존 치료는 지금 순서 그대로, 새 치료는 뒤에). */
  order: draft.order === null ? null : [...draft.order],
  updatedAt: draft.updatedAt,
  updatedBy: draft.updatedBy.id,
  /** 초안 내용 전체(가격·새 치료·숨김·순서)의 지문. 화면이 "저장된 초안이 그대로인가"를 비교하는 상태 표지일 뿐 게시 권한이 아니다(누구나 이 응답에서 얻는다). 게시는 미리보기가 준 publishConfirmation 으로만 한다. */
  draftDigest: draftContentDigest(draft),
  /** 초안이 근거한 카탈로그가 지금의 현재 카탈로그와 다르면 true: 이 초안은 게시할 수 없다. */
  stale: draft.baseCatalogVersionId !== currentCatalogVersion,
});

const getTreatments: Handler = (services, _request, _actor, clinic) => {
  const published = readPublishedCatalog(services.api.repo, clinic);
  const draft = services.api.repo.getCatalogDraft(clinic.id);
  const currentVersion = published.catalog === null ? null : published.catalog.id;
  return ok({
    clinic: { id: clinic.id, slug: clinic.slug, displayName: clinic.name },
    catalogVersion: currentVersion,
    // 보장 판단 필드(급여 구분·치료 코드·행위 코드)는 읽기 전용으로 보인다. 가격 수정은 이 값을 바꾸지 못한다.
    treatments: published.treatments.map(({ treatment, version }) => ({
      treatmentId: treatment.id,
      displayName: version.displayName,
      description: version.description,
      benefitType: version.benefitType,
      treatmentCode: version.treatmentCode,
      procedureCodes: version.procedureCodes,
      patientAmount: version.patientAmount,
      priceCondition: priceConditionOf(version.amountCondition),
      order: treatment.sortOrder,
    })),
    baseFees: published.baseFees.map((fee) => ({ baseFeeId: fee.baseFeeId, displayName: fee.displayName, benefitType: fee.benefitType, amount: fee.amount })),
    draft: draft === null ? null : draftView(draft, currentVersion),
  });
};

const putDraft: Handler = async (services, request, actor, clinic) => {
  const body = await readJson(request);
  if (!body.ok) {
    return invalidRequest([{ code: 'NOT_JSON', path: 'request' }]);
  }
  const draft = saveCatalogDraft(services.deps, actor, clinic.id, body.body);
  return ok({ draft: draftView(draft, draft.baseCatalogVersionId) });
};

const deleteDraft: Handler = (services, _request, actor, clinic) => ok({ discarded: discardCatalogDraft(services.deps, actor, clinic.id) });

const postPreview: Handler = async (services, request, actor, clinic) => {
  const body = await readJson(request);
  if (!body.ok) {
    return invalidRequest([{ code: 'NOT_JSON', path: 'request' }]);
  }
  const draft = services.api.repo.getCatalogDraft(clinic.id);
  if (draft === null) {
    return adminError('CONFLICT', { reason: 'DRAFT_ABSENT' });
  }
  const published = readPublishedCatalog(services.api.repo, clinic);
  if (published.catalog === null || published.catalog.id !== draft.baseCatalogVersionId) {
    return adminError('CONFLICT', { reason: 'DRAFT_STALE' });
  }
  // 저장한 뒤 치료 기록이 바뀌어(숨길 치료가 이미 비활성이 되는 등) 초안의 구조가 현재 게시 치료와 맞지 않으면 낡은 초안처럼 다룬다: 게시도 같은 이유로 거절하므로 확인값을 내지 않는다.
  if (structureDefects(services.api.repo, clinic.id, published.treatments, draft).length > 0 || baseFeeEditDefects(published.baseFees, draft.baseFeeEdits).length > 0) {
    return adminError('CONFLICT', { reason: 'DRAFT_STALE' });
  }
  const parsed = parsePreviewRequest(body.body, draft);
  if (!parsed.ok) {
    return invalidRequest(parsed.defects);
  }
  const preview = buildPreview(services.api, clinic, published, draft, parsed.request, services.newTreatmentOrigin);
  if (preview === null) {
    return invalidRequest([{ code: 'TREATMENT_NOT_IN_CATALOG', path: 'request.treatmentIds' }]);
  }
  // 계산이 성공했을 때만 게시 확인값을 싣는다. 이 요청을 한 관리자·이 병원·이 기준 카탈로그·이 초안(저장 한 번)에 묶인 값이다.
  return ok({ ...preview, draftDigest: draftContentDigest(draft), publishConfirmation: issuePublishConfirmation(draft, actor.id) });
};

const postPublish: Handler = async (services, request, actor, clinic) => {
  const body = await readJson(request);
  if (!body.ok) {
    return invalidRequest([{ code: 'NOT_JSON', path: 'request' }]);
  }
  if (!isPlainObject(body.body)) {
    return invalidRequest([{ code: 'NOT_OBJECT', path: 'request' }]);
  }
  // 본문은 { publishConfirmation } 하나뿐이다. 옛 이름 draftDigest 를 포함한 다른 키는 모두 UNKNOWN_FIELD 로 거절한다(목록·저장 응답의 지문은 게시 권한이 아니다).
  const extra = Object.keys(body.body).filter((key) => key !== 'publishConfirmation');
  const confirmation = body.body.publishConfirmation;
  const defects = [
    ...extra.map((key) => ({ code: 'UNKNOWN_FIELD', path: `request.${key}` })),
    ...(confirmation === undefined ? [{ code: 'VALUE_MISSING', path: 'publishConfirmation' }] : typeof confirmation === 'string' && PUBLISH_CONFIRMATION_PATTERN.test(confirmation) ? [] : [{ code: 'VALUE_INVALID', path: 'publishConfirmation' }]),
  ];
  if (defects.length > 0 || typeof confirmation !== 'string') {
    return invalidRequest(defects);
  }
  // 초안 존재·낡음·확인값 일치는 게시 트랜잭션 안에서, 아무것도 쓰기 전에 서비스가 가린다(DRAFT_ABSENT·DRAFT_STALE·PREVIEW_REQUIRED → 409).
  const catalog = publishCatalogDraft(services.deps, actor, clinic.id, confirmation, { acceptedLineOrigins: services.api.acceptedOrigins.lines }, services.newTreatmentOrigin);
  return ok({ catalogVersion: catalog.id, publishedAt: catalog.publishedAt, changeSummary: catalog.changeSummary });
};

const getVersions: Handler = (services, _request, _actor, clinic) => {
  const current = services.api.repo.getClinicCurrentCatalogVersion(clinic.id);
  const versions = services.api.repo
    .listCatalogVersions(clinic.id)
    .map((catalog) => ({ id: catalog.id, publishedBy: catalog.publishedBy.id, publishedAt: catalog.publishedAt, changeSummary: catalog.changeSummary, current: current !== null && current.id === catalog.id }))
    .reverse();
  return ok({ versions });
};

/** 무조작 정책의 관리자 보기. GET 과 PUT 의 응답이 같은 모양이다(PUT 은 방금 저장한 값을 저장소에서 다시 읽어 낸다). */
function idlePolicyBody(services: AdminServices, clinic: Clinic) {
  const view = readIdlePolicyAdminView(services.api.repo, clinic.id);
  return {
    clinic: { id: clinic.id, slug: clinic.slug, displayName: clinic.name },
    idlePolicy: { screens: view.screens, completionHoldSeconds: view.completionHoldSeconds },
    customizedScreens: view.customizedScreens,
    defaults: view.defaults,
    minLeadSeconds: view.minLeadSeconds,
    policyDigest: view.policyDigest,
  };
}

const getIdlePolicy: Handler = (services, _request, _actor, clinic) => ok(idlePolicyBody(services, clinic));

const putIdlePolicy: Handler = async (services, request, actor, clinic) => {
  const body = await readJson(request);
  if (!body.ok) {
    return invalidRequest([{ code: 'NOT_JSON', path: 'request' }]);
  }
  // 지문 비교(expectedDigest)·검사(화면 종류·초 값·간격·completionHoldSeconds)·저장·감사 기록은 서비스가 한 트랜잭션에서 이 순서로 한다: 거절(400·409)은 아무것도 쓰지 않는다. 병원은 경로가 정한다.
  saveClinicIdlePolicyChecked(services.deps, actor, clinic.id, body.body);
  return ok(idlePolicyBody(services, clinic));
};

const getReviewRequests: Handler = (services, _request, _actor, clinic) => ok({ reviewRequests: readClinicReviewRequestViews(services.api.repo, clinic.id) });

const postReviewRequest: Handler = async (services, request, actor, clinic, params) => {
  const body = await readJson(request);
  if (!body.ok) {
    return invalidRequest([{ code: 'NOT_JSON', path: 'request' }]);
  }
  const parsed = parseReviewRequestBody(body.body);
  if (!parsed.ok) {
    return invalidRequest(parsed.defects);
  }
  // 치료가 병원의 현재 게시 활성 치료인지·열린 요청이 이미 있는지는 서비스가 한 트랜잭션에서 본다(400 TREATMENT_NOT_IN_CATALOG · 409 REVIEW_ALREADY_REQUESTED). 요청자는 검증된 신원(actor)이다.
  const created = submitCoverageReviewRequest(services.deps, actor, clinic.id, params.treatmentId ?? '', parsed.proposed);
  return ok({ reviewRequest: reviewRequestView(services.api.repo, created) });
};

// ───────────────────────── 매핑 검토 (RV 전용, 병원 경로 없음) ─────────────────────────

/** 플랫폼 단위 RV 의 행위자와 경로 조각 값으로 부르는 처리기. */
type PlatformHandler = (services: AdminServices, request: Request, actor: Actor, params: RouteParams) => Promise<Response> | Response;

/** 처리한 요청의 갱신된 항목을 응답으로 낸다. 방금 쓴 요청이 읽히지 않으면 서버 결함이라 던져 500 이 된다. */
function entryResponse(services: AdminServices, reviewRequestId: string): Response {
  const entry = readReviewEntry(services.api.repo, reviewRequestId);
  if (entry === null) {
    throw new Error('처리한 검토 요청을 읽을 수 없다');
  }
  return ok({ entry });
}

/** 경로가 가리키는 매핑 항목 버전. 종류는 항상 MAPPING 이다(이 경로들은 매핑만 다룬다). */
const mappingRefOf = (params: RouteParams) => ({ kind: 'MAPPING' as const, id: params.mappingId ?? '', version: params.version ?? '' });

const getReviewHistory: PlatformHandler = (services) => ok({ history: readReviewHistory(services.api.repo) });

const postMappingDraft: PlatformHandler = async (services, request, actor, params) => {
  const body = await readJson(request);
  if (!body.ok) {
    return invalidRequest([{ code: 'NOT_JSON', path: 'request' }]);
  }
  const parsed = parseMappingDraftBody(body.body);
  if (!parsed.ok) {
    return invalidRequest(parsed.defects);
  }
  // 매핑의 출처(origin)는 클라이언트가 정하지 않는다. services.newTreatmentOrigin 은 이름에 "치료"가 들어 있지만 이 배포가 관리자가 만든 자료에 붙이는 데이터 출처다(운영 구성은 OPERATING).
  const reviewRequestId = params.reviewRequestId ?? '';
  createMappingDraftForReviewRequest(services.deps, actor, reviewRequestId, { ...parsed.input, origin: services.newTreatmentOrigin });
  return entryResponse(services, reviewRequestId);
};

const postMappingSubmit: PlatformHandler = async (services, request, actor, params) => {
  const body = await readJson(request);
  if (!body.ok) {
    return invalidRequest([{ code: 'NOT_JSON', path: 'request' }]);
  }
  const parsed = parseReviewRequestRefBody(body.body);
  if (!parsed.ok) {
    return invalidRequest(parsed.defects);
  }
  submitMappingForReviewRequest(services.deps, actor, parsed.reviewRequestId, mappingRefOf(params));
  return entryResponse(services, parsed.reviewRequestId);
};

const postMappingApprove: PlatformHandler = async (services, request, actor, params) => {
  const body = await readJson(request);
  if (!body.ok) {
    return invalidRequest([{ code: 'NOT_JSON', path: 'request' }]);
  }
  const parsed = parseReviewRequestRefBody(body.body);
  if (!parsed.ok) {
    return invalidRequest(parsed.defects);
  }
  approveMappingForReviewRequest(services.deps, actor, parsed.reviewRequestId, mappingRefOf(params));
  return entryResponse(services, parsed.reviewRequestId);
};

const postMappingReject: PlatformHandler = async (services, request, actor, params) => {
  const body = await readJson(request);
  if (!body.ok) {
    return invalidRequest([{ code: 'NOT_JSON', path: 'request' }]);
  }
  const parsed = parseReviewRejectBody(body.body);
  if (!parsed.ok) {
    return invalidRequest(parsed.defects);
  }
  rejectMappingForReviewRequest(services.deps, actor, parsed.reviewRequestId, mappingRefOf(params), parsed.reason);
  return entryResponse(services, parsed.reviewRequestId);
};

// ───────────────────────── 묶음 구성(RV)과 규칙 사용 범위 지정(PO) ─────────────────────────

/** 게시한 묶음의 응답용 요약. 방금 쓴 묶음의 가용성이 읽히지 않으면 서버 결함이라 던져 500 이 된다. */
function bundleView(services: AdminServices, bundle: RuleBundleVersion) {
  const status = services.api.repo.getBundleStatus(bundle.id);
  if (status === null) {
    throw new Error('게시한 규칙 묶음의 가용성을 읽을 수 없다');
  }
  return {
    id: bundle.id,
    contentHash: bundle.contentHash,
    publishedAt: bundle.publishedAt,
    publishedBy: bundle.publishedBy.id,
    itemRefs: bundle.itemRefs.map((ref) => ({ kind: ref.kind, id: ref.id, version: ref.version })),
    status,
  };
}

const getBundlePublish: PlatformHandler = (services) => ok(readBundlePublishOverview(services.api.repo));

const postBundlePreview: PlatformHandler = async (services, request, actor) => {
  const body = await readJson(request);
  if (!body.ok) {
    return invalidRequest([{ code: 'NOT_JSON', path: 'request' }]);
  }
  const parsed = parseBundlePreviewBody(body.body);
  if (!parsed.ok) {
    return invalidRequest(parsed.defects);
  }
  // 묶음·상태·범위·감사는 바꾸지 않는다(깨끗한 구성이면 서버가 확인값 기록 하나를 쓴다). 결함·충돌은 오류가 아니라 응답에 담기고(200), 구성이 성립하지 않을 때만 404·409 이다.
  // services.deps 는 시계와 식별자 생성기를 가진다: 확인값은 그 생성기에서 파생한 예측할 수 없는 값이다.
  return ok(previewBundlePublish(services.deps, actor, { baseBundleId: parsed.baseBundleId, mappings: parsed.mappings }));
};

const postBundlePublish: PlatformHandler = async (services, request, actor) => {
  const body = await readJson(request);
  if (!body.ok) {
    return invalidRequest([{ code: 'NOT_JSON', path: 'request' }]);
  }
  const parsed = parseBundlePublishBody(body.body);
  if (!parsed.ok) {
    return invalidRequest(parsed.defects);
  }
  const bundle = publishBundleFromBase(services.deps, actor, { baseBundleId: parsed.baseBundleId, mappings: parsed.mappings, publishConfirmation: parsed.publishConfirmation });
  // assignedClinics 는 방금 만든 묶음을 현재 범위로 가진 병원이다. 게시는 범위를 지정하지 않으므로 늘 빈 목록이고, 읽어서 낸다(지정은 PO 의 일이다).
  return ok({ bundle: bundleView(services, bundle), assignedClinics: findAffectedClinics(services.api.repo, bundle.id) });
};

const getRuleScope: PlatformHandler = (services) => ok(readRuleScopeOverview(services.api.repo));

const postRuleScopeAssign: PlatformHandler = async (services, request, actor, params) => {
  const body = await readJson(request);
  if (!body.ok) {
    return invalidRequest([{ code: 'NOT_JSON', path: 'request' }]);
  }
  const parsed = parseRuleScopeAssignBody(body.body);
  if (!parsed.ok) {
    return invalidRequest(parsed.defects);
  }
  // 병원은 경로가 정한다(본문에서 받지 않는다). 병원·묶음이 없으면 404, 화면이 본 현재 범위와 다르면 409 SCOPE_CHANGED.
  const clinicId = params.clinicId ?? '';
  const scope = assignRuleScopeChecked(services.deps, actor, clinicId, parsed.ruleBundleVersionId, parsed.expectedCurrentBundleId);
  const clinic = readClinicScopeRow(services.api.repo, clinicId);
  if (clinic === null) {
    throw new Error('범위를 지정한 병원을 읽을 수 없다');
  }
  return ok({ clinic, scope: { clinicId: scope.clinicId, ruleBundleVersionId: scope.ruleBundleVersionId, assignedAt: scope.assignedAt, assignedBy: scope.assignedBy.id } });
};

const postBundleSuspend: PlatformHandler = async (services, request, actor, params) => {
  const body = await readJson(request);
  if (!body.ok) {
    return invalidRequest([{ code: 'NOT_JSON', path: 'request' }]);
  }
  const parsed = parseBundleSuspendBody(body.body);
  if (!parsed.ok) {
    return invalidRequest(parsed.defects);
  }
  // 묶음은 경로가 정한다. 사유 검사 · 묶음 있음(404) · ACTIVE 인지(409) · 가용성 사건 · 영향 병원 계산 · 감사 기록은 서비스가 한 트랜잭션에서 한다: 거절은 아무것도 쓰지 않는다.
  const bundleId = params.bundleId ?? '';
  const outcome = suspendRuleBundle(services.deps, actor, bundleId, parsed.reason);
  // 방금 덧붙인 사건이 읽히지 않으면 서버 결함이라 던져 500 이 된다.
  if (services.api.repo.getBundleStatus(bundleId) !== 'SUSPENDED') {
    throw new Error('중지한 규칙 묶음의 가용성을 읽을 수 없다');
  }
  return ok({
    bundle: { id: bundleId, status: 'SUSPENDED' },
    suspension: { at: outcome.event.at, by: outcome.event.actorId, role: outcome.event.role, reason: outcome.event.reason, previousStatus: outcome.event.previousStatus },
    affectedClinics: outcome.affectedClinics.map((clinic) => ({ clinicId: clinic.clinicId, slug: clinic.slug })),
  });
};

interface PlatformRoute {
  method: string;
  /** 이 경로를 열 수 있는 플랫폼 단위 역할(병원에 매이지 않은 소속). */
  role: Role;
  /** 경로 전체. `:이름` 조각은 어떤 비어 있지 않은 값이든 잡아 처리기의 params 로 넘긴다. */
  segments: readonly string[];
  handler: PlatformHandler;
}

const PLATFORM_ROUTES: readonly PlatformRoute[] = [
  { method: 'GET', role: 'RV', segments: ['review-history'], handler: getReviewHistory },
  { method: 'POST', role: 'RV', segments: ['review-requests', ':reviewRequestId', 'mappings'], handler: postMappingDraft },
  { method: 'POST', role: 'RV', segments: ['mappings', ':mappingId', 'versions', ':version', 'submit'], handler: postMappingSubmit },
  { method: 'POST', role: 'RV', segments: ['mappings', ':mappingId', 'versions', ':version', 'approve'], handler: postMappingApprove },
  { method: 'POST', role: 'RV', segments: ['mappings', ':mappingId', 'versions', ':version', 'reject'], handler: postMappingReject },
  { method: 'GET', role: 'RV', segments: ['bundle-publish'], handler: getBundlePublish },
  { method: 'POST', role: 'RV', segments: ['bundle-publish', 'preview'], handler: postBundlePreview },
  { method: 'POST', role: 'RV', segments: ['bundle-publish'], handler: postBundlePublish },
  { method: 'POST', role: 'RV', segments: ['rule-bundles', ':bundleId', 'suspend'], handler: postBundleSuspend },
  { method: 'GET', role: 'PO', segments: ['rule-scope'], handler: getRuleScope },
  { method: 'POST', role: 'PO', segments: ['rule-scope', 'clinics', ':clinicId'], handler: postRuleScopeAssign },
];

/** 도메인 거절은 응답으로 바꾸고, 서버 결함(바꾸지 못하는 오류)은 다시 던져 500 이 되게 한다. */
async function runHandler(run: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    const response = error instanceof DomainError ? responseFromDomainError(error) : null;
    if (response === null) {
      throw error;
    }
    return response;
  }
}

interface Route {
  method: string;
  /** 병원 id 를 뺀 나머지 경로. `:이름` 조각은 어떤 비어 있지 않은 값이든 잡아 handler 의 params 로 넘긴다. */
  tail: readonly string[];
  handler: Handler;
}

const CLINIC_ROUTES: readonly Route[] = [
  { method: 'GET', tail: ['treatments'], handler: getTreatments },
  { method: 'PUT', tail: ['catalog', 'draft'], handler: putDraft },
  { method: 'DELETE', tail: ['catalog', 'draft'], handler: deleteDraft },
  { method: 'POST', tail: ['catalog', 'preview'], handler: postPreview },
  { method: 'POST', tail: ['catalog', 'publish'], handler: postPublish },
  { method: 'GET', tail: ['catalog', 'versions'], handler: getVersions },
  { method: 'GET', tail: ['review-requests'], handler: getReviewRequests },
  { method: 'POST', tail: ['treatments', ':treatmentId', 'review-requests'], handler: postReviewRequest },
  { method: 'GET', tail: ['idle-policy'], handler: getIdlePolicy },
  { method: 'PUT', tail: ['idle-policy'], handler: putIdlePolicy },
];

async function authenticate(services: AdminServices, request: Request): Promise<AdminIdentity | null> {
  try {
    return normalizeIdentity(await services.authenticator.authenticate(request));
  } catch {
    // 인증기가 던지면 인증된 것으로 보지 않는다(실패는 닫힌 쪽으로).
    return null;
  }
}

/** 경로 조각이 모양과 맞으면 `:이름` 조각이 잡은 값을, 아니면 null 을 돌려준다. `:이름` 조각은 빈 값을 잡지 않는다. */
function matchTail(pattern: readonly string[], tail: readonly string[]): RouteParams | null {
  if (pattern.length !== tail.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (let index = 0; index < pattern.length; index += 1) {
    const part = pattern[index] as string;
    const actual = tail[index] as string;
    if (part.startsWith(':')) {
      if (actual === '') {
        return null;
      }
      params[part.slice(1)] = actual;
    } else if (part !== actual) {
      return null;
    }
  }
  return params;
}

// @MX:ANCHOR: [AUTO] 관리자 API 의 단일 처리점. src/app/api/admin 의 route 와 시험 앞단이 부른다.
// @MX:REASON: 인증(401) → 소속·역할(403) → 병원 존재(404) → 본문 순서와 "거절은 저장소를 쓰지 않는다"는 약속이 이 함수 하나에서 지켜진다. 순서가 바뀌면 인증 없는 요청이 병원의 존재를 알거나 저장 상태를 바꾼다.
/**
 * segments 는 `/api/admin/` 뒤의 경로 조각(디코딩된 값)이다. 던져진 것은 모두 500 INTERNAL_ERROR 로 바뀐다(공개 API 와 같은 방식, 로그에는 코드만).
 */
export function handleAdmin(services: AdminServices, request: Request, segments: readonly string[]): Promise<Response> {
  return guarded(services.api.log, async () => {
    const identity = await authenticate(services, request);
    if (identity === null) {
      return adminError('UNAUTHENTICATED');
    }
    if (segments.length === 1 && segments[0] === 'session') {
      return request.method === 'GET' ? ok({ userId: identity.userId, memberships: identity.memberships.map((m) => ({ clinicId: m.clinicId, role: m.role })) }) : adminError('METHOD_NOT_ALLOWED');
    }
    if (segments.length === 1 && segments[0] === 'review-queue') {
      if (request.method !== 'GET') {
        return adminError('METHOD_NOT_ALLOWED');
      }
      // 병원 경로가 없는 자원이라 병원 소속이 아니라 플랫폼 단위 RV 소속만 본다. 읽기만 한다.
      return actorForPlatformRole(identity, 'RV') === null ? adminError('FORBIDDEN') : ok({ queue: readReviewQueue(services.api.repo) });
    }
    // 플랫폼 단위 경로(RV 매핑 검토 · RV 묶음 구성 · PO 범위 지정): 병원 경로가 없으므로 병원 소속이 아니라 경로마다 정해진 역할의 플랫폼 단위 소속만 본다.
    // 경로 → 메서드(405) → 소속과 역할(403) → 본문(400) → 서비스 순서는 병원 경로와 같다.
    const platformMatches = PLATFORM_ROUTES.flatMap((route) => {
      const params = matchTail(route.segments, segments);
      return params === null ? [] : [{ route, params }];
    });
    if (platformMatches.length > 0) {
      const matched = platformMatches.find((candidate) => candidate.route.method === request.method);
      if (matched === undefined) {
        return adminError('METHOD_NOT_ALLOWED');
      }
      const platformActor = actorForPlatformRole(identity, matched.route.role);
      if (platformActor === null) {
        return adminError('FORBIDDEN');
      }
      return runHandler(() => matched.route.handler(services, request, platformActor, matched.params));
    }
    if (segments.length < 3 || segments[0] !== 'clinics') {
      return adminError('NOT_FOUND');
    }
    const clinicId = segments[1] as string;
    const tail = segments.slice(2);
    const matches = CLINIC_ROUTES.flatMap((route) => {
      const params = matchTail(route.tail, tail);
      return params === null ? [] : [{ route, params }];
    });
    if (matches.length === 0) {
      return adminError('NOT_FOUND');
    }
    const matched = matches.find((candidate) => candidate.route.method === request.method);
    if (matched === undefined) {
      return adminError('METHOD_NOT_ALLOWED');
    }
    const actor = actorForClinic(identity, clinicId, 'HA');
    if (actor === null) {
      return adminError('FORBIDDEN');
    }
    const clinic = services.api.repo.getClinic(clinicId);
    if (clinic === null) {
      return adminError('NOT_FOUND');
    }
    return runHandler(() => matched.route.handler(services, request, actor, clinic, matched.params));
  });
}
