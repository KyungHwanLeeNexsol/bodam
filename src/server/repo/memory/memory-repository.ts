import { compareCodePoints } from '../../../engine/validate';
import { canonicalDigest } from '../../digest';
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
} from '../../domain/entities';
import { DomainError } from '../../domain/errors';
import type { ItemKind, ItemStateRecord, ItemStateSnapshot, ItemTransitionInput, ItemVersionRecord, ItemVersionRef, StateTransition } from '../../domain/items';
import type { Repository } from '../interfaces';
import { ReadSpy } from './read-spy';
import { deepCopy, dumpStore, emptyStore } from './store';
import type { Store } from './store';

// 저장소 인터페이스의 메모리 구현. 계약은 repo/interfaces.ts 머리말이 정한다.
// 모든 검증은 쓰기보다 앞에 둔다: 거절된 호출은 저장소를 한 바이트도 바꾸지 않는다(트랜잭션 밖에서 불려도 마찬가지).

function notFound(what: string, id: string): DomainError {
  return new DomainError('NOT_FOUND', `${what} '${id}' 이(가) 없다`);
}

function itemKey(ref: ItemVersionRef): string {
  return JSON.stringify([ref.kind, ref.id, ref.version]);
}

function describeRef(ref: ItemVersionRef): string {
  return `${ref.kind}/${ref.id}/${ref.version}`;
}

function isThenable(value: unknown): boolean {
  return value !== null && (typeof value === 'object' || typeof value === 'function') && typeof (value as { then?: unknown }).then === 'function';
}

export class MemoryRepository implements Repository {
  private store: Store = emptyStore();
  /** 읽기 호출 감시 (시험용 관측점). 저장소 상태가 아니다. */
  readonly spy = new ReadSpy();

  // ───────────────────────── 트랜잭션 ─────────────────────────

  // @MX:WARN: [AUTO] 전체 상태 복사 후 롤백. 동기 콜백만 안전하다 — 약속을 돌려주는 콜백은 롤백 시점 이후에 쓰기를 할 수 있다.
  // @MX:REASON: 콜백이 Promise 를 돌려주면 TypeError 로 거절하고 되돌린다. 비동기 트랜잭션은 DB 어댑터가 정해진 뒤의 일이다(§E #1).
  transaction<T>(fn: () => T): T {
    const checkpoint = deepCopy(this.store);
    try {
      const result = fn();
      if (isThenable(result)) {
        throw new TypeError('transaction 콜백은 동기 함수여야 한다 (Promise 를 돌려줄 수 없다)');
      }
      return result;
    } catch (error) {
      this.store = checkpoint;
      throw error;
    }
  }

  /** 시험·진단용: 저장소 전체를 비교 가능한 평범한 값으로 떠 낸다. 읽기 카운터를 올리지 않는다. */
  exportState(): Record<string, unknown> {
    return dumpStore(this.store);
  }

  // ───────────────────────── 내부 도우미 ─────────────────────────

  private requireClinic(id: string): void {
    if (!this.store.clinics.has(id)) {
      throw notFound('병원', id);
    }
  }

  private requireTreatment(id: string): void {
    if (!this.store.treatments.has(id)) {
      throw notFound('치료', id);
    }
  }

  private requireItem(ref: ItemVersionRef): void {
    if (!this.store.itemVersions.has(itemKey(ref))) {
      throw notFound('항목 버전', describeRef(ref));
    }
  }

  private requireBundle(id: string): void {
    if (!this.store.bundles.has(id)) {
      throw notFound('규칙 묶음', id);
    }
  }

  /**
   * 키마다 한 번만 쓴다. 같은 키에 같은 내용(정본 해시가 같음)이면 아무것도 하지 않고(멱등), 다르면 IMMUTABLE_VERSION.
   * 참조 검증은 이 호출보다 앞서 끝나 있어야 한다.
   */
  private putOnce<V>(map: Map<string, V>, key: string, value: V, what: string): void {
    const incoming = deepCopy(value);
    const existing = map.get(key);
    if (existing !== undefined) {
      if (canonicalDigest(existing) === canonicalDigest(incoming)) {
        return;
      }
      throw new DomainError('IMMUTABLE_VERSION', `${what} '${key}' 은(는) 이미 다른 내용으로 쓰여 있어 바꿀 수 없다`);
    }
    map.set(key, incoming);
  }

  private read<V>(map: Map<string, V>, key: string): V | null {
    const found = map.get(key);
    return found === undefined ? null : deepCopy(found);
  }

  private sortedById<V extends { id: string }>(values: Iterable<V>, keep: (value: V) => boolean = () => true): V[] {
    return [...values].filter(keep).sort((a, b) => compareCodePoints(a.id, b.id)).map(deepCopy);
  }

  // ───────────────────────── 병원·카탈로그 ─────────────────────────

  saveClinic(clinic: Clinic): void {
    for (const other of this.store.clinics.values()) {
      if (other.id !== clinic.id && other.slug === clinic.slug) {
        throw new DomainError('DUPLICATE_KEY', `slug '${clinic.slug}' 은(는) 다른 병원이 이미 쓴다`);
      }
    }
    if (clinic.currentCatalogVersionId !== null) {
      const catalog = this.store.catalogVersions.get(clinic.currentCatalogVersionId);
      if (catalog === undefined) {
        throw notFound('카탈로그 버전', clinic.currentCatalogVersionId);
      }
      if (catalog.clinicId !== clinic.id) {
        throw new DomainError('REF_CONTENT_MISMATCH', `카탈로그 버전 '${catalog.id}' 은(는) 병원 '${clinic.id}' 의 것이 아니다`);
      }
    }
    this.store.clinics.set(clinic.id, deepCopy(clinic));
  }

  getClinic(id: string): Clinic | null {
    this.spy.record('getClinic');
    return this.read(this.store.clinics, id);
  }

  listClinics(): Clinic[] {
    this.spy.record('listClinics');
    return this.sortedById(this.store.clinics.values());
  }

  getClinicCurrentCatalogVersion(clinicId: string): CatalogVersion | null {
    this.spy.record('getClinicCurrentCatalogVersion');
    const currentId = this.store.clinics.get(clinicId)?.currentCatalogVersionId ?? null;
    return currentId === null ? null : this.read(this.store.catalogVersions, currentId);
  }

  saveTreatment(treatment: Treatment): void {
    this.requireClinic(treatment.clinicId);
    // 한 id 공간: 치료 id 는 기본비용의 안정 식별자와 겹치지 못한다 (둘 다 매핑의 treatmentId 가 가리키는 값이다).
    for (const fee of this.store.baseFees.values()) {
      if (fee.baseFeeId === treatment.id) {
        throw new DomainError('DUPLICATE_KEY', `치료 id '${treatment.id}' 은(는) 공통 기본비용의 baseFeeId 로 이미 쓰인다 (치료와 기본비용은 한 id 공간을 쓴다)`);
      }
    }
    this.store.treatments.set(treatment.id, deepCopy(treatment));
  }

  getTreatment(id: string): Treatment | null {
    this.spy.record('getTreatment');
    return this.read(this.store.treatments, id);
  }

  listTreatments(clinicId: string): Treatment[] {
    this.spy.record('listTreatments');
    return this.sortedById(this.store.treatments.values(), (treatment) => treatment.clinicId === clinicId);
  }

  putTreatmentVersion(version: TreatmentVersion): void {
    this.requireTreatment(version.treatmentId);
    this.putOnce(this.store.treatmentVersions, version.id, version, '치료 버전');
  }

  getTreatmentVersion(id: string): TreatmentVersion | null {
    this.spy.record('getTreatmentVersion');
    return this.read(this.store.treatmentVersions, id);
  }

  listTreatmentVersions(treatmentId: string): TreatmentVersion[] {
    this.spy.record('listTreatmentVersions');
    return [...this.store.treatmentVersions.values()].filter((version) => version.treatmentId === treatmentId).map(deepCopy);
  }

  putCommonBaseFee(fee: CommonBaseFee): void {
    this.requireClinic(fee.clinicId);
    // 한 id 공간: 기본비용의 안정 식별자는 치료 id 와 겹치지 못한다 (saveTreatment 와 대칭).
    if (this.store.treatments.has(fee.baseFeeId)) {
      throw new DomainError('DUPLICATE_KEY', `baseFeeId '${fee.baseFeeId}' 은(는) 치료 id 로 이미 쓰인다 (치료와 기본비용은 한 id 공간을 쓴다)`);
    }
    this.putOnce(this.store.baseFees, fee.id, fee, '공통 기본비용');
  }

  getCommonBaseFee(id: string): CommonBaseFee | null {
    this.spy.record('getCommonBaseFee');
    return this.read(this.store.baseFees, id);
  }

  listCommonBaseFeeVersions(baseFeeId: string): CommonBaseFee[] {
    this.spy.record('listCommonBaseFeeVersions');
    return [...this.store.baseFees.values()].filter((fee) => fee.baseFeeId === baseFeeId).map(deepCopy);
  }

  putCatalogVersion(catalog: CatalogVersion): void {
    this.requireClinic(catalog.clinicId);
    for (const id of catalog.treatmentVersionIds) {
      if (!this.store.treatmentVersions.has(id)) {
        throw notFound('치료 버전', id);
      }
    }
    for (const id of catalog.baseFeeIds) {
      if (!this.store.baseFees.has(id)) {
        throw notFound('공통 기본비용', id);
      }
    }
    this.putOnce(this.store.catalogVersions, catalog.id, catalog, '카탈로그 버전');
  }

  getCatalogVersion(id: string): CatalogVersion | null {
    this.spy.record('getCatalogVersion');
    return this.read(this.store.catalogVersions, id);
  }

  listCatalogVersions(clinicId: string): CatalogVersion[] {
    this.spy.record('listCatalogVersions');
    return [...this.store.catalogVersions.values()].filter((catalog) => catalog.clinicId === clinicId).map(deepCopy);
  }

  // ───────────────────────── 보험사·약관 ─────────────────────────

  saveInsurer(insurer: Insurer): void {
    this.store.insurers.set(insurer.id, deepCopy(insurer));
  }

  getInsurer(id: string): Insurer | null {
    this.spy.record('getInsurer');
    return this.read(this.store.insurers, id);
  }

  listInsurers(): Insurer[] {
    this.spy.record('listInsurers');
    return this.sortedById(this.store.insurers.values());
  }

  putPolicySource(source: PolicySource): void {
    this.putOnce(this.store.policySources, source.id, source, '약관 출처');
  }

  getPolicySource(id: string): PolicySource | null {
    this.spy.record('getPolicySource');
    return this.read(this.store.policySources, id);
  }

  listPolicySources(): PolicySource[] {
    this.spy.record('listPolicySources');
    return this.sortedById(this.store.policySources.values());
  }

  // ───────────────────────── 검토 요청 ─────────────────────────

  saveCoverageReviewRequest(request: CoverageReviewRequest): void {
    this.requireClinic(request.clinicId);
    this.requireTreatment(request.treatmentId);
    if (request.draftMappingRef !== null) {
      this.requireItem(request.draftMappingRef);
    }
    if (request.resultMappingRef !== null) {
      this.requireItem(request.resultMappingRef);
    }
    this.store.reviewRequests.set(request.id, deepCopy(request));
  }

  getCoverageReviewRequest(id: string): CoverageReviewRequest | null {
    this.spy.record('getCoverageReviewRequest');
    return this.read(this.store.reviewRequests, id);
  }

  listCoverageReviewRequests(clinicId: string): CoverageReviewRequest[] {
    this.spy.record('listCoverageReviewRequests');
    return this.sortedById(this.store.reviewRequests.values(), (request) => request.clinicId === clinicId);
  }

  // ───────────────────────── 규칙 항목 ─────────────────────────

  putItemVersion(record: ItemVersionRecord): void {
    if (record.ref.id !== record.content.id || record.ref.version !== record.content.version) {
      throw new DomainError('REF_CONTENT_MISMATCH', `참조 ${describeRef(record.ref)} 이(가) 내용의 id·version(${record.content.id}/${record.content.version})과 다르다`);
    }
    this.putOnce(this.store.itemVersions, itemKey(record.ref), record, '항목 버전');
  }

  getItemVersion(ref: ItemVersionRef): ItemVersionRecord | null {
    this.spy.record('getItemVersion');
    return this.read(this.store.itemVersions, itemKey(ref));
  }

  listItemVersions(kind: ItemKind): ItemVersionRecord[] {
    this.spy.record('listItemVersions');
    return [...this.store.itemVersions.values()].filter((record) => record.ref.kind === kind).map(deepCopy);
  }

  reviseDraftItemVersion(record: ItemVersionRecord): void {
    const key = itemKey(record.ref);
    const existing = this.store.itemVersions.get(key);
    if (existing === undefined) {
      throw notFound('항목 버전', describeRef(record.ref));
    }
    if (record.ref.id !== record.content.id || record.ref.version !== record.content.version) {
      throw new DomainError('REF_CONTENT_MISMATCH', `참조 ${describeRef(record.ref)} 이(가) 내용의 id·version(${record.content.id}/${record.content.version})과 다르다`);
    }
    const state = this.store.itemStates.get(key)?.state;
    if (state !== 'DRAFT') {
      throw new DomainError('STATE_CONFLICT', `항목 ${describeRef(record.ref)} 의 현재 상태는 ${state ?? '(없음)'} 이라 내용을 바꿀 수 없다 (DRAFT 만 가능)`);
    }
    if (existing.authorId !== record.authorId || existing.createdAt !== record.createdAt) {
      throw new DomainError('IMMUTABLE_VERSION', `항목 ${describeRef(record.ref)} 의 작성자와 작성 시각은 바꿀 수 없다`);
    }
    this.store.itemVersions.set(key, deepCopy(record));
  }

  recordItemTransition(ref: ItemVersionRef, transition: ItemTransitionInput): void {
    this.requireItem(ref);
    const key = itemKey(ref);
    const current = this.store.itemStates.get(key);
    const expectedFrom = current === undefined ? null : current.state;
    if (transition.from !== expectedFrom) {
      throw new DomainError(
        'STATE_CONFLICT',
        `항목 ${describeRef(ref)} 의 현재 상태는 ${expectedFrom ?? '(없음)'} 인데 전이의 from 은 ${transition.from ?? '(없음)'} 이다`,
      );
    }
    const approver = transition.approverAfter === null ? null : deepCopy(transition.approverAfter);
    const approvedFingerprint = transition.approvedFingerprintAfter;
    const step: StateTransition = {
      from: transition.from,
      to: transition.to,
      actorId: transition.actor.id,
      role: transition.actor.role,
      at: transition.at,
      reason: transition.reason,
      approver: deepCopy(approver),
      approvedFingerprint,
    };
    if (current === undefined) {
      this.store.itemStates.set(key, { ref: { kind: ref.kind, id: ref.id, version: ref.version }, state: transition.to, approver, approvedFingerprint, history: [step] });
    } else {
      current.state = transition.to;
      current.approver = approver;
      current.approvedFingerprint = approvedFingerprint;
      current.history.push(step);
    }
  }

  getItemState(ref: ItemVersionRef): ItemStateRecord | null {
    this.spy.record('getItemState');
    return this.read(this.store.itemStates, itemKey(ref));
  }

  readItemStates(refs: readonly ItemVersionRef[]): Array<ItemStateSnapshot | null> {
    this.spy.record('readItemStates');
    return refs.map((ref) => {
      const found = this.store.itemStates.get(itemKey(ref));
      return found === undefined ? null : deepCopy({ ref: found.ref, state: found.state, approver: found.approver, approvedFingerprint: found.approvedFingerprint });
    });
  }

  // ───────────────────────── 규칙 묶음 ─────────────────────────

  putRuleBundleVersion(bundle: RuleBundleVersion): void {
    for (const ref of bundle.itemRefs) {
      this.requireItem(ref);
    }
    this.putOnce(this.store.bundles, bundle.id, bundle, '규칙 묶음');
  }

  getRuleBundleVersion(id: string): RuleBundleVersion | null {
    this.spy.record('getRuleBundleVersion');
    return this.read(this.store.bundles, id);
  }

  listRuleBundleVersions(): RuleBundleVersion[] {
    this.spy.record('listRuleBundleVersions');
    return [...this.store.bundles.values()].map(deepCopy);
  }

  appendBundleStatusEvent(event: RuleBundleStatusEvent): void {
    this.requireBundle(event.bundleId);
    const events = this.store.bundleEvents.get(event.bundleId) ?? [];
    const last = events.at(-1);
    // 허용되는 사슬은 [ACTIVE(previous=null), SUSPENDED(previous=ACTIVE)] 뿐이다 (DD-14: 중지는 되돌리지 않는다).
    const allowed =
      last === undefined
        ? event.status === 'ACTIVE' && event.previousStatus === null
        : last.status === 'ACTIVE' && event.status === 'SUSPENDED' && event.previousStatus === 'ACTIVE';
    if (!allowed) {
      throw new DomainError(
        'STATE_CONFLICT',
        `묶음 '${event.bundleId}' 의 현재 상태 ${last?.status ?? '(사건 없음)'} 뒤에 ${event.previousStatus ?? '(없음)'} → ${event.status} 사건을 쓸 수 없다`,
      );
    }
    this.store.bundleEvents.set(event.bundleId, [...events, deepCopy(event)]);
  }

  listBundleStatusEvents(bundleId: string): RuleBundleStatusEvent[] {
    this.spy.record('listBundleStatusEvents');
    return deepCopy(this.store.bundleEvents.get(bundleId) ?? []);
  }

  getBundleStatus(bundleId: string): BundleAvailability | null {
    this.spy.record('getBundleStatus');
    return this.store.bundleEvents.get(bundleId)?.at(-1)?.status ?? null;
  }

  assignClinicRuleScope(scope: ClinicRuleScope): void {
    this.requireClinic(scope.clinicId);
    this.requireBundle(scope.ruleBundleVersionId);
    const history = this.store.scopeHistory.get(scope.clinicId) ?? [];
    this.store.scopeHistory.set(scope.clinicId, [...history, deepCopy(scope)]);
  }

  getClinicRuleScope(clinicId: string): ClinicRuleScope | null {
    this.spy.record('getClinicRuleScope');
    const current = this.store.scopeHistory.get(clinicId)?.at(-1);
    return current === undefined ? null : deepCopy(current);
  }

  listClinicRuleScopeHistory(clinicId: string): ClinicRuleScope[] {
    this.spy.record('listClinicRuleScopeHistory');
    return deepCopy(this.store.scopeHistory.get(clinicId) ?? []);
  }

  // ───────────────────────── 무조작 정책·감사 ─────────────────────────

  saveIdlePolicy(policy: IdlePolicy): void {
    this.requireClinic(policy.clinicId);
    this.store.idlePolicies.set(policy.clinicId, deepCopy(policy));
  }

  getIdlePolicy(clinicId: string): IdlePolicy | null {
    this.spy.record('getIdlePolicy');
    return this.read(this.store.idlePolicies, clinicId);
  }

  appendAuditLog(entry: AuditLogEntry): void {
    if (this.store.auditLog.has(entry.id)) {
      throw new DomainError('DUPLICATE_KEY', `감사 기록 '${entry.id}' 은(는) 이미 있다`);
    }
    this.store.auditLog.set(entry.id, deepCopy(entry));
  }

  listAuditLog(): AuditLogEntry[] {
    this.spy.record('listAuditLog');
    return [...this.store.auditLog.values()].map(deepCopy);
  }
}

/** 비어 있는 메모리 저장소를 만든다. */
export function createMemoryRepository(): MemoryRepository {
  return new MemoryRepository();
}
