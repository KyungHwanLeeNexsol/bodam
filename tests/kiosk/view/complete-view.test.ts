import { describe, expect, it } from 'vitest';
import { makeCatalog } from '../../fixtures/kiosk/clinic.fixture';
import { stateAt } from '../../fixtures/kiosk/state.fixture';
import { buildCompleteView } from '../../../src/app/kiosk/view/complete-view';

// 이용 완료 화면의 읽기 전용 값 (SPEC-REIMBURSEMENT-001 M6 S3b, design.md DD-13, AC-015f, plan.md §E #12).
// completionHoldSeconds 가 null 이면 자동 복귀가 없다: 화면이 "잠시 후 첫 화면으로 돌아갑니다"라고 말하면 거짓이 된다. 10초 같은 값으로 바꿔 쓰지 않는다.

const withHold = (completionHoldSeconds: number | null) => stateAt('K06_Complete', {}, { catalog: makeCatalog({ idlePolicy: { completionHoldSeconds } }) });

describe('이용 완료 화면의 자동 복귀 안내', () => {
  it('양수이면 자동 복귀 문장이다 (디자인 문구 그대로)', () => {
    const view = buildCompleteView(withHold(10));
    expect(view.autoReturn).toBe(true);
    expect(view.body).toBe('선택하신 보험 조건과 치료 내용은 모두 지워졌습니다.\n잠시 후 첫 화면으로 돌아갑니다.');
  });

  it('null 이면 자동 복귀를 약속하지 않고 버튼을 안내한다 (10초로 바꿔 쓰지 않는다)', () => {
    const view = buildCompleteView(withHold(null));
    expect(view.autoReturn).toBe(false);
    expect(view.body).toContain('선택하신 보험 조건과 치료 내용은 모두 지워졌습니다.');
    expect(view.body).not.toContain('잠시 후');
    expect(view.body).toContain('‘처음 화면으로’');
  });

  it('정책이 없는 병원(응답에 completionHoldSeconds 가 없음)도 null 과 같다', () => {
    const state = stateAt('K06_Complete', {}, { catalog: makeCatalog({ idlePolicy: undefined as never }) });
    expect(buildCompleteView(state).autoReturn).toBe(false);
  });

  it('0·음수·소수·문자열 같은 쓸 수 없는 값은 상태 기계가 null 로 읽으므로 자동 복귀가 없다', () => {
    for (const value of [0, -1, 1.5, '10' as never, Number.NaN]) expect(buildCompleteView(withHold(value as never)).autoReturn, String(value)).toBe(false);
  });
});
