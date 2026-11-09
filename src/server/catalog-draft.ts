import type { Origin } from '../engine/types';
import { compareCodePoints } from '../engine/validate';
import { appendAudit } from './audit';
import { baseFeeEditDefects, changedBaseFeeEdits } from './catalog-base-fee';
import { parseDraftRequest } from './catalog-draft-parse';
import { catalogRequestOf, treatmentVersionOfAddition } from './catalog-draft-request';
import { publishCatalog } from './catalog-publish';
import { applyDeactivations, applyOrder, applyReactivations, canonicalOrder, createAdditions, defaultOrderOf, structureDefects, structureSummary } from './catalog-structure';
import type { ServiceDeps } from './deps';
import { requireRole } from './domain/actor';
import type { Actor } from './domain/actor';
import type { CatalogDraft, CatalogVersion, CommonBaseFee } from './domain/entities';
import { DomainError } from './domain/errors';
import type { Defect } from './domain/errors';
import { confirmsPublish, draftContentDigest } from './publish-confirmation';
import { selectPublishedBaseFees } from './published-base-fees';
import { selectHiddenTreatments, selectPublishedTreatments } from './published-treatments';
import { assertNoDefects, validateCatalogPublish } from './publish-validate';
import type { CatalogPublishConfig } from './publish-validate';

// 카탈로그 초안: 치료 가격 수정 · 공통 기본비용 금액 수정(금액만, baseFeeEdits) · 새 치료 추가 · 치료 숨김 · 숨긴 치료 다시 표시(reactivations) · 표시 순서 → 초안 저장 → (미리보기) → 게시 (SPEC-REIMBURSEMENT-001 M7, design.md DD-17 "카탈로그 초안 저장·미리보기·게시" 행, 역할 HA).
//   saveCatalogDraft     — 한 번의 요청이 원하는 초안 전체(가격 수정·새 치료·숨김·다시 표시·순서)를 병원의 초안으로 저장한다(덮어쓴다). 게시된 기록은 건드리지 않는다.
//   discardCatalogDraft  — 초안을 버린다.
//   publishCatalogDraft  — 초안을 한 트랜잭션으로 게시한다: 새 치료 기록 → 기존 게시 서비스(publishCatalog)로 새 카탈로그 버전 → 숨김 → 다시 표시 → 표시 순서 → 초안 닫기.
//
// 다시 표시(reactivations): 이 병원의 현재 카탈로그가 버전을 아직 담고 있는 비활성 치료를 활성으로 되돌린다. 새 치료로 복제하지 않는다(치료 id·치료 버전·가격·보장 판단 필드 그대로, 새 치료 기록·새 치료 버전 없음).
//   보장 승인도 분류 전환도 아니다: 매핑 상태·승인 지문·NEEDS_REVIEW 는 그대로이고 엔진이 보류시키는 줄은 계속 보류된다. 감사 기록은 기존 CATALOG_DRAFT_SAVE / CATALOG_DRAFT_PUBLISH 뿐이다(다시 표시 전용 동작이 없다).
//
// 지키는 약속:
//  - 초안은 공개 상태에 영향을 주지 않는다: 저장·삭제는 초안 기록과 감사 기록만 쓰고 치료 기록(active·sortOrder)·치료 버전·카탈로그 버전·병원의 현재 카탈로그는 읽기만 한다.
//    새 치료도 게시 전에는 치료 기록 한 줄 만들지 않는다. 치료 기록을 바꾸는 코드는 catalog-structure.ts 한 곳이고 저장 경로는 그 쓰기 함수를 부르지 않는다.
//  - 가격 수정은 보장 판단을 건드리지 않는다: 요청은 (치료 id, 새 가격)만 받고 다른 키는 거절한다. 게시는 가격만 바꾼 새 치료 버전을 만들고 보장 판단 필드(치료 코드·행위 코드·분류·급여 구분)는
//    원본 그대로 옮기므로 재검토 전환(triggerReReview)이 일어나지 않아 승인된 매핑·규칙 묶음·병원의 규칙 사용 범위는 바뀌지 않는다(DD-16).
//  - 새 치료는 보장 판단 없이 나간다: 분류는 서버가 NEEDS_REVIEW 로 고정하고(요청이 정할 수 없다) 승인된 매핑·재검토 요청·항목 상태를 만들지 않는다. 엔진이 그 줄을 보류시키므로 보험금은 나오지 않는다.
//  - 게시는 기존 게시 서비스의 단일 경로를 지난다: 검증·소유 확인·변경 요약·감사 기록은 거기서 한다. 어느 단계든 던지면 저장소 전체가 호출 전과 같다(새 치료 기록·숨김·순서·초안도 남는다).
//  - 낡은 초안은 게시하지 않는다: 초안이 근거한 카탈로그가 병원의 현재 카탈로그와 다르면 STATE_CONFLICT(DRAFT_STALE).
//  - 미리보기 없이 게시하지 않는다: 게시는 서버가 이 관리자에게 이 초안의 미리보기를 만들어 줄 때 발급한 게시 확인값(publish-confirmation.ts)을 받아야 하고,
//    맞는지는 게시 트랜잭션 안에서 아무것도 쓰기 전에 본다. 확인값은 초안 내용 전체(가격·새 치료·숨김·순서)에 묶인다. 맞지 않으면 STATE_CONFLICT(PREVIEW_REQUIRED)이고 저장소는 호출 전과 같다.
// 역할만 본다: 병원 소유·소속·인증은 관리자 API 경계(src/server/admin)가 서버에서 검증한 신원으로 하고 이 서비스에는 병원 id 와 행위자만 온다.

export { parsePriceEdits } from './catalog-draft-parse';

function conflict(code: 'DRAFT_STALE' | 'DRAFT_ABSENT' | 'CATALOG_ABSENT' | 'PREVIEW_REQUIRED', message: string): DomainError {
  return new DomainError('STATE_CONFLICT', message, [{ code, path: 'draft' }]);
}

/**
 * 병원의 현재 카탈로그(없으면 CATALOG_ABSENT)와 그 카탈로그에 든 활성 치료·숨긴 치료(버전이 카탈로그에 남은 비활성 치료)·공통 기본비용.
 * 깨진 참조는 서버 데이터 결함이라 STATE_CONFLICT 로 낸다.
 */
function currentPublished(
  deps: ServiceDeps,
  clinicId: string,
): { catalog: CatalogVersion; treatments: ReturnType<typeof selectPublishedTreatments>; hidden: ReturnType<typeof selectHiddenTreatments>; baseFees: CommonBaseFee[] } {
  const catalog = deps.repo.getClinicCurrentCatalogVersion(clinicId);
  if (catalog === null) {
    throw conflict('CATALOG_ABSENT', `병원 '${clinicId}' 은(는) 게시한 카탈로그가 없다`);
  }
  const integrity = (defect: { code: string }): never => {
    throw new DomainError('STATE_CONFLICT', `현재 카탈로그의 참조가 저장소와 맞지 않는다 (${defect.code})`, [{ code: defect.code, path: 'catalog' }]);
  };
  const treatments = selectPublishedTreatments(deps.repo, clinicId, catalog, integrity);
  const hidden = selectHiddenTreatments(deps.repo, clinicId, catalog, integrity);
  const baseFees = selectPublishedBaseFees(deps.repo, clinicId, catalog, integrity);
  return { catalog, treatments, hidden, baseFees };
}

function requireClinic(deps: ServiceDeps, clinicId: string): void {
  if (deps.repo.getClinic(clinicId) === null) {
    throw new DomainError('NOT_FOUND', `병원 '${clinicId}' 이(가) 없다`);
  }
}

// @MX:ANCHOR: [AUTO] 카탈로그 초안 저장의 단일 진입점. 관리자 API 와 초안 시험이 부른다.
// @MX:REASON: 초안은 공개 상태와 분리되어야 한다. 저장이 치료 기록·치료 버전·카탈로그 버전·병원의 현재 카탈로그를 쓰는 길이 생기면 게시 전에 키오스크 가격·목록·순서가 바뀐다.
/**
 * HA 가 한 병원의 초안을 저장한다(병원마다 하나, 덮어쓴다). 요청 본문은 `{ priceEdits?, additions?, deactivations?, order? }` 이고 한 번의 요청이 원하는 초안 전체다(catalog-draft-parse.ts).
 * 현재 가격과 같은 가격 수정은 변경이 아니므로 걸러 내고, 순서가 기본 순서와 같으면 order 는 null 로 저장한다.
 * 변경이 하나도 남지 않으면 거절한다: 본문이 priceEdits 키 하나뿐이면(이전 모양) NO_PRICE_CHANGE(path priceEdits), 그렇지 않으면 NO_DRAFT_CHANGE(path request).
 * 결함(형식·범위 `VALUE_INVALID`, 중복, 현재 카탈로그에 없는 치료 `TREATMENT_NOT_IN_CATALOG`, 숨긴 치료의 가격 수정, 순서 결함, draftKey 충돌)은 INVALID_INPUT 으로 던지고 저장소는 호출 전과 같다.
 * 다른 병원의 치료 id·없는 치료 id 는 같은 코드(TREATMENT_NOT_IN_CATALOG)로 거절해 다른 병원의 치료 존재를 드러내지 않는다.
 */
export function saveCatalogDraft(deps: ServiceDeps, actor: Actor, clinicId: string, request: unknown): CatalogDraft {
  requireRole(actor, 'HA');
  return deps.repo.transaction(() => {
    requireClinic(deps, clinicId);
    const { catalog, treatments, hidden, baseFees } = currentPublished(deps, clinicId);
    const parsed = parseDraftRequest(request);
    if (!parsed.ok) {
      throw new DomainError('INVALID_INPUT', `초안 요청이 형식을 어겼다 (결함 ${parsed.defects.length}건)`, parsed.defects);
    }
    const { priceEdits, baseFeeEdits, additions, deactivations, reactivations, order } = parsed.request;
    const parts = { priceEdits, additions, deactivations, reactivations, order };
    const defects: Defect[] = [...structureDefects(deps.repo, clinicId, treatments, parts, hidden), ...baseFeeEditDefects(baseFees, baseFeeEdits)];
    const priceOf = new Map(treatments.map(({ treatment, version }) => [treatment.id, version.patientAmount]));
    const changed = priceEdits.filter((edit) => priceOf.has(edit.treatmentId) && priceOf.get(edit.treatmentId) !== edit.patientAmount);
    const changedFees = changedBaseFeeEdits(baseFees, baseFeeEdits);
    const storedOrder = defects.length === 0 ? canonicalOrder(treatments, parts, hidden) : order;
    if (defects.length === 0 && changed.length === 0 && changedFees.length === 0 && additions.length === 0 && deactivations.length === 0 && reactivations.length === 0 && storedOrder === null) {
      defects.push(parsed.request.legacyPriceOnly ? { code: 'NO_PRICE_CHANGE', path: 'priceEdits' } : { code: 'NO_DRAFT_CHANGE', path: 'request' });
    }
    if (defects.length > 0) {
      throw new DomainError('INVALID_INPUT', `초안 요청을 저장할 수 없다 (결함 ${defects.length}건)`, defects);
    }
    // 검증이 끝난 뒤에야 만든다(거절이 생성기를 쓰지 않게). 저장할 때마다 새 값이라 내용이 같은 재저장도 이전 게시 확인값을 무효로 만든다.
    const draft: CatalogDraft = {
      clinicId,
      baseCatalogVersionId: catalog.id,
      revision: deps.ids.next('CATALOG_DRAFT_REVISION'),
      priceEdits: changed.sort((a, b) => compareCodePoints(a.treatmentId, b.treatmentId)),
      baseFeeEdits: changedFees,
      additions,
      deactivations: [...deactivations].sort(compareCodePoints),
      reactivations: [...reactivations].sort(compareCodePoints),
      order: storedOrder,
      updatedBy: { id: actor.id, role: actor.role },
      updatedAt: deps.clock.now(),
    };
    const before = deps.repo.getCatalogDraft(clinicId);
    deps.repo.saveCatalogDraft(draft);
    appendAudit(deps, actor, {
      action: 'CATALOG_DRAFT_SAVE',
      target: `CATALOG_DRAFT/${clinicId}`,
      beforeVersion: before === null ? null : draftContentDigest(before),
      afterVersion: draftContentDigest(draft),
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
    appendAudit(deps, actor, { action: 'CATALOG_DRAFT_DISCARD', target: `CATALOG_DRAFT/${clinicId}`, beforeVersion: draftContentDigest(draft), afterVersion: null, reason: null });
    return true;
  });
}

// @MX:ANCHOR: [AUTO] 카탈로그 초안 게시의 단일 진입점. 관리자 API·초안 게시 시험·브라우저 시험의 서버가 부른다.
// @MX:REASON: 게시는 기존 publishCatalog 한 경로만 지나야 검증·소유 확인·재검토 판정·변경 요약·감사 기록이 어긋나지 않는다. 새 치료 기록·숨김·순서는 같은 트랜잭션 안에서만 쓰여야
//   한 단계가 실패했을 때 반쯤 게시된 카탈로그(치료 기록만 생겼거나 숨김만 적용된 상태)가 남지 않는다. 새 치료 버전은 분류 NEEDS_REVIEW 로 고정돼 보험금이 나오지 않아야 한다.
/**
 * 초안을 게시한다: 새 치료의 치료 기록·치료 버전, 가격만 바뀐 새 치료 버전들, 나머지는 그대로인 현재 카탈로그의 구성으로 publishCatalog 를 부르고, 성공하면 숨김(active=false)과 표시 순서(sortOrder)를 적용하고 초안을 지운다.
 * confirmation 은 미리보기 응답이 준 게시 확인값이다(publish-confirmation.ts): 이 행위자에게 이 초안(저장 한 번, 내용 전체)의 미리보기를 만들어 줬을 때만 맞는다.
 * newTreatmentOrigin 은 새 치료의 치료 버전에 붙는 출처다. 운영 구성은 OPERATING 이라 기본값이고, 시험 구성이 시험 자료 출처를 넘긴다(그 출처를 게시 구성이 허용해야 게시된다).
 * 초안이 없으면 STATE_CONFLICT(DRAFT_ABSENT), 초안이 근거한 카탈로그가 현재 카탈로그와 다르면 STATE_CONFLICT(DRAFT_STALE), 확인값이 맞지 않으면 STATE_CONFLICT(PREVIEW_REQUIRED).
 * 이 세 가지와 초안 구조의 재확인(숨김·순서가 지금도 맞는가)은 게시 트랜잭션 안에서 아무것도 쓰기 전에 가려진다. 게시 검증이 거절하면(PUBLISH_VALIDATION_FAILED 등)
 * 하나의 트랜잭션이 되돌려져 현재 카탈로그·치료 기록·치료 버전·초안·감사 기록 모두 호출 전과 같다. 새 치료·치료 버전 id 는 검증이 끝난 뒤에야 만든다(거절이 생성기를 소비하지 않는다).
 */
export function publishCatalogDraft(
  deps: ServiceDeps,
  actor: Actor,
  clinicId: string,
  confirmation: string,
  config: CatalogPublishConfig,
  newTreatmentOrigin: Origin = 'OPERATING',
): CatalogVersion {
  requireRole(actor, 'HA');
  return deps.repo.transaction(() => {
    requireClinic(deps, clinicId);
    const draft = deps.repo.getCatalogDraft(clinicId);
    if (draft === null) {
      throw conflict('DRAFT_ABSENT', `병원 '${clinicId}' 의 초안이 없다`);
    }
    const { catalog, treatments, hidden, baseFees } = currentPublished(deps, clinicId);
    if (catalog.id !== draft.baseCatalogVersionId) {
      throw conflict('DRAFT_STALE', `초안은 카탈로그 '${draft.baseCatalogVersionId}' 에 근거했지만 현재는 '${catalog.id}' 이다`);
    }
    if (!confirmsPublish(draft, actor.id, confirmation)) {
      throw conflict('PREVIEW_REQUIRED', `병원 '${clinicId}' 의 현재 초안에 대해 이 행위자에게 발급된 미리보기 확인값이 아니다`);
    }
    // 방어: 초안을 저장한 뒤 치료 기록이 바뀌어(숨김 대상이 이미 비활성이거나, 다시 표시 대상이 이미 활성이거나 카탈로그에 없거나, 순서가 현재 목록과 맞지 않는 등) 구조가 어긋났으면 낡은 초안처럼 거절한다.
    // 다시 표시 대상을 지금의 저장소 상태로 다시 확인하는 자리가 여기다(게시 트랜잭션 안, 아무것도 쓰기 전). 아직 아무것도 쓰지 않았다.
    if (structureDefects(deps.repo, clinicId, treatments, draft, hidden).length > 0 || baseFeeEditDefects(baseFees, draft.baseFeeEdits).length > 0) {
      throw conflict('DRAFT_STALE', `병원 '${clinicId}' 의 초안이 현재 게시 치료·기본비용과 맞지 않는다`);
    }
    // 1) 임시 id 로 먼저 검증한다(거절이 id 생성기를 쓰지 않게). 새 치료의 출처가 게시 구성에 허용되지 않으면 여기서 ORIGIN_NOT_ACCEPTED 로 거절된다.
    const provisional = draft.additions.map((addition) => {
      const placeholder = `PROVISIONAL:${addition.draftKey}`;
      return treatmentVersionOfAddition(addition, { treatmentId: placeholder, versionId: placeholder }, newTreatmentOrigin);
    });
    assertNoDefects(
      validateCatalogPublish(catalogRequestOf(deps.repo, catalog, draft, (treatmentId) => `PROVISIONAL:${treatmentId}`, (baseFeeId) => `PROVISIONAL:BASE_FEE:${baseFeeId}`, provisional), config),
    );
    // 2) 통과하면 쓴다. 새 치료 기록 → 실제 id 로 만든 요청으로 기존 게시 서비스 호출(거기서 검증·소유 확인·재검토 판정·감사 기록을 다시 한다) → 숨김 → 표시 순서 → 초안 닫기.
    //    금액이 바뀐 기본비용은 같은 baseFeeId 의 새 버전 id 를 받는다(baseFeeId·보장 판단 필드는 그대로라 승인된 매핑과 지문이 유지된다).
    const created = createAdditions(deps, clinicId, draft.additions, newTreatmentOrigin);
    const request = catalogRequestOf(
      deps.repo,
      catalog,
      draft,
      () => deps.ids.next('TREATMENT_VERSION'),
      () => deps.ids.next('COMMON_BASE_FEE_VERSION'),
      created.map((entry) => entry.version),
    );
    const published = publishCatalog(deps, actor, clinicId, request, config, structureSummary(treatments, draft));
    applyDeactivations(deps, draft.deactivations);
    applyReactivations(deps, clinicId, draft.reactivations);
    // 표시 순서: 초안이 정했으면 그대로, 아니면 기본 순서. 다시 표시가 든 초안은 기본 순서도 명시적으로 매긴다 — 되살린 치료의 예전 번호가 남는 치료 사이에 끼어 있어서
    // 번호를 그대로 두면 "기존 표시 치료의 뒤" 라는 기본 위치가 지켜지지 않는다. 다시 표시가 없으면 기존 동작 그대로다(order 가 null 이면 아무것도 매기지 않는다).
    applyOrder(deps, draft.order ?? (draft.reactivations.length > 0 ? defaultOrderOf(treatments, draft, hidden) : null), new Map(created.map((entry) => [entry.draftKey, entry.treatmentId])));
    deps.repo.closeCatalogDraft(clinicId);
    appendAudit(deps, actor, { action: 'CATALOG_DRAFT_PUBLISH', target: `CATALOG/${published.id}`, beforeVersion: catalog.id, afterVersion: published.id, reason: `DRAFT_OF:${draftContentDigest(draft)}` });
    return published;
  });
}
