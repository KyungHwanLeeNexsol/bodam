import type { CauseCode, GenerationCode, InsurerTypeCode } from './api-types';
import type { Orientation } from './display';

// 키오스크 상태 기계의 사건 (SPEC-REIMBURSEMENT-001 M5.A, design.md DD-07 전이표의 "사건" 열).
// 사건은 환자의 조작(PATIENT)이거나 시스템이 알리는 일(SYSTEM)이다. 분류는 machine.ts 의 EVENT_SPECS 가 사건 종류마다 하나씩 적는다.
// M5.B·C 는 계산 요청·자료 갱신의 결말 사건을 이 합집합에 더하고, 같은 표에 SYSTEM 으로 분류한다(서버 응답은 무조작 시간을 다시 세지 않는다, DD-10).

export type KioskEvent =
  // 시작과 입력 단계
  | { readonly type: 'START' }
  | { readonly type: 'SELECT_GENERATION'; readonly code: GenerationCode }
  | { readonly type: 'SELECT_INSURER_TYPE'; readonly code: InsurerTypeCode }
  | { readonly type: 'SELECT_CAUSE'; readonly code: CauseCode }
  | { readonly type: 'TOGGLE_TREATMENT'; readonly treatmentId: string }
  | { readonly type: 'NEXT' }
  | { readonly type: 'PREV' }
  | { readonly type: 'TREATMENTS_NEXT_PAGE' }
  | { readonly type: 'TREATMENTS_PREV_PAGE' }
  | { readonly type: 'OPEN_GENERATION_HELP' }
  | { readonly type: 'CLOSE_GENERATION_HELP' }
  // 결과·근거·서류
  | { readonly type: 'OPEN_DOCUMENTS' }
  | { readonly type: 'OPEN_BASIS' }
  | { readonly type: 'RETURN_TO_RESULT' }
  | { readonly type: 'RESELECT_TREATMENTS' }
  | { readonly type: 'EDIT_INSURANCE' }
  // 처음으로·겹침창·이용 완료
  | { readonly type: 'REQUEST_HOME' }
  | { readonly type: 'CONFIRM_RESET' }
  | { readonly type: 'CANCEL_RESET' }
  | { readonly type: 'CONTINUE_USING' }
  | { readonly type: 'COMPLETE_USE' }
  | { readonly type: 'BACK_TO_START' }
  // 표시 설정과 일반 조작
  | { readonly type: 'TOGGLE_LARGE_TEXT' }
  | { readonly type: 'INTERACTION' }
  // 계산 요청 (M5.B): 환자가 "예상 부담액 확인"(통신 오류 화면에서는 "다시 시도")을 누른다.
  | { readonly type: 'REQUEST_ESTIMATE' }
  // 계산 요청의 결말 (M5.B, SYSTEM): 모두 그 시도의 requestId 를 싣고, 활성 요청과 맞을 때만 반영된다(DD-09).
  | { readonly type: 'ESTIMATE_RESPONDED'; readonly requestId: string; readonly status: number; readonly body: unknown }
  | { readonly type: 'ESTIMATE_FAILED'; readonly requestId: string }
  | { readonly type: 'ESTIMATE_EXPIRED'; readonly requestId: string }
  // 자료 갱신 (M5.C): 환자가 갱신 실패 뒤 인라인 "다시 시도"를 누른다(계산이 아니라 갱신을 먼저 실행한다).
  | { readonly type: 'RETRY_REFRESH' }
  // 자료 갱신의 결말 (M5.C, SYSTEM): 모두 그 시도의 refreshId 를 싣고, 활성 갱신과 맞을 때만 반영된다(DD-09). RESOLVED 는 두 응답 본문을 둘 다 가진다(읽을 수 있는 모양인지는 전이 함수가 본다).
  | { readonly type: 'REFRESH_RESOLVED'; readonly refreshId: string; readonly catalog: unknown; readonly options: unknown }
  | { readonly type: 'REFRESH_FAILED'; readonly refreshId: string }
  | { readonly type: 'REFRESH_EXPIRED'; readonly refreshId: string }
  // 시스템
  | { readonly type: 'ORIENTATION_CHANGED'; readonly orientation: Orientation }
  | { readonly type: 'PAGE_RESTORED' }
  | { readonly type: 'TICK' };

export type KioskEventType = KioskEvent['type'];
