import type { BenefitType, CalcClass, DocumentFlags, InsurerType, Origin, PolicySourceRef, Won } from '../../engine/types';
import type { Actor, Role } from './actor';
import type { ItemVersionRef } from './items';

// DD-18 엔티티 가운데 M3 가 다루는 것의 형식. 규칙 항목(프로필·매핑·서류 규칙 묶음)의 내용은 엔진 타입을 재사용하며
// domain/items.ts 가 맡는다. 이 파일은 순수 형식이고 로직을 두지 않는다.
// 아래에서 "[문서에 없음]" 표시는 design.md DD-18 이 필드 모양을 정하지 않아 M3.A 가 정한 것이다(뒤 단계가 늘리는 것은 허용).

// ───────────────────────── 병원·카탈로그 ─────────────────────────

/** [문서에 없음] DD-18 은 종별을 `CLINIC`(외래 전용)만 말한다. 다른 종별은 필요할 때 더한다. */
export type InstitutionType = 'CLINIC';

export interface Clinic {
  id: string;
  /** 병원 사이에서 유일하다. 공개 위치 정보일 뿐 권한이 아니다 (DD-19). */
  slug: string;
  /** 병원명 (서비스명과 별도). */
  name: string;
  institutionType: InstitutionType;
  contact: string;
  /** 이 병원의 현재(최신) 카탈로그 버전. 아직 게시한 적이 없으면 null. */
  currentCatalogVersionId: string | null;
}

export interface Treatment {
  id: string;
  clinicId: string;
  sortOrder: number;
  active: boolean;
}

/** [문서에 없음] 금액 적용 조건(환자 유형·가정·기준일)의 세부 모양. */
export interface AmountCondition {
  patientType: string;
  assumption: string;
  referenceDate: string;
}

/**
 * 치료 버전. 한 번 쓰면 바꾸지 않는다(id 가 버전 id 다). [문서에 없음] DD-18 의 "게시 상태"는 가변 필드가 아니라
 * 카탈로그 버전에 담겼는지로 표현한다: 불변 기록에 가변 상태를 둘 수 없기 때문이다.
 */
export interface TreatmentVersion {
  id: string;
  treatmentId: string;
  displayName: string;
  description: string;
  benefitType: BenefitType;
  /** 환자 예상 결제액. 보장 판단 필드가 아니다(DD-16). */
  patientAmount: Won;
  amountCondition: AmountCondition;
  /** 보장 판단 필드 (DD-16). */
  treatmentCode: string;
  /** 보장 판단 필드 (DD-16). 순서는 의미가 없는 목록이다(fingerprint.ts). */
  procedureCodes: string[];
  /** 보장 판단 필드 (DD-16). */
  calcClass: CalcClass;
  documentFlags: DocumentFlags;
  origin: Origin;
  effectiveDate: string;
}

/**
 * 자동 포함 줄 (DD-03)의 한 버전. 한 번 쓰면 바꾸지 않으며(id 가 버전 id 다) 바뀐 비용은 같은 baseFeeId 의 새 버전으로 낸다
 * ([문서에 없음]: 카탈로그 버전이 이 버전 id 목록을 담는다). 치료의 TreatmentVersion(id / treatmentId)과 같은 모양이다.
 */
export interface CommonBaseFee {
  /** 버전 id. 엔진 줄의 treatmentVersionId 가 된다. */
  id: string;
  /**
   * [문서에 없음] 기본비용의 안정 식별자. 같은 기본비용의 모든 버전이 같은 값을 갖고, 매핑의 treatmentId 가 이 값을 가리키며,
   * 엔진 줄의 treatmentId 가 된다. 치료 id 와 한 id 공간을 쓴다(둘은 겹치지 못한다: 저장소 백스톱).
   * 가격만 바뀐 새 버전이 매핑을 고아로 만들지 않도록 버전 id 와 분리했다.
   */
  baseFeeId: string;
  clinicId: string;
  displayName: string;
  /** 보장 판단 필드 (fingerprint.ts COMMON_BASE_FEE_JUDGMENT_FIELDS). */
  benefitType: BenefitType;
  /** 가격. 보장 판단 필드가 아니다. */
  amount: Won;
  /** 보장 판단 필드 (fingerprint.ts COMMON_BASE_FEE_JUDGMENT_FIELDS). */
  code: string;
  origin: Origin;
}

/** [문서에 없음] 변경 요약의 세부 모양. */
export interface CatalogChangeSummary {
  addedTreatmentIds: string[];
  removedTreatmentIds: string[];
  priceChangedTreatmentIds: string[];
  baseFeesChanged: boolean;
}

/** 병원 카탈로그의 게시본. 바뀌지 않는다. 게시할 때마다 새 버전이며 가격만 바뀐 게시도 마찬가지다 (DD-14). */
export interface CatalogVersion {
  id: string;
  clinicId: string;
  treatmentVersionIds: string[];
  baseFeeIds: string[];
  publishedBy: Actor;
  publishedAt: string;
  changeSummary: CatalogChangeSummary;
}

// ───────────────────────── 보험사·약관 ─────────────────────────

export interface Insurer {
  id: string;
  insurerType: InsurerType;
  currentName: string;
  /** 과거 이름 별칭. */
  formerNames: string[];
  /** 검증된 연락처. 없으면 null. */
  verifiedContact: string | null;
}

/** 약관 출처. 필드는 엔진의 PolicySourceRef 를 재사용하고 식별자만 더한다. 한 번 쓰면 바꾸지 않는다. */
export interface PolicySource extends PolicySourceRef {
  id: string;
}

// ───────────────────────── 검토 요청 ─────────────────────────

/** [문서에 없음] 병원이 제안하는 보장 분류 정보의 세부 모양 (급여 구분·행위 코드·치료 분류). */
export interface ProposedCoverageInfo {
  benefitType: BenefitType;
  procedureCodes: string[];
  calcClass: CalcClass;
}

export type ReviewRequestStatus = 'REVIEW_REQUESTED' | 'APPROVED' | 'REJECTED';

/** HA 가 만들고 RV 가 처리하는 검토 요청 기록. HA 의 요청은 이 기록만 만들고 매핑을 만들지 않는다 (결정 #34). */
export interface CoverageReviewRequest {
  id: string;
  clinicId: string;
  treatmentId: string;
  proposed: ProposedCoverageInfo;
  requestedBy: Actor;
  requestedAt: string;
  status: ReviewRequestStatus;
  rejectionReason: string | null;
  /**
   * [문서에 없음] (M3.B) RV 가 이 요청으로 만든 매핑 초안. 승인·반려가 요청을 어느 매핑에서 닫는지 알려면 처리 중에도
   * 연결이 있어야 하므로 더했다. 한 요청에 초안은 하나이며 닫힌 뒤에도 그대로 남는다. 초안 전이면 null.
   */
  draftMappingRef: ItemVersionRef | null;
  /** 결과 매핑 버전. 승인으로 닫혔을 때만 채운다. 처리 전이거나 반려면 null. */
  resultMappingRef: ItemVersionRef | null;
}

// ───────────────────────── 규칙 묶음 ─────────────────────────

/** 규칙 묶음 가용성 (DD-14). */
export type BundleAvailability = 'ACTIVE' | 'SUSPENDED';

/**
 * 규칙 묶음 게시본. 바꿀 수 없다 (id, 포함한 항목 버전 참조, 내용 해시, 게시자, 게시일).
 * 사용 가능 여부는 이 엔티티가 아니라 RuleBundleStatusEvent 가 따로 갖는다.
 * contentHash 가 무엇을 해시하는지는 M3.D 가 정한다.
 */
export interface RuleBundleVersion {
  id: string;
  itemRefs: ItemVersionRef[];
  contentHash: string;
  publishedBy: Actor;
  publishedAt: string;
}

/** 묶음 가용성 사건. 추가 전용이며 현재 상태는 마지막 사건이다. 중지는 되돌리지 않는다 (DD-14). */
export interface RuleBundleStatusEvent {
  bundleId: string;
  status: BundleAvailability;
  actorId: string;
  role: Role;
  at: string;
  /** 중지는 사유가 필수다(서비스가 검사). 첫 ACTIVE 사건은 null 이어도 된다. */
  reason: string | null;
  previousStatus: BundleAvailability | null;
}

/** 병원의 규칙 사용 범위 한 건. 현재 값은 마지막 지정이고 이력이 모두 남는다. 묶음이 중지돼도 바뀌지 않는다 (DD-14). */
export interface ClinicRuleScope {
  clinicId: string;
  ruleBundleVersionId: string;
  assignedBy: Actor;
  assignedAt: string;
}

// ───────────────────────── 무조작 정책·감사 ─────────────────────────

/** [문서에 없음] 한 화면 종류의 경고·초기화 시간(초). */
export interface IdleThreshold {
  warnSeconds: number;
  resetSeconds: number;
}

/**
 * 병원별 무조작 정책 (DD-10, DD-18). 저장된 정책이 없으면 읽기 함수가 DD-10 표의 값을 낸다(읽기 함수는 M3.D).
 * [문서에 없음] 화면 종류의 닫힌 목록은 읽기 함수를 만드는 M3.D 가 정하므로 여기서는 문자열 키로 둔다.
 * completionHoldSeconds 는 저장된 값이 없으면 null.
 */
export interface IdlePolicy {
  clinicId: string;
  screens: Record<string, IdleThreshold>;
  completionHoldSeconds: number | null;
}

/** 모든 관리 동작의 감사 기록. 승인 우회 표지(selfApproval 등)는 어디에도 없다 (결정 #31). */
export interface AuditLogEntry {
  id: string;
  actorId: string;
  role: Role;
  action: string;
  target: string;
  beforeVersion: string | null;
  afterVersion: string | null;
  reason: string | null;
  at: string;
  /**
   * [문서에 없음] (M3.D2) 규칙 묶음 중지만 채우는 영향 병원 수. DD-14 는 중지의 감사 기록에 "영향을 받는 병원 수"를 남기라고 하지만
   * DD-18 AuditLog 필드 목록에는 자리가 없어 선택 필드로 더했다. 다른 동작의 기록에는 이 키가 없다.
   */
  affectedClinicCount?: number;
}
