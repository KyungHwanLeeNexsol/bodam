import type { Origin } from '../engine/types';
import { compareCodePoints } from '../engine/validate';
import { treatmentVersionOfAddition } from './catalog-draft-request';
import type { ServiceDeps } from './deps';
import type { CatalogDraft, TreatmentAddition, TreatmentVersion } from './domain/entities';
import type { Defect } from './domain/errors';
import { sortForDisplay } from './published-treatments';
import type { PublishedTreatment } from './published-treatments';
import type { Repository } from './repo/interfaces';

// 카탈로그 초안의 구조 편집 (M7: 새 치료 추가 · 숨김 · 표시 순서). 초안을 현재 게시 치료와 맞춰 보는 검사(읽기)와 게시 때의 치료 기록 쓰기(치료 만들기·active 바꾸기·sortOrder 매기기)를 이 파일 한 곳에 둔다.
//
// 왜 따로 두는가: 초안 서비스(catalog-draft.ts)·요청 변환(catalog-draft-request.ts)·관리자 API(src/server/admin)는 치료 기록을 직접 쓰지 못하게 소스 검사로 막혀 있다
// (tests/boundary/admin-surface.test.ts 4번). 치료 기록(Treatment: id·병원·노출 순서·활성 여부)을 바꾸는 코드는 여기 하나뿐이고, 여기서도 치료 버전·카탈로그·병원·매핑은 쓰지 않는다.
// 치료 버전과 카탈로그 버전은 게시 서비스(catalog-publish.ts)만 쓴다.
//
// 지키는 약속:
//  - 검사 함수(structureDefects 등)는 읽기만 한다. 초안 저장은 이 파일의 쓰기 함수를 부르지 않는다: 저장은 공개 상태를 바꾸지 않는다.
//  - 새 치료의 분류는 서버가 NEEDS_REVIEW 로 고정한다(treatmentVersionOfAddition). 승인된 매핑·재검토 요청·항목 상태는 만들지 않는다 → 엔진이 그 줄을 보류시킨다.
//  - 표시 순서의 정의는 하나다(published-treatments.ts 의 sortForDisplay). "기본 순서" = 남는 기존 치료는 지금 표시 순서 그대로, 새 치료는 초안에 적은 순서대로 그 뒤.

type StructureReads = Pick<Repository, 'getTreatment' | 'listCommonBaseFeeVersions'>;

/** 초안에서 구조를 이루는 네 부분. CatalogDraft 의 부분집합이라 저장 전(요청을 읽은 직후)과 저장 후에 같은 함수를 쓴다. */
export type DraftParts = Pick<CatalogDraft, 'priceEdits' | 'additions' | 'deactivations' | 'order'>;

/** 현재 게시 치료를 표시 순서로 늘어놓은 복사본(입력은 바뀌지 않는다). */
export const inDisplayOrder = (published: readonly PublishedTreatment[]): PublishedTreatment[] => sortForDisplay([...published]);

/** 게시 뒤에 남는 기존 치료 id: 현재 표시 순서에서 숨김 대상을 뺀 것. */
export function survivingIds(published: readonly PublishedTreatment[], deactivations: readonly string[]): string[] {
  const hidden = new Set(deactivations);
  return inDisplayOrder(published)
    .map(({ treatment }) => treatment.id)
    .filter((id) => !hidden.has(id));
}

/** 기본 순서: 남는 기존 치료(현재 표시 순서) 뒤에 새 치료의 draftKey 를 초안에 적은 순서대로. */
export const defaultOrderOf = (published: readonly PublishedTreatment[], parts: Pick<DraftParts, 'additions' | 'deactivations'>): string[] => [
  ...survivingIds(published, parts.deactivations),
  ...parts.additions.map((addition) => addition.draftKey),
];

/** 게시 뒤의 표시 순서: 초안이 정한 순서, 없으면 기본 순서. */
export const finalOrderOf = (published: readonly PublishedTreatment[], parts: DraftParts): string[] => parts.order ?? defaultOrderOf(published, parts);

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((entry, index) => entry === b[index]);

/** 저장할 order: 기본 순서와 같으면 null 로 줄인다(같은 의미의 초안이 하나의 모양을 갖는다). */
export function canonicalOrder(published: readonly PublishedTreatment[], parts: DraftParts): string[] | null {
  return parts.order === null || sameList(parts.order, defaultOrderOf(published, parts)) ? null : [...parts.order];
}

/**
 * 초안을 병원의 현재 게시 치료(활성, P)와 맞춰 본 결함. 읽기만 한다. 순서는 가격 수정 → 숨김 → 새 치료 → 표시 순서다.
 *  - 가격 수정: P 에 없으면 TREATMENT_NOT_IN_CATALOG, 숨김 대상이면 PRICE_EDIT_ON_DEACTIVATED.
 *  - 숨김: P 에 없으면 TREATMENT_NOT_IN_CATALOG. 다른 병원 치료와 없는 치료는 같은 코드라 다른 병원의 존재를 드러내지 않는다.
 *  - 새 치료: draftKey 는 초안 안에서만 쓰는 이름표다(진짜 치료 id 는 게시 때 서버가 만든다). 그래서 같은 병원 안의 충돌만 본다 —
 *    이 병원의 치료 id(비활성 포함)나 이 병원의 공통 기본비용 안정 식별자와 겹치면 DRAFT_KEY_COLLIDES. 다른 병원의 치료·기본비용과 겹치는 것은 거절하지 않는다(거절하면 다른 병원의 존재가 드러난다).
 *  - 남는 치료: (P − 숨김) + 새 치료가 비어 있으면(모든 치료를 숨기고 새 치료도 없음) NO_TREATMENT_REMAINS(path deactivations). 새 치료를 하나라도 더하면 모두 숨겨도 된다.
 *  - 순서: F = (P − 숨김) + 새 치료의 draftKey 의 정확한 순열이어야 한다. F 에 없는 항목(숨긴 치료·다른 병원 치료 포함)은 ORDER_UNKNOWN_ENTRY, F 의 항목이 빠지면 ORDER_INCOMPLETE.
 *    항목 중복(DUPLICATE_ORDER_ENTRY)은 형식 검사(parseDraftRequest)가 이미 거른다. 직접 만든 초안을 넘기는 호출에 대비해 여기서도 한 번 더 본다.
 */
export function structureDefects(repo: StructureReads, clinicId: string, published: readonly PublishedTreatment[], parts: DraftParts): Defect[] {
  const defects: Defect[] = [];
  const publishedIds = new Set(published.map(({ treatment }) => treatment.id));
  const hidden = new Set(parts.deactivations);
  parts.priceEdits.forEach((edit, index) => {
    if (!publishedIds.has(edit.treatmentId)) {
      defects.push({ code: 'TREATMENT_NOT_IN_CATALOG', path: `priceEdits[${index}].treatmentId` });
    } else if (hidden.has(edit.treatmentId)) {
      defects.push({ code: 'PRICE_EDIT_ON_DEACTIVATED', path: `priceEdits[${index}].treatmentId` });
    }
  });
  parts.deactivations.forEach((id, index) => {
    if (!publishedIds.has(id)) {
      defects.push({ code: 'TREATMENT_NOT_IN_CATALOG', path: `deactivations[${index}]` });
    }
  });
  parts.additions.forEach((addition, index) => {
    const sameName = repo.getTreatment(addition.draftKey);
    if ((sameName !== null && sameName.clinicId === clinicId) || repo.listCommonBaseFeeVersions(addition.draftKey).some((fee) => fee.clinicId === clinicId)) {
      defects.push({ code: 'DRAFT_KEY_COLLIDES', path: `additions[${index}].draftKey` });
    }
  });
  // 게시 뒤에 남는 치료(숨기지 않은 기존 치료 + 새 치료)가 하나도 없으면 키오스크에 고를 치료가 없다. 저장 때와 게시 때 모두 여기서 막는다.
  if (defaultOrderOf(published, parts).length === 0) {
    defects.push({ code: 'NO_TREATMENT_REMAINS', path: 'deactivations' });
  }
  if (parts.order !== null) {
    const members = new Set(defaultOrderOf(published, parts));
    const seen = new Set<string>();
    parts.order.forEach((entry, index) => {
      if (seen.has(entry)) {
        defects.push({ code: 'DUPLICATE_ORDER_ENTRY', path: `order[${index}]` });
      } else if (!members.has(entry)) {
        defects.push({ code: 'ORDER_UNKNOWN_ENTRY', path: `order[${index}]` });
      }
      seen.add(entry);
    });
    if ([...members].some((member) => !seen.has(member))) {
      defects.push({ code: 'ORDER_INCOMPLETE', path: 'order' });
    }
  }
  return defects;
}

export interface StructureSummary {
  deactivatedTreatmentIds: string[];
  reorderedTreatmentIds: string[];
}

/**
 * 변경 요약에 싣는 구조 변경. 숨김은 코드 포인트 순. 순서 변경은 "남는 기존 치료끼리의 순위"가 달라진 치료만 센다
 * (새 치료가 끼어들거나 숨긴 치료가 빠져서 번호만 밀리는 것은 순서 변경이 아니다). 둘 다 코드 포인트 순이다.
 */
export function structureSummary(published: readonly PublishedTreatment[], parts: DraftParts): StructureSummary {
  const before = survivingIds(published, parts.deactivations);
  const survivors = new Set(before);
  const after = finalOrderOf(published, parts).filter((id) => survivors.has(id));
  const reordered = before.filter((id, index) => after[index] !== id);
  return {
    deactivatedTreatmentIds: [...parts.deactivations].sort(compareCodePoints),
    reorderedTreatmentIds: reordered.sort(compareCodePoints),
  };
}

// ───────────────────────── 쓰기 (게시 트랜잭션 안에서만 부른다) ─────────────────────────

/** 새 치료 한 건이 게시되려고 만든 치료 기록과 치료 버전. */
export interface CreatedAddition {
  draftKey: string;
  treatmentId: string;
  version: TreatmentVersion;
}

/**
 * 새 치료마다 치료 기록(활성)을 만들고 분류가 NEEDS_REVIEW 로 고정된 치료 버전을 준비한다(버전은 아직 저장하지 않는다 — 저장은 게시 서비스가 한다).
 * 치료 id 와 버전 id 는 주입한 생성기가 만든다. 생성기가 이미 있는 치료 id 를 내면(서버 무결성 결함) 다른 기록을 덮어쓰지 않고 던진다.
 * 처음 sortOrder 는 그 병원의 모든 치료(비활성 포함) 중 가장 큰 값 뒤에 초안에 적은 순서대로 붙인다. 표시 순서가 따로 정해졌으면 게시 뒤 applyOrder 가 다시 매긴다.
 * 호출한 쪽의 트랜잭션이 되돌려지면 만든 치료 기록도 함께 사라진다.
 */
export function createAdditions(deps: ServiceDeps, clinicId: string, additions: readonly TreatmentAddition[], origin: Origin): CreatedAddition[] {
  let sortOrder = deps.repo.listTreatments(clinicId).reduce((max, treatment) => Math.max(max, treatment.sortOrder), 0);
  return additions.map((addition) => {
    const treatmentId = deps.ids.next('TREATMENT');
    if (deps.repo.getTreatment(treatmentId) !== null) {
      throw new Error(`새 치료 id '${treatmentId}' 가 이미 저장소에 있다 (식별자 생성기 결함)`);
    }
    sortOrder += 1;
    deps.repo.saveTreatment({ id: treatmentId, clinicId, sortOrder, active: true });
    const versionId = deps.ids.next('TREATMENT_VERSION');
    return { draftKey: addition.draftKey, treatmentId, version: treatmentVersionOfAddition(addition, { treatmentId, versionId }, origin) };
  });
}

/** 숨김 대상 치료를 비활성으로 바꾼다(다른 필드는 그대로). 치료가 없으면 서버 데이터 결함이라 던진다. */
export function applyDeactivations(deps: ServiceDeps, treatmentIds: readonly string[]): void {
  for (const id of treatmentIds) {
    const treatment = deps.repo.getTreatment(id);
    if (treatment === null) {
      throw new Error(`숨길 치료 '${id}' 가 저장소에 없다`);
    }
    deps.repo.saveTreatment({ ...treatment, active: false });
  }
}

/**
 * 초안이 표시 순서를 정했을 때(order 가 있을 때) 게시 뒤의 목록 F 를 1..n 으로 다시 매긴다. 숫자가 실제로 달라지는 치료만 쓴다. 숨긴 치료는 건드리지 않는다.
 * order 가 null 이면 아무것도 하지 않는다: 기존 치료는 sortOrder 를 그대로 두고 새 치료는 createAdditions 가 맨 뒤 번호를 이미 주었다.
 * keyToId 는 새 치료의 draftKey → 실제 치료 id 이다.
 */
export function applyOrder(deps: ServiceDeps, order: readonly string[] | null, keyToId: ReadonlyMap<string, string>): void {
  if (order === null) {
    return;
  }
  order.forEach((entry, index) => {
    const id = keyToId.get(entry) ?? entry;
    const treatment = deps.repo.getTreatment(id);
    if (treatment === null) {
      throw new Error(`순서를 매길 치료 '${id}' 가 저장소에 없다`);
    }
    const sortOrder = index + 1;
    if (treatment.sortOrder !== sortOrder) {
      deps.repo.saveTreatment({ ...treatment, sortOrder });
    }
  });
}
