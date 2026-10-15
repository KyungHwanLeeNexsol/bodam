import { readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { ScanError, extractModuleRefs, isFixturePath, resolveAmong, tokenize } from './source-scan';

export { isFixturePath };

// AC-010b 검사기 (M1.4 는 검사기와 합성 진입점 음성 시험만 증거로 낸다. 운영 구성 진입점 src/server/composition.* 은 M4 에서 처음 생기고
// 그때 같은 검사기를 실제 진입점에 돌려 AC-010b 를 닫는다).
// 진입점에서 출발해 상대 경로 가져오기를 따라가며, 시험 자료(fixture) 모듈에 닿는 경로가 하나라도 있으면 보고한다.
// 형식 전용 가져오기(import type)도 따라간다: 번들러가 지우더라도 경계는 소스 수준에서 지킨다는 보수적 선택이다.

export interface FileReader {
  /** 슬래시 경로(저장소 루트 기준)의 파일 내용. 파일이 아니거나 없으면 null. */
  read(path: string): string | null;
}

export type ReachReason = 'FIXTURE_PATH' | 'FIXTURE_PACKAGE' | 'UNRESOLVED_IMPORT' | 'DYNAMIC_SPECIFIER' | 'SCAN_ERROR';

export interface ReachFinding {
  reason: ReachReason;
  /** FIXTURE_PATH: 시험 자료 파일 경로, FIXTURE_PACKAGE: 패키지 이름, 그 밖: 문제가 된 파일 또는 가져오기 대상. */
  target: string;
  /** 진입점에서 target 까지의 경로. */
  chain: string[];
}

export interface WalkResult {
  /** 진입점에서 도달한 소스 파일 (방문 순서). */
  files: string[];
  findings: ReachFinding[];
}

export function memoryReader(files: Record<string, string>): FileReader {
  return { read: (path) => files[posix.normalize(path)] ?? null };
}

export function directoryReader(root: string): FileReader {
  return {
    read(path) {
      try {
        const full = join(root, path);
        return statSync(full).isFile() ? readFileSync(full, 'utf8') : null;
      } catch {
        return null;
      }
    },
  };
}

export function walkImports(entries: readonly string[], reader: FileReader): WalkResult {
  const files: string[] = [];
  const findings: ReachFinding[] = [];
  const visited = new Set<string>();
  const queue: Array<{ path: string; chain: string[] }> = [];
  const exists = (path: string): boolean => reader.read(path) !== null;

  for (const entry of entries) {
    const path = posix.normalize(entry);
    if (reader.read(path) === null) {
      findings.push({ reason: 'UNRESOLVED_IMPORT', target: path, chain: [path] });
    } else {
      queue.push({ path, chain: [path] });
    }
  }

  for (let head = 0; head < queue.length; head += 1) {
    const { path, chain } = queue[head] as { path: string; chain: string[] };
    if (visited.has(path)) continue;
    visited.add(path);
    files.push(path);
    const text = reader.read(path) as string;
    let refs: ReturnType<typeof extractModuleRefs>;
    try {
      refs = extractModuleRefs(tokenize(text));
    } catch (error) {
      if (!(error instanceof ScanError)) throw error;
      findings.push({ reason: 'SCAN_ERROR', target: path, chain });
      continue;
    }
    for (const ref of refs) {
      const specifier = ref.specifier;
      if (specifier === null) {
        if (ref.kind === 'dynamic' || ref.kind === 'require') {
          findings.push({ reason: 'DYNAMIC_SPECIFIER', target: `${path}:${ref.line}`, chain: [...chain] });
        }
        continue;
      }
      const relative = specifier.startsWith('./') || specifier.startsWith('../') || specifier === '.' || specifier === '..';
      if (!relative) {
        // 외부 패키지는 따라가지 않는다. 이름에 fixture 가 들면 시험 자료 패키지로 본다.
        if (/fixture/i.test(specifier)) findings.push({ reason: 'FIXTURE_PACKAGE', target: specifier, chain: [...chain, specifier] });
        continue;
      }
      const base = posix.normalize(posix.join(posix.dirname(path), specifier));
      const resolved = resolveAmong(base, exists);
      if (isFixturePath(base) || (resolved !== null && isFixturePath(resolved))) {
        const target = resolved ?? base;
        findings.push({ reason: 'FIXTURE_PATH', target, chain: [...chain, target] });
        continue;
      }
      if (resolved === null) {
        findings.push({ reason: 'UNRESOLVED_IMPORT', target: base, chain: [...chain, base] });
        continue;
      }
      queue.push({ path: resolved, chain: [...chain, resolved] });
    }
  }
  return { files, findings };
}

export function findFixtureReach(entries: readonly string[], reader: FileReader): ReachFinding[] {
  return walkImports(entries, reader).findings;
}
