import type {
  AuditLogEntry,
  BundlePublishConfirmation,
  CatalogDraft,
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
  catalogDrafts: Map<string, CatalogDraft>;
  insurers: Map<string, Insurer>;
  policySources: Map<string, PolicySource>;
  reviewRequests: Map<string, CoverageReviewRequest>;
  itemVersions: Map<string, ItemVersionRecord>;
  itemStates: Map<string, ItemStateRecord>;
  bundles: Map<string, RuleBundleVersion>;
  bundleEvents: Map<string, RuleBundleStatusEvent[]>;
  bundleConfirmations: Map<string, BundlePublishConfirmation>;
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
    catalogDrafts: new Map(),
    insurers: new Map(),
    policySources: new Map(),
    reviewRequests: new Map(),
    itemVersions: new Map(),
    itemStates: new Map(),
    bundles: new Map(),
    bundleEvents: new Map(),
    bundleConfirmations: new Map(),
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

/** 저장소 상태를 복원할 수 없을 때 던진다. 호출한 쪽은 빈 저장소로 대신하지 않고 멈춰야 한다. */
export class StateRestoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StateRestoreError';
  }
}

/**
 * dumpStore 의 거꾸로: [키, 값] 쌍의 배열로 떠 낸 상태를 Map 으로 되돌린다(쓴 순서가 그대로 이어진다). 돌려주는 Store 는 입력과 깊이 분리되어 있다.
 * 모양만 본다: 최상위 이름이 Store 의 이름과 정확히 같고, 각 이름의 값이 [문자열 키, 값] 쌍의 배열이며 키가 겹치지 않는다. 한 건의 내용(엔티티 필드)은 검사하지 않는다 —
 * 내용의 변조·손상은 저장하는 쪽이 붙인 해시로 막는다. 어긋나면 StateRestoreError 이고 부분 결과를 돌려주지 않는다.
 */
export function restoreStore(dump: unknown): Store {
  if (dump === null || typeof dump !== 'object' || Array.isArray(dump)) {
    throw new StateRestoreError('저장소 상태가 객체가 아니다');
  }
  const given = Object.keys(dump);
  const expected = Object.keys(emptyStore());
  const missing = expected.filter((name) => !given.includes(name));
  const unknown = given.filter((name) => !expected.includes(name));
  if (missing.length > 0 || unknown.length > 0) {
    throw new StateRestoreError(`저장소 상태의 이름이 맞지 않는다 (없음: ${missing.join(',') || '-'}, 모름: ${unknown.join(',') || '-'})`);
  }
  const store = emptyStore();
  for (const name of expected) {
    const entries = (dump as Record<string, unknown>)[name];
    if (!Array.isArray(entries)) {
      throw new StateRestoreError(`'${name}' 이(가) 배열이 아니다`);
    }
    const map = new Map<string, unknown>();
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') {
        throw new StateRestoreError(`'${name}' 의 항목이 [문자열 키, 값] 쌍이 아니다`);
      }
      if (map.has(entry[0])) {
        throw new StateRestoreError(`'${name}' 에 같은 키 '${entry[0]}' 가 두 번 있다`);
      }
      map.set(entry[0], deepCopy(entry[1]));
    }
    (store as unknown as Record<string, Map<string, unknown>>)[name] = map;
  }
  return store;
}
