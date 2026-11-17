import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../src/app/api/clinics/[slug]/estimate/route';
import { approve, suspendItem } from '../../src/server/approval';
import { createBundleContentCache } from '../../src/server/api/bundle-content-cache';
import type { BundleContentCache } from '../../src/server/api/bundle-content-cache';
import { suspendRuleBundle } from '../../src/server/bundle-status';
import { assignRuleScope } from '../../src/server/rule-scope';
import { publishCatalog } from '../../src/server/catalog-publish';
import { TEST_FIXTURE_CLINIC_ID, TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1 } from '../fixtures/server/actors.fixture';
import { CLINIC_1_SLUG, CLINIC_2_SLUG, createTestServices, suspendBundle, useTestServices } from '../fixtures/server/api-composition.fixture';
import { BASE_FEE_ID, T1, T2 } from '../fixtures/server/base-fee.fixture';
import { makeClinic, makeTreatment, makeTreatmentVersion } from '../fixtures/server/entities.fixture';
import { FULL_HOSPITAL_PAYMENT, GEN, INSURER } from '../fixtures/server/estimate-world.fixture';
import { TEST_CATALOG_CONFIG } from '../fixtures/server/publish.fixture';
import { TEST_FIXTURE_RV_SUSPENDER } from '../fixtures/server/governance.fixture';
import { A1, A2, REAPPROVAL_AT, REAPPROVAL_TARGETS, cacheBundle, composeFromCache, copyStates, estimateWithBundle, verdictOf } from '../fixtures/server/reapproval.fixture';
import { publishRefs } from '../fixtures/server/versioning.fixture';
import { FRESH_READS, NO_CACHE, clinic2Body, countingCache, currentBody, engineBundle, engineMapping, estimateSpy, freshReadCounts, lineOf, mappingRefFor, ready, refOfKind, refsOf, send, twoClinics, verdict } from './cache-contract-helpers';
import { expectNoStoreJson, serve } from './estimate-helpers';
import { collectKeys } from './helpers';
import { callPost } from './post-helpers';

// 캐시 적중 계약 여덟 조건 (M4.C, plan.md M4 "필수 검증·시험: 캐시 적중 계약", design.md DD-14 "항목 생명주기 상태와 캐시 계약"·DD-15, AC-011m).
// 모든 시험은 실제 route.ts 의 POST 를 지나고, 항목 상태는 도메인 서비스로만 바꾼다(저장소에 직접 쓰지 않는다. 예외는 AC-011m 파일에 따로 밝힌다).
// 캐시는 서비스 구성(ApiServices.bundleCache)이 들고 있고 시험 구성이 호출을 세는 감싸개를 넣는다. 엔진은 실제 함수를 감싼 통과형 감시로 입력을 본다.
// 읽기 횟수는 메모리 저장소의 읽기 감시(repo.spy)로 요청 한 번 단위로 센다.

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

const ITEMS_IN_BUNDLE = 5; // 프로필 1 + 매핑 3 + 서류 규칙 묶음 1

describe('(1) 캐시 적중은 상태가 바뀌지 않은 요청의 응답을 바꾸지 않는다', () => {
  const VARIANTS: Array<[string, Record<string, unknown>]> = [
    ['기본 요청', {}],
    ['원인 INJURY', { cause: 'INJURY' }],
    ['원인 ILLNESS', { cause: 'ILLNESS' }],
    ['치료 하나(T1)', { treatmentIds: [T1] }],
    ['치료 하나(T2)', { treatmentIds: [T2] }],
    ['칸에 프로필이 없는 세대(보류)', { generation: 'GEN1_AS' }],
    ['다른 보험사 형태(보류)', { insurerType: 'LIFE' }],
  ];

  it.each(VARIANTS)('%s: 첫 요청(미적중), 둘째 요청(적중), 캐시 없는 서버의 응답이 바이트까지 같다', async (_label, overrides) => {
    const { w, calls } = ready();
    const body = currentBody(w, overrides);
    // 기준: 캐시를 쓰지 않는 서버 (같은 저장소, 읽기만 하므로 상태가 바뀌지 않는다)
    useTestServices(createTestServices({ repo: w.world.repo, bundleCache: NO_CACHE }));
    const reference = await send(w, body);
    // 캐시를 쓰는 서버
    const { cache, calls: cached } = countingCache();
    serve(w, { bundleCache: cache });
    const miss = await send(w, body);
    const hit = await send(w, body);
    expect(miss.called.status).toBe(200);
    expect(miss.called.text).toBe(reference.called.text);
    expect(hit.called.text).toBe(miss.called.text);
    expect(cached).toEqual({ lookups: 2, hits: 1, stores: 1 });
    expect(miss.reads.getItemVersion).toBe(ITEMS_IN_BUNDLE);
    expect(hit.reads.getItemVersion).toBe(0);
    expect(calls.lookups).toBe(0);
  });

  it('적중한 요청이 엔진에 넘기는 묶음 스냅샷은 미적중 요청의 것과 깊이 같다', async () => {
    const { w } = ready();
    const body = currentBody(w);
    const miss = await send(w, body);
    const hit = await send(w, body);
    expect(engineBundle(hit)).toEqual(engineBundle(miss));
    expect(engineBundle(hit)).not.toBe(engineBundle(miss));
  });

  it('연속 요청 여러 건(원인·치료 조합이 다름)이 캐시에 항목을 더하지 않는다: 첫 요청 뒤 항목은 하나로 고정이다', async () => {
    const { w, cache, calls } = ready();
    for (const overrides of [{}, { cause: 'INJURY' }, { treatmentIds: [T1] }, { generation: 'GEN1_AS' }, { insurerType: 'LIFE' }, { cause: 'ILLNESS', treatmentIds: [T2] }]) {
      expect((await send(w, currentBody(w, overrides))).called.status).toBe(200);
    }
    expect(calls).toEqual({ lookups: 6, hits: 5, stores: 1 });
    expect(cache.entries()).toHaveLength(1);
  });
});

describe('(2) 상태·승인자·승인 지문과 묶음 가용성은 내용 캐시에서 가져오지 않는다', () => {
  it('캐시에 담긴 것에는 네 값의 자리가 없다: 어느 깊이에도 state·approver·approvedFingerprint·status 키가 없다', async () => {
    const { w, cache } = ready();
    await send(w, currentBody(w));
    const keys = collectKeys(cache.entries());
    for (const forbidden of ['state', 'approver', 'approvedFingerprint', 'status', 'ruleBundleStatus']) {
      expect(keys.has(forbidden), forbidden).toBe(false);
    }
  });

  it('캐시가 가짜 state·approver·approvedFingerprint·status 를 내용에 실어 돌려줘도 엔진 입력은 저장소의 값이다', async () => {
    const { w } = ready();
    const real = createBundleContentCache();
    // 오염된 캐시: 적중하면 내용 기록마다 가짜 상태 값을, 묶음 객체에는 가짜 가용성 값을 얹어 돌려준다.
    const poisoned: BundleContentCache = {
      lookup(id, hash) {
        const found = real.lookup(id, hash);
        if (found === null) return null;
        const copy = structuredClone(found) as Record<string, unknown> & typeof found;
        for (const record of [...copy.profiles, ...copy.mappings, copy.documentRuleSet!]) {
          Object.assign(record.content, { state: 'SUSPENDED', approver: { approverId: 'TEST_FIXTURE_FROM_CACHE', approvedAt: 'TEST_FIXTURE_FROM_CACHE' } });
          if (record.ref.kind === 'MAPPING') {
            Object.assign(record.content, { approvedFingerprint: 'TEST_FIXTURE_FP_FROM_CACHE' });
          }
        }
        Object.assign(copy, { status: 'SUSPENDED', ruleBundleStatus: 'SUSPENDED' });
        return copy;
      },
      store: (content) => real.store(content),
      entries: () => real.entries(),
    };
    serve(w, { bundleCache: poisoned });
    const body = currentBody(w);
    const first = await send(w, body); // 미적중: 저장소에서 읽는다
    const second = await send(w, body); // 적중: 오염된 사본
    expect(second.called.text).toBe(first.called.text);
    expect(second.body.result.state).toBe('ESTIMATED');
    expect(second.body.versions.ruleBundleStatus).toBe('ACTIVE');
    const bundle = engineBundle(second);
    expect(bundle.status).toBe('ACTIVE');
    expect(bundle.profiles[0]!.state).toBe('PUBLISHED');
    expect(bundle.profiles[0]!.approver?.approverId).toBe('TEST_FIXTURE_RV_APPROVER');
    const mapping = engineMapping(second, T1);
    expect(mapping.state).toBe('PUBLISHED');
    expect(mapping.approver?.approverId).toBe('TEST_FIXTURE_RV_APPROVER');
    expect(mapping.approvedFingerprint).toBe(w.world.repo.readItemStates([mappingRefFor(w, T1)])[0]!.approvedFingerprint);
    expect(JSON.stringify(second.engineInput)).not.toContain('FROM_CACHE');
  });

  it('상태는 요청마다 저장소에서 온다: 캐시에 든 항목 객체는 그대로(같은 참조)인데 다음 요청의 엔진 입력은 바뀐 상태를 싣는다', async () => {
    const { w, cache } = ready();
    const body = currentBody(w);
    const before = await send(w, body);
    const entryBefore = cache.entries()[0]!;
    expect(engineBundle(before).profiles[0]!.state).toBe('PUBLISHED');
    suspendItem(w.world.deps, TEST_FIXTURE_RV_SUSPENDER, refOfKind(w.bundle!, 'PROFILE'), 'TEST_FIXTURE 중지 사유');
    const after = await send(w, body);
    expect(engineBundle(after).profiles[0]!.state).toBe('SUSPENDED');
    expect(cache.entries()[0]).toBe(entryBefore);
    expect(after.reads.getItemVersion).toBe(0);
  });

  it('가용성도 요청마다 저장소에서 온다: 묶음을 중지하면 캐시가 따뜻해도 다음 요청이 중지로 보류된다', async () => {
    const { w } = ready();
    const body = currentBody(w);
    expect((await send(w, body)).body.versions.ruleBundleStatus).toBe('ACTIVE');
    suspendBundle(w.world, w.bundle!.id);
    const after = await send(w, body);
    expect(after.body.versions.ruleBundleStatus).toBe('SUSPENDED');
    expect(after.body.result.state).toBe('ON_HOLD');
    expect(new Set(after.body.result.lines.map((line) => line.holdReason))).toEqual(new Set(['RULE_BUNDLE_SUSPENDED']));
  });
});

describe('(3) 내용이 적중이어도 요청마다 (사용한 묶음당) 항목 상태 읽기가 정확히 한 번이고 가용성도 읽는다', () => {
  it('미적중 요청과 적중 요청 모두: 규칙 범위 1, 가용성 1, 항목 상태 읽기 1, 항목별 상태 조회 0. 항목 내용은 미적중 5, 적중 0', async () => {
    const { w } = ready();
    const body = currentBody(w);
    const miss = await send(w, body);
    const hit = await send(w, body);
    expect(freshReadCounts(miss.reads)).toEqual(FRESH_READS);
    expect(freshReadCounts(hit.reads)).toEqual(FRESH_READS);
    expect([miss.reads.getItemVersion, hit.reads.getItemVersion]).toEqual([ITEMS_IN_BUNDLE, 0]);
    expect([miss.reads.getRuleBundleVersion, hit.reads.getRuleBundleVersion]).toEqual([1, 1]);
  });

  it('같은 요청을 다섯 번 보내면 항목 상태 읽기도 가용성 읽기도 정확히 다섯 번이다 (적중이 읽기를 건너뛰게 하지 않는다)', async () => {
    const { w } = ready();
    const body = currentBody(w);
    w.world.repo.spy.reset();
    for (let i = 0; i < 5; i += 1) {
      expect((await callPost(POST, CLINIC_1_SLUG, body)).status).toBe(200);
    }
    expect(w.world.repo.spy.counts.readItemStates).toBe(5);
    expect(w.world.repo.spy.counts.getBundleStatus).toBe(5);
    expect(w.world.repo.spy.counts.getItemVersion).toBe(ITEMS_IN_BUNDLE);
  });

  it('읽는 항목 상태는 그 묶음이 담은 참조 전부다: 프로필 → 매핑 → 서류 규칙 묶음 순서로 한 번에 읽는다', async () => {
    const { w } = ready();
    const readSpy = vi.spyOn(w.world.repo, 'readItemStates');
    await send(w, currentBody(w));
    await send(w, currentBody(w));
    expect(readSpy).toHaveBeenCalledTimes(2);
    for (const [refs] of readSpy.mock.calls) {
      expect(refs.map((ref) => ref.kind)).toEqual(['PROFILE', 'MAPPING', 'MAPPING', 'MAPPING', 'DOCUMENT_RULE_SET']);
    }
    readSpy.mockRestore();
  });

  it('병원 둘이 각자 다른 묶음을 쓰면 요청마다 그 요청이 쓴 묶음 하나에 대해 정확히 한 번 읽는다', async () => {
    const t = twoClinics();
    const first = await send(t.w, currentBody(t.w));
    const second = await send(t.w, clinic2Body(t), CLINIC_2_SLUG);
    expect(first.called.status).toBe(200);
    expect(second.called.status).toBe(200);
    expect(freshReadCounts(first.reads)).toEqual(FRESH_READS);
    expect(freshReadCounts(second.reads)).toEqual(FRESH_READS);
    // 둘 다 캐시가 따뜻하면 항목 내용은 읽지 않는다
    const again = await send(t.w, clinic2Body(t), CLINIC_2_SLUG);
    expect(freshReadCounts(again.reads)).toEqual(FRESH_READS);
    expect(again.reads.getItemVersion).toBe(0);
  });

  it('규칙 사용 범위가 없는 병원은 캐시가 따뜻해도 200 ON_HOLD CLINIC_RULE_SCOPE_ABSENT 이고 묶음 내용·묶음 기록·가용성·항목 상태를 읽지 않으며 캐시도 조회하지 않는다', async () => {
    const t = twoClinics();
    await send(t.w, currentBody(t.w)); // 캐시를 채운다
    const lookupsBefore = t.calls.lookups;
    // 병원 3: 카탈로그는 게시했지만 규칙 사용 범위를 지정한 적이 없다
    const { world } = t.w;
    world.repo.saveClinic(makeClinic({ id: 'TEST_FIXTURE_CLINIC_3', slug: 'test-fixture-clinic-3' }));
    world.repo.saveTreatment(makeTreatment({ id: 'TEST_FIXTURE_TREATMENT_C3', clinicId: 'TEST_FIXTURE_CLINIC_3' }));
    const catalog3 = publishCatalog(
      world.deps,
      TEST_FIXTURE_HA_1,
      'TEST_FIXTURE_CLINIC_3',
      { treatmentVersions: [makeTreatmentVersion({ id: 'TEST_FIXTURE_TV_C3', treatmentId: 'TEST_FIXTURE_TREATMENT_C3', patientAmount: 12_000 })], commonBaseFees: [] },
      TEST_CATALOG_CONFIG,
    );
    const body = { catalogVersion: catalog3.id, ruleBundleVersion: null, generation: GEN, insurerType: INSURER, cause: 'UNKNOWN', treatmentIds: ['TEST_FIXTURE_TREATMENT_C3'] };
    const noScope = await send(t.w, body, 'test-fixture-clinic-3');
    expect(noScope.called.status).toBe(200);
    expect(noScope.body.versions).toEqual({ catalogVersion: catalog3.id, ruleBundleVersion: null, ruleBundleStatus: null, profile: null });
    expect(new Set(noScope.body.result.lines.map((line) => line.holdReason))).toEqual(new Set(['CLINIC_RULE_SCOPE_ABSENT']));
    expect([noScope.reads.readItemStates, noScope.reads.getItemVersion, noScope.reads.getRuleBundleVersion, noScope.reads.getItemState, noScope.reads.getBundleStatus]).toEqual([0, 0, 0, 0, 0]);
    expect(noScope.reads.getClinicRuleScope).toBe(1);
    expect(t.calls.lookups).toBe(lookupsBefore);
  });

  it('중지된 묶음, 버전 불일치(409), 치료 미게시(422)는 캐시가 따뜻해도 묶음 내용·항목 상태를 읽지 않고 캐시도 조회하지 않는다', async () => {
    const t = twoClinics();
    await send(t.w, currentBody(t.w)); // 캐시를 채운다
    const lookupsBefore = t.calls.lookups;
    const readNothing = (reads: Record<string, number>) => [reads.readItemStates, reads.getItemVersion, reads.getRuleBundleVersion, reads.getItemState];

    const stale = await send(t.w, currentBody(t.w, { catalogVersion: 'TEST_FIXTURE_OLD' }));
    expect(stale.called.status).toBe(409);
    expect(readNothing(stale.reads)).toEqual([0, 0, 0, 0]);

    const unpublished = await send(t.w, currentBody(t.w, { treatmentIds: ['TEST_FIXTURE_NO_SUCH'] }));
    expect(unpublished.called.status).toBe(422);
    expect(readNothing(unpublished.reads)).toEqual([0, 0, 0, 0]);

    suspendBundle(t.w.world, t.y.id);
    const suspended = await send(t.w, clinic2Body(t), CLINIC_2_SLUG);
    expect(suspended.called.status).toBe(200);
    expect(suspended.body.result.state).toBe('ON_HOLD');
    expect(readNothing(suspended.reads)).toEqual([0, 0, 0, 0]);
    expect(suspended.reads.getBundleStatus).toBe(1);

    expect(t.calls.lookups).toBe(lookupsBefore);
  });
});

describe.each(REAPPROVAL_TARGETS)('재승인 시나리오 (4)(5)(6): $name', (target) => {
  /** 캐시를 채운 첫 요청 → 보장 판단 필드가 바뀐 버전 게시(재검토 전환) → 다른 RV(A2)의 재승인. 범위는 계속 원래 묶음 X 를 가리킨다. */
  async function warmedAndReapproved() {
    const ctx = ready();
    const { w } = ctx;
    const ref = mappingRefFor(w, target.lineId);
    const first = await send(w, currentBody(w));
    expect(first.body.result.state).toBe('ESTIMATED');
    const staleStates = copyStates(w.world.repo, w.bundle!.itemRefs); // 변경 전 상태 사본: PUBLISHED · A1 · F1
    const entry = ctx.cache.entries()[0]!;
    const f2 = target.publishJudgementChange(w.world);
    const duringReview = await send(w, currentBody(w));
    w.world.clock.set(REAPPROVAL_AT);
    approve(w.world.deps, A2, ref);
    return { ...ctx, ref, first, staleStates, entry, f2, duringReview };
  }

  it('시험 전제: 변경 전 지문 F1 과 변경 후 지문 F2 는 다르고, 재검토 중 요청은 MAPPING_UNDER_REREVIEW 로 보류된다 (캐시 적중, 상태는 새로 읽음)', async () => {
    const s = await warmedAndReapproved();
    expect(s.f2).not.toBe(target.fingerprintBefore);
    expect(s.duringReview.called.status).toBe(200);
    expect(verdict(s.duringReview.body, target.lineId)).toBe('MAPPING_UNDER_REREVIEW');
    expect(s.duringReview.reads.getItemVersion).toBe(0);
    expect(s.duringReview.reads.readItemStates).toBe(1);
    expect(engineMapping(s.duringReview, target.lineId).state).toBe('UNDER_REREVIEW');
  });

  it('(5) 재승인과 그 게시 사이: 200, 그 줄이 ON_HOLD · MAPPING_UNREVIEWED (매핑 상태 APPROVED), 묶음 id·내용 해시는 그대로, 409 아님', async () => {
    const s = await warmedAndReapproved();
    const between = await send(s.w, currentBody(s.w));
    expect(between.called.status).toBe(200);
    const line = lineOf(between.body, target.lineId);
    expect([line.state, line.holdReason]).toEqual(['ON_HOLD', 'MAPPING_UNREVIEWED']);
    expect(between.body.result.state).toBe('ON_HOLD');
    expect(between.body.result.amounts.expectedInsurancePayout).toBeNull();
    expect(between.body.result.amounts.hospitalPayment).toBe(FULL_HOSPITAL_PAYMENT);
    // 다른 줄은 영향이 없다
    for (const other of [T1, T2, BASE_FEE_ID].filter((id) => id !== target.lineId)) {
      expect(verdict(between.body, other), other).toBe('ESTIMATED');
    }
    // 저장소의 현재 상태와 엔진이 받은 값
    expect(s.w.world.repo.readItemStates([s.ref])[0]).toMatchObject({ state: 'APPROVED', approver: { approverId: A2.id, approvedAt: REAPPROVAL_AT } });
    const mapping = engineMapping(between, target.lineId);
    expect([mapping.state, mapping.approver?.approverId, mapping.approvedFingerprint]).toEqual(['APPROVED', A2.id, s.f2]);
    // 버전은 그대로: 묶음 id·내용 해시
    expect(between.body.versions.ruleBundleVersion).toBe(s.w.bundle!.id);
    expect(engineBundle(between).id).toBe(s.w.bundle!.id);
    expect(engineBundle(between).contentHash).toBe(s.w.bundle!.contentHash);
    expect(between.reads.getItemVersion).toBe(0);
  });

  it('(4) 재승인과 그 매핑을 담은 묶음 게시 뒤, 범위가 원래 묶음을 가리키는 동안: 200, 같은 묶음 id·내용 해시, 409 없음, 캐시 무효화·재적재 없음, 엔진은 새 승인자·새 지문을 쓴다', async () => {
    const s = await warmedAndReapproved();
    const published = publishRefs(s.w.world, refsOf(s.w.bundle!)); // 같은 항목 참조의 새 묶음 X2: APPROVED 였던 매핑이 PUBLISHED 로 돌아온다
    expect(published.id).not.toBe(s.w.bundle!.id);
    expect(s.w.world.repo.getClinicRuleScope(TEST_FIXTURE_CLINIC_ID)?.ruleBundleVersionId).toBe(s.w.bundle!.id);

    const after = await send(s.w, currentBody(s.w));
    expect(after.called.status).toBe(200);
    expect(after.called.status).not.toBe(409);
    expect(after.body.versions.ruleBundleVersion).toBe(s.w.bundle!.id);
    expect(engineBundle(after).id).toBe(s.w.bundle!.id);
    expect(engineBundle(after).contentHash).toBe(s.w.bundle!.contentHash);
    const mapping = engineMapping(after, target.lineId);
    expect([mapping.state, mapping.approver?.approverId, mapping.approver?.approvedAt, mapping.approvedFingerprint]).toEqual(['PUBLISHED', A2.id, REAPPROVAL_AT, s.f2]);
    expect(mapping.approver?.approverId).not.toBe(A1.id);
    expect(mapping.approvedFingerprint).not.toBe(target.fingerprintBefore);
    expect(after.body.result.state).toBe('ESTIMATED');
    expect(verdict(after.body, target.lineId)).toBe('ESTIMATED');

    // 캐시 무효화 호출도 재적재도 없다: 저장은 처음 한 번뿐이고 항목은 처음 그 객체다 (캐시에는 무효화 이름 자체가 없다)
    expect(s.calls.stores).toBe(1);
    expect(s.cache.entries()).toHaveLength(1);
    expect(s.cache.entries()[0]).toBe(s.entry);
    expect(Object.keys(s.cache).sort()).toEqual(['entries', 'lookup', 'store']);
    expect(after.reads.getItemVersion).toBe(0);
    expect(freshReadCounts(after.reads)).toEqual(FRESH_READS);
  });

  it('(6) 요청보다 오래된 상태 사본을 쓰면 실패한다: 재승인 전 사본(PUBLISHED · A1 · F1)은 MAPPING_UNDER_REREVIEW 를 내지만 새로 읽은 상태는 ESTIMATED 를 낸다', async () => {
    const s = await warmedAndReapproved();
    publishRefs(s.w.world, refsOf(s.w.bundle!));
    const after = await send(s.w, currentBody(s.w));

    // 낡은 사본이 무엇을 내는지 엔진으로 직접 확인한다 (같은 캐시 내용 + 변경 전 상태 사본)
    const staleMapping = composeFromCache(s.w.world.repo, cacheBundle(s.w.world.repo, s.w.bundle!.id), s.staleStates).mappings.find((mapping) => mapping.treatmentId === target.lineId)!;
    expect([staleMapping.state, staleMapping.approver?.approverId, staleMapping.approvedFingerprint]).toEqual(['PUBLISHED', A1.id, target.fingerprintBefore]);
    const staleVerdict = verdictOf(estimateWithBundle(s.w.world, composeFromCache(s.w.world.repo, cacheBundle(s.w.world.repo, s.w.bundle!.id), s.staleStates)), target.lineId);
    expect(staleVerdict).toBe('MAPPING_UNDER_REREVIEW');

    // 응답은 낡은 사본의 결과가 아니라 새로 읽은 상태의 결과다
    expect(verdict(after.body, target.lineId)).toBe('ESTIMATED');
    expect(verdict(after.body, target.lineId)).not.toBe(staleVerdict);
    expect(after.body.result.state).toBe('ESTIMATED');
    expect(after.called.text).not.toContain('MAPPING_UNDER_REREVIEW');
    expect(engineMapping(after, target.lineId).approvedFingerprint).toBe(s.f2);
    expect(engineMapping(after, target.lineId).approvedFingerprint).not.toBe(staleMapping.approvedFingerprint);
  });

  it('(6) 재승인 직후 게시 전에도 낡은 사본의 결과가 아니다: 새 상태는 MAPPING_UNREVIEWED, 낡은 사본은 MAPPING_UNDER_REREVIEW', async () => {
    const s = await warmedAndReapproved();
    const between = await send(s.w, currentBody(s.w));
    const staleVerdict = verdictOf(estimateWithBundle(s.w.world, composeFromCache(s.w.world.repo, cacheBundle(s.w.world.repo, s.w.bundle!.id), s.staleStates)), target.lineId);
    expect(staleVerdict).toBe('MAPPING_UNDER_REREVIEW');
    expect(verdict(between.body, target.lineId)).toBe('MAPPING_UNREVIEWED');
  });

  it('재승인은 자동 게시되지 않는다: 요청을 아무리 보내도 매핑은 APPROVED 에 머물고 묶음이 새로 게시되기 전에는 게시 기록이 늘지 않는다', async () => {
    const s = await warmedAndReapproved();
    const refsBefore = s.w.world.repo.listRuleBundleVersions().map((bundle) => bundle.id);
    const historyBefore = s.w.world.repo.getItemState(s.ref)!.history.map((entry) => entry.to);
    for (let i = 0; i < 3; i += 1) {
      await send(s.w, currentBody(s.w));
    }
    expect(s.w.world.repo.listRuleBundleVersions().map((bundle) => bundle.id)).toEqual(refsBefore);
    expect(s.w.world.repo.getItemState(s.ref)!.history.map((entry) => entry.to)).toEqual(historyBefore);
    expect(historyBefore.at(-1)).toBe('APPROVED');
    expect(s.w.world.repo.readItemStates([s.ref])[0]!.state).toBe('APPROVED');
    // 게시하면 그 다음에야 PUBLISHED 로 돌아온다
    publishRefs(s.w.world, refsOf(s.w.bundle!));
    expect(s.w.world.repo.readItemStates([s.ref])[0]!.state).toBe('PUBLISHED');
  });
});

describe('(7) 같은 항목 버전을 담은 두 묶음은 같은 항목 상태를 돌려주고, 도메인 서비스로 바꾼 상태는 두 병원의 다음 요청에 모두 반영된다', () => {
  it('두 병원이 서로 다른 묶음(X, Y)을 쓰고 공유한 프로필·서류 규칙 묶음의 상태·승인자가 엔진 입력에서 같다', async () => {
    const t = twoClinics();
    const a = await send(t.w, currentBody(t.w));
    const b = await send(t.w, clinic2Body(t), CLINIC_2_SLUG);
    expect([a.called.status, b.called.status]).toEqual([200, 200]);
    expect(a.body.result.state).toBe('ESTIMATED');
    expect(b.body.result.state).toBe('ESTIMATED');
    expect(engineBundle(a).id).toBe(t.w.bundle!.id);
    expect(engineBundle(b).id).toBe(t.y.id);
    expect(engineBundle(a).profiles).toEqual(engineBundle(b).profiles);
    expect(engineBundle(a).documentRuleSet).toEqual(engineBundle(b).documentRuleSet);
    expect(t.cache.entries().map((entry) => entry.bundleId).sort()).toEqual([t.w.bundle!.id, t.y.id].sort());
  });

  it('공유한 프로필을 도메인 서비스로 중지하면 두 병원의 다음 요청이 모두 PROFILE_INVALID 로 보류되고, 캐시는 무효화 없이 그대로다', async () => {
    const t = await (async () => {
      const x = twoClinics();
      await send(x.w, currentBody(x.w));
      await send(x.w, clinic2Body(x), CLINIC_2_SLUG);
      return x;
    })();
    const entries = t.cache.entries();
    const storesBefore = t.calls.stores;
    suspendItem(t.w.world.deps, TEST_FIXTURE_RV_SUSPENDER, refOfKind(t.w.bundle!, 'PROFILE'), 'TEST_FIXTURE 중지 사유');

    const a = await send(t.w, currentBody(t.w));
    const b = await send(t.w, clinic2Body(t), CLINIC_2_SLUG);
    for (const sent of [a, b]) {
      expect(sent.called.status).toBe(200);
      expect(sent.body.result.state).toBe('ON_HOLD');
      expect(new Set(sent.body.result.lines.map((line) => line.holdReason))).toEqual(new Set(['PROFILE_INVALID']));
      expect(sent.body.versions.ruleBundleStatus).toBe('ACTIVE');
      expect(engineBundle(sent).profiles[0]!.state).toBe('SUSPENDED');
      expect(freshReadCounts(sent.reads)).toEqual(FRESH_READS);
      expect(sent.reads.getItemVersion).toBe(0);
    }
    expect([a.body.versions.ruleBundleVersion, b.body.versions.ruleBundleVersion]).toEqual([t.w.bundle!.id, t.y.id]);
    expect(t.calls.stores).toBe(storesBefore);
    expect(t.cache.entries()).toEqual(entries);
    expect(t.cache.entries()[0]).toBe(entries[0]);
  });

  it('같은 항목 참조·같은 내용 해시의 두 묶음(X, X2)은 캐시에서 서로 다른 항목이고 같은 항목 상태(재승인자 A2 · 새 지문)를 돌려준다', async () => {
    const ctx = ready();
    const { w } = ctx;
    const ref = mappingRefFor(w, T1);
    const target = REAPPROVAL_TARGETS[0]!;
    await send(w, currentBody(w));
    const f2 = target.publishJudgementChange(w.world);
    w.world.clock.set(REAPPROVAL_AT);
    approve(w.world.deps, A2, ref);
    const x2 = publishRefs(w.world, refsOf(w.bundle!));
    assignRuleScope(w.world.deps, TEST_FIXTURE_PO_1, TEST_FIXTURE_CLINIC_ID, x2.id);

    const onX2 = await send(w, currentBody(w, {}, x2));
    expect(onX2.called.status).toBe(200);
    expect(onX2.body.versions.ruleBundleVersion).toBe(x2.id);
    expect(onX2.body.result.state).toBe('ESTIMATED');
    expect(ctx.cache.entries().map((entry) => [entry.bundleId, entry.contentHash]).sort()).toEqual(
      [
        [w.bundle!.id, w.bundle!.contentHash],
        [x2.id, w.bundle!.contentHash],
      ].sort(),
    );
    const mapping = engineMapping(onX2, T1);
    expect([mapping.state, mapping.approver?.approverId, mapping.approvedFingerprint]).toEqual(['PUBLISHED', A2.id, f2]);
    // 범위를 옮기기 전의 묶음 X 로 보낸 요청은 409 (범위가 바뀌었다). 항목 상태 때문이 아니라 범위 변경 때문이다.
    expect((await send(w, currentBody(w))).called.status).toBe(409);
  });
});

describe('(8) 묶음 중지는 그 묶음의 가용성만 바꾼다', () => {
  it('묶음 X 를 중지해도 항목 상태·승인자·지문·이력은 그대로이고, X 를 쓰는 병원만 보류되며 같은 프로필을 담은 다른 묶음 Y 의 병원은 영향이 없다', async () => {
    const t = twoClinics();
    await send(t.w, currentBody(t.w));
    await send(t.w, clinic2Body(t), CLINIC_2_SLUG);
    const refs = [...t.w.bundle!.itemRefs, ...t.y.itemRefs];
    const statesBefore = t.w.world.repo.readItemStates(refs);
    const historyBefore = refs.map((ref) => t.w.world.repo.getItemState(ref)!.history);
    const entries = t.cache.entries();
    const storesBefore = t.calls.stores;

    suspendRuleBundle(t.w.world.deps, TEST_FIXTURE_RV_SUSPENDER, t.w.bundle!.id, 'TEST_FIXTURE 중지 사유');

    // 저장소 직접 조회: 항목 쪽은 아무것도 바뀌지 않았고, 가용성만 바뀌었다
    expect(t.w.world.repo.readItemStates(refs)).toEqual(statesBefore);
    expect(refs.map((ref) => t.w.world.repo.getItemState(ref)!.history)).toEqual(historyBefore);
    expect(t.w.world.repo.getBundleStatus(t.w.bundle!.id)).toBe('SUSPENDED');
    expect(t.w.world.repo.getBundleStatus(t.y.id)).toBe('ACTIVE');

    // X 를 쓰는 병원: 보류. 캐시가 따뜻해도 묶음 내용·항목 상태를 읽지 않는다
    const a = await send(t.w, currentBody(t.w));
    expect(a.called.status).toBe(200);
    expect(a.body.versions).toMatchObject({ ruleBundleVersion: t.w.bundle!.id, ruleBundleStatus: 'SUSPENDED' });
    expect(new Set(a.body.result.lines.map((line) => line.holdReason))).toEqual(new Set(['RULE_BUNDLE_SUSPENDED']));
    expect([a.reads.readItemStates, a.reads.getItemVersion, a.reads.getRuleBundleVersion]).toEqual([0, 0, 0]);

    // Y 를 쓰는 병원: 영향 없음. 공유한 프로필은 여전히 PUBLISHED
    const b = await send(t.w, clinic2Body(t), CLINIC_2_SLUG);
    expect(b.called.status).toBe(200);
    expect(b.body.result.state).toBe('ESTIMATED');
    expect(b.body.versions).toMatchObject({ ruleBundleVersion: t.y.id, ruleBundleStatus: 'ACTIVE' });
    expect(engineBundle(b).profiles[0]!.state).toBe('PUBLISHED');
    expect(freshReadCounts(b.reads)).toEqual(FRESH_READS);

    // 캐시는 무효화·재적재 없이 그대로다
    expect(t.calls.stores).toBe(storesBefore);
    expect(t.cache.entries()).toEqual(entries);
  });
});

describe('응답의 Cache-Control: no-store(HTTP 계층)와 서버 안의 바뀌지 않는 묶음 내용 캐시는 서로 다른 것이다', () => {
  it('적중 응답도 no-store 인데 서버 안에는 묶음 내용 캐시가 실제로 채워져 있고, 그 안에는 요청·응답에서 온 것이 없다', async () => {
    const { w, cache } = ready();
    const body = currentBody(w);
    const first = await send(w, body);
    const second = await send(w, body);
    for (const sent of [first, second]) {
      expectNoStoreJson(sent.called);
      expect(sent.called.headers.get('cache-control')).toBe('no-store');
    }
    // 서버 내부 캐시: 있다 (HTTP no-store 와 상관없이 묶음 내용을 들고 있다)
    expect(cache.entries()).toHaveLength(1);
    expect(cache.entries()[0]).toMatchObject({ bundleId: w.bundle!.id, contentHash: w.bundle!.contentHash });
    // 그리고 담은 것은 바뀌지 않는 묶음 내용뿐이다: 응답 본문의 어떤 값(금액·줄·서류·versions)도 캐시에 없다
    const dump = JSON.stringify(cache.entries());
    expect(dump).not.toContain('hospitalPayment');
    expect(dump).not.toContain('expectedInsurancePayout');
    expect(dump).not.toContain(w.catalog.id);
    expect(Object.keys(first.body.result.amounts).some((key) => dump.includes(`"${key}"`))).toBe(false);
  });

  it('409·422 응답도 no-store 이고 캐시를 건드리지 않는다', async () => {
    const { w, cache, calls } = ready();
    const stale = await callPost(POST, CLINIC_1_SLUG, currentBody(w, { catalogVersion: 'TEST_FIXTURE_OLD' }));
    const unpublished = await callPost(POST, CLINIC_1_SLUG, currentBody(w, { treatmentIds: ['TEST_FIXTURE_NO_SUCH'] }));
    expect([stale.status, unpublished.status]).toEqual([409, 422]);
    for (const called of [stale, unpublished]) {
      expectNoStoreJson(called);
    }
    expect(calls).toEqual({ lookups: 0, hits: 0, stores: 0 });
    expect(cache.entries()).toEqual([]);
  });
});

describe('캐시 크기: 항목의 수는 게시된 묶음 버전의 수이고 요청 값으로는 늘지 않는다', () => {
  it('서로 다른 catalogVersion·ruleBundleVersion 값을 가진 요청 40건(모두 409)이 캐시에 항목을 만들지 않는다', async () => {
    const { w, cache, calls } = ready();
    for (let i = 0; i < 40; i += 1) {
      const called = await callPost(POST, CLINIC_1_SLUG, currentBody(w, { catalogVersion: `TEST_FIXTURE_MARK_CATALOG_${i}`, ruleBundleVersion: `TEST_FIXTURE_MARK_BUNDLE_${i}` }));
      expect(called.status).toBe(409);
    }
    expect(cache.entries()).toEqual([]);
    expect(calls).toEqual({ lookups: 0, hits: 0, stores: 0 });
  });

  it('올바른 요청이 쓰는 묶음이 둘이면 항목도 둘이다 (병원이 몇 개든 묶음 버전 수만큼)', async () => {
    const t = twoClinics();
    for (let i = 0; i < 5; i += 1) {
      await send(t.w, currentBody(t.w));
      await send(t.w, clinic2Body(t), CLINIC_2_SLUG);
    }
    expect(t.cache.entries()).toHaveLength(2);
    expect(t.calls).toEqual({ lookups: 10, hits: 8, stores: 2 });
  });
});
