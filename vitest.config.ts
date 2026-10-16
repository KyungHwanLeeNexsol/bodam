import { defineConfig } from 'vitest/config';

// 시험 설정. 커버리지는 src/engine 과 src/server 전체를 대상으로 하며,
// coverage.include를 지정하면 시험이 가져오지 않은 파일도 0%로 집계된다(all: true와 같은 효과).
// 한쪽 폴더의 시험만 돌리면 다른 폴더가 0%로 보이므로, 폴더별 행(src/engine, src/server)으로 읽는다.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/engine/**', 'src/server/**'],
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage',
      // 100% 파일도 표에 보여 주어 per-file 근거가 text 출력에 남게 한다.
      skipFull: false,
    },
  },
});
