// 스크롤 영역의 "아래에 더 있음" 판정 (SPEC-REIMBURSEMENT-001 M6 S4, DD-12 "넘치면 스크롤" 의 보완). 순수 함수: 브라우저가 잰 세 값과 "이 요소가 실제로 스크롤되는가"만 받는다.
// 터치 화면의 스크롤 막대는 숨겨지기 쉬워 환자가 아래의 내용(예: 예상 보험금, 마지막 서류 줄)이 있음을 놓칠 수 있다. 그래서 넘치는 본문마다 단서를 보이고 키보드로도 스크롤할 수 있게 한다.
// 기능·금액·문구를 바꾸지 않는다: 어느 화면도 이 판정으로 내용이 달라지지 않고, 표시만 더해진다.

/** 이 값 이하의 넘침은 스크롤 영역으로 보지 않는다(반올림·여백 수준의 몇 px 때문에 단서와 Tab 정지점을 만들지 않는다). 남은 거리가 이 값 이하이면 "끝"이다. */
export const SCROLL_CUE_MIN_PX = 16;

export interface ScrollMetrics {
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly scrollTop: number;
}

export interface ScrollCue {
  /** 내용이 눈에 띄게 넘쳐 실제로 스크롤되는 영역인가(키보드 초점·이름이 필요하다). */
  readonly scrollable: boolean;
  /** 아래에 더 볼 내용이 남아 있는가(단서를 보인다). */
  readonly more: boolean;
}

/** `scrolls` 는 계산된 overflow-y 가 auto·scroll 인가(CSS 가 정한다: 같은 요소도 방향에 따라 스크롤되지 않을 수 있다). */
export function scrollCueOf(metrics: ScrollMetrics, scrolls: boolean): ScrollCue {
  const overflow = metrics.scrollHeight - metrics.clientHeight;
  if (!scrolls || overflow <= SCROLL_CUE_MIN_PX) return { scrollable: false, more: false };
  return { scrollable: true, more: overflow - metrics.scrollTop > SCROLL_CUE_MIN_PX };
}
