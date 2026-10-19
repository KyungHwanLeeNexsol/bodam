import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractModuleRefs, readSourceFiles, tokenize } from './source-scan';
import type { SourceFile } from './source-scan';

// 증거만 낸다 (닫는 AC 아님): AC-019c 의 서버 쪽 모듈 동일성(키오스크 쪽과 함께 닫는 것은 M6)과 AC-021d 의 서버 쪽 바깥 호출 검사(src/ 전체로 닫는 것은 M7).
//  - 계산 API 가 부르는 판정 함수(estimate · deriveDocuments · selectDocumentRuleSet · resolveMapping)는 src/engine 의 그 모듈에서 가져온 것이고,
//    src/server·src/app 어디에도 같은 이름의 두 번째 구현이 없다. (런타임 호출 증거는 tests/api/estimate-compute.test.ts 의 통과형 감시가 낸다.)
//  - 묶음 내용 캐시(M4.C)를 포함한 src/server/api 와 src/app 의 소스에는 바깥 호출(fetch·소켓·HTTP 모듈·프로세스 모듈) 식별자가 없다.
// 한계: 어휘 수준 검사라 별칭이나 문자열로 만든 접근은 못 잡는다(source-scan.ts 머리말).

const SERVER_DIR = fileURLToPath(new URL('../../src/server', import.meta.url));
const APP_DIR = fileURLToPath(new URL('../../src/app', import.meta.url));
const ENGINE_DIR = fileURLToPath(new URL('../../src/engine', import.meta.url));
const serverFiles = readSourceFiles(SERVER_DIR, 'src/server');
const appFiles = readSourceFiles(APP_DIR, 'src/app');
const engineFiles = readSourceFiles(ENGINE_DIR, 'src/engine');

const JUDGEMENT_FUNCTIONS = ['estimate', 'deriveDocuments', 'selectDocumentRuleSet', 'resolveMapping', 'resolveProfile', 'isUsable', 'decideLine'];

/** 파일이 이름을 선언하는가: `function 이름`, `const|let|var 이름`, `class 이름`. */
function declares(file: SourceFile, name: string): boolean {
  const tokens = tokenize(file.text);
  return tokens.some((token, index) => token.kind === 'ident' && token.text === name && ['function', 'const', 'let', 'var', 'class'].includes(tokens[index - 1]?.text ?? ''));
}

describe('AC-019c 증거(서버 쪽): 계산 API 는 src/engine 의 판정 함수를 부르고 두 번째 구현이 없다', () => {
  const estimateService = serverFiles.find((file) => file.path === 'src/server/api/estimate.ts')!;
  const refs = extractModuleRefs(tokenize(estimateService.text));

  it('계산 서비스는 엔진의 판정 모듈을 상대 경로로 가져온다 (src/server/api → src/engine)', () => {
    const specifiers = refs.map((ref) => ref.specifier);
    for (const expected of ['../../engine/estimate', '../../engine/documents', '../../engine/resolve']) {
      expect(specifiers, expected).toContain(expected);
    }
  });

  it('엔진 쪽에는 그 함수들의 선언이 실제로 있다 (빈 검사 방지)', () => {
    for (const name of JUDGEMENT_FUNCTIONS) {
      expect(
        engineFiles.some((file) => declares(file, name)),
        name,
      ).toBe(true);
    }
  });

  it('src/server 와 src/app 어디에도 같은 이름의 함수·상수를 선언하는 파일이 없다 (판정의 두 번째 구현 없음)', () => {
    const declaring = [...serverFiles, ...appFiles].flatMap((file) => JUDGEMENT_FUNCTIONS.filter((name) => declares(file, name)).map((name) => `${file.path}:${name}`));
    expect(declaring).toEqual([]);
  });

  it('검사기 대조군: 선언이 있으면 찾아낸다', () => {
    expect(declares({ path: 'x.ts', text: 'export function estimate() {}' }, 'estimate')).toBe(true);
    expect(declares({ path: 'x.ts', text: 'const deriveDocuments = () => 1;' }, 'deriveDocuments')).toBe(true);
    expect(declares({ path: 'x.ts', text: "import { estimate } from '../../engine/estimate'; estimate();" }, 'estimate')).toBe(false);
  });
});

describe('AC-021d 증거(서버 쪽): 묶음 내용 캐시를 포함한 서버 API 와 운영 연결에 바깥 호출이 없다', () => {
  const NETWORK_NAMES = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon'];
  const NETWORK_MODULES = /^(node:)?(http|https|http2|net|tls|dgram|dns|child_process|worker_threads|cluster|fs|fs\/promises)$/;
  const checked = [...serverFiles.filter((file) => file.path.startsWith('src/server/api/') || file.path === 'src/server/composition.ts'), ...appFiles];

  it('검사 대상에 캐시 모듈이 들어 있다 (빈 검사 방지)', () => {
    expect(checked.some((file) => file.path === 'src/server/api/bundle-content-cache.ts')).toBe(true);
    expect(checked.length).toBeGreaterThan(20);
  });

  it('네트워크·파일·프로세스 식별자와 모듈 가져오기가 없다', () => {
    for (const file of checked) {
      const tokens = tokenize(file.text);
      const identifiers = tokens.filter((token) => token.kind === 'ident').map((token) => token.text);
      for (const name of NETWORK_NAMES) {
        expect(identifiers, `${file.path} ${name}`).not.toContain(name);
      }
      for (const ref of extractModuleRefs(tokens)) {
        expect(ref.specifier, `${file.path} 동적 가져오기`).not.toBeNull();
        expect(NETWORK_MODULES.test(ref.specifier ?? ''), `${file.path} ${ref.specifier}`).toBe(false);
      }
    }
  });

  it('묶음 내용 캐시 모듈은 값을 가져오지 않는다: 가져오기는 형식 가져오기(import type) 하나뿐이다', () => {
    const cache = checked.find((file) => file.path === 'src/server/api/bundle-content-cache.ts')!;
    const importLines = cache.text.split('\n').filter((line) => /^import\b/.test(line));
    expect(importLines).toHaveLength(1);
    expect(importLines[0]).toMatch(/^import type \{ BundleContent \} from '\.\/bundle-content';/);
  });
});
