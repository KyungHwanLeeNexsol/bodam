import type {
  AuditLogEntry,
  CatalogVersion,
  Clinic,
  ClinicRuleScope,
  CommonBaseFee,
  CoverageReviewRequest,
  IdlePolicy,
  Insurer,
  PolicySource,
  RuleBundleStatusEvent,
  RuleBundleVersion,
  Treatment,
  TreatmentVersion,
} from '../../domain/entities';
import type { ItemStateRecord, ItemVersionRecord } from '../../domain/items';

// 메모리 저장소의 전체 상태. 이 객체 하나가 저장소의 전부이므로 트랜잭션은 이 객체를 통째로 복사해 두었다가 되돌린다.
// Map 은 삽입 순서를 유지하며, 버전·이력 목록이 "쓴 순서"로 나오는 근거다.

export interface Store {
  clinics: Map<string, Clinic>;
  treatments: Map<string, Treatment>;
  treatmentVersions: Map<string, TreatmentVersion>;
  baseFees: Map<string, CommonBaseFee>;
  catalogVersions: Map<string, CatalogVersion>;
  insurers: Map<string, Insurer>;
  policySources: Map<string, PolicySource>;
  reviewRequests: Map<string, CoverageReviewRequest>;
  itemVersions: Map<string, ItemVersionRecord>;
  itemStates: Map<string, ItemStateRecord>;
  bundles: Map<string, RuleBundleVersion>;
  bundleEvents: Map<string, RuleBundleStatusEvent[]>;
  scopeHistory: Map<string, ClinicRuleScope[]>;
  idlePolicies: Map<string, IdlePolicy>;
  auditLog: Map<string, AuditLogEntry>;
}

export function emptyStore(): Store {
  return {
    clinics: new Map(),
    treatments: new Map(),
    treatmentVersions: new Map(),
    baseFees: new Map(),
    catalogVersions: new Map(),
    insurers: new Map(),
    policySources: new Map(),
    reviewRequests: new Map(),
    itemVersions: new Map(),
    itemStates: new Map(),
    bundles: new Map(),
    bundleEvents: new Map(),
    scopeHistory: new Map(),
    idlePolicies: new Map(),
    auditLog: new Map(),
  };
}

/** 깊은 복사. 저장·읽기 격리와 트랜잭션 체크포인트가 모두 이것을 쓴다. 규칙 데이터는 평범한 값이라 구조화 복사로 충분하다. */
export function deepCopy<T>(value: T): T {
  return structuredClone(value);
}

/**
 * 비교용으로 저장소 전체를 평범한 값으로 떠 낸다 (시험 도우미 snapshotOf 가 쓴다). Map 은 [키, 값] 쌍의 배열이 되어
 * 쓴 순서까지 비교된다. 돌려주는 값은 저장소와 깊이 분리되어 있다.
 */
export function dumpStore(store: Store): Record<string, unknown> {
  const dump: Record<string, unknown> = {};
  for (const [name, map] of Object.entries(store)) {
    dump[name] = deepCopy([...(map as Map<string, unknown>).entries()]);
  }
  return dump;
}
