import type {
  AuditLogEntry,
  BundleAvailability,
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
} from '../domain/entities';
import type { ItemKind, ItemStateRecord, ItemStateSnapshot, ItemTransitionInput, ItemVersionRecord, ItemVersionRef } from '../domain/items';

// 저장소 인터페이스 (plan.md M3, design.md DD-14·DD-18). DB 제품은 정해지지 않았다(§E #1) — 이 파일은 인터페이스이고,
// 구현은 repo/memory 의 메모리 구현뿐이다. DB 드라이버·네트워크·파일은 쓰지 않는다.
//
// 계약
//  - 동기(sync)다. DB 어댑터는 비동기 변형이 필요할 수 있으며 그것은 DB 제품이 정해진 뒤의 일이다.
//  - 오류: 쓰기는 거절하면 DomainError 를 던진다 (가리키는 엔티티가 없음=NOT_FOUND, 유일 키 중복=DUPLICATE_KEY,
//    불변 버전 다른 내용 재기록=IMMUTABLE_VERSION, 상태 불일치=STATE_CONFLICT, 참조-내용 불일치=REF_CONTENT_MISMATCH).
//    읽기는 없는 자료에 null 또는 빈 목록을 돌려준다.
//  - 원자성: transaction(fn) 안의 모든 쓰기(감사 기록·묶음 상태 사건·항목 전이 포함)는 fn 이 던지면 함께 되돌려진다.
//    중첩 호출은 바깥 트랜잭션에 합류한다(안쪽이 던지면 안쪽 쓰기만 되돌리는 세이브포인트이고, 확정은 바깥 트랜잭션이 끝날 때다).
//  - 격리: 쓸 때 복사해 저장하고 읽을 때 복사해 돌려준다. 호출자는 저장된 자료를 바꿀 수 없다.
//  - 불변: put* 는 (키)마다 한 번만 쓴다. 같은 내용을 다시 쓰면 아무것도 바뀌지 않는 멱등이고(재시도 안전), 다른 내용을
//    쓰면 IMMUTABLE_VERSION 이다. 삭제 동작은 없다. save* 는 상태가 바뀌는 엔티티(병원·치료·보험사·검토 요청·무조작 정책)의 upsert 다.
//  - 추가 전용: 감사 기록, 묶음 상태 사건, 항목 상태 전이 이력, 규칙 사용 범위 이력은 더하기만 한다.
//  - 정렬(결정적): 이름 없는 키로 묶인 엔티티 목록(listClinics, listTreatments, listInsurers, listPolicySources,
//    listCoverageReviewRequests)은 id 의 유니코드 코드 포인트 순이다. 버전·이력 목록(listItemVersions, listCatalogVersions,
//    listRuleBundleVersions, listBundleStatusEvents, listClinicRuleScopeHistory, listAuditLog)은 쓴 순서(게시 순서)다.
//  - 확장: 뒤 단계는 메서드를 더할 수 있지만 이미 있는 메서드의 뜻을 바꾸지 않는다.

export interface Repository {
  /**
   * fn 을 하나의 원자적 단위로 실행한다. fn 이 던지면 fn 안의 모든 쓰기를 되돌리고 같은 오류를 다시 던진다.
   * fn 은 동기 함수여야 한다: 약속(Promise)을 돌려주면 TypeError 로 거절하고 되돌린다.
   */
  transaction<T>(fn: () => T): T;

  // ── 병원·카탈로그 ──
  /** upsert. slug 는 병원 사이에서 유일(DUPLICATE_KEY). currentCatalogVersionId 가 있으면 존재하고 이 병원의 것이어야 한다. */
  saveClinic(clinic: Clinic): void;
  getClinic(id: string): Clinic | null;
  listClinics(): Clinic[];
  /** 병원의 현재 카탈로그 버전. 병원이 없거나 아직 게시한 적이 없으면 null. */
  getClinicCurrentCatalogVersion(clinicId: string): CatalogVersion | null;

  /** upsert. 병원이 있어야 한다. */
  saveTreatment(treatment: Treatment): void;
  getTreatment(id: string): Treatment | null;
  listTreatments(clinicId: string): Treatment[];

  /** write-once. 치료가 있어야 한다. */
  putTreatmentVersion(version: TreatmentVersion): void;
  getTreatmentVersion(id: string): TreatmentVersion | null;

  /** write-once. 병원이 있어야 한다. */
  putCommonBaseFee(fee: CommonBaseFee): void;
  getCommonBaseFee(id: string): CommonBaseFee | null;

  /** write-once. 병원·치료 버전·공통 기본비용이 모두 있어야 한다(존재만 본다. 병원 소유 일치는 서비스가 본다). */
  putCatalogVersion(catalog: CatalogVersion): void;
  getCatalogVersion(id: string): CatalogVersion | null;
  listCatalogVersions(clinicId: string): CatalogVersion[];

  // ── 보험사·약관 ──
  saveInsurer(insurer: Insurer): void;
  getInsurer(id: string): Insurer | null;
  listInsurers(): Insurer[];

  /** write-once. */
  putPolicySource(source: PolicySource): void;
  getPolicySource(id: string): PolicySource | null;
  listPolicySources(): PolicySource[];

  // ── 검토 요청 ──
  /** upsert. 병원·치료가 있어야 하고 resultMappingRef 가 있으면 그 매핑 버전도 있어야 한다. */
  saveCoverageReviewRequest(request: CoverageReviewRequest): void;
  getCoverageReviewRequest(id: string): CoverageReviewRequest | null;
  listCoverageReviewRequests(clinicId: string): CoverageReviewRequest[];

  // ── 규칙 항목: 내용(불변)과 상태(현재)를 따로 ──
  /** write-once, 키는 (kind, id, version). ref 의 id·version 이 content 와 같아야 한다(REF_CONTENT_MISMATCH). */
  putItemVersion(record: ItemVersionRecord): void;
  getItemVersion(ref: ItemVersionRef): ItemVersionRecord | null;
  listItemVersions(kind: ItemKind): ItemVersionRecord[];

  /**
   * 항목 상태 전이를 이력에 더하고 현재 상태·승인자 기록을 바꾼다. 항목 버전이 있어야 한다(NOT_FOUND).
   * 처음 쓰는 전이는 from 이 null, 이후에는 from 이 현재 상태와 같아야 한다(STATE_CONFLICT). 전이 표(DD-17)는 서비스가 본다.
   */
  recordItemTransition(ref: ItemVersionRef, transition: ItemTransitionInput): void;
  /** 이력을 포함한 상태 기록. 상태가 아직 없으면 null. */
  getItemState(ref: ItemVersionRef): ItemStateRecord | null;
  /**
   * 참조 목록의 현재 상태를 한 번에 읽는다(DD-14: 계산 요청마다 항목 버전 id 목록으로 한 번 조회). 결과는 입력과 같은 길이·순서이고
   * 상태가 없는 참조는 null 이다. 이력은 싣지 않는다. 캐시하지 않는 읽기다.
   */
  readItemStates(refs: readonly ItemVersionRef[]): Array<ItemStateSnapshot | null>;

  // ── 규칙 묶음 ──
  /** write-once. 담은 항목 버전이 모두 있어야 한다. */
  putRuleBundleVersion(bundle: RuleBundleVersion): void;
  getRuleBundleVersion(id: string): RuleBundleVersion | null;
  listRuleBundleVersions(): RuleBundleVersion[];

  /**
   * 묶음 가용성 사건을 더한다. 묶음이 있어야 한다. 사슬은 [ACTIVE(previous=null), SUSPENDED(previous=ACTIVE)] 뿐이며
   * 그 밖은 STATE_CONFLICT 다: 첫 사건은 ACTIVE, 둘째는 SUSPENDED, SUSPENDED 뒤에는 어떤 사건도 쓸 수 없다(재활성화 불가, DD-14).
   */
  appendBundleStatusEvent(event: RuleBundleStatusEvent): void;
  listBundleStatusEvents(bundleId: string): RuleBundleStatusEvent[];
  /** 현재 상태 = 마지막 사건의 status. 사건이 없으면 null. */
  getBundleStatus(bundleId: string): BundleAvailability | null;

  /** 규칙 사용 범위를 지정한다: 이력에 더하고 현재 값이 된다. 병원·묶음이 있어야 한다. 묶음이 중지돼도 바뀌지 않는다. */
  assignClinicRuleScope(scope: ClinicRuleScope): void;
  getClinicRuleScope(clinicId: string): ClinicRuleScope | null;
  listClinicRuleScopeHistory(clinicId: string): ClinicRuleScope[];

  // ── 무조작 정책·감사 ──
  /** upsert. 병원이 있어야 한다. 저장된 정책이 없을 때의 기본값 읽기 함수는 M3.D. */
  saveIdlePolicy(policy: IdlePolicy): void;
  getIdlePolicy(clinicId: string): IdlePolicy | null;

  /** 추가 전용. 같은 id 는 DUPLICATE_KEY. */
  appendAuditLog(entry: AuditLogEntry): void;
  listAuditLog(): AuditLogEntry[];
}
