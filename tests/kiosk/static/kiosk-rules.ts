import { extractModuleRefs, tokenize } from '../../boundary/source-scan';
import type { Token } from '../../boundary/source-scan';

// 키오스크 소스 전체(src/app/kiosk/**)에 대한 정적 약속 (SPEC-REIMBURSEMENT-001 M6, BRIEF §0·D12, AC-016a·AC-016b·AC-016k).
// M5 의 정적 시험(tests/kiosk/state/request-static.test.ts)이 state/ 한 폴더만 보던 것을 화면·컴포넌트·런타임까지 넓힌다.
// 어휘 분석기(tests/boundary/source-scan.ts)로 읽는다: 주석과 문자열 안의 이름은 코드가 아니다. 별칭(`const s = localStorage`)이나 문자열로 만든 접근은 못 잡는다는 한계는 같다 —
// 동작은 브라우저 시험(저장소 덤프, tests/e2e)이 실제로 본다.

export interface Violation {
  readonly rule: string;
  readonly path: string;
  readonly line: number;
  readonly detail: string;
}

/** 환자 상태가 닿으면 안 되는 브라우저 저장소·기록·주소·창 API 의 이름. */
const FORBIDDEN_IDENTIFIERS: ReadonlyMap<string, string> = new Map([
  ['localStorage', 'STORAGE'],
  ['sessionStorage', 'STORAGE'],
  ['indexedDB', 'STORAGE'],
  ['caches', 'STORAGE'],
  ['serviceWorker', 'STORAGE'],
  ['cookieStore', 'STORAGE'],
  ['history', 'NAVIGATION'],
  ['location', 'NAVIGATION'],
  ['pushState', 'NAVIGATION'],
  ['replaceState', 'NAVIGATION'],
  ['XMLHttpRequest', 'NETWORK'],
  ['WebSocket', 'NETWORK'],
  ['EventSource', 'NETWORK'],
  ['sendBeacon', 'NETWORK'],
  ['console', 'LOGGING'],
  ['innerHTML', 'HTML_INJECTION'],
  ['dangerouslySetInnerHTML', 'HTML_INJECTION'],
  ['eval', 'DYNAMIC_CODE'],
]);

/** 환자 화면 코드가 가져오면 안 되는 모듈: 라우터·링크(주소 이동), 시험 도구·시험 자료. */
const FORBIDDEN_MODULE = /^(next\/(link|navigation|router)|vitest|@playwright\/|@testing-library\/)|(^|\/)(tests?|__tests__|fixtures?)(\/|$)|\.fixture(\.|$)|\.(test|spec)(\.|$)/;

const URL_IN_TEXT = /\b(?:tel|mailto|javascript|sms):|https?:\/\//i;

const TRACKING_IDENTIFIERS = ['requestId', 'refreshId'];

/** 줄이 주석 안이거나 주석뿐인가 (원문 검사에서 주석의 설명 문장을 위반으로 세지 않기 위해). */
function commentLines(text: string): boolean[] {
  const lines = text.split('\n');
  const result: boolean[] = [];
  let inBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const startsBlock = trimmed.startsWith('/*');
    const comment = inBlock || startsBlock || trimmed.startsWith('//') || trimmed.startsWith('*');
    if (startsBlock && !trimmed.includes('*/')) inBlock = true;
    else if (inBlock && trimmed.includes('*/')) inBlock = false;
    result.push(comment);
  }
  return result;
}

function isStateFile(path: string): boolean {
  return path.startsWith('src/app/kiosk/state/');
}

/** `fetch` 는 기본 전송을 만드는 state/deps.ts 한 곳에만 있다(시작 단계의 받기도 resolveDeps().transport 를 쓴다). */
export const FETCH_ALLOWED_PATH = 'src/app/kiosk/state/deps.ts';

export function scanSource(path: string, text: string): Violation[] {
  const violations: Violation[] = [];
  const add = (rule: string, line: number, detail: string): void => {
    violations.push({ rule, path, line, detail });
  };

  let tokens: Token[];
  try {
    tokens = tokenize(text);
  } catch (error) {
    // 읽을 수 없는 소스는 통과시키지 않는다(닫힌 실패).
    return [{ rule: 'SCAN_ERROR', path, line: 0, detail: String(error) }];
  }

  tokens.forEach((token, index) => {
    const previous = tokens[index - 1];
    const next = tokens[index + 1];
    if (token.kind === 'ident') {
      const category = FORBIDDEN_IDENTIFIERS.get(token.text);
      // 객체의 속성 이름(`state.history`)이 아니라 전역 이름의 사용만 본다. 그래도 `.history` 로 읽는 것은 막는다(window.history).
      if (category !== undefined) add(category, token.line, token.text);
      if (token.text === 'cookie' && previous?.text === '.' && tokens[index - 2]?.text === 'document') add('STORAGE', token.line, 'document.cookie');
      if (token.text === 'open' && previous?.text === '.' && tokens[index - 2]?.text === 'window') add('NAVIGATION', token.line, 'window.open');
      if (token.text === 'fetch' && path !== FETCH_ALLOWED_PATH) add('FETCH_OUTSIDE_DEPS', token.line, 'fetch');
      if (!isStateFile(path) && TRACKING_IDENTIFIERS.includes(token.text)) add('TRACKING_ID_IN_UI', token.line, token.text);
      // 링크: JSX 의 <a …> 와 href 속성.
      if (token.text === 'a' && previous?.text === '<' && (next?.kind === 'ident' || next?.text === '>')) add('LINK', token.line, '<a');
      if (token.text === 'href' && next?.text === '=') add('LINK', token.line, 'href=');
    }
    if ((token.kind === 'string' || token.kind === 'template') && URL_IN_TEXT.test(token.text)) add('EXTERNAL_OR_TEL', token.line, token.text);
  });

  // JSX 글자(문자열 토큰이 아니다)와 속성값의 주소·전화 표기는 주석이 아닌 줄의 원문에서 찾는다.
  const comment = commentLines(text);
  text.split('\n').forEach((line, index) => {
    if (!(comment[index] ?? false) && URL_IN_TEXT.test(line)) add('EXTERNAL_OR_TEL', index + 1, line.trim());
  });

  try {
    for (const ref of extractModuleRefs(tokens)) {
      if (ref.specifier !== null && FORBIDDEN_MODULE.test(ref.specifier)) add('FORBIDDEN_IMPORT', ref.line, ref.specifier);
    }
  } catch {
    add('SCAN_ERROR', 0, '가져오기를 읽을 수 없다');
  }

  // 같은 줄·같은 규칙·같은 세부는 한 번만 센다(원문 검사와 토큰 검사가 같은 것을 두 번 찾는 경우).
  const seen = new Set<string>();
  return violations.filter((violation) => {
    const key = `${violation.rule}|${violation.line}|${violation.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** CSS 파일: 외부 주소 불러오기가 없다 (글꼴·이미지는 모두 패키지·소스 안의 파일이다). */
export function scanCss(path: string, text: string): Violation[] {
  const violations: Violation[] = [];
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
  stripped.split('\n').forEach((line, index) => {
    if (/https?:\/\/|url\(\s*['"]?\/\//i.test(line)) violations.push({ rule: 'EXTERNAL_OR_TEL', path, line: index + 1, detail: line.trim() });
    if (/@import\b/.test(line)) violations.push({ rule: 'CSS_IMPORT', path, line: index + 1, detail: line.trim() });
  });
  return violations;
}
