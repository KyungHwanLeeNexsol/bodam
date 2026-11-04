import type { Page } from '@playwright/test';

// 시험 자료(TEST_FIXTURE). 표지 식별자 발급기 (BRIEF D13, AC-016m): 브라우저의 crypto.randomUUID 를 `ID-TEST-0001…` 처럼 눈에 띄는 값을 내는 것으로 바꾼다.
// 세션·계산 시도·갱신 시도 식별자가 모두 이 함수로 나오므로, 흐름 뒤 저장소·URL·DOM 어디에도 이 표지가 없음을 보면 식별자가 메모리 밖으로 나가지 않았다는 증거가 된다.
// 운영 코드에는 덮어쓰는 훅이 없다: 이 파일이 페이지에 주입하는 스크립트는 브라우저 시험에만 있다. page.goto 보다 먼저 부른다.

export const MARKER_PREFIX = 'ID-TEST';

export async function installMarkerIds(page: Page, prefix: string = MARKER_PREFIX): Promise<void> {
  await page.addInitScript((marker) => {
    let counter = 0;
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      value: () => `${marker}-${String(++counter).padStart(4, '0')}`,
    });
  }, prefix);
}

/** UUID 형식(8-4-4-4-12 16진수) 문자열을 모두 찾는다. 실제 발급기 구성에서 새 UUID 가 저장소·화면에 생기지 않았는지 볼 때 쓴다. */
export function findUuids(text: string): string[] {
  return text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
}
