import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { estimate } from '../../src/engine/estimate';
import * as documentsModule from '../../src/engine/documents';
import * as groupValuesModule from '../../src/engine/group-values';
import * as profileStructureModule from '../../src/engine/profile-structure';
import * as resolveModule from '../../src/engine/resolve';
import * as usabilityModule from '../../src/engine/usability';
import { computeReadiness } from '../../src/server/readiness';
import { ALL_CELLS, TEST_CTX, bundleOf, clinicOf, snapshotOf } from '../fixtures/server/readiness.fixture';

// AC-011l (6) 보강 (M3.E 보강 세션): "두 번째 구현 없음" 을 함수 객체 수준으로 증명한다.
// 기존 readiness-reuse.test.ts 는 (a) 가져오기 문장 검사 (b) 비교 금지 검사 (c) 주입한 감시 함수의 호출 검사를 한다. 그러나 (c) 는 시험이
// 함수를 주입해야만 닿기 때문에, 기본 경로(주입 없음)가 엔진 함수 객체가 아닌 지역 함수를 쓰도록 바뀌어도 통과한다.
// 이 파일은 엔진 모듈 자체를 vi.mock 으로 감싸(원래 함수에 위임하는 호출 기록 함수) 기본 경로가 부르는 함수가 estimate() 가 부르는 바로 그 모듈 export 인지 본다.
// 엔진의 모듈 그래프를 통하지 않는 호출(지역 복사본)은 이 기록에 잡히지 않는다.

vi.mock('../../src/engine/usability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/usability')>();
  return { ...actual, isBundleUsable: vi.fn(actual.isBundleUsable), isUsable: vi.fn(actual.isUsable) };
});
vi.mock('../../src/engine/resolve', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/resolve')>();
  return { ...actual, resolveProfile: vi.fn(actual.resolveProfile), resolveMapping: vi.fn(actual.resolveMapping), decideLine: vi.fn(actual.decideLine) };
});
vi.mock('../../src/engine/group-values', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/group-values')>();
  return { ...actual, checkGroupValues: vi.fn(actual.checkGroupValues) };
});
vi.mock('../../src/engine/profile-structure', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/profile-structure')>();
  return { ...actual, checkProfileStructure: vi.fn(actual.checkProfileStructure) };
});
vi.mock('../../src/engine/documents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/documents')>();
  return { ...actual, selectDocumentRuleSet: vi.fn(actual.selectDocumentRuleSet) };
});

const spied = {
  isBundleUsable: vi.mocked(usabilityModule.isBundleUsable),
  isUsable: vi.mocked(usabilityModule.isUsable),
  resolveProfile: vi.mocked(resolveModule.resolveProfile),
  resolveMapping: vi.mocked(resolveModule.resolveMapping),
  decideLine: vi.mocked(resolveModule.decideLine),
  checkGroupValues: vi.mocked(groupValuesModule.checkGroupValues),
  checkProfileStructure: vi.mocked(profileStructureModule.checkProfileStructure),
  selectDocumentRuleSet: vi.mocked(documentsModule.selectDocumentRuleSet),
};
type Name = keyof typeof spied;
const NAMES = Object.keys(spied) as Name[];
/** estimate() 가 부르는 엔진 함수. selectDocumentRuleSet 은 서류 산출 경로(deriveDocuments 의 호출자)가 부르며 estimate() 는 부르지 않는다. */
const ESTIMATE_USES: Name[] = NAMES.filter((name) => name !== 'selectDocumentRuleSet');

const counts = (): Record<Name, number> => Object.fromEntries(NAMES.map((name) => [name, spied[name].mock.calls.length])) as Record<Name, number>;
const reset = (): void => NAMES.forEach((name) => spied[name].mockClear());

// 호출 기록은 시험마다 비운다. 구현을 바꾼 시험은 try/finally 로 원래 함수(importActual)로 되돌린다.
const originalUsability = await vi.importActual<typeof import('../../src/engine/usability')>('../../src/engine/usability');
const originalGroupValues = await vi.importActual<typeof import('../../src/engine/group-values')>('../../src/engine/group-values');
afterEach(() => {
  NAMES.forEach((name) => spied[name].mockClear());
});

const clinic = clinicOf(bundleOf());
const world = () => snapshotOf([clinic]);
const estimateAll = (): void => {
  for (const cell of ALL_CELLS) {
    estimate(
      {
        generation: cell.generation,
        insurerType: cell.insurerType,
        treatmentIds: clinic.lines.map((line) => line.treatmentId),
        lines: clinic.lines,
        baseFeeLines: clinic.baseFeeLines,
        bundle: clinic.bundle,
        at: TEST_CTX.at,
        acceptedOrigins: { rules: [...TEST_CTX.acceptedOrigins.rules], lines: [...TEST_CTX.acceptedOrigins.lines] },
      },
      { digest: TEST_CTX.digest },
    );
  }
};

describe('AC-011l (6) 기본 경로(주입 없음)가 부르는 함수는 엔진 모듈의 바로 그 export 다', () => {
  it('이 시험의 감시가 살아 있다: estimate() 는 감시된 엔진 함수 일곱을 모두 부른다', () => {
    reset();
    estimateAll();
    const used = counts();
    for (const name of ESTIMATE_USES) expect(used[name], `${name} (estimate)`).toBeGreaterThan(0);
    expect(used.selectDocumentRuleSet).toBe(0);
  });

  it('computeReadiness 는 주입 없이도 감시된 엔진 함수 여덟을 모두 부른다', () => {
    reset();
    computeReadiness(world(), TEST_CTX);
    const used = counts();
    for (const name of NAMES) expect(used[name], `${name} (readiness)`).toBeGreaterThan(0);
  });

  it('준비 상태 계산이 부르는 함수 종류는 estimate() 가 부르는 함수 종류에 서류 규칙 선택을 더한 것과 정확히 같다 (그 밖의 감시 대상 함수를 따로 부르지 않는다)', () => {
    reset();
    computeReadiness(world(), TEST_CTX);
    const readiness = NAMES.filter((name) => counts()[name] > 0).sort();
    reset();
    estimateAll();
    const estimated = NAMES.filter((name) => counts()[name] > 0);
    expect(readiness).toEqual([...estimated, 'selectDocumentRuleSet'].sort());
  });

  it('같은 입력으로 같은 코드를 낸다: 감시 래퍼를 거쳐도 보고는 바뀌지 않는다 (래퍼는 원래 함수에 위임한다)', () => {
    const first = computeReadiness(world(), TEST_CTX);
    const second = computeReadiness(world(), TEST_CTX);
    expect(second).toEqual(first);
    expect(first.clinics[0]!.calculationReady.every((row) => row.status === 'READY')).toBe(true);
  });
});

describe('AC-011l (6) 엔진 함수 하나를 바꾸면 estimate() 와 준비 상태 계산이 함께 바뀐다 (한 곳의 판정을 둘이 나눠 쓴다)', () => {
  it('isUsable 을 "항목은 모두 DRAFT" 로 바꾸면: estimate() 의 모든 줄이 PROFILE_DRAFT 이고 표 P 의 모든 칸도 PROFILE_DRAFT', () => {
    spied.isUsable.mockImplementation(() => ({ usable: false, reason: 'STATE_DRAFT' }));
    try {
      const est = estimate(
        {
          generation: ALL_CELLS[0]!.generation,
          insurerType: ALL_CELLS[0]!.insurerType,
          treatmentIds: clinic.lines.map((line) => line.treatmentId),
          lines: clinic.lines,
          baseFeeLines: clinic.baseFeeLines,
          bundle: clinic.bundle,
          at: TEST_CTX.at,
          acceptedOrigins: { rules: [...TEST_CTX.acceptedOrigins.rules], lines: [...TEST_CTX.acceptedOrigins.lines] },
        },
        { digest: TEST_CTX.digest },
      );
      expect(est.ok && est.result.holdReasons.every((hold) => hold.code === 'PROFILE_DRAFT')).toBe(true);
      const report = computeReadiness(world(), TEST_CTX);
      expect(report.clinics[0]!.profiles.every((row) => row.status === 'NOT_READY' && row.code === 'PROFILE_DRAFT')).toBe(true);
      expect(report.platformProfiles.every((row) => row.status === 'NOT_READY' && row.code === 'PROFILE_DRAFT')).toBe(true);
      expect(report.clinics[0]!.documents).toMatchObject({ status: 'NOT_READY', detail: 'STATE_DRAFT' });
    } finally {
      spied.isUsable.mockImplementation(originalUsability.isUsable);
    }
  });

  it('checkGroupValues 를 "값 무효" 로 바꾸면: estimate() 의 COVERED 줄 보류도 표 M 의 사용 가능한 COVERED 행도 PROFILE_VALUE_INVALID', () => {
    spied.checkGroupValues.mockImplementation(() => 'PROFILE_VALUE_INVALID');
    try {
      const est = estimate(
        {
          generation: ALL_CELLS[0]!.generation,
          insurerType: ALL_CELLS[0]!.insurerType,
          treatmentIds: clinic.lines.map((line) => line.treatmentId),
          lines: clinic.lines,
          baseFeeLines: clinic.baseFeeLines,
          bundle: clinic.bundle,
          at: TEST_CTX.at,
          acceptedOrigins: { rules: [...TEST_CTX.acceptedOrigins.rules], lines: [...TEST_CTX.acceptedOrigins.lines] },
        },
        { digest: TEST_CTX.digest },
      );
      expect(est.ok && est.result.holdReasons.length).toBeGreaterThan(0);
      expect(est.ok && est.result.holdReasons.every((hold) => hold.code === 'PROFILE_VALUE_INVALID')).toBe(true);
      const rows = computeReadiness(world(), TEST_CTX).clinics[0]!.mappings;
      expect(rows.every((row) => row.status === 'NOT_READY' && row.code === 'PROFILE_VALUE_INVALID')).toBe(true);
    } finally {
      spied.checkGroupValues.mockImplementation(originalGroupValues.checkGroupValues);
    }
  });
});

describe('AC-011l (6) 여덟 엔진 함수 모두: 바꾸면 준비 상태 계산이 따라 바뀐다 (호출 횟수가 아니라 결과로 보이는 연결)', () => {
  // 호출 횟수만으로는 엔진 함수가 서로를 부르는 경로(예: selectDocumentRuleSet 이 안에서 isBundleUsable 을 부름)와 구별되지 않는다.
  // 그래서 함수마다 결과를 바꿔 보고, 준비 상태의 해당 표가 그 바뀐 결과를 그대로 따르는지 본다.
  const estimateOnce = () =>
    estimate(
      {
        generation: ALL_CELLS[0]!.generation,
        insurerType: ALL_CELLS[0]!.insurerType,
        treatmentIds: clinic.lines.map((line) => line.treatmentId),
        lines: clinic.lines,
        baseFeeLines: clinic.baseFeeLines,
        bundle: clinic.bundle,
        at: TEST_CTX.at,
        acceptedOrigins: { rules: [...TEST_CTX.acceptedOrigins.rules], lines: [...TEST_CTX.acceptedOrigins.lines] },
      },
      { digest: TEST_CTX.digest },
    );
  const holdCodes = (): string[] => {
    const outcome = estimateOnce();
    return outcome.ok ? [...new Set(outcome.result.holdReasons.map((hold) => hold.code))] : ['REJECTED'];
  };

  it('isBundleUsable → 중지: estimate() 는 RULE_BUNDLE_SUSPENDED, 표 S·표 P(병원·플랫폼)·calculationReady·documentReady 모두 그 코드', async () => {
    const actual = await vi.importActual<typeof import('../../src/engine/usability')>('../../src/engine/usability');
    spied.isBundleUsable.mockImplementation(() => ({ usable: false, reason: 'BUNDLE_SUSPENDED' }));
    try {
      expect(holdCodes()).toEqual(['RULE_BUNDLE_SUSPENDED']);
      const report = computeReadiness(world(), TEST_CTX);
      const row = report.clinics[0]!;
      expect(row.scope).toMatchObject({ status: 'NOT_READY', code: 'RULE_BUNDLE_SUSPENDED' });
      expect(row.profiles.every((entry) => entry.status === 'NOT_READY' && entry.code === 'RULE_BUNDLE_SUSPENDED')).toBe(true);
      expect(report.platformProfiles.every((entry) => entry.status === 'NOT_READY' && entry.code === 'RULE_BUNDLE_SUSPENDED')).toBe(true);
      expect(row.calculationReady.every((entry) => entry.status === 'NOT_READY' && entry.stage === 'S')).toBe(true);
      expect(row.documentReady).toEqual({ status: 'NOT_READY', stage: 'S', code: 'RULE_BUNDLE_SUSPENDED' });
    } finally {
      spied.isBundleUsable.mockImplementation(actual.isBundleUsable);
    }
  });

  it('resolveProfile → 해석 안 됨(PROFILE_DEMO): estimate() 의 모든 줄과 표 P(병원·플랫폼)·calculationReady(P 단계)가 PROFILE_DEMO', async () => {
    const actual = await vi.importActual<typeof import('../../src/engine/resolve')>('../../src/engine/resolve');
    spied.resolveProfile.mockImplementation(() => ({ resolved: false, code: 'PROFILE_DEMO' }));
    try {
      expect(holdCodes()).toEqual(['PROFILE_DEMO']);
      const report = computeReadiness(world(), TEST_CTX);
      const row = report.clinics[0]!;
      expect(row.profiles.every((entry) => entry.status === 'NOT_READY' && entry.code === 'PROFILE_DEMO')).toBe(true);
      expect(report.platformProfiles.every((entry) => entry.status === 'NOT_READY' && entry.code === 'PROFILE_DEMO')).toBe(true);
      expect(row.calculationReady.every((entry) => entry.status === 'NOT_READY' && entry.stage === 'P')).toBe(true);
    } finally {
      spied.resolveProfile.mockImplementation(actual.resolveProfile);
    }
  });

  it('checkProfileStructure → 구조 결함: estimate() 는 PROFILE_INVALID, 표 P 도 PROFILE_INVALID', async () => {
    const actual = await vi.importActual<typeof import('../../src/engine/profile-structure')>('../../src/engine/profile-structure');
    spied.checkProfileStructure.mockImplementation(() => ({ ok: false, defects: [{ code: 'EMPTY_PROFILE', path: 'groups' }] }));
    try {
      expect(holdCodes()).toEqual(['PROFILE_INVALID']);
      const row = computeReadiness(world(), TEST_CTX).clinics[0]!;
      expect(row.profiles.every((entry) => entry.status === 'NOT_READY' && entry.code === 'PROFILE_INVALID')).toBe(true);
    } finally {
      spied.checkProfileStructure.mockImplementation(actual.checkProfileStructure);
    }
  });

  it('resolveMapping → 반려: estimate() 의 모든 줄과 표 M 의 모든 행이 MAPPING_REJECTED', async () => {
    const actual = await vi.importActual<typeof import('../../src/engine/resolve')>('../../src/engine/resolve');
    spied.resolveMapping.mockImplementation(() => ({ resolved: false, code: 'MAPPING_REJECTED' }));
    try {
      expect(holdCodes()).toEqual(['MAPPING_REJECTED']);
      const row = computeReadiness(world(), TEST_CTX).clinics[0]!;
      expect(row.mappings.every((entry) => entry.status === 'NOT_READY' && entry.code === 'MAPPING_REJECTED')).toBe(true);
    } finally {
      spied.resolveMapping.mockImplementation(actual.resolveMapping);
    }
  });

  it('decideLine → 보류(MAPPING_UNREVIEWED): estimate() 의 모든 줄과 표 M 의 모든 행이 MAPPING_UNREVIEWED', async () => {
    const actual = await vi.importActual<typeof import('../../src/engine/resolve')>('../../src/engine/resolve');
    spied.decideLine.mockImplementation((args) => ({ line: args.line, state: 'ON_HOLD', holdReason: 'MAPPING_UNREVIEWED' }));
    try {
      expect(holdCodes()).toEqual(['MAPPING_UNREVIEWED']);
      const row = computeReadiness(world(), TEST_CTX).clinics[0]!;
      expect(row.mappings.every((entry) => entry.status === 'NOT_READY' && entry.code === 'MAPPING_UNREVIEWED')).toBe(true);
      expect(row.calculationReady.every((entry) => entry.status === 'NOT_READY' && entry.stage === 'M')).toBe(true);
    } finally {
      spied.decideLine.mockImplementation(actual.decideLine);
    }
  });

  it('selectDocumentRuleSet → 없음: 표 D 와 documentReady 만 바뀌고 calculationReady 는 그대로 (estimate() 는 이 함수를 쓰지 않는다)', async () => {
    const actual = await vi.importActual<typeof import('../../src/engine/documents')>('../../src/engine/documents');
    spied.selectDocumentRuleSet.mockImplementation(() => null);
    try {
      expect(holdCodes()).toEqual([]);
      const row = computeReadiness(world(), TEST_CTX).clinics[0]!;
      expect(row.documents.status).toBe('NOT_READY');
      expect(row.documentReady).toMatchObject({ status: 'NOT_READY', stage: 'D', code: 'RULES_UNAVAILABLE' });
      expect(row.calculationReady.every((entry) => entry.status === 'READY')).toBe(true);
    } finally {
      spied.selectDocumentRuleSet.mockImplementation(actual.selectDocumentRuleSet);
    }
  });
});

// ───────────────────────── 같은 이름의 정의가 src/server 에 없다 (정의 형태를 넓힌 검사) ─────────────────────────

const SERVER_DIR = fileURLToPath(new URL('../../src/server', import.meta.url));

function read(dir: string): Array<{ file: string; text: string }> {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return read(path);
    return entry.name.endsWith('.ts') ? [{ file: path.slice(SERVER_DIR.length + 1), text: readFileSync(path, 'utf8') }] : [];
  });
}
const files = read(SERVER_DIR);
const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** 이름이 name 인 함수를 정의하는 모든 형태: 함수 선언, const/let/var, 클래스, 화살표·함수 값을 가진 속성, 메서드 약식, 별칭 가져오기·내보내기. */
function definitionForms(name: string): RegExp[] {
  return [
    new RegExp(`\\bfunction\\s*\\*?\\s*${name}\\b`),
    new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`),
    new RegExp(`\\bclass\\s+${name}\\b`),
    // 속성에 함수 값을 대입하는 형태. 삼항식의 가지(`? name : () => x`)와, 주입된 fns.<name> 에 그대로 위임하는 어댑터(엔진 함수의 의존 인자 이름)는 정의가 아니다.
    new RegExp(`(?<!\\?\\s*)\\b${name}\\s*[:=]\\s*(?:async\\s+)?(?:function\\b|\\([^)]*\\)\\s*(?::[^=]+)?=>|\\w+\\s*=>)(?![^\\n]*\\bfns\\.${name}\\b)`),
    new RegExp(`^\\s*(?:public\\s+|private\\s+|static\\s+|async\\s+)*${name}\\s*\\([^)]*\\)\\s*(?::[^{;]+)?\\{`, 'm'),
    new RegExp(`\\bas\\s+${name}\\b`),
  ];
}

const GUARDED_NAMES = [...NAMES, 'bundleHoldCode', 'profileHasGroup', 'documentRuleSetToRuleItem', 'compareCodePoints', 'mappingHoldCode', 'profileHoldCode', 'deriveDocuments', 'estimateFront', 'estimate'];

describe('AC-011l (6) src/server 에 엔진 판정 함수와 같은 이름의 정의가 없다 (정의 형태를 넓힌 검사)', () => {
  it('검사 정규식이 실제로 각 정의 형태를 잡는다 (빈 시험 방지)', () => {
    const samples = [
      'function isUsable(a) {}',
      'export const isUsable = (a) => a;',
      'const isUsable = function () {}',
      'class isUsable {}',
      'const o = { isUsable: (x) => x };',
      'const o = { isUsable: x => x };',
      'const o = { isUsable: function () {} };',
      'class K {\n  isUsable(x) {\n  }\n}',
      "import { other as isUsable } from './x';",
      'export { other as isUsable };',
    ];
    for (const sample of samples) {
      expect(definitionForms('isUsable').some((form) => form.test(sample)), sample).toBe(true);
    }
    for (const sample of [
      'isBundleUsable: typeof isBundleUsable;',
      'isUsable,',
      'fns.isUsable(item, ctx)',
      'const verdict = fns.isUsable(item);',
      'isUsable: (item, ctx) => fns.isUsable(item, ctx),',
      'lookup: ready ? isUsable : () => true,',
    ]) {
      expect(definitionForms('isUsable').some((form) => form.test(sample)), sample).toBe(false);
    }
  });

  it.each(GUARDED_NAMES)('%s 를 src/server 의 어떤 파일도 정의·별칭하지 않는다 (digest.ts 의 canonicalDigest 는 이 목록에 없다)', (name) => {
    const offenders = files.filter(({ text }) => definitionForms(name).some((form) => form.test(strip(text)))).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('readiness.ts 는 기본 함수 묶음을 엔진 export 로만 채운다: 엔진 가져오기 문장 밖에서 같은 이름을 값으로 대입하지 않는다', () => {
    const text = strip(files.find(({ file }) => file === 'readiness.ts')!.text);
    const realBlock = /const REAL_FUNCTIONS: ReadinessFunctions = \{([\s\S]*?)\};/.exec(text);
    expect(realBlock).not.toBeNull();
    const entries = realBlock![1]!.split(',').map((entry) => entry.trim()).filter((entry) => entry !== '');
    // 모든 항목이 "이름," 약식(= 가져온 같은 이름의 바인딩)이다. 값을 따로 적은 항목(이름: 값)이 없다.
    expect(entries.sort()).toEqual([...NAMES].sort());
    expect(entries.every((entry) => /^\w+$/.test(entry))).toBe(true);
  });
});
