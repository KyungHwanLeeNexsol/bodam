// 서버 도메인 오류 (SPEC-REIMBURSEMENT-001 M3).
// 오류 방식은 하나로 고정한다: 도메인 거절은 DomainError 를 던진다. 서비스는 저장소 트랜잭션 안에서 돌고,
// 던져지면 그 트랜잭션의 모든 쓰기(감사 기록·묶음 상태 사건 포함)가 되돌려진다.
// HTTP 개념(상태 코드, INVALID_REQUEST)은 이 계층에 없다. 공개 경로의 변환은 M4, 관리자 경로의 변환은 M7이 한다.

/**
 * 지금까지 필요한 도메인 오류 코드. 닫힌 목록이며, 뒤 단계(생명주기·게시 검증·버전·준비 상태)가 코드를 더하는 것은
 * 허용하지만 이미 있는 코드의 뜻을 바꾸지는 않는다.
 *
 *  - IMMUTABLE_VERSION: 이미 쓴 불변 버전(항목·치료·카탈로그·규칙 묶음 등)을 다른 내용으로 다시 쓰려 했다.
 *  - NOT_FOUND: 쓰기가 가리키는 엔티티가 저장소에 없다.
 *  - DUPLICATE_KEY: 유일해야 하는 키(병원 slug, 감사 기록 id)가 이미 있다.
 *  - STATE_CONFLICT: 현재 상태와 맞지 않는 전이(항목 상태의 from 불일치, 묶음 상태 사슬 위반).
 *  - REF_CONTENT_MISMATCH: 참조(ref)가 내용의 id·버전과 다르거나, 다른 병원의 자료를 가리킨다.
 *  - ROLE_NOT_PERMITTED: 행위자의 역할이 이 동작의 역할 조건에 맞지 않는다(역할만 본다. 소유·인증은 M7).
 *
 * M3.B 가 더한 코드 (위 여섯 코드의 뜻은 그대로다):
 *  - SELF_APPROVAL_FORBIDDEN: 작성자 본인이 승인하려 했다 (소유자 결정 #31). 거절하면 아무것도 바뀌지 않는다.
 *  - REASON_REQUIRED: 사유가 필수인 동작(반려·항목 중지)에 비었거나 공백뿐인 사유가 왔다.
 *  - TREATMENT_VERSION_ABSENT: 매핑 승인이 지문을 고정할 치료 버전이 하나도 없다 (DD-15).
 *  - NOT_ITEM_AUTHOR: 작성자가 아닌 주체가 검토 제출을 하려 했다 (DD-17 "작성자의 검토 제출").
 *  - INVALID_INPUT: 서비스 입력이 형식을 어겼다(예: 빈 id·버전 라벨). 결함 목록에 필드 경로가 담긴다.
 */
export const DOMAIN_ERROR_CODES = [
  'IMMUTABLE_VERSION',
  'NOT_FOUND',
  'DUPLICATE_KEY',
  'STATE_CONFLICT',
  'REF_CONTENT_MISMATCH',
  'ROLE_NOT_PERMITTED',
  'SELF_APPROVAL_FORBIDDEN',
  'REASON_REQUIRED',
  'TREATMENT_VERSION_ABSENT',
  'NOT_ITEM_AUTHOR',
  'INVALID_INPUT',
] as const;
export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

/** 검증 실패의 결함 하나. path 는 `rules[3].reason` 또는 `bundle.profiles[2].groups[0].deduction.rate` 같은 필드 경로다. */
export interface Defect {
  code: string;
  path: string;
}

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly defects: readonly Defect[];

  constructor(code: DomainErrorCode, message: string, defects: readonly Defect[] = []) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    // 호출자 배열과 분리한다. 결함 객체도 복사해 나중에 호출자가 고쳐도 오류가 바뀌지 않게 한다.
    this.defects = defects.map((defect) => ({ code: defect.code, path: defect.path }));
  }
}
