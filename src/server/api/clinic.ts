import type { Clinic } from '../domain/entities';
import type { Repository } from '../repo/interfaces';
import { errorResponse, jsonResponse } from './http';
import { guarded } from './integrity';
import type { ApiServices } from './services';

// 병원 찾기와 병원 단위 읽기 응답 (SPEC-REIMBURSEMENT-001 M4.A, design.md DD-19 "요청 검증의 층" 0층).
// slug 는 공개 위치 정보일 뿐 권한이 아니다. 이 파일은 slug 로 병원을 정하고, 없으면 404 CLINIC_NOT_FOUND 를 낸다.

// @MX:NOTE: [AUTO] [문서에 없음] 저장소 인터페이스에는 slug 조회가 없어서 병원 목록에서 정확히 같은 slug 를 찾는다(대소문자·공백 구분, 부분 일치 없음).
// 병원 수가 적은 메모리 구현에서는 충분하다. DB 어댑터가 정해지면 slug 색인 조회 메서드를 저장소 인터페이스에 더한다(기존 메서드의 뜻은 바꾸지 않는다).
/** slug 가 정확히 같은 병원. 없으면 null. */
export function findClinicBySlug(repo: Pick<Repository, 'listClinics'>, slug: string): Clinic | null {
  return repo.listClinics().find((clinic) => clinic.slug === slug) ?? null;
}

/**
 * 병원 단위 GET 응답: slug 로 병원을 정하고(없으면 404) build 가 만든 본문을 200 으로 낸다.
 * build 가 던진 것(서버 무결성 결함 포함)은 500 INTERNAL_ERROR 로 바뀐다. 응답은 항상 no-store 다.
 */
export function handleClinicRead(services: ApiServices, slug: string, build: (clinic: Clinic) => unknown): Promise<Response> {
  return guarded(services.log, () => {
    const clinic = findClinicBySlug(services.repo, slug);
    return clinic === null ? errorResponse('CLINIC_NOT_FOUND') : jsonResponse(200, build(clinic));
  });
}
