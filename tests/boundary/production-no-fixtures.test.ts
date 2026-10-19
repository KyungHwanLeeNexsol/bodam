import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { directoryReader, memoryReader } from './fixture-reach';
import { isTestPath, walkProductionImports } from './production-reach';
import { extractModuleRefs, readSourceFiles, tokenize } from './source-scan';

// AC-010b (M4 에서 실제 운영 진입점으로 닫는다): 운영 구성 진입점에서 시험 자료(fixture)·시험 모듈로 가는 가져오기 경로가 없다.
// 운영 진입점 = src/server/composition.ts 와 src/app/** 의 모든 파일(route.ts·layout 등 Next.js 가 직접 부르는 파일 포함).
// 여기서 따라가는 그래프에는 그 파일들이 가져오는 src/server·src/engine 의 모든 파일(전이 포함)이 들어간다.
// 검사기가 비어 있지 않음을 보이려고 (1) 실제 그래프의 크기와 구성, (2) 일부러 위반하는 합성 진입점(직접·전이·상대 경로·별칭 표기)이 실패함을 함께 시험한다.
// 합성 소스는 검사기 시험용 문자열이며 실제 코드가 아니다.

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const APP_DIR = fileURLToPath(new URL('../../src/app', import.meta.url));
const COMPOSITION = 'src/server/composition.ts';

const appFiles = readSourceFiles(APP_DIR, 'src/app').map((file) => file.path);
const PRODUCTION_ENTRIES = [COMPOSITION, ...appFiles];
const realWalk = walkProductionImports(PRODUCTION_ENTRIES, directoryReader(REPO_ROOT));

describe('실제 운영 진입점', () => {
  it('진입점 목록이 비어 있지 않다: composition.ts 와 src/app 의 서비스 연결·두 route.ts 가 모두 들어 있다', () => {
    expect(PRODUCTION_ENTRIES).toContain(COMPOSITION);
    expect(PRODUCTION_ENTRIES).toContain('src/app/services.ts');
    expect(PRODUCTION_ENTRIES).toContain('src/app/api/clinics/[slug]/catalog/route.ts');
    expect(PRODUCTION_ENTRIES).toContain('src/app/api/clinics/[slug]/insurance/options/route.ts');
    expect(appFiles.every((path) => path.startsWith('src/app/'))).toBe(true);
  });

  it('진입점에서 시험 자료·시험 모듈로 가는 경로가 하나도 없다 (찾은 것이 0건)', () => {
    expect(realWalk.findings).toEqual([]);
  });

  it('따라간 그래프가 실제로 서버·엔진 소스를 지나갔다 (빈 검사 방지)', () => {
    expect(realWalk.files.length).toBeGreaterThanOrEqual(20);
    for (const expected of [
      COMPOSITION,
      'src/app/services.ts',
      'src/server/api/catalog.ts',
      'src/server/api/options.ts',
      'src/server/api/http.ts',
      'src/server/idle-policy.ts',
      'src/server/rule-scope.ts',
      'src/server/repo/memory/memory-repository.ts',
      'src/engine/validate.ts',
    ]) {
      expect(realWalk.files, expected).toContain(expected);
    }
  });

  it('따라간 모든 파일은 src/ 안에 있고 tests/ 나 시험 파일이 하나도 없다', () => {
    expect(realWalk.files.every((path) => path.startsWith('src/'))).toBe(true);
    expect(realWalk.files.filter((path) => isTestPath(path) || /fixture/i.test(path))).toEqual([]);
  });

  it('운영 연결(services.ts)은 composition.ts 를 가져온다 (route → services → composition)', () => {
    const services = readSourceFiles(APP_DIR, 'src/app').find((file) => file.path === 'src/app/services.ts')!;
    expect(extractModuleRefs(tokenize(services.text)).map((ref) => ref.specifier)).toContain('../server/composition');
  });

  it('composition.ts 와 src/app 소스는 시험 출처 이름(TEST_FIXTURE, DEMO)을 문자열로 쓰지 않는다 (허용 출처는 OPERATING 하나)', () => {
    for (const file of readSourceFiles(APP_DIR, 'src/app').concat(readSourceFiles(fileURLToPath(new URL('../../src/server', import.meta.url)), 'src/server').filter((entry) => entry.path === COMPOSITION))) {
      const literals = tokenize(file.text)
        .filter((token) => token.kind === 'string')
        .map((token) => token.text);
      expect(literals.filter((text) => text === 'TEST_FIXTURE' || text === 'DEMO'), file.path).toEqual([]);
      const identifiers = tokenize(file.text)
        .filter((token) => token.kind === 'ident')
        .map((token) => token.text);
      expect(identifiers.filter((text) => text === 'TEST_FIXTURE' || text === 'DEMO'), file.path).toEqual([]);
    }
  });

  it('모든 route.ts 의 서비스 취득은 한 곳(src/app/services.ts 의 getApiServices)뿐이다', () => {
    for (const path of appFiles.filter((entry) => entry.endsWith('/route.ts'))) {
      const text = readSourceFiles(APP_DIR, 'src/app').find((file) => file.path === path)!.text;
      const specifiers = extractModuleRefs(tokenize(text)).map((ref) => ref.specifier);
      expect(specifiers.filter((specifier) => /services$/.test(specifier ?? '')), path).toHaveLength(1);
      expect(text.match(/getApiServices\(\)/g), path).toHaveLength(1);
    }
  });
});

// ───────────────────────── 음성 시험: 일부러 위반하면 검사기가 실패한다 ─────────────────────────

/** 깨끗한 합성 운영 구성: 진입점 → 서비스 연결 → 서버 → 엔진. 각 시험은 한 군데만 바꾼다. */
function clean(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    [COMPOSITION]: "import { build } from './lib/build';\nexport const compose = build;\n",
    'src/server/lib/build.ts': "import { estimate } from '../../engine/estimate';\nexport const build = estimate;\n",
    'src/engine/estimate.ts': 'export const estimate = 1;\n',
    'src/app/services.ts': "import { compose } from '../server/composition';\nexport const getApiServices = () => compose;\n",
    'src/app/api/clinics/[slug]/catalog/route.ts': "import { getApiServices } from '../../../../services';\nexport const GET = () => getApiServices();\n",
    ...overrides,
  };
}

function walk(overrides: Record<string, string> = {}, entries: string[] = [COMPOSITION, 'src/app/services.ts', 'src/app/api/clinics/[slug]/catalog/route.ts']) {
  return walkProductionImports(entries, memoryReader(clean(overrides)));
}

const FIXTURE_FILES = {
  'tests/fixtures/server/actors.fixture.ts': 'export const actor = 1;\n',
  'tests/fixtures/server/repo.fixture.ts': "import { actor } from './actors.fixture';\nexport const repo = actor;\n",
  'tests/api/helpers.ts': 'export const helper = 1;\n',
  'src/server/seed.fixture.ts': 'export const seed = 1;\n',
  'src/server/fixtures/data.ts': 'export const data = 1;\n',
  'src/server/lib/real.test.ts': 'export const t = 1;\n',
};

describe('음성 시험: 깨끗한 합성 구성은 통과하고 위반 구성은 실패한다', () => {
  it('깨끗한 합성 구성: 찾은 것이 0건이고 모든 파일을 따라갔다', () => {
    const result = walk();
    expect(result.findings).toEqual([]);
    expect(result.files.sort()).toEqual(
      [COMPOSITION, 'src/app/api/clinics/[slug]/catalog/route.ts', 'src/app/services.ts', 'src/engine/estimate.ts', 'src/server/lib/build.ts'].sort(),
    );
  });

  const direct: Array<[string, Record<string, string>, string]> = [
    ['composition.ts 가 fixture 를 상대 경로로 직접 가져온다', { [COMPOSITION]: "import { repo } from '../../tests/fixtures/server/repo.fixture';\nexport const compose = repo;\n" }, 'FIXTURE_PATH'],
    ['composition.ts 가 fixture 를 별칭 @/ 로 가져온다', { [COMPOSITION]: "import { repo } from '@/../tests/fixtures/server/repo.fixture';\nexport const compose = repo;\n" }, 'FIXTURE_PATH'],
    ['composition.ts 가 fixture 를 별칭 ~/ 로 가져온다', { [COMPOSITION]: "import { repo } from '~/../tests/fixtures/server/repo.fixture';\nexport const compose = repo;\n" }, 'FIXTURE_PATH'],
    ['composition.ts 가 fixture 를 루트 기준 경로(tests/…)로 가져온다', { [COMPOSITION]: "import { repo } from 'tests/fixtures/server/repo.fixture';\nexport const compose = repo;\n" }, 'FIXTURE_PATH'],
    ['composition.ts 가 src 안의 .fixture 파일을 src/… 기준 경로로 가져온다', { [COMPOSITION]: "import { seed } from 'src/server/seed.fixture';\nexport const compose = seed;\n" }, 'FIXTURE_PATH'],
    ['composition.ts 가 src 안의 fixtures 폴더를 @/ 로 가져온다', { [COMPOSITION]: "import { data } from '@/server/fixtures/data';\nexport const compose = data;\n" }, 'FIXTURE_PATH'],
    ['composition.ts 가 fixture 가 아닌 시험 폴더의 파일을 가져온다', { [COMPOSITION]: "import { helper } from '../../tests/api/helpers';\nexport const compose = helper;\n" }, 'TEST_PATH'],
    ['composition.ts 가 *.test.ts 를 가져온다', { [COMPOSITION]: "import { t } from './lib/real.test';\nexport const compose = t;\n" }, 'TEST_PATH'],
    ['route.ts 가 fixture 를 직접 가져온다', { 'src/app/api/clinics/[slug]/catalog/route.ts': "import { repo } from '../../../../../../tests/fixtures/server/repo.fixture';\nexport const GET = () => repo;\n" }, 'FIXTURE_PATH'],
    ['route.ts 가 fixture 를 별칭으로 가져온다', { 'src/app/api/clinics/[slug]/catalog/route.ts': "import { repo } from '@/../tests/fixtures/server/repo.fixture';\nexport const GET = () => repo;\n" }, 'FIXTURE_PATH'],
    ['services.ts 가 fixture 를 가져온다', { 'src/app/services.ts': "import { repo } from '../../tests/fixtures/server/repo.fixture';\nexport const getApiServices = () => repo;\n" }, 'FIXTURE_PATH'],
    ['재내보내기(export … from)로 fixture 를 가져온다', { [COMPOSITION]: "export { repo } from '../../tests/fixtures/server/repo.fixture';\n" }, 'FIXTURE_PATH'],
    ['부수 효과 가져오기로 fixture 를 가져온다', { [COMPOSITION]: "import '../../tests/fixtures/server/repo.fixture';\nexport const compose = 1;\n" }, 'FIXTURE_PATH'],
    ['형식 전용 가져오기(import type)도 막는다', { [COMPOSITION]: "import type { repo } from '../../tests/fixtures/server/repo.fixture';\nexport const compose = 1;\n" }, 'FIXTURE_PATH'],
    ['문자열 리터럴 동적 가져오기로 fixture 를 가져온다', { [COMPOSITION]: "export const load = () => import('../../tests/fixtures/server/repo.fixture');\n" }, 'FIXTURE_PATH'],
    ['상대 경로를 돌려 써서 fixture 에 닿는다 (./a/../../…)', { [COMPOSITION]: "import { repo } from './lib/../../../tests/fixtures/server/repo.fixture';\nexport const compose = repo;\n" }, 'FIXTURE_PATH'],
    ['시험 러너 패키지(vitest)를 가져온다', { [COMPOSITION]: "import { vi } from 'vitest';\nexport const compose = vi;\n" }, 'TEST_RUNNER_PACKAGE'],
    ['이름에 fixture 가 든 패키지를 가져온다', { [COMPOSITION]: "import data from 'some-fixture-pack';\nexport const compose = data;\n" }, 'FIXTURE_PACKAGE'],
  ];

  it.each(direct)('%s -> 실패', (_label, overrides, reason) => {
    const result = walk({ ...FIXTURE_FILES, ...overrides });
    expect(result.findings.map((finding) => finding.reason)).toContain(reason);
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
  });

  const transitive: Array<[string, Record<string, string>]> = [
    [
      '서버 안쪽 파일이 fixture 를 가져온다 (composition → lib/build → fixture)',
      { 'src/server/lib/build.ts': "import { repo } from '../../../tests/fixtures/server/repo.fixture';\nexport const build = repo;\n" },
    ],
    [
      '엔진 안쪽 파일이 fixture 를 가져온다 (composition → build → engine → fixture)',
      { 'src/engine/estimate.ts': "import { actor } from '../../tests/fixtures/server/actors.fixture';\nexport const estimate = actor;\n" },
    ],
    [
      '세 단계 뒤에서 별칭으로 fixture 를 가져온다 (route → services → composition → build → fixture)',
      { 'src/server/lib/build.ts': "import { repo } from '@/../tests/fixtures/server/repo.fixture';\nexport const build = repo;\n" },
    ],
    [
      'src/app 의 다른 파일(layout)이 fixture 를 가져온다',
      { 'src/app/layout.tsx': "import { repo } from '../../tests/fixtures/server/repo.fixture';\nexport default function Layout() { return repo; }\n" },
    ],
  ];

  it.each(transitive)('전이 경로: %s -> 실패하고 경로(chain)가 진입점에서 fixture 까지 이어진다', (_label, overrides) => {
    const entries = [COMPOSITION, 'src/app/services.ts', 'src/app/api/clinics/[slug]/catalog/route.ts', ...('src/app/layout.tsx' in overrides ? ['src/app/layout.tsx'] : [])];
    const result = walk({ ...FIXTURE_FILES, ...overrides }, entries);
    const fixtureFinding = result.findings.find((finding) => finding.reason === 'FIXTURE_PATH');
    expect(fixtureFinding).toBeDefined();
    expect(fixtureFinding!.chain.length).toBeGreaterThanOrEqual(2);
    expect(entries).toContain(fixtureFinding!.chain[0]);
    expect(fixtureFinding!.chain.at(-1)).toMatch(/fixture/);
  });

  it('fixture 에 닿는 파일이 진입점에서 닿지 않으면 보고하지 않는다 (도달성만 본다)', () => {
    const result = walk({ ...FIXTURE_FILES, 'src/server/unused.ts': "import { repo } from '../../tests/fixtures/server/repo.fixture';\nexport const unused = repo;\n" });
    expect(result.findings).toEqual([]);
  });

  it('닫힌 실패: 가져오기를 해석하지 못하면 통과시키지 않는다', () => {
    const result = walk({ [COMPOSITION]: "import { gone } from './lib/missing';\nexport const compose = gone;\n" });
    expect(result.findings.map((finding) => finding.reason)).toEqual(['UNRESOLVED_IMPORT']);
  });

  it('닫힌 실패: 존재하지 않는 진입점은 UNRESOLVED_IMPORT 로 보고한다', () => {
    const result = walkProductionImports(['src/server/composition.ts'], memoryReader({}));
    expect(result.findings.map((finding) => finding.reason)).toEqual(['UNRESOLVED_IMPORT']);
  });

  it('닫힌 실패: 식으로 쓴 동적 가져오기와 require 는 DYNAMIC_SPECIFIER', () => {
    const result = walk({ [COMPOSITION]: "export const a = (name) => import(name);\nexport const b = (name) => require(name);\n" });
    expect(result.findings.map((finding) => finding.reason)).toEqual(['DYNAMIC_SPECIFIER', 'DYNAMIC_SPECIFIER']);
  });

  it('닫힌 실패: 어디를 가리키는지 알 수 없는 별칭(#…)과 절대 경로는 보고한다', () => {
    const hash = walk({ [COMPOSITION]: "import { x } from '#internal/x';\nexport const compose = x;\n" });
    expect(hash.findings.map((finding) => finding.reason)).toEqual(['UNKNOWN_ALIAS']);
    for (const absolute of ['/home/build/seed', 'C:/work/seed', 'file:///work/seed']) {
      const result = walk({ [COMPOSITION]: `import { x } from '${absolute}';\nexport const compose = x;\n` });
      expect(result.findings.map((finding) => finding.reason), absolute).toEqual(['ABSOLUTE_PATH']);
    }
  });

  it('닫힌 실패: 어휘 분석이 불가능한 소스(닫히지 않은 문자열)는 SCAN_ERROR', () => {
    const result = walk({ [COMPOSITION]: "import { x } from './lib/build;\n" });
    expect(result.findings.map((finding) => finding.reason)).toEqual(['SCAN_ERROR']);
  });

  it('진입점 자신이 시험 파일을 가리키면 위반이다', () => {
    const fixtureEntry = walkProductionImports(['tests/fixtures/server/actors.fixture.ts'], memoryReader(FIXTURE_FILES));
    expect(fixtureEntry.findings.map((finding) => finding.reason)).toEqual(['FIXTURE_PATH']);
    const testEntry = walkProductionImports(['tests/api/helpers.ts'], memoryReader(FIXTURE_FILES));
    expect(testEntry.findings.map((finding) => finding.reason)).toEqual(['TEST_PATH']);
  });

  it('외부 패키지(next, react, node 내장)는 따라가지 않고 위반도 아니다', () => {
    const result = walk({ [COMPOSITION]: "import { NextResponse } from 'next/server';\nimport type { ReactNode } from 'react';\nimport { x } from '@scope/pkg';\nexport const compose = [NextResponse, x];\n" });
    expect(result.findings).toEqual([]);
  });
});

describe('isTestPath', () => {
  const table: Array<[string, boolean]> = [
    ['tests/api/helpers.ts', true],
    ['src/tests/a.ts', true],
    ['src/__tests__/a.ts', true],
    ['src/server/a.test.ts', true],
    ['src/server/a.spec.tsx', true],
    ['src/server/a.ts', false],
    ['src/server/latest/a.ts', false],
    ['src/server/contest.ts', false],
  ];
  it.each(table)('%s -> %s', (path, expected) => {
    expect(isTestPath(path)).toBe(expected);
  });
});
