import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readSourceFiles, tokenize } from '../../boundary/source-scan';
import type { Token } from '../../boundary/source-scan';

// 계산 요청 생명주기의 소스에 대한 정적 약속 (design.md DD-09, AC-016j 7, AC-016k, AC-016l, AC-016a 의 새 파일 쪽).
//  - settleRequest 밖에서 activeRequest 를 null 로 하지 않고, 요청 결말에 따라 화면을 바꾸는 길이 request.ts 밖에 없다.
//  - 계산 시도 식별자(requestId)가 전송 인자·로그·분석 호출에 닿지 않는다.
//  - 타이머는 주입한 것만 쓰고, 네트워크 식별자(fetch)는 기본 전송을 만드는 deps.ts 한 곳에만 있다.
// 한계: 어휘 수준 검사라 별칭이나 문자열로 만든 접근은 못 잡는다(tests/boundary/source-scan.ts 머리말). 동작은 request-lifecycle.test.ts 가 실제로 돌려 본다.

const KIOSK_DIR = fileURLToPath(new URL('../../../src/app/kiosk', import.meta.url));
const files = readSourceFiles(KIOSK_DIR, 'src/app/kiosk');
const tokensOf = (path: string): Token[] => tokenize((files.find((file) => file.path === `src/app/kiosk/state/${path}`) ?? { text: '' }).text);

/** `(` 의 짝 `)` 까지의 토큰 범위(괄호 안쪽). */
function parenRange(tokens: Token[], open: number): [number, number] {
  let depth = 0;
  for (let index = open; index < tokens.length; index += 1) {
    if (tokens[index]?.text === '(') depth += 1;
    if (tokens[index]?.text === ')') {
      depth -= 1;
      if (depth === 0) return [open + 1, index];
    }
  }
  throw new Error('괄호가 닫히지 않았다');
}

function braceRange(tokens: Token[], open: number): [number, number] {
  let depth = 0;
  for (let index = open; index < tokens.length; index += 1) {
    if (tokens[index]?.text === '{') depth += 1;
    if (tokens[index]?.text === '}') {
      depth -= 1;
      if (depth === 0) return [open + 1, index];
    }
  }
  throw new Error('중괄호가 닫히지 않았다');
}

/** `function 이름(...) ... { 본문 }` 의 본문 토큰 범위. 반환 형식의 객체 형식(`: { ... } | null`)은 건너뛴다. */
function functionBody(tokens: Token[], name: string): [number, number] {
  const start = tokens.findIndex((token, index) => token.text === 'function' && tokens[index + 1]?.text === name);
  if (start < 0) throw new Error(`함수 ${name} 이 없다`);
  const [, paramsEnd] = parenRange(tokens, start + 2);
  for (let index = paramsEnd + 1; index < tokens.length; index += 1) {
    if (tokens[index]?.text !== '{') continue;
    if ([':', '|', '<', ','].includes(tokens[index - 1]?.text ?? '')) {
      index = braceRange(tokens, index)[1];
      continue;
    }
    return braceRange(tokens, index);
  }
  throw new Error(`함수 ${name} 의 본문이 없다`);
}

/** `<이름>: null` 또는 `<이름> = null` 의 줄 번호들. */
function nullAssignmentLines(tokens: Token[], name = 'activeRequest'): number[] {
  return tokens.flatMap((token, index) => (token.text === name && [':', '='].includes(tokens[index + 1]?.text ?? '') && tokens[index + 2]?.text === 'null' ? [token.line] : []));
}

const lineRange = (tokens: Token[], [from, to]: [number, number]): [number, number] => [tokens[from]?.line ?? 0, tokens[to]?.line ?? 0];

describe('검사기 대조군', () => {
  it('null 대입을 찾아낸다', () => {
    expect(nullAssignmentLines(tokenize('const a = { activeRequest: null };\nx.activeRequest = null;'))).toEqual([1, 2]);
    expect(nullAssignmentLines(tokenize('if (state.activeRequest === null) {}'))).toEqual([]);
  });

  it('함수 본문 범위를 찾는다 (반환 형식의 객체 형식을 본문으로 착각하지 않는다)', () => {
    const tokens = tokenize('export function f(a: number): { x: number } | null {\n  return null;\n}\nfunction g() {\n  return 1;\n}');
    const [from, to] = functionBody(tokens, 'f');
    expect(tokens.slice(from, to).map((token) => token.text)).toEqual(['return', 'null', ';']);
  });
});

describe('AC-016j 7: activeRequest 를 푸는 곳은 settleRequest 하나다', () => {
  it('소스가 실제로 읽혔다 (빈 검사 방지): 요청 생명주기 파일이 있다', () => {
    const paths = files.map((file) => file.path);
    for (const expected of ['request', 'request-effects']) expect(paths, expected).toContain(`src/app/kiosk/state/${expected}.ts`);
  });

  it('request.ts 에서 activeRequest 에 null 을 넣는 줄은 settleRequest 본문 안의 하나뿐이다', () => {
    const tokens = tokensOf('request.ts');
    const lines = nullAssignmentLines(tokens);
    const [first, last] = lineRange(tokens, functionBody(tokens, 'settleRequest'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBeGreaterThanOrEqual(first);
    expect(lines[0]).toBeLessThanOrEqual(last);
  });

  it('session-store.ts 에서는 빈 세션을 처음 만드는 createInitialState 의 한 줄뿐이다 (해제가 아니다: resetSession 은 cancelRequest 를 거친다)', () => {
    const tokens = tokensOf('session-store.ts');
    const lines = nullAssignmentLines(tokens);
    const [first, last] = lineRange(tokens, functionBody(tokens, 'createInitialState'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBeGreaterThanOrEqual(first);
    expect(lines[0]).toBeLessThanOrEqual(last);
    const reset = tokens.slice(...functionBody(tokens, 'resetSession')).map((token) => token.text);
    expect(reset).toContain('cancelRequest');
    const apply = tokens.slice(...functionBody(tokens, 'applyInputs')).map((token) => token.text);
    expect(apply).toContain('cancelRequest');
  });

  it('그 밖의 모든 파일에는 activeRequest 에 null 을 넣는 곳이 없다', () => {
    for (const file of files) {
      if (file.path.endsWith('/state/request.ts') || file.path.endsWith('/state/session-store.ts')) continue;
      expect(nullAssignmentLines(tokenize(file.text)), file.path).toEqual([]);
    }
  });

  it('settleRequest 를 이름으로 부르는 곳은 request.ts 안뿐이다 (다른 파일은 settleOnEvent·cancelRequest 를 거친다)', () => {
    for (const file of files) {
      const named = tokenize(file.text).some((token) => token.kind === 'ident' && token.text === 'settleRequest');
      expect(named, file.path).toBe(file.path.endsWith('/state/request.ts'));
    }
  });
});

describe('AC-016j 7: 요청 결말에 따라 화면을 바꾸는 길은 request.ts 밖에 없다', () => {
  const OUTCOME_SCREENS = ['Calculating', 'KXX_Error_Network', 'K04_Result', 'K04_Result_NotCovered', 'K04_Result_Hold'];

  it('machine.ts 의 결말 사건 세 줄은 settleOnEvent 를 부르기만 한다', () => {
    const machine = files.find((file) => file.path === 'src/app/kiosk/state/machine.ts')?.text ?? '';
    const rows = machine.split('\n').filter((line) => /^\s+ESTIMATE_(RESPONDED|FAILED|EXPIRED):/.test(line));
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row).toMatch(/\{ kind: 'SYSTEM', overlays: EVERY_OVERLAY, apply: settleOnEvent \},?$/);
  });

  it('machine.ts 에서 결말 화면으로 보내는 moveTo 호출이 없다', () => {
    const tokens = tokensOf('machine.ts');
    const offenders = tokens.flatMap((token, index) => {
      if (token.text !== 'moveTo' || tokens[index + 1]?.text !== '(') return [];
      const [from, to] = parenRange(tokens, index + 1);
      return tokens.slice(from, to).filter((arg) => arg.kind === 'string' && OUTCOME_SCREENS.includes(arg.text.slice(1, -1))).map((arg) => `${token.line}:${arg.text}`);
    });
    expect(offenders).toEqual([]);
  });

  it('request.ts 밖에서 `screen: <결말 화면>` 으로 화면을 정하는 곳이 없다', () => {
    for (const file of files) {
      if (file.path.endsWith('/state/request.ts')) continue;
      const tokens = tokenize(file.text);
      const offenders = tokens.flatMap((token, index) => (token.text === 'screen' && tokens[index + 1]?.text === ':' && OUTCOME_SCREENS.some((name) => tokens[index + 2]?.text === `'${name}'`) ? [token.line] : []));
      expect(offenders, file.path).toEqual([]);
    }
  });
});

describe('AC-016k·AC-016l: 계산 시도 식별자가 닿지 않는 곳', () => {
  const REQUEST_ID = /request.?id/i;

  it('전송 호출의 인자에 requestId 가 없다: 주소·헤더·본문은 상태에서 식별자 없이 만든 call 이다', () => {
    const tokens = tokensOf('request-effects.ts');
    const at = tokens.findIndex((token, index) => token.text === 'transport' && tokens[index - 1]?.text === '.' && tokens[index + 1]?.text === '(');
    expect(at).toBeGreaterThan(0);
    const args = tokens.slice(...parenRange(tokens, at + 1));
    expect(args.length).toBeGreaterThan(3);
    expect(args.filter((token) => token.kind === 'ident' && REQUEST_ID.test(token.text))).toEqual([]);
  });

  it('주소·본문을 만드는 함수(buildEstimateCall·buildEstimateBody)는 상태 하나만 받고 식별자·활성 요청을 읽지 않는다', () => {
    const tokens = tokensOf('request.ts');
    for (const name of ['buildEstimateCall', 'buildEstimateBody']) {
      const start = tokens.findIndex((token, index) => token.text === 'function' && tokens[index + 1]?.text === name);
      const params = tokens.slice(...parenRange(tokens, start + 2)).filter((token) => token.kind === 'ident' && token.text !== 'KioskState');
      expect(params.map((token) => token.text), name).toEqual(['state']);
      const body = tokens.slice(...functionBody(tokens, name));
      expect(body.filter((token) => token.kind === 'ident' && (REQUEST_ID.test(token.text) || token.text === 'activeRequest' || token.text === 'env')), name).toEqual([]);
    }
  });

  it('로그와 분석 호출의 인자에 requestId 가 없다', () => {
    const tokens = tokensOf('request-effects.ts');
    const calls = tokens.flatMap((token, index) => (['log', 'analytics'].includes(token.text) && tokens[index - 1]?.text === '.' && tokens[index + 1]?.text === '(' ? [index] : []));
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const index of calls) {
      const args = tokens.slice(...parenRange(tokens, index + 1));
      expect(args.filter((token) => token.kind === 'ident' && REQUEST_ID.test(token.text))).toEqual([]);
    }
  });

  it('식별자는 Date 도 저장소도 아닌 주입한 발급기(newRequestId)에서만 나온다', () => {
    const makers = files.filter((file) => tokenize(file.text).some((token) => token.text === 'randomUUID'));
    expect(makers.map((file) => file.path)).toEqual(['src/app/kiosk/state/deps.ts']);
  });
});

describe('AC-016a: 새 파일에도 같은 금지가 적용된다', () => {
  it('fetch 는 기본 전송을 만드는 deps.ts 한 곳에만 있다. 다른 네트워크 식별자는 어디에도 없다', () => {
    const using = (name: string): string[] => files.filter((file) => tokenize(file.text).some((token) => token.kind === 'ident' && token.text === name)).map((file) => file.path);
    expect(using('fetch')).toEqual(['src/app/kiosk/state/deps.ts']);
    for (const name of ['XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon']) expect(using(name), name).toEqual([]);
  });

  it('타이머는 주입한 deps 로만 건다: setTimeout·clearTimeout 은 deps.ts 의 기본값과 `deps.` 접근뿐이다', () => {
    for (const file of files) {
      if (file.path.endsWith('/state/deps.ts')) continue;
      const tokens = tokenize(file.text);
      const bare = tokens.flatMap((token, index) => (['setTimeout', 'clearTimeout'].includes(token.text) && !(tokens[index - 1]?.text === '.' && tokens[index - 2]?.text === 'deps') ? [token.line] : []));
      expect(bare, file.path).toEqual([]);
    }
  });
});

describe('DD-09 갱신: activeRefresh 를 푸는 곳은 settleRefresh 하나다 (AC-020f·AC-020g 의 정적 약속)', () => {
  it('refresh.ts 에서 activeRefresh 에 null 을 넣는 줄은 settleRefresh 본문 안의 하나뿐이다', () => {
    const tokens = tokensOf('refresh.ts');
    const lines = nullAssignmentLines(tokens, 'activeRefresh');
    const [first, last] = lineRange(tokens, functionBody(tokens, 'settleRefresh'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBeGreaterThanOrEqual(first);
    expect(lines[0]).toBeLessThanOrEqual(last);
  });

  it('session-store.ts 에서는 빈 세션을 처음 만드는 createInitialState 의 한 줄뿐이다 (resetSession·applyInputs 는 cancelRefresh 를 거친다)', () => {
    const tokens = tokensOf('session-store.ts');
    const lines = nullAssignmentLines(tokens, 'activeRefresh');
    const [first, last] = lineRange(tokens, functionBody(tokens, 'createInitialState'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBeGreaterThanOrEqual(first);
    expect(lines[0]).toBeLessThanOrEqual(last);
    for (const name of ['resetSession', 'applyInputs']) expect(tokens.slice(...functionBody(tokens, name)).map((token) => token.text), name).toContain('cancelRefresh');
  });

  it('그 밖의 모든 파일에는 activeRefresh 에 null 을 넣는 곳이 없다. settleRefresh 를 이름으로 부르는 곳은 refresh.ts 안뿐이다', () => {
    for (const file of files) {
      const tokens = tokenize(file.text);
      if (!file.path.endsWith('/state/refresh.ts') && !file.path.endsWith('/state/session-store.ts')) expect(nullAssignmentLines(tokens, 'activeRefresh'), file.path).toEqual([]);
      expect(tokens.some((token) => token.kind === 'ident' && token.text === 'settleRefresh'), file.path).toBe(file.path.endsWith('/state/refresh.ts'));
    }
  });

  it('machine.ts 의 갱신 결말 사건 세 줄은 settleRefreshOnEvent 를 부르기만 한다', () => {
    const machine = files.find((file) => file.path === 'src/app/kiosk/state/machine.ts')?.text ?? '';
    const rows = machine.split('\n').filter((line) => /^\s+REFRESH_(RESOLVED|FAILED|EXPIRED):/.test(line));
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row).toMatch(/\{ kind: 'SYSTEM', overlays: EVERY_OVERLAY, apply: settleRefreshOnEvent \},?$/);
  });

  it('갱신 실패는 통신 오류 화면으로 가지 않는다: refresh.ts 는 화면을 정하지 않고 KXX_Error_Network 를 쓰지 않는다 (DD-09 규칙 3)', () => {
    const tokens = tokensOf('refresh.ts');
    expect(tokens.filter((token) => token.kind === 'string' && token.text.includes('KXX_Error_Network'))).toEqual([]);
    expect(tokens.filter((token, index) => token.text === 'screen' && tokens[index + 1]?.text === ':')).toEqual([]);
  });
});

describe('AC-016o: 갱신 식별자(refreshId)가 닿지 않는 곳', () => {
  const ID_KEY = /(request|refresh).?id/i;

  it('GET 호출의 인자(주소·헤더·신호)에 식별자가 없다: 주소는 상태 하나만 받는 buildRefreshUrls 가 만든다', () => {
    const tokens = tokensOf('refresh-effects.ts');
    const at = tokens.findIndex((token, index) => token.text === 'transport' && tokens[index - 1]?.text === '.' && tokens[index + 1]?.text === '(');
    expect(at).toBeGreaterThan(0);
    const args = tokens.slice(...parenRange(tokens, at + 1));
    expect(args.length).toBeGreaterThan(5);
    expect(args.filter((token) => token.kind === 'ident' && ID_KEY.test(token.text))).toEqual([]);

    const refresh = tokensOf('refresh.ts');
    const start = refresh.findIndex((token, index) => token.text === 'function' && refresh[index + 1]?.text === 'buildRefreshUrls');
    const params = refresh.slice(...parenRange(refresh, start + 2)).filter((token) => token.kind === 'ident' && token.text !== 'KioskState');
    expect(params.map((token) => token.text)).toEqual(['state']);
    expect(refresh.slice(...functionBody(refresh, 'buildRefreshUrls')).filter((token) => token.kind === 'ident' && (ID_KEY.test(token.text) || token.text === 'activeRefresh' || token.text === 'env'))).toEqual([]);
  });

  it('로그와 분석 호출의 인자에 식별자가 없다', () => {
    const tokens = tokensOf('refresh-effects.ts');
    const calls = tokens.flatMap((token, index) => (['log', 'analytics'].includes(token.text) && tokens[index - 1]?.text === '.' && tokens[index + 1]?.text === '(' ? [index] : []));
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const index of calls) {
      expect(tokens.slice(...parenRange(tokens, index + 1)).filter((token) => token.kind === 'ident' && ID_KEY.test(token.text))).toEqual([]);
    }
  });
});
