import { readBundleRef } from '../api/bundle-ref';
import { calculate } from '../api/estimate';
import type { EstimateResponse } from '../api/estimate';
import { parseEstimateRequest } from '../api/estimate-request';
import type { EstimateRequest } from '../api/estimate-request';
import type { PublishedCatalog } from '../api/published-catalog';
import type { ApiServices } from '../api/services';
import { versionWithPrice } from '../catalog-draft-request';
import type { CatalogDraft, Clinic } from '../domain/entities';
import type { Defect } from '../domain/errors';
import { isPlainObject } from '../validate/shape';

// 초안 미리보기 (SPEC-REIMBURSEMENT-001 M7, design.md DD-19 `POST …/catalog/preview` "세로·가로 미리보기 계산(같은 엔진)").
// "게시하면 환자 계산이 어떻게 달라지는가"를 같은 계산 함수(api/estimate.ts 의 calculate)로 두 번 계산해 나란히 보인다:
//   before — 병원의 현재 게시 카탈로그, after — 같은 카탈로그에서 초안의 가격만 바꾼 가상의 카탈로그.
// 읽기만 한다: 저장소를 쓰지 않고 식별자도 만들지 않는다(가상 치료 버전의 id 는 `PREVIEW:<원본 id>` 이고 저장되지 않는다). 규칙 묶음·매핑·프로필은 병원의 현재 규칙 사용 범위 그대로 읽는다.

export const PREVIEW_FIELDS = ['generation', 'insurerType', 'cause', 'treatmentIds'] as const;

/** 초안의 가격만 바꾼 가상의 게시 카탈로그. 입력을 바꾸지 않는다. */
export function draftCatalogView(published: PublishedCatalog, draft: CatalogDraft): PublishedCatalog {
  const edits = new Map(draft.priceEdits.map((edit) => [edit.treatmentId, edit]));
  return {
    ...published,
    treatments: published.treatments.map(({ treatment, version }) => {
      const edit = edits.get(treatment.id);
      return { treatment, version: edit === undefined ? version : versionWithPrice(version, edit, `PREVIEW:${version.id}`) };
    }),
  };
}

export type PreviewParse = { ok: true; request: EstimateRequest } | { ok: false; defects: Defect[] };

/**
 * 미리보기 요청 본문 `{ generation, insurerType, cause, treatmentIds? }` 읽기. 다른 키는 UNKNOWN_FIELD 로 거절한다. treatmentIds 를 생략하면 초안이 바꾼 치료 전부다.
 * 값의 검사는 공개 계산 요청과 같은 함수(parseEstimateRequest)다: 형식·열거값 위반은 INVALID_REQUEST, 지원하지 않는 세대는 UNSUPPORTED_GENERATION, 빈 선택은 NO_TREATMENT_SELECTED 코드의 결함이다.
 * 게시 확인값은 미리보기가 성공해야 나가므로, 계산 대상에는 초안이 가격을 바꾼 치료가 **모두** 들어 있어야 한다. 명시한 treatmentIds 에 하나라도 빠지면
 * CHANGED_TREATMENT_NOT_INCLUDED 로 거절한다(변경 안 한 치료만 고른 경우도 같다). 정상적인 추가 선택(변경 치료 전부 + 다른 치료)은 허용한다.
 * 판단은 파싱을 마친 계산 요청(실제 계산에 쓰이는 값)에 대해 한다.
 */
export function parsePreviewRequest(body: unknown, draft: CatalogDraft): PreviewParse {
  if (!isPlainObject(body)) {
    return { ok: false, defects: [{ code: 'NOT_OBJECT', path: 'request' }] };
  }
  const unknown = Object.keys(body).filter((key) => !(PREVIEW_FIELDS as readonly string[]).includes(key));
  if (unknown.length > 0) {
    return { ok: false, defects: unknown.map((key) => ({ code: 'UNKNOWN_FIELD', path: `request.${key}` })) };
  }
  const parsed = parseEstimateRequest({
    catalogVersion: 'DRAFT',
    ruleBundleVersion: null,
    generation: body.generation,
    insurerType: body.insurerType,
    cause: body.cause,
    treatmentIds: body.treatmentIds === undefined ? draft.priceEdits.map((edit) => edit.treatmentId) : body.treatmentIds,
  });
  if (!parsed.ok) {
    return { ok: false, defects: [{ code: parsed.error, path: 'request' }] };
  }
  const calculated = new Set(parsed.request.treatmentIds);
  if (draft.priceEdits.some((edit) => !calculated.has(edit.treatmentId))) {
    return { ok: false, defects: [{ code: 'CHANGED_TREATMENT_NOT_INCLUDED', path: 'request.treatmentIds' }] };
  }
  return { ok: true, request: parsed.request };
}

export interface PriceChangeRow {
  treatmentId: string;
  displayName: string;
  before: number;
  after: number;
}

export interface PreviewResponse {
  basedOnCatalogVersion: string;
  request: { generation: string; insurerType: string; cause: string; treatmentIds: string[] };
  priceChanges: PriceChangeRow[];
  before: EstimateResponse;
  after: EstimateResponse;
}

/**
 * 두 번 계산한다. 선택한 치료 id 가 병원의 현재 게시 카탈로그에 없으면 null(호출한 쪽이 400 TREATMENT_NOT_IN_CATALOG 로 낸다). 서버 데이터 결함은 던져진다(500).
 */
export function buildPreview(api: ApiServices, clinic: Clinic, published: PublishedCatalog, draft: CatalogDraft, request: EstimateRequest): PreviewResponse | null {
  const catalog = published.catalog;
  if (catalog === null) {
    return null;
  }
  const publishedIds = new Set(published.treatments.map(({ treatment }) => treatment.id));
  if (request.treatmentIds.some((id) => !publishedIds.has(id))) {
    return null;
  }
  const bundleRef = readBundleRef(api.repo, clinic.id);
  const draftView = draftCatalogView(published, draft);
  const before = calculate(api, clinic, { ...request, catalogVersion: catalog.id }, published, bundleRef);
  const after = calculate(api, clinic, { ...request, catalogVersion: 'DRAFT' }, draftView, bundleRef);
  const nameOf = new Map(published.treatments.map(({ treatment, version }) => [treatment.id, version]));
  return {
    basedOnCatalogVersion: catalog.id,
    request: { generation: request.generation, insurerType: request.insurerType, cause: request.cause, treatmentIds: request.treatmentIds },
    priceChanges: draft.priceEdits.map((edit) => ({
      treatmentId: edit.treatmentId,
      displayName: nameOf.get(edit.treatmentId)?.displayName ?? edit.treatmentId,
      before: nameOf.get(edit.treatmentId)?.patientAmount ?? 0,
      after: edit.patientAmount,
    })),
    before,
    after,
  };
}
