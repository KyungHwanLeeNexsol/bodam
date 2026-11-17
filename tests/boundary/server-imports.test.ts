import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ScanError, checkEngineBoundary, classifyModule, extractModuleRefs, isFixturePath, readSourceFiles, tokenize } from './source-scan';
import type { SourceFile, Violation } from './source-scan';

// M3.A 서버 가져오기 경계: src/server 는 시험 자료·DB 드라이버·AI SDK·네트워크 모듈을 가져오지 않고,
// src/engine 은 src/server 를 가져오지 않으며, Node 내장 모듈은 digest.ts 의 node:crypto 하나뿐이다.
// 기존 경계 시험(engine-imports 등)은 바꾸지 않고, 그 파일의 어휘 분석기(source-scan)를 읽기 전용으로 재사용한다.
// 시계·난수·환경·네트워크 호출 위험은 엔진 검사기의 규칙을 그대로 빌려 오되 가져오기 규칙은 서버 기준으로 따로 본다.

const SERVER_ROOT = 'src/server';
const ENGINE_ROOT = 'src/engine';
const DIGEST_FILE = 'src/server/digest.ts';
const SERVER_DIR = fileURLToPath(new URL('../../src/server', import.meta.url));
const ENGINE_DIR = fileURLToPath(new URL('../../src/engine', import.meta.url));
const serverFiles = readSourceFiles(SERVER_DIR, SERVER_ROOT);
const engineFiles = readSourceFiles(ENGINE_DIR, ENGINE_ROOT);

/** 엔진 검사기가 내는 규칙 가운데 가져오기가 아니라 실행 환경 의존(시계·난수·환경·네트워크 호출·타이머)을 뜻하는 것. */
const HAZARD_RULES = new Set(['CLOCK', 'RANDOM', 'LOCAL_TIME', 'LOCALE', 'ENVIRONMENT', 'NETWORK_CALL', 'TIMER', 'SCAN_ERROR']);

function isTestPath(path: string): boolean {
  return /(^|\/)(tests?|__tests__|spec)(\/|$)/i.test(path) || /\.(test|spec)(\.[cm]?[jt]sx?)?$/i.test(path);
}

function checkServerBoundary(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  const add = (file: string, line: number, rule: string, detail: string): void => {
    violations.push({ file, line, rule, detail });
  };
  for (const file of files) {
    let tokens;
    try {
      tokens = tokenize(file.text);
    } catch (error) {
      if (error instanceof ScanError) {
        add(file.path, error.line, 'SCAN_ERROR', error.message);
        continue;
      }
      throw error;
    }
    for (const ref of extractModuleRefs(tokens)) {
      if (ref.kind === 'require') {
        add(file.path, ref.line, 'COMMONJS_REQUIRE', 'ES 모듈 가져오기만 허용한다');
        continue;
      }
      if (ref.specifier === null) {
        add(file.path, ref.line, 'DYNAMIC_SPECIFIER', '동적 가져오기의 대상이 문자열 리터럴이 아니다');
        continue;
      }
      const specifier = ref.specifier;
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        const resolved = posix.normalize(posix.join(posix.dirname(file.path), specifier));
        if (isFixturePath(resolved) || isTestPath(resolved)) {
          add(file.path, ref.line, 'MODULE_TEST_OR_FIXTURE', `'${specifier}' 는 시험 또는 시험 자료 경로다`);
        } else if (!(resolved.startsWith(`${SERVER_ROOT}/`) || resolved.startsWith(`${ENGINE_ROOT}/`))) {
          add(file.path, ref.line, 'MODULE_OUTSIDE_SERVER_AND_ENGINE', `'${specifier}' 는 src/server·src/engine 밖이다`);
        }
        continue;
      }
      if (specifier === 'node:crypto' && file.path === DIGEST_FILE) {
        continue;
      }
      const category = classifyModule(specifier, file.path, SERVER_ROOT);
      add(file.path, ref.line, `MODULE_${category ?? 'UNKNOWN'}`, `'${specifier}' 는 서버 경계 밖이다 (${category ?? 'UNKNOWN'})`);
    }
  }
  for (const hazard of checkEngineBoundary(files, SERVER_ROOT)) {
    if (HAZARD_RULES.has(hazard.rule)) {
      violations.push(hazard);
    }
  }
  return violations;
}

function rulesOf(source: string, path = 'src/server/synthetic.ts'): string[] {
  return checkServerBoundary([{ path, text: source }]).map((violation) => violation.rule);
}

describe('실제 src/server 소스', () => {
  it('src/server 의 소스 파일을 읽었다 (빈 검사 방지)', () => {
    const paths = serverFiles.map((file) => file.path);
    expect(paths.length).toBeGreaterThanOrEqual(8);
    expect(paths).toContain(DIGEST_FILE);
    expect(paths).toContain('src/server/repo/memory/memory-repository.ts');
    expect(paths).toContain('src/server/repo/interfaces.ts');
    expect(paths.every((path) => path.startsWith('src/server/') && path.endsWith('.ts'))).toBe(true);
    expect(serverFiles.every((file) => file.text.length > 0)).toBe(true);
  });

  it('(a) 시험·시험 자료·DB 드라이버·AI SDK·네트워크 모듈 가져오기와 실행 환경 의존이 하나도 없다', () => {
    expect(checkServerBoundary(serverFiles)).toEqual([]);
  });

  it('(a) 모든 상대 가져오기는 src/server 또는 src/engine 안의 실제 파일을 가리킨다', () => {
    const known = new Set([...serverFiles, ...engineFiles].map((file) => file.path));
    let edges = 0;
    for (const file of serverFiles) {
      for (const ref of extractModuleRefs(tokenize(file.text))) {
        if (ref.specifier === null || !ref.specifier.startsWith('.')) {
          continue;
        }
        edges += 1;
        const resolved = posix.normalize(posix.join(posix.dirname(file.path), ref.specifier));
        expect(known.has(`${resolved}.ts`), `${file.path}:${ref.line} ${ref.specifier}`).toBe(true);
      }
    }
    expect(edges).toBeGreaterThanOrEqual(8);
  });

  it('(b) src/engine 은 src/server 를 가져오지 않는다', () => {
    let refs = 0;
    for (const file of engineFiles) {
      for (const ref of extractModuleRefs(tokenize(file.text))) {
        refs += 1;
        const specifier = ref.specifier ?? '';
        const resolved = specifier.startsWith('.') ? posix.normalize(posix.join(posix.dirname(file.path), specifier)) : specifier;
        expect(resolved.startsWith(`${SERVER_ROOT}`), `${file.path}:${ref.line} ${specifier}`).toBe(false);
        expect(/(^|\/)server(\/|$)/.test(specifier), `${file.path}:${ref.line} ${specifier}`).toBe(false);
      }
    }
    expect(refs).toBeGreaterThan(20);
  });

  it('(c) src/server 가 가져오는 패키지·내장 모듈은 digest.ts 의 node:crypto 하나뿐이다', () => {
    const external: Array<[string, string]> = [];
    for (const file of serverFiles) {
      for (const ref of extractModuleRefs(tokenize(file.text))) {
        if (ref.specifier !== null && !ref.specifier.startsWith('.')) {
          external.push([file.path, ref.specifier]);
        }
      }
    }
    expect(external).toEqual([[DIGEST_FILE, 'node:crypto']]);
  });

  it('(c) 서버 소스에 `node:` 접두 문자열은 digest.ts 에만 있다', () => {
    const withNodePrefix = serverFiles.filter((file) => /['"`]node:/.test(file.text)).map((file) => file.path);
    expect(withNodePrefix).toEqual([DIGEST_FILE]);
  });
});

describe('음성 시험: 금지 항목을 일부러 더하면 검사가 실패한다', () => {
  const cases: Array<[string, string, string, string?]> = [
    ['시험 폴더 가져오기', "import { x } from '../../tests/helpers';", 'MODULE_TEST_OR_FIXTURE'],
    ['시험 자료 폴더 가져오기', "import { x } from '../../tests/fixtures/server/actors.fixture';", 'MODULE_TEST_OR_FIXTURE'],
    ['.fixture 파일 가져오기', "import { x } from './seed.fixture';", 'MODULE_TEST_OR_FIXTURE'],
    ['fixtures 폴더(src 안) 가져오기', "import { x } from './fixtures/seed';", 'MODULE_TEST_OR_FIXTURE'],
    ['.test 파일 가져오기', "import { x } from './digest.test';", 'MODULE_TEST_OR_FIXTURE'],
    ['src 밖 상대 경로', "import { x } from '../../scripts/seed';", 'MODULE_OUTSIDE_SERVER_AND_ENGINE'],
    ['DB 드라이버 pg', "import { Pool } from 'pg';", 'MODULE_DB_DRIVER'],
    ['DB 드라이버 Prisma', "import { PrismaClient } from '@prisma/client';", 'MODULE_DB_DRIVER'],
    ['DB 드라이버 better-sqlite3', "import Database from 'better-sqlite3';", 'MODULE_DB_DRIVER'],
    ['생성형 AI SDK', "import Anthropic from '@anthropic-ai/sdk';", 'MODULE_AI_SDK'],
    ['네트워크 node:http', "import http from 'node:http';", 'MODULE_NETWORK'],
    ['네트워크 axios', "import axios from 'axios';", 'MODULE_NETWORK'],
    ['파일 시스템 node:fs', "import { readFileSync } from 'node:fs';", 'MODULE_FILE_SYSTEM'],
    ['digest.ts 밖의 node:crypto', "import { createHash } from 'node:crypto';", 'MODULE_NODE_BUILTIN'],
    ['접두 없는 crypto', "import { createHash } from 'crypto';", 'MODULE_NODE_BUILTIN', 'src/server/digest.ts'],
    ['다른 내장 모듈 node:path 는 digest.ts 에서도 금지', "import { join } from 'node:path';", 'MODULE_NODE_BUILTIN', 'src/server/digest.ts'],
    ['일반 외부 패키지', "import { z } from 'zod';", 'MODULE_BARE_PACKAGE'],
    ['부수 효과 가져오기', "import 'node:fs';", 'MODULE_FILE_SYSTEM'],
    ['재내보내기', "export * from 'pg';", 'MODULE_DB_DRIVER'],
    ['CommonJS require', "const fs = require('fs');", 'COMMONJS_REQUIRE'],
    ['동적 가져오기(문자열)', "const m = await import('node:fs');", 'MODULE_FILE_SYSTEM'],
    ['동적 가져오기(식)', 'const m = await import(name);', 'DYNAMIC_SPECIFIER'],
    ['Date.now()', 'export const t = () => Date.now();', 'CLOCK'],
    ['인자 없는 new Date()', 'export const t = () => new Date();', 'CLOCK'],
    ['Math.random()', 'export const r = () => Math.random();', 'RANDOM'],
    ['crypto.randomUUID()', 'export const r = () => crypto.randomUUID();', 'RANDOM'],
    ['fetch 호출', "export const f = () => fetch('https://example.invalid');", 'NETWORK_CALL'],
    ['process 접근', 'export const e = process.env.X;', 'ENVIRONMENT'],
    ['setTimeout', 'export const t = () => setTimeout(() => 1, 1);', 'TIMER'],
  ];

  it.each(cases)('%s', (_label, source, expectedRule, path) => {
    expect(rulesOf(source, path)).toContain(expectedRule);
  });

  it('허용되는 가져오기는 통과한다: 서버 안, 엔진, digest.ts 의 node:crypto', () => {
    expect(rulesOf("import { isUsable } from '../engine/usability';\nimport type { Actor } from './domain/actor';", 'src/server/audit.ts')).toEqual([]);
    expect(rulesOf("import { createHash } from 'node:crypto';\nexport const h = () => createHash('sha256');", DIGEST_FILE)).toEqual([]);
    expect(rulesOf("import type { Repository } from '../interfaces';", 'src/server/repo/memory/x.ts')).toEqual([]);
  });

  it('상대 경로는 정규화해서 판정한다 (우회 경로로 시험 자료를 가져올 수 없다)', () => {
    expect(rulesOf("import { x } from './domain/../../../tests/fixtures/server/clock.fixture';")).toContain('MODULE_TEST_OR_FIXTURE');
  });
});
