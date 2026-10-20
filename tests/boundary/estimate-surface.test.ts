import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { directoryReader } from './fixture-reach';
import { walkProductionImports } from './production-reach';
import { extractModuleRefs, readSourceFiles, tokenize } from './source-scan';

// M4.B 가 넓힌 운영 표면(계산 요청 경로)의 경계 시험. 기존 경계 시험은 바꾸지 않고 새 파일로 더한다.
//  - 계산 경로가 운영 진입점에서 닿는 그래프에 들어 있고(빈 검사 방지) 시험·시험 자료로 가는 길이 없다 (AC-010b 의 확장, AC-021d 의 증거)
//  - 계산 라우트는 얇다: POST 하나, 본문은 json() 으로만 읽는다 (헤더·쿼리·URL 을 읽지 않는다)
//  - 바깥 호출이 없다: 계산 경로의 어느 소스도 fetch·XMLHttpRequest·소켓·HTTP 모듈을 쓰지 않는다
//  - 시스템 시계는 src/app/clock.ts 한 곳에서만 읽는다

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const APP_DIR = fileURLToPath(new URL('../../src/app', import.meta.url));
const SERVER_DIR = fileURLToPath(new URL('../../src/server', import.meta.url));
const COMPOSITION = 'src/server/composition.ts';
const ROUTE = 'src/app/api/clinics/[slug]/estimate/route.ts';

const appFiles = readSourceFiles(APP_DIR, 'src/app');
const serverFiles = readSourceFiles(SERVER_DIR, 'src/server');
const entries = [COMPOSITION, ...appFiles.map((file) => file.path)];
const walk = walkProductionImports(entries, directoryReader(REPO_ROOT));

/** 계산 요청 경로를 이루는 서버 소스. */
const ESTIMATE_PATH_FILES = ['estimate.ts', 'estimate-request.ts', 'estimate-lines.ts', 'estimate-versions.ts', 'bundle-content.ts'].map((name) => `src/server/api/${name}`);

describe('계산 요청 경로가 운영 진입점 그래프에 들어 있다', () => {
  it('진입점 목록에 estimate 라우트와 시계 모듈이 있다', () => {
    expect(entries).toContain(ROUTE);
    expect(entries).toContain('src/app/clock.ts');
  });

  it('그래프가 계산 경로의 서버·엔진 소스를 지나갔다 (빈 검사 방지)', () => {
    for (const expected of [...ESTIMATE_PATH_FILES, 'src/app/clock.ts', 'src/server/digest.ts', 'src/server/domain/projection.ts', 'src/engine/estimate.ts', 'src/engine/documents.ts', 'src/engine/resolve.ts']) {
      expect(walk.files, expected).toContain(expected);
    }
  });

  it('시험·시험 자료로 가는 경로가 하나도 없다', () => {
    expect(walk.findings).toEqual([]);
  });
});

describe('계산 라우트는 얇다', () => {
  const route = appFiles.find((file) => file.path === ROUTE)!;
  const tokens = tokenize(route.text);

  it('가져오는 것은 처리 함수와 서비스 취득점 둘뿐이다', () => {
    expect(extractModuleRefs(tokens).map((ref) => ref.specifier).sort()).toEqual(['../../../../../server/api/estimate', '../../../../services']);
  });

  it('본문은 요청의 json() 으로만 읽는다: 헤더·쿼리·URL·쿠키를 읽는 식별자가 없다', () => {
    const identifiers = tokens.filter((token) => token.kind === 'ident').map((token) => token.text);
    for (const forbidden of ['headers', 'url', 'searchParams', 'cookies', 'text', 'formData', 'arrayBuffer', 'blob', 'body', 'clone']) {
      expect(identifiers, forbidden).not.toContain(forbidden);
    }
    expect(identifiers).toContain('json');
    const strings = tokens.filter((token) => token.kind === 'string').map((token) => token.text.toLowerCase());
    expect(strings.filter((text) => text.includes('request-id') || text.includes('requestid'))).toEqual([]);
  });

  it('서비스 취득은 getApiServices() 한 번이고 내보내는 것은 POST 하나다', () => {
    expect(route.text.match(/getApiServices\(\)/g)).toHaveLength(1);
    expect(route.text.match(/export\s+(async\s+)?(function|const)\s+\w+/g)).toEqual([expect.stringMatching(/POST$/)]);
  });
});

describe('바깥 호출이 없다', () => {
  // 이 검사에서 빼는 파일은 키오스크의 기본 전송을 만드는 src/app/kiosk/state/deps.ts 하나뿐이다(전역 fetch 를 부르는 유일한 곳). 나머지 키오스크 파일은 그대로 이 검사를 받는다. deps.ts 가 fetch 를 이 파일에만 두는 것은 tests/kiosk/state/request-static.test.ts 가 지킨다.
  const checked = [...ESTIMATE_PATH_FILES.map((path) => serverFiles.find((file) => file.path === path)), ...appFiles.filter((file) => file.path !== 'src/app/kiosk/state/deps.ts')];
  const NETWORK_NAMES = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon'];
  const NETWORK_MODULES = /^(node:)?(http|https|http2|net|tls|dgram|dns|child_process|worker_threads|cluster)$/;

  it('검사 대상 소스가 실제로 존재한다', () => {
    expect(checked.every((file) => file !== undefined)).toBe(true);
    expect(checked.length).toBeGreaterThanOrEqual(ESTIMATE_PATH_FILES.length + 3);
  });

  it('네트워크 호출 식별자(fetch 등)와 네트워크·프로세스 모듈 가져오기가 없다', () => {
    for (const file of checked) {
      const tokens = tokenize(file!.text);
      const identifiers = tokens.filter((token) => token.kind === 'ident').map((token) => token.text);
      for (const name of NETWORK_NAMES) {
        expect(identifiers, `${file!.path} ${name}`).not.toContain(name);
      }
      expect(extractModuleRefs(tokens).map((ref) => ref.specifier ?? '').filter((specifier) => NETWORK_MODULES.test(specifier)), file!.path).toEqual([]);
    }
  });
});

describe('시스템 시계', () => {
  it('src/app 에서 Date 를 쓰는 곳은 clock.ts 하나뿐이다', () => {
    const users = appFiles.filter((file) => tokenize(file.text).some((token) => token.kind === 'ident' && token.text === 'Date')).map((file) => file.path);
    expect(users).toEqual(['src/app/clock.ts']);
  });

  it('API 계층(src/server/api)과 운영 구성(composition.ts)은 Date 를 쓰지 않는다 (판정 기준일은 주입한다; src/server 전체의 시계 호출 금지는 server-imports.test.ts 가 지킨다)', () => {
    const users = serverFiles
      .filter((file) => file.path.startsWith('src/server/api/') || file.path === COMPOSITION)
      .filter((file) => tokenize(file.text).some((token) => token.kind === 'ident' && token.text === 'Date'))
      .map((file) => file.path);
    expect(users).toEqual([]);
  });
});
