import { approve } from '../../../src/server/approval';
import type { EstimateResult, RuleBundleSnapshot } from '../../../src/engine/types';
import type { RuleBundleVersion } from '../../../src/server/domain/entities';
import type { ItemStateSnapshot, ItemVersionRecord, ItemVersionRecordOf, ItemVersionRef } from '../../../src/server/domain/items';
import { toEngineDocumentRuleSet, toEngineMapping, toEngineProfile } from '../../../src/server/domain/projection';
import { coverageFingerprintOf, coverageFingerprintOfBaseFee } from '../../../src/server/fingerprint';
import type { MemoryRepository } from '../../../src/server/repo/memory/memory-repository';
import { TEST_FIXTURE_RV_APPROVER, TEST_FIXTURE_RV_APPROVER_2, TEST_FIXTURE_RV_AUTHOR } from './actors.fixture';
import { BASE_FEE_ID, REPO_CTX, READY_CELL, T1, independentClinicInput, makeBaseFeeVersion, publishFeeCatalog, publishedBaseFeePath } from './base-fee.fixture';
import type { BaseFeePath } from './base-fee.fixture';
import { makeTreatmentVersion } from './entities.fixture';
import type { World } from './lifecycle.fixture';
import { validCatalogRequest } from './publish.fixture';
import { engineHoldOf, estimateFor } from './readiness.fixture';
import { publishCatalogOf, publishRefs } from './versioning.fixture';

// 시험 자료(TEST_FIXTURE). 재승인 정보와 캐시 계약 회귀 시험(M3 외부 검토 보완 ②)이 쓰는 세계.
// 모든 단계는 도메인 서비스로 지난다: 카탈로그 게시 → 매핑 작성 → 제출 → 승인(A1) → 묶음 게시 → PO 범위 지정 → (새 카탈로그 게시로 재검토 전환)
// → 재승인(A2) → 같은 항목을 담은 새 묶음 게시. 저장소에 승인 상태나 지문을 직접 넣는 길은 만들지 않는다.
// 첫 승인자(A1)·재승인자(A2)·작성자는 서로 다른 주체라서, 낡은 승인자가 섞이면 값으로 드러난다.

export const A1 = TEST_FIXTURE_RV_APPROVER;
export const A2 = TEST_FIXTURE_RV_APPROVER_2;
export const AUTHOR = TEST_FIXTURE_RV_AUTHOR;

/** 재승인 시각. 첫 승인 시각(시험 시계의 시작값)과 다른 날이다. */
export const REAPPROVAL_AT = '2026-10-20T09:00:00.000Z';

/** 보장 판단 필드가 바뀌는 새 버전을 게시할 수 있는 매핑 대상 하나: 치료 또는 공통 기본비용. */
export interface ReapprovalTarget {
  name: string;
  /** 엔진 줄의 treatmentId (매핑의 treatmentId 와 같다). */
  lineId: string;
  /** 묶음 경로에서 이 대상의 매핑 항목 참조. */
  mappingRef: (path: BaseFeePath) => ItemVersionRef;
  /** 변경 전 현재 버전의 지문 (첫 승인이 고정하는 값 F1). */
  fingerprintBefore: string;
  /** HA 가 판단 필드가 바뀐 새 버전을 담은 카탈로그를 게시한다. 새 현재 버전의 지문(F2)을 돌려준다. */
  publishJudgementChange: (world: World) => string;
}

const TREATMENT_V1 = validCatalogRequest().treatmentVersions[0]!;

export const REAPPROVAL_TARGETS: readonly ReapprovalTarget[] = [
  {
    name: '치료 매핑',
    lineId: T1,
    mappingRef: (path) => path.refs.mappings[0]!,
    fingerprintBefore: coverageFingerprintOf(TREATMENT_V1),
    publishJudgementChange: (world) => {
      const next = makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_1B', treatmentId: T1, treatmentCode: 'TEST_FIXTURE_TC_CHANGED' });
      const request = validCatalogRequest();
      publishCatalogOf(world, { treatmentVersions: [next, request.treatmentVersions[1]!], commonBaseFees: [makeBaseFeeVersion(1)] });
      return coverageFingerprintOf(next);
    },
  },
  {
    name: '공통 기본비용 매핑',
    lineId: BASE_FEE_ID,
    mappingRef: (path) => path.feeMapping!,
    fingerprintBefore: coverageFingerprintOfBaseFee(makeBaseFeeVersion(1)),
    publishJudgementChange: (world) => {
      const next = makeBaseFeeVersion(2, { code: 'TEST_FIXTURE_BASE_FEE_CODE_CHANGED' });
      publishFeeCatalog(world, [next]);
      return coverageFingerprintOfBaseFee(next);
    },
  },
];

// ───────────────────────── 캐시 흉내 ─────────────────────────

/** 캐시가 들고 있을 것: 묶음 기록과 항목 내용 기록의 깊은 복사본. 상태·승인자·지문·가용성은 들어 있지 않다. */
export interface BundleCache {
  bundle: RuleBundleVersion;
  records: ItemVersionRecord[];
}

/** 묶음과 그 항목 내용을 저장소에서 한 번 읽어 깊은 복사로 보관한다 (캐시 적재). */
export function cacheBundle(repo: MemoryRepository, bundleId: string): BundleCache {
  const bundle = repo.getRuleBundleVersion(bundleId);
  if (bundle === null) {
    throw new Error(`TEST_FIXTURE: 묶음 ${bundleId} 이(가) 없다`);
  }
  const records = bundle.itemRefs.map((ref) => {
    const record = repo.getItemVersion(ref);
    if (record === null) {
      throw new Error(`TEST_FIXTURE: 항목 ${ref.kind}/${ref.id}/${ref.version} 의 내용이 없다`);
    }
    return structuredClone(record);
  });
  return { bundle: structuredClone(bundle), records };
}

/** 지금 저장소의 항목 상태를 읽어 깊은 복사로 보관한다 (낡은 상태의 음성 대조군). */
export function copyStates(repo: MemoryRepository, refs: readonly ItemVersionRef[]): Array<ItemStateSnapshot | null> {
  return structuredClone(repo.readItemStates(refs));
}

/**
 * 캐시한 내용 + 주어진 항목 상태 + 방금 읽은 묶음 가용성으로 엔진 입력을 조립한다 (projection.ts 의 합성).
 * states 를 넘기지 않으면 지금 저장소에서 새로 읽는다(readItemStates 한 번). 내용·묶음 기록은 저장소에서 읽지 않는다.
 */
export function composeFromCache(
  repo: MemoryRepository,
  cache: BundleCache,
  states: Array<ItemStateSnapshot | null> = repo.readItemStates(cache.bundle.itemRefs),
): RuleBundleSnapshot {
  const status = repo.getBundleStatus(cache.bundle.id);
  if (status === null) {
    throw new Error(`TEST_FIXTURE: 묶음 ${cache.bundle.id} 의 가용성 기록이 없다`);
  }
  const snapshot: RuleBundleSnapshot = { id: cache.bundle.id, contentHash: cache.bundle.contentHash, status, profiles: [], mappings: [], documentRuleSet: null };
  cache.records.forEach((record, index) => {
    const state = states[index];
    if (state === null || state === undefined) {
      throw new Error(`TEST_FIXTURE: 항목 ${record.ref.id} 의 상태가 없다`);
    }
    if (record.ref.kind === 'PROFILE') {
      snapshot.profiles.push(toEngineProfile(record as ItemVersionRecordOf<'PROFILE'>, state));
    } else if (record.ref.kind === 'MAPPING') {
      snapshot.mappings.push(toEngineMapping(record as ItemVersionRecordOf<'MAPPING'>, state));
    } else {
      snapshot.documentRuleSet = toEngineDocumentRuleSet(record as ItemVersionRecordOf<'DOCUMENT_RULE_SET'>, state);
    }
  });
  return snapshot;
}

// ───────────────────────── 엔진 판정 ─────────────────────────

/** 병원 1 의 현재 카탈로그 줄과 주어진 묶음으로 READY_CELL 에서 부른 estimate(). */
export function estimateWithBundle(world: World, bundle: RuleBundleSnapshot | null): EstimateResult {
  return estimateFor({ ...independentClinicInput(world), bundle }, READY_CELL, REPO_CTX)!;
}

/** 한 줄의 판정: 보류면 보류 코드, 아니면 줄 상태. */
export function verdictOf(result: EstimateResult, lineId: string): string {
  const line = result.lines.find((candidate) => candidate.treatmentId === lineId);
  if (line === undefined) {
    throw new Error(`TEST_FIXTURE: 계산 결과에 ${lineId} 줄이 없다`);
  }
  return engineHoldOf(result, lineId) ?? line.state;
}

// ───────────────────────── 시나리오 단계 ─────────────────────────

export interface Scenario {
  target: ReapprovalTarget;
  path: BaseFeePath;
  world: World;
  ref: ItemVersionRef;
  /** 1단계에서 캐시처럼 읽어 둔 묶음과 내용. */
  cache: BundleCache;
  /** 1단계의 낡은 상태 사본 (음성 대조군): 묶음 항목 순서, 매핑은 PUBLISHED · A1 · F1. */
  staleStates: Array<ItemStateSnapshot | null>;
  /** 변경 전 지문 F1 . */
  f1: string;
}

/** 1단계: 게시된 묶음 X 를 먼저 읽는다. 주체 셋은 서로 다르다. */
export function stepOne(target: ReapprovalTarget): Scenario {
  const path = publishedBaseFeePath('COVERED');
  const ref = target.mappingRef(path);
  const cache = cacheBundle(path.world.repo, path.bundle.id);
  const staleStates = copyStates(path.world.repo, cache.bundle.itemRefs);
  return { target, path, world: path.world, ref, cache, staleStates, f1: target.fingerprintBefore };
}

/** 2단계: HA 가 판단 필드가 바뀐 새 버전을 게시한다 (매핑이 UNDER_REREVIEW 로 전환). 새 현재 버전의 지문 F2 를 돌려준다. */
export function stepTwo(scenario: Scenario): string {
  return scenario.target.publishJudgementChange(scenario.world);
}

/** 3단계: 작성자·A1 과 다른 RV(A2)가 재승인한다 (시계는 첫 승인과 다른 날로 옮긴다). */
export function stepThree(scenario: Scenario): void {
  scenario.world.clock.set(REAPPROVAL_AT);
  approve(scenario.world.deps, A2, scenario.ref);
}

/** 5단계: 같은 항목 참조로 새 묶음 X2 를 게시한다 (APPROVED 였던 매핑이 PUBLISHED 로 돌아온다). 게시자는 작성자·승인자와 다른 RV 다. */
export function stepFive(scenario: Scenario): RuleBundleVersion {
  return publishRefs(scenario.world, scenario.path.refs);
}
