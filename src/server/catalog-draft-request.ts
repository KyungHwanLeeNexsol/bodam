import type { Origin } from '../engine/types';
import type { CatalogDraft, CatalogVersion, CommonBaseFee, PriceEdit, TreatmentAddition, TreatmentVersion } from './domain/entities';
import { DomainError } from './domain/errors';
import type { Repository } from './repo/interfaces';

// 초안 → 게시 요청 (SPEC-REIMBURSEMENT-001 M7). 게시(catalog-draft.ts)와 미리보기(admin/catalog-preview.ts)가 같은 변환을 쓴다.
// 가격이 바뀐 치료 버전은 원본의 모든 필드를 그대로 옮기고 id 와 patientAmount 만 바꾼다: 보장 판단 필드(치료 코드·행위 코드·분류·급여 구분)와 서류 표시·출처·금액 조건은 한 글자도 바뀌지 않는다(DD-16).
// 새 치료의 치료 버전은 초안에 적은 표시 필드로 만들고 분류는 서버가 NEEDS_REVIEW 로 고정한다: 보장 판단은 사람이 매핑을 승인해야 생긴다.
// 숨긴 치료의 치료 버전은 카탈로그 스냅샷에 그대로 남는다(숨김은 치료 기록의 active 로 표현하고 카탈로그 버전은 불변이다).

type RequestReads = Pick<Repository, 'getTreatmentVersion' | 'getCommonBaseFee'>;

/** 같은 치료 버전을 새 id 와 새 가격으로 만든 복사본. 입력을 바꾸지 않는다. */
export function versionWithPrice(version: TreatmentVersion, edit: PriceEdit, newId: string): TreatmentVersion {
  return { ...structuredClone(version), id: newId, patientAmount: edit.patientAmount };
}

/**
 * 새 치료의 치료 버전. 요청이 정하지 못하는 값(분류 NEEDS_REVIEW, 출처, id)은 서버가 정한다. 입력을 바꾸지 않는다(배열·객체는 복사한다).
 * 게시 때는 실제 id 를, 게시 검증과 미리보기에서는 임시 id 를 넘긴다.
 */
export function treatmentVersionOfAddition(addition: TreatmentAddition, ids: { treatmentId: string; versionId: string }, origin: Origin): TreatmentVersion {
  return {
    id: ids.versionId,
    treatmentId: ids.treatmentId,
    displayName: addition.displayName,
    description: addition.description,
    benefitType: addition.benefitType,
    patientAmount: addition.patientAmount,
    amountCondition: { ...addition.amountCondition },
    treatmentCode: addition.treatmentCode,
    procedureCodes: [...addition.procedureCodes],
    calcClass: 'NEEDS_REVIEW',
    documentFlags: { ...addition.documentFlags },
    origin,
    effectiveDate: addition.effectiveDate,
  };
}

/**
 * 병원의 현재 카탈로그가 담은 구성에 초안의 가격만 적용한 게시 요청. 가격이 바뀌는 치료만 새 버전(newVersionId 가 id 를 정한다)이고 나머지 치료 버전과 공통 기본비용은 기존 기록 그대로다
 * (저장소의 불변 쓰기는 같은 내용의 재기록을 멱등으로 받는다). 숨긴 치료의 버전도 그대로 담긴다. newVersions 는 새 치료의 치료 버전이고 맨 뒤에 붙는다.
 * 카탈로그가 담은 참조가 저장소에 없으면 NOT_FOUND 다.
 */
export function catalogRequestOf(
  repo: RequestReads,
  catalog: CatalogVersion,
  draft: Pick<CatalogDraft, 'priceEdits'>,
  newVersionId: (treatmentId: string) => string,
  newVersions: readonly TreatmentVersion[] = [],
): { treatmentVersions: TreatmentVersion[]; commonBaseFees: CommonBaseFee[] } {
  const edits = new Map(draft.priceEdits.map((edit) => [edit.treatmentId, edit]));
  const existing = catalog.treatmentVersionIds.map((id) => {
    const version = repo.getTreatmentVersion(id);
    if (version === null) {
      throw new DomainError('NOT_FOUND', `치료 버전 '${id}' 이(가) 없다`);
    }
    const edit = edits.get(version.treatmentId);
    return edit === undefined ? version : versionWithPrice(version, edit, newVersionId(version.treatmentId));
  });
  const commonBaseFees = catalog.baseFeeIds.map((id) => {
    const fee = repo.getCommonBaseFee(id);
    if (fee === null) {
      throw new DomainError('NOT_FOUND', `공통 기본비용 '${id}' 이(가) 없다`);
    }
    return fee;
  });
  return { treatmentVersions: [...existing, ...newVersions], commonBaseFees };
}
