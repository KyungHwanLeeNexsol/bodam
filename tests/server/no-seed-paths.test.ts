import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readSourceFiles, tokenize } from '../boundary/source-scan';
import type { SourceFile, Token } from '../boundary/source-scan';

// AC-010c 의 둘째 문장: "저장소 시드·이관 스크립트에 DEMO·TEST_FIXTURE 기록을 APPROVED·PUBLISHED 로 쓰는 경로가 없다."
// 이 시험이 뒷받침하는 주장은 정확히 다음이다 (src/server 안의 소스 어휘 분석으로 본다. 주석은 보지 않는다):
//   (1) src/server 에는 시드·이관·부트스트랩·가져오기·불러오기·시험 자료·데모 모듈이나 그런 이름의 선언이 없다.
//   (2) 출처 이름 DEMO·TEST_FIXTURE 는 validate/shape.ts 의 닫힌 열거 목록(검증용) 한 곳에만 나온다. 어떤 기록에도 값으로 쓰이지 않는다.
//   (3) 치료 버전과 공통 기본비용을 저장소에 쓰는 코드는 카탈로그 게시 서비스(catalog-publish.ts) 하나뿐이고, 그 서비스는 쓰기 전에
//       허용 출처 검증을 한다 (그 거절은 publish-catalog.test.ts 의 AC-010c 시험이 본다).
//   (4) 항목 생명주기 상태를 저장소에 쓰는 코드는 authoring.ts(DRAFT) · approval.ts(역할 검사를 거친 전이: APPROVED·PUBLISHED 포함) · re-review.ts(UNDER_REREVIEW) 뿐이다.
//       규칙 묶음 게시·카탈로그 게시 서비스는 상태를 직접 쓰지 않고 approval.ts 의 역할 검사를 거친 전이를 부른다.
// 이 시험이 주장하지 않는 것: src/server 밖의 코드(현재 없음)와 DB 어댑터(없음, plan.md §E #1 미정), 그리고 운영 데이터가 실제로 비어 있다는 사실.

const SERVER_DIR = fileURLToPath(new URL('../../src/server', import.meta.url));
const files = readSourceFiles(SERVER_DIR, 'src/server');
const nonRepo = files.filter((file) => !file.path.startsWith('src/server/repo/'));

function tokens(file: SourceFile): Token[] {
  return tokenize(file.text);
}

/** `.name(` 호출이 있는 파일들. */
function callersOf(name: string, among: readonly SourceFile[]): string[] {
  return among
    .filter((file) => {
      const list = tokens(file);
      return list.some((token, index) => token.kind === 'ident' && token.text === name && list[index - 1]?.text === '.' && list[index + 1]?.text === '(');
    })
    .map((file) => file.path)
    .sort();
}

/** 파일마다 `to: '문자열'` 모양의 상태 목표 리터럴. */
function writtenTargets(file: SourceFile): string[] {
  const list = tokens(file);
  const found = new Set<string>();
  list.forEach((token, index) => {
    const value = list[index + 2];
    if (token.kind === 'ident' && token.text === 'to' && list[index + 1]?.text === ':' && value?.kind === 'string') {
      found.add(value.text.replace(/^['"`]|['"`]$/g, ''));
    }
  });
  return [...found].sort();
}

describe('AC-010c 시드·이관 경로 부재 (주장 범위는 이 파일 머리말)', () => {
  it('소스를 읽었다 (빈 검사 방지)', () => {
    expect(files.length).toBeGreaterThan(25);
    expect(files.map((file) => file.path)).toContain('src/server/catalog-publish.ts');
    expect(files.map((file) => file.path)).toContain('src/server/bundle-publish.ts');
  });

  it('(1) 시드·이관·부트스트랩·가져오기·불러오기·시험 자료·데모 이름의 모듈이 없다', () => {
    const names = files.map((file) => file.path).filter((path) => /(^|\/)[^/]*(seed|migrat|bootstrap|import[-_.]|importer|loader|fixture|demo|sample)[^/]*\.ts$/i.test(path));
    expect(names).toEqual([]);
  });

  it('(1) 시드·이관·부트스트랩 이름으로 시작하는 식별자(선언)가 없다', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const token of tokens(file)) {
        if (token.kind === 'ident' && /^(seed|migrate|migration|bootstrap|backfill)/i.test(token.text)) {
          offenders.push(`${file.path}:${token.line} ${token.text}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('(2) 출처 이름 DEMO·TEST_FIXTURE 는 validate/shape.ts 의 닫힌 열거 목록에만 나온다', () => {
    const mentions = files
      .filter((file) => tokens(file).some((token) => (token.kind === 'ident' || token.kind === 'string') && /(^|[^A-Z_])(DEMO|TEST_FIXTURE)([^A-Z_]|$)/.test(token.text)))
      .map((file) => file.path);
    expect(mentions).toEqual(['src/server/validate/shape.ts']);
  });

  it('(3) 치료 버전·공통 기본비용을 쓰는 코드는 카탈로그 게시 서비스 하나뿐이다', () => {
    expect(callersOf('putTreatmentVersion', nonRepo)).toEqual(['src/server/catalog-publish.ts']);
    expect(callersOf('putCommonBaseFee', nonRepo)).toEqual(['src/server/catalog-publish.ts']);
    expect(callersOf('putCatalogVersion', nonRepo)).toEqual(['src/server/catalog-publish.ts']);
  });

  it('(3) 카탈로그 게시 서비스는 허용 출처 검증(validateCatalogPublish + assertNoDefects)을 쓰기보다 앞서 부른다', () => {
    const file = files.find((candidate) => candidate.path === 'src/server/catalog-publish.ts')!;
    const list = tokens(file).map((token) => token.text);
    // 가져오기 목록이 아니라 호출 위치를 비교한다: 이름 바로 뒤에 여는 괄호가 오는 첫 자리.
    const callAt = (name: string): number => list.findIndex((text, index) => text === name && list[index + 1] === '(');
    const validate = callAt('validateCatalogPublish');
    const assertion = callAt('assertNoDefects');
    const firstWrite = callAt('putTreatmentVersion');
    expect(validate).toBeGreaterThan(-1);
    expect(assertion).toBeGreaterThan(-1);
    expect(firstWrite).toBeGreaterThan(Math.max(validate, assertion));
  });

  it('(4) 항목 생명주기 상태를 저장소에 쓰는 코드는 authoring · approval · re-review 뿐이다', () => {
    expect(callersOf('recordItemTransition', nonRepo)).toEqual(['src/server/approval.ts', 'src/server/authoring.ts', 'src/server/re-review.ts']);
  });

  it('(4) 그 코드가 상태 목표로 직접 적는 값: authoring 은 DRAFT, re-review 는 UNDER_REREVIEW, approval 은 APPROVED·REJECTED·REVIEW_REQUESTED 이고 게시 서비스 두 모듈은 직접 적지 않는다', () => {
    const byPath = new Map(nonRepo.map((file) => [file.path, writtenTargets(file)]));
    expect(byPath.get('src/server/authoring.ts')).toEqual(['DRAFT']);
    expect(byPath.get('src/server/re-review.ts')).toEqual(['UNDER_REREVIEW']);
    // approval.ts 의 나머지 전이(PUBLISHED·SUSPENDED·SUPERSEDED·EXPIRED)는 rvTransition 의 인자로 적힌다.
    expect(byPath.get('src/server/approval.ts')).toEqual(['APPROVED', 'REJECTED', 'REVIEW_REQUESTED']);
    expect(byPath.get('src/server/catalog-publish.ts')).toEqual([]);
    expect(byPath.get('src/server/bundle-publish.ts')).toEqual([]);
  });

  it('(4) 게시 서비스 두 모듈은 항목 상태를 approval.ts 의 markPublished 로만 옮긴다', () => {
    const bundle = files.find((candidate) => candidate.path === 'src/server/bundle-publish.ts')!;
    expect(tokens(bundle).some((token) => token.kind === 'ident' && token.text === 'markPublished')).toBe(true);
    expect(tokens(bundle).some((token) => token.kind === 'ident' && token.text === 'recordItemTransition')).toBe(false);
  });
});
