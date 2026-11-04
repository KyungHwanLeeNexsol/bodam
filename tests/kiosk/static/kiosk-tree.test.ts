import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readSourceFiles } from '../../boundary/source-scan';
import { FETCH_ALLOWED_PATH, scanCss, scanSource } from './kiosk-rules';
import type { Violation } from './kiosk-rules';

// 키오스크 소스 전체에 대한 정적 약속 (BRIEF §0·D12, AC-016a·AC-016b·AC-016k·AC-021g의 정적 쪽). state/ 만 보던 M5 의 정적 시험을 src/app/kiosk/** 전체로 넓힌다.
// 먼저 검사기 자신을 시험한다(일부러 위반하는 합성 소스가 걸리고 깨끗한 소스는 통과한다). 그다음 실제 소스에 적용한다.
// 한계: 어휘 수준 검사라 별칭이나 문자열로 만든 접근은 못 잡는다. 저장소·기록에 실제로 쓰지 않았음은 브라우저 시험의 저장소 덤프(tests/e2e)가 본다.

const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const KIOSK_DIR = join(REPO, 'src/app/kiosk');
const sources = readSourceFiles(KIOSK_DIR, 'src/app/kiosk');

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? cssFiles(path) : name.endsWith('.css') ? [path] : [];
  });
}

const rulesOf = (violations: Violation[]): string[] => violations.map((violation) => violation.rule);

describe('검사기 대조군: 위반 소스는 걸린다', () => {
  const offending: Array<[string, string, string]> = [
    ['localStorage', 'window.localStorage.setItem("k", "v");', 'STORAGE'],
    ['sessionStorage', 'sessionStorage.clear();', 'STORAGE'],
    ['indexedDB', 'indexedDB.open("db");', 'STORAGE'],
    ['Cache Storage', 'caches.open("c");', 'STORAGE'],
    ['서비스워커', 'navigator.serviceWorker.register("/sw.js");', 'STORAGE'],
    ['document.cookie', 'document.cookie = "a=b";', 'STORAGE'],
    ['cookieStore', 'cookieStore.set("a", "b");', 'STORAGE'],
    ['history', 'window.history.pushState({}, "", "/x");', 'NAVIGATION'],
    ['replaceState', 'history.replaceState(null, "", "/x");', 'NAVIGATION'],
    ['location', 'location.hash = "#a";', 'NAVIGATION'],
    ['window.open', 'window.open("/x");', 'NAVIGATION'],
    ['next/link', "import Link from 'next/link';\nexport const L = Link;", 'FORBIDDEN_IMPORT'],
    ['next/navigation', "import { useRouter } from 'next/navigation';\nexport const R = useRouter;", 'FORBIDDEN_IMPORT'],
    ['fetch', 'export const get = () => fetch("/api");', 'FETCH_OUTSIDE_DEPS'],
    ['XMLHttpRequest', 'export const x = new XMLHttpRequest();', 'NETWORK'],
    ['sendBeacon', 'navigator.sendBeacon("/a", "b");', 'NETWORK'],
    ['console', 'console.log("환자");', 'LOGGING'],
    ['innerHTML', 'el.innerHTML = "<b>x</b>";', 'HTML_INJECTION'],
    ['dangerouslySetInnerHTML', 'export const A = () => <div dangerouslySetInnerHTML={{ __html: "x" }} />;', 'HTML_INJECTION'],
    ['eval', 'eval("1");', 'DYNAMIC_CODE'],
    ['<a> 요소', 'export const A = () => <a href="x">링크</a>;', 'LINK'],
    ['href 속성', 'export const A = () => <Anchor href="x" />;', 'LINK'],
    ['tel: 문자열', 'export const phone = "tel:15448069";', 'EXTERNAL_OR_TEL'],
    ['외부 주소 문자열', 'export const u = "https://example.com";', 'EXTERNAL_OR_TEL'],
    ['JSX 글자 속 외부 주소', 'export const A = () => <p>https://example.com 에서 확인</p>;', 'EXTERNAL_OR_TEL'],
    ['mailto', 'export const m = `mailto:a@b.c`;', 'EXTERNAL_OR_TEL'],
    ['시험 자료 가져오기', "import { makeCatalog } from '../../../tests/fixtures/kiosk/clinic.fixture';\nexport const c = makeCatalog;", 'FORBIDDEN_IMPORT'],
    ['시험 도구 가져오기', "import { vi } from 'vitest';\nexport const v = vi;", 'FORBIDDEN_IMPORT'],
    ['requestId 를 DOM 속성에', 'export const A = ({ requestId }: { requestId: string }) => <div data-request={requestId} />;', 'TRACKING_ID_IN_UI'],
    ['refreshId 를 id 에', 'export const A = ({ refreshId }: { refreshId: string }) => <div id={refreshId} />;', 'TRACKING_ID_IN_UI'],
    ['닫히지 않은 문자열(읽을 수 없는 소스)', 'export const s = "열림;\n', 'SCAN_ERROR'],
  ];

  it.each(offending)('%s', (_name, source, rule) => {
    expect(rulesOf(scanSource('src/app/kiosk/screens/X.tsx', source))).toContain(rule);
  });

  it('깨끗한 화면 소스는 통과한다 (주석 속 금지 이름, 문자열 속 일반 글자, JSX 닫는 태그)', () => {
    const clean = [
      '// localStorage·history·fetch·tel: https://example.com 은 주석이라 괜찮다',
      '/* 여러 줄 주석: sessionStorage, requestId */',
      "import { useKiosk } from '../runtime/kiosk-context';",
      'export function A() {',
      '  const { state, send } = useKiosk();',
      '  return (',
      '    <section className="x">',
      '      <p>{state.screen} 1 / 4</p>',
      "      <button type=\"button\" onClick={() => send({ type: 'NEXT' })}>다음</button>",
      '    </section>',
      '  );',
      '}',
    ].join('\n');
    expect(scanSource('src/app/kiosk/screens/A.tsx', clean)).toEqual([]);
  });

  it('fetch 는 기본 전송을 만드는 state/deps.ts 에서만 허용된다', () => {
    const source = 'export const t = (url: string) => fetch(url);';
    expect(rulesOf(scanSource('src/app/kiosk/state/other.ts', source))).toContain('FETCH_OUTSIDE_DEPS');
    expect(rulesOf(scanSource(FETCH_ALLOWED_PATH, source))).not.toContain('FETCH_OUTSIDE_DEPS');
  });

  it('requestId·refreshId 는 상태 기계(state/)에는 있고 화면 쪽에는 없다', () => {
    const source = 'export const id = (state: { activeRequest: { requestId: string } }) => state.activeRequest.requestId;';
    expect(rulesOf(scanSource('src/app/kiosk/state/request.ts', source))).not.toContain('TRACKING_ID_IN_UI');
    expect(rulesOf(scanSource('src/app/kiosk/screens/X.tsx', source))).toContain('TRACKING_ID_IN_UI');
  });

  it('CSS: 외부 주소와 @import 를 잡는다', () => {
    expect(rulesOf(scanCss('a.css', '@font-face { src: url(https://cdn.example.com/f.woff2); }'))).toContain('EXTERNAL_OR_TEL');
    expect(rulesOf(scanCss('a.css', '@import url("b.css");'))).toContain('CSS_IMPORT');
    expect(scanCss('a.css', "/* https://example.com 은 주석 */\n@font-face { src: url('../x.woff2'); }")).toEqual([]);
  });
});

describe('실제 소스: src/app/kiosk/** 전체', () => {
  it('소스가 실제로 읽혔다 (빈 검사 방지): 상태·런타임·화면·컴포넌트·겹침창·보기 폴더가 모두 있다', () => {
    const paths = sources.map((file) => file.path);
    for (const folder of ['state', 'runtime', 'screens', 'components', 'overlays', 'view']) {
      expect(
        paths.some((path) => path.startsWith(`src/app/kiosk/${folder}/`)),
        folder,
      ).toBe(true);
    }
    expect(paths).toContain('src/app/kiosk/state/deps.ts');
    expect(paths).toContain('src/app/kiosk/runtime/load-clinic-data.ts');
    expect(paths.filter((path) => path.endsWith('.tsx')).length).toBeGreaterThanOrEqual(15);
    expect(sources.length).toBeGreaterThanOrEqual(40);
  });

  it('금지 저장소·기록·주소·창·네트워크·로그·HTML 주입·링크·전화·외부 주소·시험 가져오기가 하나도 없다 (찾은 것 0건)', () => {
    const found = sources.flatMap((file) => scanSource(file.path, file.text));
    expect(found).toEqual([]);
  });

  it('fetch 라는 이름은 기본 전송을 만드는 state/deps.ts 에만 있다 (시작 단계의 받기도 resolveDeps().transport 를 쓴다)', () => {
    const withFetch = sources.filter((file) => /\bfetch\b/.test(file.text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')));
    expect(withFetch.map((file) => file.path)).toEqual([FETCH_ALLOWED_PATH]);
  });

  it('시작 단계의 받기는 deps.transport 를 부른다', () => {
    const loader = sources.find((file) => file.path === 'src/app/kiosk/runtime/load-clinic-data.ts');
    expect(loader?.text).toContain('deps.transport(');
  });

  it('CSS 에 외부 주소·@import 가 없다 (글꼴은 패키지의 woff2 를 번들에서 내려보낸다)', () => {
    const files = cssFiles(KIOSK_DIR);
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files.flatMap((path) => scanCss(path, readFileSync(path, 'utf8')))).toEqual([]);
  });

  it('루트 레이아웃과 페이지: 한국어 문서, 요청마다 렌더링(force-dynamic), 병원 자료를 서버에서 읽지 않는다', () => {
    const layout = readFileSync(join(REPO, 'src/app/layout.tsx'), 'utf8');
    const page = readFileSync(join(KIOSK_DIR, '[clinicSlug]/page.tsx'), 'utf8');
    expect(layout).toContain('<html lang="ko">');
    expect(page).toContain("export const dynamic = 'force-dynamic';");
    expect(page).toContain('key={clinicSlug}');
    expect(scanSource('src/app/kiosk/[clinicSlug]/page.tsx', page)).toEqual([]);
    expect(scanSource('src/app/layout.tsx', layout)).toEqual([]);
  });

  it('next.config: /kiosk/* 문서는 Cache-Control: no-store 로 내려간다 (AC-021g, 실제 응답 헤더는 브라우저 시험이 본다)', () => {
    const config = readFileSync(join(REPO, 'next.config.mjs'), 'utf8');
    expect(config).toContain("source: '/kiosk/:path*'");
    expect(config).toContain("{ key: 'Cache-Control', value: 'no-store' }");
  });
});
