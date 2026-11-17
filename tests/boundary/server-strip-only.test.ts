import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// 브라우저 시험의 앞단(tests/e2e/harness/server.ts)은 src/server 를 node 의 형 지우기 방식(strip-only)으로 읽어 실행한다.
// 이 방식은 매개변수 속성(constructor(readonly x))·enum·namespace 를 지원하지 않는다. vitest 와 tsc 는 이를 걸러 내지 못해 앞단이 뜰 때에야 SyntaxError 로 드러난 적이 있다(M7 매핑 검토).
// 그래서 관리자 라우터(와 그것이 가져오는 서버 모듈 전체)를 같은 방식으로 한 번 불러 본다.

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

describe('src/server 는 node 형 지우기 방식으로 불러올 수 있다 (브라우저 시험 앞단과 같은 방식)', () => {
  it('관리자 라우터와 공개 핸들러 모듈을 불러온다', () => {
    const script = "Promise.all([import('./src/server/admin/router.ts'), import('./src/server/api/estimate.ts'), import('./src/server/mapping-review.ts')]).then(() => process.stdout.write('loaded'))";
    const output = execFileSync(process.execPath, ['--import', './tests/fixtures/engine/ts-resolve-register.mjs', '-e', script], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
    expect(output).toBe('loaded');
  });
});
