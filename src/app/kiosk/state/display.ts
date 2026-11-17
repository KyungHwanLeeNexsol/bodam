import type { KioskState, ScreenState } from './session-store';

// 표시 설정: 큰 글자 보기와 관찰한 화면 방향 (SPEC-REIMBURSEMENT-001 M5.A, design.md DD-08·DD-11·DD-12).
//  - 둘은 같은 상태의 표시 변형이다. 파생 데이터도 복귀 정보도 아니라서 바뀌어도 선택·결과·inputRevision·금액이 그대로이고 계산 요청이 없다.
//  - 큰 글자 보기는 세션 수준 설정이라 초기화하면 꺼진다(plan.md §E #17). 화면 방향은 기기·뷰포트에서 읽은 관찰값이라 초기화해도 유지한다.
//  - "결과로 돌아가기"는 결과 종류만 복원하고, 그릴 때는 복귀 시점의 최신 표시 설정을 읽는다(selectLayout).

export type Orientation = 'PORTRAIT' | 'LANDSCAPE';

export interface DisplayState {
  readonly largeText: boolean;
  /** 화면을 그릴 때 읽은 방향(세로 1080×1920 / 가로 1920×1080, 임시 검토 크기). 저장·복귀 정보에 들어가지 않는다. */
  readonly orientation: Orientation;
}

// @MX:NOTE: [AUTO] [문서에 없음] 치료 목록의 한 쪽 개수. DD-12 는 "치료 선택은 한 화면 4개에서 2개로 줄이는 것이 디자인 명세의 예"라고만 적고
// 가로형·다른 크기의 개수는 정하지 않았다. 구현 단계의 반응형 확정(M6)이 이 값을 바꿀 수 있으며 바꿀 곳은 이 상수 하나다.
export const TREATMENTS_PER_PAGE = { normal: 4, largeText: 2 } as const;

/** 지금 표시 설정에서 치료 목록 한 쪽에 보이는 개수. */
export function treatmentsPerPage(display: DisplayState): number {
  return display.largeText ? TREATMENTS_PER_PAGE.largeText : TREATMENTS_PER_PAGE.normal;
}

/** 큰 글자 전환. 표시 설정만 바꾼다. */
export function toggleLargeText(state: KioskState): KioskState {
  return { ...state, display: { ...state.display, largeText: !state.display.largeText } };
}

/** 관찰한 화면 방향 갱신. 같은 방향이면 null(변경이 아니다). */
export function changeOrientation(state: KioskState, orientation: Orientation): KioskState | null {
  return state.display.orientation === orientation ? null : { ...state, display: { ...state.display, orientation } };
}

export interface ScreenLayout {
  readonly screen: ScreenState;
  readonly orientation: Orientation;
  readonly largeText: boolean;
}

/** 화면을 그릴 때 읽는 값: 지금의 화면 상태와 최신 표시 설정(복귀 시점의 값이며 진입 때의 값이 아니다). */
export function selectLayout(state: KioskState): ScreenLayout {
  return { screen: state.screen, orientation: state.display.orientation, largeText: state.display.largeText };
}
