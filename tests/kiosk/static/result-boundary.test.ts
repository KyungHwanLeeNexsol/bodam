import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractModuleRefs, readSourceFiles, tokenize } from '../../boundary/source-scan';

// 결과 화면의 경계 (SPEC-REIMBURSEMENT-001 M6 S3a, BRIEF §0, DD-21, AC-013c·AC-019c): 화면 쪽 코드에는 보험 계산이 없고, 응답의 금액·보류 사유·참고 그룹을 직접 읽는 곳이 보기 모양(view/) 하나다.
// 어휘 수준 검사다(별칭·문자열로 만든 접근은 못 잡는다). 환자 화면에 실제로 나오는 문구는 tests/kiosk/screens 와 브라우저 시험이 본다.

const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const sources = readSourceFiles(join(REPO, 'src/app/kiosk'), 'src/app/kiosk');
const inFolders = (...folders: string[]) => sources.filter((file) => folders.some((folder) => file.path.startsWith(`src/app/kiosk/${folder}/`)));

/** 코드(주석·문자열이 아닌) 식별자 이름 집합. */
function identifiers(text: string): Set<string> {
  return new Set(tokenize(text).filter((token) => token.kind === 'ident').map((token) => token.text));
}

describe('화면·컴포넌트·겹침창·런타임은 응답의 금액·보류 사유·참고 그룹을 직접 읽지 않는다', () => {
  // 금액·보류·참고 그룹은 view/result-view.ts 가 문자열로 바꿔 준 값만 그린다: 화면에 보험 계산이나 "0원" 대체가 들어올 자리가 없다.
  const FORBIDDEN = ['hospitalPayment', 'expectedInsurancePayout', 'expectedOutOfPocketAfterPayout', 'referenceGroups', 'holdReason', 'holdReasons', 'excludedItems', 'policySources'];

  it('금지 이름이 하나도 없다 (찾은 것 0건)', () => {
    const found = inFolders('screens', 'components', 'overlays', 'runtime').flatMap((file) => {
      const names = identifiers(file.text);
      return FORBIDDEN.filter((name) => names.has(name)).map((name) => `${file.path}: ${name}`);
    });
    expect(found).toEqual([]);
  });

  it('검사가 비어 있지 않다: 결과 화면 파일이 실제로 읽혔고, 보기 모양은 그 이름들을 읽는다 (대조군)', () => {
    expect(inFolders('screens').map((file) => file.path)).toEqual(expect.arrayContaining(['src/app/kiosk/screens/ResultScreens.tsx', 'src/app/kiosk/screens/CalculatingScreen.tsx', 'src/app/kiosk/screens/NetworkErrorScreen.tsx']));
    const view = sources.find((file) => file.path === 'src/app/kiosk/view/result-view.ts');
    expect(view).toBeDefined();
    const names = identifiers(view?.text ?? '');
    for (const name of ['hospitalPayment', 'expectedInsurancePayout', 'holdReasons', 'excludedItems']) expect(names.has(name), name).toBe(true);
    // 참고 그룹은 보기 모양도 읽지 않는다 (환자 화면에 나오지 않는다).
    expect(names.has('referenceGroups')).toBe(false);
  });
});

describe('보험 계산 코드는 상태 쪽 선택자에만 있다 (AC-019c: 화면의 유일한 합산은 selectTotals 의 엔진 sumLineAmounts)', () => {
  it('화면·컴포넌트·겹침창·보기 모양은 엔진의 계산 모듈(numeric·estimate·deduction·limit·sum)을 가져오지 않는다', () => {
    const ENGINE_MATH = /engine\/(numeric|estimate|deduction|limit|sum|group-values|resolve)\b/;
    // runtime/parse.ts 는 병원 자료 응답의 합계가 안전한 정수인지 검사하려고 sumLineAmounts 를 쓴다(S1). 보험 계산이 아니라 입력 검증이라 화면 쪽 코드만 본다.
    const found = inFolders('screens', 'components', 'overlays', 'view')
      .flatMap((file) => extractModuleRefs(tokenize(file.text)).filter((ref) => ref.specifier !== null && ENGINE_MATH.test(ref.specifier)).map((ref) => `${file.path}: ${ref.specifier}`));
    expect(found).toEqual([]);
  });

  it('selectTotals 는 엔진의 sumLineAmounts 를 쓰고 결과 보기 모양은 selectTotals 를 부른다 (두 경로의 합이 같은 모듈)', () => {
    const selectors = sources.find((file) => file.path === 'src/app/kiosk/state/selectors.ts');
    expect(selectors?.text).toContain("from '../../../engine/numeric'");
    expect(identifiers(selectors?.text ?? '').has('sumLineAmounts')).toBe(true);
    const view = sources.find((file) => file.path === 'src/app/kiosk/view/result-view.ts');
    expect(identifiers(view?.text ?? '').has('selectTotals')).toBe(true);
  });

  it('모듈 동일성 (AC-019c): 키오스크 합계(selectors.ts)와 서버가 병원 결제액 T 를 세는 엔진(validate.ts)이 같은 모듈 engine/numeric 의 같은 함수 sumLineAmounts 를 쓴다', () => {
    const validate = readFileSync(join(REPO, 'src/engine/validate.ts'), 'utf8');
    expect(validate).toContain("import { isWon, sumLineAmounts } from './numeric';");
    expect(validate).toMatch(/sum: \(amounts: readonly number\[\]\) => CheckedResult = sumLineAmounts/);
    // 서버의 계산 경로가 엔진 estimate() 를 부르고 그 안의 검증이 T 를 센다. 키오스크 쪽 합계는 같은 numeric 모듈의 같은 이름이다.
    const selectors = sources.find((file) => file.path === 'src/app/kiosk/state/selectors.ts');
    expect(selectors?.text).toContain("import { sumLineAmounts } from '../../../engine/numeric';");
    const numeric = readFileSync(join(REPO, 'src/engine/numeric.ts'), 'utf8');
    expect(numeric).toContain('export function sumLineAmounts');
  });
});

describe('결과 화면 문구는 copy.ts 한 곳에 있다', () => {
  it('고정 문장(결과 문구 원칙·개인 계약 조건·세 번째 카드 보조 설명)이 copy.ts 밖의 소스에 없다', () => {
    const SENTENCES = ['표준 공제·한도 가정으로 계산한', '개인별 부담보, 면책·보장기간', '보험금을 받은 뒤 남는 예상 부담액', '예상 병원 결제액', '이 치료의 보장 분류를 검토하고 있습니다'];
    const found = sources
      .filter((file) => file.path !== 'src/app/kiosk/view/copy.ts')
      .flatMap((file) => {
        const strings = tokenize(file.text)
          .filter((token) => token.kind === 'string' || token.kind === 'template')
          .map((token) => token.text);
        return SENTENCES.filter((sentence) => strings.some((text) => text.includes(sentence))).map((sentence) => `${file.path}: ${sentence}`);
      });
    expect(found).toEqual([]);
  });
});

describe('고정 이름(aria-label)은 copy.ts 한 곳에 있다 (F5)', () => {
  const SOURCES = inFolders('screens', 'components', 'overlays').filter((file) => /\.tsx?$/.test(file.path));
  const isComment = (line: string): boolean => /^\s*(\/\/|\/\*|\*)/.test(line);

  it('aria-label 속성과 label 기본값에 한글 글자를 직접 쓴 곳이 없다 (COPY 를 거친다)', () => {
    const found = SOURCES.flatMap((file) =>
      file.text
        .split('\n')
        .map((line, index) => ({ line, number: index + 1 }))
        .filter(({ line }) => !isComment(line) && (/aria-label=\{?\s*['"][^'"]*[가-힣]/.test(line) || /\blabel\s*=\s*['"][^'"]*[가-힣]/.test(line)))
        .map(({ number }) => `${file.path}:${String(number)}`),
    );
    expect(found).toEqual([]);
  });

  it('쪽 넘김·선택 요약·단계 표시·이용 순서의 이름이 copy.ts 밖의 소스에 없다', () => {
    const NAMES = ['치료 목록 쪽', '선택 요약', '진행 단계', '이용 순서'];
    const found = sources
      .filter((file) => file.path !== 'src/app/kiosk/view/copy.ts')
      .flatMap((file) => {
        const strings = tokenize(file.text)
          .filter((token) => token.kind === 'string' || token.kind === 'template')
          .map((token) => token.text);
        const lines = file.text.split('\n').filter((line) => !isComment(line));
        return NAMES.filter((name) => strings.some((text) => text === name) || lines.some((line) => line.includes(`"${name}"`))).map((name) => `${file.path}: ${name}`);
      });
    expect(found).toEqual([]);
  });
});
