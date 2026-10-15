import { readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, posix } from 'node:path';

// 가져오기 경계·숫자 리터럴 검사에 쓰는 어휘 분석기와 규칙 모음 (M1.4, AC-001b·AC-001c·AC-010b).
// TypeScript 7 은 JS 컴파일러 API 를 싣지 않고(`typescript` 패키지는 네이티브 실행 파일 실행기), 새 의존성을 더하지 않는다는 제약이 있어
// 소스를 문자·주석·템플릿·정규식까지 구분하는 작은 어휘 분석기로 직접 읽는다.
// 읽을 수 없는 소스는 통과시키지 않고 SCAN_ERROR 위반으로 닫힌 실패한다.
// 한계: 어휘 수준 검사라서 `const D = Date; D.now()` 같은 별칭이나 `Reflect.get(Date, 'now')` 는 못 잡는다.
// 그 부분은 결정성 시험(determinism.test.ts)이 Date.now·Math.random·시스템 시각을 실제로 바꿔 보는 동작 증거로 메운다.

// ───────────────────────── 어휘 분석 ─────────────────────────

export type TokenKind = 'ident' | 'number' | 'string' | 'template' | 'regex' | 'punct';

export interface Token {
  kind: TokenKind;
  text: string;
  line: number;
}

export class ScanError extends Error {
  line: number;

  constructor(message: string, line: number) {
    super(`${message} (줄 ${line})`);
    this.line = line;
  }
}

const PUNCTUATORS = [
  '>>>=',
  '...',
  '===',
  '!==',
  '**=',
  '<<=',
  '>>=',
  '>>>',
  '&&=',
  '||=',
  '??=',
  '=>',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '??',
  '?.',
  '++',
  '--',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '**',
  '<<',
  '>>',
];

/** 이 키워드 바로 뒤의 `/` 는 나눗셈이 아니라 정규식 시작이다. */
const REGEX_AFTER_KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

const NUMBER_PATTERN = /(?:0[xX][0-9a-fA-F_]+n?|0[bB][01_]+n?|0[oO][0-7_]+n?|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?n?)/y;
const IDENT_PATTERN = /[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*/uy;

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const length = source.length;
  let pos = 0;
  let line = 1;

  function regexAllowed(): boolean {
    const previous = tokens[tokens.length - 1];
    if (previous === undefined) return true;
    switch (previous.kind) {
      case 'number':
      case 'string':
      case 'template':
      case 'regex':
        return false;
      case 'ident':
        return REGEX_AFTER_KEYWORDS.has(previous.text);
      case 'punct':
        return previous.text !== ')' && previous.text !== ']' && previous.text !== '}';
    }
  }

  function scanTemplate(): void {
    const startLine = line;
    tokens.push({ kind: 'template', text: '`', line });
    pos += 1;
    for (;;) {
      if (pos >= length) throw new ScanError('닫히지 않은 템플릿 문자열', startLine);
      const ch = source[pos] as string;
      if (ch === '`') {
        pos += 1;
        return;
      }
      if (ch === '\\') {
        if (source[pos + 1] === '\n') line += 1;
        pos += 2;
        continue;
      }
      if (ch === '$' && source[pos + 1] === '{') {
        pos += 2;
        lex(true);
        continue;
      }
      if (ch === '\n') line += 1;
      pos += 1;
    }
  }

  function scanString(quote: string): void {
    const startLine = line;
    pos += 1;
    const start = pos;
    for (;;) {
      if (pos >= length) throw new ScanError('닫히지 않은 문자열', startLine);
      const ch = source[pos] as string;
      if (ch === quote) break;
      if (ch === '\n') throw new ScanError('줄이 바뀐 문자열', startLine);
      if (ch === '\\') {
        if (source[pos + 1] === '\n') line += 1;
        pos += 2;
        continue;
      }
      pos += 1;
    }
    tokens.push({ kind: 'string', text: source.slice(start, pos), line: startLine });
    pos += 1;
  }

  function scanRegex(): void {
    const startLine = line;
    const start = pos;
    pos += 1;
    let inClass = false;
    for (;;) {
      if (pos >= length) throw new ScanError('닫히지 않은 정규식', startLine);
      const ch = source[pos] as string;
      if (ch === '\n') throw new ScanError('줄이 바뀐 정규식', startLine);
      if (ch === '\\') {
        pos += 2;
        continue;
      }
      if (ch === '[') inClass = true;
      else if (ch === ']') inClass = false;
      else if (ch === '/' && !inClass) break;
      pos += 1;
    }
    pos += 1;
    while (pos < length && /[A-Za-z]/.test(source[pos] as string)) pos += 1;
    tokens.push({ kind: 'regex', text: source.slice(start, pos), line: startLine });
  }

  /** closeBrace 가 true 면 템플릿의 `${` 안쪽이다: 짝이 맞는 `}` 를 만나면 먹고 돌아간다. */
  function lex(closeBrace: boolean): void {
    let depth = 0;
    while (pos < length) {
      const ch = source[pos] as string;
      if (ch === '\n') {
        line += 1;
        pos += 1;
        continue;
      }
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '﻿' || ch === ' ') {
        pos += 1;
        continue;
      }
      if (ch === '/' && source[pos + 1] === '/') {
        while (pos < length && source[pos] !== '\n') pos += 1;
        continue;
      }
      if (ch === '/' && source[pos + 1] === '*') {
        const startLine = line;
        const end = source.indexOf('*/', pos + 2);
        if (end < 0) throw new ScanError('닫히지 않은 주석', startLine);
        for (let k = pos; k < end; k += 1) if (source[k] === '\n') line += 1;
        pos = end + 2;
        continue;
      }
      if (ch === '"' || ch === "'") {
        scanString(ch);
        continue;
      }
      if (ch === '`') {
        scanTemplate();
        continue;
      }
      const next = source[pos + 1];
      if (/\d/.test(ch) || (ch === '.' && next !== undefined && /\d/.test(next))) {
        NUMBER_PATTERN.lastIndex = pos;
        const match = NUMBER_PATTERN.exec(source);
        if (match === null) throw new ScanError('숫자 리터럴을 읽을 수 없다', line);
        tokens.push({ kind: 'number', text: match[0], line });
        pos += match[0].length;
        continue;
      }
      IDENT_PATTERN.lastIndex = pos;
      const identMatch = IDENT_PATTERN.exec(source);
      if (identMatch !== null) {
        tokens.push({ kind: 'ident', text: identMatch[0], line });
        pos += identMatch[0].length;
        continue;
      }
      if (ch === '/' && regexAllowed()) {
        scanRegex();
        continue;
      }
      if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        if (closeBrace && depth === 0) {
          pos += 1;
          return;
        }
        depth -= 1;
      }
      const operator = PUNCTUATORS.find((candidate) => source.startsWith(candidate, pos));
      const text = operator ?? ch;
      tokens.push({ kind: 'punct', text, line });
      pos += text.length;
    }
    if (closeBrace) throw new ScanError('닫히지 않은 템플릿 치환 ${', line);
  }

  lex(false);
  return tokens;
}

// ───────────────────────── 모듈 가져오기 추출 ─────────────────────────

export type ModuleRefKind = 'import' | 'export-from' | 'side-effect' | 'dynamic' | 'require';

export interface ModuleRef {
  kind: ModuleRefKind;
  /** 문자열 리터럴이 아니면 null (동적 가져오기에 식을 준 경우). */
  specifier: string | null;
  line: number;
}

function isMemberAccess(tokens: readonly Token[], index: number): boolean {
  const previous = tokens[index - 1];
  return previous !== undefined && previous.kind === 'punct' && (previous.text === '.' || previous.text === '?.');
}

const EXPORT_DECLARATION_WORDS = new Set(['const', 'let', 'var', 'function', 'class', 'interface', 'enum', 'default', 'async', 'namespace', 'declare', 'abstract', 'import', 'export']);

/** `import`/`export` 절 안에서 `from '...'` 의 문자열 토큰 인덱스를 찾는다. 선언이 시작되면 없는 것이다. */
function findFromSpecifier(tokens: readonly Token[], start: number, stopWords: ReadonlySet<string>): number {
  for (let j = start; j < tokens.length; j += 1) {
    const token = tokens[j] as Token;
    if (token.kind === 'string') {
      const before = tokens[j - 1];
      return before !== undefined && before.kind === 'ident' && before.text === 'from' ? j : -1;
    }
    if (token.kind === 'punct' && (token.text === ';' || token.text === '=' || token.text === '(')) return -1;
    if (token.kind === 'ident' && stopWords.has(token.text)) return -1;
  }
  return -1;
}

export function extractModuleRefs(tokens: Token[]): ModuleRef[] {
  const refs: ModuleRef[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] as Token;
    if (token.kind !== 'ident' || isMemberAccess(tokens, i)) continue;
    const next = tokens[i + 1];
    if (token.text === 'import') {
      if (next === undefined) continue;
      if (next.kind === 'string') {
        refs.push({ kind: 'side-effect', specifier: next.text, line: token.line });
      } else if (next.kind === 'punct' && next.text === '(') {
        const argument = tokens[i + 2];
        const close = tokens[i + 3];
        const literal = argument?.kind === 'string' && close !== undefined && (close.text === ')' || close.text === ',');
        refs.push({ kind: 'dynamic', specifier: literal ? (argument as Token).text : null, line: token.line });
      } else if (!(next.kind === 'punct' && next.text === '.')) {
        const at = findFromSpecifier(tokens, i + 1, new Set());
        if (at >= 0) refs.push({ kind: 'import', specifier: (tokens[at] as Token).text, line: token.line });
      }
    } else if (token.text === 'export') {
      const at = findFromSpecifier(tokens, i + 1, EXPORT_DECLARATION_WORDS);
      if (at >= 0) refs.push({ kind: 'export-from', specifier: (tokens[at] as Token).text, line: token.line });
    } else if (token.text === 'require' && next !== undefined && next.kind === 'punct' && next.text === '(') {
      const argument = tokens[i + 2];
      const close = tokens[i + 3];
      const literal = argument?.kind === 'string' && close?.text === ')';
      refs.push({ kind: 'require', specifier: literal ? (argument as Token).text : null, line: token.line });
    }
  }
  return refs;
}

// ───────────────────────── 모듈 분류 ─────────────────────────

/** 시험 자료(fixture) 경로 판정: fixtures 폴더 아래이거나 파일 이름에 `.fixture` 가 든다. */
export function isFixturePath(path: string): boolean {
  const segments = path.split('/');
  const last = segments[segments.length - 1] ?? '';
  const folderName = /^(__)?fixtures?(__)?$/i;
  if (segments.slice(0, -1).some((segment) => folderName.test(segment))) return true;
  return folderName.test(last) || /\.fixtures?(\.|$)/i.test(last);
}

const DB_ROOTS = new Set([
  'pg',
  'pg-promise',
  'pg-pool',
  'postgres',
  'mysql',
  'mysql2',
  'mariadb',
  'sqlite',
  'sqlite3',
  'better-sqlite3',
  'mongodb',
  'mongoose',
  'redis',
  'ioredis',
  'knex',
  'sequelize',
  'typeorm',
  'prisma',
  'kysely',
  'drizzle-orm',
  'oracledb',
  'tedious',
  'mssql',
  'cassandra-driver',
  'firebase',
  'firebase-admin',
]);
const DB_SCOPES = ['@prisma/', '@supabase/', '@neondatabase/', '@planetscale/', '@libsql/', '@vercel/postgres', '@vercel/kv', '@firebase/', '@google-cloud/firestore', '@aws-sdk/client-dynamodb'];
const NETWORK_BUILTINS = new Set(['http', 'https', 'http2', 'net', 'tls', 'dgram', 'dns']);
const NETWORK_PACKAGES = new Set(['axios', 'node-fetch', 'undici', 'ws', 'got', 'superagent', 'ky', 'cross-fetch', 'isomorphic-fetch', 'request', 'ofetch', 'whatwg-fetch', 'socket.io', 'socket.io-client', 'engine.io']);
const AI_ROOTS = new Set(['openai', 'ai', 'anthropic', 'langchain', 'cohere-ai', 'groq-sdk', 'replicate', 'llamaindex', 'ollama', 'together-ai', '@google/generative-ai', '@google/genai']);
const AI_SCOPES = ['@anthropic-ai/', '@ai-sdk/', '@langchain/', '@mistralai/', '@huggingface/', '@openrouter/', '@modelcontextprotocol/', '@azure/openai', '@google-cloud/vertexai', '@xenova/', '@aws-sdk/client-bedrock'];
const BUILTIN_ROOTS = new Set(builtinModules.map((name) => name.split('/')[0] as string));

export type ModuleCategory = 'REACT' | 'NEXT' | 'DB_DRIVER' | 'NETWORK' | 'FILE_SYSTEM' | 'AI_SDK' | 'NODE_BUILTIN' | 'FIXTURE' | 'OUTSIDE_ENGINE' | 'BARE_PACKAGE';

/**
 * 가져오기 대상이 엔진 경계 안인지 판정한다. 엔진 안의 상대 경로면 null, 아니면 위반 분류를 돌려준다.
 * 엔진은 외부 패키지와 Node 내장 모듈을 하나도 가져오지 않으므로 알려진 금지 분류에 들지 않는 패키지도 BARE_PACKAGE 위반이다.
 */
export function classifyModule(specifier: string, fromFile: string, engineRoot: string): ModuleCategory | null {
  if (specifier.startsWith('./') || specifier.startsWith('../') || specifier === '.' || specifier === '..') {
    const resolved = posix.normalize(posix.join(posix.dirname(fromFile), specifier));
    if (isFixturePath(resolved)) return 'FIXTURE';
    return resolved === engineRoot || resolved.startsWith(`${engineRoot}/`) ? null : 'OUTSIDE_ENGINE';
  }
  if (specifier.startsWith('/') || /^[A-Za-z]:[\\/]/.test(specifier) || specifier.startsWith('file:')) return 'OUTSIDE_ENGINE';

  const hasNodePrefix = specifier.startsWith('node:');
  const bare = hasNodePrefix ? specifier.slice('node:'.length) : specifier;
  const segments = bare.split('/');
  const root = bare.startsWith('@') ? segments.slice(0, 2).join('/') : (segments[0] as string);

  if (hasNodePrefix || BUILTIN_ROOTS.has(root)) {
    if (root === 'fs') return 'FILE_SYSTEM';
    return NETWORK_BUILTINS.has(root) ? 'NETWORK' : 'NODE_BUILTIN';
  }
  if (root === 'react' || root === 'react-dom' || root === 'react-native' || root === 'preact') return 'REACT';
  if (root === 'next' || root.startsWith('next-') || root.startsWith('@next/')) return 'NEXT';
  if (DB_ROOTS.has(root) || DB_SCOPES.some((scope) => bare.startsWith(scope))) return 'DB_DRIVER';
  if (NETWORK_PACKAGES.has(root)) return 'NETWORK';
  if (AI_ROOTS.has(root) || AI_SCOPES.some((scope) => bare.startsWith(scope))) return 'AI_SDK';
  return 'BARE_PACKAGE';
}

// ───────────────────────── 파일 읽기 ─────────────────────────

export interface SourceFile {
  path: string;
  text: string;
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

/** dir 아래의 소스 파일을 모두 읽는다. 경로는 `prefix/하위경로` 형태의 슬래시 경로다. 소스가 아닌 파일은 읽지 않는다. */
export function readSourceFiles(dir: string, prefix: string): SourceFile[] {
  const files: SourceFile[] = [];
  for (const relative of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    const full = join(dir, relative);
    if (!statSync(full).isFile()) continue;
    const dot = relative.lastIndexOf('.');
    if (dot < 0 || !SOURCE_EXTENSIONS.has(relative.slice(dot))) continue;
    files.push({ path: `${prefix}/${relative.replace(/\\/g, '/')}`, text: readFileSync(full, 'utf8') });
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// ───────────────────────── 경계 검사 (AC-001b) ─────────────────────────

export interface Violation {
  file: string;
  line: number;
  rule: string;
  detail: string;
}

const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs', '.jsx', '/index.ts', '/index.tsx', '/index.js'];

/** 상대 경로 base 를 알려진 파일 중 하나로 해석한다. `.js` 로 쓴 형식은 `.ts` 소스로도 해석한다. */
export function resolveAmong(base: string, exists: (path: string) => boolean): string | null {
  const candidates = RESOLVE_SUFFIXES.map((suffix) => `${base}${suffix}`);
  if (base.endsWith('.js')) candidates.push(`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`);
  if (base.endsWith('.mjs')) candidates.push(`${base.slice(0, -4)}.mts`);
  return candidates.find((candidate) => exists(candidate)) ?? null;
}

const LOCAL_TIME_MEMBERS = new Set(['getFullYear', 'getYear', 'getMonth', 'getDate', 'getDay', 'getHours', 'getMinutes', 'getSeconds', 'getMilliseconds', 'getTimezoneOffset', 'toDateString', 'toTimeString']);
const RANDOM_MEMBERS = new Set(['randomUUID', 'getRandomValues', 'randomBytes', 'randomInt']);
const ENVIRONMENT_GLOBALS = new Set(['process', 'globalThis', 'window', 'document', 'navigator', 'Deno', 'Bun', '__dirname', '__filename']);
const NETWORK_GLOBALS = new Set(['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon']);
const TIMER_GLOBALS = new Set(['setTimeout', 'setInterval', 'setImmediate', 'requestAnimationFrame', 'queueMicrotask']);

/** open 위치의 `(` 에 대한 최상위 인자 개수. */
function countArguments(tokens: readonly Token[], open: number): number {
  let depth = 0;
  let count = 0;
  let sawAny = false;
  let lastWasComma = false;
  for (let j = open; j < tokens.length; j += 1) {
    const token = tokens[j] as Token;
    if (token.kind === 'punct' && (token.text === '(' || token.text === '[' || token.text === '{')) {
      depth += 1;
      if (depth > 1) sawAny = true;
      lastWasComma = false;
      continue;
    }
    if (token.kind === 'punct' && (token.text === ')' || token.text === ']' || token.text === '}')) {
      depth -= 1;
      if (depth === 0) {
        if (!sawAny) return 0;
        return lastWasComma ? count : count + 1;
      }
      lastWasComma = false;
      continue;
    }
    if (depth === 1 && token.kind === 'punct' && token.text === ',') {
      count += 1;
      lastWasComma = true;
      continue;
    }
    sawAny = true;
    lastWasComma = false;
  }
  return count + 1;
}

interface Hazard {
  line: number;
  rule: string;
  detail: string;
}

function findHazards(tokens: readonly Token[]): Hazard[] {
  const hazards: Hazard[] = [];
  const add = (token: Token, rule: string, detail: string): void => {
    hazards.push({ line: token.line, rule, detail });
  };
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] as Token;
    if (token.kind !== 'ident') continue;
    const name = token.text;
    const previous = tokens[i - 1];
    const next = tokens[i + 1];

    // 멤버 이름만으로 판정하는 것: 접근 형태와 상관없이 지역 시각·로케일·난수 API 이름이다.
    if (LOCAL_TIME_MEMBERS.has(name)) add(token, 'LOCAL_TIME', `${name}: 실행 환경의 시간대에 따라 값이 달라진다`);
    if (name === 'localeCompare' || name.startsWith('toLocale')) add(token, 'LOCALE', `${name}: 실행 환경의 로케일에 따라 값이 달라진다`);
    if (RANDOM_MEMBERS.has(name)) add(token, 'RANDOM', `${name}: 난수를 만든다`);

    if (isMemberAccess(tokens, i)) continue;
    // 객체 키(`{ process: 1 }`)와 형식 멤버는 전역 이름이 아니다.
    if (next !== undefined && next.kind === 'punct' && next.text === ':' && previous !== undefined && previous.kind === 'punct' && (previous.text === '{' || previous.text === ',')) continue;

    const dotted = next !== undefined && next.kind === 'punct' && (next.text === '.' || next.text === '?.') ? tokens[i + 2] : undefined;
    const bracketed = next !== undefined && next.kind === 'punct' && next.text === '[' && tokens[i + 2]?.kind === 'string' ? tokens[i + 2] : undefined;
    const memberName = dotted?.kind === 'ident' ? dotted.text : bracketed?.text;
    const isNew = previous !== undefined && previous.kind === 'ident' && previous.text === 'new';

    if (name === 'Date') {
      if (memberName === 'now') add(token, 'CLOCK', 'Date.now(): 주입 없는 현재 시각');
      else if (isNew) {
        if (next === undefined || !(next.kind === 'punct' && next.text === '(')) add(token, 'CLOCK', 'new Date: 인자 없는 현재 시각');
        else {
          const args = countArguments(tokens, i + 1);
          if (args === 0) add(token, 'CLOCK', 'new Date(): 인자 없는 현재 시각');
          else if (args >= 2) add(token, 'LOCAL_TIME', `new Date(인자 ${args}개): 실행 환경의 시간대로 해석한다`);
        }
      } else if (next !== undefined && next.kind === 'punct' && next.text === '(') {
        add(token, 'CLOCK', 'Date(): 현재 시각 문자열');
      }
    } else if (name === 'Math' && memberName === 'random') {
      add(token, 'RANDOM', 'Math.random(): 주입 없는 난수');
    } else if (name === 'performance') {
      add(token, 'CLOCK', 'performance: 주입 없는 시계');
    } else if (name === 'crypto') {
      add(token, 'RANDOM', 'crypto: 난수·해시 환경 의존');
    } else if (name === 'import' && next !== undefined && next.kind === 'punct' && next.text === '.') {
      add(token, 'ENVIRONMENT', 'import.meta: 실행 위치에 따라 달라진다');
    } else if (ENVIRONMENT_GLOBALS.has(name)) {
      add(token, 'ENVIRONMENT', `${name}: 실행 환경에 접근한다`);
    } else if (NETWORK_GLOBALS.has(name)) {
      add(token, 'NETWORK_CALL', `${name}: 네트워크에 접근한다`);
    } else if (TIMER_GLOBALS.has(name)) {
      add(token, 'TIMER', `${name}: 시계에 기대는 비동기 실행`);
    } else if (name === 'Intl') {
      add(token, 'LOCALE', 'Intl: 실행 환경의 로케일에 따라 값이 달라진다');
    }
  }
  return hazards;
}

function sortViolations(violations: Violation[]): Violation[] {
  return violations.sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    return a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0;
  });
}

function scanErrorViolation(file: string, error: unknown): Violation {
  if (error instanceof ScanError) return { file, line: error.line, rule: 'SCAN_ERROR', detail: error.message };
  throw error;
}

/** 엔진 소스 전체를 검사한다: 가져오기 경계(AC-001b)와 주입 없는 시계·난수·환경·네트워크 사용. */
export function checkEngineBoundary(files: readonly SourceFile[], engineRoot: string): Violation[] {
  const known = new Set(files.map((file) => file.path));
  const violations: Violation[] = [];
  for (const file of files) {
    let tokens: Token[];
    try {
      tokens = tokenize(file.text);
    } catch (error) {
      violations.push(scanErrorViolation(file.path, error));
      continue;
    }
    for (const ref of extractModuleRefs(tokens)) {
      if (ref.kind === 'require') {
        violations.push({ file: file.path, line: ref.line, rule: 'COMMONJS_REQUIRE', detail: `require(${ref.specifier ?? '식'}): ES 모듈 가져오기만 허용한다` });
      }
      if (ref.specifier === null) {
        if (ref.kind === 'dynamic') {
          violations.push({ file: file.path, line: ref.line, rule: 'DYNAMIC_SPECIFIER', detail: '동적 가져오기의 대상이 문자열 리터럴이 아니다' });
        }
        continue;
      }
      const category = classifyModule(ref.specifier, file.path, engineRoot);
      if (category !== null) {
        violations.push({ file: file.path, line: ref.line, rule: `MODULE_${category}`, detail: `'${ref.specifier}' 는 엔진 경계 밖이다 (${category})` });
        continue;
      }
      const base = posix.normalize(posix.join(posix.dirname(file.path), ref.specifier));
      if (resolveAmong(base, (candidate) => known.has(candidate)) === null) {
        violations.push({ file: file.path, line: ref.line, rule: 'UNRESOLVED_IMPORT', detail: `'${ref.specifier}' 가 가리키는 엔진 파일이 없다` });
      }
    }
    for (const hazard of findHazards(tokens)) {
      violations.push({ file: file.path, line: hazard.line, rule: hazard.rule, detail: hazard.detail });
    }
  }
  return sortViolations(violations);
}

// ───────────────────────── 숫자 리터럴 검사 (AC-001c) ─────────────────────────

export interface LiteralRules {
  /** 숫자 리터럴 선언이 허용되는 파일 (constants.ts, limits.ts). */
  exemptFiles: readonly string[];
  /** 업무 이름에 묶였지만 형식이 정한 상수처럼 업무 값이 아닌 자리. 항목마다 이유를 적는다. */
  allowlist: readonly { file: string; name: string; literal: string; reason: string }[];
  /** 이름과 상관없이 exemptFiles 밖에서 쓰면 안 되는 값 (비율 척도 10000 과 그 절반 5000). */
  scaleValues: readonly number[];
}

export interface LiteralReport {
  violations: Violation[];
  allowed: { file: string; name: string; literal: string }[];
  /** 면제 파일을 뺀 모든 파일에서 읽은 값 수준 숫자 리터럴 수 (검사가 비어 있지 않음을 보이는 데 쓴다). */
  numericLiterals: number;
}

const BUSINESS_STEMS = ['deduct', 'limit', 'rate', 'payout', 'copay', 'fixed', 'floor', 'cap', 'ratio'];

function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

function isBusinessName(name: string): boolean {
  return nameWords(name).some((word) => BUSINESS_STEMS.some((stem) => word.startsWith(stem)));
}

/** 숫자 리터럴이 오른쪽 피연산자인 연산자(대입·속성·비교·산술·기본값). */
const ASSIGN_LIKE = new Set(['=', ':', '+=', '-=', '*=', '/=', '%=', '**=', '??=', '||=', '&&=']);
const BINARY_LIKE = new Set(['===', '!==', '==', '!=', '<', '>', '<=', '>=', '+', '-', '*', '/', '%', '**', '??', '||', '&&']);
const UNARY_FOLLOWS = new Set(['return', 'case', 'typeof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'else', 'do']);

function isPunct(token: Token | undefined, texts?: ReadonlySet<string>): token is Token {
  return token !== undefined && token.kind === 'punct' && (texts === undefined || texts.has(token.text));
}

/** interface·type 선언 안쪽 토큰 표시: 형식 수준 리터럴(`payout: 0`)은 값이 아니다. */
function typeRegionMask(tokens: readonly Token[]): boolean[] {
  const mask = new Array<boolean>(tokens.length).fill(false);
  const closing: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] as Token;
    if (token.kind !== 'ident' || isMemberAccess(tokens, i)) continue;
    if (token.text === 'interface' && tokens[i + 1]?.kind === 'ident') {
      let open = i + 2;
      while (open < tokens.length && !(tokens[open]?.kind === 'punct' && tokens[open]?.text === '{')) open += 1;
      let depth = 0;
      let end = open;
      for (; end < tokens.length; end += 1) {
        const t = tokens[end] as Token;
        if (t.kind === 'punct' && t.text === '{') depth += 1;
        else if (t.kind === 'punct' && t.text === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      for (let k = i; k <= Math.min(end, tokens.length - 1); k += 1) mask[k] = true;
    } else if (token.text === 'type' && tokens[i + 1]?.kind === 'ident') {
      const after = tokens[i + 2];
      if (!(isPunct(after) && (after.text === '=' || after.text === '<'))) continue;
      let depth = 0;
      let end = i;
      for (; end < tokens.length; end += 1) {
        const t = tokens[end] as Token;
        if (t.kind === 'punct' && closing[t.text] !== undefined) depth += 1;
        else if (t.kind === 'punct' && (t.text === ')' || t.text === ']' || t.text === '}')) depth -= 1;
        else if (t.kind === 'punct' && t.text === ';' && depth <= 0) break;
      }
      for (let k = i; k <= Math.min(end, tokens.length - 1); k += 1) mask[k] = true;
    }
  }
  return mask;
}

/** 숫자 토큰 index 의 앞 또는 뒤 피연산자 가운데 업무 이름인 것을 돌려준다. */
function adjacentBusinessName(tokens: readonly Token[], index: number): string | null {
  // 왼쪽: `이름 연산자 [부호] 리터럴`
  let operatorIndex = index - 1;
  const sign = tokens[operatorIndex];
  if (isPunct(sign) && (sign.text === '-' || sign.text === '+')) {
    const before = tokens[operatorIndex - 1];
    const unary = before === undefined || (isPunct(before) && before.text !== ')' && before.text !== ']' && before.text !== '}') || (before.kind === 'ident' && UNARY_FOLLOWS.has(before.text));
    if (unary) operatorIndex -= 1;
  }
  const operator = tokens[operatorIndex];
  if (isPunct(operator) && (ASSIGN_LIKE.has(operator.text) || BINARY_LIKE.has(operator.text))) {
    const operand = tokens[operatorIndex - 1];
    const names: string[] = [];
    if (operand?.kind === 'ident') {
      names.push(operand.text);
      // `이름: 형식 = 리터럴` 의 형식 주석을 건너뛴다.
      if (operator.text === '=' && isPunct(tokens[operatorIndex - 2]) && tokens[operatorIndex - 2]?.text === ':' && tokens[operatorIndex - 3]?.kind === 'ident') {
        names.push((tokens[operatorIndex - 3] as Token).text);
      }
    } else if (operand?.kind === 'string' && /^[A-Za-z_$][\w$]*$/.test(operand.text)) {
      names.push(operand.text);
    }
    const found = names.find((name) => isBusinessName(name));
    if (found !== undefined) return found;
  }
  // 오른쪽: `리터럴 연산자 [부호/!] 이름(.속성)*`
  const rightOperator = tokens[index + 1];
  if (isPunct(rightOperator, BINARY_LIKE)) {
    let k = index + 2;
    while (isPunct(tokens[k]) && ['-', '+', '!'].includes((tokens[k] as Token).text)) k += 1;
    if (tokens[k]?.kind === 'ident') {
      while (isPunct(tokens[k + 1]) && ['.', '?.'].includes((tokens[k + 1] as Token).text) && tokens[k + 2]?.kind === 'ident') k += 2;
      const name = (tokens[k] as Token).text;
      if (isBusinessName(name)) return name;
    }
  }
  return null;
}

function numericValue(text: string): number {
  return Number(text.replace(/_/g, '').replace(/n$/, ''));
}

export function checkEngineLiterals(files: readonly SourceFile[], rules: LiteralRules): LiteralReport {
  const exempt = new Set(rules.exemptFiles);
  const violations: Violation[] = [];
  const allowed: LiteralReport['allowed'] = [];
  let numericLiterals = 0;
  for (const file of files) {
    let tokens: Token[];
    try {
      tokens = tokenize(file.text);
    } catch (error) {
      violations.push(scanErrorViolation(file.path, error));
      continue;
    }
    if (exempt.has(file.path)) continue;
    const typeOnly = typeRegionMask(tokens);
    tokens.forEach((token, index) => {
      if (token.kind !== 'number' || typeOnly[index] === true) return;
      numericLiterals += 1;
      const value = numericValue(token.text);
      if (rules.scaleValues.includes(value)) {
        violations.push({
          file: file.path,
          line: token.line,
          rule: 'SCALE_LITERAL',
          detail: `비율 척도 ${value} 를 리터럴 ${token.text} 로 썼다. constants.ts 에 선언한 이름을 쓴다`,
        });
      }
      const name = adjacentBusinessName(tokens, index);
      if (name === null) return;
      const permitted = rules.allowlist.some((entry) => entry.file === file.path && entry.name === name && entry.literal === token.text);
      if (permitted) {
        allowed.push({ file: file.path, name, literal: token.text });
        return;
      }
      violations.push({
        file: file.path,
        line: token.line,
        rule: 'BUSINESS_LITERAL',
        detail: `업무 값 이름 '${name}' 에 숫자 리터럴 ${token.text} 가 묶였다. 보험 업무 값은 프로필에서만 받는다`,
      });
    });
  }
  return { violations: sortViolations(violations), allowed, numericLiterals };
}
