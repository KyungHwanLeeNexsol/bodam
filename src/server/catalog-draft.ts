import { isWon } from '../engine/numeric';
import { compareCodePoints } from '../engine/validate';
import { appendAudit } from './audit';
import { catalogRequestOf } from './catalog-draft-request';
import { publishCatalog } from './catalog-publish';
import type { ServiceDeps } from './deps';
import { canonicalDigest } from './digest';
import { requireRole } from './domain/actor';
import type { Actor } from './domain/actor';
import type { CatalogDraft, CatalogVersion, PriceEdit } from './domain/entities';
import { DomainError } from './domain/errors';
import type { Defect } from './domain/errors';
import { selectPublishedTreatments } from './published-treatments';
import { assertNoDefects, validateCatalogPublish } from './publish-validate';
import type { CatalogPublishConfig } from './publish-validate';
import { isNonEmptyString, isPlainObject } from './validate/shape';

// 카탈로그 초안: 치료 가격 수정 → 초안 저장 → (미리보기) → 게시 (SPEC-REIMBURSEMENT-001 M7 첫 기능, design.md DD-17 권한 표 "카탈로그 초안 저장·미리보기·게시" 행, 역할 HA).
//   saveCatalogDraft     — 현재 게시된 치료의 새 가격들을 초안으로 저장한다(덮어쓴다). 게시된 기록은 건드리지 않는다.
//   discardCatalogDraft  — 초안을 버린다.
//   publishCatalogDraft  — 초안으로 새 치료 버전(가격만 다름)을 만들어 기존 게시 서비스(publishCatalog)로 새 카탈로그 버전을 게시하고 초안을 지운다.
//
// 지키는 약속:
//  - 초안은 공개 가격에 영향을 주지 않는다: 저장·삭제는 초안 기록과 감사 기록만 쓰고 치료 버전·카탈로그 버전·병원의 현재 카탈로그는 읽기만 한다.
//  - 가격 수정은 보장 판단을 건드리지 않는다: 요청은 (치료 id, 새 가격)만 받고 다른 키는 거절한다. 게시는 가격만 바꾼 새 치료 버전을 만들고 보장 판단 필드(치료 코드·행위 코드·분류·급여 구분)는
//    원본 그대로 옮기므로 재검토 전환(triggerReReview)이 일어나지 않아 승인된 매핑·규칙 묶음·병원의 규칙 사용 범위는 바뀌지 않는다(DD-16).
//  - 게시는 기존 게시 서비스의 단일 경로를 지난다: 검증·소유 확인·변경 요약·감사 기록은 거기서 한다. 어느 단계든 던지면 저장소 전체가 호출 전과 같다(초안도 남는다).
//  - 낡은 초안은 게시하지 않는다: 초안이 근거한 카탈로그가 병원의 현재 카탈로그와 다르면 STATE_CONFLICT(DRAFT_STALE).
// 역할만 본다: 병원 소유·소속·인증은 관리자 API 경계(src/server/admin)가 서버에서 검증한 신원으로 하고 이 서비스에는 병원 id 와 행위자만 온다.

const PRICE_EDIT_KEYS: readonly string[] = ['treatmentId', 'patientAmount'];

function conflict(code: 'DRAFT_STALE' | 'DRAFT_ABSENT' | 'CATALOG_ABSENT', message: string): DomainError {
  return new DomainError('STATE_CONFLICT', message, [{ code, path: 'draft' }]);
}

/**
 * 가격 수정 요청 본문 `{ priceEdits: [{ treatmentId, patientAmount }] }` 의 형식 검사. 던지지 않는다.
 * 허용하는 키는 정확히 위 둘뿐이다: 급여 구분·행위 코드·분류·치료 이름·출처 같은 다른 키는 UNKNOWN_FIELD 로 거절한다(가격 수정은 보장 판단을 바꾸지 못한다).
 */
export function parsePriceEdits(request: unknown): { ok: true; edits: PriceEdit[] } | { ok: false; defects: Defect[] } {
  const defects: Defect[] = [];
  if (!isPlainObject(request)) {
    return { ok: false, defects: [{ code: 'NOT_OBJECT', path: 'request' }] };
  }
  for (const key of Object.keys(request)) {
    if (key !== 'priceEdits') {
      defects.push({ code: 'UNKNOWN_FIELD', path: `request.${key}` });
    }
  }
  const list = request.priceEdits;
  if (!Array.isArray(list)) {
    defects.push({ code: list === undefined ? 'VALUE_MISSING' : 'NOT_ARRAY', path: 'priceEdits' });
    return { ok: false, defects };
  }
  const edits: PriceEdit[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < list.length; index += 1) {
    const entry: unknown = list[index];
    const at = `priceEdits[${index}]`;
    if (!isPlainObject(entry)) {
      defects.push({ code: 'NOT_OBJECT', path: at });
      continue;
    }
    for (const key of Object.keys(entry)) {
      if (!PRICE_EDIT_KEYS.includes(key)) {
        defects.push({ code: 'UNKNOWN_FIELD', path: `${at}.${key}` });
      }
    }
    const { treatmentId, patientAmount } = entry;
    let valid = true;
    if (!isNonEmptyString(treatmentId)) {
      defects.push({ code: treatmentId === undefined ? 'VALUE_MISSING' : 'VALUE_INVALID', path: `${at}.treatmentId` });
      valid = false;
    }
    if (!isWon(patientAmount)) {
      defects.push({ code: patientAmount === undefined || patientAmount === null ? 'VALUE_MISSING' : 'VALUE_INVALID', path: `${at}.patientAmount` });
      valid = false;
    }
    if (valid) {
      if (seen.has(treatmentId as string)) {
        defects.push({ code: 'DUPLICATE_TREATMENT_ID', path: `${at}.treatmentId` });
      } else {
        seen.add(treatmentId as string);
        edits.push({ treatmentId: treatmentId as string, patientAmount: patientAmount as number });
      }
    }
  }
  return defects.length > 0 ? { ok: false, defects } : { ok: true, edits };
}

/** 병원의 현재 카탈로그(없으면 CATALOG_ABSENT)와 그 카탈로그에 든 활성 치료. 깨진 참조는 서버 데이터 결함이라 STATE_CONFLICT 로 낸다. */
function currentPublished(deps: ServiceDeps, clinicId: string): { catalog: CatalogVersion; treatments: ReturnType<typeof selectPublishedTreatments> } {
  const catalog = deps.repo.getClinicCurrentCatalogVersion(clinicId);
  if (catalog === null) {
    throw conflict('CATALOG_ABSENT', `병원 '${clinicId}' 은(는) 게시한 카탈로그가 없다`);
  }
  const treatments = selectPublishedTreatments(deps.repo, clinicId, catalog, (defect) => {
    throw new DomainError('STATE_CONFLICT', `현재 카탈로그의 참조가 저장소와 맞지 않는다 (${defect.code})`, [{ code: defect.code, path: 'catalog' }]);
  });
  return { catalog, treatments };
}

function requireClinic(deps: ServiceDeps, clinicId: string): void {
  if (deps.repo.getClinic(clinicId) === null) {
    throw new DomainError('NOT_FOUND', `병원 '${clinicId}' 이(가) 없다`);
  }
}

// @MX:ANCHOR: [AUTO] 카탈로그 초안 저장의 단일 진입점. 관리자 API 와 초안 시험이 부른다.
// @MX:REASON: 초안은 공개 가격과 분리되어야 한다. 저장이 치료 버전·카탈로그 버전·병원의 현재 카탈로그를 쓰는 길이 생기면 게시 전에 키오스크 가격이 바뀐다.
/**
 * HA 가 한 병원의 현재 게시 치료의 새 가격들을 초안으로 저장한다(병원마다 하나, 덮어쓴다). 현재 가격과 같은 항목은 변경이 아니므로 걸러 내고 하나도 남지 않으면 NO_PRICE_CHANGE 다.
 * 결함(형식·범위 `VALUE_INVALID`, 중복, 현재 카탈로그에 없는 치료 `TREATMENT_NOT_IN_CATALOG`, 가격 변경 없음)은 INVALID_INPUT 으로 던지고 저장소는 호출 전과 같다.
 * 다른 병원의 치료 id·없는 치료 id 는 같은 코드(TREATMENT_NOT_IN_CATALOG)로 거절해 다른 병원의 치료 존재를 드러내지 않는다.
 */
export function saveCatalogDraft(deps: ServiceDeps, actor: Actor, clinicId: string, request: unknown): CatalogDraft {
  requireRole(actor, 'HA');
  return deps.repo.transaction(() => {
    requireClinic(deps, clinicId);
    const { catalog, treatments } = currentPublished(deps, clinicId);
    const parsed = parsePriceEdits(request);
    if (!parsed.ok) {
      throw new DomainError('INVALID_INPUT', `가격 수정 요청이 형식을 어겼다 (결함 ${parsed.defects.length}건)`, parsed.defects);
    }
    const priceOf = new Map(treatments.map(({ treatment, version }) => [treatment.id, version.patientAmount]));
    const defects: Defect[] = [];
    parsed.edits.forEach((edit, index) => {
      if (!priceOf.has(edit.treatmentId)) {
        defects.push({ code: 'TREATMENT_NOT_IN_CATALOG', path: `priceEdits[${index}].treatmentId` });
      }
    });
    const changed = parsed.edits.filter((edit) => priceOf.has(edit.treatmentId) && priceOf.get(edit.treatmentId) !== edit.patientAmount);
    if (defects.length === 0 && changed.length === 0) {
      defects.push({ code: 'NO_PRICE_CHANGE', path: 'priceEdits' });
    }
    if (defects.length > 0) {
      throw new DomainError('INVALID_INPUT', `가격 수정 요청을 저장할 수 없다 (결함 ${defects.length}건)`, defects);
    }
    const draft: CatalogDraft = {
      clinicId,
      baseCatalogVersionId: catalog.id,
      priceEdits: changed.sort((a, b) => compareCodePoints(a.treatmentId, b.treatmentId)),
      updatedBy: { id: actor.id, role: actor.role },
      updatedAt: deps.clock.now(),
    };
    const before = deps.repo.getCatalogDraft(clinicId);
    deps.repo.saveCatalogDraft(draft);
    appendAudit(deps, actor, {
      action: 'CATALOG_DRAFT_SAVE',
      target: `CATALOG_DRAFT/${clinicId}`,
      beforeVersion: before === null ? null : canonicalDigest(before.priceEdits),
      afterVersion: canonicalDigest(draft.priceEdits),
      reason: null,
    });
    return draft;
  });
}

/** 초안을 버린다. 초안이 없으면 아무 일도 하지 않고 false 를 돌려준다(감사 기록도 없다). */
export function discardCatalogDraft(deps: ServiceDeps, actor: Actor, clinicId: string): boolean {
  requireRole(actor, 'HA');
  return deps.repo.transaction(() => {
    requireClinic(deps, clinicId);
    const draft = deps.repo.getCatalogDraft(clinicId);
    if (draft === null) {
      return false;
    }
    deps.repo.closeCatalogDraft(clinicId);
    appendAudit(deps, actor, { action: 'CATALOG_DRAFT_DISCARD', target: `CATALOG_DRAFT/${clinicId}`, beforeVersion: canonicalDigest(draft.priceEdits), afterVersion: null, reason: null });
    return true;
  });
}

// @MX:ANCHOR: [AUTO] 카탈로그 초안 게시의 단일 진입점. 관리자 API·초안 게시 시험·브라우저 시험의 서버가 부른다.
// @MX:REASON: 게시는 기존 publishCatalog 한 경로만 지나야 검증·소유 확인·재검토 판정·변경 요약·감사 기록이 어긋나지 않는다. 새 치료 버전은 가격만 다르고 보장 판단 필드는 원본 그대로여야 한다.
/**
 * 초안을 게시한다: 초안이 가리키는 가격만 바뀐 새 치료 버전들과 나머지는 그대로인 현재 카탈로그의 구성으로 publishCatalog 를 부르고, 성공하면 초안을 지운다.
 * 초안이 없으면 STATE_CONFLICT(DRAFT_ABSENT), 초안이 근거한 카탈로그가 현재 카탈로그와 다르면 STATE_CONFLICT(DRAFT_STALE). 게시 검증이 거절하면(PUBLISH_VALIDATION_FAILED 등)
 * 하나의 트랜잭션이 되돌려져 현재 카탈로그·치료 버전·초안·감사 기록 모두 호출 전과 같다. 새 치료 버전 id 는 검증이 끝난 뒤에야 만든다(거절이 생성기를 소비하지 않는다).
 */
export function publishCatalogDraft(deps: ServiceDeps, actor: Actor, clinicId: string, config: CatalogPublishConfig): CatalogVersion {
  requireRole(actor, 'HA');
  return deps.repo.transaction(() => {
    requireClinic(deps, clinicId);
    const draft = deps.repo.getCatalogDraft(clinicId);
    if (draft === null) {
      throw conflict('DRAFT_ABSENT', `병원 '${clinicId}' 의 초안이 없다`);
    }
    const { catalog } = currentPublished(deps, clinicId);
    if (catalog.id !== draft.baseCatalogVersionId) {
      throw conflict('DRAFT_STALE', `초안은 카탈로그 '${draft.baseCatalogVersionId}' 에 근거했지만 현재는 '${catalog.id}' 이다`);
    }
    // 1) 임시 id 로 먼저 검증한다(거절이 id 생성기를 쓰지 않게).
    assertNoDefects(validateCatalogPublish(catalogRequestOf(deps.repo, catalog, draft, (treatmentId) => `PROVISIONAL:${treatmentId}`), config));
    // 2) 통과하면 실제 id 로 만들어 기존 게시 서비스로 게시한다(거기서 검증·소유 확인·재검토 판정·감사 기록을 다시 한다).
    const published = publishCatalog(deps, actor, clinicId, catalogRequestOf(deps.repo, catalog, draft, () => deps.ids.next('TREATMENT_VERSION')), config);
    deps.repo.closeCatalogDraft(clinicId);
    appendAudit(deps, actor, { action: 'CATALOG_DRAFT_PUBLISH', target: `CATALOG/${published.id}`, beforeVersion: catalog.id, afterVersion: published.id, reason: `DRAFT_OF:${canonicalDigest(draft.priceEdits)}` });
    return published;
  });
}
