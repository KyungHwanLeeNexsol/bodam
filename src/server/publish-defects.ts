// 게시 서비스(카탈로그·규칙 묶음)가 검증기와 별도로 정한 결함 코드. 검증기의 결함 코드(publish-validate.ts PUBLISH_DEFECT_CODES)와 합쳐
// 같은 PUBLISH_VALIDATION_FAILED 오류의 결함 목록에 `{ code, path }` 로 담긴다. 경로 규칙은 검증기와 같다
// (카탈로그는 `treatmentVersions[2].treatmentId`, 규칙 묶음은 `bundle.` 로 시작).
//
//   카탈로그 (소유 확인: 검증기는 병원 id 를 받지 않는다)
//     TREATMENT_ABSENT              치료 버전이 가리키는 치료가 저장소에 없다
//     TREATMENT_CLINIC_MISMATCH     치료 버전이 가리키는 치료가 이 병원의 것이 아니다
//     BASE_FEE_CLINIC_MISMATCH      공통 기본비용의 clinicId 가 이 병원이 아니다
//     BASE_FEE_ID_COLLIDES_WITH_TREATMENT  공통 기본비용의 baseFeeId 가 저장소의 치료 id 와 같다 (치료와 기본비용은 한 id 공간) [문서에 없음]
//     BASE_FEE_ID_CLINIC_MISMATCH   공통 기본비용의 baseFeeId 로 이미 다른 병원의 버전이 있다 [문서에 없음]
//   규칙 묶음 (검증기가 보지 않는 전제: 항목 상태·유효 기간·참조-내용 일치·매핑 고정 지문)
//     ITEM_REF_MISMATCH             해석된 항목의 id·version 이 참조와 다르다
//     ITEM_STATE_NOT_PUBLISHABLE    항목의 현재 상태가 APPROVED·PUBLISHED 가 아니다 (DD-17)
//     OUTSIDE_VALIDITY              유효 기간이 형식에 맞지 않거나 게시일에 이미 끝났다 [문서에 없음]
//     TREATMENT_VERSION_ABSENT      매핑의 대상(치료 또는 공통 기본비용)에 비교할 버전이 하나도 없다 (코드 이름은 기존 계약 그대로)
//     FINGERPRINT_STALE             매핑의 고정 지문이 대상의 현재 버전 지문과 다르다 (DD-15)
export const SERVICE_PUBLISH_DEFECT_CODES = [
  'TREATMENT_ABSENT',
  'TREATMENT_CLINIC_MISMATCH',
  'BASE_FEE_CLINIC_MISMATCH',
  'BASE_FEE_ID_COLLIDES_WITH_TREATMENT',
  'BASE_FEE_ID_CLINIC_MISMATCH',
  'ITEM_REF_MISMATCH',
  'ITEM_STATE_NOT_PUBLISHABLE',
  'OUTSIDE_VALIDITY',
  'TREATMENT_VERSION_ABSENT',
  'FINGERPRINT_STALE',
] as const;
export type ServicePublishDefectCode = (typeof SERVICE_PUBLISH_DEFECT_CODES)[number];
