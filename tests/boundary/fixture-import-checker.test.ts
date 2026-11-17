import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { directoryReader, findFixtureReach, isFixturePath, memoryReader, walkImports } from './fixture-reach';

// AC-010b (증거만, 닫는 곳은 M4): 운영 구성 진입점에서 시험 자료(fixture) 모듈로 가는 가져오기 경로가 없어야 한다.
// 운영 구성 진입점(src/server/composition.*)은 Next.js 골격과 함께 M4 에서 처음 생기므로 M1.4 는
// (1) 검사기, (2) 합성(가짜) 진입점에 대한 음성 시험, (3) 실제 엔진 코드에 대한 적용만 증거로 낸다.
// 시험 자료: 아래 합성 소스는 검사기 시험용 문자열이며 실제 코드·보험 값이 아니다.

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ENTRY = 'src/server/composition.ts';

/** 합성 운영 구성: 깨끗한 기본 그래프. 각 시험은 여기서 한 군데만 바꾼다. */
function syntheticFiles(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    [ENTRY]: "import { loadRules } from './rules-loader';\nimport { estimate } from '../engine/estimate';\nexport const composed = { loadRules, estimate };\n",
    'src/server/rules-loader.ts': "import { helper } from './lib';\nexport const loadRules = () => helper;\n",
    'src/server/lib/index.ts': 'export const helper = 1;\n',
    'src/engine/estimate.ts': 'export const estimate = () => 1;\n',
    ...overrides,
  };
}

function reach(overrides: Record<string, string> = {}, entries: string[] = [ENTRY]) {
  return findFixtureReach(entries, memoryReader(syntheticFiles(overrides)));
}

describe('isFixturePath', () => {
  const table: Array<[string, boolean]> = [
    ['tests/fixtures/engine/profiles.fixture.ts', true],
    ['src/server/fixtures/seed.ts', true],
    ['src/data/profiles.fixture.ts', true],
    ['src/data/profiles.fixtures.ts', true],
    ['src/__fixtures__/a.ts', true],
    ['src/engine/estimate.ts', false],
    ['src/server/composition.ts', false],
    ['src/fixturesque/a.ts', false],
    ['src/server/prefixture.ts', false],
  ];

  it.each(table)('%s -> %s', (path, expected) => {
    expect(isFixturePath(path)).toBe(expected);
  });
});

describe('음성 시험: 합성 운영 구성 진입점', () => {
  it('깨끗한 진입점은 통과한다 (index.ts 해석 포함)', () => {
    const walked = walkImports([ENTRY], memoryReader(syntheticFiles()));
    expect(walked.findings).toEqual([]);
    expect(walked.files.sort()).toEqual(['src/engine/estimate.ts', 'src/server/composition.ts', 'src/server/lib/index.ts', 'src/server/rules-loader.ts']);
  });

  it('시험 자료를 직접 가져오면 실패한다', () => {
    const found = reach({
      [ENTRY]: "import { makeProfile } from '../../tests/fixtures/engine/profiles.fixture';\nexport const x = makeProfile;\n",
      'tests/fixtures/engine/profiles.fixture.ts': 'export const makeProfile = 1;\n',
    });
    expect(found).toEqual([{ reason: 'FIXTURE_PATH', target: 'tests/fixtures/engine/profiles.fixture.ts', chain: [ENTRY, 'tests/fixtures/engine/profiles.fixture.ts'] }]);
  });

  it('두 단계 건너 가져와도 실패한다 (경로 전체가 보고된다)', () => {
    const found = reach({
      'src/server/rules-loader.ts': "import { seed } from '../fixtures/seed';\nexport const loadRules = () => seed;\n",
      'src/fixtures/seed.ts': 'export const seed = 1;\n',
    });
    expect(found).toEqual([{ reason: 'FIXTURE_PATH', target: 'src/fixtures/seed.ts', chain: [ENTRY, 'src/server/rules-loader.ts', 'src/fixtures/seed.ts'] }]);
  });

  it('index.ts 를 거쳐 도달해도 실패한다', () => {
    const found = reach({
      'src/server/lib/index.ts': "export * from '../../data/profiles.fixture';\n",
      'src/data/profiles.fixture.ts': 'export const a = 1;\n',
    });
    expect(found.map((finding) => [finding.reason, finding.target])).toEqual([['FIXTURE_PATH', 'src/data/profiles.fixture.ts']]);
    expect(found[0]?.chain).toEqual([ENTRY, 'src/server/rules-loader.ts', 'src/server/lib/index.ts', 'src/data/profiles.fixture.ts']);
  });

  it('재내보내기·형식 전용 가져오기·동적 가져오기(문자열)로 도달해도 실패한다', () => {
    for (const source of [
      "export * from '../../tests/fixtures/engine/mappings.fixture';\n",
      "import type { X } from '../../tests/fixtures/engine/types.fixture';\nexport type Y = X;\n",
      "export const load = () => import('../../tests/fixtures/engine/lines.fixture');\n",
      "import '../../tests/fixtures/engine/side-effect.fixture';\n",
    ]) {
      const found = reach({ [ENTRY]: source });
      expect(found.map((finding) => finding.reason), source).toEqual(['FIXTURE_PATH']);
    }
  });

  it('.js 확장자로 쓴 가져오기도 .ts 소스로 해석해 따라간다', () => {
    const found = reach({
      [ENTRY]: "import { loadRules } from './rules-loader.js';\nexport const x = loadRules;\n",
      'src/server/rules-loader.ts': "import { seed } from '../fixtures/seed.js';\nexport const loadRules = () => seed;\n",
      'src/fixtures/seed.ts': 'export const seed = 1;\n',
    });
    expect(found.map((finding) => finding.target)).toEqual(['src/fixtures/seed.ts']);
  });

  it('이름에 fixture 가 든 외부 패키지를 가져오면 실패한다', () => {
    for (const specifier of ['test-fixtures', '@acme/fixtures', 'fixture-data/profiles']) {
      const found = reach({ [ENTRY]: `import data from '${specifier}';\nexport const x = data;\n` });
      expect(found.map((finding) => [finding.reason, finding.target]), specifier).toEqual([['FIXTURE_PACKAGE', specifier]]);
    }
  });

  it('식으로 만든 동적 가져오기·없는 파일·읽을 수 없는 소스는 닫힌 실패한다', () => {
    expect(reach({ [ENTRY]: 'export const load = (name: string) => import(name);\n' }).map((finding) => finding.reason)).toEqual(['DYNAMIC_SPECIFIER']);
    expect(reach({ [ENTRY]: "import { x } from './missing';\nexport const y = x;\n" }).map((finding) => finding.reason)).toEqual(['UNRESOLVED_IMPORT']);
    expect(reach({ [ENTRY]: "const s = 'abc;\n" }).map((finding) => finding.reason)).toEqual(['SCAN_ERROR']);
  });

  it('순환 가져오기는 끝나고, 순환 안쪽의 시험 자료도 찾아낸다', () => {
    const cyclic = reach({
      'src/server/rules-loader.ts': "import { composed } from './composition';\nexport const loadRules = () => composed;\n",
    });
    expect(cyclic).toEqual([]);
    const withFixture = reach({
      'src/server/rules-loader.ts': "import { composed } from './composition';\nimport { seed } from '../fixtures/seed';\nexport const loadRules = () => [composed, seed];\n",
      'src/fixtures/seed.ts': 'export const seed = 1;\n',
    });
    expect(withFixture.map((finding) => finding.target)).toEqual(['src/fixtures/seed.ts']);
  });

  it('진입점이 여럿이면 모두 검사하고, 진입점 파일이 없으면 UNRESOLVED_IMPORT 다', () => {
    const found = reach({ 'src/server/other.ts': "import { x } from '../fixtures/seed';\nexport const y = x;\n", 'src/fixtures/seed.ts': 'export const x = 1;\n' }, [ENTRY, 'src/server/other.ts']);
    expect(found.map((finding) => finding.chain[0])).toEqual(['src/server/other.ts']);
    expect(reach({}, ['src/server/absent.ts']).map((finding) => finding.reason)).toEqual(['UNRESOLVED_IMPORT']);
  });
});

describe('디렉터리 읽기 (파일 시스템 경로)', () => {
  it('실제 폴더에 만든 합성 진입점도 같은 결과를 낸다', () => {
    const root = mkdtempSync(join(tmpdir(), 'bodam-fixture-reach-'));
    try {
      const write = (files: Record<string, string>) => {
        for (const [path, text] of Object.entries(files)) {
          mkdirSync(dirname(join(root, path)), { recursive: true });
          writeFileSync(join(root, path), text);
        }
      };
      write(syntheticFiles());
      expect(findFixtureReach([ENTRY], directoryReader(root))).toEqual([]);
      write({ 'src/server/rules-loader.ts': "import { seed } from '../fixtures/seed';\nexport const loadRules = () => seed;\n", 'src/fixtures/seed.ts': 'export const seed = 1;\n' });
      expect(findFixtureReach([ENTRY], directoryReader(root)).map((finding) => finding.target)).toEqual(['src/fixtures/seed.ts']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('실제 코드에 적용', () => {
  it('엔진 진입점 src/engine/estimate.ts 에서 시험 자료로 가는 가져오기 경로가 없고, 도달 파일은 모두 src/engine 안이다', () => {
    const walked = walkImports(['src/engine/estimate.ts'], directoryReader(REPO_ROOT));
    expect(walked.findings).toEqual([]);
    expect(walked.files.length).toBeGreaterThanOrEqual(10);
    expect(walked.files.every((file) => file.startsWith('src/engine/'))).toBe(true);
    expect(walked.files.some((file) => isFixturePath(file))).toBe(false);
  });

  it('운영 구성 진입점(src/server/composition.*)이 생기면 같은 검사를 통과해야 한다 (M1: 진입점이 없어 대상이 비어 있다 -> 실제 진입점 검사는 M4 의 AC-010b 가 닫는다)', () => {
    const serverDir = join(REPO_ROOT, 'src', 'server');
    const entries = existsSync(serverDir)
      ? readdirSync(serverDir)
          .filter((name) => /^composition\.[cm]?[jt]sx?$/.test(name))
          .map((name) => `src/server/${name}`)
      : [];
    expect(findFixtureReach(entries, directoryReader(REPO_ROOT))).toEqual([]);
  });
});
