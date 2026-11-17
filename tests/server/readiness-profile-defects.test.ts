import { describe, expect, it } from 'vitest';
import type { CoverageGroupDef, HoldReasonCode, StandardAssumptionProfile } from '../../src/engine/types';
import { computeReadiness } from '../../src/server/readiness';
import { testGroups, withValidHash } from '../fixtures/engine/profiles.fixture';
import {
  ALL_CELLS,
  OPERATING_ONLY_CTX,
  TEST_CTX,
  bundleOf,
  cellName,
  clinicOf,
  estimateFor,
  operatingBundleOf,
  operatingClinicOf,
  operatingProfiles,
  profileOf,
  rowOfCell,
  sameCell,
  snapshotOf,
} from '../fixtures/server/readiness.fixture';

// AC-011c 보강 (M3.E 보강 세션): 기존 readiness-profiles.test.ts 가 다루지 않은 줄.
//   (1) 출처 TEST_FIXTURE 를 운영 허용 출처에서 한 칸씩 어긋나게 한 경우 (나머지 14칸은 모두 사용 가능한 OPERATING 자료)
//   (2) AC-008a 구조 결함 행 전부 (각각 따로): 기존 시험에는 5가지만 있었다.
// 기대 보류 코드는 손으로 적지 않는다. 같은 입력으로 estimate() 가 그 칸의 모든 줄에 내는 코드를 기대값으로 쓴다.

const [GA, GB] = testGroups() as [CoverageGroupDef, CoverageGroupDef];
const KEY_A = GA.groupKey;
const KEY_B = GB.groupKey;

/** 한 칸만 어긋난 병원 하나에 대해: 그 칸만 NOT_READY(두 보기 모두)이고 코드가 estimate() 와 같으며 다른 14칸은 READY 다. */
function expectOnlyTargetBlocked(target: (typeof ALL_CELLS)[number], clinic: ReturnType<typeof clinicOf>, ctx: typeof TEST_CTX, label: string): HoldReasonCode {
  const report = computeReadiness(snapshotOf([clinic]), ctx);
  let observed: HoldReasonCode | null = null;
  for (const cell of ALL_CELLS) {
    const where = `${label} · 대상 ${cellName(target)} · 칸 ${cellName(cell)}`;
    const est = estimateFor(clinic, cell, ctx)!;
    const clinicRow = rowOfCell(report.clinics[0]!.profiles, cell);
    const platformRow = rowOfCell(report.platformProfiles, cell);
    if (!sameCell(cell, target)) {
      expect(est.state, where).not.toBe('ON_HOLD');
      expect(clinicRow.status, where).toBe('READY');
      expect(platformRow.status, where).toBe('READY');
      continue;
    }
    expect(est.state, where).toBe('ON_HOLD');
    const codes = new Set(est.holdReasons.map((hold) => hold.code));
    expect(est.holdReasons, where).toHaveLength(4);
    expect(codes.size, where).toBe(1);
    const [code] = [...codes] as HoldReasonCode[];
    expect(clinicRow, where).toEqual({ cell, status: 'NOT_READY', code });
    expect(platformRow, where).toEqual({ cell, status: 'NOT_READY', code });
    expect(rowOfCell(report.clinics[0]!.calculationReady, cell), where).toEqual({ cell, status: 'NOT_READY', stage: 'P', code });
    observed = code as HoldReasonCode;
  }
  return observed as HoldReasonCode;
}

describe('AC-011c 출처 TEST_FIXTURE 를 운영 허용 출처(OPERATING 만)에서 한 칸씩 어긋나게 한다', () => {
  it('기준 세계: 모든 자료가 OPERATING 이면 운영 허용 출처에서 15칸 모두 READY 이고 estimate() 도 보류가 없다', () => {
    const clinic = operatingClinicOf(operatingBundleOf());
    const report = computeReadiness(snapshotOf([clinic]), OPERATING_ONLY_CTX);
    expect(report.clinics[0]!.profiles.every((row) => row.status === 'READY')).toBe(true);
    expect(report.platformProfiles.every((row) => row.status === 'READY')).toBe(true);
    expect(report.clinics[0]!.calculationReady.every((row) => row.status === 'READY')).toBe(true);
    for (const cell of ALL_CELLS) {
      expect(estimateFor(clinic, cell, OPERATING_ONLY_CTX)!.state, cellName(cell)).not.toBe('ON_HOLD');
    }
  });

  it.each(ALL_CELLS.map((cell) => [cellName(cell), cell] as const))('칸 %s 의 프로필만 TEST_FIXTURE: 그 칸만 PROFILE_DEMO, 나머지 14칸은 READY', (_name, target) => {
    const clinic = operatingClinicOf(operatingBundleOf({ profiles: operatingProfiles(target, (base) => ({ ...base, origin: 'TEST_FIXTURE' })) }));
    expect(expectOnlyTargetBlocked(target, clinic, OPERATING_ONLY_CTX, 'TEST_FIXTURE 출처')).toBe('PROFILE_DEMO');
  });

  it('같은 자료를 시험 허용 출처(TEST_FIXTURE 허용)로 보면 15칸 모두 READY 다 (거절 이유가 출처뿐이라는 증거)', () => {
    const target = ALL_CELLS[4]!;
    const clinic = operatingClinicOf(operatingBundleOf({ profiles: operatingProfiles(target, (base) => ({ ...base, origin: 'TEST_FIXTURE' })) }));
    const accepted = computeReadiness(snapshotOf([clinic]), TEST_CTX);
    expect(accepted.clinics[0]!.profiles.every((row) => row.status === 'READY')).toBe(true);
  });
});

// ───────────────────────── AC-008a 구조 결함 행 전부 ─────────────────────────

/** 잘못된 모양까지 해시를 그 내용에 맞춘다 (무결성 검사를 통과해 구조 검사까지 닿게). */
const malformedFor = (cell: (typeof ALL_CELLS)[number], overrides: Record<string, unknown>): StandardAssumptionProfile =>
  withValidHash({ ...profileOf(cell), ...overrides } as StandardAssumptionProfile);

const VALID_POOL = { poolKey: 'TEST_POOL_1', limit: { kind: 'PER_VISIT_PAYOUT', amount: 50_000, limitBasis: 'PAYOUT' } } as const;
const POOLED_A: CoverageGroupDef = { ...GA, sharedLimitPoolKey: VALID_POOL.poolKey };

/** AC-008a 의 값 모양들: 객체가 아닌 항목(null·undefined·숫자·문자열·불리언·배열)과 배열이 아닌 컨테이너. */
const ENTRY_SHAPES: Array<[string, unknown]> = [
  ['null', null],
  ['undefined', undefined],
  ['숫자 7', 7],
  ['문자열 "x"', 'x'],
  ['불리언 true', true],
  ['빈 배열', []],
  ['배열 [1]', [1]],
];
const POOLS_CONTAINER_SHAPES: Array<[string, unknown]> = [
  ['null', null],
  ['undefined', undefined],
  ['객체 {}', {}],
  ['유사 배열 {length:0}', { length: 0 }],
  ['문자열 "abc"', 'abc'],
  ['숫자 7', 7],
  ['불리언 true', true],
];

/** [이름, 대상 칸의 프로필을 만드는 함수]. 프로필은 그 밖의 검사를 모두 통과한 상태에서 구조 결함 하나만 가진다. */
const STRUCTURAL_DEFECTS: Array<[string, (cell: (typeof ALL_CELLS)[number]) => StandardAssumptionProfile]> = [
  ['빈 groupKey', (cell) => malformedFor(cell, { groups: [{ ...GA, groupKey: '' }, GB], groupOrder: ['', KEY_B] })],
  ['중복 groupKey', (cell) => malformedFor(cell, { groups: [GA, GA], groupOrder: [KEY_A] })],
  ['빈 poolKey', (cell) => malformedFor(cell, { groups: [{ ...GA, sharedLimitPoolKey: '' }, GB], sharedLimitPools: [{ ...VALID_POOL, poolKey: '' }] })],
  ['중복 poolKey', (cell) => malformedFor(cell, { groups: [POOLED_A, GB], sharedLimitPools: [VALID_POOL, VALID_POOL] })],
  ['없는 풀을 가리키는 sharedLimitPoolKey', (cell) => malformedFor(cell, { groups: [{ ...GA, sharedLimitPoolKey: 'TEST_POOL_NONE' }, GB] })],
  ['groupOrder 에서 빠진 키', (cell) => malformedFor(cell, { groupOrder: [KEY_A] })],
  ['groupOrder 의 중복 키', (cell) => malformedFor(cell, { groupOrder: [KEY_A, KEY_A, KEY_B] })],
  ['groupOrder 의 없는 키', (cell) => malformedFor(cell, { groupOrder: [KEY_A, KEY_B, 'TEST_GROUP_NONE'] })],
  ['그룹이 하나도 없는 빈 프로필', (cell) => malformedFor(cell, { groups: [], groupOrder: [] })],
  ...ENTRY_SHAPES.map(([name, entry]): [string, (cell: (typeof ALL_CELLS)[number]) => StandardAssumptionProfile] => [
    `객체가 아닌 groups 항목 ${name}`,
    (cell) => malformedFor(cell, { groups: [GA, entry, GB], groupOrder: [KEY_A, KEY_B] }),
  ]),
  ...ENTRY_SHAPES.map(([name, entry]): [string, (cell: (typeof ALL_CELLS)[number]) => StandardAssumptionProfile] => [
    `객체가 아닌 sharedLimitPools 항목 ${name}`,
    (cell) => malformedFor(cell, { groups: [POOLED_A, GB], sharedLimitPools: [VALID_POOL, entry] }),
  ]),
  ...POOLS_CONTAINER_SHAPES.map(([name, container]): [string, (cell: (typeof ALL_CELLS)[number]) => StandardAssumptionProfile] => [
    `배열이 아닌 sharedLimitPools ${name}`,
    (cell) => malformedFor(cell, { sharedLimitPools: container }),
  ]),
];

describe('AC-011c AC-008a 의 구조 결함 행 전부를 한 칸씩 따로 어긋나게 한다', () => {
  it('구조 결함 변형 수 확인 (빈 시험 방지): 9 + 7 + 7 + 7', () => {
    expect(STRUCTURAL_DEFECTS).toHaveLength(9 + ENTRY_SHAPES.length * 2 + POOLS_CONTAINER_SHAPES.length);
  });

  it.each(STRUCTURAL_DEFECTS)('%s: 15칸 각각에서 그 칸만 PROFILE_INVALID 이고 estimate() 와 같다', (_name, make) => {
    for (const target of ALL_CELLS) {
      const clinic = clinicOf(bundleOf({ profiles: ALL_CELLS.map((cell) => (sameCell(cell, target) ? make(cell) : profileOf(cell))) }));
      expect(() => computeReadiness(snapshotOf([clinic]), TEST_CTX)).not.toThrow();
      expect(expectOnlyTargetBlocked(target, clinic, TEST_CTX, _name)).toBe('PROFILE_INVALID');
    }
  });

  it('빈 배열 sharedLimitPools 는 구조 결함이 아니다 (대조군): 15칸 모두 READY', () => {
    const clinic = clinicOf(bundleOf({ profiles: ALL_CELLS.map((cell) => malformedFor(cell, { sharedLimitPools: [] })) }));
    expect(computeReadiness(snapshotOf([clinic]), TEST_CTX).clinics[0]!.profiles.every((row) => row.status === 'READY')).toBe(true);
  });

  it('구조 결함 후보는 플랫폼 보기의 우선순위에서 PROFILE_INVALID 로 취급된다 (중지 후보보다 앞선다)', () => {
    const target = ALL_CELLS[7]!;
    const broken = bundleOf({ id: 'TEST_BUNDLE_BROKEN', profiles: [malformedFor(target, { groups: [GA, null, GB], groupOrder: [KEY_A, KEY_B] })] });
    const suspended = bundleOf({ id: 'TEST_BUNDLE_SUSP', status: 'SUSPENDED', profiles: [profileOf(target)] });
    for (const order of [[broken, suspended], [suspended, broken]]) {
      const row = rowOfCell(computeReadiness(snapshotOf([clinicOf(null)], order), TEST_CTX).platformProfiles, target);
      expect(row).toEqual({ cell: target, status: 'NOT_READY', code: 'PROFILE_INVALID' });
    }
  });
});
