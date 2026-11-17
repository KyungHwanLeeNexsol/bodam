import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { selectDocumentRuleSet } from '../../src/engine/documents';
import { checkGroupValues } from '../../src/engine/group-values';
import { checkProfileStructure } from '../../src/engine/profile-structure';
import { decideLine, resolveMapping, resolveProfile } from '../../src/engine/resolve';
import { isBundleUsable, isUsable } from '../../src/engine/usability';
import { computeReadiness } from '../../src/server/readiness';
import type { ReadinessFunctions } from '../../src/server/readiness';
import { ALL_CELLS, B_FEE, TEST_CTX, bundleOf, clinicOf, rowOfCell, snapshotOf } from '../fixtures/server/readiness.fixture';

// AC-011l (6) 두 번째 구현 없음. 준비 상태 계산은 estimate() 가 쓰는 엔진 함수를 가져와 그대로 부른다.
//   (a) 가져오기 검사: 필요한 엔진 함수를 엔진 모듈에서 가져오고 src/server 어디에도 같은 이름의 함수를 정의하지 않는다.
//   (b) 비교 금지 검사: 준비 상태 쪽에서 상태·출처·유효 기간·약관 출처·승인자·해시를 따로 비교하지 않는다 (DD-23 규칙 0).
//   (c) 호출 감시: 바꿔 끼운 함수가 실제로 불리고, 부르는 인자(허용 출처·해시 함수·줄 허용 출처)가 구성 그대로이며,
//       함수를 바꾸면 해당 표의 결과가 따라 바뀐다 (그 함수 밖에 숨은 두 번째 판정 경로가 없다).

const SERVER_DIR = fileURLToPath(new URL('../../src/server', import.meta.url));

function read(dir: string): Array<{ file: string; text: string }> {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return read(path);
    return entry.name.endsWith('.ts') ? [{ file: path.slice(SERVER_DIR.length + 1), text: readFileSync(path, 'utf8') }] : [];
  });
}

const files = read(SERVER_DIR);
const readiness = files.find(({ file }) => file === 'readiness.ts');
const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** 준비 상태 계산이 엔진에서 가져와 쓰는 함수와 가져오는 엔진 모듈. */
const REUSED: Array<[name: string, engineModule: string]> = [
  ['isBundleUsable', 'usability'],
  ['isUsable', 'usability'],
  ['bundleHoldCode', 'usability'],
  ['documentRuleSetToRuleItem', 'usability'],
  ['resolveProfile', 'resolve'],
  ['resolveMapping', 'resolve'],
  ['decideLine', 'resolve'],
  ['profileHasGroup', 'resolve'],
  ['checkGroupValues', 'group-values'],
  ['checkProfileStructure', 'profile-structure'],
  ['selectDocumentRuleSet', 'documents'],
  ['compareCodePoints', 'validate'],
];

/** 이름이 name 인 함수·상수를 정의하는 파일(가져오기 제외). */
function definitions(name: string): string[] {
  const declaration = new RegExp(`(?:function\\s+${name}\\b|(?:const|let|var)\\s+${name}\\b)`);
  return files.filter(({ text }) => declaration.test(strip(text))).map(({ file }) => file);
}

describe('(a) 가져오기 검사', () => {
  it('src/server/readiness.ts 가 있다 (빈 검사 방지)', () => {
    expect(readiness).toBeDefined();
    expect(files.length).toBeGreaterThan(25);
  });

  it.each(REUSED)('%s 는 엔진 %s 모듈에서 가져오고 주석 밖에서 실제로 쓴다', (name, engineModule) => {
    const text = readiness!.text;
    expect(text, `${name} 가져오기`).toMatch(new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*'\\.\\./engine/${engineModule}'`));
    // 가져오기 한 번 + 사용 한 번 이상.
    expect(strip(text).split(new RegExp(`\\b${name}\\b`)).length - 1, `${name} 의 주석 밖 등장 횟수`).toBeGreaterThanOrEqual(2);
  });

  it.each([...REUSED.map(([name]) => name), 'mappingHoldCode', 'profileHoldCode', 'estimate', 'estimateFront', 'deriveDocuments', 'canonicalDigest'])('%s 를 src/server 에서 (정의 파일 제외) 다시 정의하지 않는다', (name) => {
    const defined = definitions(name);
    expect(defined.filter((file) => file !== 'digest.ts')).toEqual([]);
  });

  it('해시는 digest.ts 의 canonicalDigest 하나다: readiness.ts 가 node:crypto 를 가져오지 않는다', () => {
    expect(readiness!.text).not.toMatch(/node:crypto|createHash|\bcrypto\b/);
    expect(readiness!.text).toMatch(/import\s*\{[^}]*\bcanonicalDigest\b[^}]*\}\s*from\s*'\.\/digest'/);
  });
});

describe('(b) 준비 상태 쪽에서 상태·출처·유효 기간·해시를 따로 비교하지 않는다', () => {
  const code = strip(readiness?.text ?? '');

  it('생명주기 상태 이름·묶음 가용성 이름과의 비교가 없다', () => {
    expect(code).not.toMatch(/(?:===|!==|==|!=)\s*['"`](?:DRAFT|REVIEW_REQUESTED|APPROVED|PUBLISHED|REJECTED|UNDER_REREVIEW|SUPERSEDED|EXPIRED|SUSPENDED|ACTIVE)['"`]/);
    expect(code).not.toMatch(/\.status\s*(?:===|!==|==|!=)\s*['"`](?:ACTIVE|SUSPENDED)['"`]/);
  });

  it('항목 머리 정보(출처·유효 기간·약관 출처·승인자·고정 지문)를 읽지 않는다', () => {
    expect(code).not.toMatch(/\.(?:origin|validity|policySources|approver|approvedFingerprint)\b/);
  });

  it('해시 함수를 직접 부르지 않는다 (ctx.digest 는 엔진에 넘기기만 한다)', () => {
    expect(code).not.toMatch(/\.digest\s*\(/);
    expect(code).not.toMatch(/canonicalDigest\s*\(/);
  });

  it('날짜를 직접 비교하거나 만들지 않는다', () => {
    expect(code).not.toMatch(/\bDate\b|Date\.now|new Date/);
  });
});

// ───────────────────────── (c) 호출 감시 ─────────────────────────

const REAL: ReadinessFunctions = { isBundleUsable, isUsable, resolveProfile, checkProfileStructure, resolveMapping, decideLine, checkGroupValues, selectDocumentRuleSet };

type Calls = Record<keyof ReadinessFunctions, unknown[][]>;

function spiesOver(overrides: Partial<ReadinessFunctions> = {}): { functions: ReadinessFunctions; calls: Calls } {
  const calls = Object.fromEntries(Object.keys(REAL).map((name) => [name, []])) as unknown as Calls;
  const functions = Object.fromEntries(
    (Object.keys(REAL) as Array<keyof ReadinessFunctions>).map((name) => {
      const target = (overrides[name] ?? REAL[name]) as (...args: unknown[]) => unknown;
      return [
        name,
        (...args: unknown[]) => {
          calls[name].push(args);
          return target(...args);
        },
      ];
    }),
  ) as unknown as ReadinessFunctions;
  return { functions, calls };
}

const world = () => snapshotOf([clinicOf(bundleOf())]);

describe('(c) 호출 감시', () => {
  it('엔진 함수 여덟이 모두 불리고, 감시용으로 감싸도 결과가 같다', () => {
    const { functions, calls } = spiesOver();
    const watched = computeReadiness(world(), TEST_CTX, functions);
    expect(watched).toEqual(computeReadiness(world(), TEST_CTX));
    for (const name of Object.keys(REAL) as Array<keyof ReadinessFunctions>) {
      expect(calls[name].length, `${name} 호출 수`).toBeGreaterThan(0);
    }
  });

  it('부르는 인자가 구성 그대로다: 규칙 허용 출처·해시 함수·기준일(항목 판정), 줄 허용 출처(줄 판정)', () => {
    const { functions, calls } = spiesOver();
    computeReadiness(world(), TEST_CTX, functions);
    for (const [, , ctx] of calls.resolveProfile as Array<[unknown, unknown, { at: string; acceptedOrigins: unknown; digest: unknown }]>) {
      expect(ctx.at).toBe(TEST_CTX.at);
      expect(ctx.acceptedOrigins).toBe(TEST_CTX.acceptedOrigins.rules);
      expect(ctx.digest).toBe(TEST_CTX.digest);
    }
    for (const [args] of calls.decideLine as Array<[{ acceptedLineOrigins: unknown; ctx: { digest: unknown } }]>) {
      expect(args.acceptedLineOrigins).toBe(TEST_CTX.acceptedOrigins.lines);
      expect(args.ctx.digest).toBe(TEST_CTX.digest);
    }
    for (const [, ctx] of calls.selectDocumentRuleSet as Array<[unknown, { acceptedOrigins: unknown; digest: unknown }]>) {
      expect(ctx.acceptedOrigins).toBe(TEST_CTX.acceptedOrigins.rules);
      expect(ctx.digest).toBe(TEST_CTX.digest);
    }
  });

  it('묶음이 없는 병원은 항목 판정을 거치지 않고 묶음 단계에서 끝난다 (표 S, 표 D)', () => {
    const { functions, calls } = spiesOver();
    computeReadiness(snapshotOf([clinicOf(null)]), TEST_CTX, functions);
    expect(calls.isBundleUsable.length).toBeGreaterThan(0);
    expect(calls.isBundleUsable.every(([bundle]) => bundle === null)).toBe(true);
    expect(calls.isUsable).toEqual([]);
    expect(calls.selectDocumentRuleSet.every(([bundle]) => bundle === null)).toBe(true);
  });

  it('표 P 는 isUsable 을 바꾸면 따라 바뀐다: 모든 항목을 사용 불가로 보면 15칸이 모두 NOT_READY(프로필 단계)', () => {
    const { functions } = spiesOver({ isUsable: () => ({ usable: false, reason: 'STATE_DRAFT' }) });
    const clinic = computeReadiness(world(), TEST_CTX, functions).clinics[0]!;
    expect(clinic.profiles.every((row) => row.status === 'NOT_READY' && row.code === 'PROFILE_DRAFT')).toBe(true);
    expect(clinic.calculationReady.every((row) => row.status === 'NOT_READY' && row.stage === 'P')).toBe(true);
  });

  it('표 P 는 checkProfileStructure 를 바꾸면 따라 바뀐다', () => {
    const { functions } = spiesOver({ checkProfileStructure: () => ({ ok: false, defects: [{ code: 'EMPTY_PROFILE', path: 'groups' }] }) });
    const clinic = computeReadiness(world(), TEST_CTX, functions).clinics[0]!;
    expect(clinic.profiles.every((row) => row.status === 'NOT_READY' && row.code === 'PROFILE_INVALID')).toBe(true);
  });

  it('표 M 은 decideLine 을 바꾸면 따라 바뀐다: 모든 줄을 보류로 정하면 모든 행이 그 코드', () => {
    const { functions } = spiesOver({ decideLine: (args) => ({ line: args.line, state: 'ON_HOLD', holdReason: 'MAPPING_REJECTED' }) });
    const clinic = computeReadiness(world(), TEST_CTX, functions).clinics[0]!;
    expect(clinic.mappings.every((row) => row.status === 'NOT_READY' && row.code === 'MAPPING_REJECTED')).toBe(true);
  });

  it('표 M 은 checkGroupValues 를 바꾸면 따라 바뀐다 (사용 가능한 COVERED 줄만)', () => {
    const { functions } = spiesOver({ checkGroupValues: () => 'PROFILE_VALUE_INVALID' });
    const clinic = computeReadiness(world(), TEST_CTX, functions).clinics[0]!;
    expect(clinic.mappings.every((row) => row.status === 'NOT_READY' && row.code === 'PROFILE_VALUE_INVALID')).toBe(true);
    expect(rowOfCell(clinic.calculationReady, ALL_CELLS[0]!)).toMatchObject({ stage: 'M' });
  });

  it('표 M 은 resolveMapping 을 바꾸면 따라 바뀐다 (decideLine 안에서 같은 함수를 부른다)', () => {
    const { functions, calls } = spiesOver({ resolveMapping: () => ({ resolved: false, code: 'MAPPING_UNREVIEWED' }) });
    const clinic = computeReadiness(world(), TEST_CTX, functions).clinics[0]!;
    expect(calls.resolveMapping.length).toBeGreaterThan(0);
    expect(clinic.mappings.every((row) => row.status === 'NOT_READY' && row.code === 'MAPPING_UNREVIEWED')).toBe(true);
    expect(clinic.mappings.some((row) => row.treatmentId === B_FEE)).toBe(true);
  });

  it('표 D 는 selectDocumentRuleSet 을 바꾸면 따라 바뀐다', () => {
    const { functions } = spiesOver({ selectDocumentRuleSet: () => null });
    const clinic = computeReadiness(world(), TEST_CTX, functions).clinics[0]!;
    expect(clinic.documents.status).toBe('NOT_READY');
    expect(clinic.documentReady.status).toBe('NOT_READY');
    // 계산 쪽은 영향이 없다.
    expect(clinic.calculationReady.every((row) => row.status === 'READY')).toBe(true);
  });

  it('표 S 는 isBundleUsable 을 바꾸면 따라 바뀐다', () => {
    const { functions } = spiesOver({ isBundleUsable: () => ({ usable: false, reason: 'BUNDLE_SUSPENDED' }) });
    const clinic = computeReadiness(world(), TEST_CTX, functions).clinics[0]!;
    expect(clinic.scope).toMatchObject({ status: 'NOT_READY', value: 'BUNDLE_SUSPENDED', code: 'RULE_BUNDLE_SUSPENDED' });
    expect(clinic.calculationReady.every((row) => row.status === 'NOT_READY' && row.stage === 'S')).toBe(true);
    expect(rowOfCell(clinic.profiles, ALL_CELLS[0]!)).toMatchObject({ status: 'NOT_READY', code: 'RULE_BUNDLE_SUSPENDED' });
  });
});
