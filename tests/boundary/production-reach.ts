import { posix } from 'node:path';
import { ScanError, extractModuleRefs, isFixturePath, resolveAmong, tokenize } from './source-scan';
import type { FileReader } from './fixture-reach';

// AC-010b 운영 진입점 검사기 (M4.A). 기존 fixture-reach.ts 의 검사기는 상대 경로만 따라가고 시험 폴더(fixture 가 아닌 tests/ 파일)는 보지 않으며
// 별칭 표기(`@/…`, `~/…`, tests/…·src/… 기준 경로)를 외부 패키지로 보고 지나친다. 운영 진입점에서는 그 틈을 닫아야 하므로 이 검사기는
//  - 상대 경로와 별칭 표기를 모두 저장소 루트 기준 경로로 바꿔 따라가고,
//  - fixture 경로뿐 아니라 시험 경로(tests/ 아래, *.test.*, *.spec.*)와 시험 러너 패키지(vitest·jest)를 막으며,
//  - 해석하지 못하는 가져오기와 식으로 쓴 동적 가져오기는 통과시키지 않고 닫힌 실패로 보고한다.
// 기존 검사기(fixture-reach.ts)와 어휘 분석기(source-scan.ts)는 읽기 전용으로 재사용하고 고치지 않는다.

export type ProductionFindingReason =
  | 'FIXTURE_PATH'
  | 'TEST_PATH'
  | 'FIXTURE_PACKAGE'
  | 'TEST_RUNNER_PACKAGE'
  | 'UNRESOLVED_IMPORT'
  | 'UNKNOWN_ALIAS'
  | 'ABSOLUTE_PATH'
  | 'DYNAMIC_SPECIFIER'
  | 'SCAN_ERROR';

export interface ProductionFinding {
  reason: ProductionFindingReason;
  /** 문제가 된 가져오기 대상(해석한 경로 또는 원래 표기). */
  target: string;
  /** 진입점에서 target 까지의 경로. */
  chain: string[];
}

export interface ProductionWalk {
  /** 진입점에서 도달한 소스 파일(방문 순서). */
  files: string[];
  findings: ProductionFinding[];
}

/** 시험 경로 판정: tests/ 폴더 아래, __tests__·spec 폴더 아래, 또는 파일 이름이 *.test.* / *.spec.* 이다. */
export function isTestPath(path: string): boolean {
  return /(^|\/)(tests?|__tests__|spec)(\/|$)/i.test(path) || /\.(test|spec)(\.[cm]?[jt]sx?)?$/i.test(path);
}

const TEST_RUNNER_ROOTS = /^(vitest|jest|mocha|ava|@vitest\/|@jest\/|@testing-library\/)/;
const RELATIVE = /^(\.\.?)(\/|$)/;
/** 저장소 루트 기준 경로로 쓰는 별칭 접두. `@/`·`~/` 는 src/ 를, `src/`·`tests/` 는 baseUrl 방식으로 루트를 가리킨다. */
const ALIAS_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ['@/', 'src/'],
  ['~/', 'src/'],
  ['src/', 'src/'],
  ['tests/', 'tests/'],
];

type Spelling = { kind: 'path'; path: string } | { kind: 'package' } | { kind: 'alias-unknown' } | { kind: 'absolute' };

function classify(specifier: string, fromFile: string): Spelling {
  if (RELATIVE.test(specifier)) return { kind: 'path', path: posix.normalize(posix.join(posix.dirname(fromFile), specifier)) };
  if (specifier.startsWith('/') || /^[A-Za-z]:[\\/]/.test(specifier) || specifier.startsWith('file:')) return { kind: 'absolute' };
  for (const [prefix, root] of ALIAS_PREFIXES) {
    if (specifier.startsWith(prefix)) return { kind: 'path', path: posix.normalize(`${root}${specifier.slice(prefix.length)}`) };
  }
  // `#imports` 같은 패키지 내부 별칭은 어디를 가리키는지 알 수 없으므로 통과시키지 않는다. `@scope/pkg` 는 패키지다.
  if (specifier.startsWith('#') || specifier === '@' || specifier === '~') return { kind: 'alias-unknown' };
  return { kind: 'package' };
}

/** 진입점에서 출발해 운영 코드가 닿을 수 있는 모든 소스 파일을 따라가며 시험 자료·시험 경로에 닿는 길을 보고한다. */
export function walkProductionImports(entries: readonly string[], reader: FileReader): ProductionWalk {
  const files: string[] = [];
  const findings: ProductionFinding[] = [];
  const visited = new Set<string>();
  const queue: Array<{ path: string; chain: string[] }> = [];
  const exists = (path: string): boolean => reader.read(path) !== null;

  for (const entry of entries) {
    const path = posix.normalize(entry);
    if (reader.read(path) === null) findings.push({ reason: 'UNRESOLVED_IMPORT', target: path, chain: [path] });
    else queue.push({ path, chain: [path] });
  }

  for (let head = 0; head < queue.length; head += 1) {
    const { path, chain } = queue[head] as { path: string; chain: string[] };
    if (visited.has(path)) continue;
    visited.add(path);
    files.push(path);
    // 진입점 자신이 시험 경로이면 그것도 위반이다(진입점 목록이 시험 파일을 가리킨 경우).
    if (isFixturePath(path)) findings.push({ reason: 'FIXTURE_PATH', target: path, chain: [...chain] });
    else if (isTestPath(path)) findings.push({ reason: 'TEST_PATH', target: path, chain: [...chain] });
    let refs: ReturnType<typeof extractModuleRefs>;
    try {
      refs = extractModuleRefs(tokenize(reader.read(path) as string));
    } catch (error) {
      if (!(error instanceof ScanError)) throw error;
      findings.push({ reason: 'SCAN_ERROR', target: path, chain: [...chain] });
      continue;
    }
    for (const ref of refs) {
      const specifier = ref.specifier;
      if (specifier === null) {
        if (ref.kind === 'dynamic' || ref.kind === 'require') findings.push({ reason: 'DYNAMIC_SPECIFIER', target: `${path}:${ref.line}`, chain: [...chain] });
        continue;
      }
      const spelling = classify(specifier, path);
      if (spelling.kind === 'package') {
        if (/fixture/i.test(specifier)) findings.push({ reason: 'FIXTURE_PACKAGE', target: specifier, chain: [...chain, specifier] });
        else if (TEST_RUNNER_ROOTS.test(specifier)) findings.push({ reason: 'TEST_RUNNER_PACKAGE', target: specifier, chain: [...chain, specifier] });
        continue;
      }
      if (spelling.kind === 'alias-unknown') {
        findings.push({ reason: 'UNKNOWN_ALIAS', target: specifier, chain: [...chain, specifier] });
        continue;
      }
      if (spelling.kind === 'absolute') {
        findings.push({ reason: 'ABSOLUTE_PATH', target: specifier, chain: [...chain, specifier] });
        continue;
      }
      const resolved = resolveAmong(spelling.path, exists);
      const probe = resolved ?? spelling.path;
      if (isFixturePath(spelling.path) || isFixturePath(probe)) {
        findings.push({ reason: 'FIXTURE_PATH', target: probe, chain: [...chain, probe] });
      } else if (isTestPath(spelling.path) || isTestPath(probe)) {
        findings.push({ reason: 'TEST_PATH', target: probe, chain: [...chain, probe] });
      } else if (resolved === null) {
        findings.push({ reason: 'UNRESOLVED_IMPORT', target: spelling.path, chain: [...chain, spelling.path] });
      } else {
        queue.push({ path: resolved, chain: [...chain, resolved] });
      }
    }
  }
  return { files, findings };
}
