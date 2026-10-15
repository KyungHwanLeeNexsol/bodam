import { estimate } from '../../../src/engine/estimate';
import type {
  CoverageGroupDef,
  DeductionRule,
  EstimateInput,
  EstimateResult,
  LimitRule,
  PublishedLine,
  SharedLimitPool,
  StandardAssumptionProfile,
  TreatmentCoverageMapping,
} from '../../../src/engine/types';
import { makeExcludedMapping, makeMapping } from './mappings.fixture';
import { makeProfile, testDigest } from './profiles.fixture';
import { T_INJECT, T_PHYSIO, T_ULTRA, T_XRAY, bundleWith, exampleLines, makeInput } from './lines.fixture';

// 시험 자료(TEST_FIXTURE). 공제·한도 숫자는 기획서 §5/§6 계산 예시를 옮긴 시험 사본이며
// 실제 보험 공제식·공제액·한도·약관 조항이 아니다. 조항 참조는 시험용 표시다.

export const UNLIMITED: LimitRule = { kind: 'UNLIMITED_DECLARED', policyClauseRef: 'TEST_FIXTURE_CLAUSE_REF' };

export function perVisit(amount: number): LimitRule {
  return { kind: 'PER_VISIT_PAYOUT', amount, limitBasis: 'PAYOUT' };
}

export function group(
  groupKey: string,
  deduction: DeductionRule,
  limit: LimitRule,
  sharedLimitPoolKey?: string,
): CoverageGroupDef {
  return {
    groupKey,
    deduction,
    limit,
    ...(sharedLimitPoolKey === undefined ? {} : { sharedLimitPoolKey }),
  };
}

export interface CaseOptions {
  groups: CoverageGroupDef[];
  pools?: SharedLimitPool[];
  /** 기본값: groups 의 순서. */
  groupOrder?: string[];
  /** treatmentId -> groupKey. 기본값: 모든 줄이 첫 그룹. EXCLUDED 매핑은 excluded 로 따로 준다. */
  assign?: Record<string, string>;
  /** 확인된 제외(EXCLUDED) 매핑으로 만들 treatmentId 목록. */
  excluded?: string[];
  /** 지정하면 assign·excluded 로 만든 매핑 대신 이 매핑 전체를 쓴다. */
  mappings?: TreatmentCoverageMapping[];
  lines?: PublishedLine[];
  baseFeeLines?: PublishedLine[];
  profile?: Partial<StandardAssumptionProfile>;
  input?: Partial<EstimateInput>;
}

export function caseInput(options: CaseOptions): EstimateInput {
  const lines = options.lines ?? exampleLines();
  const baseFeeLines = options.baseFeeLines ?? [];
  const firstGroup = options.groups[0]?.groupKey ?? 'TEST_GROUP_NONE';
  const excluded = new Set(options.excluded ?? []);
  // 줄이 중복되어도 매핑은 치료 ID 마다 하나만 만든다(같은 ID 에 사용 가능한 매핑이 둘이면 모호 보류가 된다).
  const uniqueLines = [...lines, ...baseFeeLines].filter(
    (line, index, all) => all.findIndex((other) => other.treatmentId === line.treatmentId) === index,
  );
  const mappings =
    options.mappings ??
    uniqueLines.map((line) =>
      excluded.has(line.treatmentId)
        ? makeExcludedMapping(line.treatmentId)
        : makeMapping(line.treatmentId, { groupKey: options.assign?.[line.treatmentId] ?? firstGroup }),
    );
  const profile = makeProfile({
    groups: options.groups,
    groupOrder: options.groupOrder ?? options.groups.map((entry) => entry.groupKey),
    sharedLimitPools: options.pools ?? [],
    ...options.profile,
  });
  return makeInput({
    lines,
    baseFeeLines,
    treatmentIds: lines.map((line) => line.treatmentId),
    bundle: bundleWith(profile, mappings),
    ...options.input,
  });
}

/** 거절되면 던진다. 계산 결과만 필요한 시험용이다. */
export function runEstimate(input: EstimateInput): EstimateResult {
  const outcome = estimate(input, { digest: testDigest });
  if (!outcome.ok) {
    throw new Error(`거절되었다: ${outcome.rejection.code}`);
  }
  return outcome.result;
}

// ───────────────────────── 계산 예시 사례 A~E 의 그룹 (AC-002a~e) ─────────────────────────

export const G_ONE = 'TEST_GROUP_ONE';
export const G_BENEFIT = 'TEST_GROUP_BENEFIT';
export const G_NON_BENEFIT = 'TEST_GROUP_NON_BENEFIT';

export const CASE_A = [group(G_ONE, { kind: 'FIXED', fixed: 10_000 }, perVisit(250_000))];
export const CASE_B = [
  group(G_ONE, { kind: 'RATE_WITH_FIXED_FLOOR', fixed: 10_000, rate: 2000, rounding: 'TRUNCATE' }, UNLIMITED),
];
export const CASE_C = [
  group(
    G_ONE,
    { kind: 'SPLIT_RATE_WITH_FIXED_FLOOR', fixed: 10_000, rateBenefit: 1000, rateNonBenefit: 2000, rounding: 'TRUNCATE' },
    UNLIMITED,
  ),
];
export const CASE_D = [
  group(G_BENEFIT, { kind: 'CAPPED_RATE_WITH_FIXED_FLOOR', fixed: 10_000, rate: 2000, rounding: 'TRUNCATE' }, UNLIMITED),
  group(G_NON_BENEFIT, { kind: 'CAPPED_RATE_WITH_FIXED_FLOOR', fixed: 30_000, rate: 3000, rounding: 'TRUNCATE' }, UNLIMITED),
];
export const CASE_D_ASSIGN: Record<string, string> = {
  [T_XRAY]: G_BENEFIT,
  [T_PHYSIO]: G_BENEFIT,
  [T_ULTRA]: G_NON_BENEFIT,
  [T_INJECT]: G_NON_BENEFIT,
};
export const CASE_E = [group(G_ONE, { kind: 'FIXED', fixed: 10_000 }, UNLIMITED)];
