import { defineConfig } from 'vitest/config';

// 엔진 시험 설정. 커버리지는 src/engine 전체를 대상으로 하며,
// coverage.include를 지정하면 시험이 가져오지 않은 파일도 0%로 집계된다(all: true와 같은 효과).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/engine/**'],
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage',
      // 100% 파일도 표에 보여 주어 per-file 근거가 text 출력에 남게 한다.
      skipFull: false,
    },
  },
});
