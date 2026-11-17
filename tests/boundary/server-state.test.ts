import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { directoryReader } from './fixture-reach';
import { walkProductionImports } from './production-reach';
import { readSourceFiles, tokenize } from './source-scan';
import type { SourceFile } from './source-scan';

// 서버 쪽 모듈 수준 상태 검사 (M4.C, AC-016e·AC-016n 의 증거, design.md DD-09). 새 파일이며 기존 경계 시험은 바꾸지 않는다.
// 환자 선택이나 키오스크 시도 식별자를 담을 수 있는 "모듈이 사는 동안 남는 변경 가능한 구조"가 src/server 와 src/app 에 없음을 소스에서 확인한다.
// 어휘 분석기(source-scan.ts)로 소스를 읽어, 최상위(중괄호 깊이 0)에서만 아래를 찾는다:
//   LET / VAR            — 모듈 수준 let·var (재대입 가능한 상태)
//   MUTABLE_CONTAINER    — new Map / Set / WeakMap / WeakSet / Array (채워 나가는 구조)
//   EMPTY_ARRAY_INIT·EMPTY_OBJECT_INIT — `= []`, `= {}` 로 시작하는 모듈 수준 값 (채워 나갈 빈 구조)
// 어느 깊이에서든 찾는 것: STATIC_MEMBER(클래스의 static 멤버), GLOBAL(globalThis 사용).
// 한계(통과해도 증명하지 못하는 것): 처음부터 내용이 들어 있는 모듈 수준 상수 배열·객체에 나중에 값을 밀어 넣는 코드는 어휘 수준으로는 구분하지 못한다
// (그런 상수는 readonly 타입과 얼린 값으로 지키고, 요청 값이 들어갈 길이 없음은 privacy.test.ts 의 모듈 내보내기 훑기와 저장소·캐시·로그 덤프가 동작으로 본다).
// 별칭(`const G = globalThis`)과 문자열로 만든 접근도 못 잡는다. 클로저(함수 안)에 갇힌 상태는 이 검사의 대상이 아니다: 공개된 캐시·저장소·로그는 시험이 직접 덤프한다.

type FindingReason = 'LET' | 'VAR' | 'MUTABLE_CONTAINER' | 'EMPTY_ARRAY_INIT' | 'EMPTY_OBJECT_INIT' | 'STATIC_MEMBER' | 'GLOBAL';

interface StateFinding {
  path: string;
  line: number;
  reason: FindingReason;
}

const CONTAINER_NAMES = new Set(['Map', 'Set', 'WeakMap', 'WeakSet', 'Array']);

function findModuleScopeState(file: SourceFile): StateFinding[] {
  const tokens = tokenize(file.text);
  const findings: StateFinding[] = [];
  const add = (line: number, reason: FindingReason) => findings.push({ path: file.path, line, reason });
  let braces = 0;
  let parens = 0;
  let brackets = 0;
  tokens.forEach((token, index) => {
    const next = tokens[index + 1];
    const afterNext = tokens[index + 2];
    if (token.kind === 'punct') {
      if (token.text === '=' && braces === 0 && parens === 0 && brackets === 0 && next?.text === '[' && afterNext?.text === ']') add(token.line, 'EMPTY_ARRAY_INIT');
      if (token.text === '=' && braces === 0 && parens === 0 && brackets === 0 && next?.text === '{' && afterNext?.text === '}') add(token.line, 'EMPTY_OBJECT_INIT');
      if (token.text === '{') braces += 1;
      else if (token.text === '}') braces -= 1;
      else if (token.text === '(') parens += 1;
      else if (token.text === ')') parens -= 1;
      else if (token.text === '[') brackets += 1;
      else if (token.text === ']') brackets -= 1;
      return;
    }
    if (token.kind !== 'ident') return;
    if (token.text === 'static' && next?.kind === 'ident') add(token.line, 'STATIC_MEMBER');
    if (token.text === 'globalThis') add(token.line, 'GLOBAL');
    if (braces !== 0) return;
    if ((token.text === 'let' || token.text === 'var') && parens === 0 && brackets === 0) add(token.line, token.text === 'let' ? 'LET' : 'VAR');
    if (token.text === 'new' && next?.kind === 'ident' && CONTAINER_NAMES.has(next.text)) add(token.line, 'MUTABLE_CONTAINER');
  });
  return findings;
}

const SERVER_DIR = fileURLToPath(new URL('../../src/server', import.meta.url));
const APP_DIR = fileURLToPath(new URL('../../src/app', import.meta.url));
const files = [...readSourceFiles(SERVER_DIR, 'src/server'), ...readSourceFiles(APP_DIR, 'src/app')];
const findings = files.flatMap(findModuleScopeState);

describe('검사기 자체의 음성 시험: 모듈 수준 상태를 만드는 소스는 걸린다', () => {
  const source = (path: string, text: string): SourceFile => ({ path, text });
  const reasonsOf = (text: string) => findModuleScopeState(source('src/server/probe.ts', text)).map((finding) => finding.reason);

  it.each<[string, string, FindingReason]>([
    ['모듈 수준 let', 'let cache = null;\nexport const f = () => cache;', 'LET'],
    ['export let', 'export let counter = 0;', 'LET'],
    ['모듈 수준 var', 'var last;', 'VAR'],
    ['타입이 붙은 let', 'let services: ApiServices | null = null;', 'LET'],
    ['모듈 수준 new Map', 'const byRequest = new Map<string, number>();', 'MUTABLE_CONTAINER'],
    ['모듈 수준 new Set', 'export const seen = new Set();', 'MUTABLE_CONTAINER'],
    ['모듈 수준 new WeakMap', 'const w = new WeakMap();', 'MUTABLE_CONTAINER'],
    ['호출 인자 안의 new Map (괄호 안이어도 최상위다)', 'export const x = wrap(new Map());', 'MUTABLE_CONTAINER'],
    ['모듈 수준 빈 배열', 'const log: string[] = [];', 'EMPTY_ARRAY_INIT'],
    ['모듈 수준 빈 객체', 'const byId: Record<string, number> = {};', 'EMPTY_OBJECT_INIT'],
    ['클래스의 static 멤버', 'export class A { static last = 1; }', 'STATIC_MEMBER'],
    ['globalThis 사용', 'export function f() { return globalThis; }', 'GLOBAL'],
  ])('%s', (_label, text, reason) => {
    expect(reasonsOf(text)).toContain(reason);
  });

  it('함수 안의 let·빈 배열·new Map(요청 안에서만 사는 지역 값)은 걸리지 않는다', () => {
    expect(
      reasonsOf(`export function handle(input: string) {
  let local = 0;
  const seen = new Set<string>();
  const out: string[] = [];
  const tmp = {};
  for (let i = 0; i < 3; i += 1) { local += i; }
  return [local, seen.size, out.length, tmp, input];
}
const make = () => { let inner = 1; return inner; };`),
    ).toEqual([]);
  });

  it('상수 표(내용이 들어 있는 배열·객체)와 인자 기본값은 걸리지 않는다 (한계: 이런 상수를 나중에 바꾸는 코드는 구분하지 못한다)', () => {
    expect(reasonsOf("export const ROLES = ['HA', 'RV'] as const;\nexport const TABLE = { a: 1 };\nexport function f(list = [], opts = {}) { return [list, opts]; }")).toEqual([]);
  });

  it('줄 번호와 경로를 돌려준다', () => {
    expect(findModuleScopeState(source('src/server/probe.ts', 'const a = 1;\n\nlet b = 2;'))).toEqual([{ path: 'src/server/probe.ts', line: 3, reason: 'LET' }]);
  });
});

describe('src/server 와 src/app 의 모듈 수준 상태', () => {
  it('검사 대상이 실제로 읽혔다 (빈 검사 방지)', () => {
    expect(files.length).toBeGreaterThan(60);
    expect(files.some((file) => file.path === 'src/server/api/bundle-content-cache.ts')).toBe(true);
    expect(files.some((file) => file.path === 'src/server/api/estimate.ts')).toBe(true);
    expect(files.some((file) => file.path === 'src/app/services.ts')).toBe(true);
  });

  it('찾은 것은 정확히 하나다: src/app/services.ts 의 서비스 묶음 보관용 let (요청 값이 들어갈 자리가 아니다)', () => {
    expect(findings).toEqual([{ path: 'src/app/services.ts', line: expect.any(Number), reason: 'LET' }]);
  });

  it('그 let 이 담는 것은 ApiServices 하나(또는 null)뿐이고, 요청 값을 받는 쓰기가 없다 (대입은 ??= 한 곳뿐이다)', () => {
    const services = files.find((file) => file.path === 'src/app/services.ts')!;
    const tokens = tokenize(services.text);
    const letIndex = tokens.findIndex((token) => token.text === 'let');
    expect(tokens.slice(letIndex, letIndex + 8).map((token) => token.text)).toEqual(['let', 'services', ':', 'ApiServices', '|', 'null', '=', 'null']);
    // `services` 에 값을 대입하는 곳: ??= 한 곳 (서비스를 처음 만들 때). 선언의 `= null` 은 `:` 타입 표기 뒤라 이 식별자 바로 뒤에 오지 않는다.
    const assignments = tokens.filter((token, index) => token.text === 'services' && ['=', '??='].includes(tokens[index + 1]?.text ?? ''));
    expect(assignments).toHaveLength(1);
    expect(services.text).toContain('createOperatingServices({ repo: createMemoryRepository(), log: silentLog, today: systemToday })');
  });

  it('묶음 내용 캐시 모듈은 운영 진입점 그래프 안에 있고 시험·시험 자료로 가는 길이 없다 (AC-010b 의 확장)', () => {
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const walk = walkProductionImports(['src/server/composition.ts', ...files.filter((file) => file.path.startsWith('src/app/')).map((file) => file.path)], directoryReader(root));
    expect(walk.files).toContain('src/server/api/bundle-content-cache.ts');
    expect(walk.findings).toEqual([]);
  });

  it('묶음 내용 캐시는 모듈이 아니라 구성이 만든 인스턴스다: 캐시 모듈에는 모듈 수준 상태가 없고, 운영 구성이 한 번 만든다', () => {
    const cacheModule = files.find((file) => file.path === 'src/server/api/bundle-content-cache.ts')!;
    expect(findModuleScopeState(cacheModule)).toEqual([]);
    const composition = files.find((file) => file.path === 'src/server/composition.ts')!;
    expect(composition.text.match(/createBundleContentCache\(\)/g)).toHaveLength(1);
  });
});
