import { describe, expect, it } from 'vitest';
import { isUsable, profileToRuleItem, documentRuleSetToRuleItem } from '../../src/engine/usability';
import type { UsabilityContext } from '../../src/engine/usability';
import type { DocumentRuleSet, StandardAssumptionProfile } from '../../src/engine/types';
import { markExpired, markSuperseded, suspendItem } from '../../src/server/approval';
import * as versioning from '../../src/server/versioning';
import { restoreRuleBundle } from '../../src/server/bundle-publish';
import { restoreCatalogVersion } from '../../src/server/catalog-publish';
import { canonicalDigest } from '../../src/server/digest';
import type { IdGenerator } from '../../src/server/domain/ports';
import { toEngineDocumentRuleSet, toEngineProfile } from '../../src/server/domain/projection';
import type { ItemVersionRecordOf } from '../../src/server/domain/items';
import { TEST_AT } from '../fixtures/engine/profiles.fixture';
import { TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1, TEST_FIXTURE_RV_APPROVER } from '../fixtures/server/actors.fixture';
import { TEST_FIXTURE_CLINIC_ID } from '../fixtures/server/actors.fixture';
import { makeAuditEntry } from '../fixtures/server/entities.fixture';
import { catchDomainError } from '../fixtures/server/errors.fixture';
import { setAt } from '../fixtures/server/mutate.fixture';
import { OPERATING_CATALOG_CONFIG, TEST_CATALOG_CONFIG, validCatalogRequest } from '../fixtures/server/publish.fixture';
import { snapshotOf } from '../fixtures/server/repo.fixture';
import {
  TEST_FIXTURE_RV_PUBLISHER,
  approveSpec,
  bundleWorld,
  catalogWorld,
  publishCatalogOf,
  publishRefs,
  publishedBundleOf,
  singleTreatmentRequest,
  validSpec,
} from '../fixtures/server/versioning.fixture';
import type { BundleSpec } from '../fixtures/server/versioning.fixture';

// 게시본의 불변(AC-011a)과 복구(AC-011b). 게시된 CatalogVersion·RuleBundleVersion 은 수정·삭제할 수 없고, 수정은 새 버전으로만 생긴다.
// 봉인 계약: 게시·봉인 쪽의 내용 해시는 엔진의 profileContent / documentRuleSetContent 와 canonicalDigest 하나로 만들고,
// 실제 게시를 거친 항목이 엔진의 isUsable 에서 (i) 다른 저장 순서로도 검증되고 (ii) 값이 바뀌면 옛 해시로 실패함을 본다.
// 복구는 이전 버전의 사본을 같은 게시 경로(같은 검증, 같은 역할 규칙)로 새 id 에 게시하며 기존 이력을 건드리지 않는다.

const T1 = 'TEST_FIXTURE_TREATMENT_1';
const T2 = 'TEST_FIXTURE_TREATMENT_2';

/** 접두어마다 지정한 고정 id 를 돌려주는 생성기 (나머지는 센다). 같은 id 를 다시 쓰려는 서비스 수준 시도를 흉내 낸다. */
function replayingIds(fixed: Record<string, string>, base: IdGenerator): IdGenerator {
  return { next: (prefix) => fixed[prefix] ?? base.next(prefix) };
}

describe('AC-011a 게시된 카탈로그·규칙 묶음은 수정·삭제할 수 없다', () => {
  it('게시 서비스 모듈이 내보내는 이름에 수정·삭제 동작이 없다 (새 버전을 내는 게시와 복구뿐)', () => {
    const names = Object.keys(versioning);
    expect(names.sort()).toEqual(['SERVICE_PUBLISH_DEFECT_CODES', 'bundleContentHashOf', 'computeBundleContentHash', 'publishCatalog', 'publishRuleBundle', 'restoreCatalogVersion', 'restoreRuleBundle']);
    expect(names.filter((name) => /delete|remove|update|edit|modify|overwrite|revise|drop/i.test(name))).toEqual([]);
  });

  it('게시된 CatalogVersion 을 다른 내용으로 다시 쓰려는 저장소 시도는 IMMUTABLE_VERSION 이다', () => {
    const w = catalogWorld();
    const catalog = publishCatalogOf(w);
    const before = snapshotOf(w.repo);
    for (const attempt of [
      { ...catalog, treatmentVersionIds: [] },
      { ...catalog, baseFeeIds: [] },
      { ...catalog, publishedAt: '2030-01-01T00:00:00.000Z' },
      { ...catalog, publishedBy: { id: 'TEST_FIXTURE_OTHER', role: 'HA' as const } },
    ]) {
      expect(catchDomainError(() => w.repo.putCatalogVersion(attempt)).code).toBe('IMMUTABLE_VERSION');
    }
    expect(w.repo.putCatalogVersion(catalog)).toBeUndefined(); // 같은 내용은 멱등
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  it('게시된 RuleBundleVersion 을 다른 내용으로 다시 쓰려는 저장소 시도는 IMMUTABLE_VERSION 이다', () => {
    const w = bundleWorld();
    const { bundle } = publishedBundleOf(w);
    const before = snapshotOf(w.repo);
    for (const attempt of [
      { ...bundle, contentHash: 'TEST_FIXTURE_OTHER_HASH' },
      { ...bundle, itemRefs: bundle.itemRefs.slice(1) },
      { ...bundle, publishedAt: '2030-01-01T00:00:00.000Z' },
    ]) {
      expect(catchDomainError(() => w.repo.putRuleBundleVersion(attempt)).code).toBe('IMMUTABLE_VERSION');
    }
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  it('서비스 수준 시도: 이미 쓴 카탈로그 id 가 다시 나와도(생성기 재생) 다른 내용으로는 덮어쓰이지 않고 저장소는 그대로다', () => {
    const w = catalogWorld();
    const ids = replayingIds({ CATALOG: 'TEST_FIXTURE_CATALOG_REPLAY' }, w.ids);
    const deps = { ...w.deps, ids };
    const first = versioning.publishCatalog(deps, TEST_FIXTURE_HA_1, TEST_FIXTURE_CLINIC_ID, singleTreatmentRequest(), TEST_CATALOG_CONFIG);
    const before = snapshotOf(w.repo);

    const error = catchDomainError(() => versioning.publishCatalog(deps, TEST_FIXTURE_HA_1, TEST_FIXTURE_CLINIC_ID, validCatalogRequest(), TEST_CATALOG_CONFIG));

    expect(error.code).toBe('IMMUTABLE_VERSION');
    expect(snapshotOf(w.repo)).toEqual(before);
    expect(w.repo.getCatalogVersion(first.id)).toEqual(first);
    expect(w.repo.getClinicCurrentCatalogVersion(TEST_FIXTURE_CLINIC_ID)).toEqual(first);
  });

  it('서비스 수준 시도: 이미 쓴 묶음 id 가 다시 나와도 다른 내용으로는 덮어쓰이지 않고 가용성 기록도 쓰이지 않는다', () => {
    const w = bundleWorld();
    const deps = { ...w.deps, ids: replayingIds({ BUNDLE: 'TEST_FIXTURE_BUNDLE_REPLAY' }, w.ids) };
    const refs1 = approveSpec(w, validSpec(1));
    const first = versioning.publishRuleBundle(deps, TEST_FIXTURE_RV_PUBLISHER, refs1);
    const refs2 = approveSpec(w, validSpec(2));
    const before = snapshotOf(w.repo);

    const error = catchDomainError(() => versioning.publishRuleBundle(deps, TEST_FIXTURE_RV_PUBLISHER, refs2));

    expect(error.code).toBe('IMMUTABLE_VERSION');
    expect(snapshotOf(w.repo)).toEqual(before);
    expect(w.repo.getRuleBundleVersion(first.id)).toEqual(first);
    expect(w.repo.listBundleStatusEvents(first.id)).toHaveLength(1);
    expect(w.repo.getItemState(refs2.profiles[0]!)?.state).toBe('APPROVED'); // 항목 게시 전이도 되돌려졌다
  });

  it('같은 내용으로 같은 묶음 id 가 다시 나와도 가용성 사슬이 두 번째 ACTIVE 를 막아 저장소는 그대로다', () => {
    const w = bundleWorld();
    const deps = { ...w.deps, ids: replayingIds({ BUNDLE: 'TEST_FIXTURE_BUNDLE_REPLAY' }, w.ids) };
    const refs = approveSpec(w, validSpec(1));
    versioning.publishRuleBundle(deps, TEST_FIXTURE_RV_PUBLISHER, refs);
    const before = snapshotOf(w.repo);
    const error = catchDomainError(() => versioning.publishRuleBundle(deps, TEST_FIXTURE_RV_PUBLISHER, refs));
    expect(error.code).toBe('STATE_CONFLICT');
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  it('게시된 버전은 이후의 게시·복구 뒤에도 쓰인 그대로다 (수정은 새 버전으로만 생긴다)', () => {
    const w = catalogWorld();
    const first = publishCatalogOf(w, singleTreatmentRequest());
    const frozen = structuredClone(first);
    publishCatalogOf(w, singleTreatmentRequest({ id: 'TEST_FIXTURE_TV_1B', patientAmount: 99_000 }));
    restoreCatalogVersion(w.deps, TEST_FIXTURE_HA_1, first.id, TEST_CATALOG_CONFIG);
    expect(w.repo.getCatalogVersion(first.id)).toEqual(frozen);

    const b = bundleWorld();
    const { bundle } = publishedBundleOf(b, 1);
    const frozenBundle = structuredClone(bundle);
    publishedBundleOf(b, 2);
    restoreRuleBundle(b.deps, TEST_FIXTURE_RV_PUBLISHER, bundle.id);
    expect(b.repo.getRuleBundleVersion(bundle.id)).toEqual(frozenBundle);
  });
});

describe('게시 도중에 실패하면 이미 쓴 것까지 전부 되돌린다 (원자성)', () => {
  // 감사 기록 id 를 미리 점유해 두면 게시의 쓰기가 거의 다 끝난 뒤에 DUPLICATE_KEY 로 실패한다.
  const TAKEN = 'TEST_FIXTURE_AUDIT_TAKEN';

  it('카탈로그: 감사 기록에서 실패해도 치료 버전·기본비용·카탈로그·병원의 현재 카탈로그가 모두 게시 전과 같다', () => {
    const w = catalogWorld();
    const previous = publishCatalogOf(w, singleTreatmentRequest());
    w.repo.appendAuditLog(makeAuditEntry({ id: TAKEN }));
    const before = snapshotOf(w.repo);

    const error = catchDomainError(() =>
      versioning.publishCatalog({ ...w.deps, ids: replayingIds({ AUDIT: TAKEN }, w.ids) }, TEST_FIXTURE_HA_1, TEST_FIXTURE_CLINIC_ID, validCatalogRequest(), TEST_CATALOG_CONFIG),
    );

    expect(error.code).toBe('DUPLICATE_KEY');
    expect(snapshotOf(w.repo)).toEqual(before);
    expect(w.repo.getClinicCurrentCatalogVersion(TEST_FIXTURE_CLINIC_ID)).toEqual(previous);
    expect(w.repo.getTreatmentVersion('TEST_FIXTURE_TV_2')).toBeNull();
  });

  it('규칙 묶음: 감사 기록에서 실패해도 묶음·ACTIVE 기록·항목 PUBLISHED 전이가 모두 게시 전과 같다', () => {
    const w = bundleWorld();
    const refs = approveSpec(w, validSpec(1));
    w.repo.appendAuditLog(makeAuditEntry({ id: TAKEN }));
    const before = snapshotOf(w.repo);

    const error = catchDomainError(() => versioning.publishRuleBundle({ ...w.deps, ids: replayingIds({ AUDIT: TAKEN }, w.ids) }, TEST_FIXTURE_RV_PUBLISHER, refs));

    expect(error.code).toBe('DUPLICATE_KEY');
    expect(snapshotOf(w.repo)).toEqual(before);
    expect(w.repo.listRuleBundleVersions()).toEqual([]);
    expect(w.repo.getItemState(refs.profiles[0]!)?.state).toBe('APPROVED');
  });

  it('복구도 같다: 감사 기록에서 실패하면 새 카탈로그·새 묶음이 남지 않는다', () => {
    const w = catalogWorld();
    const first = publishCatalogOf(w, singleTreatmentRequest());
    const b = bundleWorld();
    const { bundle } = publishedBundleOf(b, 1);
    w.repo.appendAuditLog(makeAuditEntry({ id: TAKEN }));
    b.repo.appendAuditLog(makeAuditEntry({ id: TAKEN }));
    const beforeCatalog = snapshotOf(w.repo);
    const beforeBundle = snapshotOf(b.repo);

    expect(catchDomainError(() => restoreCatalogVersion({ ...w.deps, ids: replayingIds({ AUDIT: TAKEN }, w.ids) }, TEST_FIXTURE_HA_1, first.id, TEST_CATALOG_CONFIG)).code).toBe('DUPLICATE_KEY');
    expect(catchDomainError(() => restoreRuleBundle({ ...b.deps, ids: replayingIds({ AUDIT: TAKEN }, b.ids) }, TEST_FIXTURE_RV_PUBLISHER, bundle.id)).code).toBe('DUPLICATE_KEY');
    expect(snapshotOf(w.repo)).toEqual(beforeCatalog);
    expect(snapshotOf(b.repo)).toEqual(beforeBundle);
  });
});

// ───────────────────────── 봉인 계약 (실제 게시를 거친 항목) ─────────────────────────

const ctx: UsabilityContext = { at: TEST_AT, acceptedOrigins: ['TEST_FIXTURE'], digest: canonicalDigest };

/** 키 순서가 일부러 어긋난 그룹·풀을 가진 프로필과 규칙이 여럿인 서류 규칙 묶음을 담은 묶음 내용. */
function unsortedSpec(): BundleSpec {
  const spec = validSpec(1);
  const group = (key: string, fixed: number, pool?: string) => ({
    groupKey: key,
    deduction: { kind: 'FIXED' as const, fixed },
    limit: { kind: 'PER_VISIT_PAYOUT' as const, amount: fixed * 100, limitBasis: 'PAYOUT' as const },
    ...(pool === undefined ? {} : { sharedLimitPoolKey: pool }),
  });
  const profile = setAt(
    setAt(setAt(spec.profiles[0]!, ['groups'], [group('TEST_GROUP_C', 3_000, 'TEST_POOL_B'), group('TEST_GROUP_A', 1_000, 'TEST_POOL_A'), group('TEST_GROUP_B', 2_000)]), ['groupOrder'], ['TEST_GROUP_C', 'TEST_GROUP_A', 'TEST_GROUP_B']),
    ['sharedLimitPools'],
    [
      { poolKey: 'TEST_POOL_B', limit: { kind: 'PER_VISIT_PAYOUT', amount: 400_000, limitBasis: 'PAYOUT' } },
      { poolKey: 'TEST_POOL_A', limit: { kind: 'PER_VISIT_PAYOUT', amount: 150_000, limitBasis: 'PAYOUT' } },
    ],
  );
  return { ...spec, profiles: [profile], mappings: [setAt(spec.mappings[0]!, ['groupKey'], 'TEST_GROUP_A')] };
}

function publishedEngineItems() {
  const w = bundleWorld();
  const refs = approveSpec(w, unsortedSpec());
  const bundle = publishRefs(w, refs);
  const profileRef = refs.profiles[0]!;
  const ruleRef = refs.documentRuleSet!;
  const states = w.repo.readItemStates([profileRef, ruleRef]);
  const profile = toEngineProfile(w.repo.getItemVersion(profileRef) as ItemVersionRecordOf<'PROFILE'>, states[0]!);
  const ruleSet = toEngineDocumentRuleSet(w.repo.getItemVersion(ruleRef) as ItemVersionRecordOf<'DOCUMENT_RULE_SET'>, states[1]!);
  return { w, bundle, profile, ruleSet };
}

describe('AC-011a 프로필 봉인: 게시를 거친 프로필이 엔진 isUsable 에서 검증된다', () => {
  it('게시된 프로필은 PUBLISHED 이고 엔진 판정이 사용 가능이다 (해시는 서비스가 엔진 정규화로 봉인했다)', () => {
    const { profile } = publishedEngineItems();
    expect(profile.state).toBe('PUBLISHED');
    expect(isUsable(profileToRuleItem(profile), ctx)).toEqual({ usable: true });
  });

  it('(i) 원래 순서에서 계산한 해시가 groups·sharedLimitPools 를 다른 순서로 저장한 같은 프로필에서도 검증을 통과한다', () => {
    const { profile } = publishedEngineItems();
    expect(profile.groups.map((g) => g.groupKey)).toEqual(['TEST_GROUP_C', 'TEST_GROUP_A', 'TEST_GROUP_B']); // 원래 순서는 키 순이 아니다
    const reorders: StandardAssumptionProfile[] = [
      { ...profile, groups: [...profile.groups].reverse() },
      { ...profile, sharedLimitPools: [...profile.sharedLimitPools].reverse() },
      { ...profile, groups: [...profile.groups].sort((a, b) => (a.groupKey < b.groupKey ? -1 : 1)), sharedLimitPools: [...profile.sharedLimitPools].sort((a, b) => (a.poolKey < b.poolKey ? -1 : 1)) },
    ];
    for (const reordered of reorders) {
      expect(isUsable(profileToRuleItem(reordered), ctx)).toEqual({ usable: true });
    }
  });

  it('객체 키 삽입 순서를 뒤집어도 검증된다 (운영 해시는 키 순서에 대해 정규형이다)', () => {
    const { profile } = publishedEngineItems();
    const flipped = Object.fromEntries(Object.entries(profile).reverse()) as unknown as StandardAssumptionProfile;
    flipped.groups = profile.groups.map((g) => Object.fromEntries(Object.entries(g).reverse()) as unknown as (typeof g));
    expect(isUsable(profileToRuleItem(flipped), ctx)).toEqual({ usable: true });
  });

  const changes: Array<[string, (p: StandardAssumptionProfile) => StandardAssumptionProfile]> = [
    ['공제 값(fixed)', (p) => setAt(p, ['groups', 0, 'deduction', 'fixed'], 3_001)],
    ['한도 값(amount)', (p) => setAt(p, ['groups', 1, 'limit', 'amount'], 100_001)],
    ['풀 한도 값', (p) => setAt(p, ['sharedLimitPools', 0, 'limit', 'amount'], 400_001)],
    ['groupOrder (순서만 바꿈)', (p) => setAt(p, ['groupOrder'], ['TEST_GROUP_A', 'TEST_GROUP_C', 'TEST_GROUP_B'])],
    ['그룹 키', (p) => setAt(p, ['groups', 2, 'groupKey'], 'TEST_GROUP_Z')],
    ['버전 라벨', (p) => setAt(p, ['version'], 'v-other')],
    ['세대', (p) => setAt(p, ['generation'], 'GEN3_C3')],
  ];

  it.each(changes)('(ii) 실제 규칙 내용(%s)이 바뀌면 옛 해시로는 INTEGRITY_MISMATCH 다', (_name, change) => {
    const { profile } = publishedEngineItems();
    expect(isUsable(profileToRuleItem(change(profile)), ctx)).toEqual({ usable: false, reason: 'INTEGRITY_MISMATCH' });
  });
});

describe('AC-011a 서류 규칙 묶음 봉인: 게시를 거친 묶음이 엔진 isUsable 에서 검증된다', () => {
  it('게시된 서류 규칙 묶음은 PUBLISHED 이고 사용 가능이다', () => {
    const { ruleSet } = publishedEngineItems();
    expect(ruleSet.state).toBe('PUBLISHED');
    expect(isUsable(documentRuleSetToRuleItem(ruleSet), ctx)).toEqual({ usable: true });
  });

  it('(i) 원래 순서의 해시가 rules 를 다른 순서로 저장한 묶음에서도 검증을 통과한다', () => {
    const { ruleSet } = publishedEngineItems();
    expect(ruleSet.rules.length).toBeGreaterThan(2);
    const reordered: DocumentRuleSet = { ...ruleSet, rules: [...ruleSet.rules].reverse() };
    expect(reordered.rules).not.toEqual(ruleSet.rules);
    expect(isUsable(documentRuleSetToRuleItem(reordered), ctx)).toEqual({ usable: true });
  });

  const changes: Array<[string, (r: DocumentRuleSet) => DocumentRuleSet]> = [
    ['규칙 사유', (r) => setAt(r, ['rules', 0, 'reason'], `${r.rules[0]!.reason} 바뀜`)],
    ['규칙 priority', (r) => setAt(r, ['rules', 1, 'priority'], r.rules[1]!.priority + 1)],
    ['규칙 문서 코드', (r) => setAt(r, ['rules', 0, 'documentCode'], r.rules[0]!.documentCode === 'RECEIPT' ? 'DIAGNOSIS_CERT' : 'RECEIPT')],
    ['규칙 하나 제거', (r) => ({ ...r, rules: r.rules.slice(1) })],
    ['버전 라벨', (r) => setAt(r, ['version'], 'v-other')],
  ];

  it.each(changes)('(ii) 실제 규칙 내용(%s)이 바뀌면 옛 해시로는 INTEGRITY_MISMATCH 다', (_name, change) => {
    const { ruleSet } = publishedEngineItems();
    expect(isUsable(documentRuleSetToRuleItem(change(ruleSet)), ctx)).toEqual({ usable: false, reason: 'INTEGRITY_MISMATCH' });
  });
});

// ───────────────────────── AC-011b 복구 ─────────────────────────

describe('AC-011b 카탈로그 복구: 이전 버전의 사본을 새 id 로 게시하고 기존 이력은 그대로다', () => {
  function history() {
    const w = catalogWorld();
    const first = publishCatalogOf(w, validCatalogRequest()); // TV_1(T1), TV_2(T2), FEE_1, FEE_2
    w.clock.set('2026-10-17T09:00:00.000Z');
    const second = publishCatalogOf(w, singleTreatmentRequest({ id: 'TEST_FIXTURE_TV_1B', patientAmount: 20_000 })); // T1 가격 변경, T2 제거
    return { w, first, second };
  }

  it('옛 카탈로그를 복구하면 구성이 같은 새 id 의 카탈로그가 현재 카탈로그가 되고, 변경 요약은 직전 현재 카탈로그 대비다', () => {
    const { w, first, second } = history();
    w.clock.set('2026-10-18T09:00:00.000Z');

    const restored = restoreCatalogVersion(w.deps, TEST_FIXTURE_HA_1, first.id, TEST_CATALOG_CONFIG);

    expect(restored).toEqual({
      id: 'TEST_FIXTURE_CATALOG_3',
      clinicId: TEST_FIXTURE_CLINIC_ID,
      treatmentVersionIds: first.treatmentVersionIds,
      baseFeeIds: first.baseFeeIds,
      publishedBy: { id: TEST_FIXTURE_HA_1.id, role: 'HA' },
      publishedAt: '2026-10-18T09:00:00.000Z',
      changeSummary: { addedTreatmentIds: [T2], removedTreatmentIds: [], priceChangedTreatmentIds: [T1], baseFeesChanged: true },
    });
    expect(restored.id).not.toBe(first.id);
    expect(w.repo.getClinicCurrentCatalogVersion(TEST_FIXTURE_CLINIC_ID)).toEqual(restored);
    expect(w.repo.getCatalogVersion(first.id)).toEqual(first); // 기존 버전과 이력이 그대로
    expect(w.repo.getCatalogVersion(second.id)).toEqual(second);
    expect(w.repo.listCatalogVersions(TEST_FIXTURE_CLINIC_ID).map((catalog) => catalog.id)).toEqual([first.id, second.id, restored.id]);
  });

  it('복구는 감사 기록에 원본 버전을 이름으로 남긴다 (수행자 id·역할, 직전 현재 카탈로그)', () => {
    const { w, first, second } = history();
    const restored = restoreCatalogVersion(w.deps, TEST_FIXTURE_HA_1, first.id, TEST_CATALOG_CONFIG);
    const entries = w.repo.listAuditLog().filter((entry) => entry.action === 'CATALOG_RESTORE');
    expect(entries).toEqual([
      {
        id: expect.any(String),
        actorId: TEST_FIXTURE_HA_1.id,
        role: 'HA',
        action: 'CATALOG_RESTORE',
        target: `CATALOG/${restored.id}`,
        beforeVersion: second.id,
        afterVersion: restored.id,
        reason: `RESTORE_OF:${first.id}`,
        at: '2026-10-17T09:00:00.000Z',
      },
    ]);
  });

  it('같은 게시 경로의 역할 규칙이 적용된다: HA 만 복구할 수 있다', () => {
    const { w, first } = history();
    const before = snapshotOf(w.repo);
    for (const actor of [TEST_FIXTURE_RV_APPROVER, TEST_FIXTURE_PO_1]) {
      expect(catchDomainError(() => restoreCatalogVersion(w.deps, actor, first.id, TEST_CATALOG_CONFIG)).code).toBe('ROLE_NOT_PERMITTED');
    }
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  it('없는 원본은 NOT_FOUND 이고 저장소는 그대로다', () => {
    const { w } = history();
    const before = snapshotOf(w.repo);
    expect(catchDomainError(() => restoreCatalogVersion(w.deps, TEST_FIXTURE_HA_1, 'TEST_FIXTURE_NO_SUCH_CATALOG', TEST_CATALOG_CONFIG)).code).toBe('NOT_FOUND');
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  it('옛 내용이 지금의 게시 규칙을 통과하지 못하면(운영 구성의 TEST_FIXTURE 출처) 유형 있는 거절이고 아무것도 저장되지 않는다', () => {
    const { w, first, second } = history();
    const before = snapshotOf(w.repo);
    const error = catchDomainError(() => restoreCatalogVersion(w.deps, TEST_FIXTURE_HA_1, first.id, OPERATING_CATALOG_CONFIG));
    expect(error.code).toBe('PUBLISH_VALIDATION_FAILED');
    expect(error.defects.map((defect) => `${defect.code}@${defect.path}`)).toEqual([
      'ORIGIN_NOT_ACCEPTED@treatmentVersions[0].origin',
      'ORIGIN_NOT_ACCEPTED@treatmentVersions[1].origin',
      'ORIGIN_NOT_ACCEPTED@commonBaseFees[0].origin',
      'ORIGIN_NOT_ACCEPTED@commonBaseFees[1].origin',
    ]);
    expect(snapshotOf(w.repo)).toEqual(before);
    expect(w.repo.getClinicCurrentCatalogVersion(TEST_FIXTURE_CLINIC_ID)).toEqual(second);
  });

  it('복구 때에도 재검토 기준이 적용된다: 옛 치료 버전의 보장 판단 필드가 매핑에 고정된 지문과 다르면 매핑이 UNDER_REREVIEW 가 된다', () => {
    const w = catalogWorld();
    const first = publishCatalogOf(w, singleTreatmentRequest()); // TV_1: 기본 보장 판단 필드
    publishCatalogOf(w, singleTreatmentRequest({ id: 'TEST_FIXTURE_TV_1B', treatmentCode: 'TEST_FIXTURE_TC_CHANGED' })); // 보장 판단 필드 변경
    const refs = approveSpec(w, { ...validSpec(1), profiles: [], documentRuleSet: null }); // 매핑 승인: 현재(TV_1B)의 지문 고정
    const mapping = refs.mappings[0]!;
    expect(w.repo.getItemState(mapping)?.state).toBe('APPROVED');

    restoreCatalogVersion(w.deps, TEST_FIXTURE_HA_1, first.id, TEST_CATALOG_CONFIG); // TV_1 로 되돌림

    expect(w.repo.getItemState(mapping)?.state).toBe('UNDER_REREVIEW');
  });
});

describe('AC-011b 규칙 묶음 복구: 이전 버전의 사본을 새 id 로 게시하고 기존 이력은 그대로다', () => {
  it('복구한 묶음은 같은 항목·같은 내용 해시의 새 id 묶음이고 ACTIVE 로 시작하며 옛 묶음과 가용성 이력은 그대로다', () => {
    const w = bundleWorld();
    const first = publishedBundleOf(w, 1);
    const second = publishedBundleOf(w, 2);
    const firstEvents = w.repo.listBundleStatusEvents(first.bundle.id);
    const itemHistories = [...first.refs.profiles, ...first.refs.mappings, first.refs.documentRuleSet!].map((ref) => w.repo.getItemState(ref));
    w.clock.set('2026-10-18T09:00:00.000Z');

    const restored = restoreRuleBundle(w.deps, TEST_FIXTURE_RV_PUBLISHER, first.bundle.id);

    expect(restored).toEqual({
      id: 'TEST_FIXTURE_BUNDLE_3',
      itemRefs: first.bundle.itemRefs,
      contentHash: first.bundle.contentHash,
      publishedBy: { id: 'TEST_FIXTURE_RV_PUBLISHER', role: 'RV' },
      publishedAt: '2026-10-18T09:00:00.000Z',
    });
    expect(w.repo.listRuleBundleVersions().map((bundle) => bundle.id)).toEqual([first.bundle.id, second.bundle.id, restored.id]);
    expect(w.repo.getRuleBundleVersion(first.bundle.id)).toEqual(first.bundle); // 기존 버전 그대로
    expect(w.repo.getRuleBundleVersion(second.bundle.id)).toEqual(second.bundle);
    expect(w.repo.listBundleStatusEvents(first.bundle.id)).toEqual(firstEvents);
    expect(w.repo.listBundleStatusEvents(restored.id)).toEqual([
      { bundleId: restored.id, status: 'ACTIVE', actorId: 'TEST_FIXTURE_RV_PUBLISHER', role: 'RV', at: '2026-10-18T09:00:00.000Z', reason: null, previousStatus: null },
    ]);
    // 이미 PUBLISHED 인 항목은 다시 전이하지 않는다.
    expect([...first.refs.profiles, ...first.refs.mappings, first.refs.documentRuleSet!].map((ref) => w.repo.getItemState(ref))).toEqual(itemHistories);
  });

  it('서류 규칙 묶음이 없는 묶음도 복구된다 (서류 규칙 묶음 자리는 null 로 이어진다)', () => {
    const w = bundleWorld();
    const refs = approveSpec(w, { ...validSpec(1), documentRuleSet: null });
    const bundle = publishRefs(w, refs);
    const restored = restoreRuleBundle(w.deps, TEST_FIXTURE_RV_PUBLISHER, bundle.id);
    expect(restored.itemRefs).toEqual(bundle.itemRefs);
    expect(restored.contentHash).toBe(bundle.contentHash);
  });

  it('복구는 감사 기록에 원본 버전을 이름으로 남긴다', () => {
    const w = bundleWorld();
    const { bundle } = publishedBundleOf(w, 1);
    const restored = restoreRuleBundle(w.deps, TEST_FIXTURE_RV_PUBLISHER, bundle.id);
    expect(w.repo.listAuditLog().filter((entry) => entry.action === 'BUNDLE_RESTORE')).toEqual([
      {
        id: expect.any(String),
        actorId: 'TEST_FIXTURE_RV_PUBLISHER',
        role: 'RV',
        action: 'BUNDLE_RESTORE',
        target: `BUNDLE/${restored.id}`,
        beforeVersion: null,
        afterVersion: restored.id,
        reason: `RESTORE_OF:${bundle.id}`,
        at: '2026-10-16T09:00:00.000Z',
      },
    ]);
  });

  it('중지된 묶음도 복구할 수 있다: 새 묶음은 ACTIVE 이고 중지된 옛 묶음은 SUSPENDED 로 남는다 (DD-14 복구 경로)', () => {
    const w = bundleWorld();
    const { bundle } = publishedBundleOf(w, 1);
    w.repo.appendBundleStatusEvent({ bundleId: bundle.id, status: 'SUSPENDED', actorId: TEST_FIXTURE_RV_APPROVER.id, role: 'RV', at: '2026-10-17T00:00:00.000Z', reason: 'TEST_FIXTURE 중지', previousStatus: 'ACTIVE' });

    const restored = restoreRuleBundle(w.deps, TEST_FIXTURE_RV_PUBLISHER, bundle.id);

    expect(w.repo.getBundleStatus(restored.id)).toBe('ACTIVE');
    expect(w.repo.getBundleStatus(bundle.id)).toBe('SUSPENDED');
  });

  it('같은 게시 경로의 역할 규칙이 적용된다: RV 만 복구할 수 있다', () => {
    const w = bundleWorld();
    const { bundle } = publishedBundleOf(w, 1);
    const before = snapshotOf(w.repo);
    for (const actor of [TEST_FIXTURE_HA_1, TEST_FIXTURE_PO_1]) {
      expect(catchDomainError(() => restoreRuleBundle(w.deps, actor, bundle.id)).code).toBe('ROLE_NOT_PERMITTED');
    }
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  it('없는 원본은 NOT_FOUND 이고 저장소는 그대로다', () => {
    const w = bundleWorld();
    const before = snapshotOf(w.repo);
    expect(catchDomainError(() => restoreRuleBundle(w.deps, TEST_FIXTURE_RV_PUBLISHER, 'TEST_FIXTURE_NO_SUCH_BUNDLE')).code).toBe('NOT_FOUND');
    expect(snapshotOf(w.repo)).toEqual(before);
  });

  const unusable: Array<[string, (w: ReturnType<typeof bundleWorld>, ref: Parameters<typeof suspendItem>[2]) => void]> = [
    ['중지된 항목', (w, ref) => suspendItem(w.deps, TEST_FIXTURE_RV_APPROVER, ref, 'TEST_FIXTURE 중지')],
    ['새 버전으로 대체된 항목', (w, ref) => markSuperseded(w.deps, TEST_FIXTURE_RV_APPROVER, ref)],
    ['유효 기간이 끝난 항목', (w, ref) => markExpired(w.deps, TEST_FIXTURE_RV_APPROVER, ref)],
  ];

  it.each(unusable)('옛 묶음의 %s 가 지금은 게시 규칙을 통과하지 못하면 유형 있는 거절이고 아무것도 저장되지 않는다', (_name, make) => {
    const w = bundleWorld();
    const first = publishedBundleOf(w, 1);
    const second = publishedBundleOf(w, 2);
    make(w, first.refs.profiles[0]!);
    const before = snapshotOf(w.repo);

    const error = catchDomainError(() => restoreRuleBundle(w.deps, TEST_FIXTURE_RV_PUBLISHER, first.bundle.id));

    expect(error.code).toBe('PUBLISH_VALIDATION_FAILED');
    expect(error.defects).toContainEqual({ code: 'ITEM_STATE_NOT_PUBLISHABLE', path: 'bundle.profiles[0].state' });
    expect(snapshotOf(w.repo)).toEqual(before);
    expect(w.repo.listRuleBundleVersions().map((bundle) => bundle.id)).toEqual([first.bundle.id, second.bundle.id]);
  });

  it('항목 상태가 바뀌지 않은 다른 묶음은 영향 없이 복구된다 (항목 중지가 그 항목을 담은 묶음에만 작용한다)', () => {
    const w = bundleWorld();
    const first = publishedBundleOf(w, 1);
    const second = publishedBundleOf(w, 2);
    suspendItem(w.deps, TEST_FIXTURE_RV_APPROVER, first.refs.profiles[0]!, 'TEST_FIXTURE 중지');
    expect(() => restoreRuleBundle(w.deps, TEST_FIXTURE_RV_PUBLISHER, second.bundle.id)).not.toThrow();
  });
});

describe('결정성: 시계와 id 생성기가 같으면 두 세계가 같은 저장소 상태를 만든다', () => {
  function scenario() {
    const c = catalogWorld();
    const first = publishCatalogOf(c, validCatalogRequest());
    publishCatalogOf(c, singleTreatmentRequest({ id: 'TEST_FIXTURE_TV_1B', patientAmount: 20_000 }));
    restoreCatalogVersion(c.deps, TEST_FIXTURE_HA_1, first.id, TEST_CATALOG_CONFIG);
    const refs = approveSpec(c, validSpec(1));
    const bundle = publishRefs(c, refs);
    restoreRuleBundle(c.deps, TEST_FIXTURE_RV_PUBLISHER, bundle.id);
    return snapshotOf(c.repo);
  }

  it('게시와 복구를 같은 순서로 하면 저장소 전체 상태(감사 기록·가용성 기록 포함)가 같다', () => {
    expect(scenario()).toEqual(scenario());
  });
});
