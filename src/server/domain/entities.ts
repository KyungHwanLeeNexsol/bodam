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
  /**
   * 초안 게시로 숨김 처리된(비활성) 치료 id (코드 포인트 순). 카탈로그 스냅샷에는 그대로 남으므로 removedTreatmentIds 와 다르다.
   * 있을 때만 싣는다(비어 있으면 키 자체가 없다): 이 필드가 생기기 전의 요약과 모양이 같다.
   */
  deactivatedTreatmentIds?: string[];
  /** 표시 순서가 바뀐 기존 치료 id (코드 포인트 순). 살아남은 기존 치료들 사이의 순위가 달라진 것만 센다. 있을 때만 싣는다. */
  reorderedTreatmentIds?: string[];
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

/** 치료 하나의 새 가격 한 건. 가격 말고는 어떤 필드도 담지 않는다(보장 판단 필드는 가격 수정으로 바뀌지 않는다, DD-16). */
export interface PriceEdit {
  treatmentId: string;
  patientAmount: Won;
}

/** 공통 기본비용 하나의 새 금액 한 건(M7 기본비용 금액 수정). 금액 말고는 어떤 필드도 담지 않는다: 코드·급여 구분(보장 판단 필드)·이름·출처는 바뀌지 않는다(DD-16). baseFeeId 는 안정 식별자다(버전 id 가 아니다). */
export interface BaseFeeEdit {
  baseFeeId: string;
  amount: Won;
}

/**
 * 새 치료 한 건의 초안 (M7 구조 편집). 환자에게 보일 표시 필드와 서류 표시, 금액 조건만 담는다.
 * 보장 판단은 담지 않는다: 분류(calcClass)는 서버가 NEEDS_REVIEW 로 고정하고, 출처·치료 id·표시 순서·활성 여부도 서버가 정한다(요청에서 받지 않는다).
 * draftKey 는 초안 안에서만 쓰는 클라이언트 이름이다(저장된 치료 id 와 겹치면 안 된다). 게시할 때 서버가 실제 치료 id 를 새로 만든다.
 */
export interface TreatmentAddition {
  draftKey: string;
  displayName: string;
  description: string;
  benefitType: BenefitType;
  patientAmount: Won;
  treatmentCode: string;
  procedureCodes: string[];
  documentFlags: DocumentFlags;
  amountCondition: AmountCondition;
  effectiveDate: string;
}

/**
 * 병원 카탈로그의 초안 (M7 첫 기능, design.md DD-17 "카탈로그 초안 저장·미리보기·게시"). 병원마다 최대 하나(가변 기록, 저장하면 덮어쓴다).
 * 초안은 게시된 치료 버전·카탈로그 버전을 어떤 식으로도 바꾸지 않으므로 공개 키오스크 가격에 영향을 주지 않는다.
 * 게시할 때만 서비스가 새 치료 버전과 새 카탈로그 버전을 기존 게시 서비스(publishCatalog)로 만든다.
 * baseCatalogVersionId: 이 초안이 근거한 병원의 현재 카탈로그. 그 사이 다른 게시가 있었으면 게시를 거절한다(낡은 초안).
 * revision: 저장할 때마다 서버가 새로 만드는 초안 버전 값(가격이 같아도 매번 다르다). 게시 확인값의 열쇠로 쓰이므로 서버 밖(응답·감사 기록)으로 내보내지 않는다.
 */
export interface CatalogDraft {
  clinicId: string;
  baseCatalogVersionId: string;
  /** 서버 비공개. publish-confirmation.ts 만 읽는다. */
  revision: string;
  priceEdits: PriceEdit[];
  /** 현재 게시 카탈로그에 든 공통 기본비용의 새 금액들(baseFeeId 의 코드 포인트 순). 현재 금액과 같은 수정은 담지 않는다. 게시 전에는 어떤 기본비용 버전도 만들지 않는다. */
  baseFeeEdits: BaseFeeEdit[];
  /** 새 치료들(초안에 적은 순서). 게시 전에는 어떤 치료 기록도 만들지 않는다. */
  additions: TreatmentAddition[];
  /** 숨길 게시 치료 id (코드 포인트 순). 게시 전에는 치료의 active 를 바꾸지 않는다. */
  deactivations: string[];
  /**
   * 게시 뒤의 표시 순서(남는 기존 치료 id + 새 치료의 draftKey 의 순열). 기본 순서(남는 기존 치료는 지금 표시 순서 그대로, 새 치료는 적은 순서대로 뒤에)와 같으면 null 로 저장한다.
   */
  order: string[] | null;
  updatedBy: Actor;
  updatedAt: string;
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

/**
 * [문서에 없음] (M7 매핑 검토) RV 가 요청에서 매핑 초안을 만든 순간에 읽은 "검토 기준": 그 시점의 현재 게시 치료 버전의 보장 판단 필드와 그 지문.
 * 승인은 현재 게시 버전의 지문이 이 값과 같을 때만 통과한다(검토한 값과 다른 값에 승인이 찍히지 않게). 행위 코드는 코드 포인트 순으로 정렬한 사본이다.
 * 가격은 판단 필드가 아니므로 담지 않는다. 한 번 쓰면 바꾸지 않는다.
 */
export interface ReviewedBasis {
  fingerprint: string;
  fields: { treatmentCode: string; procedureCodes: string[]; benefitType: BenefitType; calcClass: CalcClass };
  /** 검토 기준을 읽은 시점의 병원 현재 카탈로그 버전 id. */
  catalogVersionId: string;
  /** ISO 8601 시각 (주입한 시계). */
  capturedAt: string;
}

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
  /**
   * [문서에 없음] (M7 매핑 검토) 매핑 초안을 만든 순간의 검토 기준. 없을 수 있다(이 필드가 생기기 전의 요청, 또는 옛 서비스로 만든 초안):
   * 없으면 승인은 확인할 수 없으므로 거절한다(mapping-review.ts REVIEW_BASIS_MISSING, 닫는 쪽으로 실패).
   */
  reviewedBasis?: ReviewedBasis;
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

/**
 * [문서에 없음] (M7 묶음 구성 보강) 묶음 게시 확인값의 서버 기록. 서버가 깨끗한 미리보기를 만들 때 쓰고(확인값 = token), 게시가 한 번 소비한다.
 * 이 기록은 "서버가 이 관리자에게 이 구성의 미리보기를 만들었다"는 증거일 뿐 사람이 읽었다는 증명이 아니다.
 * token 은 예측할 수 없는 값(주입한 식별자 생성기에서 파생)이고 응답에 실리는 유일한 값이다. configurationDigest 는 구성에 묶인 입력의 해시로 서버 안에만 있고 어떤 응답에도 싣지 않는다.
 * 쓰기 전용 한 번(token 마다), 소비(consumedAt·resultBundleId 채움)는 한 번만.
 */
export interface BundlePublishConfirmation {
  token: string;
  actorId: string;
  role: Role;
  baseBundleId: string;
  /** 고른 매핑 참조, (종류, id, 버전) 코드 포인트 순. */
  chosen: ItemVersionRef[];
  /** 발급 때의 구성 해시(관리자·기준 묶음·고른 매핑의 내용/상태/지문·합친 항목 참조). 게시 때 현재 저장소에서 다시 계산해 비교한다. */
  configurationDigest: string;
  issuedAt: string;
  /** 소비 시각. 아직 쓰이지 않았으면 null. */
  consumedAt: string | null;
  /** 이 확인값으로 게시된 묶음 id. 아직 쓰이지 않았으면 null. */
  resultBundleId: string | null;
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
