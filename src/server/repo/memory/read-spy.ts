// 읽기 호출 감시 (design.md DD-14 "시험이 보는 곳"). 메모리 저장소의 읽기 메서드가 몇 번 불렸는지 이름별로 센다.
// 목적: "묶음 내용 조회는 캐시 적중일 수 있어도 항목 상태 조회(readItemStates)는 요청마다 일어난다"를 호출 수로 보이는 것.
// 카운터는 저장소 상태가 아니다: 트랜잭션을 되돌려도 되돌리지 않고, exportState 와 쓰기는 세지 않는다.

export const READ_QUERY_NAMES = [
  'getClinic',
  'listClinics',
  'getClinicCurrentCatalogVersion',
  'getTreatment',
  'listTreatments',
  'getTreatmentVersion',
  'getCommonBaseFee',
  'getCatalogVersion',
  'listCatalogVersions',
  'getInsurer',
  'listInsurers',
  'getPolicySource',
  'listPolicySources',
  'getCoverageReviewRequest',
  'listCoverageReviewRequests',
  'getItemVersion',
  'listItemVersions',
  'getItemState',
  'readItemStates',
  'getRuleBundleVersion',
  'listRuleBundleVersions',
  'getBundleStatus',
  'listBundleStatusEvents',
  'getClinicRuleScope',
  'listClinicRuleScopeHistory',
  'getIdlePolicy',
  'listAuditLog',
] as const;
export type ReadQueryName = (typeof READ_QUERY_NAMES)[number];

function zeroCounts(): Record<ReadQueryName, number> {
  return Object.fromEntries(READ_QUERY_NAMES.map((name) => [name, 0])) as Record<ReadQueryName, number>;
}

export class ReadSpy {
  /** 읽기 메서드 이름 → 호출 수. 모든 이름이 0 으로 시작한다. */
  readonly counts: Record<ReadQueryName, number> = zeroCounts();

  record(name: ReadQueryName): void {
    this.counts[name] += 1;
  }

  reset(): void {
    Object.assign(this.counts, zeroCounts());
  }
}
