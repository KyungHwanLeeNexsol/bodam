import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BASIS_POINTS_SCALE, ROUNDING_HALF } from '../../src/engine/constants';
import { checkEngineLiterals, readSourceFiles } from './source-scan';
import type { LiteralRules, Violation } from './source-scan';

// AC-001c (정적 검사, 좁은 범위): 보험 업무 값을 뜻하는 이름(deduct*, limit*, rate*, payout*, copay*, fixed*, floor*, cap*, ratio*)에
// 묶이거나 비교되는 숫자 리터럴은 src/engine/constants.ts 나 limits.ts 에서만 선언할 수 있다. 이 검사는 보조 증거이고
// 주 증거는 프로필 숫자 필드를 하나씩 바꾸는 동작 시험(profile-sensitivity.test.ts)이다.
// 규칙(구현자가 정함, acceptance.md AC-001c "정확한 규칙은 M1.4에서 구현자가 정하되 이 예를 만족해야 한다"):
//  1) 식별자를 낙타표기·밑줄 기준 단어로 나눠 어느 단어든 위 어간으로 시작하면 업무 이름이다.
//  2) 숫자 리터럴의 바로 앞 또는 바로 뒤 피연산자가 업무 이름이고 둘 사이 연산자가 대입(=, +=, ...)·속성(:)·비교·산술·기본값(??, ||)이면 위반이다.
//  3) 0 과 1 도 예외가 아니다(빠진 값을 0 으로 채우는 일이 이 검사가 막으려는 위험이다).
//  4) interface·type 선언 안의 숫자(형식 수준 리터럴)는 값이 아니므로 보지 않는다.
//  5) 비율 척도 10000 과 그 절반 5000 은 이름과 상관없이 constants.ts 와 limits.ts(MAX_BASIS_POINTS) 밖에서 쓰면 위반이다(design.md 상수 규칙).
// 시험 자료: 아래 합성 소스는 검사기 시험용 문자열이며 실제 보험 값이 아니다.

const ENGINE_DIR = fileURLToPath(new URL('../../src/engine', import.meta.url));
const realFiles = readSourceFiles(ENGINE_DIR, 'src/engine');

/** 타입이 정한 상수 0 처럼 업무 값이 아닌 자리의 허용 목록. 항목마다 이유가 있고 실제 소스에서 정확히 한 번 일치해야 한다. */
const RULES: LiteralRules = {
  exemptFiles: ['src/engine/constants.ts', 'src/engine/limits.ts'],
  scaleValues: [BASIS_POINTS_SCALE, ROUNDING_HALF],
  allowlist: [
    {
      file: 'src/engine/estimate.ts',
      name: 'payout',
      literal: '0',
      reason: 'ExcludedItem.payout 은 형식이 상수 0 으로 정한 필드다 (design.md DD-03, AC-002e). 보험 업무 값이 아니라 "제외 항목은 지급액 0" 이라는 계약 표시다.',
    },
  ],
};

function scan(text: string, path = 'src/engine/synthetic.ts', rules: LiteralRules = RULES) {
  return checkEngineLiterals([{ path, text }], rules);
}

function ruleNames(violations: Violation[]): string[] {
  return violations.map((violation) => violation.rule);
}

describe('AC-001c 실제 src/engine 소스', () => {
  const report = checkEngineLiterals(realFiles, RULES);

  it('업무 값 이름에 묶인 숫자 리터럴과 척도 리터럴 위반이 없다', () => {
    expect(report.violations).toEqual([]);
  });

  it('검사가 비어 있지 않다: 숫자 리터럴을 실제로 읽었고 허용 목록은 정확히 한 번 일치했다', () => {
    expect(report.numericLiterals).toBeGreaterThan(10);
    expect(report.allowed).toEqual([{ file: 'src/engine/estimate.ts', name: 'payout', literal: '0' }]);
  });

  it('허용 목록을 비우면 같은 항목이 위반으로 나온다 (허용 목록이 낡아도 알 수 있다)', () => {
    const strict = checkEngineLiterals(realFiles, { ...RULES, allowlist: [] });
    expect(strict.violations.map((violation) => [violation.file, violation.rule])).toEqual([['src/engine/estimate.ts', 'BUSINESS_LITERAL']]);
  });

  it('척도 상수는 constants.ts 한 곳에만 선언되어 있다', () => {
    const declarations = realFiles.filter((file) => /export const BASIS_POINTS_SCALE\s*=\s*10_000/.test(file.text));
    expect(declarations.map((file) => file.path)).toEqual(['src/engine/constants.ts']);
    expect(BASIS_POINTS_SCALE).toBe(10_000);
    expect(ROUNDING_HALF).toBe(5_000);
  });
});

describe('음성 시험: 업무 값 이름에 묶인 숫자 리터럴은 검사가 실패한다', () => {
  const negatives: Array<[string, string]> = [
    ['AC-001c 예: const deductible = 10000', 'const deductible = 10000;'],
    ['밑줄 숫자', 'const deductible = 10_000;'],
    ['상수 이름이어도 업무 이름이면 위반', 'export const MAX_LIMIT = 500000;'],
    ['비교 (오른쪽 리터럴)', 'if (rate > 3000) { run(); }'],
    ['비교 (왼쪽 리터럴)', 'if (3000 < rate) { run(); }'],
    ['객체 속성', 'const o = { payout: 114000 };'],
    ['속성 대입, 16진', 'x.copay = 0x2710;'],
    ['지수 표기', 'const fixedAmount = 1e4;'],
    ['BigInt', 'let cap = 5000n;'],
    ['형식 주석이 붙은 선언', 'const rateBenefit: number = 1000;'],
    ['기본값 연산자 ??', 'const v = rule.limit ?? 0;'],
    ['기본값 연산자 ||', 'const v = rule.fixed || 5;'],
    ['기본 매개변수', 'function f(floor = 7) { return floor; }'],
    ['산술 피연산자', 'const v = ratio * 2;'],
    ['복합 대입', 'deducted += 300;'],
    ['0 도 예외가 아니다', 'const deductible = 0;'],
    ['1 도 예외가 아니다', 'const copayRate = 1;'],
    ['삼항의 값', 'const v = ok ? limit : 99;'],
    ['속성 접근의 마지막 이름', 'if (profile.groups.deductAmount === 700) { run(); }'],
  ];

  it.each(negatives)('%s', (_label, source) => {
    const report = scan(source);
    expect(ruleNames(report.violations)).toContain('BUSINESS_LITERAL');
  });

  it('위반 보고에는 파일·줄·이름·리터럴이 들어 있다', () => {
    const report = scan('const a = 1;\n\nconst deductible = 10000;\n', 'src/engine/where.ts');
    expect(report.violations[0]).toMatchObject({ file: 'src/engine/where.ts', line: 3, rule: 'BUSINESS_LITERAL' });
    expect(report.violations[0]?.detail).toContain('deductible');
    expect(report.violations[0]?.detail).toContain('10000');
  });

  it('numeric.ts 처럼 선언 면제 목록에 없는 파일에서는 같은 선언도 위반이다', () => {
    expect(ruleNames(scan('const deductible = 10000;', 'src/engine/numeric.ts').violations)).toContain('BUSINESS_LITERAL');
    expect(ruleNames(scan('const deductible = 10000;', 'src/engine/estimate.ts').violations)).toContain('BUSINESS_LITERAL');
  });

  it('constants.ts·limits.ts 에서는 같은 선언이 면제된다', () => {
    expect(scan('export const FIXED_FEE = 10000;', 'src/engine/constants.ts').violations).toEqual([]);
    expect(scan('export const MAX_LIMIT = 500000;', 'src/engine/limits.ts').violations).toEqual([]);
  });

  it('허용 목록은 파일·이름·값이 모두 같을 때만 적용된다', () => {
    expect(scan('const o = { payout: 0 as const };', 'src/engine/estimate.ts').violations).toEqual([]);
    expect(ruleNames(scan('const o = { payout: 0 as const };', 'src/engine/other.ts').violations)).toContain('BUSINESS_LITERAL');
    expect(ruleNames(scan('const o = { payout: 1 };', 'src/engine/estimate.ts').violations)).toContain('BUSINESS_LITERAL');
    expect(ruleNames(scan('const o = { limit: 0 };', 'src/engine/estimate.ts').violations)).toContain('BUSINESS_LITERAL');
  });
});

describe('음성 시험: 비율 척도 리터럴은 이름과 상관없이 constants.ts 밖에서 쓰면 검사가 실패한다', () => {
  const scaleCases: Array<[string, string]> = [
    ['척도를 이름 없이 나눗셈에 쓴다', 'const q = Math.floor(value / 10000);'],
    ['밑줄 표기', 'const q = value / 10_000;'],
    ['절반 5000', 'const h = x + 5000;'],
    ['16진 표기 (0x2710 = 10000)', 'const q = value / 0x2710;'],
    ['BigInt 표기', 'const q = value / 10000n;'],
    ['지수 표기 (1e4 = 10000)', 'const q = value / 1e4;'],
    ['업무 이름이 아닌 상수로 숨긴다', 'const SCALE = 10000;'],
  ];

  it.each(scaleCases)('%s', (_label, source) => {
    expect(ruleNames(scan(source).violations)).toContain('SCALE_LITERAL');
  });

  it('constants.ts 와 limits.ts 에서는 면제된다', () => {
    expect(scan('export const BASIS_POINTS_SCALE = 10_000;', 'src/engine/constants.ts').violations).toEqual([]);
    expect(scan('export const MAX_BASIS_POINTS = 10_000;', 'src/engine/limits.ts').violations).toEqual([]);
  });
});

describe('양성 시험: 인덱스·카운터·반복 한계·배열 길이로 쓴 숫자는 실패하지 않는다', () => {
  const positives: Array<[string, string]> = [
    ['for 반복', 'for (let i = 0; i < n; i += 1) { run(i); }'],
    ['마지막 원소', 'const last = items[items.length - 1];'],
    ['길이 비교', 'if (items.length === 0) { return; }'],
    ['누적 변수 초기값', 'let total = 0; let count = 0;'],
    ['인덱스', 'const index = 2; const pair = items.slice(0, 3);'],
    ['반복 한계', 'const maxIterations = 100; for (let n = 0; n < maxIterations; n += 1) { run(n); }'],
    ['한도 배열의 길이', 'const last = limits[limits.length - 1]; if (limits.length > 2) { run(); }'],
    ['정렬 비교자의 -1 / 1', 'const c = a < b ? -1 : 1;'],
    ['업무 이름 변수의 배열 리터럴 안', 'const limits = [one, two]; const n = limits.length;'],
    ['업무 이름 변수에 식별자 대입', 'const deductible = base; const rate = other.rate;'],
    ['업무 이름 변수를 인자로 넘김', 'const v = Math.max(deductible, floorAmount);'],
    ['Math.max(E - D, 0)', 'const afterDeduction = Math.max(E - D, 0);'],
    ['문자열에 든 숫자와 업무 이름', "const label = 'rate 10000'; const key = 'deductible=5000';"],
    ['주석에 든 숫자와 업무 이름', '// const deductible = 10000;\n/* limit = 5000 */\nexport const ok = true;'],
    ['정규식 안의 수량자', 'const ISO_DATE = /^(\\d{4})-(\\d{2})$/; const m = ISO_DATE.exec(text);'],
    ['interface 안의 리터럴 형식', 'export interface Excluded { payout: 0; fixed: 100; }'],
    ['type 별칭 안의 리터럴 형식', 'export type Row = { payout: 0; ratio: 1 | 2 };\nexport const keep = 1;'],
    ['제네릭 type 별칭', 'type Pair<T> = { limit: 5; value: T };\nconst x = 1;'],
  ];

  it.each(positives)('%s', (_label, source) => {
    expect(scan(source).violations).toEqual([]);
  });
});

describe('토큰 분리', () => {
  it('낙타표기·밑줄 단어 단위로 업무 이름을 판정한다 (operate·separate 처럼 어간이 단어 안에 숨은 이름은 걸리지 않는다)', () => {
    expect(scan('const operate = 5; const separate = 6; const generated = 7;').violations).toEqual([]);
    expect(ruleNames(scan('const perVisitLimit = 5;').violations)).toContain('BUSINESS_LITERAL');
    expect(ruleNames(scan('const per_visit_limit = 5;').violations)).toContain('BUSINESS_LITERAL');
    expect(ruleNames(scan('const MAX_RATE_VALUE = 5;').violations)).toContain('BUSINESS_LITERAL');
    expect(ruleNames(scan('const appliedDeduction = 5;').violations)).toContain('BUSINESS_LITERAL');
  });

  it('읽을 수 없는 소스는 SCAN_ERROR 위반으로 닫힌 실패한다', () => {
    expect(ruleNames(scan("const a = 'abc;").violations)).toContain('SCAN_ERROR');
  });
});
