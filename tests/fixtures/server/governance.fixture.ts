import type { Actor } from '../../../src/server/domain/actor';
import type { Insurer, RuleBundleVersion } from '../../../src/server/domain/entities';
import type { MemoryRepository } from '../../../src/server/repo/memory/memory-repository';
import { makeClinic, makeInsurer } from './entities.fixture';
import type { World } from './lifecycle.fixture';
import { TEST_FIXTURE_RV_PUBLISHER, bundleWorld, publishRefs, publishedBundleOf } from './versioning.fixture';
import type { BundleRefs } from './versioning.fixture';

// 시험 자료(TEST_FIXTURE). 규칙 묶음 중지·규칙 사용 범위·보험사·무조작 정책(M3.D2) 시험이 쓰는 세계.
// 모든 주체·병원·보험사 이름은 시험용 가짜 값이다. AC-011d 가 이름으로 든 실제 기관(농협 계열)의 기록은 만들지 않는다.

/** 규칙 묶음을 중지하는 RV 시험 주체 (작성자·승인자·게시자와 모두 다르다). */
export const TEST_FIXTURE_RV_SUSPENDER: Actor = { id: 'TEST_FIXTURE_RV_SUSPENDER', role: 'RV' };

/** n 번째 시험 병원의 id (1 번은 bundleWorld 가 이미 만든다). */
export const clinicIdOf = (n: number): string => `TEST_FIXTURE_CLINIC_${n}`;

/** 시험 병원 n 번(여럿 가능)을 더한다. slug 는 병원마다 다르다. */
export function addClinics(repo: MemoryRepository, ...numbers: number[]): string[] {
  return numbers.map((n) => {
    repo.saveClinic(makeClinic({ id: clinicIdOf(n), slug: `test-fixture-clinic-${n}` }));
    return clinicIdOf(n);
  });
}

export interface ScopeWorld {
  world: World;
  bundle: RuleBundleVersion;
  refs: BundleRefs;
}

/** 시험 병원 1~4 번과 ACTIVE 묶음 하나(A)가 있는 세계. 아직 어느 병원에도 범위를 지정하지 않았다. */
export function scopeWorld(): ScopeWorld {
  const world = bundleWorld();
  addClinics(world.repo, 2, 3, 4);
  const { bundle, refs } = publishedBundleOf(world);
  return { world, bundle, refs };
}

/** 같은 항목 버전을 담은 두 번째 묶음을 게시한다 (항목은 이미 PUBLISHED 라서 전이가 없다). */
export function publishSecondBundleOfSameItems(world: World, refs: BundleRefs): RuleBundleVersion {
  return publishRefs(world, refs, TEST_FIXTURE_RV_PUBLISHER);
}

// ───────────────────────── 보험사 ─────────────────────────

/** 세 보험사는 서로 다른 기관 종류(NON_LIFE · LIFE · MUTUAL_AID)를 가진 시험 기록이다. 실제 기관명이 아니다. */
export const INSURER_NONLIFE: Insurer = makeInsurer({
  id: 'TEST_FIXTURE_INSURER_NONLIFE',
  insurerType: 'NON_LIFE',
  currentName: 'TEST_FIXTURE 시험 손해보험',
  formerNames: ['TEST_FIXTURE 옛 손해보험 이름'],
  verifiedContact: null,
});
export const INSURER_LIFE: Insurer = makeInsurer({
  id: 'TEST_FIXTURE_INSURER_LIFE',
  insurerType: 'LIFE',
  currentName: 'TEST_FIXTURE 시험 생명',
  formerNames: ['TEST_FIXTURE 옛 생명 이름', 'TEST_FIXTURE 옛 생명 이름 2'],
  verifiedContact: 'TEST_FIXTURE_CONTACT_LIFE',
});
export const INSURER_FORMER_MUTUAL: Insurer = makeInsurer({
  id: 'TEST_FIXTURE_INSURER_FORMER_MUTUAL',
  insurerType: 'MUTUAL_AID',
  currentName: 'TEST_FIXTURE 시험 옛 공제',
  formerNames: [],
  verifiedContact: null,
});
export const THREE_INSURERS: readonly Insurer[] = [INSURER_NONLIFE, INSURER_LIFE, INSURER_FORMER_MUTUAL];
