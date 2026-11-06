import type { HoldReasonCode, Origin } from '../../engine/types';
import { readBundleRef } from '../api/bundle-ref';
import { calculate } from '../api/estimate';
import type { EstimateResponse } from '../api/estimate';
import { parseEstimateRequest } from '../api/estimate-request';
import type { EstimateRequest } from '../api/estimate-request';
import type { PublishedCatalog } from '../api/published-catalog';
import type { ApiServices } from '../api/services';
import { baseFeeWithAmount, treatmentVersionOfAddition, versionWithPrice } from '../catalog-draft-request';
import { finalOrderOf, structureSummary } from '../catalog-structure';
import type { CatalogDraft, Clinic, TreatmentVersion } from '../domain/entities';
import type { Defect } from '../domain/errors';
import type { PublishedTreatment } from '../published-treatments';
import { isPlainObject } from '../validate/shape';

// 초안 미리보기 (SPEC-REIMBURSEMENT-001 M7, design.md DD-19 `POST …/catalog/preview` "세로·가로 미리보기 계산(같은 엔진)").
// "게시하면 환자 계산이 어떻게 달라지는가"를 같은 계산 함수(api/estimate.ts 의 calculate)로 두 번 계산해 나란히 보인다:
//   before — 병원의 현재 게시 카탈로그, after — 같은 카탈로그에서 초안을 적용한 가상의 카탈로그(가격 수정 · 숨김 제외 · 새 치료 추가 · 표시 순서).
// 가격 수정이 없는 초안(새 치료·숨김·순서만)은 계산할 치료가 없어 before·after 계산을 하지 않는다(null). 목록(beforeList·afterList)과 변경 목록(changes)은 늘 나간다.
// 공통 기본비용 금액 수정이 든 초안은 다르다: 계산 없는 목록 미리보기만으로 확인값을 내지 않는다. 계산할 치료를 하나 이상 골라야 하고(아니면 400 BASE_FEE_PREVIEW_NEEDS_TREATMENT),
// 등록된 기본비용은 기존 규칙대로 자동 포함되므로 같은 엔진이 현재 게시본(옛 금액)과 초안 적용본(새 금액)을 각각 계산한다.
// 읽기만 한다: 저장소를 쓰지 않고 식별자도 만들지 않는다(가상 치료 버전의 id 는 `PREVIEW:<원본 id>`, 새 치료는 `PREVIEW:NEW:<draftKey>` 이고 저장되지 않는다).
// 규칙 묶음·매핑·프로필은 병원의 현재 규칙 사용 범위 그대로 읽는다.
// 숨길 치료는 계산에 억지로 넣지 않는다(계산 대상으로 고르면 거절): 숨긴 뒤에는 환자가 고를 수 없는 치료다. 변경 목록에서 "숨김"으로 보인다.

export const PREVIEW_FIELDS = ['generation', 'insurerType', 'cause', 'treatmentIds'] as const;

/** 가상의 "게시 뒤" 카탈로그에서 새 치료의 치료 id 접두어. 저장된 치료 id 가 아니다. */
const NEW_PREFIX = 'PREVIEW:NEW:';
const newTreatmentId = (draftKey: string): string => `${NEW_PREFIX}${draftKey}`;

/**
 * 초안을 적용한 가상의 게시 카탈로그. 가격 수정을 적용하고, 숨길 치료를 빼고, 새 치료를 끝에 붙인 뒤 초안의 표시 순서(없으면 기본 순서)로 늘어놓는다. 입력을 바꾸지 않는다.
 * 새 치료는 `PREVIEW:NEW:<draftKey>` 치료와 분류 NEEDS_REVIEW 치료 버전이다(출처는 서버가 정한 newTreatmentOrigin). 어떤 기록도 만들지 않고 식별자 생성기도 쓰지 않는다.
 * published.treatments 는 현재 표시 순서여야 한다(readPublishedCatalog 가 그렇게 준다).
 */
export function draftCatalogView(published: PublishedCatalog, draft: CatalogDraft, newTreatmentOrigin: Origin): PublishedCatalog {
  const edits = new Map(draft.priceEdits.map((edit) => [edit.treatmentId, edit]));
  const entries = new Map<string, PublishedTreatment>();
  for (const { treatment, version } of published.treatments) {
    if (!draft.deactivations.includes(treatment.id)) {
      const edit = edits.get(treatment.id);
      entries.set(treatment.id, { treatment, version: edit === undefined ? version : versionWithPrice(version, edit, `PREVIEW:${version.id}`) });
    }
  }
  for (const addition of draft.additions) {
    const id = newTreatmentId(addition.draftKey);
    entries.set(addition.draftKey, {
      treatment: { id, clinicId: draft.clinicId, sortOrder: 0, active: true },
      version: treatmentVersionOfAddition(addition, { treatmentId: id, versionId: id }, newTreatmentOrigin),
    });
  }
  const treatments = finalOrderOf(published.treatments, draft).map((key, index) => {
    const entry = entries.get(key) as PublishedTreatment;
    return { treatment: { ...entry.treatment, sortOrder: index + 1 }, version: entry.version };
  });
  // 금액이 바뀌는 공통 기본비용은 가상의 새 버전(`PREVIEW:<원본 버전 id>`, 저장되지 않는다)이고 나머지는 현재 게시본 그대로다. 보장 판단 필드는 한 글자도 바뀌지 않는다.
  const feeEdits = new Map(draft.baseFeeEdits.map((edit) => [edit.baseFeeId, edit]));
  const baseFees = published.baseFees.map((fee) => {
    const edit = feeEdits.get(fee.baseFeeId);
    return edit === undefined ? fee : baseFeeWithAmount(fee, edit, `PREVIEW:${fee.id}`);
  });
  return { ...published, treatments, baseFees };
}

export type PreviewParse = { ok: true; request: EstimateRequest } | { ok: false; defects: Defect[] };

/**
 * 미리보기 요청 본문 `{ generation, insurerType, cause, treatmentIds? }` 읽기. 다른 키는 UNKNOWN_FIELD 로 거절한다. treatmentIds 를 생략하면 초안이 가격을 바꾼 치료 전부다.
 * 값의 검사는 공개 계산 요청과 같은 함수(parseEstimateRequest)다: 형식·열거값 위반은 INVALID_REQUEST, 지원하지 않는 세대는 UNSUPPORTED_GENERATION, 빈 선택은 NO_TREATMENT_SELECTED 코드의 결함이다.
 * 초안에 가격 수정이 없고 treatmentIds 도 생략하면 계산할 치료가 없다: 나머지 필드(세대·보험사 유형·원인)만 검사하고 treatmentIds 는 빈 목록이 된다(buildPreview 가 계산을 건너뛴다).
 * 숨길 치료를 고르면 TREATMENT_DEACTIVATED_IN_DRAFT(path request.treatmentIds)로 거절한다.
 * 게시 확인값은 미리보기가 성공해야 나가므로, 계산 대상에는 초안이 가격을 바꾼 치료가 **모두** 들어 있어야 한다. 명시한 treatmentIds 에 하나라도 빠지면
 * CHANGED_TREATMENT_NOT_INCLUDED 로 거절한다(변경 안 한 치료만 고른 경우도 같다). 정상적인 추가 선택(변경 치료 전부 + 다른 치료)은 허용한다.
 * 초안에 공통 기본비용 금액 수정이 있으면 계산할 치료가 하나 이상 있어야 한다: 없으면 BASE_FEE_PREVIEW_NEEDS_TREATMENT(path request.treatmentIds)로 거절한다
 * (기본비용만 바꾼 초안은 변경 치료가 없어 treatmentIds 를 생략할 수 있지만, 그때도 계산 없이 확인값이 나가지 않는다).
 * 두 거절이 겹치면 둘 다 알린다(숨김 거절이 먼저). 판단은 파싱을 마친 계산 요청(실제 계산에 쓰이는 값)에 대해 한다.
 */
export function parsePreviewRequest(body: unknown, draft: CatalogDraft): PreviewParse {
  if (!isPlainObject(body)) {
    return { ok: false, defects: [{ code: 'NOT_OBJECT', path: 'request' }] };
  }
  const unknown = Object.keys(body).filter((key) => !(PREVIEW_FIELDS as readonly string[]).includes(key));
  if (unknown.length > 0) {
    return { ok: false, defects: unknown.map((key) => ({ code: 'UNKNOWN_FIELD', path: `request.${key}` })) };
  }
  const changedIds = draft.priceEdits.map((edit) => edit.treatmentId);
  const nothingToCalculate = body.treatmentIds === undefined && changedIds.length === 0;
  const parsed = parseEstimateRequest({
    catalogVersion: 'DRAFT',
    ruleBundleVersion: null,
    generation: body.generation,
    insurerType: body.insurerType,
    cause: body.cause,
    // 계산할 치료가 없을 때는 나머지 필드를 검사하려고 자리 표시 값을 넣고, 통과하면 아래에서 빈 목록으로 바꾼다.
    treatmentIds: nothingToCalculate ? ['PREVIEW:NO_SELECTION'] : body.treatmentIds === undefined ? changedIds : body.treatmentIds,
  });
  if (!parsed.ok) {
    return { ok: false, defects: [{ code: parsed.error, path: 'request' }] };
  }
  const request: EstimateRequest = nothingToCalculate ? { ...parsed.request, treatmentIds: [] } : parsed.request;
  const defects: Defect[] = request.treatmentIds.filter((id) => draft.deactivations.includes(id)).map(() => ({ code: 'TREATMENT_DEACTIVATED_IN_DRAFT', path: 'request.treatmentIds' }));
  const calculated = new Set(request.treatmentIds);
  if (draft.priceEdits.some((edit) => !calculated.has(edit.treatmentId))) {
    defects.push({ code: 'CHANGED_TREATMENT_NOT_INCLUDED', path: 'request.treatmentIds' });
  }
  if (draft.baseFeeEdits.length > 0 && request.treatmentIds.length === 0) {
    defects.push({ code: 'BASE_FEE_PREVIEW_NEEDS_TREATMENT', path: 'request.treatmentIds' });
  }
  return defects.length > 0 ? { ok: false, defects } : { ok: true, request };
}

export interface PriceChangeRow {
  treatmentId: string;
  displayName: string;
  before: number;
  after: number;
}

/** 공통 기본비용 한 건의 금액 변경. baseFeeId 는 안정 식별자다. */
export interface BaseFeeChangeRow {
  baseFeeId: string;
  displayName: string;
  before: number;
  after: number;
}

/** 목록 한 줄. 새 치료는 아직 치료 id 가 없어 treatmentId 가 null 이고 key 는 `NEW:<draftKey>` 이다(기존 치료의 key 는 치료 id). position 은 1부터. */
export interface PreviewListRow {
  key: string;
  treatmentId: string | null;
  displayName: string;
  patientAmount: number;
  position: number;
  isNew: boolean;
}

/**
 * 새 치료를 같은 엔진으로 계산해 본 결과. 엔진이 말한 상태와 보류 사유를 그대로 옮긴다. 보험금·본인부담 같은 금액은 싣지 않는다.
 * 새 치료는 분류가 NEEDS_REVIEW 로 고정이라 보류(ON_HOLD)가 기대값이지만, 엔진이 다르게 말하면 그대로 알린다.
 */
export interface AddedTreatmentCalculation {
  /** 이 치료 하나(+ 공통 기본비용)를 고른 계산의 전체 상태. */
  state: string;
  /** 새 치료 줄 자체의 상태. */
  lineState: string;
  holdReasons: HoldReasonCode[];
}

export interface PreviewResponse {
  basedOnCatalogVersion: string;
  request: { generation: string; insurerType: string; cause: string; treatmentIds: string[] };
  priceChanges: PriceChangeRow[];
  /** 가격 수정이 없고 treatmentIds 도 없으면(계산할 치료가 없으면) null. */
  before: EstimateResponse | null;
  after: EstimateResponse | null;
  beforeList: PreviewListRow[];
  afterList: PreviewListRow[];
  changes: {
    priceChanges: PriceChangeRow[];
    /** 금액이 바뀌는 공통 기본비용(baseFeeId 의 코드 포인트 순). 기본비용을 건드리지 않은 초안은 빈 목록이다. */
    baseFeeChanges: BaseFeeChangeRow[];
    added: Array<{ draftKey: string; displayName: string; patientAmount: number; benefitType: string; calculation: AddedTreatmentCalculation }>;
    deactivated: Array<{ treatmentId: string; displayName: string }>;
    /** before·after 는 beforeList·afterList 에서의 1부터 시작하는 위치. */
    reordered: Array<{ treatmentId: string; displayName: string; before: number; after: number }>;
  };
}

function listRowsOf(treatments: ReadonlyArray<{ treatment: { id: string }; version: TreatmentVersion }>): PreviewListRow[] {
  return treatments.map(({ treatment, version }, index) => {
    const isNew = treatment.id.startsWith(NEW_PREFIX);
    return {
      key: isNew ? `NEW:${treatment.id.slice(NEW_PREFIX.length)}` : treatment.id,
      treatmentId: isNew ? null : treatment.id,
      displayName: version.displayName,
      patientAmount: version.patientAmount,
      position: index + 1,
      isNew,
    };
  });
}

/**
 * 계산하고 목록·변경 목록을 만든다. 선택한 치료 id 가 병원의 현재 게시 카탈로그에 없으면 null(호출한 쪽이 400 TREATMENT_NOT_IN_CATALOG 로 낸다). 서버 데이터 결함은 던져진다(500).
 * 선택한 치료가 있으면 같은 엔진으로 두 번(현재 카탈로그, 초안 적용 카탈로그) 계산한다. 새 치료마다 초안 적용 카탈로그에서 그 치료만 골라 한 번씩 더 계산한다.
 */
export function buildPreview(api: ApiServices, clinic: Clinic, published: PublishedCatalog, draft: CatalogDraft, request: EstimateRequest, newTreatmentOrigin: Origin): PreviewResponse | null {
  const catalog = published.catalog;
  if (catalog === null) {
    return null;
  }
  const publishedIds = new Set(published.treatments.map(({ treatment }) => treatment.id));
  if (request.treatmentIds.some((id) => !publishedIds.has(id))) {
    return null;
  }
  const bundleRef = readBundleRef(api.repo, clinic.id);
  const draftView = draftCatalogView(published, draft, newTreatmentOrigin);
  const calculates = request.treatmentIds.length > 0;
  const before = calculates ? calculate(api, clinic, { ...request, catalogVersion: catalog.id }, published, bundleRef) : null;
  const after = calculates ? calculate(api, clinic, { ...request, catalogVersion: 'DRAFT' }, draftView, bundleRef) : null;

  const versionOf = new Map(published.treatments.map(({ treatment, version }) => [treatment.id, version]));
  const priceChanges: PriceChangeRow[] = draft.priceEdits.map((edit) => ({
    treatmentId: edit.treatmentId,
    displayName: versionOf.get(edit.treatmentId)?.displayName ?? edit.treatmentId,
    before: versionOf.get(edit.treatmentId)?.patientAmount ?? 0,
    after: edit.patientAmount,
  }));
  const feeOf = new Map(published.baseFees.map((fee) => [fee.baseFeeId, fee]));
  const baseFeeChanges: BaseFeeChangeRow[] = draft.baseFeeEdits.map((edit) => ({
    baseFeeId: edit.baseFeeId,
    displayName: feeOf.get(edit.baseFeeId)?.displayName ?? edit.baseFeeId,
    before: feeOf.get(edit.baseFeeId)?.amount ?? 0,
    after: edit.amount,
  }));
  const beforeList = listRowsOf(published.treatments);
  const afterList = listRowsOf(draftView.treatments);
  const positionIn = (rows: readonly PreviewListRow[], id: string): number => (rows.find((row) => row.treatmentId === id) as PreviewListRow).position;
  const summary = structureSummary(published.treatments, draft);

  const added = draft.additions.map((addition) => {
    const id = newTreatmentId(addition.draftKey);
    const outcome = calculate(api, clinic, { ...request, catalogVersion: 'DRAFT', treatmentIds: [id] }, draftView, bundleRef);
    const line = outcome.result.lines.find((candidate) => candidate.treatmentId === id);
    return {
      draftKey: addition.draftKey,
      displayName: addition.displayName,
      patientAmount: addition.patientAmount,
      benefitType: addition.benefitType,
      calculation: {
        state: outcome.result.state,
        lineState: line === undefined ? 'MISSING' : line.state,
        holdReasons: outcome.result.holdReasons.filter((reason) => reason.treatmentId === id).map((reason) => reason.code),
      },
    };
  });

  return {
    basedOnCatalogVersion: catalog.id,
    request: { generation: request.generation, insurerType: request.insurerType, cause: request.cause, treatmentIds: request.treatmentIds },
    priceChanges,
    before,
    after,
    beforeList,
    afterList,
    changes: {
      priceChanges,
      baseFeeChanges,
      added,
      deactivated: summary.deactivatedTreatmentIds.map((id) => ({ treatmentId: id, displayName: versionOf.get(id)?.displayName ?? id })),
      reordered: summary.reorderedTreatmentIds.map((id) => ({
        treatmentId: id,
        displayName: versionOf.get(id)?.displayName ?? id,
        before: positionIn(beforeList, id),
        after: positionIn(afterList, id),
      })),
    },
  };
}
