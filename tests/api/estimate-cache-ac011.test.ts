import { beforeEach, describe, expect, it, vi } from 'vitest';
import { suspendItem } from '../../src/server/approval';
import type { ItemVersionRef } from '../../src/server/domain/items';
import { triggerReReviewForTarget } from '../../src/server/re-review';
import { suspendRuleBundle } from '../../src/server/bundle-status';
import { TEST_FIXTURE_HA_1 } from '../fixtures/server/actors.fixture';
import { useTestServices } from '../fixtures/server/api-composition.fixture';
import { BASE_FEE_ID, T1, T2 } from '../fixtures/server/base-fee.fixture';
import { FULL_HOSPITAL_PAYMENT, specOf } from '../fixtures/server/estimate-world.fixture';
import type { EstimateWorld } from '../fixtures/server/estimate-world.fixture';
import { TEST_FIXTURE_RV_SUSPENDER } from '../fixtures/server/governance.fixture';
import { mappingRecord } from '../fixtures/server/items.fixture';
import { REAPPROVAL_AT } from '../fixtures/server/reapproval.fixture';
import { CLINIC_2_SLUG, FRESH_READS, clinic2Body, currentBody, engineBundle, estimateSpy, freshReadCounts, lineOf, mappingRefFor, ready, refOfKind, send, twoClinics, verdict } from './cache-contract-helpers';
import type { Sent } from './cache-contract-helpers';

// AC-011m ~ AC-011p (integration): 묶음 내용을 먼저 읽어 캐시한 뒤 도메인 서비스로 항목 상태를 바꾸고 다음 요청을 보낸다 (design.md DD-14 "항목 생명주기 상태와 캐시 계약").
// 모든 시험은 실제 route.ts 의 POST 를 지나고, 첫 요청이 캐시를 채운 다음(미적중) 둘째 요청이 적중이다. 읽기 횟수는 요청 한 번 단위로 센다.
// 상태를 바꾸는 길:
//   - 항목 중지(SUSPENDED): 도메인 서비스 suspendItem
//   - 매핑의 재검토 전환(UNDER_REREVIEW): 도메인 서비스 triggerReReviewForTarget (카탈로그 게시가 부르는 바로 그 시스템 전이. 카탈로그를 게시하지 않으므로 버전이 안 바뀐다)
//   - 프로필·서류 규칙 묶음의 재검토 전환(UNDER_REREVIEW): M3 에는 이 전이를 일으키는 도메인 서비스가 없다(자동 전환은 매핑만 대상이다).
//     그래서 저장소의 상태 전이 기록(recordItemTransition, 전이 표가 허용하는 PUBLISHED → UNDER_REREVIEW)을 직접 쓴다. 이 경우만 서비스 경로가 아니다.

vi.mock('../../src/app/services', async () => {
  const { activeTestServices } = await import('../fixtures/server/api-composition.fixture');
  return { getApiServices: () => activeTestServices() };
});

vi.mock('../../src/engine/estimate', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/engine/estimate')>();
  return { ...real, estimate: vi.fn(real.estimate) };
});

beforeEach(() => {
  useTestServices(null);
  estimateSpy.mockClear();
});

/** M3 에 서비스가 없는 재검토 전환(프로필·서류 규칙 묶음)을 저장소의 전이 기록으로 만든다. 승인자·고정 지문은 그대로 잇는다. */
function underReReviewByRepository(w: EstimateWorld, ref: ItemVersionRef): void {
  const current = w.world.repo.getItemState(ref)!;
  w.world.repo.recordItemTransition(ref, {
    from: current.state,
    to: 'UNDER_REREVIEW',
    actor: TEST_FIXTURE_HA_1,
    at: REAPPROVAL_AT,
    reason: 'TEST_FIXTURE 재검토 전환',
    approverAfter: current.approver,
    approvedFingerprintAfter: current.approvedFingerprint,
  });
}

/** 클라이언트가 가진 두 버전과 묶음 가용성. 보류 응답에서는 프로필이 정해지지 않을 수 있어 versions.profile 은 뺀다. */
const versionIds = (sent: Sent) => ({ catalogVersion: sent.body.versions.catalogVersion, ruleBundleVersion: sent.body.versions.ruleBundleVersion, ruleBundleStatus: sent.body.versions.ruleBundleStatus });

const holdCodes = (sent: Sent): Set<string | undefined> => new Set(sent.body.result.lines.map((line) => line.holdReason));

/** 전체 보류 응답의 공통 확인: 200 ON_HOLD, 병원 결제액은 숫자, 보험금 둘은 null, 서류는 null. */
function expectWholeHold(sent: Sent): void {
  expect(sent.called.status).toBe(200);
  expect(sent.body.result.state).toBe('ON_HOLD');
  expect(sent.body.result.amounts).toMatchObject({ hospitalPayment: FULL_HOSPITAL_PAYMENT, expectedInsurancePayout: null, expectedOutOfPocketAfterPayout: null });
  expect(sent.body.documents).toBeNull();
}

describe('AC-011m 캐시된 뒤 프로필 하나의 상태가 바뀌면 다음 요청은 200 ON_HOLD 이고 버전은 바뀌지 않는다', () => {
  const CASES: Array<[string, string, (w: EstimateWorld, ref: ItemVersionRef) => void]> = [
    ['SUSPENDED (suspendItem)', 'PROFILE_INVALID', (w, ref) => suspendItem(w.world.deps, TEST_FIXTURE_RV_SUSPENDER, ref, 'TEST_FIXTURE 중지 사유')],
    ['UNDER_REREVIEW (저장소 전이 기록)', 'PROFILE_UNDER_REREVIEW', underReReviewByRepository],
  ];

  it.each(CASES)('%s: 그 칸의 모든 줄이 %s 로 보류되고 versions·묶음 내용 해시는 그대로다. 내용은 캐시 적중이고 상태 읽기는 요청마다 한 번이다', async (_label, code, change) => {
    const { w, calls } = ready();
    const body = currentBody(w);
    const first = await send(w, body);
    expect(first.body.result.state).toBe('ESTIMATED');
    expect(first.reads.getItemVersion).toBe(5); // 이 요청이 캐시를 채웠다
    change(w, refOfKind(w.bundle!, 'PROFILE'));

    const next = await send(w, body);
    expectWholeHold(next);
    expect(holdCodes(next)).toEqual(new Set([code]));
    expect(next.body.versions).toMatchObject({ catalogVersion: first.body.versions.catalogVersion, ruleBundleVersion: first.body.versions.ruleBundleVersion, ruleBundleStatus: 'ACTIVE' });
    expect(engineBundle(next).contentHash).toBe(engineBundle(first).contentHash);
    // 읽기 호출 감시: 내용은 적중(항목 내용 조회 없음), 상태·승인자·지문은 같은 읽기 한 번으로 새로 읽는다
    expect(calls).toEqual({ lookups: 2, hits: 1, stores: 1 });
    expect(next.reads.getItemVersion).toBe(0);
    expect(freshReadCounts(next.reads)).toEqual(FRESH_READS);
    const profile = engineBundle(next).profiles[0]!;
    expect(profile.state).toBe(code === 'PROFILE_INVALID' ? 'SUSPENDED' : 'UNDER_REREVIEW');
    expect(profile.approver?.approverId).toBe('TEST_FIXTURE_RV_APPROVER');
  });
});

describe('AC-011n 캐시된 뒤 매핑 하나의 상태가 바뀌면 그 매핑이 유일한 후보였던 줄만 보류된다', () => {
  it('치료 매핑 SUSPENDED: T1 줄만 MAPPING_INVALID 로 ON_HOLD, 나머지는 ESTIMATED, 전체 ON_HOLD, 보험금 null, 버전 그대로', async () => {
    const { w } = ready();
    const body = currentBody(w);
    const first = await send(w, body);
    suspendItem(w.world.deps, TEST_FIXTURE_RV_SUSPENDER, mappingRefFor(w, T1), 'TEST_FIXTURE 중지 사유');
    const next = await send(w, body);
    expect(next.called.status).toBe(200);
    expect(next.body.result.state).toBe('ON_HOLD');
    expect(verdict(next.body, T1)).toBe('MAPPING_INVALID');
    expect(lineOf(next.body, T1).state).toBe('ON_HOLD');
    expect([verdict(next.body, T2), verdict(next.body, BASE_FEE_ID)]).toEqual(['ESTIMATED', 'ESTIMATED']);
    expect(next.body.result.amounts).toMatchObject({ hospitalPayment: FULL_HOSPITAL_PAYMENT, expectedInsurancePayout: null, expectedOutOfPocketAfterPayout: null });
    expect(next.body.versions).toEqual(first.body.versions);
    expect(next.reads.getItemVersion).toBe(0);
    expect(freshReadCounts(next.reads)).toEqual(FRESH_READS);
  });

  it.each([
    ['치료 매핑(T1)', T1],
    ['치료 매핑(T2)', T2],
    ['공통 기본비용 매핑', BASE_FEE_ID],
  ])('%s UNDER_REREVIEW (triggerReReviewForTarget): 그 대상의 줄만 MAPPING_UNDER_REREVIEW 로 보류, 나머지는 ESTIMATED, 요청 본문·버전은 그대로', async (_label, target) => {
    const { w } = ready();
    const body = currentBody(w);
    const first = await send(w, body);
    const moved = triggerReReviewForTarget(w.world.deps, TEST_FIXTURE_HA_1, target, 'TEST_FIXTURE_OTHER_FINGERPRINT');
    expect(moved).toHaveLength(1);
    const next = await send(w, body);
    expect(next.called.status).toBe(200);
    expect(verdict(next.body, target)).toBe('MAPPING_UNDER_REREVIEW');
    for (const other of [T1, T2, BASE_FEE_ID].filter((id) => id !== target)) {
      expect(verdict(next.body, other), other).toBe('ESTIMATED');
    }
    expect(next.body.result.state).toBe('ON_HOLD');
    expect(next.body.result.amounts.expectedInsurancePayout).toBeNull();
    expect(next.body.versions).toEqual(first.body.versions);
    expect(next.reads.getItemVersion).toBe(0);
  });

  it('같은 칸·치료에 사용 가능한 다른 후보가 있으면 그 후보로 확정되어 응답이 바뀌지 않는다 (허용 출처 밖(DEMO)이라 사용할 수 없는 둘째 후보를 중지)', async () => {
    const spec = specOf();
    spec.mappings.push(mappingRecord(T1, { id: 'TEST_FIXTURE_MAPPING_T1_OLD', origin: 'DEMO' }).content);
    const { w } = ready({ spec });
    const body = currentBody(w);
    const first = await send(w, body);
    expect(first.body.result.state).toBe('ESTIMATED'); // 허용 출처 밖 후보는 사용할 수 없으므로 현재 후보 하나로 확정된다
    const old = w.bundle!.itemRefs.find((ref) => ref.id === 'TEST_FIXTURE_MAPPING_T1_OLD')!;
    suspendItem(w.world.deps, TEST_FIXTURE_RV_SUSPENDER, old, 'TEST_FIXTURE 중지 사유');
    const next = await send(w, body);
    expect(next.called.text).toBe(first.called.text);
    expect(engineBundle(next).mappings.find((mapping) => mapping.id === 'TEST_FIXTURE_MAPPING_T1_OLD')!.state).toBe('SUSPENDED');
    expect(next.reads.getItemVersion).toBe(0);
    // 대조: 현재 후보(유일하게 사용 가능한 쪽)를 중지하면 그때는 보류된다
    const current = w.bundle!.itemRefs.find((ref) => ref.id === `TEST_FIXTURE_MAPPING_${T1}`)!;
    suspendItem(w.world.deps, TEST_FIXTURE_RV_SUSPENDER, current, 'TEST_FIXTURE 중지 사유');
    const held = await send(w, body);
    expect(verdict(held.body, T1)).toBe('MAPPING_INVALID');
    expect(held.body.result.state).toBe('ON_HOLD');
  });
});

describe('AC-011o 캐시된 뒤 서류 규칙 묶음의 상태가 바뀌면 금액은 그대로이고 documents 만 RULES_UNAVAILABLE 이다', () => {
  const CASES: Array<[string, (w: EstimateWorld, ref: ItemVersionRef) => void]> = [
    ['SUSPENDED (suspendItem)', (w, ref) => suspendItem(w.world.deps, TEST_FIXTURE_RV_SUSPENDER, ref, 'TEST_FIXTURE 중지 사유')],
    ['UNDER_REREVIEW (저장소 전이 기록)', underReReviewByRepository],
  ];

  it.each(CASES)('%s: 계산이 가능한 입력은 200 이고 result 는 그대로, documents 는 { state: "RULES_UNAVAILABLE" }, 버전 그대로', async (_label, change) => {
    const { w } = ready();
    const body = currentBody(w, { cause: 'INJURY' });
    const first = await send(w, body);
    expect(first.body.documents?.state).toBe('AVAILABLE');
    change(w, refOfKind(w.bundle!, 'DOCUMENT_RULE_SET'));
    const next = await send(w, body);
    expect(next.called.status).toBe(200);
    expect(next.body.result).toEqual(first.body.result);
    expect(next.body.result.state).toBe('ESTIMATED');
    expect(next.body.documents).toEqual({ state: 'RULES_UNAVAILABLE' });
    expect(next.body.versions).toEqual(first.body.versions);
    expect(next.reads.getItemVersion).toBe(0);
    expect(freshReadCounts(next.reads)).toEqual(FRESH_READS);
  });

  it('계산이 ON_HOLD 인 입력이면 서류 규칙 묶음을 중지하기 전에도 후에도 documents 는 null 이다', async () => {
    const { w } = ready();
    const body = currentBody(w, { generation: 'GEN1_AS' });
    const first = await send(w, body);
    expect(first.body.result.state).toBe('ON_HOLD');
    expect(first.body.documents).toBeNull();
    suspendItem(w.world.deps, TEST_FIXTURE_RV_SUSPENDER, refOfKind(w.bundle!, 'DOCUMENT_RULE_SET'), 'TEST_FIXTURE 중지 사유');
    const next = await send(w, body);
    expect(next.body.result.state).toBe('ON_HOLD');
    expect(next.body.documents).toBeNull();
  });
});

describe('AC-011p 같은 프로필 버전을 담은 두 묶음 X(병원 1)·Y(병원 2)가 캐시된 상태', () => {
  const CHANGES: Array<[string, string, (w: EstimateWorld, ref: ItemVersionRef) => void]> = [
    ['SUSPENDED', 'PROFILE_INVALID', (w, ref) => suspendItem(w.world.deps, TEST_FIXTURE_RV_SUSPENDER, ref, 'TEST_FIXTURE 중지 사유')],
    ['UNDER_REREVIEW', 'PROFILE_UNDER_REREVIEW', underReReviewByRepository],
  ];

  it.each(CHANGES)('(1) 프로필 %s: 두 병원의 다음 요청이 모두 %s 로 보류되고 두 병원이 가진 버전은 바뀌지 않는다', async (_label, code, change) => {
    const t = twoClinics();
    const bodyA = currentBody(t.w);
    const bodyB = clinic2Body(t);
    const beforeA = await send(t.w, bodyA);
    const beforeB = await send(t.w, bodyB, CLINIC_2_SLUG);
    expect([beforeA.body.result.state, beforeB.body.result.state]).toEqual(['ESTIMATED', 'ESTIMATED']);
    expect(t.cache.entries()).toHaveLength(2); // 두 묶음의 내용이 모두 캐시됐다

    change(t.w, refOfKind(t.w.bundle!, 'PROFILE'));

    const afterA = await send(t.w, bodyA);
    const afterB = await send(t.w, bodyB, CLINIC_2_SLUG);
    for (const sent of [afterA, afterB]) {
      expect(sent.called.status).toBe(200);
      expect(sent.body.result.state).toBe('ON_HOLD');
      expect(holdCodes(sent)).toEqual(new Set([code]));
      expect(sent.reads.getItemVersion).toBe(0);
    }
    expect(versionIds(afterA)).toEqual(versionIds(beforeA));
    expect(versionIds(afterB)).toEqual(versionIds(beforeB));
    expect(afterA.body.documents).toBeNull();
  });

  it('(2) 묶음 X 만 중지: 병원 2 는 ESTIMATED, 병원 1 은 RULE_BUNDLE_SUSPENDED 이고 중지는 프로필·매핑·서류 규칙 항목의 state 를 바꾸지 않는다 (저장소 직접 조회)', async () => {
    const t = twoClinics();
    const bodyA = currentBody(t.w);
    const bodyB = clinic2Body(t);
    const beforeA = await send(t.w, bodyA);
    const beforeB = await send(t.w, bodyB, CLINIC_2_SLUG);
    const refs = t.w.bundle!.itemRefs;
    const statesBefore = t.w.world.repo.readItemStates(refs);

    suspendRuleBundle(t.w.world.deps, TEST_FIXTURE_RV_SUSPENDER, t.w.bundle!.id, 'TEST_FIXTURE 중지 사유');

    const afterB = await send(t.w, bodyB, CLINIC_2_SLUG);
    expect(afterB.body.result.state).toBe('ESTIMATED');
    expect(afterB.called.text).toBe(beforeB.called.text);
    const afterA = await send(t.w, bodyA);
    expect(new Set(afterA.body.result.lines.map((line) => line.holdReason))).toEqual(new Set(['RULE_BUNDLE_SUSPENDED']));
    expect(afterA.body.versions).toEqual({ ...beforeA.body.versions, ruleBundleStatus: 'SUSPENDED', profile: null });
    expect(t.w.world.repo.readItemStates(refs)).toEqual(statesBefore);
    expect(statesBefore.map((state) => state!.state)).toEqual(['PUBLISHED', 'PUBLISHED', 'PUBLISHED', 'PUBLISHED', 'PUBLISHED']);
  });
});
