import type { Page } from '@playwright/test';

// 시험 자료(TEST_FIXTURE). 브라우저 시험의 시간 도구 (BRIEF D12): 실제로 기다리지 않는다. page.clock 으로 Date·setTimeout·performance.now 를 가짜 시계로 바꾸고 시험이 흘려 보낸다.
// 반드시 page.goto 보다 먼저 부른다. 상태 기계의 기본 시계는 performance.now() 이고 가짜 시계가 이것도 가로챈다.

/** 가짜 시계를 설치한다(시험 시작 시각은 고정). 시계는 설치 뒤에도 실제 시간대로 흐르지만 시험은 runFor·fastForward 로 크게 움직인다. */
export async function installClock(page: Page): Promise<void> {
  await page.clock.install({ time: new Date('2026-10-20T09:00:00+09:00') });
}

/**
 * 긴 타이머(무조작 경고·초기화 같은 수십 초 이상)를 "울리지 않는 타이머"로 바꾼다. 타이머 콜백이 늦게 도는 상황(절전·느린 기기)을 만든다:
 * 시계만 크게 앞으로 보내고(fastForward) 이미 도래한 무조작 타이머는 돌지 않게 해서, 환자의 다음 조작이 만료 초기화를 일으키는지(5e6fb05)를 본다.
 * installClock 보다 나중에 불러야 한다(가짜 시계의 setTimeout 을 감싼다). 짧은 타이머(요청·갱신 시간 제한, 15초)는 그대로 돈다.
 */
export async function swallowLongTimers(page: Page, thresholdMs = 50_000): Promise<void> {
  await page.addInitScript((threshold) => {
    const original = window.setTimeout.bind(window);
    // 형식이 가짜 시계의 setTimeout 과 같아야 하므로 인자를 그대로 넘긴다.
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (typeof delay === 'number' && delay >= threshold) return -1;
      return original(handler, delay, ...(args as []));
    }) as typeof window.setTimeout;
  }, thresholdMs);
}
