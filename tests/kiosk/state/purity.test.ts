import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractModuleRefs, readSourceFiles, tokenize } from '../../boundary/source-scan';

// 증거만 낸다 (닫는 AC 아님): 키오스크 상태 기계(src/app/kiosk/state)는 화면 없는 순수 TypeScript 이고 환자 상태를 메모리 밖에 두지 않는다.
//  - 가져오기는 같은 폴더(키오스크)와 src/engine 뿐이다: React·Next.js·DOM·src/server·시험·시험 자료로 가는 길이 없다
//  - 저장소(localStorage·sessionStorage·indexedDB·쿠키·Cache Storage)와 문서·창·위치·기록 전역을 쓰지 않는다 (AC-016a 정적 검사가 M5.B·C 에서 정식으로 닫힌다. 이 목록은 그 검사가 읽을 이름의 앞선 부분이다)
//  - 시계는 주입한 것만 쓴다: Date 와 전역 객체(globalThis)를 쓰지 않는다
// 한계: 어휘 수준 검사라 별칭이나 문자열로 만든 접근은 못 잡는다(tests/boundary/source-scan.ts 머리말).

const KIOSK_DIR = fileURLToPath(new URL('../../../src/app/kiosk', import.meta.url));
const files = readSourceFiles(KIOSK_DIR, 'src/app/kiosk');

const FORBIDDEN_IDENTIFIERS = [
  'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'cookieStore',
  'document', 'window', 'navigator', 'location', 'history', 'self',
  'Date', 'globalThis', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon',
  'eval', 'Function',
];

describe('키오스크 상태 기계 소스 (src/app/kiosk)', () => {
  it('소스가 실제로 읽혔다 (빈 검사 방지): 상태 기계의 파일들이 모두 있다', () => {
    const names = files.map((file) => file.path);
    for (const expected of ['api-types', 'controller', 'deps', 'display', 'events', 'idle', 'defaults', 'machine', 'refresh', 'refresh-effects', 'request', 'request-effects', 'selectors', 'session-store']) {
      expect(names, expected).toContain(`src/app/kiosk/state/${expected}.ts`);
    }
    expect(files.every((file) => file.path.startsWith('src/app/kiosk/'))).toBe(true);
  });

  it('가져오는 것은 상대 경로뿐이고 키오스크 폴더 안이나 src/engine 만 가리킨다', () => {
    for (const file of files) {
      for (const ref of extractModuleRefs(tokenize(file.text))) {
        expect(ref.specifier, `${file.path} 동적 가져오기`).not.toBeNull();
        const specifier = ref.specifier as string;
        expect(specifier.startsWith('.'), `${file.path} -> ${specifier}`).toBe(true);
        const target = posix.normalize(posix.join(posix.dirname(file.path), specifier));
        expect(target.startsWith('src/app/kiosk/') || target.startsWith('src/engine/'), `${file.path} -> ${target}`).toBe(true);
      }
    }
  });

  it('금지 식별자(저장소·문서·창·시계·전역 객체·네트워크 전역·동적 실행)를 쓰지 않는다', () => {
    for (const file of files) {
      const identifiers = new Set(tokenize(file.text).filter((token) => token.kind === 'ident').map((token) => token.text));
      for (const name of FORBIDDEN_IDENTIFIERS) {
        expect(identifiers.has(name), `${file.path} ${name}`).toBe(false);
      }
    }
  });

  it('검사기 대조군: 금지 식별자를 쓰는 소스는 걸린다', () => {
    const identifiers = new Set(tokenize("const x = localStorage.getItem('k'); const d = new Date();").filter((token) => token.kind === 'ident').map((token) => token.text));
    expect(FORBIDDEN_IDENTIFIERS.filter((name) => identifiers.has(name))).toEqual(['localStorage', 'Date']);
  });
});
