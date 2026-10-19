import type { EngineRejectionCode } from '../../engine/types';
import { errorResponse } from './http';
import type { ServerLog } from './log';

// 서버 데이터 무결성 오류와 500 변환 (SPEC-REIMBURSEMENT-001 M4.A, design.md DD-19 오류 표 500 행).
// 두 종류를 분명히 나눈다.
//  - 요청 거절(404·400·422·409)은 값이다: 서비스가 결과 값으로 돌려주고 핸들러가 응답으로 바꾼다. 예외가 아니다.
//  - 서버 데이터 무결성 결함(저장소가 서로 맞지 않는 자료를 내는 경우, 엔진이 서버가 넘긴 입력을 거절한 경우)은 이 오류를 던진다.
//    환자 요청의 잘못이 아니므로 어떤 4xx 로도 내지 않고 HTTP 500 `{ "error": "INTERNAL_ERROR" }` 하나로 바뀐다. 결과 객체도 금액도 만들지 않는다.

/**
 * 무결성 결함의 닫힌 코드 목록. 뒤 단계가 코드를 더하는 것은 허용하지만 이미 있는 코드의 뜻을 바꾸지 않는다.
 *  - TREATMENT_VERSION_MISSING: 현재 카탈로그가 담은 치료 버전이 저장소에 없다.
 *  - TREATMENT_MISSING: 치료 버전이 가리키는 치료가 저장소에 없다.
 *  - TREATMENT_CLINIC_MISMATCH: 카탈로그가 담은 치료가 다른 병원의 것이다.
 *  - BASE_FEE_MISSING: 현재 카탈로그가 담은 공통 기본비용 버전이 저장소에 없다.
 *  - BASE_FEE_CLINIC_MISMATCH: 카탈로그가 담은 공통 기본비용이 다른 병원의 것이다.
 *  - BUNDLE_AVAILABILITY_MISSING: 병원의 규칙 사용 범위가 가리키는 묶음에 가용성 기록이 하나도 없다.
 *  - BUNDLE_MISSING: 규칙 사용 범위가 가리키는 묶음 기록이 저장소에 없다 (M4.B).
 *  - ITEM_CONTENT_MISSING: 묶음이 담은 항목 버전의 내용이 저장소에 없다 (M4.B).
 *  - ITEM_STATE_MISSING: 묶음이 담은 항목 버전의 상태 기록이 없다 (M4.B).
 *  - BUNDLE_STRUCTURE_INVALID: 읽어 온 ACTIVE 묶음의 profiles·mappings 가 배열이 아니거나 항목이 null 이 아닌 비배열 객체가 아니다 (M4.B, AC-006i).
 *  - ASSEMBLY_*: 엔진에 넘기기 전 줄 조립 검사에서 걸린 서버 책임 네 가지 (M4.B, design.md DD-03 입력 검증의 책임 분담 (a)~(d)).
 *      SELECTED_LINE_MISSING (a), UNSELECTED_LINE_PRESENT (b), LINE_IN_BOTH_ARRAYS (c), BASE_FEE_FLAG_MISMATCH (d).
 *  - ORIGIN_MAPPING_UNRESOLVED: 엔진이 판정을 끝낸 줄인데 출처 요약을 위해 같은 인자로 다시 부른 매핑 판정이 매핑을 정하지 못했다 (M4.B). 엔진 결과와 서버 입력이 어긋난 결함이다.
 *  - ENGINE_<거절 코드>: 엔진이 서버가 넘긴 입력을 거절했다 (M4.B). INVALID_NUMERIC_INPUT·INPUT_INTEGRITY_VIOLATION 은 저장된 자료의 결함이고,
 *    UNSUPPORTED_GENERATION·NO_TREATMENT_SELECTED 는 서버가 엔진 앞에서 먼저 걸렀어야 할 입력이라 이쪽으로 오면 서버 결함이다.
 */
export type ServerIntegrityCode =
  | 'TREATMENT_VERSION_MISSING'
  | 'TREATMENT_MISSING'
  | 'TREATMENT_CLINIC_MISMATCH'
  | 'BASE_FEE_MISSING'
  | 'BASE_FEE_CLINIC_MISMATCH'
  | 'BUNDLE_AVAILABILITY_MISSING'
  | 'BUNDLE_MISSING'
  | 'ITEM_CONTENT_MISSING'
  | 'ITEM_STATE_MISSING'
  | 'BUNDLE_STRUCTURE_INVALID'
  | 'ASSEMBLY_SELECTED_LINE_MISSING'
  | 'ASSEMBLY_UNSELECTED_LINE_PRESENT'
  | 'ASSEMBLY_LINE_IN_BOTH_ARRAYS'
  | 'ASSEMBLY_BASE_FEE_FLAG_MISMATCH'
  | 'ORIGIN_MAPPING_UNRESOLVED'
  | `ENGINE_${EngineRejectionCode}`;

export class ServerIntegrityError extends Error {
  readonly code: ServerIntegrityCode;

  /** 메시지에는 코드만 담는다: 오류가 어디로 새어도 id·금액이 따라 나가지 않게 한다. */
  constructor(code: ServerIntegrityCode) {
    super(`서버 데이터 무결성 결함: ${code}`);
    this.name = 'ServerIntegrityError';
    this.code = code;
  }
}

/**
 * 핸들러 본문을 실행하고, 던져진 것은 모두 500 `INTERNAL_ERROR` 로 바꾼다 (무결성 오류든 예기치 못한 오류든 본문은 같다).
 * 로그에는 사건 이름과 코드만 남긴다. 오류 메시지·스택·요청 내용은 남기지 않는다.
 */
export async function guarded(log: ServerLog, run: () => Response | Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ServerIntegrityError) {
      log.record({ event: 'SERVER_INTEGRITY_ERROR', code: error.code });
    } else {
      log.record({ event: 'UNEXPECTED_ERROR', code: 'UNEXPECTED' });
    }
    return errorResponse('INTERNAL_ERROR');
  }
}
