import { describe, expect, test } from 'vitest';
import { SCROLL_CUE_MIN_PX, scrollCueOf } from '../../../src/app/kiosk/view/scroll-cue';

// 스크롤 영역의 "아래에 더 있음" 판정 (S4 E). 순수 함수라 브라우저 없이 경계를 본다. 브라우저에서 실제로 보이는지는 tests/e2e/kiosk/scroll.intercept.spec.ts 가 잰다.

const metrics = (scrollHeight: number, clientHeight: number, scrollTop = 0) => ({ scrollHeight, clientHeight, scrollTop });

describe('scrollCueOf', () => {
  test('내용이 들어가면 스크롤 영역이 아니고 남은 내용도 없다', () => {
    expect(scrollCueOf(metrics(500, 500), true)).toEqual({ scrollable: false, more: false });
    expect(scrollCueOf(metrics(400, 500), true)).toEqual({ scrollable: false, more: false });
  });

  test('넘침이 기준 이하(반올림·여백 수준)면 스크롤 영역으로 보지 않는다: 쓸모없는 단서와 Tab 정지점을 만들지 않는다', () => {
    expect(scrollCueOf(metrics(500 + SCROLL_CUE_MIN_PX, 500), true)).toEqual({ scrollable: false, more: false });
    expect(scrollCueOf(metrics(2, 1), true)).toEqual({ scrollable: false, more: false });
  });

  test('넘침이 기준을 넘으면 스크롤 영역이고 맨 위에서는 남은 내용이 있다', () => {
    expect(scrollCueOf(metrics(500 + SCROLL_CUE_MIN_PX + 1, 500), true)).toEqual({ scrollable: true, more: true });
    expect(scrollCueOf(metrics(1_000, 400), true)).toEqual({ scrollable: true, more: true });
  });

  test('끝까지 내리면(남은 거리가 기준 이하) 남은 내용이 없다. 스크롤 영역임은 그대로다', () => {
    expect(scrollCueOf(metrics(1_000, 400, 600), true)).toEqual({ scrollable: true, more: false });
    expect(scrollCueOf(metrics(1_000, 400, 600 - SCROLL_CUE_MIN_PX), true)).toEqual({ scrollable: true, more: false });
    expect(scrollCueOf(metrics(1_000, 400, 600 - SCROLL_CUE_MIN_PX - 1), true)).toEqual({ scrollable: true, more: true });
  });

  test('스크롤되지 않는 요소(overflow 가 hidden·visible)는 내용이 넘쳐도 스크롤 영역이 아니다', () => {
    expect(scrollCueOf(metrics(1_000, 400), false)).toEqual({ scrollable: false, more: false });
  });

  test('소수 스크롤 위치(배율·확대)도 끝에서 어긋나지 않는다', () => {
    expect(scrollCueOf(metrics(1_000, 400, 599.4), true).more).toBe(false);
    expect(scrollCueOf(metrics(1_000, 400, 300.5), true).more).toBe(true);
  });
});
