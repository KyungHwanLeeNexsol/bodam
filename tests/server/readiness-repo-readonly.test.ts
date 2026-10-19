import { describe, expect, it } from 'vitest';
import { HOLD_REASON_CODES } from '../../src/engine/types';
import { suspendItem } from '../../src/server/approval';
import { assignRuleScope } from '../../src/server/rule-scope';
import { canonicalDigest } from '../../src/server/digest';
import { loadReadinessSnapshot, operatingReadinessContext, readReadiness } from '../../src/server/readiness';
import type { ReadinessContext, ReadinessReads, ReadinessReport } from '../../src/server/readiness';
import { TEST_FIXTURE_PO_1 } from '../fixtures/server/actors.fixture';
import { makeClinic } from '../fixtures/server/entities.fixture';
import { TEST_FIXTURE_RV_SUSPENDER } from '../fixtures/server/governance.fixture';
import { mappingRecord } from '../fixtures/server/items.fixture';
import { baseContent, newWorld } from '../fixtures/server/lifecycle.fixture';
import { TEST_CATALOG_CONFIG, validCatalogRequest } from '../fixtures/server/publish.fixture';
import { ALL_CELLS, TEST_CTX, cellName, rowOfCell } from '../fixtures/server/readiness.fixture';
import { snapshotOf as repoSnapshotOf } from '../fixtures/server/repo.fixture';
import type { BundleSpec } from '../fixtures/server/versioning.fixture';
import { TEST_FIXTURE_CLINIC_ID, approveSpec, catalogWorld, publishCatalogOf, publishRefs } from '../fixtures/server/versioning.fixture';

// AC-011l (5) 와 읽기 전용 증명 보강 (M3.E 보강 세션).
//   (a) 운영 데이터가 없는 저장소를 한 번에: 병원은 있고(게시된 카탈로그 포함) 규칙 사용 범위가 없을 때 네 표와 두 조건과 보류 코드 종류를 함께 본다.
//   (b) 읽기 전용: 쓰기 메서드에 닿으면 던지는 대리 객체로 감싼 저장소를 넘겨도 같은 보고가 나온다 (읽기 메서드 아홉 개만 쓴다).
//   (c) 항목 상태는 호출마다 새로 읽는다: 두 호출 사이에 상태를 바꾸면 두 번째 보고가 바뀐다 (캐시 없음).

const REPO_CTX: ReadinessContext = { ...TEST_CTX, at: '2026-10-16', digest: canonicalDigest };

/** ReadinessReads 가 정한 읽기 메서드 이름. 이 밖의 속성에 닿으면 던진다 (쓰기 메서드 포함). */
const READ_METHODS = ['listClinics', 'getClinicRuleScope', 'getClinicCurrentCatalogVersion', 'getTreatmentVersion', 'getCommonBaseFee', 'listRuleBundleVersions', 'getBundleStatus', 'getItemVersion', 'readItemStates'] as const;

function readOnlyView<T extends object>(repo: T): { view: ReadinessReads; touched: Set<string> } {
  const touched = new Set<string>();
  const view = new Proxy(repo, {
    get(target, prop) {
      if (typeof prop === 'string' && !(READ_METHODS as readonly string[]).includes(prop)) {
        throw new Error(`TEST_FIXTURE: 읽기 전용 대리 객체가 '${prop}' 접근을 거절했다`);
      }
      touched.add(String(prop));
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  }) as unknown as ReadinessReads;
  return { view, touched };
}

function publishedWorld() {
  const world = catalogWorld();
  const request = validCatalogRequest();
  publishCatalogOf(world, { treatmentVersions: request.treatmentVersions, commonBaseFees: request.commonBaseFees }, TEST_CATALOG_CONFIG);
  return world;
}

function readyWorld(options: { baseFees?: boolean } = {}) {
  const world = catalogWorld();
  const request = validCatalogRequest();
  publishCatalogOf(world, { treatmentVersions: request.treatmentVersions, commonBaseFees: options.baseFees === true ? request.commonBaseFees : [] }, TEST_CATALOG_CONFIG);
  const spec: BundleSpec = {
    profiles: [baseContent('PROFILE', 1)],
    mappings: [baseContent('MAPPING', 1), mappingRecord('TEST_FIXTURE_TREATMENT_2', { id: 'TEST_FIXTURE_MAPPING_2' }).content],
    documentRuleSet: baseContent('DOCUMENT_RULE_SET', 1),
  };
  const refs = approveSpec(world, spec);
  const bundle = publishRefs(world, refs);
  assignRuleScope(world.deps, TEST_FIXTURE_PO_1, TEST_FIXTURE_CLINIC_ID, bundle.id);
  return { world, refs, bundle };
}

const allowedCodes = new Set<string>([...HOLD_REASON_CODES, 'RULES_UNAVAILABLE', 'NO_PUBLISHED_TREATMENT']);
function codesOf(report: ReadinessReport): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value)) {
        if (key === 'code' && typeof entry === 'string') out.push(entry);
        else walk(entry);
      }
    }
  };
  walk(report);
  return out;
}

describe('AC-011l (5) 운영 데이터가 없는 저장소: 병원과 게시된 카탈로그는 있고 규칙 사용 범위·규칙 묶음이 없다', () => {
  const world = publishedWorld();
  const report = readReadiness(world.repo, operatingReadinessContext('2026-10-16'));
  const timed = readReadiness(world.repo, REPO_CTX);

  it('표 P(플랫폼 보기) 15칸 모두 PROFILE_ABSENT, 병원 보기 15칸 모두 CLINIC_RULE_SCOPE_ABSENT', () => {
    for (const result of [report, timed]) {
      expect(result.platformProfiles).toEqual(ALL_CELLS.map((cell) => ({ cell, status: 'NOT_READY', code: 'PROFILE_ABSENT' })));
      expect(result.clinics[0]!.profiles).toEqual(ALL_CELLS.map((cell) => ({ cell, status: 'NOT_READY', code: 'CLINIC_RULE_SCOPE_ABSENT' })));
    }
  });

  it('표 S 는 SCOPE_ABSENT, 표 D 는 RULES_UNAVAILABLE(세부 SCOPE_ABSENT), 표 M 의 게시된 줄 전부가 15칸 MAPPING_ABSENT (시험 허용 출처에서)', () => {
    const clinic = timed.clinics[0]!;
    expect(clinic.scope).toEqual({ status: 'NOT_READY', value: 'SCOPE_ABSENT', code: 'CLINIC_RULE_SCOPE_ABSENT', bundleId: null, contentHash: null });
    expect(clinic.documents).toEqual({ status: 'NOT_READY', code: 'RULES_UNAVAILABLE', detail: 'SCOPE_ABSENT' });
    expect(clinic.mappings).toHaveLength(4 * 15);
    expect(clinic.mappings.every((row) => row.status === 'NOT_READY' && row.code === 'MAPPING_ABSENT')).toBe(true);
    expect(new Set(clinic.mappings.map((row) => row.treatmentId)).size).toBe(4);
    expect(clinic.mappings.filter((row) => row.isBaseFee).length).toBe(2 * 15);
  });

  it('calculationReady 15칸과 documentReady 가 모두 NOT_READY 이고 막힌 단계는 S 다', () => {
    const clinic = timed.clinics[0]!;
    expect(clinic.calculationReady).toEqual(ALL_CELLS.map((cell) => ({ cell, status: 'NOT_READY', stage: 'S', code: 'CLINIC_RULE_SCOPE_ABSENT' })));
    expect(clinic.documentReady).toEqual({ status: 'NOT_READY', stage: 'S', code: 'CLINIC_RULE_SCOPE_ABSENT' });
  });

  it('새 보류 코드가 없다: 보고에 나온 모든 코드는 DD-03 의 보류 코드이거나 보고용 표시(RULES_UNAVAILABLE, NO_PUBLISHED_TREATMENT)다', () => {
    for (const result of [report, timed]) {
      const codes = codesOf(result);
      expect(codes.length).toBeGreaterThan(0);
      expect(codes.filter((code) => !allowedCodes.has(code))).toEqual([]);
    }
  });
});

describe('읽기 전용 증명: 쓰기 메서드를 쓰지 않는다', () => {
  it('읽기 메서드 아홉 개만 접근할 수 있는 대리 객체로도 같은 보고가 나오고, 쓰기 메서드·그 밖의 속성에 접근하지 않는다', () => {
    // 공통 기본비용이 든 카탈로그여야 getCommonBaseFee 까지 아홉 개가 모두 쓰인다.
    const { world } = readyWorld({ baseFees: true });
    const direct = readReadiness(world.repo, REPO_CTX);
    const { view, touched } = readOnlyView(world.repo);
    expect(readReadiness(view, REPO_CTX)).toEqual(direct);
    expect(loadReadinessSnapshot(view)).toEqual(loadReadinessSnapshot(world.repo));
    expect([...touched].sort()).toEqual([...READ_METHODS].sort());
  });

  it('대리 객체 시험이 살아 있다: 쓰기 메서드에 접근하면 실제로 던진다 (빈 시험 방지)', () => {
    const { world } = readyWorld();
    const { view } = readOnlyView(world.repo);
    expect(() => (view as unknown as { saveClinic: unknown }).saveClinic).toThrow(/saveClinic/);
    expect(() => (view as unknown as { transaction: unknown }).transaction).toThrow(/transaction/);
  });

  it('호출 전후로 저장소 전체(감사 기록·묶음 상태 이벤트 포함)가 깊이 같다', () => {
    const { world } = readyWorld();
    world.repo.saveClinic(makeClinic({ id: 'TEST_FIXTURE_CLINIC_NO_SCOPE', slug: 'test-fixture-no-scope' }));
    const before = repoSnapshotOf(world.repo);
    readReadiness(world.repo, REPO_CTX);
    readReadiness(world.repo, operatingReadinessContext('2026-10-16'));
    loadReadinessSnapshot(world.repo);
    expect(repoSnapshotOf(world.repo)).toEqual(before);
  });
});

describe('항목 상태는 호출마다 새로 읽는다 (캐시 없음, DD-14)', () => {
  const READY_CELL = ALL_CELLS.find((cell) => cell.generation === 'GEN4_C4' && cell.insurerType === 'NON_LIFE')!;

  it('두 호출 사이에 프로필 항목을 중지하면 두 번째 보고만 바뀌고, 그 뒤 변화가 없으면 세 번째 보고는 두 번째와 같다', () => {
    const { world, refs } = readyWorld();
    world.repo.spy.reset();
    const first = readReadiness(world.repo, REPO_CTX);
    const readsAfterFirst = world.repo.spy.counts.readItemStates;
    expect(rowOfCell(first.clinics[0]!.calculationReady, READY_CELL), cellName(READY_CELL)).toEqual({ cell: READY_CELL, status: 'READY' });

    suspendItem(world.deps, TEST_FIXTURE_RV_SUSPENDER, refs.profiles[0]!, 'TEST_FIXTURE 사유');
    world.repo.spy.reset();
    const second = readReadiness(world.repo, REPO_CTX);
    expect(world.repo.spy.counts.readItemStates).toBe(readsAfterFirst);
    expect(rowOfCell(second.clinics[0]!.calculationReady, READY_CELL)).toMatchObject({ status: 'NOT_READY', stage: 'P', code: 'PROFILE_INVALID' });
    expect(second).not.toEqual(first);

    expect(readReadiness(world.repo, REPO_CTX)).toEqual(second);
  });

  it('두 호출 사이에 서류 규칙 묶음 항목을 중지하면 두 번째 보고에서 documentReady 만 바뀐다', () => {
    const { world, refs } = readyWorld();
    const first = readReadiness(world.repo, REPO_CTX).clinics[0]!;
    suspendItem(world.deps, TEST_FIXTURE_RV_SUSPENDER, refs.documentRuleSet!, 'TEST_FIXTURE 사유');
    const second = readReadiness(world.repo, REPO_CTX).clinics[0]!;
    expect(first.documentReady).toEqual({ status: 'READY' });
    expect(second.documentReady).toMatchObject({ status: 'NOT_READY', stage: 'D' });
    expect(second.calculationReady).toEqual(first.calculationReady);
  });
});
