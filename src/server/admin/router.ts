import { priceConditionOf } from '../api/catalog';
import { guarded } from '../api/integrity';
import { readPublishedCatalog } from '../api/published-catalog';
import { discardCatalogDraft, publishCatalogDraft, saveCatalogDraft } from '../catalog-draft';
import { canonicalDigest } from '../digest';
import type { Actor } from '../domain/actor';
import type { CatalogDraft, Clinic } from '../domain/entities';
import { DomainError } from '../domain/errors';
import { isPlainObject } from '../validate/shape';
import { actorForClinic, normalizeIdentity } from './auth';
import type { AdminIdentity } from './auth';
import { buildPreview, parsePreviewRequest } from './catalog-preview';
import { adminError, invalidRequest, ok } from './http';
import type { AdminServices } from './services';

// 관리자 API 라우터 (SPEC-REIMBURSEMENT-001 M7 첫 기능: 치료 가격 수정 → 초안 저장 → 미리보기 → 게시, design.md DD-19 관리자 API (제안)).
//
//   GET    /api/admin/session                                   — 로그인한 신원(사용자 id·소속). 인증이 없으면 401.
//   GET    /api/admin/clinics/{clinicId}/treatments             — 현재 게시 치료·가격과 초안(있으면)
//   PUT    /api/admin/clinics/{clinicId}/catalog/draft          — 가격 수정을 초안으로 저장(덮어씀)
//   DELETE /api/admin/clinics/{clinicId}/catalog/draft          — 초안 버리기
//   POST   /api/admin/clinics/{clinicId}/catalog/preview        — 초안을 게시했을 때의 계산을 현재와 나란히(같은 엔진, 읽기만)
//   POST   /api/admin/clinics/{clinicId}/catalog/publish        — 미리보기에서 본 초안을 게시(draftDigest 가 맞아야 한다)
//   GET    /api/admin/clinics/{clinicId}/catalog/versions       — 게시 이력
//
// 처리 순서(앞선 거절이 이기고 응답 하나만 나간다): 인증(401) → 경로·메서드(404·405) → 병원 소속과 역할(403) → 병원 존재(404) → 본문 읽기(400) → 도메인 서비스.
// 인증·권한 거절은 저장소를 읽기 전에 나가므로 저장 상태가 그대로이고, 병원이 존재하는지도 알리지 않는다(소속이 없으면 없는 병원도 403).
// 신원·역할·병원은 AdminAuthenticator 가 검증한 값에서만 온다. 요청의 헤더·쿼리·본문에서는 읽지 않는다.
// 역할은 HA 만 허용한다(권한 표: 카탈로그 초안 저장·미리보기·게시·이력 조회는 HA 자기 병원). RV·PO 는 이 경로에서 403 이다.

type Handler = (services: AdminServices, request: Request, actor: Actor, clinic: Clinic) => Promise<Response> | Response;

const CONFLICT_REASONS: readonly string[] = ['DRAFT_STALE', 'DRAFT_ABSENT', 'CATALOG_ABSENT'];

/** 도메인 오류를 관리자 응답으로 바꾼다. 요청 쪽 거절만 바꾸고, 서버 데이터 결함은 null 이라 호출한 쪽이 다시 던져 500 이 된다. */
function responseFromDomainError(error: DomainError): Response | null {
  switch (error.code) {
    case 'INVALID_INPUT':
    case 'PUBLISH_VALIDATION_FAILED':
      return invalidRequest(error.defects);
    case 'STATE_CONFLICT': {
      const reason = error.defects[0]?.code;
      return reason !== undefined && CONFLICT_REASONS.includes(reason) ? adminError('CONFLICT', { reason }) : null;
    }
    case 'NOT_FOUND':
      return adminError('NOT_FOUND');
    case 'ROLE_NOT_PERMITTED':
      return adminError('FORBIDDEN');
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
  updatedAt: draft.updatedAt,
  updatedBy: draft.updatedBy.id,
  /** 미리보기·게시가 이 초안을 가리키는 값. 게시 요청이 이 값을 돌려줘야 한다(본 초안과 게시하는 초안이 같음을 보장). */
  draftDigest: canonicalDigest(draft.priceEdits),
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

const postPreview: Handler = async (services, request, _actor, clinic) => {
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
  const parsed = parsePreviewRequest(body.body, draft);
  if (!parsed.ok) {
    return invalidRequest(parsed.defects);
  }
  const preview = buildPreview(services.api, clinic, published, draft, parsed.request);
  if (preview === null) {
    return invalidRequest([{ code: 'TREATMENT_NOT_IN_CATALOG', path: 'request.treatmentIds' }]);
  }
  return ok({ ...preview, draftDigest: canonicalDigest(draft.priceEdits) });
};

const postPublish: Handler = async (services, request, actor, clinic) => {
  const body = await readJson(request);
  if (!body.ok) {
    return invalidRequest([{ code: 'NOT_JSON', path: 'request' }]);
  }
  if (!isPlainObject(body.body)) {
    return invalidRequest([{ code: 'NOT_OBJECT', path: 'request' }]);
  }
  const extra = Object.keys(body.body).filter((key) => key !== 'draftDigest');
  if (extra.length > 0 || typeof body.body.draftDigest !== 'string') {
    return invalidRequest([...extra.map((key) => ({ code: 'UNKNOWN_FIELD', path: `request.${key}` })), ...(typeof body.body.draftDigest === 'string' ? [] : [{ code: 'VALUE_MISSING', path: 'draftDigest' }])]);
  }
  const draft = services.api.repo.getCatalogDraft(clinic.id);
  if (draft === null) {
    return adminError('CONFLICT', { reason: 'DRAFT_ABSENT' });
  }
  // 환자에게 나갈 가격은 사람이 미리보기에서 본 초안이어야 한다: 그 사이 초안이 바뀌었으면 게시하지 않는다.
  if (canonicalDigest(draft.priceEdits) !== body.body.draftDigest) {
    return adminError('CONFLICT', { reason: 'DRAFT_CHANGED' });
  }
  const catalog = publishCatalogDraft(services.deps, actor, clinic.id, { acceptedLineOrigins: services.api.acceptedOrigins.lines });
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

interface Route {
  method: string;
  /** 병원 id 를 뺀 나머지 경로. */
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
];

async function authenticate(services: AdminServices, request: Request): Promise<AdminIdentity | null> {
  try {
    return normalizeIdentity(await services.authenticator.authenticate(request));
  } catch {
    // 인증기가 던지면 인증된 것으로 보지 않는다(실패는 닫힌 쪽으로).
    return null;
  }
}

const sameTail = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((part, index) => part === b[index]);

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
    if (segments.length < 3 || segments[0] !== 'clinics') {
      return adminError('NOT_FOUND');
    }
    const clinicId = segments[1] as string;
    const matches = CLINIC_ROUTES.filter((route) => sameTail(route.tail, segments.slice(2)));
    if (matches.length === 0) {
      return adminError('NOT_FOUND');
    }
    const route = matches.find((candidate) => candidate.method === request.method);
    if (route === undefined) {
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
    try {
      return await route.handler(services, request, actor, clinic);
    } catch (error) {
      const response = error instanceof DomainError ? responseFromDomainError(error) : null;
      if (response === null) {
        throw error;
      }
      return response;
    }
  });
}
