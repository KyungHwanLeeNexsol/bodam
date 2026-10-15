import { describe, expect, it } from 'vitest';
import { estimate } from '../../src/engine/estimate';
import type { CoverageGroupDef, EstimateInput, PublishedLine, SharedLimitPool, TreatmentCoverageMapping } from '../../src/engine/types';
import { makeExcludedMapping, makeMapping } from '../fixtures/engine/mappings.fixture';
import { makeProfile, testDigest } from '../fixtures/engine/profiles.fixture';
import { UNLIMITED, group, perVisit } from '../fixtures/engine/cases.fixture';
import { bundleWith, makeInput, makeLine } from '../fixtures/engine/lines.fixture';

// 시험 자료: 모든 값은 TEST_FIXTURE이며 실제 보험 값이 아니다.
// AC-008k / AC-001a 의 배열 순서 독립과 DD-03 "출력 순서와 순서 독립". 5개 이하 배열은 모든 순열, 더 큰 배열은 고정 시드 순열을 쓴다.

const SEED = 20261015; // 고정 시드. 아래 시행 수와 함께 시험 제목에 기록한다.
const SHUFFLE_TRIALS = 60;

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const copy = [...items];
  let state = seed >>> 0;
  for (let i = copy.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    const j = state % (i + 1);
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

const GA = 'TEST_GROUP_A';
const GB = 'TEST_GROUP_B';
const GC = 'TEST_GROUP_C';
const POOL = 'TEST_POOL_AB';

const GROUPS: CoverageGroupDef[] = [
  group(GA, { kind: 'RATE_WITH_FIXED_FLOOR', fixed: 1_000, rate: 1500, rounding: 'ROUND_HALF_UP' }, perVisit(100_000), POOL),
  group(GB, { kind: 'FIXED', fixed: 2_000 }, perVisit(100_000), POOL),
  group(GC, { kind: 'FIXED', fixed: 500 }, UNLIMITED),
];
const POOLS: SharedLimitPool[] = [
  { poolKey: POOL, limit: perVisit(40_000) },
  { poolKey: 'TEST_POOL_UNUSED', limit: perVisit(1) },
];

// 대문자가 소문자보다 앞서고 "10" 이 "2" 보다 앞서며 한글 id 가 있는, 로케일 정렬과 다른 id 들.
const LINES: PublishedLine[] = [
  makeLine('Z-1', 30_000),
  makeLine('a-1', 20_000, { benefitType: 'NON_BENEFIT' }),
  makeLine('10', 12_000),
  makeLine('2', 8_000),
  makeLine('가', 5_000),
  makeLine('A-1', 7_000),
];
const BASE_FEE: PublishedLine[] = [makeLine('B-0', 3_000, { isBaseFee: true })];

const MAPPINGS: TreatmentCoverageMapping[] = [
  makeMapping('Z-1', { groupKey: GA }),
  makeMapping('Z-1', { id: 'TEST_STALE_Z', approvedFingerprint: 'TEST_FP_OLD', groupKey: GC }), // 사용 불가 후보
  makeMapping('a-1', { groupKey: GB }),
  makeMapping('a-1', { id: 'TEST_DRAFT_A', state: 'DRAFT', groupKey: GC }), // 사용 불가 후보
  makeMapping('10', { groupKey: GB }),
  makeMapping('2', { groupKey: GC }),
  makeExcludedMapping('가'),
  makeMapping('B-0', { groupKey: GC }),
  // 'A-1' 은 매핑이 없어 MAPPING_ABSENT 로 보류된다.
];

function build(parts: { mappings?: TreatmentCoverageMapping[]; groups?: CoverageGroupDef[]; pools?: SharedLimitPool[]; lines?: PublishedLine[]; baseFee?: PublishedLine[]; ids?: string[] } = {}): EstimateInput {
  const profile = makeProfile({
    groups: parts.groups ?? GROUPS,
    sharedLimitPools: parts.pools ?? POOLS,
    groupOrder: [GA, GB, GC], // groupOrder 는 데이터이므로 순열 대상이 아니다
  });
  return makeInput({
    lines: parts.lines ?? LINES,
    baseFeeLines: parts.baseFee ?? BASE_FEE,
    treatmentIds: parts.ids ?? LINES.map((line) => line.treatmentId),
    bundle: bundleWith(profile, parts.mappings ?? MAPPINGS),
  });
}

function serialize(input: EstimateInput): string {
  return JSON.stringify(estimate(input, { digest: testDigest }));
}

const BASELINE = serialize(build());

describe('기준 결과 확인', () => {
  it('기준 입력은 보류 줄·제외 줄·풀·여러 후보를 모두 담고 있다', () => {
    const outcome = JSON.parse(BASELINE) as { ok: boolean; result: { state: string; holdReasons: unknown[]; excludedItems: unknown[]; groups: Array<{ P: number; P_pooled: number }> } };
    expect(outcome.ok).toBe(true);
    expect(outcome.result.state).toBe('ON_HOLD');
    expect(outcome.result.holdReasons).toEqual([{ treatmentId: 'A-1', code: 'MAPPING_ABSENT' }]);
    expect(outcome.result.excludedItems).toHaveLength(1);
    expect(outcome.result.groups.some((entry) => entry.P_pooled < entry.P)).toBe(true); // 풀이 실제로 줄였다
  });
});

describe(`배열 순서만 바꾼 입력의 직렬화 결과는 바이트 단위로 같다 (시드 ${SEED}, 시행 ${SHUFFLE_TRIALS})`, () => {
  it('bundle.mappings (9개, 후보가 여럿인 줄 포함): 고정 시드 순열', () => {
    for (let trial = 0; trial < SHUFFLE_TRIALS; trial += 1) {
      expect(serialize(build({ mappings: seededShuffle(MAPPINGS, SEED + trial) }))).toBe(BASELINE);
    }
    expect(serialize(build({ mappings: [...MAPPINGS].reverse() }))).toBe(BASELINE);
  });

  it('lines·baseFeeLines·treatmentIds: 고정 시드 순열', () => {
    for (let trial = 0; trial < SHUFFLE_TRIALS; trial += 1) {
      const lines = seededShuffle(LINES, SEED + trial);
      const ids = seededShuffle([...LINES.map((line) => line.treatmentId), ...LINES.map((line) => line.treatmentId).slice(0, 2)], SEED * 2 + trial);
      expect(serialize(build({ lines, ids }))).toBe(BASELINE);
    }
  });

  it('프로필의 groups(3개: 모든 순열) 와 sharedLimitPools(2개: 모든 순열) — 프로필 내용 해시는 순서를 바꾼 프로필마다 다시 계산한다', () => {
    let checked = 0;
    for (const groups of permutations(GROUPS)) {
      for (const pools of permutations(POOLS)) {
        expect(serialize(build({ groups, pools }))).toBe(BASELINE);
        checked += 1;
      }
    }
    expect(checked).toBe(12);
  });

  it('치료 ID 에 중복이 섞여도 같다', () => {
    const ids = [...LINES.map((line) => line.treatmentId), 'Z-1', '2', '2'];
    expect(serialize(build({ ids }))).toBe(BASELINE);
  });
});

describe('groupOrder 는 데이터이므로 바꾸면 다른 입력이다 (순열 대상이 아님)', () => {
  it('groupOrder 를 바꾸면 풀 안의 그룹별 몫이 달라진다', () => {
    const profile = makeProfile({ groups: GROUPS, sharedLimitPools: POOLS, groupOrder: [GB, GA, GC] });
    const swapped = JSON.stringify(estimate({ ...build(), bundle: bundleWith(profile, MAPPINGS) }, { digest: testDigest }));
    expect(swapped).not.toBe(BASELINE);
  });
});

describe('출력 순서 고정 (DD-03 "출력 순서와 순서 독립")', () => {
  const outcome = estimate(build(), { digest: testDigest });
  if (!outcome.ok) throw new Error('거절되었다');
  const { result } = outcome;

  it('lines[] 는 treatmentId 의 유니코드 코드 포인트 오름차순이다 (대문자 < 소문자, "10" < "2", 한글은 뒤)', () => {
    expect(result.lines.map((line) => line.treatmentId)).toEqual(['10', '2', 'A-1', 'B-0', 'Z-1', 'a-1', '가']);
  });

  it('holdReasons[] 와 excludedItems[] 도 같은 순서 규칙이다', () => {
    expect(result.holdReasons.map((entry) => entry.treatmentId)).toEqual(['A-1']);
    expect(result.excludedItems.map((entry) => entry.treatmentId)).toEqual(['가']);
  });

  it('여러 보류·제외 항목이 있을 때도 코드 포인트 순이다', () => {
    const lines = [makeLine('b', 100), makeLine('B', 100), makeLine('a', 100), makeLine('10', 100), makeLine('9', 100), makeLine('나', 100), makeLine('가', 100)];
    const out = estimate(build({ lines, mappings: [], ids: lines.map((line) => line.treatmentId), baseFee: [] }), { digest: testDigest });
    if (!out.ok) throw new Error('거절되었다');
    const expected = ['10', '9', 'B', 'a', 'b', '가', '나'];
    expect(out.result.holdReasons.map((entry) => entry.treatmentId)).toEqual(expected);
    const ex = estimate(
      build({ lines, mappings: lines.map((line) => makeExcludedMapping(line.treatmentId)), ids: lines.map((line) => line.treatmentId), baseFee: [] }),
      { digest: testDigest },
    );
    if (!ex.ok) throw new Error('거절되었다');
    expect(ex.result.excludedItems.map((entry) => entry.treatmentId)).toEqual(expected);
  });

  it('groups[] 는 프로필의 groupOrder 순서이고 basis 의 단계도 같은 순서다', () => {
    expect(result.groups.map((entry) => entry.groupKey)).toEqual([GA, GB, GC]);
    expect(result.basis.steps.map((step) => step.groupKey)).toEqual([GA, GB, GC]);
  });

  it('referenceGroups[] 는 groupOrder 순서이고 보류 그룹과 한도를 공유하지 않는 그룹만 든다', () => {
    expect(result.referenceGroups.map((entry) => entry.groupKey)).toEqual([GA, GB, GC]);
  });

  it('assumptions[] 는 DD-03 가정 코드 표의 행 순서다', () => {
    const ok = estimate(build({ lines: LINES.filter((line) => line.treatmentId !== 'A-1'), ids: LINES.map((line) => line.treatmentId).filter((id) => id !== 'A-1') }), { digest: testDigest });
    if (!ok.ok) throw new Error('거절되었다');
    expect(ok.result.assumptions).toEqual(['STANDARD_PROFILE_APPLIED', 'REMAINING_COVERED_AND_LIMIT_REMAINS', 'PERSONAL_CONTRACT_NOT_CONFIRMED']);
  });
});
