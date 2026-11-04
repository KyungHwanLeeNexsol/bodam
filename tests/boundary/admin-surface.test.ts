import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractModuleRefs, readSourceFiles, tokenize } from './source-scan';
import type { SourceFile } from './source-scan';

// 관리자 경계의 소스 검사 (SPEC-REIMBURSEMENT-001 M7 첫 기능, AC-022a 의 증거, AC-016f 의 이전 증거). 어휘 분석기(source-scan.ts)로 읽는다. 기존 경계 시험은 바꾸지 않는다.
//  1. 관리자 신원은 서버가 검증한 인증기에서만 온다: 관리자 서버 코드와 운영 연결·route 는 요청의 헤더·쿠키·쿼리를 읽지 않는다.
//  2. 운영 구성의 인증기는 UNCONNECTED 하나로 고정이고 시험 인증기·시험 계정이 src 에 없다.
//  3. 관리자 화면: 외부로 나가는 길은 transport.ts 하나이고 같은 출처의 상대 경로뿐이며, 브라우저 저장소·분석이 없다.
//  4. 가격 수정 서비스는 게시 서비스 밖에서 치료 버전·카탈로그·병원·매핑·규칙 묶음·범위를 쓰지 않는다(가격 수정이 매핑 승인·규칙 묶음 변경으로 이어지지 않는다).
//  5. 키오스크 코드에는 관리자로 가는 길이 없다.
// 한계(통과해도 증명하지 못하는 것): 별칭(`const h = request['head' + 'ers']`)·문자열로 만든 접근은 어휘 수준으로 잡지 못한다. 동작은 tests/api/admin-catalog.test.ts 가 위조 시도로 본다.

const SERVER_DIR = fileURLToPath(new URL('../../src/server', import.meta.url));
const APP_DIR = fileURLToPath(new URL('../../src/app', import.meta.url));
const serverFiles = readSourceFiles(SERVER_DIR, 'src/server');
const appFiles = readSourceFiles(APP_DIR, 'src/app');

const idents = (file: SourceFile): string[] => tokenize(file.text).filter((token) => token.kind === 'ident').map((token) => token.text);
const find = (files: readonly SourceFile[], path: string): SourceFile => files.find((file) => file.path === path) ?? (() => { throw new Error(`없는 파일: ${path}`); })();

const ADMIN_SERVER = serverFiles.filter((file) => file.path.startsWith('src/server/admin/'));
const ADMIN_ENTRY_FILES = [...ADMIN_SERVER, find(appFiles, 'src/app/admin-services.ts'), ...appFiles.filter((file) => file.path.startsWith('src/app/api/admin/'))];
const ADMIN_UI = appFiles.filter((file) => file.path.startsWith('src/app/admin/') && /\.(ts|tsx)$/.test(file.path));

describe('검사 대상이 실제로 읽혔다 (빈 검사 방지)', () => {
  it('관리자 서버·진입·화면 파일이 들어 있다', () => {
    expect(ADMIN_SERVER.map((file) => file.path)).toEqual(expect.arrayContaining(['src/server/admin/auth.ts', 'src/server/admin/router.ts', 'src/server/admin/services.ts', 'src/server/admin/http.ts']));
    expect(ADMIN_ENTRY_FILES.some((file) => file.path === 'src/app/api/admin/[...path]/route.ts')).toBe(true);
    expect(ADMIN_UI.map((file) => file.path)).toEqual(expect.arrayContaining(['src/app/admin/TreatmentPrices.tsx', 'src/app/admin/transport.ts']));
  });
});

describe('1. 신원은 요청의 헤더·쿠키·쿼리에서 읽지 않는다', () => {
  const FORBIDDEN = ['headers', 'cookie', 'cookies', 'searchParams', 'URLSearchParams', 'authorization'];

  it.each(ADMIN_ENTRY_FILES.map((file) => [file.path, file] as const))('%s', (_path, file) => {
    const found = idents(file).filter((name) => FORBIDDEN.includes(name));
    expect(found).toEqual([]);
  });

  it('요청 객체에서 읽는 것은 method 와 json() 뿐이다 (router.ts)', () => {
    const tokens = tokenize(find(ADMIN_SERVER, 'src/server/admin/router.ts').text);
    const members = tokens.flatMap((token, index) => (token.text === 'request' && tokens[index + 1]?.text === '.' && tokens[index + 2]?.kind === 'ident' ? [tokens[index + 2]!.text] : []));
    expect([...new Set(members)].sort()).toEqual(['json', 'method']);
  });
});

describe('2. 운영 구성의 인증기는 연결되지 않은 것 하나뿐이다', () => {
  const composition = find(serverFiles, 'src/server/composition.ts');
  const compositionIdents = idents(composition);

  it('createOperatingAdminServices 는 UNCONNECTED_ADMIN_AUTHENTICATOR 를 쓰고 인증기를 받지 않는다', () => {
    expect(compositionIdents).toContain('UNCONNECTED_ADMIN_AUTHENTICATOR');
    const start = composition.text.indexOf('export interface OperatingAdminParts');
    const end = composition.text.indexOf('}', start);
    const parts = composition.text.slice(start, end);
    expect(parts).not.toMatch(/authenticator|Authenticator/);
    // 인증기를 가리키는 식별자는 `authenticator:` 속성 하나(고정값)뿐이다.
    expect(compositionIdents.filter((name) => name === 'authenticator')).toHaveLength(1);
  });

  it('시험 인증기·시험 계정·시험 로그인이 src 어디에도 없다', () => {
    const NAMES = ['TestAdminAuthenticator', 'staticAuthenticator', 'TEST_ACCOUNTS', 'TEST_SESSION_COOKIE', 'bodam_test_session', '__harness'];
    for (const file of [...serverFiles, ...appFiles]) {
      const found = NAMES.filter((name) => idents(file).includes(name) || file.text.includes(name));
      expect(found, file.path).toEqual([]);
    }
  });

  it('인증기를 넣는 createAdminServices 는 composition.ts 와 시험만 부른다 (src/app 은 부르지 않는다)', () => {
    for (const file of appFiles) {
      expect(idents(file), file.path).not.toContain('createAdminServices');
    }
  });
});

describe('3. 관리자 화면의 바깥 연결은 transport.ts 하나다', () => {
  const transport = find(ADMIN_UI, 'src/app/admin/transport.ts');

  it('fetch 를 부르는 파일은 transport.ts 뿐이고 한 번만 부른다', () => {
    for (const file of ADMIN_UI) {
      const count = idents(file).filter((name) => name === 'fetch').length;
      expect(count, file.path).toBe(file.path === transport.path ? 1 : 0);
    }
  });

  it('관리자 화면 소스에 절대 주소(http://, https://, //)가 없다: 같은 출처의 상대 경로만 쓴다', () => {
    for (const file of ADMIN_UI) {
      expect(file.text, file.path).not.toMatch(/https?:\/\/|['"`]\/\//);
    }
  });

  it('요청 경로 문자열은 `/api/` 로 시작한다 (화면이 부르는 모든 경로)', () => {
    for (const file of ADMIN_UI.filter((entry) => entry.path !== transport.path)) {
      const literals = [...file.text.matchAll(/(?:adminRequest|request)(?:<[^>]*>)?\(\s*'[A-Z]+',\s*([`'])([^`']*)\1/g)].map((match) => match[2] as string);
      for (const literal of literals) {
        expect(literal.startsWith('/api/') || literal.startsWith('${base}'), `${file.path}: ${literal}`).toBe(true);
      }
    }
  });

  it('브라우저 저장소·쿠키·분석·주소 조작이 없다 (입력·결과를 화면 밖으로 남기지 않는다)', () => {
    const FORBIDDEN = ['localStorage', 'sessionStorage', 'indexedDB', 'cookie', 'sendBeacon', 'caches', 'history', 'location', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Date'];
    for (const file of ADMIN_UI) {
      expect(idents(file).filter((name) => FORBIDDEN.includes(name)), file.path).toEqual([]);
    }
  });
});

/** 치료 기록(saveTreatment) 말고 불변 기록·매핑·규칙 묶음·범위를 쓰는 동작. 4번(초안·요청 변환·관리자 API)은 여기에 saveTreatment 를 더해 막고, 4b번(구조 편집 모듈)은 이것만 막는다. */
const WRITES_OUTSIDE_TREATMENT_RECORD = [
  'putTreatmentVersion',
  'putCommonBaseFee',
  'putCatalogVersion',
  'saveClinic',
  'putItemVersion',
  'reviseDraftItemVersion',
  'recordItemTransition',
  'putRuleBundleVersion',
  'appendBundleStatusEvent',
  'assignClinicRuleScope',
  'saveCoverageReviewRequest',
  'saveIdlePolicy',
  'triggerReReview',
  'triggerReReviewForBaseFee',
];

describe('4. 가격 수정은 게시 서비스 밖에서 불변 기록·매핑·규칙 묶음을 쓰지 않는다', () => {
  const WRITES = [...WRITES_OUTSIDE_TREATMENT_RECORD, 'saveTreatment'];
  const files = [find(serverFiles, 'src/server/catalog-draft.ts'), find(serverFiles, 'src/server/catalog-draft-request.ts'), ...ADMIN_SERVER];

  it.each(files.map((file) => [file.path, file] as const))('%s 는 위 쓰기 동작을 직접 부르지 않는다', (_path, file) => {
    expect(idents(file).filter((name) => WRITES.includes(name))).toEqual([]);
  });

  it('초안 서비스가 저장소에 쓰는 동작은 초안 저장·닫기와 감사 기록뿐이고, 게시는 publishCatalog 한 경로다', () => {
    const draft = find(serverFiles, 'src/server/catalog-draft.ts');
    const repoCalls = tokenize(draft.text).flatMap((token, index, all) => (token.text === 'repo' && all[index + 1]?.text === '.' && all[index + 2]?.kind === 'ident' ? [all[index + 2]!.text] : []));
    expect([...new Set(repoCalls)].sort()).toEqual(['closeCatalogDraft', 'getCatalogDraft', 'getClinic', 'getClinicCurrentCatalogVersion', 'saveCatalogDraft', 'transaction']);
    expect(idents(draft)).toContain('publishCatalog');
  });
});

describe('4b. 치료 기록(활성·표시 순서)을 쓰는 코드는 구조 편집 모듈 하나뿐이다 (M7 구조 편집)', () => {
  const structure = find(serverFiles, 'src/server/catalog-structure.ts');
  const nonRepo = serverFiles.filter((file) => !file.path.startsWith('src/server/repo/'));
  const callsOf = (file: SourceFile, name: string): boolean => {
    const list = tokenize(file.text);
    return list.some((token, index) => token.kind === 'ident' && token.text === name && list[index - 1]?.text === '.' && list[index + 1]?.text === '(');
  };

  it('saveTreatment 를 부르는 src/server 코드는 catalog-structure.ts 뿐이다 (초안 서비스·요청 변환·관리자 API 는 부르지 않는다)', () => {
    expect(nonRepo.filter((file) => callsOf(file, 'saveTreatment')).map((file) => file.path)).toEqual(['src/server/catalog-structure.ts']);
  });

  it('catalog-structure.ts 가 저장소에 쓰는 동작은 saveTreatment 하나뿐이다 (치료 버전·카탈로그·병원·매핑·규칙 묶음·범위·재검토 요청은 쓰지 않는다)', () => {
    const writes = WRITES_OUTSIDE_TREATMENT_RECORD;
    expect(idents(structure).filter((name) => writes.includes(name))).toEqual([]);
    const repoCalls = tokenize(structure.text).flatMap((token, index, all) => (token.text === 'repo' && all[index + 1]?.text === '.' && all[index + 2]?.kind === 'ident' ? [all[index + 2]!.text] : []));
    // 읽기 셋(치료 조회·기본비용 버전 조회·병원의 치료 목록)과 쓰기 하나(치료 기록).
    expect([...new Set(repoCalls)].sort()).toEqual(['getTreatment', 'listCommonBaseFeeVersions', 'listTreatments', 'saveTreatment']);
  });

  it('형식 검사 모듈(catalog-draft-parse.ts)은 저장소에 닿지 않는다 (순수 함수)', () => {
    const parse = find(serverFiles, 'src/server/catalog-draft-parse.ts');
    expect(idents(parse).filter((name) => name === 'repo' || name === 'deps')).toEqual([]);
  });

  it('치료 기록을 쓰는 함수(createAdditions·applyDeactivations·applyOrder)는 게시 서비스 한 곳(publishCatalogDraft)에서만 부른다', () => {
    const callers = (name: string): string[] =>
      nonRepo
        .filter((file) => {
          const list = tokenize(file.text);
          return list.some((token, index) => token.kind === 'ident' && token.text === name && list[index + 1]?.text === '(' && list[index - 1]?.text !== 'function');
        })
        .map((file) => file.path);
    for (const name of ['createAdditions', 'applyDeactivations', 'applyOrder']) {
      expect(callers(name), name).toEqual(['src/server/catalog-draft.ts']);
    }
    // 초안 저장·버리기 함수의 본문에는 위 쓰기 함수 호출이 없다.
    const draft = find(serverFiles, 'src/server/catalog-draft.ts').text;
    const publishAt = draft.indexOf('export function publishCatalogDraft');
    expect(publishAt).toBeGreaterThan(0);
    for (const name of ['createAdditions(', 'applyDeactivations(', 'applyOrder(']) {
      expect(draft.slice(0, publishAt), name).not.toContain(name);
    }
  });
});

describe('5. 키오스크 쪽에 관리자로 가는 길이 없다 (AC-016f 의 이전 증거)', () => {
  it('src/app/kiosk 의 어떤 파일도 admin 모듈을 가져오지 않고 /admin 경로 문자열을 담지 않는다', () => {
    const kiosk = appFiles.filter((file) => file.path.startsWith('src/app/kiosk/'));
    expect(kiosk.length).toBeGreaterThan(20);
    for (const file of kiosk) {
      const specifiers = extractModuleRefs(tokenize(file.text)).map((ref) => ref.specifier ?? '');
      expect(specifiers.filter((specifier) => /(^|\/)admin(\/|-|$)/.test(specifier)), file.path).toEqual([]);
      expect(file.text, file.path).not.toMatch(/\/admin(\/|['"`])/);
    }
  });

  it('관리자 화면은 키오스크 모듈을 가져오지 않는다 (색·글꼴 변수는 CSS 변수로만 빌려 쓴다)', () => {
    for (const file of ADMIN_UI) {
      const specifiers = extractModuleRefs(tokenize(file.text)).map((ref) => ref.specifier ?? '');
      expect(specifiers.filter((specifier) => /kiosk/.test(specifier)), file.path).toEqual([]);
    }
  });
});
