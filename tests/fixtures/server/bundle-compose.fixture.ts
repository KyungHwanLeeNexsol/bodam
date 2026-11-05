import type { TreatmentCoverageMapping } from '../../../src/engine/types';
import type { RuleBundleVersion } from '../../../src/server/domain/entities';
import type { ItemVersionRef } from '../../../src/server/domain/items';
import { publishSecondClinicCatalog } from './api-composition.fixture';
import { T3, addThirdTreatment } from './catalog-structure.fixture';
import { buildWorld } from './estimate-world.fixture';
import { mappingRecord } from './items.fixture';
import type { World } from './lifecycle.fixture';
import { approveSpec } from './versioning.fixture';

// 시험 자료(TEST_FIXTURE). 묶음 구성(기준 묶음 + 승인된 매핑) 시험이 쓰는 세계 만들기 도우미. 모든 단계는 실제 도메인 서비스를 지난다.
// 세계: 병원 1 에 치료 셋(T1·T2·T3)과 공통 기본비용이 있고, 기준 묶음(프로필 1 · 매핑 셋(T1·T2·기본비용) · 서류 규칙 묶음 1)이 게시돼 병원 1 의 범위로 지정돼 있다.
// T3 에는 기준 묶음에 매핑이 없다(계산하면 MAPPING_ABSENT 보류). 병원 2 는 치료 하나와 범위 없음.

export interface ComposeWorld {
  world: World;
  /** 기준 묶음(ACTIVE, 병원 1 의 범위). */
  base: RuleBundleVersion;
}

export function composeWorld(): ComposeWorld {
  const built = buildWorld();
  publishSecondClinicCatalog(built.world);
  addThirdTreatment(built.world);
  return { world: built.world, base: built.bundle as RuleBundleVersion };
}

/** 작성 → 제출 → (다른 RV) 승인까지 서비스로 간 매핑 하나(APPROVED). 기본은 T3 의 GEN4_C4 · NON_LIFE 칸 COVERED 매핑이다. */
export function approvedMapping(world: World, id: string, treatmentId: string = T3, overrides: Partial<TreatmentCoverageMapping> = {}): ItemVersionRef {
  const content = mappingRecord(treatmentId, { id, ...overrides }).content;
  return approveSpec(world, { profiles: [], mappings: [content], documentRuleSet: null }).mappings[0] as ItemVersionRef;
}

export { T3 };
