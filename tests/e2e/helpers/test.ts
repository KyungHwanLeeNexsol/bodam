import { expect, test as base } from '@playwright/test';

// 시험 자료(TEST_FIXTURE). 모든 브라우저 시험이 쓰는 test: 시험이 끝날 때 페이지가 콘솔 오류·잡히지 않은 예외를 낸 적이 없음을 확인한다.
// 하이드레이션 불일치, 렌더링 중 예외, 사건 처리 중 예외가 모두 여기서 걸린다(운영 빌드에서는 React 오류가 console.error 로 나온다).
// 일부러 만든 네트워크 실패·상태 오류의 "Failed to load resource" 는 시험이 만든 상황이라 제외한다.

const IGNORED = [/^Failed to load resource/];

export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error' && !IGNORED.some((pattern) => pattern.test(message.text()))) problems.push(`console.error: ${message.text()}`);
      });
      page.on('pageerror', (error) => {
        problems.push(`pageerror: ${error.message}`);
      });
      await use();
      expect(problems, '페이지가 콘솔 오류나 잡히지 않은 예외를 냈다').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
