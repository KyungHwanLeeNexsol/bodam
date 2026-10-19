import { beforeAll, describe, expect, it } from 'vitest';
import type { HoldReasonCode, LifecycleState, PolicySourceRef, RuleBundleSnapshot, StandardAssumptionProfile } from '../../src/engine/types';
import { READINESS_CELLS, computeReadiness } from '../../src/server/readiness';
import { testGroups, testPolicySource } from '../fixtures/engine/profiles.fixture';
import {
  ALL_CELLS,
  OPERATING_ONLY_CTX,
  TEST_CTX,
  allProfiles,
  bundleOf,
  cellName,
  clinicOf,
  estimateFor,
  profileOf,
  rowOfCell,
  sameCell,
  seededRandom,
  shuffled,
  snapshotOf,
} from '../fixtures/server/readiness.fixture';

// AC-011c 표 P (프로필 칸, design.md DD-23): 플랫폼 보기와 병원 보기.
// 기대 보류 코드는 손으로 적지 않는다. 같은 입력으로 estimate() 를 불러 그 칸의 모든 줄이 받는 코드를 기대값으로 쓴다.
// 예외는 DD-23 이 SPEC 결정으로 못박은 "플랫폼 보기 후보 우선순위"뿐이며 그 목록은 이 파일에 그대로 적는다.

const clinicRows = (bundle: RuleBundleSnapshot | null, ctx = TEST_CTX) => {
  const report = computeReadiness(snapshotOf([clinicOf(bundle)]), ctx);
  return { platform: report.platformProfiles, clinic: report.clinics[0]!.profiles };
};

describe('AC-011c 15칸', () => {
  it('READINESS_CELLS 는 세대 5종 × 보험사 형태 3종 15개이고 세대가 바깥, 형태가 안쪽 순서다', () => {
    expect(READINESS_CELLS).toHaveLength(15);
    expect(READINESS_CELLS).toEqual(ALL_CELLS);
  });

  it('두 보기 모두 15행을 칸 순서대로 낸다', () => {
    const { platform, clinic } = clinicRows(bundleOf());
    expect(platform.map((row) => row.cell)).toEqual(ALL_CELLS);
    expect(clinic.map((row) => row.cell)).toEqual(ALL_CELLS);
  });
});

describe('AC-011c 운영 데이터가 없는 저장소', () => {
  it('플랫폼 보기: 묶음이 하나도 없으면 15칸 모두 NOT_READY, 사유 PROFILE_ABSENT', () => {
    const report = computeReadiness({ bundles: [], clinics: [] }, TEST_CTX);
    expect(report.platformProfiles).toEqual(ALL_CELLS.map((cell) => ({ cell, status: 'NOT_READY', code: 'PROFILE_ABSENT' })));
  });

  it('병원 보기: 규칙 사용 범위가 없으면 15칸 모두 NOT_READY, 사유 CLINIC_RULE_SCOPE_ABSENT', () => {
    const report = computeReadiness(snapshotOf([clinicOf(null)]), TEST_CTX);
    expect(report.platformProfiles.every((row) => row.status === 'NOT_READY' && row.code === 'PROFILE_ABSENT')).toBe(true);
    expect(report.clinics[0]!.profiles).toEqual(ALL_CELLS.map((cell) => ({ cell, status: 'NOT_READY', code: 'CLINIC_RULE_SCOPE_ABSENT' })));
  });

  it('병원 보기: 범위는 있으나 묶음에 프로필이 없으면 15칸 모두 PROFILE_ABSENT (플랫폼 보기도 후보가 없어 PROFILE_ABSENT)', () => {
    const { platform, clinic } = clinicRows(bundleOf({ profiles: [] }));
    expect(clinic).toEqual(ALL_CELLS.map((cell) => ({ cell, status: 'NOT_READY', code: 'PROFILE_ABSENT' })));
    expect(platform).toEqual(ALL_CELLS.map((cell) => ({ cell, status: 'NOT_READY', code: 'PROFILE_ABSENT' })));
  });

  it('프로필 목록이 배열이 아닌 묶음도 던지지 않고 PROFILE_ABSENT 로 본다 (resolveProfile 과 같다)', () => {
    const broken = { ...bundleOf(), profiles: null } as unknown as RuleBundleSnapshot;
    const { clinic, platform } = clinicRows(broken);
    expect(clinic.every((row) => row.status === 'NOT_READY' && row.code === 'PROFILE_ABSENT')).toBe(true);
    expect(platform.every((row) => row.status === 'NOT_READY' && row.code === 'PROFILE_ABSENT')).toBe(true);
  });
});

describe('AC-011c 모두 갖춘 칸만 READY 이고 다른 칸으로 번지지 않는다', () => {
  it('15칸이 모두 사용 가능하면 두 보기 모두 15칸 READY (묶음 id와 프로필 id·버전을 함께 낸다)', () => {
    const bundle = bundleOf();
    const { platform, clinic } = clinicRows(bundle);
    expect(platform).toEqual(ALL_CELLS.map((cell) => ({ cell, status: 'READY', bundleIds: [bundle.id] })));
    expect(clinic).toEqual(ALL_CELLS.map((cell) => ({ cell, status: 'READY', bundleId: bundle.id, profileId: `TEST_PROFILE_${cell.generation}_${cell.insurerType}`, profileVersion: 'v1' })));
  });

  it('운영 허용 출처 구성에서는 TEST_FIXTURE 자료가 15칸 모두 사용 불가이고 사유가 estimate() 와 같다', () => {
    const bundle = bundleOf();
    const clinic = clinicOf(bundle);
    const report = computeReadiness(snapshotOf([clinic]), OPERATING_ONLY_CTX);
    for (const cell of ALL_CELLS) {
      const est = estimateFor(clinic, cell, OPERATING_ONLY_CTX)!;
      expect(est.state, cellName(cell)).toBe('ON_HOLD');
      const codes = new Set(est.holdReasons.map((hold) => hold.code));
      expect(codes.size, cellName(cell)).toBe(1);
      const [code] = [...codes] as HoldReasonCode[];
      expect(rowOfCell(report.clinics[0]!.profiles, cell)).toEqual({ cell, status: 'NOT_READY', code });
      expect(rowOfCell(report.platformProfiles, cell)).toEqual({ cell, status: 'NOT_READY', code });
      expect(code, cellName(cell)).not.toBe('PROFILE_ABSENT');
    }
    // 같은 자료를 시험 허용 출처로 보면 15칸 모두 READY 다 (거절 이유가 출처뿐이라는 증거).
    const accepted = computeReadiness(snapshotOf([clinic]), TEST_CTX);
    expect(accepted.clinics[0]!.profiles.every((row) => row.status === 'READY')).toBe(true);
  });
});

type Change = (base: StandardAssumptionProfile, cell: (typeof ALL_CELLS)[number]) => StandardAssumptionProfile | StandardAssumptionProfile[];

const NON_PUBLISHED: LifecycleState[] = ['DRAFT', 'REVIEW_REQUESTED', 'REJECTED', 'APPROVED', 'UNDER_REREVIEW', 'SUPERSEDED', 'EXPIRED', 'SUSPENDED'];
const SOURCE_FIELDS = Object.keys(testPolicySource()) as Array<keyof PolicySourceRef>;

const withSources = (base: StandardAssumptionProfile, policySources: PolicySourceRef[]): StandardAssumptionProfile => ({ ...base, policySources });

/** AC-011c 가 든 어긋남. 헤더 변경은 내용 해시를 건드리지 않으므로 해시는 그대로 맞고 그 사유만 걸린다. 구조 변경은 해시를 다시 맞춰 구조 결함만 남긴다. */
const VARIANTS: Array<[string, Change]> = [
  ['출처 DEMO', (p) => ({ ...p, origin: 'DEMO' })],
  ...NON_PUBLISHED.map((state): [string, Change] => [`상태 ${state}`, (p) => ({ ...p, state })]),
  ['유효 기간 밖', (p) => ({ ...p, validity: { from: '2025-01-01', to: '2025-12-31' } })],
  ['유효 기간이 달력에 없는 날짜', (p) => ({ ...p, validity: { from: '2026-02-30', to: '2026-12-31' } })],
  ['약관 출처 없음(빈 목록)', (p) => withSources(p, [])],
  ...SOURCE_FIELDS.map((field): [string, Change] => [`약관 출처 ${field} 누락`, (p) => withSources(p, [{ ...testPolicySource(), [field]: '' }])]),
  ['승인자 없음', (p) => ({ ...p, approver: null })],
  ['승인자 id 가 빈 문자열', (p) => ({ ...p, approver: { approverId: '', approvedAt: '2026-01-02' } })],
  ['내용 해시 불일치', (p) => ({ ...p, contentHash: 'TEST_DIGEST_00000000' })],
  ['내용 해시가 빈 문자열', (p) => ({ ...p, contentHash: '' })],
  ['구조 결함: 빈 프로필', (_p, cell) => profileOf(cell, { groups: [] })],
  ['구조 결함: 중복 groupKey', (_p, cell) => profileOf(cell, { groups: [testGroups()[0]!, testGroups()[0]!] })],
  ['구조 결함: groupOrder 에서 빠진 키', (_p, cell) => profileOf(cell, { groupOrder: ['TEST_GROUP_BENEFIT'] })],
  ['구조 결함: 없는 풀을 가리키는 sharedLimitPoolKey', (_p, cell) => profileOf(cell, { groups: [{ ...testGroups()[0]!, sharedLimitPoolKey: 'TEST_POOL_NONE' }, testGroups()[1]!] })],
  [
    '구조 결함: 중복 poolKey',
    (_p, cell) => {
      const limit = { kind: 'PER_VISIT_PAYOUT', amount: 50_000, limitBasis: 'PAYOUT' } as const;
      return profileOf(cell, { sharedLimitPools: [{ poolKey: 'TEST_POOL_X', limit }, { poolKey: 'TEST_POOL_X', limit }] });
    },
  ],
  ['같은 칸에 프로필 둘', (p) => [p, { ...p, id: `${p.id}_SECOND` }]],
];

describe('AC-011c 칸 하나의 프로필 기록만 어긋나게 하면 그 칸만 NOT_READY 이고 사유는 estimate() 와 같다', () => {
  it.each(VARIANTS)('%s', (_name, change) => {
    for (const target of ALL_CELLS) {
      const bundle = bundleOf({ profiles: allProfiles(target, change) });
      const clinic = clinicOf(bundle);
      const report = computeReadiness(snapshotOf([clinic]), TEST_CTX);
      for (const cell of ALL_CELLS) {
        const where = `대상 ${cellName(target)} · 칸 ${cellName(cell)}`;
        const est = estimateFor(clinic, cell, TEST_CTX)!;
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
        expect(code, where).not.toBe('PROFILE_ABSENT');
        expect(code, where).not.toBe('CLINIC_RULE_SCOPE_ABSENT');
      }
    }
  });
});

describe('AC-011c 묶음이 SUSPENDED 이면 그 묶음에 든 칸은 RULE_BUNDLE_SUSPENDED 다', () => {
  it('병원 보기: 범위가 가리키는 묶음이 중지되면 15칸 모두 RULE_BUNDLE_SUSPENDED 이고 estimate() 와 같다', () => {
    const clinic = clinicOf(bundleOf({ status: 'SUSPENDED' }));
    const report = computeReadiness(snapshotOf([clinic]), TEST_CTX);
    for (const cell of ALL_CELLS) {
      const est = estimateFor(clinic, cell, TEST_CTX)!;
      expect(new Set(est.holdReasons.map((hold) => hold.code))).toEqual(new Set(['RULE_BUNDLE_SUSPENDED']));
      expect(rowOfCell(report.clinics[0]!.profiles, cell)).toEqual({ cell, status: 'NOT_READY', code: 'RULE_BUNDLE_SUSPENDED' });
      expect(rowOfCell(report.platformProfiles, cell)).toEqual({ cell, status: 'NOT_READY', code: 'RULE_BUNDLE_SUSPENDED' });
    }
  });

  it('플랫폼 보기: 같은 칸을 담은 ACTIVE 묶음이 하나라도 있으면 READY 이고 사용 가능한 묶음 id 만 낸다', () => {
    const active = bundleOf({ id: 'TEST_BUNDLE_ACTIVE' });
    const suspended = bundleOf({ id: 'TEST_BUNDLE_SUSPENDED', status: 'SUSPENDED' });
    const report = computeReadiness(snapshotOf([clinicOf(null)], [suspended, active]), TEST_CTX);
    expect(report.platformProfiles).toEqual(ALL_CELLS.map((cell) => ({ cell, status: 'READY', bundleIds: ['TEST_BUNDLE_ACTIVE'] })));
  });

  it('플랫폼 보기: 사용 가능한 후보 묶음이 여럿이면 모두 낸다 (묶음 id 순)', () => {
    const report = computeReadiness(snapshotOf([clinicOf(null)], [bundleOf({ id: 'TEST_BUNDLE_B' }), bundleOf({ id: 'TEST_BUNDLE_A' })]), TEST_CTX);
    expect(rowOfCell(report.platformProfiles, ALL_CELLS[0]!)).toEqual({ cell: ALL_CELLS[0], status: 'READY', bundleIds: ['TEST_BUNDLE_A', 'TEST_BUNDLE_B'] });
  });
});

// ───────────────────────── 플랫폼 보기 후보 우선순위 ─────────────────────────

/** DD-23 표 P 의 고정 우선순위 (SPEC 결정). 앞쪽일수록 사용 가능해질 가능성이 가깝다. */
const PRIORITY: readonly HoldReasonCode[] = [
  'PROFILE_UNDER_REREVIEW',
  'PROFILE_UNAPPROVED',
  'PROFILE_DRAFT',
  'PROFILE_SOURCE_INCOMPLETE',
  'PROFILE_INVALID',
  'PROFILE_DEMO',
  'RULE_BUNDLE_SUSPENDED',
];

const TARGET = ALL_CELLS.find((cell) => cell.generation === 'GEN3_C3' && cell.insurerType === 'LIFE')!;

/** PRIORITY 와 같은 순서의 후보 종류. 각각 TARGET 칸에 프로필을 하나 담고 그 칸에서 위 코드 하나를 낸다. */
const CANDIDATE_KINDS: Array<(id: string) => RuleBundleSnapshot> = [
  (id) => bundleOf({ id, profiles: [profileOf(TARGET, { id: `${id}_P`, state: 'UNDER_REREVIEW' })] }),
  (id) => bundleOf({ id, profiles: [profileOf(TARGET, { id: `${id}_P`, state: 'APPROVED' })] }),
  (id) => bundleOf({ id, profiles: [profileOf(TARGET, { id: `${id}_P`, state: 'DRAFT' })] }),
  (id) => bundleOf({ id, profiles: [{ ...profileOf(TARGET, { id: `${id}_P` }), policySources: [] }] }),
  (id) => bundleOf({ id, profiles: [profileOf(TARGET, { id: `${id}_P`, state: 'SUPERSEDED' })] }),
  (id) => bundleOf({ id, profiles: [profileOf(TARGET, { id: `${id}_P`, origin: 'DEMO' })] }),
  (id) => bundleOf({ id, status: 'SUSPENDED', profiles: [profileOf(TARGET, { id: `${id}_P` })] }),
];

const targetRow = (bundles: RuleBundleSnapshot[]) =>
  rowOfCell(computeReadiness(snapshotOf([clinicOf(null)], bundles), TEST_CTX).platformProfiles, TARGET);

describe('AC-011c 플랫폼 보기: 후보가 여럿이면 하나라도 사용 가능할 때 READY, 모두 사용 불가이면 고정 우선순위의 사유 하나', () => {
  const SEED = 20261016;
  beforeAll(() => {
    console.info(`AC-011c 후보 순서 시험: seed=${SEED}`);
  });

  it.each(CANDIDATE_KINDS.map((make, index) => [PRIORITY[index], index, make] as const))('후보 종류 %s 하나는 estimate() 와 같은 코드를 낸다', (code, index, make) => {
    const bundle = make(`TEST_BUNDLE_KIND_${index}`);
    const clinic = clinicOf(bundle);
    const est = estimateFor(clinic, TARGET, TEST_CTX)!;
    expect(new Set(est.holdReasons.map((hold) => hold.code))).toEqual(new Set([code]));
    expect(targetRow([bundle])).toEqual({ cell: TARGET, status: 'NOT_READY', code });
  });

  it(`후보 종류 7가지의 크기 2 이상 부분집합 120개 × (입력 순서, seed=${SEED} 로 섞은 두 순서): 코드는 우선순위가 가장 높은 후보의 것이고 배열 순서에 달라지지 않는다`, () => {
    const random = seededRandom(SEED);
    let checked = 0;
    for (let mask = 1; mask < 1 << CANDIDATE_KINDS.length; mask += 1) {
      const kinds = CANDIDATE_KINDS.map((_make, index) => index).filter((index) => (mask & (1 << index)) !== 0);
      if (kinds.length < 2) continue;
      const bundles = kinds.map((index) => CANDIDATE_KINDS[index]!(`TEST_BUNDLE_KIND_${index}`));
      const expected = PRIORITY[Math.min(...kinds)]!;
      for (const order of [bundles, shuffled(bundles, random), shuffled(bundles, random)]) {
        expect(targetRow(order), `종류 ${kinds.join(',')}`).toEqual({ cell: TARGET, status: 'NOT_READY', code: expected });
        checked += 1;
      }
    }
    expect(checked).toBe(120 * 3);
  });

  it('사용 가능한 후보가 하나라도 섞여 있으면 어떤 순서에서도 READY 이고 사용 가능한 묶음 id 만 낸다', () => {
    const random = seededRandom(SEED);
    const good = bundleOf({ id: 'TEST_BUNDLE_GOOD' });
    const bad = CANDIDATE_KINDS.map((make, index) => make(`TEST_BUNDLE_KIND_${index}`));
    for (const order of [[good, ...bad], [...bad, good], shuffled([good, ...bad], random)]) {
      expect(targetRow(order)).toEqual({ cell: TARGET, status: 'READY', bundleIds: ['TEST_BUNDLE_GOOD'] });
    }
  });

  it('그 칸의 프로필이 없는 묶음은 후보가 아니다 (우선순위에 끼지 않는다)', () => {
    const noTarget = bundleOf({ id: 'TEST_BUNDLE_OTHER_CELL', profiles: allProfiles(TARGET, () => []) });
    const unapproved = CANDIDATE_KINDS[1]!('TEST_BUNDLE_KIND_1');
    expect(targetRow([noTarget, unapproved])).toEqual({ cell: TARGET, status: 'NOT_READY', code: 'PROFILE_UNAPPROVED' });
    expect(targetRow([noTarget])).toEqual({ cell: TARGET, status: 'NOT_READY', code: 'PROFILE_ABSENT' });
  });

  it('같은 칸에 프로필 둘인 후보는 PROFILE_INVALID 후보이고 중지 후보보다 앞선다', () => {
    const twice = bundleOf({ id: 'TEST_BUNDLE_TWICE', profiles: allProfiles(TARGET, (p) => [p, { ...p, id: `${p.id}_2` }]) });
    expect(targetRow([CANDIDATE_KINDS[6]!('TEST_BUNDLE_KIND_6'), twice])).toEqual({ cell: TARGET, status: 'NOT_READY', code: 'PROFILE_INVALID' });
  });
});

describe('AC-011c 표 P 가 READY 인 것만으로 병원이 준비되었다고 보지 않는다 (AC-011l 이 이어서 다룬다)', () => {
  it('플랫폼 보기가 15칸 READY 여도 범위가 없는 병원의 병원 보기는 15칸 NOT_READY 다', () => {
    const report = computeReadiness(snapshotOf([clinicOf(null)], [bundleOf()]), TEST_CTX);
    expect(report.platformProfiles.every((row) => row.status === 'READY')).toBe(true);
    expect(report.clinics[0]!.profiles.every((row) => row.status === 'NOT_READY' && row.code === 'CLINIC_RULE_SCOPE_ABSENT')).toBe(true);
    expect(report.clinics[0]!.calculationReady.every((row) => row.status === 'NOT_READY')).toBe(true);
  });
});
