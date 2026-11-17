import { publishCatalog } from '../../../src/server/catalog-publish';
import { TEST_FIXTURE_HA_1 } from '../../fixtures/server/actors.fixture';
import { makeCatalogVersion, makeClinic } from '../../fixtures/server/entities.fixture';
import { TEST_CATALOG_CONFIG } from '../../fixtures/server/publish.fixture';
import type { World } from '../../fixtures/server/lifecycle.fixture';

// 시험 자료(TEST_FIXTURE). 브라우저 시험 전용 끝점이 쓰는 도우미 (M7 묶음 구성). 앞단 서버를 --test-hooks 로 띄웠을 때만 열린다(server.ts). 운영 구성·사람이 보는 미리보기에는 없다.
//  - 읽기: 감사 기록 전체와 저장소 전체의 사본. 시험이 "이 흐름이 감사 기록을 정확히 이만큼 남겼다"와 "거절된 시도 뒤 저장 상태가 한 글자도 안 바뀌었다"를 본다.
//  - 쓰기(시험이 만드는 상황): 승인된 매핑이 가리키는 치료의 보장 판단 필드(치료 코드)를 바꾼 새 카탈로그를 병원 1 의 현재 값으로 만든다 → 승인 뒤 치료 정보가 바뀐 상황.
//    관리자 화면·API 로는 보장 판단 필드를 바꿀 길이 없어(검토 요청은 제안 기록일 뿐이다) 저장소에 직접 쓰는 이 끝점이 필요하다. 도메인 서비스는 거치지 않는다: 시험이 상황을 만드는 것이지 관리자 기능이 아니다.

/** 묶음 중지 시험의 범위 전용 병원 C·D (카탈로그 없이 병원 기록만 있다: 규칙 사용 범위 화면과 중지 영향 목록에 나오는지만 본다). */
export const SCOPE_ONLY_CLINICS = [
  { id: 'TEST_FIXTURE_CLINIC_3', slug: 'test-fixture-clinic-3', name: 'TEST_FIXTURE 병원 C' },
  { id: 'TEST_FIXTURE_CLINIC_4', slug: 'test-fixture-clinic-4', name: 'TEST_FIXTURE 병원 D' },
] as const;

/**
 * 규칙 사용 범위만 필요한 병원 둘(C·D)을 저장소에 더한다. 병원 기록만 직접 쓴다 — 범위 지정은 시험이 실제 관리자 API(PO)로 한다.
 * 이미 있으면 같은 기록으로 덮어쓰기라 여러 번 불러도 같다. 더한 병원 id 를 돌려준다.
 */
export function addScopeOnlyClinics(world: World): string[] {
  for (const clinic of SCOPE_ONLY_CLINICS) {
    world.repo.saveClinic(makeClinic({ id: clinic.id, slug: clinic.slug, name: clinic.name }));
  }
  return SCOPE_ONLY_CLINICS.map((clinic) => clinic.id);
}

/**
 * 병원 1 을 공통 기본비용이 없는 병원으로 만든다(공통 기본비용 금액 수정 시험): 현재 카탈로그의 치료 버전은 그대로 두고 기본비용 없이 실제 게시 서비스로 다시 게시한다. 새 카탈로그 id 를 돌려준다.
 * 시험이 상황을 만드는 길이지 관리자 기능이 아니다(관리자 화면·API 에는 기본비용을 빼는 길이 없다).
 */
export function publishWithoutBaseFees(world: World): string {
  const current = world.repo.getClinicCurrentCatalogVersion(makeClinic().id);
  if (current === null) throw new Error('TEST_FIXTURE: 병원 1 의 현재 카탈로그가 없다');
  const treatmentVersions = current.treatmentVersionIds.map((id) => world.repo.getTreatmentVersion(id)!);
  return publishCatalog(world.deps, TEST_FIXTURE_HA_1, makeClinic().id, { treatmentVersions, commonBaseFees: [] }, TEST_CATALOG_CONFIG).id;
}

/** 감사 기록 전체(쓴 순서). */
export function auditEntries(world: World): unknown[] {
  return world.repo.listAuditLog();
}

/** 저장소 전체의 사본(비교 가능한 평범한 값). */
export function storeState(world: World): Record<string, unknown> {
  return world.repo.exportState();
}

/**
 * 병원 1 의 현재 카탈로그에서 그 치료의 버전 하나를 "치료 코드만 다른" 새 버전으로 바꾼 카탈로그를 현재 값으로 만든다(다른 치료·공통 기본비용은 그대로).
 * 치료 코드는 승인 때 고정한 지문(approvedFingerprint)에 들어가는 보장 판단 필드다. 바꾼 뒤의 치료 코드를 돌려준다.
 */
export function changeCoverageJudgment(world: World, treatmentId: string): string {
  const current = world.repo.getClinicCurrentCatalogVersion(makeClinic().id);
  if (current === null) throw new Error('TEST_FIXTURE: 병원 1 의 현재 카탈로그가 없다');
  const versions = current.treatmentVersionIds.map((id) => world.repo.getTreatmentVersion(id)!);
  const old = versions.find((version) => version.treatmentId === treatmentId);
  if (old === undefined) throw new Error(`TEST_FIXTURE: 병원 1 의 현재 카탈로그에 치료 ${treatmentId} 이(가) 없다`);
  const changed = { ...old, id: `${old.id}_COVERAGE_CHANGED`, treatmentCode: `${old.treatmentCode}_CHANGED` };
  world.repo.putTreatmentVersion(changed);
  const catalog = makeCatalogVersion({
    id: `${current.id}_COVERAGE_CHANGED`,
    treatmentVersionIds: current.treatmentVersionIds.map((id) => (id === old.id ? changed.id : id)),
    baseFeeIds: [...current.baseFeeIds],
    changeSummary: { addedTreatmentIds: [], removedTreatmentIds: [], priceChangedTreatmentIds: [], baseFeesChanged: false },
  });
  world.repo.putCatalogVersion(catalog);
  world.repo.saveClinic(makeClinic({ currentCatalogVersionId: catalog.id }));
  return changed.treatmentCode;
}
