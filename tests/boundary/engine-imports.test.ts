import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ScanError, checkEngineBoundary, classifyModule, extractModuleRefs, readSourceFiles, tokenize } from './source-scan';
import type { SourceFile, Violation } from './source-scan';

// AC-001b 가져오기 경계 검사: src/engine 에는 React·Next·DB 드라이버·fetch·fs·네트워크 모듈·생성형 AI SDK 가 없고
// 주입 없는 Date.now·Math.random 호출도 없다. 금지 항목을 일부러 더한 음성 시험에서는 검사가 실패한다.
// 검사 도구는 TypeScript 7 이 JS 컴파일러 API 를 싣지 않아(plan.md §G 후보 불가) 직접 만든 어휘 분석기다.
// 시험 자료: 아래 합성 소스는 검사기 시험용 문자열이며 실제 코드·보험 값이 아니다.

const ENGINE_ROOT = 'src/engine';
const ENGINE_DIR = fileURLToPath(new URL('../../src/engine', import.meta.url));
const realFiles = readSourceFiles(ENGINE_DIR, ENGINE_ROOT);

function check(text: string, path = 'src/engine/synthetic.ts'): Violation[] {
  return checkEngineBoundary([{ path, text }], ENGINE_ROOT);
}

function rules(text: string): string[] {
  return check(text).map((violation) => violation.rule);
}

describe('AC-001b 실제 src/engine 소스', () => {
  it('src/engine 의 모든 소스 파일을 읽었다 (빈 검사 방지)', () => {
    const paths = realFiles.map((file) => file.path);
    expect(paths.length).toBeGreaterThanOrEqual(14);
    expect(paths).toContain('src/engine/estimate.ts');
    expect(paths).toContain('src/engine/constants.ts');
    expect(paths.every((path) => path.startsWith('src/engine/') && path.endsWith('.ts'))).toBe(true);
    expect(realFiles.every((file) => file.text.length > 0)).toBe(true);
  });

  it('경계 위반이 하나도 없다', () => {
    expect(checkEngineBoundary(realFiles, ENGINE_ROOT)).toEqual([]);
  });

  it('가져오기는 모두 src/engine 안에 실제로 있는 파일을 가리키는 상대 경로다', () => {
    const known = new Set(realFiles.map((file) => file.path));
    let edges = 0;
    for (const file of realFiles) {
      for (const ref of extractModuleRefs(tokenize(file.text))) {
        edges += 1;
        expect(ref.specifier, `${file.path}:${ref.line}`).not.toBeNull();
        const specifier = ref.specifier as string;
        expect(specifier.startsWith('./'), `${file.path}:${ref.line} ${specifier}`).toBe(true);
        expect(known.has(`${ENGINE_ROOT}/${specifier.slice(2)}.ts`), `${file.path}:${ref.line} ${specifier}`).toBe(true);
      }
    }
    expect(edges).toBeGreaterThan(20);
  });
});

describe('모듈 분류 (classifyModule)', () => {
  const table: Array<[string, string, string | null]> = [
    ['react', 'src/engine/a.ts', 'REACT'],
    ['react-dom/server', 'src/engine/a.ts', 'REACT'],
    ['react/jsx-runtime', 'src/engine/a.ts', 'REACT'],
    ['next', 'src/engine/a.ts', 'NEXT'],
    ['next/server', 'src/engine/a.ts', 'NEXT'],
    ['next/headers', 'src/engine/a.ts', 'NEXT'],
    ['@next/font', 'src/engine/a.ts', 'NEXT'],
    ['pg', 'src/engine/a.ts', 'DB_DRIVER'],
    ['mysql2/promise', 'src/engine/a.ts', 'DB_DRIVER'],
    ['better-sqlite3', 'src/engine/a.ts', 'DB_DRIVER'],
    ['mongodb', 'src/engine/a.ts', 'DB_DRIVER'],
    ['ioredis', 'src/engine/a.ts', 'DB_DRIVER'],
    ['@prisma/client', 'src/engine/a.ts', 'DB_DRIVER'],
    ['drizzle-orm', 'src/engine/a.ts', 'DB_DRIVER'],
    ['drizzle-orm/pg-core', 'src/engine/a.ts', 'DB_DRIVER'],
    ['@supabase/supabase-js', 'src/engine/a.ts', 'DB_DRIVER'],
    ['http', 'src/engine/a.ts', 'NETWORK'],
    ['node:https', 'src/engine/a.ts', 'NETWORK'],
    ['net', 'src/engine/a.ts', 'NETWORK'],
    ['axios', 'src/engine/a.ts', 'NETWORK'],
    ['node-fetch', 'src/engine/a.ts', 'NETWORK'],
    ['undici', 'src/engine/a.ts', 'NETWORK'],
    ['ws', 'src/engine/a.ts', 'NETWORK'],
    ['fs', 'src/engine/a.ts', 'FILE_SYSTEM'],
    ['node:fs', 'src/engine/a.ts', 'FILE_SYSTEM'],
    ['fs/promises', 'src/engine/a.ts', 'FILE_SYSTEM'],
    ['node:fs/promises', 'src/engine/a.ts', 'FILE_SYSTEM'],
    ['openai', 'src/engine/a.ts', 'AI_SDK'],
    ['@anthropic-ai/sdk', 'src/engine/a.ts', 'AI_SDK'],
    ['ai', 'src/engine/a.ts', 'AI_SDK'],
    ['@ai-sdk/openai', 'src/engine/a.ts', 'AI_SDK'],
    ['@google/generative-ai', 'src/engine/a.ts', 'AI_SDK'],
    ['langchain', 'src/engine/a.ts', 'AI_SDK'],
    ['@langchain/core', 'src/engine/a.ts', 'AI_SDK'],
    ['node:child_process', 'src/engine/a.ts', 'NODE_BUILTIN'],
    ['crypto', 'src/engine/a.ts', 'NODE_BUILTIN'],
    ['node:path', 'src/engine/a.ts', 'NODE_BUILTIN'],
    ['lodash', 'src/engine/a.ts', 'BARE_PACKAGE'],
    ['zod', 'src/engine/a.ts', 'BARE_PACKAGE'],
    ['@scope/pkg', 'src/engine/a.ts', 'BARE_PACKAGE'],
    ['./numeric', 'src/engine/estimate.ts', null],
    ['../engine/numeric', 'src/engine/estimate.ts', null],
    ['../server/composition', 'src/engine/estimate.ts', 'OUTSIDE_ENGINE'],
    ['../../tests/fixtures/engine/profiles.fixture', 'src/engine/estimate.ts', 'FIXTURE'],
    ['./sub/../../other', 'src/engine/estimate.ts', 'OUTSIDE_ENGINE'],
    ['../../src/engine/numeric', 'src/engine/estimate.ts', null],
  ];

  it.each(table)('%s (%s) -> %s', (specifier, from, expected) => {
    expect(classifyModule(specifier, from, ENGINE_ROOT)).toBe(expected);
  });
});

describe('음성 시험: 금지 모듈을 일부러 더하면 검사가 실패한다', () => {
  const imports: Array<[string, string, string]> = [
    ['React', "import { useState } from 'react';", 'MODULE_REACT'],
    ['React DOM', "import { renderToString } from 'react-dom/server';", 'MODULE_REACT'],
    ['Next.js', "import { NextResponse } from 'next/server';", 'MODULE_NEXT'],
    ['DB 드라이버 pg', "import { Pool } from 'pg';", 'MODULE_DB_DRIVER'],
    ['DB 드라이버 Prisma', "import { PrismaClient } from '@prisma/client';", 'MODULE_DB_DRIVER'],
    ['DB 드라이버 Drizzle', "import { drizzle } from 'drizzle-orm/node-postgres';", 'MODULE_DB_DRIVER'],
    ['네트워크 http', "import http from 'node:http';", 'MODULE_NETWORK'],
    ['네트워크 axios', "import axios from 'axios';", 'MODULE_NETWORK'],
    ['네트워크 undici', "import { fetch } from 'undici';", 'MODULE_NETWORK'],
    ['fs', "import { readFileSync } from 'fs';", 'MODULE_FILE_SYSTEM'],
    ['node:fs', "import { readFileSync } from 'node:fs';", 'MODULE_FILE_SYSTEM'],
    ['fs/promises', "import { readFile } from 'node:fs/promises';", 'MODULE_FILE_SYSTEM'],
    ['생성형 AI SDK openai', "import OpenAI from 'openai';", 'MODULE_AI_SDK'],
    ['생성형 AI SDK Anthropic', "import Anthropic from '@anthropic-ai/sdk';", 'MODULE_AI_SDK'],
    ['생성형 AI SDK Vercel ai', "import { generateText } from 'ai';", 'MODULE_AI_SDK'],
    ['Node 내장 child_process', "import { execSync } from 'node:child_process';", 'MODULE_NODE_BUILTIN'],
    ['Node 내장 crypto', "import { randomUUID } from 'node:crypto';", 'MODULE_NODE_BUILTIN'],
    ['일반 외부 패키지', "import { z } from 'zod';", 'MODULE_BARE_PACKAGE'],
    ['시험 자료(fixture) 모듈', "import { makeProfile } from '../../tests/fixtures/engine/profiles.fixture';", 'MODULE_FIXTURE'],
    ['엔진 밖 상대 경로', "import { compose } from '../server/composition';", 'MODULE_OUTSIDE_ENGINE'],
    ['부수 효과 가져오기', "import 'fs';", 'MODULE_FILE_SYSTEM'],
    ['재내보내기', "export * from 'react';", 'MODULE_REACT'],
    ['이름 재내보내기', "export { readFileSync } from 'node:fs';", 'MODULE_FILE_SYSTEM'],
    ['형식 전용 가져오기도 경계 밖이면 거절', "import type { NextRequest } from 'next/server';", 'MODULE_NEXT'],
    ['동적 가져오기(문자열)', "const m = await import('node:fs');", 'MODULE_FILE_SYSTEM'],
    ['동적 가져오기(식)', 'const m = await import(name);', 'DYNAMIC_SPECIFIER'],
    ['동적 가져오기(템플릿)', 'const m = await import(`./${name}`);', 'DYNAMIC_SPECIFIER'],
    ['CommonJS require', "const fs = require('fs');", 'COMMONJS_REQUIRE'],
    ['import = require', "import fs = require('fs');", 'COMMONJS_REQUIRE'],
    ['없는 상대 파일', "import { x } from './does-not-exist';", 'UNRESOLVED_IMPORT'],
  ];

  it.each(imports)('%s', (_label, source, expectedRule) => {
    expect(rules(source)).toContain(expectedRule);
  });

  it('엔진 안의 상대 가져오기는 실제 파일이 있으면 통과한다', () => {
    const files: SourceFile[] = [
      { path: 'src/engine/a.ts', text: "import { b } from './b';\nimport type { C } from './c';\nexport const a = b;" },
      { path: 'src/engine/b.ts', text: 'export const b = 1;' },
      { path: 'src/engine/c.ts', text: 'export interface C { x: number }' },
    ];
    expect(checkEngineBoundary(files, ENGINE_ROOT)).toEqual([]);
  });

  it('위반 보고에는 파일 경로와 줄 번호가 들어 있다', () => {
    const found = check("const a = 1;\n\nimport fs from 'fs';\n", 'src/engine/where.ts');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ file: 'src/engine/where.ts', line: 3, rule: 'MODULE_FILE_SYSTEM' });
  });
});

describe('음성 시험: 시계·난수·환경·네트워크 호출', () => {
  const hazards: Array<[string, string, string]> = [
    ['Date.now()', 'const t = Date.now();', 'CLOCK'],
    ["Date['now']()", "const t = Date['now']();", 'CLOCK'],
    ['new Date()', 'const t = new Date();', 'CLOCK'],
    ['Date() 호출', 'const t = Date();', 'CLOCK'],
    ['performance.now()', 'const t = performance.now();', 'CLOCK'],
    ['Math.random()', 'const r = Math.random();', 'RANDOM'],
    ["Math['random']()", "const r = Math['random']();", 'RANDOM'],
    ['crypto.randomUUID()', 'const id = crypto.randomUUID();', 'RANDOM'],
    ['crypto.getRandomValues', 'crypto.getRandomValues(new Uint8Array(4));', 'RANDOM'],
    ['process.env', 'const v = process.env.TZ;', 'ENVIRONMENT'],
    ['process.hrtime', 'const v = process.hrtime();', 'ENVIRONMENT'],
    ['globalThis', 'const v = globalThis.foo;', 'ENVIRONMENT'],
    ['import.meta', 'const v = import.meta.url;', 'ENVIRONMENT'],
    ['fetch()', "const r = await fetch('https://example.invalid');", 'NETWORK_CALL'],
    ['globalThis.fetch', 'const f = globalThis.fetch;', 'ENVIRONMENT'],
    ['XMLHttpRequest', 'const x = new XMLHttpRequest();', 'NETWORK_CALL'],
    ['WebSocket', "const s = new WebSocket('wss://example.invalid');", 'NETWORK_CALL'],
    ['setTimeout', 'setTimeout(() => 1, 10);', 'TIMER'],
    ['setInterval', 'setInterval(() => 1, 10);', 'TIMER'],
    ['Intl', "const f = new Intl.NumberFormat('ko-KR');", 'LOCALE'],
    ['localeCompare', "const c = a.localeCompare(b);", 'LOCALE'],
    ['toLocaleString', 'const s = (1).toLocaleString();', 'LOCALE'],
    ['지역 시각 getter', 'const y = d.getFullYear();', 'LOCAL_TIME'],
    ['getTimezoneOffset', 'const o = d.getTimezoneOffset();', 'LOCAL_TIME'],
    ['인자 둘 이상의 Date 생성자(지역 시각)', 'const d = new Date(2026, 0, 1);', 'LOCAL_TIME'],
    ['템플릿 식 안의 Date.now()', 'const s = `${Date.now()}`;', 'CLOCK'],
  ];

  it.each(hazards)('%s', (_label, source, expectedRule) => {
    expect(rules(source)).toContain(expectedRule);
  });
});

describe('양성 시험: 주입된 시계와 결정적인 날짜 계산은 통과한다', () => {
  const allowed: Array<[string, string]> = [
    ['주입된 시계 deps.now()', 'export function f(deps: { now: () => number }) { return deps.now(); }'],
    ['객체의 now 속성', 'const clock = { now: () => 1 }; const t = clock.now();'],
    ['Date.UTC 로 만든 날짜', 'const d = new Date(Date.UTC(2026, 0, 1)); const y = d.getUTCFullYear();'],
    ['인자 하나인 Date 생성자', 'const d = new Date(0);'],
    ['Date 형식 이름만 쓰는 곳', 'type D = Date; const f = (d: Date) => d.getUTCDate();'],
    ['process 라는 이름의 속성', 'const o = { process: 1 }; const v = o.process;'],
    ['fetch 라는 이름의 속성', 'const o = { fetch: 1 }; const v = o.fetch;'],
    ['문자열 안의 금지어', "const s = \"import fs from 'fs'; Date.now(); Math.random()\";"],
    ['한 줄 주석 안의 금지어', "// import fs from 'fs'; Date.now(); Math.random();\nexport const a = 1;"],
    ['블록 주석 안의 금지어', "/* import fs from 'fs';\n Date.now(); */\nexport const a = 1;"],
    ['정규식 안의 따옴표와 나눗셈', "const r = /'|\"/u; const x = a / b / c;"],
    ['템플릿 문자열 안의 금지어 문자', 'const s = `Date.now() 와 Math.random() 은 글자일 뿐`;'],
  ];

  it.each(allowed)('%s', (_label, source) => {
    expect(check(source)).toEqual([]);
  });
});

describe('어휘 분석기', () => {
  it('닫히지 않은 문자열·주석·템플릿은 ScanError 를 던지고 검사는 SCAN_ERROR 로 거절한다 (닫힌 실패)', () => {
    for (const broken of ["const a = 'abc;", '/* 닫히지 않음', 'const a = `abc', 'const r = /abc;']) {
      expect(() => tokenize(broken), broken).toThrow(ScanError);
      expect(rules(broken), broken).toContain('SCAN_ERROR');
    }
  });

  it('줄 번호는 주석·문자열·템플릿 안의 줄바꿈을 센다', () => {
    const tokens = tokenize("// 한 줄\n/* 두\n줄 */\nconst a = `x\ny`;\nconst b = 1;");
    const b = tokens.find((token) => token.kind === 'ident' && token.text === 'b');
    expect(b?.line).toBe(6);
  });

  it('숫자 리터럴은 밑줄·16진·지수·BigInt 표기를 한 토큰으로 읽는다', () => {
    const numbers = tokenize('const a = 10_000 + 0x2710 + 1e4 + 10000n + 0.5 + .25;').filter((token) => token.kind === 'number');
    expect(numbers.map((token) => token.text)).toEqual(['10_000', '0x2710', '1e4', '10000n', '0.5', '.25']);
  });

  it('가져오기 종류를 구분한다', () => {
    const refs = extractModuleRefs(
      tokenize(
        [
          "import a from './a';",
          "import type { B } from './b';",
          "import './c';",
          "export * from './d';",
          "export { e } from './e';",
          "const f = await import('./f');",
          'const g = await import(name);',
          "const h = require('./h');",
        ].join('\n'),
      ),
    );
    expect(refs.map((ref) => [ref.kind, ref.specifier])).toEqual([
      ['import', './a'],
      ['import', './b'],
      ['side-effect', './c'],
      ['export-from', './d'],
      ['export-from', './e'],
      ['dynamic', './f'],
      ['dynamic', null],
      ['require', './h'],
    ]);
  });
});

describe('실제 파일에 금지 항목을 일부러 더한 변형은 검사가 실패한다', () => {
  it.each([
    ["import fs from 'node:fs';", 'MODULE_FILE_SYSTEM'],
    ["import { useState } from 'react';", 'MODULE_REACT'],
    ['export const leaked = Math.random();', 'RANDOM'],
    ['export const leaked = Date.now();', 'CLOCK'],
    ["export const leaked = fetch('https://example.invalid');", 'NETWORK_CALL'],
  ])('모든 엔진 파일 끝에 %s 를 더하면 그 파일에서 %s 가 나온다', (extra, expectedRule) => {
    for (const file of realFiles) {
      const mutated = realFiles.map((candidate) =>
        candidate.path === file.path ? { path: candidate.path, text: `${candidate.text}\n${extra}\n` } : candidate,
      );
      const found = checkEngineBoundary(mutated, ENGINE_ROOT);
      expect(found.map((violation) => [violation.file, violation.rule]), file.path).toEqual([[file.path, expectedRule]]);
    }
  });
});

describe('디렉터리 검사 (파일 시스템 경로)', () => {
  it('엔진 폴더를 복사해 금지 파일을 하나 더하면 하위 폴더까지 읽어 그 파일을 보고한다', () => {
    const root = mkdtempSync(join(tmpdir(), 'bodam-boundary-'));
    try {
      const engine = join(root, 'src', 'engine');
      mkdirSync(join(engine, 'nested'), { recursive: true });
      for (const file of realFiles) {
        writeFileSync(join(engine, file.path.slice(`${ENGINE_ROOT}/`.length)), readFileSync(join(ENGINE_DIR, file.path.slice(`${ENGINE_ROOT}/`.length))));
      }
      writeFileSync(join(engine, 'nested', 'evil.ts'), "import fs from 'node:fs';\nexport const t = Date.now();\n");
      writeFileSync(join(engine, 'notes.md'), "import fs from 'fs'; // 소스가 아닌 파일은 읽지 않는다\n");
      const files = readSourceFiles(engine, ENGINE_ROOT);
      expect(files.map((file) => file.path)).toContain('src/engine/nested/evil.ts');
      expect(files.map((file) => file.path)).not.toContain('src/engine/notes.md');
      const found = checkEngineBoundary(files, ENGINE_ROOT);
      expect(found.map((violation) => [violation.file, violation.rule]).sort()).toEqual([
        ['src/engine/nested/evil.ts', 'CLOCK'],
        ['src/engine/nested/evil.ts', 'MODULE_FILE_SYSTEM'],
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
