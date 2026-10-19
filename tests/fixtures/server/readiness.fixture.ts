import { expect } from 'vitest';
import { estimate } from '../../../src/engine/estimate';
import type { Cell } from '../../../src/engine/resolve';
import { GENERATIONS } from '../../../src/engine/types';
import type {
  EstimateResult,
  InsurerType,
  PublishedLine,
  RuleBundleSnapshot,
  StandardAssumptionProfile,
  TreatmentCoverageMapping,
} from '../../../src/engine/types';
import type { ClinicReadiness, ReadinessClinicInput, ReadinessContext, ReadinessSnapshot } from '../../../src/server/readiness';
import { planningExampleRuleSet } from '../engine/document-rules.fixture';
import { makeLine } from '../engine/lines.fixture';
import { makeMapping } from '../engine/mappings.fixture';
import { TEST_AT, makeProfile, testDigest } from '../engine/profiles.fixture';

// 시험 자료(TEST_FIXTURE). 운영 준비 상태 계산(M3.E) 시험이 쓰는 순수 스냅샷 세계다.
// 엔진 시험 자료(tests/fixtures/engine)의 가짜 내용을 그대로 재사용하고, 해시는 엔진 시험의 testDigest 로 봉인한다.
// 어떤 값도 실제 규칙·약관·병원·승인 기록이 아니다. 'OPERATING' 은 허용 출처 값으로만 나온다.

export const INSURER_TYPES: readonly InsurerType[] = ['NON_LIFE', 'LIFE', 'MUTUAL_AID'];

/** 15칸: 세대 5종 × 보험사 형태 3종 (세대가 바깥, 형태가 안쪽). src 의 칸 목록과 따로 적어 서로 맞는지 시험한다. */
export const ALL_CELLS: readonly Cell[] = GENERATIONS.flatMap((generation) =>
  INSURER_TYPES.map((insurerType) => ({ generation, insurerType })),
);

export const cellName = (cell: Cell): string => `${cell.generation}/${cell.insurerType}`;
export const sameCell = (a: Cell, b: Cell): boolean => a.generation === b.generation && a.insurerType === b.insurerType;

// ───────────────────────── 구성 ─────────────────────────

/** 시험 허용 출처: 규칙 OPERATING·TEST_FIXTURE, 줄 OPERATING·TEST_FIXTURE·DEMO. 해시는 엔진 시험의 대역이다. */
export const TEST_CTX: ReadinessContext = {
  at: TEST_AT,
  acceptedOrigins: { rules: ['OPERATING', 'TEST_FIXTURE'], lines: ['OPERATING', 'TEST_FIXTURE', 'DEMO'] },
  digest: testDigest,
};

/** 운영 구성 모양: 규칙·줄 모두 OPERATING 만 허용한다 (이 시험 자료는 전부 TEST_FIXTURE 라서 모두 거절되어야 한다). */
export const OPERATING_ONLY_CTX: ReadinessContext = {
  ...TEST_CTX,
  acceptedOrigins: { rules: ['OPERATING'], lines: ['OPERATING'] },
};

// ───────────────────────── 프로필 ─────────────────────────

export const profileIdOf = (cell: Cell): string => `TEST_PROFILE_${cell.generation}_${cell.insurerType}`;

/** 칸 하나의 사용 가능한 프로필. overrides 에 contentHash 가 없으면 해시는 내용에 다시 맞춘다. */
export function profileOf(cell: Cell, overrides: Partial<StandardAssumptionProfile> = {}): StandardAssumptionProfile {
  return makeProfile({ id: profileIdOf(cell), generation: cell.generation, insurerType: cell.insurerType, ...overrides });
}

/**
 * 15칸 모두의 프로필. target 칸이 있으면 그 칸의 프로필을 change 가 돌려주는 프로필(들)로 바꾼다
 * (배열이면 같은 칸에 프로필이 여럿, 빈 배열이면 그 칸에 프로필이 없다).
 */
export function allProfiles(
  target: Cell | null = null,
  change: (base: StandardAssumptionProfile, cell: Cell) => StandardAssumptionProfile | StandardAssumptionProfile[] = (base) => base,
): StandardAssumptionProfile[] {
  return ALL_CELLS.flatMap((cell) => {
    const base = profileOf(cell);
    if (target === null || !sameCell(cell, target)) return [base];
    const changed = change(base, cell);
    return Array.isArray(changed) ? changed : [changed];
  });
}

// ───────────────────────── 줄·매핑 ─────────────────────────

export const T_A = 'T-A';
export const T_B = 'T-B';
export const T_C = 'T-C';
export const B_FEE = 'B-FEE';

export function defaultLines(): PublishedLine[] {
  return [
    makeLine(T_A, 10_000),
    makeLine(T_B, 20_000, { benefitType: 'NON_BENEFIT', calcClass: 'GENERAL_NON_BENEFIT' }),
    makeLine(T_C, 3_000),
  ];
}

export function defaultBaseFeeLines(): PublishedLine[] {
  return [makeLine(B_FEE, 5_000, { isBaseFee: true })];
}

export const allScope = (): Array<{ generation: Cell['generation']; insurerType: InsurerType }> => ALL_CELLS.map((cell) => ({ ...cell }));

/** 15칸 모두를 범위로 가진 사용 가능한 COVERED 매핑. */
export function coveredMapping(treatmentId: string, overrides: Partial<TreatmentCoverageMapping> = {}): TreatmentCoverageMapping {
  return makeMapping(treatmentId, { scope: allScope(), ...overrides });
}

export function defaultMappings(): TreatmentCoverageMapping[] {
  return [T_A, T_B, T_C, B_FEE].map((id) => coveredMapping(id));
}

// ───────────────────────── 묶음·병원·스냅샷 ─────────────────────────

export function bundleOf(overrides: Partial<RuleBundleSnapshot> = {}): RuleBundleSnapshot {
  return {
    id: 'TEST_BUNDLE_A',
    contentHash: 'TEST_BUNDLE_HASH_A',
    status: 'ACTIVE',
    profiles: allProfiles(),
    mappings: defaultMappings(),
    documentRuleSet: planningExampleRuleSet(),
    ...overrides,
  };
}

export function clinicOf(bundle: RuleBundleSnapshot | null, overrides: Partial<ReadinessClinicInput> = {}): ReadinessClinicInput {
  return {
    clinicId: 'TEST_CLINIC_1',
    slug: 'test-clinic-1',
    bundle,
    lines: defaultLines(),
    baseFeeLines: defaultBaseFeeLines(),
    ...overrides,
  };
}

/** 병원들이 가리키는 묶음(중복 id 는 하나)에 extraBundles 를 더한 스냅샷. */
export function snapshotOf(clinics: ReadinessClinicInput[], extraBundles: RuleBundleSnapshot[] = []): ReadinessSnapshot {
  const byId = new Map<string, RuleBundleSnapshot>();
  for (const bundle of [...clinics.flatMap((clinic) => (clinic.bundle === null ? [] : [clinic.bundle])), ...extraBundles]) {
    if (!byId.has(bundle.id)) byId.set(bundle.id, bundle);
  }
  return { bundles: [...byId.values()], clinics };
}

export const EMPTY_SNAPSHOT: ReadinessSnapshot = { bundles: [], clinics: [] };

// ───────────────────────── 엔진과 맞추기 ─────────────────────────

/** 그 병원의 게시된 치료·공통 기본비용 전부를 입력으로 같은 칸에서 부른 estimate() 의 결과. 치료가 하나도 없으면 null. */
export function estimateFor(clinic: ReadinessClinicInput, cell: Cell, ctx: ReadinessContext): EstimateResult | null {
  if (clinic.lines.length === 0) {
    return null;
  }
  const outcome = estimate(
    {
      generation: cell.generation,
      insurerType: cell.insurerType,
      treatmentIds: clinic.lines.map((line) => line.treatmentId),
      lines: clinic.lines,
      baseFeeLines: clinic.baseFeeLines,
      bundle: clinic.bundle,
      at: ctx.at,
      acceptedOrigins: { rules: [...ctx.acceptedOrigins.rules], lines: [...ctx.acceptedOrigins.lines] },
    },
    { digest: ctx.digest },
  );
  if (!outcome.ok) {
    throw new Error(`TEST_FIXTURE: estimate 가 입력을 거절했다 (${outcome.rejection.code})`);
  }
  return outcome.result;
}

/** 줄 하나가 estimate() 에서 받은 보류 코드. 보류가 아니면 null. */
export function engineHoldOf(result: EstimateResult, treatmentId: string): string | null {
  return result.holdReasons.find((hold) => hold.treatmentId === treatmentId)?.code ?? null;
}

export const rowOfCell = <T extends { cell: Cell }>(rows: readonly T[], cell: Cell): T => {
  const found = rows.find((row) => sameCell(row.cell, cell));
  if (found === undefined) throw new Error(`TEST_FIXTURE: ${cellName(cell)} 행이 없다`);
  return found;
};

/**
 * AC-011l (3) 의 동치를 한 병원에 대해 확인한다. 엔진이 판정하고 기대값을 손으로 적지 않는다.
 *  - calculationReady[칸] == READY  ⇔  estimate() 전체 상태가 ON_HOLD 가 아님
 *  - NOT_READY 의 S·P 단계 코드는 estimate() 가 그 칸의 모든 줄에 내는 코드와 같다
 *  - NOT_READY 의 M 단계 (줄, 코드) 집합은 estimate() 의 holdReasons[] 와 같다
 *  - 게시된 치료가 없으면 estimate() 에 넣을 입력이 없으므로 NOT_READY 만 확인한다
 */
export function expectCalculationAgrees(report: ClinicReadiness, clinic: ReadinessClinicInput, ctx: ReadinessContext, label = ''): void {
  const every = [...clinic.lines, ...clinic.baseFeeLines].map((line) => line.treatmentId);
  for (const cell of ALL_CELLS) {
    const row = rowOfCell(report.calculationReady, cell);
    const where = `${label} ${cellName(cell)}`.trim();
    const result = estimateFor(clinic, cell, ctx);
    if (result === null) {
      expect(row.status, where).toBe('NOT_READY');
      continue;
    }
    if (result.state !== 'ON_HOLD') {
      expect(row, where).toEqual({ cell, status: 'READY' });
      continue;
    }
    expect(row.status, where).toBe('NOT_READY');
    if (row.status === 'READY') continue;
    const holds = result.holdReasons.map((hold) => `${hold.treatmentId}:${hold.code}`).sort();
    if (row.stage === 'M') {
      expect(row.lines.map((line) => `${line.treatmentId}:${line.code}`).sort(), where).toEqual(holds);
    } else {
      expect(['S', 'P'], where).toContain(row.stage);
      expect(holds, where).toEqual(every.map((id) => `${id}:${row.code}`).sort());
    }
  }
}

// ───────────────────────── 고정 시드 난수 ─────────────────────────

/** mulberry32. 같은 시드는 같은 수열을 낸다 (고정 시드 시험용). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates. 입력을 바꾸지 않는다. */
export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

export const pick = <T>(items: readonly T[], random: () => number): T => items[Math.floor(random() * items.length)] as T;

// ───────────────────────── 운영 출처 세계 (M3.E 보강) ─────────────────────────
// 운영 허용 출처(OPERATING 만) 구성에서 "한 항목만 TEST_FIXTURE" 로 어긋나게 만들 때의 기준 세계다.
// 이름만 OPERATING 일 뿐 모든 값은 시험 자료이며 어떤 운영 자료도 아니다 (출처 표시는 판정을 시험하기 위한 값이다).
// 출처는 항목 머리 정보이고 내용 해시에 들지 않으므로 해시는 그대로 맞는다.

/** 15칸 모두 출처 OPERATING 인 프로필. target 칸이 있으면 그 칸만 change 로 바꾼다. */
export const operatingProfiles = (
  target: Cell | null = null,
  change: (base: StandardAssumptionProfile, cell: Cell) => StandardAssumptionProfile | StandardAssumptionProfile[] = (base) => base,
): StandardAssumptionProfile[] =>
  ALL_CELLS.flatMap((cell) => {
    const base = profileOf(cell, { origin: 'OPERATING' });
    if (target === null || !sameCell(cell, target)) return [base];
    const changed = change(base, cell);
    return Array.isArray(changed) ? changed : [changed];
  });

/** 출처 OPERATING 인 줄 (치료 셋과 공통 기본비용 하나). */
export const operatingLines = (): PublishedLine[] => defaultLines().map((line) => ({ ...line, origin: 'OPERATING' }));
export const operatingBaseFeeLines = (): PublishedLine[] => defaultBaseFeeLines().map((line) => ({ ...line, origin: 'OPERATING' }));

/** 프로필·매핑·서류 규칙 묶음이 모두 출처 OPERATING 인 ACTIVE 묶음. */
export const operatingBundleOf = (overrides: Partial<RuleBundleSnapshot> = {}): RuleBundleSnapshot =>
  bundleOf({
    profiles: operatingProfiles(),
    mappings: defaultMappings().map((mapping) => ({ ...mapping, origin: 'OPERATING' as const })),
    documentRuleSet: { ...planningExampleRuleSet(), origin: 'OPERATING' },
    ...overrides,
  });

export const operatingClinicOf = (bundle: RuleBundleSnapshot | null, overrides: Partial<ReadinessClinicInput> = {}): ReadinessClinicInput =>
  clinicOf(bundle, { lines: operatingLines(), baseFeeLines: operatingBaseFeeLines(), ...overrides });
