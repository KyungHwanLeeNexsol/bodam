import type { CatalogDraft, CatalogVersion, CommonBaseFee, PriceEdit, TreatmentVersion } from './domain/entities';
import { DomainError } from './domain/errors';
import type { Repository } from './repo/interfaces';

// 초안 → 게시 요청 (SPEC-REIMBURSEMENT-001 M7 첫 기능). 게시(catalog-draft.ts)와 미리보기(admin/catalog-preview.ts)가 같은 변환을 쓴다.
// 가격이 바뀐 치료 버전은 원본의 모든 필드를 그대로 옮기고 id 와 patientAmount 만 바꾼다: 보장 판단 필드(치료 코드·행위 코드·분류·급여 구분)와 서류 표시·출처·금액 조건은 한 글자도 바뀌지 않는다(DD-16).

type RequestReads = Pick<Repository, 'getTreatmentVersion' | 'getCommonBaseFee'>;

/** 같은 치료 버전을 새 id 와 새 가격으로 만든 복사본. 입력을 바꾸지 않는다. */
export function versionWithPrice(version: TreatmentVersion, edit: PriceEdit, newId: string): TreatmentVersion {
  return { ...structuredClone(version), id: newId, patientAmount: edit.patientAmount };
}

/**
 * 병원의 현재 카탈로그가 담은 구성에 초안의 가격만 적용한 게시 요청. 가격이 바뀌는 치료만 새 버전(newVersionId 가 id 를 정한다)이고 나머지 치료 버전과 공통 기본비용은 기존 기록 그대로다
 * (저장소의 불변 쓰기는 같은 내용의 재기록을 멱등으로 받는다). 카탈로그가 담은 참조가 저장소에 없으면 NOT_FOUND 다.
 */
export function catalogRequestOf(
  repo: RequestReads,
  catalog: CatalogVersion,
  draft: CatalogDraft,
  newVersionId: (treatmentId: string) => string,
): { treatmentVersions: TreatmentVersion[]; commonBaseFees: CommonBaseFee[] } {
  const edits = new Map(draft.priceEdits.map((edit) => [edit.treatmentId, edit]));
  const treatmentVersions = catalog.treatmentVersionIds.map((id) => {
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
  return { treatmentVersions, commonBaseFees };
}
