import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSourceFiles, tokenize } from '../../boundary/source-scan';
import { SCREEN_STATES } from '../../../src/app/kiosk/state/session-store';
import { scanSource } from './kiosk-rules';

// 계산 근거·필요 서류·이용 완료 화면의 정적 약속 (SPEC-REIMBURSEMENT-001 M6 S3b, BRIEF §0, plan.md §E #18·#27·#32, AC-007g·AC-013f·AC-015f).
// 어휘 수준 검사다(별칭·문자열로 만든 접근은 못 잡는다). 화면에 실제로 그려진 모습은 tests/kiosk/screens 와 브라우저 시험이 본다.

const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const sources = readSourceFiles(join(REPO, 'src/app/kiosk'), 'src/app/kiosk');
const texts = (path: string): string => sources.find((file) => file.path === path)?.text ?? '';
const identifiersOf = (text: string): Set<string> => new Set(tokenize(text).filter((token) => token.kind === 'ident').map((token) => token.text));

describe('임시 화면(placeholder)이 없다', () => {
  it('src/app/kiosk/screens/placeholder.tsx 가 지워졌고 어떤 소스도 그 이름을 가져오거나 쓰지 않는다', () => {
    expect(existsSync(join(REPO, 'src/app/kiosk/screens/placeholder.tsx'))).toBe(false);
    const found = sources.flatMap((file) => {
      const names = identifiersOf(file.text);
      const strings = tokenize(file.text)
        .filter((token) => token.kind === 'string' || token.kind === 'template')
        .map((token) => token.text);
      const hits: string[] = [];
      if (names.has('PlaceholderScreen')) hits.push('PlaceholderScreen');
      if (strings.some((text) => /placeholder/i.test(text))) hits.push('문자열 placeholder');
      return hits.map((hit) => `${file.path}: ${hit}`);
    });
    expect(found).toEqual([]);
  });

  it('임시 화면용 CSS 도 지워졌다', () => {
    const css = readFileSync(join(REPO, 'src/app/kiosk/styles/kiosk.css'), 'utf8');
    expect(css).not.toContain('kiosk-placeholder');
  });

  it('ScreenRouter 는 화면 상태 열다섯 가지를 모두 자기 화면으로 보내고 default·공용 임시 분기가 없다', () => {
    const router = texts('src/app/kiosk/screens/ScreenRouter.tsx');
    expect(router).not.toMatch(/Placeholder/i);
    expect(identifiersOf(router).has('default')).toBe(false);
    const caseLabels = [...router.matchAll(/case '([A-Za-z0-9_]+)':/g)].map((match) => match[1]);
    expect([...caseLabels].sort()).toEqual([...SCREEN_STATES].sort());
    // 각 case 는 바로 아래 줄에서 자기 화면을 돌려준다 (case 가 줄줄이 이어져 한 화면을 공유하지 않는다).
    for (const state of SCREEN_STATES) {
      expect(router, state).toMatch(new RegExp(`case '${state}':\\s*\\n\\s*return <[A-Za-z0-9]+ />;`));
    }
  });
});

describe('새 화면 소스의 금지 요소', () => {
  const SHEET_FILES = [
    'src/app/kiosk/screens/BasisScreen.tsx',
    'src/app/kiosk/screens/DocumentsScreens.tsx',
    'src/app/kiosk/screens/CompleteScreen.tsx',
    'src/app/kiosk/components/SheetScreen.tsx',
    'src/app/kiosk/components/DocumentList.tsx',
    'src/app/kiosk/components/BasisTables.tsx',
    'src/app/kiosk/view/basis-view.ts',
    'src/app/kiosk/view/documents-view.ts',
    'src/app/kiosk/view/complete-view.ts',
  ];

  it('파일이 실제로 있다 (빈 검사 방지)', () => {
    for (const path of SHEET_FILES) expect(texts(path).length, path).toBeGreaterThan(200);
  });

  it('링크(<a>·href)·tel:·외부 주소·저장소·기록·주소 이동·console 이 하나도 없다 (찾은 것 0건)', () => {
    const found = SHEET_FILES.flatMap((path) => scanSource(path, texts(path)));
    expect(found).toEqual([]);
  });

  it('1544-8069(문의 번호)는 이 화면들에 없다: 번호는 세대 확인 안내에만 문구로 있다', () => {
    for (const path of SHEET_FILES) expect(texts(path), path).not.toMatch(/1544|1588/);
  });

  it('타이머를 만들지 않는다: 이용 완료의 자동 복귀는 상태 기계(completionHoldSeconds)만 맡고 화면은 10초 같은 값을 따로 쓰지 않는다', () => {
    for (const path of SHEET_FILES) {
      const names = identifiersOf(texts(path));
      for (const forbidden of ['setTimeout', 'setInterval', 'requestAnimationFrame', 'Date']) expect(names.has(forbidden), `${path}: ${forbidden}`).toBe(false);
    }
    // 완료 화면 값 보기에서만 completionHoldSeconds 를 읽는다. 화면 쪽 코드(screens·components)는 읽지 않는다.
    const readers = sources.filter((file) => identifiersOf(file.text).has('completionHoldSeconds')).map((file) => file.path);
    expect(readers.filter((path) => !path.startsWith('src/app/kiosk/state/'))).toEqual(['src/app/kiosk/view/complete-view.ts']);
  });

  it('디자인 예시 문장·예시 값은 소스에 없다 (응답에 있는 값만 보인다, plan.md §E #27)', () => {
    const SAMPLE = ['디자인 예시', '구현 단계에서 검토된', '규칙 ID가 표시되는 자리', '의원 외래 고정 공제', '회당 지급한도(가정) 250,000', '보험사 재량', 'X-ray · 초음파 검사가 있어', '신장분사치료가 보험사 재량', '다친 경위와 최초 진료 내용을 확인합니다', '병명과 치료 내용을 확인합니다', '통원 치료 기준 · 진료받은 날짜를 확인합니다', '반드시 함께 제출합니다'];
    // 주석에서 "디자인 예시" 를 설명하는 것은 괜찮다: 화면에 그려지는 문자열(문자열·템플릿 토큰)만 본다.
    const found = sources.flatMap((file) => {
      const strings = tokenize(file.text)
        .filter((token) => token.kind === 'string' || token.kind === 'template')
        .map((token) => token.text);
      return SAMPLE.filter((sample) => strings.some((text) => text.includes(sample))).map((sample) => `${file.path}: ${sample}`);
    });
    expect(found).toEqual([]);
  });

  it('서류 줄에 쓸 문장(사유)은 응답의 값뿐이다: 서류 사유로 보이는 고정 문장이 없다 (copy.ts 의 안내 문장 제외)', () => {
    const view = texts('src/app/kiosk/view/documents-view.ts');
    const strings = tokenize(view)
      .filter((token) => token.kind === 'string' || token.kind === 'template')
      .map((token) => token.text);
    expect(strings.filter((text) => /확인합니다|필요합니다|제출합니다/.test(text))).toEqual([]);
  });
});

describe('보기 모양이 응답을 읽는 단일 곳이다', () => {
  it('기존 약속(result-boundary) 위에: 화면·컴포넌트는 documents·basis 응답 필드를 직접 읽지 않는다', () => {
    const FORBIDDEN = ['policySources', 'insurerDocumentId', 'revisionDate', 'clauseOrPage', 'verifiedBy', 'D_applied', 'P_pooled', 'ruleSetId'];
    const found = sources
      .filter((file) => ['screens', 'components', 'overlays', 'runtime'].some((folder) => file.path.startsWith(`src/app/kiosk/${folder}/`)))
      .flatMap((file) => {
        const names = identifiersOf(file.text);
        return FORBIDDEN.filter((name) => names.has(name)).map((name) => `${file.path}: ${name}`);
      });
    expect(found).toEqual([]);
  });
});
