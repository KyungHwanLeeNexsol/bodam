import type { KioskState } from '../state/session-store';
import { COPY } from './copy';

// 이용 완료 화면의 읽기 전용 값 (SPEC-REIMBURSEMENT-001 M6 S3b, design.md DD-13, AC-015f, plan.md §E #12).
// 자동 복귀는 상태 기계의 일정(completionHoldSeconds)이 맡는다. 화면은 일정을 만들지 않고, 그 값이 있느냐에 따라 안내 문장만 고른다:
// null 이면 자동 복귀가 없으므로 "잠시 후 첫 화면으로 돌아갑니다"라고 말하지 않는다(거짓이 된다). 10초 같은 값으로 바꿔 쓰지 않는다.

export interface CompleteView {
  /** 자동 복귀가 일정에 있는가 (completionHoldSeconds 가 양의 정수). */
  readonly autoReturn: boolean;
  readonly body: string;
}

// @MX:NOTE: [AUTO] completionHoldSeconds 가 null 이면 이 화면은 "처음 화면으로" 버튼으로만 떠난다(자동 복귀 없음). 화면 쪽 코드가 이 값을 읽는 곳은 여기 한 군데이고, 어디에도 기본값(10초)을 두지 않는다(static: sheet-boundary).
export function buildCompleteView(state: KioskState): CompleteView {
  const autoReturn = state.clinic.idle.completionHoldSeconds !== null;
  return { autoReturn, body: `${COPY.complete.erased}\n${autoReturn ? COPY.complete.autoReturn : COPY.complete.manualReturn}` };
}
